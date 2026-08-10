"use client";

/* ============================================================
   Bar charts for the evaluation dashboard.

   Plain CSS bars rather than a charting library: three cultures
   against three 1-5 metrics is a table with widths, and pulling in
   a chart dependency for it would cost bundle size and a build
   surface for nothing. No animation — this is read, not watched.

   A null score renders as "—", never as a zero-width bar. On a 1-5
   scale a zero is impossible, so a zero-length bar would be
   claiming a measurement nobody made.
   ============================================================ */

import { cn } from "@/lib/utils";

/** On-brand, and the same values the studio already uses per culture
 *  (ArchCanvas archColor): cedar, brass, cobalt. */
export const CULTURE_COLOR: Record<string, string> = {
  lebanese: "#c9a876",
  khaleeji: "#d4af37",
  moroccan: "#1f4287",
};

export const CULTURE_LABEL: Record<string, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
};

export interface Bar {
  key: string;
  label: string;
  value: number | null;
  color?: string;
  /** Shown after the value, e.g. "12 ratings". */
  note?: string;
}

export function ScoreBars({
  bars,
  max = 5,
  isArabic = false,
  emptyLabel = "—",
}: {
  bars: Bar[];
  max?: number;
  isArabic?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {bars.map((b) => {
        const pct = b.value == null ? 0 : Math.max(0, Math.min(100, (b.value / max) * 100));
        return (
          <div key={b.key} className={cn("flex items-center gap-3", isArabic && "flex-row-reverse")}>
            <span
              className={cn(
                "w-28 shrink-0 text-xs text-cream-muted",
                isArabic ? "text-right font-arabic" : "text-left font-ui",
              )}
            >
              {b.label}
            </span>
            {/* A3: a measured tick, not a rounded progress pill. */}
            <div
              className="h-[3px] flex-1 bg-[var(--dd-text)]/[0.08]"
              role="img"
              aria-label={`${b.label}: ${b.value == null ? emptyLabel : `${b.value} / ${max}`}`}
            >
              {b.value != null && (
                <div
                  className="h-full"
                  style={{
                    width: `${pct}%`,
                    background: b.color ?? "var(--dd-gold)",
                    // RTL: bars must grow from the right edge, like the text.
                    marginInlineStart: 0,
                  }}
                />
              )}
            </div>
            <span
              className={cn(
                "font-editorial-mono w-24 shrink-0 text-[11px]",
                b.value == null ? "text-cream-muted" : "text-cream-soft",
                isArabic ? "text-left" : "text-right",
              )}
              dir="ltr"
            >
              {b.value == null ? emptyLabel : b.value.toFixed(2)}
              {b.note && <span className="ms-1 text-cream-muted">{b.note}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** One metric, compared across cultures — the actual comparison the dashboard
 *  is for. Grouping by metric (rather than a card per culture) is what makes
 *  "which culture scores worst on cultural accuracy?" answerable at a glance. */
export function MetricComparison({
  title,
  cultures,
  values,
  isArabic = false,
  max = 5,
  noDataLabel,
}: {
  title: string;
  cultures: string[];
  values: Record<string, number | null>;
  isArabic?: boolean;
  max?: number;
  noDataLabel: string;
}) {
  const anyData = cultures.some((c) => values[c] != null);
  return (
    <div>
      <h4
        className={cn(
          "mb-2 text-xs font-medium uppercase tracking-wide text-cream-muted",
          isArabic && "font-arabic",
        )}
      >
        {title}
      </h4>
      {anyData ? (
        <ScoreBars
          isArabic={isArabic}
          max={max}
          bars={cultures.map((c) => ({
            key: c,
            label: isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c,
            value: values[c] ?? null,
            color: CULTURE_COLOR[c],
          }))}
        />
      ) : (
        <p className={cn("text-xs text-cream-muted", isArabic && "font-arabic")}>{noDataLabel}</p>
      )}
    </div>
  );
}
