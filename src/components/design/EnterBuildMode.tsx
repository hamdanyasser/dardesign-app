"use client";

/* ============================================================
   The doorway from a finished result into Build Mode.

   Writes the whole RedesignResult to sessionStorage and navigates.
   A query string cannot carry it — /redesign returns base64 data URLs
   plus the analysis payload — and the endpoint is synchronous, so there
   is nothing to re-fetch on the other side.

   This is also the real node for DesignStory's `designer` slot, which
   until now rendered an em dash because the story package refuses to
   invent a CTA for a destination that does not exist. It exists now.
   ============================================================ */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import type { RedesignResult } from "@/lib/api";
import { HANDOFF_KEY } from "@/lib/design/handoff";
import type { SceneCulture } from "@/lib/design/types";

export default function EnterBuildMode({
  result,
  culture,
  variant = "primary",
  className,
}: {
  result: RedesignResult;
  culture: SceneCulture;
  variant?: "primary" | "link";
  className?: string;
}) {
  const router = useRouter();
  const { isArabic } = useThemeLanguage();
  const [busy, setBusy] = useState(false);

  const go = useCallback(() => {
    setBusy(true);
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ result, culture }));
    } catch {
      // Private mode or quota: Build Mode still opens, just with its
      // default room rather than the measured one. Better than blocking.
    }
    router.push("/design");
  }, [result, culture, router]);

  const label = isArabic ? "صمّمها بنفسك" : "Design it yourself";
  const sub = isArabic ? "افتح وضع البناء" : "Open Build Mode";

  if (variant === "link") {
    return (
      <button
        onClick={go}
        disabled={busy}
        className={className}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "var(--dd-gold, #d4af37)",
          fontFamily: "var(--f-mono, monospace)",
          fontSize: "0.68rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label} →
      </button>
    );
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 20px",
        border: "1px solid var(--dd-gold, #d4af37)",
        borderRadius: 2,
        background: "var(--dd-gold, #d4af37)",
        color: "var(--dd-ink, #16110a)",
        fontFamily: "var(--f-mono, monospace)",
        fontSize: "0.68rem",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: busy ? "wait" : "pointer",
      }}
    >
      <span>{label}</span>
      <span aria-hidden style={{ opacity: 0.7 }}>
        {sub}
      </span>
      <span aria-hidden>→</span>
    </button>
  );
}
