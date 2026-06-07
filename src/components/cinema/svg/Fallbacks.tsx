/* Static SVG fallbacks rendered when WebGL is suppressed
   (reduced-motion, no-WebGL, or low-end devices). They echo the
   silhouettes of the Three.js scenes so the composition holds. */

import type { OrnamentVariant } from "@/lib/three/types";

export function StaticArch({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 520"
      preserveAspectRatio="xMidYMax meet"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }}
    >
      <defs>
        <linearGradient id="fb-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brass-bright)" />
          <stop offset="1" stopColor="var(--brass-dim)" />
        </linearGradient>
        <radialGradient id="fb-glow" cx="0.5" cy="0.42" r="0.5">
          <stop offset="0" stopColor="var(--brass)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--brass)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="520" fill="url(#fb-glow)" />
      <g transform="translate(200 500)" fill="none" stroke="url(#fb-brass)" strokeWidth="3">
        <path d="M-130 0 V-200 Q-130 -380 0 -380 Q130 -380 130 -200 V0" />
        <path d="M-104 0 V-190 Q-104 -350 0 -350 Q104 -350 104 -190 V0" strokeWidth="1" opacity="0.6" />
        <circle cx="0" cy="-380" r="5" fill="url(#fb-brass)" stroke="none" />
      </g>
    </svg>
  );
}

const STAR_FILL: Record<OrnamentVariant, string> = {
  lebanese: "#b89460",
  khaleeji: "#d4af37",
  moroccan: "#2756a8",
};

export function StaticStar({ variant = "khaleeji" }: { variant?: OrnamentVariant }) {
  // 16-vertex eight-pointed star, matching the 3D ornament silhouette.
  const r = 90;
  const inner = r * 0.42;
  const pts: string[] = [];
  for (let a = 0; a < 16; a++) {
    const theta = (a / 16) * Math.PI * 2 - Math.PI / 2;
    const rad = a % 2 === 0 ? r : inner;
    pts.push(`${(Math.cos(theta) * rad).toFixed(2)},${(Math.sin(theta) * rad).toFixed(2)}`);
  }
  return (
    <svg
      aria-hidden
      viewBox="-140 -140 280 280"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <defs>
        <radialGradient id="fb-star-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--brass)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--brass)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r="130" fill="url(#fb-star-glow)" />
      <circle cx="0" cy="0" r="106" fill="none" stroke="var(--brass)" strokeWidth="1.5" opacity="0.55" />
      <polygon
        points={pts.join(" ")}
        fill={STAR_FILL[variant]}
        stroke="var(--brass-bright)"
        strokeWidth="2"
        opacity="0.92"
      />
      <circle cx="0" cy="0" r="13" fill="var(--brass-bright)" />
    </svg>
  );
}
