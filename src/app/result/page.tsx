"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, RotateCcw, Share2, Sparkles } from "lucide-react";
import BeforeAfterSlider from "@/components/before-after-slider";
import ErrorBanner from "@/components/error-banner";
import IslamicPattern from "@/components/islamic-pattern";
import LoadingScreen from "@/components/loading-screen";
import ShareDialog from "@/components/share-dialog";
import { useImage, type StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  fetchResultBlob,
  mintShareToken,
  pollStatus,
  retryJob,
  shareLink,
  type JobStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STYLE_OPTIONS: StyleId[] = ["lebanese", "khaleeji", "moroccan"];

function ResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { copy, isArabic } = useThemeLanguage();
  const { imagePreviewUrl, resultImageUrl, setResultImageUrl, jobId, setJobId, reset } = useImage();

  const queryJobId = searchParams.get("jobId");
  const queryStyle = (searchParams.get("style") || "lebanese") as StyleId;
  const activeJobId = queryJobId || jobId;

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [err, setErr] = useState<{ en: string; ar: string } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Sync URL jobId into context if user landed via share link
  useEffect(() => {
    if (queryJobId && queryJobId !== jobId) {
      setJobId(queryJobId);
    }
  }, [queryJobId, jobId, setJobId]);

  const styleCopy = copy.shared.styles[queryStyle] ?? copy.shared.styles.lebanese;

  const startPolling = useCallback(
    async (jid: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setErr(null);
      try {
        const final = await pollStatus(jid, {
          intervalMs: 1500,
          timeoutMs: 5 * 60_000,
          signal: ctrl.signal,
          onUpdate: (s) => setStatus(s),
        });
        if (final.status === "error") {
          setErr({
            en: final.error_message_en || "Generation failed",
            ar: final.error_message_ar || "فشلت عملية التوليد",
          });
          return;
        }
        const blobUrl = await fetchResultBlob(jid);
        setResultImageUrl(blobUrl);
      } catch (e) {
        if (e instanceof ApiError) {
          setErr({
            en: e.message_en,
            ar: e.message_ar,
          });
        } else {
          setErr({
            en: "Unexpected error",
            ar: "خطأ غير متوقع",
          });
        }
      }
    },
    [setResultImageUrl],
  );

  // Kick off polling when we have a job ID and no result yet
  useEffect(() => {
    if (activeJobId && !resultImageUrl && !err) {
      startPolling(activeJobId);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId]);

  const handleDownload = async () => {
    if (!resultImageUrl) return;
    try {
      const link = document.createElement("a");
      link.href = resultImageUrl;
      link.download = `dardesign-${queryStyle}.png`;
      link.click();
    } catch {
      // best-effort; downloads from object URLs are local-only
    }
  };

  const handleShare = async () => {
    if (!activeJobId) return;
    try {
      const t = await mintShareToken(activeJobId);
      setShareUrl(shareLink(t.token));
      setShareOpen(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr({ en: e.message_en, ar: e.message_ar });
      }
    }
  };

  const handleRetry = useCallback(() => {
    if (!activeJobId) return;
    setErr(null);
    setStatus(null);
    startPolling(activeJobId);
  }, [activeJobId, startPolling]);

  const handleNewRoom = () => {
    abortRef.current?.abort();
    reset();
    router.push("/transform");
  };

  const handleSwapStyle = async (next: StyleId) => {
    if (!activeJobId || next === queryStyle) return;
    abortRef.current?.abort();
    setStatus(null);
    setErr(null);
    setResultImageUrl("");
    try {
      await retryJob(activeJobId, next);
      router.replace(`/result?jobId=${activeJobId}&style=${next}`);
      startPolling(activeJobId);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr({ en: e.message_en, ar: e.message_ar });
      }
    }
  };

  // ---- render branches ----

  if (!activeJobId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-charcoal px-4">
        <div className="max-w-md">
          <ErrorBanner
            message_en="No active job. Please upload a room photo first."
            message_ar="لا توجد مهمة نشطة. يرجى رفع صورة الغرفة أولاً."
            onRetry={() => router.push("/transform")}
            retryLabelEn="Upload"
            retryLabelAr="رفع صورة"
          />
        </div>
      </main>
    );
  }

  if (err) {
    return (
      <main className="relative flex min-h-screen items-center justify-center bg-charcoal px-4 noise-overlay">
        <IslamicPattern opacity={0.02} />
        <div className="relative z-10 max-w-md">
          <ErrorBanner
            message_en={err.en}
            message_ar={err.ar}
            onRetry={handleRetry}
          />
          <div className="mt-4 text-center">
            <button
              onClick={handleNewRoom}
              className={cn(
                "text-sm text-cream-muted underline transition hover:text-cream",
                isArabic ? "font-arabic" : "font-ui",
              )}
            >
              {isArabic ? "ابدأ من جديد" : "Start over"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!resultImageUrl) {
    const pct = status?.progress;
    const msg = status
      ? status.status === "queued"
        ? isArabic ? "في قائمة الانتظار..." : "Queued..."
        : status.status === "running"
          ? undefined
          : status.status === "pending"
            ? isArabic ? "جارٍ التحضير..." : "Preparing..."
            : undefined
      : undefined;
    return <LoadingScreen progress={pct} messageOverride={msg} />;
  }

  const beforeSrc = imagePreviewUrl ?? resultImageUrl;
  const afterSrc = resultImageUrl;

  return (
    <main className="relative min-h-screen bg-charcoal noise-overlay">
      <IslamicPattern opacity={0.02} />

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-12">
        <div className="mb-12 flex items-center justify-between">
          <Link href="/" className="transition-colors duration-300 hover:opacity-80">
            <span className="font-display text-xl font-semibold tracking-[0.14em] text-[var(--dd-text)]">
              <span className="text-gold">D</span>ar
              <span className="text-gold">D</span>esign
            </span>
          </Link>
        </div>

        <div className="mb-10 text-center animate-fade-in-up">
          <h1
            className={cn(
              "mb-3 text-3xl font-semibold text-gold md:text-4xl",
              isArabic ? "font-arabic" : "font-display",
            )}
          >
            {copy.result.title}
          </h1>
          <p className={cn("text-lg text-cream-muted", isArabic && "font-arabic")}>
            <span className="me-2">{styleCopy.flag}</span>
            {styleCopy.name}
          </p>
        </div>

        <div className="animate-fade-in-up-d2">
          <BeforeAfterSlider
            beforeSrc={beforeSrc}
            afterSrc={afterSrc}
            beforeLabel={copy.result.beforeLabel}
            afterLabel={copy.result.afterLabel}
          />
        </div>

        {/* Try-another-style quick-rerun strip */}
        <div
          className={cn(
            "mt-8 flex flex-col items-center gap-3 animate-fade-in-up-d2",
            isArabic && "font-arabic",
          )}
        >
          <p className="flex items-center gap-2 text-sm text-cream-muted">
            <Sparkles size={14} className="text-gold" />
            {isArabic ? "جرّب نمطاً آخر على الصورة نفسها" : "Try another style on the same room"}
          </p>
          <div className={cn("flex gap-2", isArabic && "flex-row-reverse")}>
            {STYLE_OPTIONS.map((s) => {
              const sc = copy.shared.styles[s];
              const active = s === queryStyle;
              return (
                <button
                  key={s}
                  onClick={() => handleSwapStyle(s)}
                  disabled={active}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all duration-300",
                    active
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-cream-muted text-cream-muted hover:border-gold hover:text-gold",
                  )}
                >
                  <span>{sc.flag}</span>
                  {sc.name}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={cn(
            "mt-10 flex flex-col items-center justify-center gap-4 animate-fade-in-up-d3 sm:flex-row",
            isArabic && "sm:flex-row-reverse",
          )}
        >
          <button
            onClick={handleDownload}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 border-gold px-6 py-3 font-semibold text-gold transition-all duration-300 hover:scale-[1.02] hover:bg-gold hover:text-[var(--dd-ink)]",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            <Download size={18} />
            {copy.result.download}
          </button>

          <button
            onClick={handleShare}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 border-gold px-6 py-3 font-semibold text-gold transition-all duration-300 hover:scale-[1.02] hover:bg-gold hover:text-[var(--dd-ink)]",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            <Share2 size={18} />
            {isArabic ? "مشاركة" : "Share"}
          </button>

          <button
            onClick={handleNewRoom}
            className={cn(
              "flex items-center gap-2 rounded-xl border-2 border-cream-muted px-6 py-3 font-semibold text-cream-muted transition-all duration-300 hover:scale-[1.02] hover:border-cream hover:text-cream",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            <RotateCcw size={18} />
            {copy.result.newRoom}
          </button>
        </div>
      </div>

      <ShareDialog
        url={shareUrl}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </main>
  );
}

export default function ResultPage() {
  const { copy, isArabic } = useThemeLanguage();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-charcoal">
          <div
            className={cn(
              "text-lg text-cream-muted",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            {copy.result.loadingFallback}
          </div>
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
