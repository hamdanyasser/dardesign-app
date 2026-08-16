"use client";

/* ============================================================
   Provenance X-ray — drag a scan line across a finished render
   and see, underneath it, the depth this room was measured at
   and the elements the pipeline actually named.

   Why this exists. The hardest thing to convey about DAR is that
   it does not repaint a photograph: it measures the room, names
   what is in it against a cultural ontology, and conditions the
   generator on that. Every artefact proving it already comes back
   from /redesign — depth_map and seg_regions — and until now they
   lived in a separate tab, so the claim and the evidence were
   never on screen at the same time. Here they are the same image.

   HONESTY RULES, same as the story layer:
   - The component renders NOTHING unless a real depth map or real
     regions were supplied. There is no sample, no placeholder and
     no illustrative overlay; a caller passing a placeholder run
     passes null and this disappears.
   - Labels are the ontology's own labelAr/labelEn as returned, not
     re-translated or prettified here.
   - The caption states what the layer IS. "Depth Anything" is not
     claimed; the depth map is described as what the pipeline
     returned, because that is all the response proves.
   ============================================================ */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

export interface XrayRegion {
  classKey?: string;
  labelEn?: string;
  labelAr?: string;
  /** normalized [x, y, w, h], 0..1 from the top-left. */
  bbox: [number, number, number, number];
  area?: number;
}

export interface ProvenanceXrayProps {
  /** The finished render — what the user is looking at. */
  renderSrc: string;
  /** Real depth PNG data URL from this run, or null. */
  depthSrc?: string | null;
  /** Real returned regions from this run. */
  regions?: XrayRegion[] | null;
  className?: string;
}

/** Regions arrive normalized; anything outside the frame is a bad box. */
function usable(r: XrayRegion): boolean {
  const [x, y, w, h] = r.bbox ?? [];
  return (
    [x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001
  );
}

export default function ProvenanceXray({
  renderSrc,
  depthSrc,
  regions,
  className,
}: ProvenanceXrayProps) {
  const { isArabic } = useThemeLanguage();
  const frameRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();

  const boxes = (regions ?? []).filter(usable);
  const hasDepth = typeof depthSrc === "string" && depthSrc.trim().length > 0;
  // Nothing real to show: render nothing at all rather than an empty frame.
  if (!hasDepth && boxes.length === 0) return null;

  const setFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    setPos(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  }, []);

  // Pointer capture, so a drag keeps tracking after the cursor leaves the
  // frame — one code path for mouse, touch and pen (same reasoning as
  // BeforeAfterSlider, which this deliberately mirrors).
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") setPos((p) => Math.min(1, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(1);
    else return;
    e.preventDefault();
  };

  // A gentle first sweep so the affordance is discovered without a tooltip.
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    if (introDone) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setIntroDone(true); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1700);
      // out → in, settling at the middle
      setPos(0.5 + 0.32 * Math.sin(k * Math.PI) * (1 - k));
      if (k < 1) raf = requestAnimationFrame(tick);
      else setIntroDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [introDone]);

  const pct = pos * 100;

  return (
    <figure className={cn("dd-xray", className)} aria-labelledby={titleId}>
      <div
        ref={frameRef}
        className="dd-xray-frame"
        role="slider"
        tabIndex={0}
        aria-label={
          isArabic
            ? "اسحب لكشف العمق والعناصر التي تعرّف عليها النظام"
            : "Drag to reveal the depth and the elements the system identified"
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={
          isArabic ? `${Math.round(pct)}٪ كشف` : `${Math.round(pct)}% revealed`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {/* the finished room */}
        <img src={renderSrc} alt="" className="dd-xray-img" draggable={false} />

        {/* what it was measured as — clipped to the left of the scan line */}
        <div className="dd-xray-under" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
          {hasDepth ? (
            <img src={depthSrc as string} alt="" className="dd-xray-img dd-xray-depth" draggable={false} />
          ) : (
            <div className="dd-xray-img dd-xray-nodepth" />
          )}
          <svg className="dd-xray-boxes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {boxes.map((r, i) => {
              const [x, y, w, h] = r.bbox;
              return (
                <rect
                  key={`${r.classKey ?? "r"}-${i}`}
                  x={x * 100} y={y * 100} width={w * 100} height={h * 100}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {/* Labels are HTML, not SVG text: SVG text inside a non-uniform
              viewBox would be stretched with the box. */}
          {boxes.map((r, i) => {
            const [x, y, w, h] = r.bbox;
            const label = isArabic ? r.labelAr ?? r.labelEn : r.labelEn ?? r.labelAr;
            if (!label) return null;
            return (
              <span
                key={`l-${r.classKey ?? i}-${i}`}
                className="dd-xray-label"
                style={{ left: `${(x + w / 2) * 100}%`, top: `${(y + h / 2) * 100}%` }}
              >
                {label}
              </span>
            );
          })}
        </div>

        {/* the scan line */}
        <div className="dd-xray-line" style={{ left: `${pct}%` }} aria-hidden="true">
          <i />
          <span className="dd-xray-grip" />
        </div>

        <span className="dd-xray-tag dd-xray-tag-left" aria-hidden="true">
          {isArabic ? "ما قاسه النظام" : "MEASURED"}
        </span>
        <span className="dd-xray-tag dd-xray-tag-right" aria-hidden="true">
          {isArabic ? "التصميم" : "DESIGNED"}
        </span>
      </div>

      <figcaption id={titleId} className="dd-xray-cap">
        {isArabic
          ? `العمق وحدود العناصر التي أعادها هذا التوليد — ${boxes.length} عنصراً مسمّى. ليست رسماً توضيحياً.`
          : `The depth and element boundaries this run returned — ${boxes.length} named ${boxes.length === 1 ? "element" : "elements"}. Not an illustration.`}
      </figcaption>
    </figure>
  );
}
