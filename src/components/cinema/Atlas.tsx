"use client";

/* ============================================================
   Atlas — Constellation
   12 cultural motifs arranged as a star map, connected by
   hand-drawn lines. Mouse parallax. Hover reveals.

   Ported from dar-design-2 (jsx/atlas.jsx). Globals translated:
   window.I18n → useThemeLanguage + useCinemaCopy, IntersectionObserver
   → useInView, and the rAF mouse loop → a window mousemove handler
   that writes node transforms via refs (no per-move setState).
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { useCinemaCopy } from "@/components/cinema/copy";
import { useInView } from "@/components/cinema/hooks";
import { MotifTiles, type MotifTileId } from "@/components/cinema/svg/MotifTiles";
import DustLayer from "@/components/cinema/DustLayer";
import { cn } from "@/lib/utils";

interface AtlasNode {
  id: MotifTileId;
  x: number;
  y: number;
  group: "arch" | "surface" | "material" | "space";
  size: number;
}

// Constellation layout — positions in % within the viewBox.
// Hand-tuned so groups read as architectural / surface / material / space.
const NODES: AtlasNode[] = [
  // ARCHITECTURE cluster (left-center)
  { id: "qanater", x: 28, y: 32, group: "arch", size: 1.4 },
  { id: "mashrabiya", x: 18, y: 56, group: "arch", size: 1.6 },
  { id: "mihrab", x: 38, y: 64, group: "arch", size: 1.2 },
  { id: "riad", x: 14, y: 38, group: "arch", size: 1.1 },
  // SURFACE cluster (top-right)
  { id: "zellige", x: 72, y: 22, group: "surface", size: 1.8 },
  { id: "muqarnas", x: 84, y: 38, group: "surface", size: 1.3 },
  { id: "tadelakt", x: 64, y: 14, group: "surface", size: 1.0 },
  // MATERIAL cluster (right-center)
  { id: "cedar", x: 80, y: 64, group: "material", size: 1.2 },
  { id: "limestone", x: 70, y: 76, group: "material", size: 1.1 },
  { id: "brass", x: 90, y: 58, group: "material", size: 1.4 },
  // SPACE cluster (bottom-center)
  { id: "hammam", x: 50, y: 82, group: "space", size: 1.3 },
  { id: "majlis", x: 46, y: 44, group: "space", size: 1.5 }, // central
];

const EDGES: [MotifTileId, MotifTileId][] = [
  // architecture
  ["qanater", "mashrabiya"],
  ["mashrabiya", "mihrab"],
  ["qanater", "riad"],
  ["mihrab", "riad"],
  ["mashrabiya", "majlis"],
  // surface
  ["zellige", "muqarnas"],
  ["zellige", "tadelakt"],
  ["zellige", "majlis"],
  // material
  ["cedar", "limestone"],
  ["cedar", "brass"],
  ["limestone", "hammam"],
  ["brass", "majlis"],
  // space → center
  ["majlis", "hammam"],
  ["mihrab", "hammam"],
  ["mashrabiya", "qanater"],
];

// id → cell index mapping (cells are keyed in this fixed order in copy)
const KEYS: MotifTileId[] = [
  "mashrabiya",
  "zellige",
  "qanater",
  "muqarnas",
  "tadelakt",
  "cedar",
  "brass",
  "limestone",
  "hammam",
  "majlis",
  "riad",
  "mihrab",
];

// resolve node by id
const byNode: Record<MotifTileId, AtlasNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
) as Record<MotifTileId, AtlasNode>;

export default function Atlas() {
  const { isArabic } = useThemeLanguage();
  const copy = useCinemaCopy().atlas;

  const [hover, setHover] = useState<MotifTileId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLElement>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const visible = useInView(ref, 0.15);

  // map id → translated copy
  const byId = Object.fromEntries(
    copy.cells.map((cell, i) => [KEYS[i], cell])
  ) as Record<MotifTileId, { en: string; ar: string }>;

  // edges totals — used for staggered draw-in animation
  const eTotal = EDGES.length;

  // Mouse parallax — write node transforms directly via refs.
  // (Avoids per-move setState; matches the prototype's normalization.)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const my = ((e.clientY - r.top) / r.height - 0.5) * 2;
      NODES.forEach((n, i) => {
        const node = nodeRefs.current[n.id];
        if (!node) return;
        const px = mx * (0.4 + (i % 3) * 0.2);
        const py = my * (0.4 + (i % 3) * 0.2);
        node.style.transform = `translate(calc(-50% + ${px * 14}px), calc(-50% + ${py * 14}px))`;
      });
    };
    const onLeave = () => {
      NODES.forEach((n) => {
        const node = nodeRefs.current[n.id];
        if (node) node.style.transform = "translate(-50%, -50%)";
      });
      setHover(null);
    };
    const el = containerRef.current;
    window.addEventListener("mousemove", onMove, { passive: true });
    el?.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      el?.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <section className="atlas-constellation" ref={ref}>
      <div className="act-label">
        <span className="num">III</span>
        <span>
          {copy.eyebrow
            .replace(/^Act\s+\w+\s*—\s*/, "")
            .replace(/^الفصل[^—]*—\s*/, "")}
        </span>
      </div>
      <DustLayer count={36} seed={43} />

      <div className="head">
        <h2>
          {copy.title.map((w, i) => (
            <span key={i}>
              <span className={i === copy.italicIdx ? "italic" : ""}>{w}</span>
              {i < copy.title.length - 1 ? " " : ""}
            </span>
          ))}
        </h2>
        <p>{copy.lede}</p>
      </div>

      <div className="constellation" ref={containerRef}>
        {/* SVG: edges */}
        <svg className="lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="rgba(212,175,55,0.0)" />
              <stop offset="0.5" stopColor="rgba(212,175,55,0.55)" />
              <stop offset="1" stopColor="rgba(212,175,55,0.0)" />
            </linearGradient>
          </defs>
          {EDGES.map(([a, b], i) => {
            const A = byNode[a];
            const B = byNode[b];
            if (!A || !B) return null;
            const len = Math.hypot(B.x - A.x, B.y - A.y);
            const delay = (i / eTotal) * 1.6;
            const active = hover !== null && (hover === a || hover === b);
            return (
              <line
                key={`${a}-${b}`}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke={active ? "rgba(240, 215, 140, 0.9)" : "url(#line-grad)"}
                strokeWidth={active ? 0.18 : 0.1}
                strokeDasharray={len}
                strokeDashoffset={visible ? 0 : len}
                style={{
                  transition: `stroke-dashoffset 1400ms ${delay}s var(--ease-cinema), stroke 320ms, stroke-width 320ms`,
                  vectorEffect: "non-scaling-stroke",
                }}
              />
            );
          })}
        </svg>

        {/* Nodes (positioned absolutely; not in the SVG so HTML hover/SVG children work) */}
        {NODES.map((n, i) => {
          const cell = byId[n.id];
          const TileSvg = MotifTiles[n.id];
          const drawDelay = i * 80 + 400;
          const isHover = hover === n.id;
          return (
            <div
              key={n.id}
              ref={(el) => {
                nodeRefs.current[n.id] = el;
              }}
              className={cn("node", isHover && "is-hover", visible && "in")}
              style={
                {
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  transform: "translate(-50%, -50%)",
                  "--size": `${n.size}`,
                  transitionDelay: visible ? `${drawDelay}ms` : "0ms",
                } as React.CSSProperties
              }
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
            >
              <div className="disc">
                <div className="motif">
                  <TileSvg />
                </div>
                <span className="ring"></span>
                <span className="pip"></span>
              </div>
              <div className={cn("label", isHover && "on")}>
                <span className="en">{cell.en}</span>
                <span className="ar">{cell.ar}</span>
              </div>
            </div>
          );
        })}

        {/* Center anchor — "dar" calligraphic mark */}
        <div className="center-mark" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <defs>
              <radialGradient id="ctr-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="rgba(240,215,140,0.55)" />
                <stop offset="1" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="46" fill="url(#ctr-glow)" />
          </svg>
          <span className="dar">{isArabic ? "دار" : "Dar"}</span>
        </div>
      </div>
    </section>
  );
}
