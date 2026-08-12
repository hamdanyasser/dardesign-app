"use client";

/* ============================================================
   "What am I designing from?"

   Build Mode's entire premise is that it continues the room DAR
   generated — but until now nothing on screen said so once you were
   inside. The measured shell and the found massing came across in the
   data, and the user just had to take it on faith.

   This is the smallest honest fix: the actual render, in the corner,
   labelled with the culture it is. Clicking swaps between DAR's output
   and the original photograph, because "what was here before" is the
   other half of the question. It is an image the user already has —
   nothing is generated, claimed or re-rendered.
   ============================================================ */

import { useState } from "react";
import { CULTURE_LABEL } from "@/lib/design/catalog";
import type { SceneCulture } from "@/lib/design/types";

export default function SourceCard({
  originalSrc,
  styledSrc,
  culture,
  isArabic,
  placeholder,
}: {
  originalSrc: string;
  styledSrc: string | null;
  culture: SceneCulture;
  isArabic: boolean;
  placeholder: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const src = showOriginal || !styledSrc ? originalSrc : styledSrc;
  const canToggle = !!styledSrc;

  const label = showOriginal || !styledSrc
    ? isArabic
      ? "صورتك الأصلية"
      : "Your photograph"
    : isArabic
      ? `تصميم دار · ${CULTURE_LABEL[culture].ar}`
      : `DAR · ${CULTURE_LABEL[culture].en}`;

  return (
    <div className="sourcecard">
      <button
        type="button"
        onClick={() => canToggle && setShowOriginal((v) => !v)}
        disabled={!canToggle}
        title={
          canToggle
            ? isArabic
              ? "اضغط للتبديل بين تصميم دار وصورتك"
              : "Click to swap between DAR's render and your photograph"
            : undefined
        }
        aria-label={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} draggable={false} />
        <span className="sc-label">
          {label}
          {placeholder && (
            <em>{isArabic ? " · معاينة" : " · preview"}</em>
          )}
        </span>
      </button>
      <p className="sc-note">
        {isArabic
          ? "الغرفة التي تبني عليها"
          : "The room you are building on"}
      </p>
    </div>
  );
}
