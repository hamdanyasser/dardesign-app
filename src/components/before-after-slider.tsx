"use client";

import { useCallback, useRef, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  beforeAlt?: string;
  afterAlt?: string;
  sliderLabel?: string;
  afterSide?: "left" | "right";
  className?: string;
}

export default function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "Before",
  afterLabel = "After",
  beforeAlt,
  afterAlt,
  sliderLabel,
  afterSide,
  className,
}: BeforeAfterSliderProps) {
  const { isArabic } = useThemeLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }

    const percentage = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, percentage)));
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      updatePosition(event.clientX);
    },
    [updatePosition]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }

      updatePosition(event.clientX);
    },
    [updatePosition]
  );

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      let nextPosition: number | null = null;

      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          nextPosition = position - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          nextPosition = position + step;
          break;
        case "Home":
          nextPosition = 0;
          break;
        case "End":
          nextPosition = 100;
          break;
        default:
          return;
      }

      event.preventDefault();
      setPosition(Math.max(0, Math.min(100, nextPosition)));
    },
    [position]
  );

  // The generic component follows the reading direction. Callers with an
  // established visual convention can pin the result to a physical side.
  const afterOnLeft = afterSide ? afterSide === "left" : isArabic;
  const roundedPosition = Math.round(position);
  const beforeVisible = afterOnLeft ? 100 - roundedPosition : roundedPosition;

  return (
    <div
      ref={containerRef}
      className={cn(
        "before-after-slider relative mx-auto aspect-video w-full max-w-4xl cursor-ew-resize select-none overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--dd-gold)]",
        className
      )}
      style={{ touchAction: "pan-y" }}
      role="slider"
      tabIndex={0}
      aria-label={sliderLabel ?? `${beforeLabel} / ${afterLabel}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={roundedPosition}
      aria-valuetext={`${beforeLabel} ${beforeVisible}%, ${afterLabel} ${100 - beforeVisible}%`}
      aria-orientation="horizontal"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={beforeSrc}
        alt={beforeAlt ?? beforeLabel}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/* The result stays on the same side as its label in either direction. */}
      <div
        className="after-wrap absolute inset-0 overflow-hidden"
        style={{
          clipPath: afterOnLeft
            ? `inset(0 ${100 - position}% 0 0)`
            : `inset(0 0 0 ${position}%)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterSrc}
          alt={afterAlt ?? afterLabel}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      </div>

      <div
        className="handle pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-gold"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      >
        <div
          className="knob absolute left-1/2 top-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-gold shadow-lg"
          style={{ transform: "translate(-50%, -50%)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-[var(--dd-ink)]"
            aria-hidden="true"
          >
            <path
              d="M4 8L1 5M4 8L1 11M4 8H12M12 8L15 5M12 8L15 11"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <span
        className={cn(
          "lbl before absolute top-3 z-10 rounded-lg bg-[var(--dd-glass-bg)] px-3 py-1 text-xs font-semibold text-[var(--dd-text)]",
          afterOnLeft ? "left-auto right-3" : "left-3 right-auto",
          isArabic ? "font-arabic" : "font-ui"
        )}
      >
        {beforeLabel}
      </span>
      <span
        className={cn(
          "lbl after absolute top-3 z-10 rounded-lg bg-[color:color-mix(in_srgb,var(--dd-gold)_80%,white_20%)] px-3 py-1 text-xs font-semibold text-[var(--dd-ink)]",
          afterOnLeft ? "left-3 right-auto" : "left-auto right-3",
          isArabic ? "font-arabic" : "font-ui"
        )}
      >
        {afterLabel}
      </span>
    </div>
  );
}
