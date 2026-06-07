"use client";

/**
 * RoomMap2D — SCAFFOLD.
 *
 * A top-down ("bird's-eye") 2D layout map of the room's detected objects. Each
 * object is an ADE20K class placed at a normalized top-down position; the map
 * draws furniture footprints + wall openings (door/window) and labels each in
 * Arabic + English (from data/ontology.json). Click a piece to read its note.
 *
 * ⚠️ The backend projection (Depth Anything V2 + OneFormer → top-down) is not
 * wired yet. This renders against a clean prop interface (`objects: MapObject[]`)
 * with a `fetchObjectMap()` hook; with no objects it shows an empty plan. Safe to
 * mount today; it never blocks a build or a demo.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import ontologyRaw from "@/data/ontology.json";

interface OntologyEntry {
  ar: string;
  en: string;
  note: string;
}

export interface MapObject {
  /** ADE20K class key, looked up in data/ontology.json. */
  classKey: string;
  /** Normalized top-down centre, 0..1 (x → right, y → far→near). */
  cx: number;
  cy: number;
  /** Normalized footprint size, 0..1. Defaults to a small marker. */
  w?: number;
  h?: number;
  /** Optional stable id (defaults to classKey + index). */
  id?: string;
}

export interface RoomMap2DProps {
  /** Placed objects from the backend projection. Empty/omitted until wired. */
  objects?: MapObject[];
  /** Fires when an object is selected, with its ADE20K class key. */
  onSelect?: (classKey: string) => void;
  className?: string;
}

const ONTOLOGY = ontologyRaw as Record<string, Partial<OntologyEntry>>;

function lookup(classKey: string): OntologyEntry | null {
  const e = ONTOLOGY[classKey];
  if (e && typeof e.ar === "string" && typeof e.en === "string" && typeof e.note === "string") {
    return e as OntologyEntry;
  }
  return null;
}

/** Wall openings render as a bright line on the nearest edge, not a footprint. */
const EDGE_OPENINGS = new Set(["door", "window"]);

/**
 * Fetch the top-down object map for a finished job and map it to MapObject[].
 * Returns [] today so callers render an empty plan.
 */
export async function fetchObjectMap(jobId: string): Promise<MapObject[]> {
  // TODO: connect to backend projection (depth + seg → top-down centroids)
  void jobId; // keep jobId in the public signature until the endpoint exists
  // Expected: GET ${NEXT_PUBLIC_API_URL}/objectmap/{jobId} -> { objects: [...] },
  // projecting floor pixels + object centroids onto a normalized bird's-eye plane.
  return [];
}

/** Illustrative living-room layout for local dev / demo. NOT real detections. */
export const DEMO_MAP: MapObject[] = [
  { classKey: "sofa", cx: 0.5, cy: 0.16, w: 0.5, h: 0.12 },
  { classKey: "window", cx: 0.5, cy: 0.02, w: 0.34, h: 0.02 },
  { classKey: "rug", cx: 0.5, cy: 0.5, w: 0.58, h: 0.42 },
  { classKey: "table", cx: 0.5, cy: 0.46, w: 0.26, h: 0.16 },
  { classKey: "chair", cx: 0.26, cy: 0.64, w: 0.12, h: 0.12 },
  { classKey: "lamp", cx: 0.12, cy: 0.18, w: 0.08, h: 0.08 },
  { classKey: "plant", cx: 0.88, cy: 0.2, w: 0.1, h: 0.1 },
  { classKey: "cabinet", cx: 0.9, cy: 0.55, w: 0.1, h: 0.42 },
  { classKey: "door", cx: 0.3, cy: 0.98, w: 0.18, h: 0.02 },
];

export default function RoomMap2D({ objects = [], onSelect, className }: RoomMap2DProps) {
  const { isArabic } = useThemeLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const placed = useMemo(
    () =>
      objects
        .map((o, i) => ({ o, key: o.id ?? `${o.classKey}-${i}`, info: lookup(o.classKey) }))
        .filter((d): d is { o: MapObject; key: string; info: OntologyEntry } => d.info !== null),
    [objects],
  );

  const selected = placed.find((d) => d.key === selectedId) ?? null;

  const handleSelect = (key: string, classKey: string) => {
    setSelectedId((p) => (p === key ? null : key));
    onSelect?.(classKey);
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gold/25 bg-[var(--dd-surface)]">
        {/* floor grid + footprints + wall openings */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <pattern id="rm-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                style={{ stroke: "var(--dd-gold)" }}
                strokeOpacity="0.08"
                strokeWidth="0.3"
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill="url(#rm-grid)" />

          {placed.map(({ o, key }) => {
            if (EDGE_OPENINGS.has(o.classKey)) return null;
            const w = (o.w ?? 0.08) * 100;
            const h = (o.h ?? 0.08) * 100;
            const x = o.cx * 100 - w / 2;
            const y = o.cy * 100 - h / 2;
            const active = key === selectedId || key === hoveredId;
            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={w}
                height={h}
                rx={2}
                style={{ stroke: "var(--dd-gold)", fill: "var(--dd-gold)" }}
                strokeWidth={active ? 0.8 : 0.4}
                strokeOpacity={active ? 1 : 0.5}
                fillOpacity={active ? 0.28 : 0.12}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {placed.map(({ o, key }) => {
            if (!EDGE_OPENINGS.has(o.classKey)) return null;
            const w = (o.w ?? 0.2) * 100;
            const x1 = o.cx * 100 - w / 2;
            const x2 = o.cx * 100 + w / 2;
            const yy = o.cy < 0.5 ? 0.7 : 99.3;
            const active = key === selectedId || key === hoveredId;
            return (
              <line
                key={key}
                x1={x1}
                y1={yy}
                x2={x2}
                y2={yy}
                style={{ stroke: o.classKey === "door" ? "var(--dd-gold-hover)" : "var(--dd-gold)" }}
                strokeWidth={active ? 2.4 : 1.5}
                strokeOpacity={0.95}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* interactive labels */}
        {placed.map(({ o, key, info }) => {
          const active = key === selectedId;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSelect(key, o.classKey)}
              onMouseEnter={() => setHoveredId(key)}
              onMouseLeave={() => setHoveredId((p) => (p === key ? null : p))}
              onFocus={() => setHoveredId(key)}
              onBlur={() => setHoveredId((p) => (p === key ? null : p))}
              aria-label={isArabic ? `${info.ar} — ${info.en}` : `${info.en} — ${info.ar}`}
              aria-pressed={active}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] outline-none ring-gold transition-all duration-200 focus-visible:ring-2",
                active
                  ? "border-gold bg-gold text-[var(--dd-ink)]"
                  : "border-gold/40 bg-[var(--dd-glass-bg)] text-cream-soft hover:border-gold hover:text-gold",
                isArabic ? "font-arabic" : "font-ui",
              )}
              style={{ left: `${o.cx * 100}%`, top: `${o.cy * 100}%` }}
            >
              {isArabic ? info.ar : info.en}
            </button>
          );
        })}

        {/* empty state */}
        {placed.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
              {isArabic ? "لا توجد بيانات مخطط بعد" : "No layout data yet"}
            </p>
          </div>
        )}

        {/* selection note */}
        {selected && (
          <div
            dir={isArabic ? "rtl" : "ltr"}
            className={cn(
              "glass-panel absolute bottom-3 z-10 max-w-[15rem] rounded-xl border border-gold/40 p-3 animate-fade-in-up",
              isArabic ? "right-3 text-right" : "left-3 text-left",
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label={isArabic ? "إغلاق" : "Close"}
              className={cn(
                "absolute top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-cream-muted transition hover:text-gold",
                isArabic ? "left-1.5" : "right-1.5",
              )}
            >
              <X size={12} />
            </button>
            <p className={cn("text-base font-semibold text-gold", isArabic ? "font-arabic" : "font-display")}>
              {selected.info.ar}
            </p>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-cream-muted font-ui">{selected.info.en}</p>
            <p className={cn("text-xs leading-relaxed text-cream-soft", isArabic && "font-arabic")}>
              {selected.info.note}
            </p>
          </div>
        )}
      </div>

      <p className={cn("mt-2 text-center text-[11px] text-cream-muted", isArabic && "font-arabic")}>
        {isArabic ? "مخطط علوي تقريبي للعناصر" : "Approximate top-down layout"}
      </p>
    </div>
  );
}
