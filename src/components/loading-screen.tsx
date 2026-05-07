"use client";

import { useEffect, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

function IslamicStar() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 100 100"
      className="animate-spin-slow"
    >
      <rect
        x="22"
        y="22"
        width="56"
        height="56"
        fill="none"
        stroke="var(--dd-gold)"
        strokeWidth="2"
        transform="rotate(0 50 50)"
      />
      <rect
        x="22"
        y="22"
        width="56"
        height="56"
        fill="none"
        stroke="var(--dd-gold)"
        strokeWidth="2"
        transform="rotate(45 50 50)"
      />
    </svg>
  );
}

interface LoadingScreenProps {
  /** Called when the timed fallback elapses. Ignored if `progress` is provided. */
  onComplete?: () => void;
  /** 0–1; when present, the bar reflects real progress and onComplete is suppressed. */
  progress?: number;
  /** Optional override; otherwise rotates through copy.loading.messages */
  messageOverride?: string;
}

export default function LoadingScreen({
  onComplete,
  progress,
  messageOverride,
}: LoadingScreenProps) {
  const { copy, isArabic } = useThemeLanguage();
  const [messageIndex, setMessageIndex] = useState(0);
  const isLive = typeof progress === "number";

  // Fallback timer — only fires when we're NOT being driven by real progress
  useEffect(() => {
    if (isLive || !onComplete) return;
    const timer = setTimeout(onComplete, 8000);
    return () => clearTimeout(timer);
  }, [onComplete, isLive]);

  useEffect(() => {
    setMessageIndex(0);
  }, [copy.loading.messages]);

  useEffect(() => {
    if (messageOverride) return;
    const interval = setInterval(() => {
      setMessageIndex((current) => (current + 1) % copy.loading.messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [copy.loading.messages, messageOverride]);

  const displayMessage = messageOverride ?? copy.loading.messages[messageIndex];
  const pct = isLive ? Math.max(0, Math.min(1, progress!)) * 100 : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-charcoal">
      <div className="mb-10">
        <IslamicStar />
      </div>

      <div className="mb-10 flex h-8 items-center justify-center px-4 text-center">
        <p
          key={`${messageIndex}-${displayMessage}`}
          className={cn(
            "animate-fade-in-up text-xl text-[var(--dd-text)]",
            isArabic ? "font-arabic" : "font-ui",
          )}
        >
          {displayMessage}
        </p>
      </div>

      <div className="h-1 w-64 overflow-hidden rounded-full bg-charcoal-soft">
        {pct === null ? (
          <div className="h-full rounded-full bg-gold animate-progress" />
        ) : (
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {pct !== null && (
        <p className={cn("mt-4 text-xs text-cream-muted", isArabic && "font-arabic")}>
          {Math.round(pct)}%
        </p>
      )}
    </div>
  );
}
