"use client";

/* ============================================================
   The feedback a design already has.

   Display only. It shows what the existing rating form saved —
   it never writes, and there is no second rating record. Used by
   History and Others' Work so both read the same way.

   The gallery is served the three scores alone; only the owner's
   own History carries the written comment, so `rating.comment`
   being absent is what keeps it out rather than a flag here.
   ============================================================ */

import { Star } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import type { DesignRating } from "@/lib/api";
import { cn } from "@/lib/utils";

const PLACEMENT_LABEL: Record<string, { en: string; ar: string }> = {
  valid: { en: "Furniture placement: correct", ar: "وضع الأثاث: صحيح" },
  invalid: { en: "Furniture placement: wrong", ar: "وضع الأثاث: غير صحيح" },
  not_applicable: { en: "Furniture placement: n/a", ar: "وضع الأثاث: لا ينطبق" },
};

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

  const scores: Array<[string, number]> = [
    [t("Cultural", "ثقافي"), rating.culturalAccuracy],
    [t("Quality", "الجودة"), rating.imageQuality],
    [t("Preservation", "الحفاظ"), rating.roomPreservation],
  ];
  const placement = rating.furniturePlacement
    ? PLACEMENT_LABEL[rating.furniturePlacement]
    : undefined;

  return (
    <span
      className={cn("flex flex-wrap items-center gap-2", isArabic && "flex-row-reverse", className)}
    >
      <span
        className={cn(
          "flex items-center gap-1 rounded-full border border-[var(--dd-gold)]/50 px-2 py-0.5 text-xs text-[var(--dd-gold)]",
          isArabic && "flex-row-reverse font-arabic",
        )}
      >
        <Star className="h-3 w-3 fill-current" aria-hidden />
        <span dir="ltr">{rating.overall.toFixed(1)}/5</span>
      </span>

      {/* The three scores the form actually asked for. The average above is
          derived from them, so showing both makes the derivation checkable. */}
      {scores.map(([label, value]) => (
        <span
          key={label}
          className={cn(
            "flex items-center gap-1 text-xs text-[var(--dd-text-secondary)]",
            isArabic && "flex-row-reverse font-arabic",
          )}
        >
          {label}
          <span className="font-mono text-[var(--dd-text-soft)]" dir="ltr">
            {value}/5
          </span>
        </span>
      ))}

      {placement && (
        <span
          className={cn(
            "rounded-full border border-[var(--dd-gold-dim)]/30 px-2 py-0.5 text-xs text-[var(--dd-text-secondary)]",
            isArabic && "font-arabic",
          )}
        >
          {isArabic ? placement.ar : placement.en}
        </span>
      )}

      {/* Inline rather than on its own line: the caption sits in a
          non-wrapping flex row inside an overflow-hidden card, so a full-width
          element there is squeezed to nothing and clipped. Long comments are
          truncated with the whole text on the title attribute. */}
      {rating.comment && (
        <span
          title={rating.comment}
          className={cn(
            "max-w-[18rem] truncate text-xs italic text-[var(--dd-text-soft)]",
            isArabic && "font-arabic",
          )}
        >
          “{rating.comment}”
        </span>
      )}
    </span>
  );
}
