"use client";

/* ============================================================
   Plan minimap.

   The same scene, drawn as an architect would draw it: outline, hairline
   footprints, no perspective. It earns its corner by doing two things
   the 3D view cannot — it shows the whole plan at once while you are
   zoomed in, and it makes clear that Build Mode holds a real metric
   layout rather than a picture of one.

   Clicking a footprint selects and frames that object.
   ============================================================ */

import { corners, rectOf } from "@/lib/design/placement";
import type { DesignScene } from "@/lib/design/types";

const W = 150;

export default function PlanMinimap({
  scene,
  selectedUid,
  accent,
  isArabic,
  onPick,
}: {
  scene: DesignScene;
  selectedUid: string | null;
  accent: string;
  isArabic: boolean;
  onPick: (uid: string) => void;
}) {
  const { widthCm, depthCm } = scene.room;
  const scale = W / Math.max(widthCm, depthCm);
  const w = widthCm * scale;
  const d = depthCm * scale;

  // Room space (origin at centre) → SVG space (origin top-left).
  const px = (x: number) => x * scale + w / 2;
  const pz = (z: number) => z * scale + d / 2;

  return (
    <div className="minimap">
      <div className="minimap-title">
        {isArabic ? "المسقط" : "Plan"} · {(widthCm / 100).toFixed(1)}×{(depthCm / 100).toFixed(1)} M
      </div>
      <svg width={w} height={d} viewBox={`0 0 ${w} ${d}`} role="img" aria-label={isArabic ? "مسقط الغرفة" : "Room plan"}>
        <rect x={0.5} y={0.5} width={w - 1} height={d - 1} fill="none" stroke="var(--hairline-2)" strokeWidth={1} />
        {scene.objects.map((o) => {
          const pts = corners(rectOf(o))
            .map(([x, z]) => `${px(x).toFixed(1)},${pz(z).toFixed(1)}`)
            .join(" ");
          const sel = o.uid === selectedUid;
          const isFound = o.origin === "found";
          return (
            <polygon
              key={o.uid}
              points={pts}
              fill={sel ? accent : isFound ? "var(--fg-faint)" : "var(--fg-mute)"}
              fillOpacity={sel ? 0.55 : isFound ? 0.16 : 0.3}
              stroke={sel ? accent : "var(--fg-faint)"}
              strokeWidth={sel ? 1.4 : 0.7}
              strokeDasharray={isFound ? "2 2" : undefined}
              style={{ cursor: "pointer" }}
              onClick={() => onPick(o.uid)}
            >
              <title>{isArabic ? o.labelAr : o.labelEn}</title>
            </polygon>
          );
        })}
      </svg>
    </div>
  );
}
