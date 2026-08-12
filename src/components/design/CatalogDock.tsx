"use client";

/* ============================================================
   The catalogue rail.

   Docked to the bottom edge and collapsible, because the brief that
   matters most is "the room dominates". A left sidebar would eat a
   third of the model permanently; a horizontal rail costs 150px and
   folds away to 38px.

   The cut-out PNGs are used HERE and only here. In the card they are
   the honest thing — a photograph of the piece. In the 3D scene they
   would be a billboard, which is the sticker problem this editor exists
   to avoid, so the scene builds real volumes instead.
   ============================================================ */

import { useMemo } from "react";
import { CULTURE_LABEL, catalogFor, categoryLabel, sortByCategory } from "@/lib/design/catalog";
import { CULTURE_ACCENT } from "@/lib/design/materials";
import type { CatalogItem, SceneCulture } from "@/lib/design/types";
import type { StyleId } from "@/context/ImageContext";

const CULTURES: SceneCulture[] = ["lebanese", "khaleeji", "moroccan", "all"];

export interface CatalogDockProps {
  isArabic: boolean;
  culture: SceneCulture;
  onCulture: (c: SceneCulture) => void;
  collapsed: boolean;
  onToggle: () => void;
  onDragStart: (item: CatalogItem, clientX: number, clientY: number) => void;
  onQuickAdd: (item: CatalogItem) => void;
  draggingId: string | null;
}

export default function CatalogDock({
  isArabic,
  culture,
  onCulture,
  collapsed,
  onToggle,
  onDragStart,
  onQuickAdd,
  draggingId,
}: CatalogDockProps) {
  const items = useMemo(() => sortByCategory(catalogFor(culture)), [culture]);

  // Grouped so the rail reads as a catalogue rather than a bin of things.
  const groups = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const it of items) {
      const arr = m.get(it.category) ?? [];
      arr.push(it);
      m.set(it.category, arr);
    }
    return Array.from(m.entries());
  }, [items]);

  return (
    <div className={"dock" + (collapsed ? " collapsed" : "")}>
      <div
        className="dock-head"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="dock-title">
          {isArabic ? "الأثاث" : "Catalogue"} · {items.length}
        </span>
        <div className="culture-tabs" onClick={(e) => e.stopPropagation()}>
          {CULTURES.map((c) => (
            <button
              key={c}
              className="culture-tab"
              aria-pressed={culture === c}
              onClick={() => onCulture(c)}
            >
              {isArabic ? CULTURE_LABEL[c].ar : CULTURE_LABEL[c].en}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="dock-title" aria-hidden>
          {collapsed ? "▲" : "▼"}
        </span>
      </div>

      <div className="rail" role="list">
        {groups.map(([cat, list]) => (
          <div key={cat} style={{ display: "flex", gap: 10, flex: "0 0 auto", alignItems: "stretch" }}>
            <div
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontFamily: "var(--f-mono)",
                fontSize: "0.5rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
                padding: "4px 0",
                alignSelf: "center",
              }}
            >
              {categoryLabel(cat, isArabic)}
            </div>
            {list.map((item) => (
              <button
                key={item.id}
                role="listitem"
                className={"card" + (draggingId === item.id ? " dragging" : "")}
                // Pointer-based rather than HTML5 drag: the ghost must be the
                // real 3D volume in the scene, not a browser drag image.
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  onDragStart(item, e.clientX, e.clientY);
                }}
                // Keyboard and click both fall back to auto-placement, so the
                // catalogue is fully usable without a pointer drag.
                onClick={() => onQuickAdd(item)}
                title={
                  isArabic
                    ? `${item.nameAr} — اسحب إلى الغرفة أو انقر للإضافة`
                    : `${item.nameEn} — drag into the room, or click to place`
                }
              >
                <span
                  className="stripe"
                  style={{ background: CULTURE_ACCENT[item.culture as StyleId] }}
                  aria-hidden
                />
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.assetUrl} alt="" draggable={false} />
                </figure>
                <figcaption>
                  <span className="nm">{isArabic ? item.nameAr : item.nameEn}</span>
                  <span className="dim">
                    {item.widthCm}×{item.depthCm} CM
                  </span>
                </figcaption>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
