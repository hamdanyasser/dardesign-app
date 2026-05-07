"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export default function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "Before",
  afterLabel = "After",
}: BeforeAfterSliderProps) {
  const { isArabic } = useThemeLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const isDragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(percentage);
  }, []);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!isDragging.current) {
        return;
      }

      updatePosition(event.clientX);
    },
    [updatePosition]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleTouchStart = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!isDragging.current) {
        return;
      }

      event.preventDefault();
      updatePosition(event.touches[0].clientX);
    },
    [updatePosition]
  );

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto aspect-video w-full max-w-4xl select-none overflow-hidden rounded-xl"
      style={{ touchAction: "none" }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={afterSrc}
        alt={afterLabel}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      <img
        src={beforeSrc}
        alt={beforeLabel}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        draggable={false}
      />

      <div
        className="absolute bottom-0 top-0 z-10 w-0.5 bg-gold"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />

      <div
        className="absolute top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-gold shadow-lg"
        style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="text-[var(--dd-ink)]"
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

      <span
        className={cn(
          "absolute top-3 z-10 rounded-lg bg-[var(--dd-glass-bg)] px-3 py-1 text-xs font-semibold text-[var(--dd-text)]",
          isArabic ? "right-3 font-arabic" : "left-3 font-ui"
        )}
      >
        {beforeLabel}
      </span>
      <span
        className={cn(
          "absolute top-3 z-10 rounded-lg bg-[color:color-mix(in_srgb,var(--dd-gold)_80%,white_20%)] px-3 py-1 text-xs font-semibold text-[var(--dd-ink)]",
          isArabic ? "left-3 font-arabic" : "right-3 font-ui"
        )}
      >
        {afterLabel}
      </span>
    </div>
  );
}
