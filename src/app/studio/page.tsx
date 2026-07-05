"use client";

/* ============================================================
   Studio — the upload → loading → result flow.
   Keeps the shipped synchronous /redesign contract (all three
   styles in one call) but wears the dar-design-2 cinematic skin:
   a full-bleed dropzone with a 3D arch backdrop, a particle
   dissolve that assembles into an arch while we wait, and a
   before/after reveal slider. The FYP grid + Cultural Highlighter
   + 2D map are kept below (outside .cinema so their Tailwind
   styling is untouched).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import CinemaChrome from "@/components/cinema/CinemaChrome";
import ArchCanvas from "@/components/cinema/ArchCanvas";
import DissolveCanvas from "@/components/cinema/DissolveCanvas";
import DustLayer from "@/components/cinema/DustLayer";
import { MotifTiles } from "@/components/cinema/svg/MotifTiles";
import { useCinemaCopy } from "@/components/cinema/copy";
import CulturalElementHighlighter, { DEMO_REGIONS } from "@/components/CulturalElementHighlighter";
import RoomMap2D, { DEMO_MAP } from "@/components/RoomMap2D";
import CulturalNarration from "@/components/CulturalNarration";
import DepthOrbit from "@/components/DepthOrbit";
import StyleIntensitySlider from "@/components/StyleIntensitySlider";
import { useImage, type StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { DarAudio } from "@/lib/audio";
import { ApiError, redesignRoom, type RedesignResult } from "@/lib/api";
import { cn } from "@/lib/utils";

type Phase = "idle" | "loading" | "done" | "error";

const STYLE_ORDER: StyleId[] = ["lebanese", "khaleeji", "moroccan"];
const STYLE_MOTIF: Record<StyleId, string> = {
  lebanese: "qanater",
  khaleeji: "majlis",
  moroccan: "zellige",
};
const DISSOLVE_COLOR: Record<StyleId, number> = {
  lebanese: 0xf0d78c,
  khaleeji: 0xd4af37,
  moroccan: 0xf0d78c,
};

const TILES = [
  { key: "original", ar: "الأصلية", en: "Original", flag: "🏠" },
  { key: "lebanese", ar: "لبناني", en: "Lebanese", flag: "🇱🇧" },
  { key: "khaleeji", ar: "خليجي", en: "Khaleeji", flag: "🇸🇦" },
  { key: "moroccan", ar: "مغربي", en: "Moroccan", flag: "🇲🇦" },
] as const;

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

export default function StudioPage() {
  const { isArabic } = useThemeLanguage();
  const copy = useCinemaCopy();
  const { imageFile, imagePreviewUrl, setImage, clearImage } = useImage();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RedesignResult | null>(null);
  const [err, setErr] = useState<{ en: string; ar: string } | null>(null);
  const [featured, setFeatured] = useState<StyleId>("lebanese");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [comparePos, setComparePos] = useState(50);
  const [over, setOver] = useState(false);
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [showElements, setShowElements] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Reassuring elapsed timer during the ~1–2 min synchronous generation.
  useEffect(() => {
    if (phase !== "loading") {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Eased faux-progress: no real progress events exist on /redesign, so the
  // dissolve assembles asymptotically toward ~0.92, then snaps to 1 on resolve.
  useEffect(() => {
    if (phase !== "loading") return;
    const start = performance.now();
    const id = setInterval(() => {
      const el = (performance.now() - start) / 1000;
      const target = Math.min(0.92, 1 - Math.exp(-el / 40));
      setProgress((p) => (p >= 1 ? p : Math.max(p, target)));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // Abort any in-flight request if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const acceptFile = useCallback(
    async (f: File | undefined | null) => {
      setValidationErr(null);
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        setValidationErr(isArabic ? "يجب أن يكون الملف صورة" : "The file must be an image");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setValidationErr(isArabic ? "يجب أن يكون الحجم أقل من 10 ميغابايت" : "File must be under 10MB");
        return;
      }
      try {
        const { w, h } = await readDimensions(f);
        if (w < 256 || h < 256) {
          setValidationErr(isArabic ? "الصورة صغيرة جدًا (256×256 على الأقل)" : "Image too small (256×256 minimum)");
          return;
        }
      } catch {
        setValidationErr(isArabic ? "تعذّر قراءة الصورة" : "Could not read the image");
        return;
      }
      setImage(f);
    },
    [isArabic, setImage]
  );

  const runRedesign = useCallback(async () => {
    if (!imageFile) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setErr(null);
    setResult(null);
    setShowElements(false);
    setComparePos(50);
    setProgress(0);
    setPhase("loading");

    try {
      const r = await redesignRoom(imageFile, { timeoutMs: 240_000, signal: ctrl.signal });
      setResult(r);
      setProgress(1);
      DarAudio.chime();
      // brief hold so the assembled arch is felt before the reveal
      setTimeout(() => setPhase("done"), 900);
    } catch (e) {
      if (e instanceof ApiError && e.code === "aborted") return; // we cancelled it
      const fb_en = "Something went wrong. Please try again.";
      const fb_ar = "حدث خطأ، يرجى المحاولة مجدداً.";
      if (e instanceof ApiError) {
        setErr({ en: e.message_en || fb_en, ar: e.message_ar || fb_ar });
      } else {
        setErr({ en: fb_en, ar: fb_ar });
      }
      setPhase("error");
    }
  }, [imageFile]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    setResult(null);
    setErr(null);
    setShowElements(false);
    setProgress(0);
    clearImage();
    setPhase("idle");
  }, [clearImage]);

  const downloadTile = useCallback((dataUrl: string, key: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `dardesign-${key}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  // compare-slider drag
  const onCompareMove = useCallback((clientX: number) => {
    const el = compareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    setComparePos((x / rect.width) * 100);
  }, []);

  const tc = copy.transform;
  const lc = copy.loading;
  const rc = copy.result;

  // Week 2: /redesign now ships a backend-computed top-down object map,
  // on-image highlighter regions, and a depth PNG for the 3D orbit. Fall
  // back to the illustrative demo data for older backends that omit them.
  const backendMap = result?.object_map;
  const mapObjects = backendMap?.objects?.length ? backendMap.objects : DEMO_MAP;
  const hasRealMap = !!backendMap?.objects?.length && !backendMap.placeholder;
  const backendRegions = result?.seg_regions;
  const highlightRegions = backendRegions?.regions?.length ? backendRegions.regions : DEMO_REGIONS;
  const hasRealRegions = !!backendRegions?.regions?.length && !backendRegions.placeholder;

  const msgIdx = Math.min(lc.messages.length - 1, Math.floor(progress * lc.messages.length));
  const ringR = 90;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  // RTL-aware clip for the "after" image
  const clipAfter = isArabic
    ? `inset(0 0 0 ${100 - comparePos}%)`
    : `inset(0 ${100 - comparePos}% 0 0)`;

  return (
    <main className="relative min-h-screen" style={{ background: "var(--ink)" }}>
      <div className="cinema">
        <CinemaChrome onNavHome={startOver} />
      </div>

      {/* ---------- IDLE: cinematic upload + featured-style picker ---------- */}
      {phase === "idle" && (
        <div className="cinema">
          <section className="transform-scene">
            <div className="ambient-3d">
              <ArchCanvas
                opts={{
                  dustCount: 700,
                  cameraZStart: 9,
                  cameraZEnd: 8,
                  enableMashrabiya: true,
                  ambient: 0.4,
                  angle: -0.18,
                  archColor: DISSOLVE_COLOR[featured] === 0xd4af37 ? 0xd4af37 : featured === "moroccan" ? 0x1f4287 : 0xc9a876,
                  fogNear: 2,
                  fogFar: 12,
                }}
                resetKey={[featured]}
                fallbackOpacity={0.28}
              />
            </div>
            <DustLayer count={20} seed={9} />
            <div className="wrap">
              <div className="lead">
                <div className="eyebrow">{tc.eyebrow}</div>
                <h1>
                  {tc.title.map((w, i) => (
                    <span key={i} className={i === tc.italicIdx ? "italic" : ""}>
                      {w}
                      {i < tc.title.length - 1 ? " " : ""}
                    </span>
                  ))}
                </h1>
                <p>{tc.sub}</p>
              </div>

              <div className="stage">
                {/* DROPZONE */}
                <div
                  className={"dropzone " + (over ? "over" : "")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    void acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  onClick={() => !imagePreviewUrl && inputRef.current?.click()}
                >
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => void acceptFile(e.target.files?.[0])}
                  />
                  {!imagePreviewUrl && (
                    <div>
                      <div className="icon">
                        <svg viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <rect x="14" y="22" width="68" height="50" stroke="currentColor" />
                          <circle cx="48" cy="47" r="14" />
                          <circle cx="48" cy="47" r="6" />
                          <path d="M30 22 L36 14 L60 14 L66 22" />
                          <line x1="20" y1="30" x2="26" y2="30" />
                        </svg>
                      </div>
                      <h3 className="prompt">{tc.dropPrompt}</h3>
                      <div className="sub">{tc.dropClick}</div>
                      <div className="formats">{tc.formats}</div>
                      <div className="formats" style={{ marginTop: 6, opacity: 0.75 }}>
                        {isArabic
                          ? "صورك تُحذف تلقائيًا بعد ٢٤ ساعة ما لم تحفظها."
                          : "Your photos are automatically deleted after 24 hours unless you save them."}
                      </div>
                      {validationErr && (
                        <div style={{ marginTop: "var(--s-4)", color: "var(--error)", fontSize: "0.85rem" }}>
                          {validationErr}
                        </div>
                      )}
                    </div>
                  )}
                  {imagePreviewUrl && (
                    <div className="preview" style={{ backgroundImage: `url(${imagePreviewUrl})` }}>
                      <div className="scrim" />
                      <button
                        className="remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearImage();
                        }}
                      >
                        {tc.remove} ✕
                      </button>
                      <div className="filename">
                        {tc.filenamePrefix} · {imageFile?.name}
                      </div>
                    </div>
                  )}
                </div>

                {/* FEATURED-STYLE PICKER (all three are generated; this picks the reveal lead) */}
                <div className="styles-picker">
                  <div className="label">{tc.pickLabel}</div>
                  {STYLE_ORDER.map((id) => {
                    const Motif = MotifTiles[STYLE_MOTIF[id] as keyof typeof MotifTiles];
                    return (
                      <button
                        key={id}
                        className={"style-card " + (featured === id ? "selected" : "")}
                        onClick={() => setFeatured(id)}
                      >
                        <div className="motif">{Motif ? <Motif /> : null}</div>
                        <div>
                          <h3 className="name">{tc.styles[id].name}</h3>
                          <p className="desc">{tc.styles[id].desc}</p>
                        </div>
                        <div className="check">{featured === id ? "✓" : ""}</div>
                      </button>
                    );
                  })}

                  <div className="transform-cta">
                    <button
                      className={"btn " + (imageFile ? "" : "ghost")}
                      onClick={runRedesign}
                      disabled={!imageFile}
                      style={!imageFile ? { opacity: 0.55, cursor: "not-allowed" } : {}}
                    >
                      <span>{imageFile ? tc.ctaReady : tc.ctaWaitingImage}</span>
                      <span className="arrow">→</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ---------- LOADING: particle dissolve assembling the arch ---------- */}
      {phase === "loading" && (
        <div className="cinema">
          <section className="loading-scene" role="status" aria-live="polite">
            <div className="canvas">
              <DissolveCanvas progress={progress} count={4500} color={DISSOLVE_COLOR[featured]} />
            </div>
            <DustLayer count={26} seed={17} />
            <div className="core">
              <div className="ring-wrap">
                <svg viewBox="0 0 200 200">
                  <circle className="ring-bg" cx="100" cy="100" r={ringR} />
                  <circle
                    className="ring-fg"
                    cx="100"
                    cy="100"
                    r={ringR}
                    strokeDasharray={ringC}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div className="ring-pct">
                  <span className="pct-num">{Math.round(progress * 100)}</span>
                  <span className="pct">%</span>
                </div>
              </div>
              <div className="step-label">{lc.pretitle}</div>
              <h2 key={msgIdx}>{lc.messages[msgIdx]}</h2>
              <div className="mono" style={{ marginTop: "var(--s-3)", opacity: 0.6 }}>
                {mmss(elapsed)}
              </div>
            </div>
            <div className="footer-meta">{lc.meta}</div>
          </section>
        </div>
      )}

      {/* ---------- ERROR ---------- */}
      {phase === "error" && err && (
        <div className="cinema">
          <section className="error-scene">
            <DustLayer count={18} seed={29} />
            <div>
              <div className="code">{copy.error.code}</div>
              <h1>
                {copy.error.title.map((w, i) => (
                  <span key={i} className={i === copy.error.italicIdx ? "italic" : ""}>
                    {w}
                    {i < copy.error.title.length - 1 ? " " : ""}
                  </span>
                ))}
              </h1>
              <p>{isArabic ? err.ar : err.en}</p>
              <div style={{ display: "flex", gap: "var(--s-4)", justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn" onClick={runRedesign}>
                  <span>{copy.error.cta}</span>
                  <span className="arrow">↻</span>
                </button>
                <button className="btn ghost" onClick={startOver}>
                  <span>{copy.error.home}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ---------- DONE: cinematic reveal + compare, then the FYP grid ---------- */}
      {phase === "done" && result && (
        <>
          <div className="cinema">
            <section className="result-scene">
              <div className="reveal-stage">
                <div className="canvas">
                  <ArchCanvas
                    opts={{ dustCount: 900, cameraZStart: 7, cameraZEnd: 6.4, enableMashrabiya: true, ambient: 0.6 }}
                    fallbackOpacity={0.35}
                  />
                </div>
                <DustLayer count={26} seed={21} />
                <div className="label">
                  <div className="eyebrow">{rc.eyebrow}</div>
                  <h1>
                    {rc.title.map((w, i) => (
                      <span key={i} className={i === rc.italicIdx ? "italic" : ""}>
                        {w}
                        {i < rc.title.length - 1 ? " " : ""}
                      </span>
                    ))}
                  </h1>
                </div>
              </div>

              {/* culture toggle for the reveal lead */}
              <div
                style={{
                  display: "flex",
                  gap: "var(--s-3)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  marginTop: "var(--s-5)",
                }}
              >
                {STYLE_ORDER.map((id) => (
                  <button
                    key={id}
                    onClick={() => setFeatured(id)}
                    className="mono"
                    style={{
                      padding: "8px 18px",
                      borderRadius: "var(--r-pill)",
                      border: `1px solid ${featured === id ? "var(--brass)" : "var(--hairline-2)"}`,
                      background: featured === id ? "var(--brass-wash)" : "transparent",
                      color: featured === id ? "var(--brass-bright)" : "var(--fg-mute)",
                    }}
                  >
                    {tc.styles[id].name}
                  </button>
                ))}
              </div>

              <div style={{ padding: "var(--s-7) 0", position: "relative" }}>
                <div
                  className="compare"
                  ref={compareRef}
                  onMouseDown={(e) => {
                    dragging.current = true;
                    onCompareMove(e.clientX);
                  }}
                  onMouseMove={(e) => dragging.current && onCompareMove(e.clientX)}
                  onMouseUp={() => (dragging.current = false)}
                  onMouseLeave={() => (dragging.current = false)}
                  onTouchStart={(e) => {
                    dragging.current = true;
                    onCompareMove(e.touches[0].clientX);
                  }}
                  onTouchMove={(e) => onCompareMove(e.touches[0].clientX)}
                  onTouchEnd={() => (dragging.current = false)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.original} alt={rc.before} />
                  <div className="after-wrap" style={{ clipPath: clipAfter }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result[featured]} alt={rc.after} />
                  </div>
                  <span className="lbl before">{rc.before}</span>
                  <span className="lbl after">{rc.after}</span>
                  <div className="handle" style={{ left: `${comparePos}%` }}>
                    <div className="knob">{"⇄"}</div>
                  </div>
                </div>
              </div>

              <div className="actions">
                <button className="btn" onClick={() => downloadTile(result[featured], featured)}>
                  <span>{rc.download}</span>
                  <span className="arrow">↓</span>
                </button>
                <button className="btn ghost" onClick={startOver}>
                  <span>{rc.again}</span>
                </button>
              </div>
            </section>
          </div>

          {/* ----- FYP: full grid + Cultural Highlighter + 2D map (outside .cinema) ----- */}
          <section className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
            <div className="mb-6 flex items-center justify-between">
              <h2 className={cn("text-lg font-semibold text-cream", isArabic ? "font-arabic" : "font-display")}>
                {isArabic ? "كل البيوت الثلاثة" : "All three houses"}
              </h2>
              <button
                onClick={startOver}
                className={cn(
                  "flex items-center gap-2 text-sm text-cream-muted transition hover:text-gold",
                  isArabic ? "font-arabic flex-row-reverse" : "font-ui"
                )}
              >
                <RotateCcw size={16} />
                {isArabic ? "غرفة جديدة" : "New room"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {TILES.map((t) => {
                const src = result[t.key];
                return (
                  <figure
                    key={t.key}
                    className="group overflow-hidden rounded-2xl border border-gold/20 bg-[var(--dd-surface)] transition-colors duration-300 hover:border-gold/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={isArabic ? t.ar : t.en} className="block aspect-[4/3] w-full object-cover" />
                    <figcaption
                      className={cn("flex items-center justify-between gap-2 px-4 py-3", isArabic && "flex-row-reverse")}
                    >
                      <span className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
                        <span>{t.flag}</span>
                        <span className={cn("text-sm font-medium text-cream-soft", isArabic && "font-arabic")}>{t.ar}</span>
                        <span className="font-ui text-xs text-cream-muted">{t.en}</span>
                      </span>
                      <button
                        onClick={() => downloadTile(src, t.key)}
                        aria-label={isArabic ? `تنزيل التصميم ${t.ar}` : `Download ${t.en} design`}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border border-gold px-3 py-1.5 text-xs font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
                          isArabic ? "font-arabic flex-row-reverse" : "font-ui"
                        )}
                      >
                        <Download size={14} />
                        {isArabic ? "تنزيل" : "Download"}
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>

            {/* Cultural elements + 2D layout — scaffold preview (sample data). */}
            <div className="mt-12 border-t border-gold/15 pt-8">
              <div className={cn("mb-4 flex items-center justify-between gap-3", isArabic && "flex-row-reverse")}>
                <div className={cn(isArabic ? "text-right" : "text-left")}>
                  <h2 className={cn("text-lg font-semibold text-cream", isArabic ? "font-arabic" : "font-display")}>
                    {isArabic ? "العناصر الثقافية والمخطط" : "Cultural elements & layout"}
                    <span className="ms-2 align-middle text-xs text-cream-muted">
                      {hasRealRegions && hasRealMap ? (isArabic ? "(حيّ)" : "(live)") : isArabic ? "(تجريبي)" : "(preview)"}
                    </span>
                  </h2>
                  <p className={cn("mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>
                    {isArabic
                      ? hasRealRegions && hasRealMap
                        ? "التظليل والمخطط محسوبان من الخادم لغرفتك (عمق + تجزئة). اضغط أي عنصر."
                        : hasRealMap
                          ? "التظليل على الصورة تجريبي؛ المخطط العلوي محسوب من الخادم (عمق + تجزئة). اضغط أي عنصر."
                          : "عناصر ومخطط تجريبيان — الخادم لم يُرجع خريطة التجزئة والإسقاط. اضغط أي عنصر."
                      : hasRealRegions && hasRealMap
                        ? "Highlights & top-down map are computed by the backend for your room (depth + segmentation). Click any element."
                        : hasRealMap
                          ? "Highlight regions are samples; the top-down map is computed by the backend (depth + segmentation). Click any element."
                          : "Sample regions + top-down map — the backend did not return segmentation & projection data. Click any element."}
                  </p>
                </div>
                <button
                  onClick={() => setShowElements((v) => !v)}
                  className={cn(
                    "shrink-0 rounded-lg border border-cream-muted px-3 py-1.5 text-xs text-cream-muted transition hover:border-gold hover:text-gold",
                    isArabic ? "font-arabic" : "font-ui"
                  )}
                  aria-pressed={showElements}
                >
                  {showElements ? (isArabic ? "إخفاء" : "Hide") : isArabic ? "إظهار العناصر" : "Show elements"}
                </button>
              </div>

              {showElements && (
                <>
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div>
                      <p className={cn("mb-2 text-xs font-medium text-cream-soft", isArabic && "font-arabic")}>
                        {isArabic ? "التظليل على الصورة" : "On-image highlight"}
                      </p>
                      <CulturalElementHighlighter
                        imageSrc={result.original}
                        regions={highlightRegions}
                        alt={isArabic ? "تحليل العناصر الثقافية" : "Cultural element analysis"}
                      />
                    </div>
                    <div>
                      <p className={cn("mb-2 text-xs font-medium text-cream-soft", isArabic && "font-arabic")}>
                        {isArabic ? "المخطط العلوي ثنائي الأبعاد" : "2D top-down map"}
                      </p>
                      <RoomMap2D objects={mapObjects} />
                    </div>
                  </div>
                  {/* The Understood Room, layer 3: orbit the redesigned room in 3D.
                      Depth comes from the input photo; structure is preserved by
                      the ControlNets, so it displaces the styled image cleanly. */}
                  {result.depth_map && (
                    <div className="mt-6">
                      <p className={cn("mb-2 text-xs font-medium text-cream-soft", isArabic && "font-arabic")}>
                        {isArabic
                          ? `الجولة ثلاثية الأبعاد — ${TILES.find((t) => t.key === featured)?.ar ?? ""} (اسحب للدوران)`
                          : `3D room view — ${TILES.find((t) => t.key === featured)?.en ?? ""} (drag to orbit)`}
                      </p>
                      <DepthOrbit imageUrl={result[featured]} depthUrl={result.depth_map} />
                    </div>
                  )}

                  <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div>
                      <p className={cn("mb-2 text-xs font-medium text-cream-soft", isArabic && "font-arabic")}>
                        {isArabic ? "السرد الثقافي الصوتي (يتحدّث عربيّاً)" : "Bilingual cultural narration (it speaks)"}
                      </p>
                      <CulturalNarration />
                    </div>
                    <div>
                      <p className={cn("mb-2 text-xs font-medium text-cream-soft", isArabic && "font-arabic")}>
                        {isArabic ? "شدّة الطراز (الاستئصال حيّاً)" : "Style intensity (the ablation, live)"}
                      </p>
                      <StyleIntensitySlider />
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
