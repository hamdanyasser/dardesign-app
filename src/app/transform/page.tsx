"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import ErrorBanner from "@/components/error-banner";
import GoldButton from "@/components/gold-button";
import IslamicPattern from "@/components/islamic-pattern";
import StyleSelector from "@/components/style-selector";
import UploadZone from "@/components/upload-zone";
import { useImage, type StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, startTransform, uploadImage } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function TransformPage() {
  const router = useRouter();
  const { copy, isArabic } = useThemeLanguage();
  const {
    imageFile,
    imagePreviewUrl,
    selectedStyle,
    setImage,
    clearImage,
    setSelectedStyle,
    setJobId,
  } = useImage();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [err, setErr] = useState<{ en: string; ar: string } | null>(null);

  const canSubmit = imageFile !== null && selectedStyle !== null;

  const handleTransform = async () => {
    if (!canSubmit || !imageFile || !selectedStyle) return;
    setIsSubmitting(true);
    setErr(null);

    try {
      const upload = await uploadImage(imageFile);
      await startTransform(upload.job_id, selectedStyle as StyleId);
      setJobId(upload.job_id);
      router.push(`/result?jobId=${upload.job_id}&style=${selectedStyle}`);
    } catch (e) {
      const fallback_en = "Something went wrong. Please try again.";
      const fallback_ar = "حدث خطأ، يرجى المحاولة مجدداً.";
      if (e instanceof ApiError) {
        setErr({ en: e.message_en || fallback_en, ar: e.message_ar || fallback_ar });
      } else {
        setErr({ en: fallback_en, ar: fallback_ar });
      }
      setIsSubmitting(false);
    }
  };

  const helperText = !imageFile && !selectedStyle
    ? copy.transform.incompleteBoth
    : !imageFile
    ? copy.transform.incompleteImage
    : copy.transform.incompleteStyle;

  return (
    <main className="relative min-h-screen bg-charcoal noise-overlay">
      <IslamicPattern opacity={0.02} />

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-12">
        <div className="mb-12 flex items-center justify-between">
          <Link href="/" className="transition-colors duration-300 hover:opacity-80">
            <span className="font-display text-xl font-semibold tracking-[0.14em] text-[var(--dd-text)]">
              <span className="text-gold">D</span>ar
              <span className="text-gold">D</span>esign
            </span>
          </Link>
        </div>

        <h1
          className={cn(
            "mb-10 text-2xl font-semibold text-cream md:text-3xl",
            isArabic ? "font-arabic text-right" : "font-display text-left",
          )}
        >
          {copy.transform.title}
        </h1>

        <section className="mb-16">
          <UploadZone
            onImageSelect={setImage}
            imagePreviewUrl={imagePreviewUrl}
            onRemove={clearImage}
          />
        </section>

        <section className="mb-16">
          <StyleSelector
            selectedStyle={selectedStyle}
            onStyleSelect={(style) => setSelectedStyle(style as StyleId)}
          />
        </section>

        <div className="text-center">
          <GoldButton disabled={!canSubmit || isSubmitting} onClick={handleTransform}>
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                {isArabic ? "جارٍ التحويل..." : "Transforming..."}
              </span>
            ) : (
              <>✦ {copy.transform.cta}</>
            )}
          </GoldButton>

          {err && (
            <div className="mx-auto mt-4 max-w-md">
              <ErrorBanner
                message_en={err.en}
                message_ar={err.ar}
                onRetry={handleTransform}
              />
            </div>
          )}

          {!canSubmit && !err && (
            <p
              className={cn(
                "mt-4 text-sm text-cream-muted",
                isArabic && "font-arabic",
              )}
            >
              {helperText}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
