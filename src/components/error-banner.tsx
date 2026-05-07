"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface ErrorBannerProps {
  message_en: string;
  message_ar: string;
  onRetry?: () => void;
  retryLabelEn?: string;
  retryLabelAr?: string;
  variant?: "inline" | "panel";
}

export default function ErrorBanner({
  message_en,
  message_ar,
  onRetry,
  retryLabelEn = "Retry",
  retryLabelAr = "حاول مجدداً",
  variant = "panel",
}: ErrorBannerProps) {
  const { isArabic } = useThemeLanguage();
  const message = isArabic ? message_ar : message_en;
  const retryLabel = isArabic ? retryLabelAr : retryLabelEn;

  if (variant === "inline") {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center gap-2 text-sm text-[var(--error)]",
          isArabic && "flex-row-reverse font-arabic",
        )}
      >
        <AlertCircle size={16} />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-[var(--error)] bg-[rgba(232,93,74,0.08)] px-6 py-5",
        isArabic && "font-arabic",
      )}
    >
      <div className="flex items-center gap-2 text-[var(--error)]">
        <AlertCircle size={20} />
        <p className="text-base font-semibold">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-gold px-5 py-2 text-sm font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
            isArabic && "flex-row-reverse",
          )}
        >
          <RotateCcw size={14} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
