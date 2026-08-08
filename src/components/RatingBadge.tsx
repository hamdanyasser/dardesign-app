"use client";

/* ============================================================
   The rating a design already has, as a caption chip.

   Display only. It shows what the existing rating form saved —
   it never writes, and there is no second rating record. Used by
   History and Others' Work so both read the same way.
   ============================================================ */

import { Star } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import type { DesignRating } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function RatingBadge({
  rating,
  className,
}: {
  rating?: DesignRating | null;
  className?: string;
}) {
  const { isArabic } = useThemeLanguage();
  const t = (en: string, ar: string) => (isArabic ? ar : en);

  // Unrated is a state, not a zero: the scale starts at 1, so showing 0.00 here
  // would read as a terrible rating rather than an absent one.
  if (!rating) {
    return (
      <span
        className={cn(
          "rounded-full border border-[var(--dd-gold-dim)]/30 px-2 py-0.5 text-xs text-[var(--dd-text-secondary)]",
          isArabic && "font-arabic",
          className,
        )}
      >
        {t("Not rated", "غير مقيَّم")}
      </span>
    );
  }

  const detail = [
    `${t("Cultural accuracy", "الدقة الثقافية")}: ${rating.culturalAccuracy}/5`,
    `${t("Design quality", "جودة التصميم")}: ${rating.imageQuality}/5`,
    `${t("Room preservation", "الحفاظ على الغرفة")}: ${rating.roomPreservation}/5`,
  ].join(" · ");

  return (
    <span
      title={detail}
      aria-label={detail}
      className={cn(
        "flex items-center gap-1 rounded-full border border-[var(--dd-gold)]/50 px-2 py-0.5 text-xs text-[var(--dd-gold)]",
        isArabic && "flex-row-reverse font-arabic",
        className,
      )}
    >
      <Star className="h-3 w-3 fill-current" aria-hidden />
      <span dir="ltr">{rating.overall.toFixed(1)}/5</span>
    </span>
  );
}
