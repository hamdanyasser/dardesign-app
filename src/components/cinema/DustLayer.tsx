"use client";

import { useMemo } from "react";

/* Deterministic, seeded gold-dust particle field. Same seed → same
   layout every render (SSR-stable, no Math.random / Date). Ported
   from dar-design-2 (ornaments.jsx DustLayer). */

function seeded(i: number, seed: number, n: number): number {
  const v = Math.sin((i + 1) * seed * (n + 1)) * 10000;
  return v - Math.floor(v);
}

interface DustLayerProps {
  count?: number;
  seed?: number;
}

export default function DustLayer({ count = 20, seed = 1 }: DustLayerProps) {
  const motes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const dur = 8 + seeded(i, seed, 2) * 14;
        return {
          left: seeded(i, seed, 1) * 100,
          dur,
          delay: -seeded(i, seed, 3) * dur,
          size: 1 + seeded(i, seed, 4) * 2.2,
          bottom: -10 + seeded(i, seed, 5) * 20,
        };
      }),
    [count, seed]
  );

  return (
    <div className="dust-layer" aria-hidden>
      {motes.map((m, i) => (
        <span
          key={i}
          className="mote"
          style={{
            left: `${m.left}%`,
            bottom: `${m.bottom}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            animationDuration: `${m.dur}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
