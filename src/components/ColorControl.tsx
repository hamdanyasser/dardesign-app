"use client";

/* ============================================================
   Colour Control — repaint the wall or the floor of a finished
   render, inside the segmentation mask /redesign already computed.

   Preview changes nothing server-side; Confirm makes the recoloured
   render the job's current image, so the existing Save button stores
   it as a new design and a second edit builds on the first. Undo
   steps back one confirmation, Reset drops them all (furniture placed
   earlier survives both — colour edits only).

   Self-contained: delete this file and its two call sites in
   src/app/studio/page.tsx and the feature is gone.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, Loader2, Paintbrush, RotateCcw, Undo2, X } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  applyRecolor,
  fetchColorState,
  previewRecolor,
  resetRecolor,
  undoRecolor,
  type ColorTarget,
  type ColorTargetAvailability,
  type StyleId,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  /** The culture currently on screen — the render that gets recoloured. */
  style: StyleId;
  /** The current render, shown until a preview replaces it. */
  imageSrc: string;
  /** Hand the new image back so the studio (and Save, and the report) use it. */
  onImageChange: (image: string) => void;
}

/** Presets, chosen to sit naturally in the app's palettes rather than to be a
 *  generic colour wheel: warm plasters and limestones for walls, wood and stone
 *  tones for floors. The full picker is always there for anything else. */
const PRESETS: Record<ColorTarget, { hex: string; en: string; ar: string }[]> = {
  wall: [
    { hex: "#EFE7D8", en: "Limestone", ar: "حجر جيري" },
    { hex: "#D9C7A7", en: "Warm sand", ar: "رملي دافئ" },
    { hex: "#C97B5A", en: "Terracotta", ar: "طيني" },
    { hex: "#2E5F8A", en: "Majlis blue", ar: "أزرق مجلسي" },
    { hex: "#4F6F52", en: "Olive", ar: "زيتوني" },
    { hex: "#7A5C99", en: "Plum", ar: "برقوقي" },
    { hex: "#8A2E2E", en: "Deep red", ar: "أحمر غامق" },
    { hex: "#3A3A44", en: "Charcoal", ar: "فحمي" },
  ],
  floor: [
    { hex: "#8B5E3C", en: "Walnut", ar: "جوزي" },
    { hex: "#C4A484", en: "Light oak", ar: "بلوط فاتح" },
    { hex: "#9E9384", en: "Grey stone", ar: "حجر رمادي" },
    { hex: "#E4DCCB", en: "Pale marble", ar: "رخام فاتح" },
    { hex: "#6B4226", en: "Dark wood", ar: "خشب داكن" },
    { hex: "#B85C38", en: "Clay tile", ar: "بلاط فخاري" },
    { hex: "#3F4A3C", en: "Slate green", ar: "أخضر صخري" },
    { hex: "#2B2B33", en: "Basalt", ar: "بازلتي" },
  ],
};

const TARGET_LABEL: Record<ColorTarget, { en: string; ar: string }> = {
  wall: { en: "Wall", ar: "الجدران" },
  floor: { en: "Floor", ar: "الأرضية" },
};

type Busy = null | "preview" | "apply" | "undo" | "reset";

export default function ColorControl({ jobId, style, imageSrc, onImageChange }: Props) {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ColorTarget>("wall");
  const [color, setColor] = useState<string>(PRESETS.wall[3].hex);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ en: string; ar: string } | null>(null);
  const [availability, setAvailability] = useState<ColorTargetAvailability[] | null>(null);
  /** The unconfirmed preview, if any. Kept separate from the confirmed image so
   *  Cancel is just "forget this", with nothing to roll back. */
  const [preview, setPreview] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  // Read the room's state from the server whenever the panel opens or the
  // culture changes: which surfaces exist (so "Floor" can be disabled up front
  // rather than failing after a colour is picked) and whether a step back is
  // still possible.
  //
  // `canUndo` has to come from here, not from what this component remembers
  // doing. The undo stack lives on the server, keyed by job *and* style — so
  // recolouring Lebanese, switching to Khaleeji and switching back used to grey
  // out an Undo the server could still perform, stranding the user on a colour
  // they wanted to drop.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // A preview belongs to the culture it was rendered from; it must not linger
    // over another one.
    setPreview(null);
    setError(null);
    fetchColorState(jobId, style)
      .then((s) => {
        if (cancelled) return;
        setAvailability(s.targets);
        setCanUndo(s.canUndo);
      })
      .catch(() => {
        // Not fatal: apply still reports a missing surface, and the step-back
        // buttons stay as they were rather than lying in either direction.
        if (!cancelled) setAvailability(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, jobId, style]);

  const unavailable = useMemo(
    () => availability?.find((a) => a.target === target && !a.available),
    [availability, target],
  );

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        setError({ en: e.message_en, ar: e.message_ar });
      } else {
        setError({ en: "Could not change the colour.", ar: "تعذّر تغيير اللون." });
      }
    },
    [],
  );

  const run = useCallback(
    async (kind: Exclude<Busy, null>) => {
      setBusy(kind);
      setError(null);
      try {
        const body = { job_id: jobId, style, target, color };
        if (kind === "preview") {
          const r = await previewRecolor(body);
          setPreview(r.image);
        } else if (kind === "apply") {
          const r = await applyRecolor(body);
          setPreview(null);
          setCanUndo(true);
          onImageChange(r.image);
        } else if (kind === "undo") {
          // An unconfirmed preview is the most recent colour change *on screen*,
          // so that is what Undo has to take back first. Nothing was committed,
          // so dropping it is instant and needs no round trip. Only once the
          // screen shows a confirmed design does Undo step the server back.
          if (preview) {
            setPreview(null);
          } else {
            const r = await undoRecolor(jobId, style);
            setCanUndo(!!r.can_undo);
            onImageChange(r.image);
          }
        } else {
          // Reset drops the preview and every confirmed colour change, landing
          // back on the render as generated.
          setPreview(null);
          if (canUndo) {
            const r = await resetRecolor(jobId, style);
            setCanUndo(false);
            onImageChange(r.image);
          }
        }
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [jobId, style, target, color, preview, canUndo, onImageChange, fail],
  );

  const presets = PRESETS[target];
  const shown = preview ?? imageSrc;
  // There is something to go back to if a preview is on screen or the server
  // holds a confirmed change. Driving the buttons off `canUndo` alone left them
  // dead after a Preview, which is exactly when a user reaches for Undo.
  const canStepBack = canUndo || preview !== null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 text-sm text-cream-muted transition hover:text-gold",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        )}
      >
        <Paintbrush size={16} />
        {t("Change colour", "تغيير اللون")}
      </button>
    );
  }

  return (
    <section
      className="mt-6 w-full rounded-2xl border border-[var(--dd-gold-dim)]/30 bg-[var(--dd-surface)] p-5"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <header className={cn("mb-4 flex items-start justify-between gap-3")}>
        <div className={cn(isArabic ? "text-right" : "text-left")}>
          <h3
            className={cn(
              "text-lg font-semibold text-[var(--dd-gold)]",
              isArabic ? "font-arabic" : "font-display",
            )}
          >
            {t("Change colour", "تغيير اللون")}
          </h3>
          <p className="mt-1 text-sm text-[var(--dd-text-secondary)]">
            {t(
              "Repaint the wall or the floor. Shadows, lighting and texture are kept — only the colour changes.",
              "أعد طلاء الجدران أو الأرضية. تبقى الظلال والإضاءة والملمس كما هي — يتغيّر اللون فقط.",
            )}
          </p>
        </div>
        <button
          onClick={() => {
            setOpen(false);
            setPreview(null);
          }}
          aria-label={t("Close", "إغلاق")}
          className="shrink-0 rounded-lg border border-[var(--dd-gold-dim)]/40 p-1.5 text-[var(--dd-text-soft)] transition hover:border-[var(--dd-gold)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]"
        >
          {isArabic ? error.ar : error.en}
        </p>
      )}

      {/* The room can't be recoloured where it wasn't detected — say so before
          the user picks a colour, not after. */}
      {unavailable && (
        <p className="mb-4 rounded-lg border border-[var(--dd-gold-dim)]/40 bg-[var(--dd-surface-strong)] px-3 py-2 text-sm text-[var(--dd-text-soft)]">
          {target === "wall"
            ? t(
                "No wall was detected in this room — try the floor, or a photo showing more of the walls.",
                "لم يتم تحديد جدران في هذه الغرفة — جرّب الأرضية أو صورة تُظهر الجدران أكثر.",
              )
            : t(
                "No floor was detected in this room — try the wall, or a photo showing more of the floor.",
                "لم يتم تحديد أرضية في هذه الغرفة — جرّب الجدران أو صورة تُظهر الأرضية أكثر.",
              )}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---------- what it looks like ---------- */}
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown}
            alt={t("Room preview", "معاينة الغرفة")}
            className="block w-full rounded-xl border border-[var(--dd-gold-dim)]/25"
          />
          <p className="mt-2 text-xs text-[var(--dd-text-secondary)]">
            {preview
              ? t("Preview — not saved yet. Confirm to keep it.", "معاينة — لم تُحفظ بعد. أكّد للإبقاء عليها.")
              : t("Current design.", "التصميم الحالي.")}
          </p>
        </div>

        {/* ---------- controls ---------- */}
        <div>
          {/* surface */}
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--dd-text-secondary)]">
              {t("Area", "المنطقة")}
            </legend>
            <div className="flex gap-2">
              {(["wall", "floor"] as ColorTarget[]).map((k) => {
                const off = availability?.find((a) => a.target === k && !a.available);
                return (
                  <button
                    key={k}
                    onClick={() => {
                      setTarget(k);
                      setColor(PRESETS[k][0].hex);
                      setPreview(null);
                    }}
                    aria-pressed={target === k}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm transition",
                      target === k
                        ? "border-[var(--dd-gold)] bg-[var(--dd-surface-strong)] text-[var(--dd-gold)]"
                        : "border-[var(--dd-gold-dim)]/40 text-[var(--dd-text-soft)] hover:border-[var(--dd-gold)]",
                      isArabic && "font-arabic",
                      // Still selectable when unavailable: the explanation above
                      // is more useful than a dead button.
                      off && "opacity-60",
                    )}
                  >
                    {t(TARGET_LABEL[k].en, TARGET_LABEL[k].ar)}
                    {off && <span className="ms-1 text-xs">·</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* presets */}
          <fieldset className="mb-4">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--dd-text-secondary)]">
              {t("Presets", "ألوان جاهزة")}
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button
                  key={p.hex}
                  onClick={() => {
                    setColor(p.hex);
                    setPreview(null);
                  }}
                  title={t(p.en, p.ar)}
                  aria-label={t(p.en, p.ar)}
                  aria-pressed={color.toLowerCase() === p.hex.toLowerCase()}
                  className={cn(
                    "h-10 w-full rounded-lg border-2 transition",
                    color.toLowerCase() === p.hex.toLowerCase()
                      ? "border-[var(--dd-gold)]"
                      : "border-transparent hover:border-[var(--dd-gold-dim)]",
                  )}
                  style={{ background: p.hex }}
                />
              ))}
            </div>
          </fieldset>

          {/* free picker */}
          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--dd-text-secondary)]">
              {t("Custom colour", "لون مخصص")}
            </legend>
            <div className={cn("flex items-center gap-3", isArabic && "flex-row-reverse")}>
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setPreview(null);
                }}
                aria-label={t("Pick a colour", "اختر لوناً")}
                className="h-10 w-16 cursor-pointer rounded-lg border border-[var(--dd-gold-dim)]/40 bg-transparent p-1"
              />
              <span className="font-mono text-sm uppercase text-[var(--dd-text-soft)]" dir="ltr">
                {color}
              </span>
            </div>
          </fieldset>

          {/* actions */}
          <div className="flex flex-wrap gap-2">
            {/* Blocked up front when the surface isn't in the room: the notice
                above already explains it, and letting the request go would just
                repeat the same sentence back as an error. */}
            <button
              onClick={() => void run("preview")}
              disabled={busy !== null || !!unavailable}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--dd-gold)] disabled:opacity-50"
            >
              {busy === "preview" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {t("Preview", "معاينة")}
            </button>

            <button
              onClick={() => void run("apply")}
              disabled={busy !== null || !!unavailable}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--dd-gold)] px-4 py-1.5 text-sm font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "apply" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t("Confirm", "تأكيد")}
            </button>

            <button
              onClick={() => void run("undo")}
              disabled={busy !== null || !canStepBack}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--dd-gold)] disabled:opacity-40"
            >
              {busy === "undo" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5" />
              )}
              {t("Undo", "تراجع")}
            </button>

            <button
              onClick={() => void run("reset")}
              disabled={busy !== null || !canStepBack}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--dd-gold)] disabled:opacity-40"
            >
              {busy === "reset" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {t("Reset", "إعادة تعيين")}
            </button>
          </div>

          <p className="mt-3 text-xs text-[var(--dd-text-secondary)]">
            {t(
              "Confirmed colours become part of the design — press Save design to keep it in your history.",
              "تصبح الألوان المؤكّدة جزءاً من التصميم — اضغط «حفظ التصميم» للاحتفاظ به في سجلّك.",
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
