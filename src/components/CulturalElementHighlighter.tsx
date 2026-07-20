"use client";

/**
 * CulturalElementHighlighter.
 *
 * Overlays a semantic-segmentation mask on a (re)generated room image. Each
 * region is tagged with an ADE20K class key; clicking it reveals a small card
 * with the element's Arabic term + a short design note (from data/segmentation-labels.json).
 *
 * Real regions arrive inline in the `POST /redesign` response (`seg_regions`,
 * computed by seg_bounding_boxes() in backend/projection.py from the OneFormer
 * ADE20K pass). DEMO_REGIONS below is the fallback for older backends that
 * omit them. With no regions the component degrades gracefully to just the
 * image, so it never blocks a build or a demo.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import segmentationLabelsRaw from "@/data/segmentation-labels.json";

/* --------------------------------- types ---------------------------------- */

export interface OntologyEntry {
  ar: string;
  en: string;
  note: string;
}

/** A single segmented region. Coordinates are normalized to 0..1 of the image box. */
export interface SegRegion {
  /** ADE20K class key, e.g. "wall" | "sofa" — used to look up data/segmentation-labels.json. */
  classKey: string;
  /** Optional stable id (defaults to classKey + index). */
  id?: string;
  /** Polygon outline as normalized [x, y] pairs. Preferred when available. */
  polygon?: [number, number][];
  /** Bounding box [x, y, w, h], normalized. Used for the click target / fallback. */
  bbox?: [number, number, number, number];
}

export interface CulturalElementHighlighterProps {
  /** Image to annotate — a data URL or a regular URL. */
  imageSrc: string;
  /** Regions from the backend segmentation map. Empty/omitted until wired. */
  regions?: SegRegion[];
  /** Alt text for the underlying image. */
  alt?: string;
  /** Fires when a region is selected, with its ADE20K class key. */
  onSelect?: (classKey: string) => void;
  className?: string;
}

/* ------------------------ segmentation-label lookup ----------------------- */

const SEGMENTATION_LABELS = segmentationLabelsRaw as Record<string, Partial<OntologyEntry>>;

function lookup(classKey: string): OntologyEntry | null {
  const e = SEGMENTATION_LABELS[classKey];
  if (e && typeof e.ar === "string" && typeof e.en === "string" && typeof e.note === "string") {
    return e as OntologyEntry;
  }
  return null;
}

/** Bounding box of a region, derived from polygon if no explicit bbox is given. */
function regionBox(r: SegRegion): [number, number, number, number] | null {
  if (r.bbox) return r.bbox;
  if (r.polygon && r.polygon.length) {
    const xs = r.polygon.map((p) => p[0]);
    const ys = r.polygon.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
  }
  return null;
}

/**
 * Illustrative regions for local development / visual testing of the overlay,
 * and the fallback when /redesign returns no (or placeholder) seg_regions.
 * These are placeholder boxes, NOT real detections.
 */
export const DEMO_REGIONS: SegRegion[] = [
  { classKey: "wall", bbox: [0.03, 0.04, 0.94, 0.32] },
  { classKey: "window", bbox: [0.63, 0.09, 0.29, 0.24] },
  { classKey: "lamp", bbox: [0.8, 0.36, 0.15, 0.28] },
  { classKey: "sofa", bbox: [0.07, 0.52, 0.46, 0.32] },
  { classKey: "table", bbox: [0.41, 0.64, 0.33, 0.22] },
  { classKey: "plant", bbox: [0.04, 0.42, 0.12, 0.3] },
  { classKey: "rug", bbox: [0.12, 0.82, 0.74, 0.14] },
  { classKey: "floor", bbox: [0.02, 0.72, 0.96, 0.26] },
];

/* -------------------------------- component -------------------------------- */

export default function CulturalElementHighlighter({
  imageSrc,
  regions = [],
  alt,
  onSelect,
  className,
}: CulturalElementHighlighterProps) {
  const { isArabic } = useThemeLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Keep only regions we can both place (have a box) and explain (in the label map).
  const drawable = useMemo(
    () =>
      regions
        .map((r, i) => ({ r, key: r.id ?? `${r.classKey}-${i}`, box: regionBox(r), info: lookup(r.classKey) }))
        .filter((d): d is { r: SegRegion; key: string; box: [number, number, number, number]; info: OntologyEntry } =>
          d.box !== null && d.info !== null,
        ),
    [regions],
  );

  const selected = drawable.find((d) => d.key === selectedId) ?? null;

  const handleSelect = (key: string, classKey: string) => {
    setSelectedId((prev) => (prev === key ? null : key));
    onSelect?.(classKey);
  };

  return (
    <div className={cn("relative w-full overflow-hidden rounded-2xl", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSrc} alt={alt ?? "Room"} className="block h-auto w-full select-none" draggable={false} />

      {drawable.length > 0 && (
        <>
          {/* Visual mask layer (non-interactive; buttons below handle input). */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {drawable.map(({ r, key, box }) => {
              const active = key === selectedId || key === hoveredId;
              const [x, y, w, h] = box;
              const common = {
                style: { stroke: "var(--dd-gold)", fill: "var(--dd-gold)" } as const,
                strokeWidth: active ? 0.8 : 0.4,
                strokeOpacity: active ? 1 : 0.55,
                fillOpacity: active ? 0.22 : 0.08,
                vectorEffect: "non-scaling-stroke" as const,
              };
              return r.polygon && r.polygon.length > 2 ? (
                <polygon
                  key={key}
                  points={r.polygon.map(([px, py]) => `${px * 100},${py * 100}`).join(" ")}
                  {...common}
                />
              ) : (
                <rect key={key} x={x * 100} y={y * 100} width={w * 100} height={h * 100} rx={1} {...common} />
              );
            })}
          </svg>

          {/* Accessible interactive hotspots, positioned over each region's box. */}
          {drawable.map(({ key, box, info, r }) => {
            const [x, y, w, h] = box;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelect(key, r.classKey)}
                onMouseEnter={() => setHoveredId(key)}
                onMouseLeave={() => setHoveredId((p) => (p === key ? null : p))}
                onFocus={() => setHoveredId(key)}
                onBlur={() => setHoveredId((p) => (p === key ? null : p))}
                aria-label={isArabic ? `${info.ar} — ${info.en}` : `${info.en} — ${info.ar}`}
                aria-pressed={key === selectedId}
                className="absolute cursor-pointer rounded-md outline-none ring-gold focus-visible:ring-2"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${w * 100}%`,
                  height: `${h * 100}%`,
                }}
              />
            );
          })}

          {/* Info card for the selected element. */}
          {selected && (
            <div
              dir={isArabic ? "rtl" : "ltr"}
              className={cn(
                "glass-panel absolute bottom-3 z-10 max-w-[16rem] rounded-xl border border-gold/40 p-4 shadow-lg animate-fade-in-up",
                isArabic ? "right-3 text-right" : "left-3 text-left",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label={isArabic ? "إغلاق" : "Close"}
                className={cn(
                  "absolute top-2 flex h-6 w-6 items-center justify-center rounded-full text-cream-muted transition hover:text-gold",
                  isArabic ? "left-2" : "right-2",
                )}
              >
                <X size={14} />
              </button>
              <p className={cn("text-lg font-semibold text-gold", isArabic ? "font-arabic" : "font-display")}>
                {selected.info.ar}
              </p>
              <p className="mb-2 text-xs uppercase tracking-wide text-cream-muted font-ui">{selected.info.en}</p>
              <p className={cn("text-sm leading-relaxed text-cream-soft", isArabic && "font-arabic")}>
                {selected.info.note}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
