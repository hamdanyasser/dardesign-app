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
  // would read as a terrible rating rather than an absent one. A1: plain mono
  // dash, no border/pill.
  if (!rating) {
    return (
      <span
        className={cn(
          "font-editorial-mono text-[10.5px] text-[var(--dd-text-secondary)]",
          className,
        )}
      >
        {t("— · NOT YET RATED", "— · لم يُقيَّم بعد")}
      </span>
    );
  }

  // The three scores the form actually asked for. `overall` is their mean,
  // not a fourth measurement — labelled as an average, never as one of them.
  const scores: Array<[string, number]> = [
    [t("CULTURAL", "الثقافي"), rating.culturalAccuracy],
    [t("QUALITY", "الجودة"), rating.imageQuality],
    [t("PRESERVATION", "الحفاظ"), rating.roomPreservation],
  ];
  const placement = rating.furniturePlacement
    ? PLACEMENT_LABEL[rating.furniturePlacement]
    : undefined;
  const filled = Math.round(rating.overall);

  return (
    <div className={cn(isArabic && "text-right", className)}>
      {/* A1: diamonds on a hairline, not stars in a pill. */}
      <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
        <span className={cn("flex items-center gap-[3px]", isArabic && "flex-row-reverse")}>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "h-[9px] w-[9px] rotate-45 border border-[var(--dd-gold)]",
                i < filled && "bg-[var(--dd-gold)]",
              )}
            />
          ))}
        </span>
        <span className="font-editorial-mono text-[9.5px] text-[var(--dd-text-secondary)]" dir="ltr">
          {rating.overall.toFixed(1)} · {t("AVG OF 3", "متوسط ٣")}
        </span>
      </div>

      {/* The three scores the average above is derived from, plus furniture
          placement when the design had any. */}
      <div
        className={cn(
          "font-editorial-mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-[var(--dd-text-secondary)]",
          isArabic && "flex-row-reverse",
        )}
      >
        {scores.map(([label, value]) => (
          <span key={label} dir="ltr">
            {label} {value}/5
          </span>
        ))}
        {placement && <span>{isArabic ? placement.ar : placement.en}</span>}
      </div>

      {/* A1: an italic serif pull-quote on a gold rule, not a truncated pill. */}
      {rating.comment && (
        <p
          className={cn(
            "font-editorial mt-2 max-w-[46ch] text-[15px] italic leading-snug text-[var(--dd-text-soft)]",
            isArabic
              ? "font-editorial-ar border-e pe-3 text-right not-italic"
              : "border-s ps-3",
            "border-[var(--dd-gold)]",
          )}
        >
          {rating.comment}
        </p>
      )}
    </div>
  );
}
