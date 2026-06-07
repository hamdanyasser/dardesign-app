"use client";

/* ============================================================
   MotifTiles — the 12 cultural-motif glyphs used as node icons
   in the Atlas constellation. Ported verbatim from dar-design-2
   (ornaments.jsx → MotifTiles). Each tile is a self-contained
   100x100 SVG keyed by motif id; the Atlas indexes MotifTiles[id].
   ============================================================ */

import type { FC } from "react";

export type MotifTileId =
  | "mashrabiya"
  | "zellige"
  | "qanater"
  | "muqarnas"
  | "tadelakt"
  | "cedar"
  | "brass"
  | "limestone"
  | "hammam"
  | "majlis"
  | "riad"
  | "mihrab";

export const MotifTiles: Record<MotifTileId, FC> = {
  mashrabiya: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#1a1208" />
      <g stroke="#d4af37" strokeWidth="0.6" fill="none" opacity="0.85">
        {[0, 25, 50, 75, 100].map((y, i) =>
          [0, 25, 50, 75, 100].map((x, j) => (
            <g key={`${i}-${j}`} transform={`translate(${x} ${y})`}>
              <path d="M0 -8 L4 -2 L10 -2 L5 3 L7 10 L0 6 L-7 10 L-5 3 L-10 -2 L-4 -2 Z" />
            </g>
          ))
        )}
      </g>
    </svg>
  ),
  zellige: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#1f4287" />
      <g>
        {[0, 50].map((y) =>
          [0, 50].map((x) => (
            <g key={`${x}-${y}`} transform={`translate(${x + 25} ${y + 25})`}>
              <path
                d="M0 -18 L5 -5 L18 -5 L8 4 L12 18 L0 10 L-12 18 L-8 4 L-18 -5 L-5 -5 Z"
                fill="#ede4d2"
              />
              <path
                d="M0 -10 L3 -3 L10 -3 L5 2 L7 10 L0 6 L-7 10 L-5 2 L-10 -3 L-3 -3 Z"
                fill="#c44a36"
              />
              <circle r="2.5" fill="#d4a24a" />
            </g>
          ))
        )}
      </g>
    </svg>
  ),
  qanater: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#c9a876" />
      <rect width="100" height="100" fill="#1a1208" opacity="0.1" />
      <g fill="#1a1208">
        <path d="M10 100 V60 Q10 35 25 35 Q40 35 40 60 V100 Z" />
        <path d="M42 100 V60 Q42 35 50 35 Q58 35 58 60 V100 Z" />
        <path d="M60 100 V60 Q60 35 75 35 Q90 35 90 60 V100 Z" />
      </g>
      <g fill="#d4af37">
        <circle cx="25" cy="35" r="1.5" />
        <circle cx="50" cy="35" r="1.5" />
        <circle cx="75" cy="35" r="1.5" />
      </g>
    </svg>
  ),
  muqarnas: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#ede4d2" />
      <g fill="none" stroke="#1f4287" strokeWidth="0.6">
        {[0, 12, 24, 36, 48, 60, 72, 84, 96].map((y, i) => (
          <g key={i}>
            {[0, 16, 32, 48, 64, 80, 96].map((x, j) => (
              <path key={j} d={`M${x} ${y} Q${x + 8} ${y + 6} ${x + 16} ${y}`} />
            ))}
          </g>
        ))}
      </g>
      <g fill="#d4af37">
        {[0, 12, 24, 36, 48, 60, 72, 84, 96].map(
          (y, i) =>
            i % 2 === 0 &&
            [0, 16, 32, 48, 64, 80].map((x) => (
              <circle key={x + y} cx={x + 12} cy={y + 3} r="1" />
            ))
        )}
      </g>
    </svg>
  ),
  tadelakt: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="tdl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8dcc0" />
          <stop offset="0.5" stopColor="#cab985" />
          <stop offset="1" stopColor="#a08458" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#tdl)" />
      <g opacity="0.4">
        <path d="M0 30 Q30 20 60 35 T 100 30" fill="none" stroke="#fff" strokeWidth="0.4" />
        <path d="M0 70 Q30 60 60 75 T 100 70" fill="none" stroke="#fff" strokeWidth="0.3" />
      </g>
    </svg>
  ),
  cedar: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#2f5a4a" />
      <g fill="#1d3d2f">
        <path d="M30 100 L40 30 L50 100 Z" />
        <path d="M55 100 L65 20 L75 100 Z" />
        <path d="M10 100 L18 50 L26 100 Z" />
        <path d="M78 100 L86 45 L94 100 Z" />
      </g>
      <g fill="#1a1208" opacity="0.3">
        <rect width="100" height="100" />
      </g>
    </svg>
  ),
  brass: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="brs" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f0d78c" />
          <stop offset="0.6" stopColor="#d4af37" />
          <stop offset="1" stopColor="#5e4d1f" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="#1a1208" />
      <circle cx="50" cy="50" r="34" fill="url(#brs)" />
      <g fill="none" stroke="#1a1208" strokeWidth="0.6">
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1="50"
            y1="50"
            x2={50 + Math.cos((i * Math.PI) / 6) * 34}
            y2={50 + Math.sin((i * Math.PI) / 6) * 34}
          />
        ))}
        <circle cx="50" cy="50" r="20" fill="none" />
        <circle cx="50" cy="50" r="10" fill="none" />
      </g>
    </svg>
  ),
  limestone: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#c9a876" />
      <g stroke="#1a1208" strokeWidth="0.4" opacity="0.5">
        <line x1="0" y1="20" x2="100" y2="20" />
        <line x1="0" y1="40" x2="100" y2="40" />
        <line x1="0" y1="60" x2="100" y2="60" />
        <line x1="0" y1="80" x2="100" y2="80" />
        <line x1="25" y1="0" x2="25" y2="20" />
        <line x1="50" y1="20" x2="50" y2="40" />
        <line x1="75" y1="0" x2="75" y2="20" />
        <line x1="40" y1="60" x2="40" y2="80" />
        <line x1="65" y1="40" x2="65" y2="60" />
      </g>
    </svg>
  ),
  hammam: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#1a6e5c" />
      <g fill="none" stroke="#ede4d2" strokeWidth="0.5">
        <circle cx="50" cy="50" r="22" />
        <circle cx="50" cy="50" r="14" />
        <circle cx="50" cy="50" r="6" />
        {[0, 45, 90, 135].map((a) => (
          <line key={a} transform={`rotate(${a} 50 50)`} x1="20" y1="50" x2="80" y2="50" />
        ))}
      </g>
      <g fill="#ede4d2">
        <circle cx="50" cy="14" r="4" />
        <circle cx="50" cy="86" r="4" />
      </g>
    </svg>
  ),
  majlis: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#0d1429" />
      <g>
        <rect x="0" y="60" width="100" height="40" fill="#6e1f2c" />
        <rect x="0" y="58" width="100" height="2" fill="#d4af37" />
        {Array.from({ length: 5 }).map((_, i) => (
          <rect
            key={i}
            x={i * 20 + 2}
            y="50"
            width="16"
            height="14"
            rx="2"
            fill="#6e1f2c"
            stroke="#d4af37"
            strokeWidth="0.4"
          />
        ))}
      </g>
      <g fill="#d4af37">
        <circle cx="50" cy="25" r="6" opacity="0.9" />
        <circle cx="50" cy="25" r="12" opacity="0.35" />
        <line x1="50" y1="0" x2="50" y2="20" stroke="#d4af37" strokeWidth="0.4" />
      </g>
    </svg>
  ),
  riad: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#1f4287" />
      <rect x="20" y="0" width="60" height="100" fill="#0d1429" />
      {/* keyhole arch */}
      <path d="M30 100 V40 Q30 14 50 14 Q70 14 70 40 V100 Z" fill="#ede4d2" />
      <ellipse cx="50" cy="78" rx="14" ry="3" fill="#1a6e5c" />
      <path d="M48 64 V60" stroke="#cab985" strokeWidth="0.6" />
      <path d="M40 60 Q34 50 28 52" fill="#1a6e5c" />
      <path d="M60 60 Q66 50 72 52" fill="#1a6e5c" />
    </svg>
  ),
  mihrab: () => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#ede4d2" />
      <path d="M30 100 V40 Q30 10 50 10 Q70 10 70 40 V100 Z" fill="#1f4287" />
      <path
        d="M30 100 V40 Q30 10 50 10 Q70 10 70 40 V100 Z"
        fill="none"
        stroke="#d4af37"
        strokeWidth="0.8"
      />
      <g fill="none" stroke="#d4af37" strokeWidth="0.5">
        <circle cx="50" cy="45" r="14" />
        <circle cx="50" cy="45" r="7" />
        <line x1="50" y1="22" x2="50" y2="14" />
        <line x1="50" y1="68" x2="50" y2="100" />
      </g>
      <circle cx="50" cy="45" r="2" fill="#d4af37" />
    </svg>
  ),
};

// ---------- POINTED ARCH frame (used in coda / landing) ----------
export const PointedArchFrame: FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 400 480" preserveAspectRatio="xMidYMid meet" className={className}>
    <defs>
      <linearGradient id="arch-frame-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f0d78c" />
        <stop offset="1" stopColor="#8b7432" />
      </linearGradient>
    </defs>
    <path
      d="M40 480 V200 Q40 40 200 40 Q360 40 360 200 V480 Z"
      fill="none"
      stroke="url(#arch-frame-grad)"
      strokeWidth="2"
    />
    <path
      d="M60 480 V210 Q60 60 200 60 Q340 60 340 210 V480 Z"
      fill="none"
      stroke="url(#arch-frame-grad)"
      strokeWidth="0.6"
    />
    {/* keystone */}
    <circle cx="200" cy="40" r="4" fill="#f0d78c" />
    {/* tracery */}
    <g fill="none" stroke="url(#arch-frame-grad)" strokeWidth="0.5" opacity="0.7">
      <path d="M120 200 Q200 80 280 200" />
      <path d="M80 280 Q200 140 320 280" />
      <circle cx="200" cy="200" r="40" />
      <circle cx="200" cy="200" r="22" />
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={i}
          x1="200"
          y1="200"
          x2={200 + Math.cos((i * Math.PI) / 4) * 40}
          y2={200 + Math.sin((i * Math.PI) / 4) * 40}
        />
      ))}
    </g>
  </svg>
);

export default MotifTiles;
