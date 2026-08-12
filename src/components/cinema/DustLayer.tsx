"use client";

import { useMemo } from "react";

/* Deterministic, seeded gold-dust particle field. Same seed → same
   layout every render (SSR-stable, no Math.random / Date). Ported
   from dar-design-2 (ornaments.jsx DustLayer). */

function seeded(i: number, seed: number, n: number): number {
  const v = Math.sin((i + 1) * seed * (n + 1)) * 10000;
  return v - Math.floor(v);
}

/* Math.sin is not guaranteed to be bit-identical between the Node build that
   renders on the server and the browser's engine. The values agreed to ~10
   decimals but not beyond, and React compares the *stringified* style, so
   every mote produced a hydration mismatch warning. Rounding to 4dp is far
   below one device pixel and makes the two renders agree exactly. */
function q(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

interface DustLayerProps {
  count?: number;
  seed?: number;
}

export default function DustLayer({ count = 20, seed = 1 }: DustLayerProps) {
  const motes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const dur = q(8 + seeded(i, seed, 2) * 14);
        return {
          left: q(seeded(i, seed, 1) * 100),
          dur,
          delay: q(-seeded(i, seed, 3) * dur),
          size: q(1 + seeded(i, seed, 4) * 2.2),
          bottom: q(-10 + seeded(i, seed, 5) * 20),
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
