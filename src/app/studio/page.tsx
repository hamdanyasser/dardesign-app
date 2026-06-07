"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, RotateCcw, Sparkles } from "lucide-react";
import ErrorBanner from "@/components/error-banner";
import GoldButton from "@/components/gold-button";
import IslamicPattern from "@/components/islamic-pattern";
import UploadZone from "@/components/upload-zone";
import CulturalElementHighlighter, { DEMO_REGIONS } from "@/components/CulturalElementHighlighter";
import { useImage } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, redesignRoom, type RedesignResult } from "@/lib/api";
import { cn } from "@/lib/utils";

type Phase = "idle" | "loading" | "done" | "error";

/**
 * Result tiles, in display order. Always labelled in Arabic + English so the
 * grid reads the same regardless of the active UI language.
 */
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

export default function StudioPage() {
  const { isArabic } = useThemeLanguage();
  const { imageFile, imagePreviewUrl, setImage, clearImage } = useImage();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RedesignResult | null>(null);
  const [err, setErr] = useState<{ en: string; ar: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showElements, setShowElements] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Reassuring elapsed timer during the ~1–2 min synchronous generation.
  useEffect(() => {
    if (phase !== "loading") {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Abort any in-flight request if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const runRedesign = useCallback(async () => {
    if (!imageFile) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setErr(null);
    setResult(null);
    setShowElements(false);
    setPhase("loading");

    try {
      const r = await redesignRoom(imageFile, { timeoutMs: 240_000, signal: ctrl.signal });
      setResult(r);
      setPhase("done");
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

  return (
    <main className="relative min-h-screen bg-charcoal noise-overlay">
      <IslamicPattern opacity={0.02} />

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-10 md:py-12">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="transition-colors duration-300 hover:opacity-80">
            <span className="font-display text-xl font-semibold tracking-[0.14em] text-[var(--dd-text)]">
              <span className="text-gold">D</span>ar<span className="text-gold">D</span>esign
            </span>
          </Link>
          {(phase === "done" || phase === "error") && (
            <button
              onClick={startOver}
              className={cn(
                "flex items-center gap-2 text-sm text-cream-muted transition hover:text-gold",
                isArabic ? "font-arabic flex-row-reverse" : "font-ui",
              )}
            >
              <RotateCcw size={16} />
              {isArabic ? "غرفة جديدة" : "New room"}
            </button>
          )}
        </div>

        {/* Title */}
        <header className="mb-10 text-center">
          <h1
            className={cn(
              "mb-3 text-3xl font-semibold text-cream md:text-4xl",
              isArabic ? "font-arabic" : "font-display",
            )}
          >
            {isArabic ? "استوديو التصميم" : "Design Studio"}
          </h1>
          <p className={cn("mx-auto max-w-xl text-cream-muted", isArabic && "font-arabic")}>
            {isArabic
              ? "ارفع صورة غرفتك لتحصل على ثلاث إعادات تصميم بطابع لبناني وخليجي ومغربي."
              : "Upload your room and get three redesigns — Lebanese, Khaleeji, and Moroccan."}
          </p>
        </header>

        {/* IDLE — upload + submit */}
        {phase === "idle" && (
          <section className="animate-fade-in-up">
            <UploadZone onImageSelect={setImage} imagePreviewUrl={imagePreviewUrl} onRemove={clearImage} />

            <div className="mt-10 text-center">
              <GoldButton disabled={!imageFile} onClick={runRedesign}>
                ✦ {isArabic ? "صمّم غرفتي" : "Redesign my room"}
              </GoldButton>
              {!imageFile && (
                <p className={cn("mt-4 text-sm text-cream-muted", isArabic && "font-arabic")}>
                  {isArabic ? "ارفع صورة غرفة لتبدأ" : "Upload a room photo to begin"}
                </p>
              )}
            </div>
          </section>
        )}

        {/* LOADING — original + skeleton tiles */}
        {phase === "loading" && (
          <section className="animate-fade-in-up">
            <div className="mb-8 flex flex-col items-center text-center">
              <Loader2 size={28} className="mb-3 animate-spin text-gold" />
              <p className={cn("text-lg font-semibold text-cream", isArabic ? "font-arabic" : "font-display")}>
                {isArabic ? "جارٍ التصميم…" : "Designing…"}
              </p>
              <p className={cn("mt-1 text-sm text-cream-muted", isArabic && "font-arabic")}>
                {isArabic ? "قد يستغرق ذلك دقيقة إلى دقيقتين" : "This can take a minute or two"}
              </p>
              <p className="mt-1 font-ui text-xs tabular-nums text-cream-muted" aria-live="polite">
                {mmss(elapsed)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {TILES.map((t, i) => (
                <div
                  key={t.key}
                  className="overflow-hidden rounded-2xl border border-gold/20 bg-[var(--dd-surface)]"
                >
                  {t.key === "original" && imagePreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagePreviewUrl} alt="" className="block aspect-[4/3] w-full object-cover opacity-90" />
                  ) : (
                    <div className="dd-skeleton flex aspect-[4/3] w-full items-center justify-center">
                      <Sparkles
                        size={26}
                        className="text-gold/40"
                        style={{ animationDelay: `${i * 120}ms` }}
                      />
                    </div>
                  )}
                  <div className={cn("flex items-center gap-2 px-4 py-3", isArabic && "flex-row-reverse")}>
                    <span>{t.flag}</span>
                    <span className={cn("text-sm text-cream-soft", isArabic && "font-arabic")}>{t.ar}</span>
                    <span className="font-ui text-xs text-cream-muted">{t.en}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ERROR */}
        {phase === "error" && err && (
          <section className="mx-auto max-w-md animate-fade-in-up">
            <ErrorBanner message_en={err.en} message_ar={err.ar} onRetry={runRedesign} />
            <div className="mt-4 text-center">
              <button
                onClick={startOver}
                className={cn(
                  "text-sm text-cream-muted underline transition hover:text-cream",
                  isArabic ? "font-arabic" : "font-ui",
                )}
              >
                {isArabic ? "ابدأ من جديد" : "Start over"}
              </button>
            </div>
          </section>
        )}

        {/* DONE — result grid */}
        {phase === "done" && result && (
          <section className="animate-fade-in-up">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {TILES.map((t) => {
                const src = result[t.key as keyof RedesignResult];
                return (
                  <figure
                    key={t.key}
                    className="group overflow-hidden rounded-2xl border border-gold/20 bg-[var(--dd-surface)] transition-colors duration-300 hover:border-gold/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={isArabic ? t.ar : t.en} className="block aspect-[4/3] w-full object-cover" />
                    <figcaption
                      className={cn(
                        "flex items-center justify-between gap-2 px-4 py-3",
                        isArabic && "flex-row-reverse",
                      )}
                    >
                      <span className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
                        <span>{t.flag}</span>
                        <span className={cn("text-sm font-medium text-cream-soft", isArabic && "font-arabic")}>
                          {t.ar}
                        </span>
                        <span className="font-ui text-xs text-cream-muted">{t.en}</span>
                      </span>
                      <button
                        onClick={() => downloadTile(src, t.key)}
                        aria-label={
                          isArabic ? `تنزيل التصميم ${t.ar}` : `Download ${t.en} design`
                        }
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border border-gold px-3 py-1.5 text-xs font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
                          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
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

            {/* CulturalElementHighlighter — scaffold preview (sample regions). */}
            <div className="mt-12 border-t border-gold/15 pt-8">
              <div className={cn("mb-4 flex items-center justify-between gap-3", isArabic && "flex-row-reverse")}>
                <div className={cn(isArabic ? "text-right" : "text-left")}>
                  <h2 className={cn("text-lg font-semibold text-cream", isArabic ? "font-arabic" : "font-display")}>
                    {isArabic ? "العناصر الثقافية" : "Cultural elements"}
                    <span className="ms-2 align-middle text-xs text-cream-muted">
                      {isArabic ? "(تجريبي)" : "(preview)"}
                    </span>
                  </h2>
                  <p className={cn("mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>
                    {isArabic
                      ? "مناطق تجريبية — ستتصل بخريطة التجزئة من الخادم لاحقاً. اضغط أي عنصر."
                      : "Sample regions — will connect to the backend segmentation map later. Click any element."}
                  </p>
                </div>
                <button
                  onClick={() => setShowElements((v) => !v)}
                  className={cn(
                    "shrink-0 rounded-lg border border-cream-muted px-3 py-1.5 text-xs text-cream-muted transition hover:border-gold hover:text-gold",
                    isArabic ? "font-arabic" : "font-ui",
                  )}
                  aria-pressed={showElements}
                >
                  {showElements
                    ? isArabic
                      ? "إخفاء"
                      : "Hide"
                    : isArabic
                      ? "إظهار العناصر"
                      : "Show elements"}
                </button>
              </div>

              {showElements && (
                <div className="mx-auto max-w-2xl">
                  <CulturalElementHighlighter
                    imageSrc={result.original}
                    regions={DEMO_REGIONS}
                    alt={isArabic ? "تحليل العناصر الثقافية" : "Cultural element analysis"}
                  />
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
