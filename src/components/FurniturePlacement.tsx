"use client";

/* ============================================================
   Cultural furniture recommendation + placement.

   Appears under the /studio results once a room has been generated.
   Flow: pick an item -> the backend proposes valid spots -> drag it
   around with live green/red feedback -> confirm -> the item is
   composited into the room.

   The backend is authoritative on validity. This component shows what
   the server said; it never decides on its own that a spot is legal.
   Every drag re-validates, debounced, with stale requests aborted.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import {
  ApiError,
  confirmPlacement,
  fetchCandidatePositions,
  fetchFurnitureRecommendations,
  furnitureAssetUrl,
  validatePlacement,
  type FurnitureItem,
  type PlacementCandidate,
  type PlacementPosition,
  type RoomAnalysisSummary,
  type StyleId,
} from "@/lib/api";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  style: StyleId;
  /** Current image for this style (data URL). Replaced after each insertion. */
  imageSrc: string;
  analysis?: RoomAnalysisSummary | null;
  /** Called with the edited room after a confirmed placement. */
  onPlaced: (image: string) => void;
}

type Phase = "browsing" | "loadingSpots" | "positioning" | "inserting";

/** Debounce for drag validation — long enough to avoid flooding, short enough
 *  that the outline still feels live under the cursor. */
const VALIDATE_DEBOUNCE_MS = 120;

export default function FurniturePlacement({
  jobId,
  style,
  imageSrc,
  analysis,
  onPlaced,
}: Props) {
  const { isArabic } = useThemeLanguage();

  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [phase, setPhase] = useState<Phase>("browsing");
  const [selected, setSelected] = useState<FurnitureItem | null>(null);
  const [spots, setSpots] = useState<PlacementCandidate[]>([]);
  const [spotIndex, setSpotIndex] = useState(0);
  // `pos` holds the item's UNROTATED box. The backend applies the yaw and returns
  // the turned box in `rendered`, so the client never computes rotated widths
  // itself and can't disagree with the validator about what it just approved.
  const [pos, setPos] = useState<PlacementPosition | null>(null);
  const [rendered, setRendered] = useState<PlacementPosition | null>(null);
  const [rotation, setRotation] = useState(0);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [valid, setValid] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<{ en: string; ar: string } | null>(null);
  const [noSpace, setNoSpace] = useState<{ en: string; ar: string } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ dx: number; dy: number } | null>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateCtrl = useRef<AbortController | null>(null);

  const t = useCallback(
    (en: string, ar: string) => (isArabic ? ar : en),
    [isArabic],
  );

  /* ---------------- recommendations ---------------- */
  useEffect(() => {
    let cancelled = false;
    setLoadingItems(true);
    setError(null);
    fetchFurnitureRecommendations(style, {
      roomType: "living_room",
      freeFloorM2: analysis?.free_floor_m2 ?? undefined,
      existing: analysis?.existing_categories,
    })
      .then((list) => !cancelled && setItems(list))
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? { en: e.message_en, ar: e.message_ar }
            : { en: "Could not load furniture.", ar: "تعذّر تحميل الأثاث." },
        );
      })
      .finally(() => !cancelled && setLoadingItems(false));
    return () => {
      cancelled = true;
    };
  }, [style, analysis]);

  /* ---------------- image <-> screen scaling ----------------
     Positions come back in rendered-image pixels; the stage displays the
     image scaled to fit. Everything is stored in image pixels and converted
     only for rendering, so what we send back always matches what the backend
     validated.                                                            */
  // The stage width is read at render time rather than memoised, because it
  // changes with the viewport; this listener just forces a re-read on resize.
  const [, forceRerender] = useState(0);
  useEffect(() => {
    const onResize = () => forceRerender((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toScreen = useCallback(
    (p: PlacementPosition) => {
      const s = stageRef.current && imageSize
        ? stageRef.current.clientWidth / imageSize.width
        : 1;
      return { left: p.x * s, top: p.y * s, width: p.width * s, height: p.height * s };
    },
    [imageSize],
  );

  /* ---------------- pick an item ---------------- */
  const pickItem = useCallback(
    async (item: FurnitureItem) => {
      setSelected(item);
      setPhase("loadingSpots");
      setError(null);
      setNoSpace(null);
      setSpots([]);
      setPos(null);
      try {
        const res = await fetchCandidatePositions(jobId, item.id, 3);
        setImageSize(res.image_size);
        if (!res.positions.length) {
          // A legitimate outcome, not an error: some items genuinely don't fit.
          setNoSpace({
            en: res.message ?? "No safe empty space was found for this item.",
            ar: res.message_ar ?? "لم يتم العثور على مساحة فارغة آمنة لهذه القطعة.",
          });
          setPhase("browsing");
          setSelected(null);
          return;
        }
        setSpots(res.positions);
        setSpotIndex(0);
        setPos(res.positions[0].position);
        setRendered(res.positions[0].position);
        setRotation(0);
        setValid(true);
        setReason(null);
        setPhase("positioning");
      } catch (e) {
        setError(
          e instanceof ApiError
            ? { en: e.message_en, ar: e.message_ar }
            : { en: "Could not find positions.", ar: "تعذّر إيجاد مواضع." },
        );
        setPhase("browsing");
        setSelected(null);
      }
    },
    [jobId],
  );

  /* ---------------- live validation while dragging ---------------- */
  const revalidate = useCallback(
    (next: PlacementPosition, deg: number) => {
      if (!selected) return;
      if (validateTimer.current) clearTimeout(validateTimer.current);
      validateTimer.current = setTimeout(() => {
        validateCtrl.current?.abort(); // drop the previous in-flight check
        const ctrl = new AbortController();
        validateCtrl.current = ctrl;
        validatePlacement(jobId, selected.id, { ...next, rotation: deg }, { signal: ctrl.signal })
          .then((r) => {
            setValid(r.valid);
            setReason(isArabic ? r.reason_ar : r.reason);
            // Draw what the server actually checked, not our own guess at it.
            setRendered(r.position);
          })
          .catch((e) => {
            // An aborted check is expected during a fast drag — ignore it.
            if (e instanceof ApiError && e.code === "network_unreachable") return;
          });
      }, VALIDATE_DEBOUNCE_MS);
    },
    [jobId, selected, isArabic],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos || phase !== "positioning") return;
    const s = toScreen(rendered ?? pos);
    const rect = stageRef.current!.getBoundingClientRect();
    dragging.current = {
      dx: e.clientX - rect.left - s.left,
      dy: e.clientY - rect.top - s.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !pos || !imageSize || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const scale = stageRef.current.clientWidth / imageSize.width;
    const nx = (e.clientX - rect.left - dragging.current.dx) / scale;
    const ny = (e.clientY - rect.top - dragging.current.dy) / scale;
    const next: PlacementPosition = {
      ...pos,
      // Clamp to the image so a drag can't push the item entirely off-canvas;
      // the backend would reject it anyway, but the preview shouldn't vanish.
      x: Math.max(0, Math.min(nx, imageSize.width - pos.width)),
      y: Math.max(0, Math.min(ny, imageSize.height - pos.height)),
    };
    setPos(next);
    setRendered({ ...next, width: (rendered ?? next).width, rotation });
    revalidate(next, rotation);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  /* ---------------- resize within safe limits ---------------- */
  const resize = (factor: number) => {
    if (!pos || !imageSize) return;
    const w = pos.width * factor;
    const h = pos.height * factor;
    // Keep the base anchored: an item being resized should grow upward from the
    // floor, not drift off it.
    const next: PlacementPosition = {
      ...pos,
      x: pos.x + (pos.width - w) / 2,
      y: pos.y + (pos.height - h),
      width: w,
      height: h,
    };
    setPos(next);
    revalidate(next, rotation);
  };

  const rotate = (deg: number) => {
    // Wrap to 0-359 so 350 + 20 becomes 10, not 370.
    const next = ((deg % 360) + 360) % 360;
    setRotation(next);
    if (pos) revalidate(pos, next);
  };

  const chooseSpot = (i: number) => {
    setSpotIndex(i);
    setPos(spots[i].position);
    setRendered(spots[i].position);
    setRotation(0);
    setValid(spots[i].valid);
    setReason(null);
  };

  const cancel = () => {
    setPhase("browsing");
    setSelected(null);
    setPos(null);
    setRendered(null);
    setRotation(0);
    setSpots([]);
    setReason(null);
  };

  const confirm = async () => {
    if (!selected || !pos) return;
    setPhase("inserting");
    setError(null);
    try {
      const res = await confirmPlacement(jobId, selected.id, style, { ...pos, rotation });
      onPlaced(res.image);
      cancel();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? { en: e.message_en, ar: e.message_ar }
          : { en: "Could not insert the furniture.", ar: "تعذّر إدراج الأثاث." },
      );
      setPhase("positioning");
    }
  };

  useEffect(
    () => () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
      validateCtrl.current?.abort();
    },
    [],
  );

  /* ---------------- render ---------------- */
  return (
    <section
      className="mt-10 rounded-2xl border border-[var(--dd-gold-dim)]/30 bg-[var(--dd-surface)] p-5"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <header className={cn("mb-4", isArabic ? "text-right" : "text-left")}>
        <h3
          className={cn(
            "text-lg font-semibold text-[var(--dd-gold)]",
            isArabic ? "font-arabic" : "font-display",
          )}
        >
          {t("Add cultural furniture", "أضف أثاثًا تراثيًا")}
        </h3>
        <p className="mt-1 text-sm text-[var(--dd-text-secondary)]">
          {t(
            "Pick a piece, position it, then confirm before it is added to the room.",
            "اختر قطعة، حدّد موضعها، ثم أكّد قبل إضافتها إلى الغرفة.",
          )}
        </p>
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
          {isArabic ? error.ar : error.en}
        </p>
      )}
      {noSpace && (
        <p className="mb-4 rounded-lg border border-[var(--dd-gold-dim)]/40 bg-[var(--dd-surface-strong)] px-3 py-2 text-sm text-[var(--dd-text-soft)]">
          {isArabic ? noSpace.ar : noSpace.en}
        </p>
      )}

      {/* ---------- item cards ---------- */}
      {phase === "browsing" && (
        <>
          {loadingItems ? (
            <div className="flex items-center gap-2 py-6 text-sm text-[var(--dd-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Finding suitable pieces…", "جارٍ اختيار القطع المناسبة…")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => pickItem(item)}
                  className="group rounded-xl border border-[var(--dd-gold-dim)]/25 bg-[var(--dd-surface-strong)] p-3 text-start transition hover:border-[var(--dd-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dd-gold)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={furnitureAssetUrl(item)}
                    alt={isArabic ? item.name_ar : item.name_en}
                    className="mx-auto h-24 w-auto object-contain"
                  />
                  <p
                    className={cn(
                      "mt-2 text-sm font-medium text-[var(--dd-text)]",
                      isArabic && "font-brand-arabic",
                    )}
                  >
                    {isArabic ? item.name_ar : item.name_en}
                  </p>
                  {/* Why this was suggested — a recommendation with no stated
                      reason just looks arbitrary. */}
                  {item.reasons?.[0] && (
                    <p className="mt-1 text-xs text-[var(--dd-text-secondary)]">
                      {item.reasons[0]}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {phase === "loadingSpots" && (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--dd-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("Looking for space…", "جارٍ البحث عن مساحة…")}
        </div>
      )}

      {/* ---------- placement stage ---------- */}
      {(phase === "positioning" || phase === "inserting") && selected && pos && (
        <div className="space-y-4">
          <div
            ref={stageRef}
            className="relative w-full select-none overflow-hidden rounded-xl"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt="" className="block w-full" draggable={false} />

            {/* other suggested spots */}
            {spots.map((s, i) =>
              i === spotIndex ? null : (
                <button
                  key={i}
                  onClick={() => chooseSpot(i)}
                  aria-label={t(`Suggested position ${i + 1}`, `الموضع المقترح ${i + 1}`)}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--dd-gold)] bg-[var(--dd-gold)]/25 transition hover:bg-[var(--dd-gold)]/50"
                  style={{
                    left: toScreen(s.position).left + toScreen(s.position).width / 2,
                    top: toScreen(s.position).top + toScreen(s.position).height,
                    width: 18,
                    height: 18,
                  }}
                />
              ),
            )}

            {/* the item being positioned */}
            <div
              onPointerDown={onPointerDown}
              className={cn(
                "absolute z-20 cursor-grab touch-none rounded-sm outline-2 outline-offset-2 active:cursor-grabbing",
                valid ? "outline-[var(--success)]" : "outline-[var(--error)]",
              )}
              style={{ ...toScreen(rendered ?? pos), outlineStyle: "solid" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={furnitureAssetUrl(selected)}
                alt=""
                className={cn("h-full w-full object-contain", !valid && "opacity-60")}
                draggable={false}
                // Past 90° the piece faces the other way. Mirroring is the only
                // honest cue available from a single view, and it matches what
                // the compositor does on confirm, so preview and result agree.
                style={
                  Math.cos((rotation * Math.PI) / 180) < 0
                    ? { transform: "scaleX(-1)" }
                    : undefined
                }
              />
            </div>
          </div>

          {/* validity feedback */}
          <p
            className={cn(
              "text-sm",
              valid ? "text-[var(--success)]" : "text-[var(--error)]",
            )}
            role="status"
          >
            {reason ??
              (valid
                ? t(
                    "Valid position: enough floor space and no detected overlap.",
                    "موضع صالح: مساحة أرضية كافية ولا يوجد تداخل.",
                  )
                : "")}
          </p>

          {/* rotation — degree by degree.
              This is a yaw: the piece turns on the floor, so its apparent width
              changes and the backend re-validates against the turned footprint.
              With one photo per item we can't reveal its back, so past 90° it
              mirrors rather than showing a genuinely new face. */}
          <div className={cn("flex items-center gap-3", isArabic && "flex-row-reverse")}>
            <label
              htmlFor="furniture-rotation"
              className="shrink-0 text-sm text-[var(--dd-text-secondary)]"
            >
              {t("Rotate", "تدوير")}
            </label>
            <input
              id="furniture-rotation"
              type="range"
              min={0}
              max={359}
              step={1}
              value={rotation}
              onChange={(e) => rotate(Number(e.target.value))}
              disabled={phase === "inserting"}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--dd-surface-strong)] accent-[var(--dd-gold)]"
            />
            <input
              type="number"
              min={0}
              max={359}
              value={rotation}
              onChange={(e) => rotate(Number(e.target.value))}
              disabled={phase === "inserting"}
              aria-label={t("Rotation in degrees", "زاوية التدوير بالدرجات")}
              className="w-16 rounded-lg border border-[var(--dd-gold-dim)]/40 bg-transparent px-2 py-1 text-sm text-[var(--dd-text)]"
            />
            <span className="text-sm text-[var(--dd-text-secondary)]">°</span>
            <button
              onClick={() => rotate(0)}
              disabled={rotation === 0 || phase === "inserting"}
              className="rounded-lg border border-[var(--dd-gold-dim)]/40 px-2 py-1 text-xs text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)] disabled:opacity-40"
            >
              {t("Reset", "إعادة")}
            </button>
          </div>

          {/* controls */}
          <div className={cn("flex flex-wrap items-center gap-2", isArabic && "flex-row-reverse")}>
            <button
              onClick={() => resize(0.9)}
              className="rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]"
            >
              {t("Smaller", "أصغر")}
            </button>
            <button
              onClick={() => resize(1.1)}
              className="rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]"
            >
              {t("Larger", "أكبر")}
            </button>
            {spots.length > 1 && (
              <button
                onClick={() => chooseSpot((spotIndex + 1) % spots.length)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("Next suggestion", "الاقتراح التالي")}
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={cancel}
              disabled={phase === "inserting"}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {t("Cancel", "إلغاء")}
            </button>
            <button
              onClick={confirm}
              disabled={!valid || phase === "inserting"}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--dd-gold)] px-4 py-1.5 text-sm font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "inserting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {phase === "inserting"
                ? t("Inserting…", "جارٍ الإدراج…")
                : t("Confirm placement", "تأكيد الموضع")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
