"use client";

import { useState, type CSSProperties } from "react";
import { MoveHorizontal } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import type { StoryImage } from "./types";
import styles from "./StoryComparison.module.css";

export interface StoryComparisonProps {
  before: StoryImage;
  after: StoryImage;
  /** One crop anchor is applied to both images so the wipe stays registered. */
  sharedFocalPoint?: StoryImage["focalPoint"];
  initialPosition?: number;
  className?: string;
}

const COPY = {
  en: {
    before: "Before",
    after: "After",
    control: "Adjust the before and after comparison",
    dimensionMismatch: "Different image dimensions — shown side by side to preserve geometry.",
    valueText: (beforeVisible: number, afterVisible: number) =>
      `Before visible ${beforeVisible} percent; after visible ${afterVisible} percent`,
  },
  ar: {
    before: "قبل",
    after: "بعد",
    control: "اضبط المقارنة بين الصورة قبل التصميم وبعده",
    dimensionMismatch: "أبعاد الصورتين مختلفة — تُعرضان جنباً إلى جنب للحفاظ على هندستهما.",
    valueText: (beforeVisible: number, afterVisible: number) =>
      `الصورة قبل التصميم ظاهرة بنسبة ${beforeVisible} بالمئة؛ والصورة بعد التصميم ظاهرة بنسبة ${afterVisible} بالمئة`,
  },
} as const;

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

function imagePosition(image: StoryImage): string | undefined {
  if (!image.focalPoint) return undefined;
  const x = clampPercentage(image.focalPoint.x);
  const y = clampPercentage(image.focalPoint.y);
  return `${x}% ${y}%`;
}

export function StoryComparison({
  before,
  after,
  sharedFocalPoint,
  initialPosition = 50,
  className,
}: StoryComparisonProps) {
  const { isArabic } = useThemeLanguage();
  const [position, setPosition] = useState(() => clampPercentage(initialPosition));
  const [beforeGeometry, setBeforeGeometry] = useState<{ src: string; aspect: number } | null>(null);
  const [afterGeometry, setAfterGeometry] = useState<{ src: string; aspect: number } | null>(null);
  const copy = isArabic ? COPY.ar : COPY.en;

  /* The range tracks the physical seam from the left edge in both languages.
     The generated image occupies inline-end: right in English, left in Arabic. */
  const beforeVisible = Math.round(isArabic ? 100 - position : position);
  const afterVisible = 100 - beforeVisible;
  const rootStyle = {
    "--story-comparison-position": `${position}%`,
  } as CSSProperties;
  const hasCaption = Boolean(before.caption || after.caption);
  const sharedImagePosition = imagePosition({
    ...before,
    focalPoint: sharedFocalPoint ?? before.focalPoint ?? after.focalPoint,
  });
  const beforeAspect = beforeGeometry?.src === before.src ? beforeGeometry.aspect : null;
  const afterAspect = afterGeometry?.src === after.src ? afterGeometry.aspect : null;
  const canWipe =
    beforeAspect == null ||
    afterAspect == null ||
    Math.abs(beforeAspect - afterAspect) / beforeAspect <= 0.01;
  const recordGeometry = (
    side: "before" | "after",
    src: string,
    image: HTMLImageElement,
  ) => {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const geometry = { src, aspect: image.naturalWidth / image.naturalHeight };
    if (side === "before") setBeforeGeometry(geometry);
    else setAfterGeometry(geometry);
  };

  return (
    <figure
      className={cn(styles.root, className)}
      dir={isArabic ? "rtl" : "ltr"}
      style={rootStyle}
    >
      <div
        className={styles.stage}
        data-rtl={isArabic ? "true" : "false"}
        data-mode={canWipe ? "wipe" : "split"}
      >
        {/* User images are blob/data URLs in Studio, so next/image is not suitable. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={before.src}
          alt={isArabic ? before.alt.ar : before.alt.en}
          className={styles.image}
          style={{ objectPosition: sharedImagePosition }}
          draggable={false}
          decoding="async"
          onLoad={(event) => recordGeometry("before", before.src, event.currentTarget)}
        />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={after.src}
          alt={isArabic ? after.alt.ar : after.alt.en}
          className={cn(styles.image, styles.afterImage)}
          style={{ objectPosition: sharedImagePosition }}
          draggable={false}
          decoding="async"
          onLoad={(event) => recordGeometry("after", after.src, event.currentTarget)}
        />

        <span className={cn(styles.label, styles.beforeLabel)}>{copy.before}</span>
        <span className={cn(styles.label, styles.afterLabel)}>{copy.after}</span>

        {canWipe && (
          <>
            <input
              className={styles.range}
              type="range"
              min={0}
              max={100}
              step={1}
              value={position}
              onChange={(event) => setPosition(clampPercentage(event.currentTarget.valueAsNumber))}
              aria-label={copy.control}
              aria-valuetext={copy.valueText(beforeVisible, afterVisible)}
              /* Keep arrows and the thumb mapped to physical left/right. The
                 localized value text communicates the direction-aware meaning. */
              dir="ltr"
            />

            <div className={styles.divider} aria-hidden="true" />
            <div className={styles.handle} aria-hidden="true">
              <MoveHorizontal size={20} strokeWidth={1.5} />
            </div>
          </>
        )}
      </div>

      {!canWipe && <p className={styles.mismatchNote} role="note">{copy.dimensionMismatch}</p>}

      {hasCaption && (
        <figcaption className={styles.captions}>
          <div className={styles.caption}>
            <span className={styles.captionLabel}>{copy.before}</span>
            {before.caption && (
              <span className={styles.captionText}>
                {isArabic ? before.caption.ar : before.caption.en}
              </span>
            )}
          </div>
          <div className={cn(styles.caption, styles.afterCaption)}>
            <span className={styles.captionLabel}>{copy.after}</span>
            {after.caption && (
              <span className={styles.captionText}>
                {isArabic ? after.caption.ar : after.caption.en}
              </span>
            )}
          </div>
        </figcaption>
      )}
    </figure>
  );
}

export default StoryComparison;
