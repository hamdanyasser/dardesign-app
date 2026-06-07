"use client";

/* ============================================================
   Manifesto interstitial — reveal-up staggered quote.
   Ported from dar-design-2 (jsx/landing-parts.jsx Manifesto).
   ============================================================ */

import { useRef } from "react";
import { useCinemaCopy } from "@/components/cinema/copy";
import { useInView } from "@/components/cinema/hooks";
import DustLayer from "@/components/cinema/DustLayer";

export default function Manifesto() {
  const copy = useCinemaCopy().manifesto;
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, 0.3);

  return (
    <section className="manifesto" ref={ref}>
      <DustLayer count={18} seed={11} />
      <div className="eyebrow" style={{ marginBottom: "var(--s-7)" }}>{copy.pre}</div>
      <blockquote>
        {copy.quote.map((w, i) => (
          <span
            key={i}
            className={"reveal-up " + (visible ? "in " : "") + (i > 4 ? "d4" : i > 2 ? "d3" : i > 0 ? "d2" : "")}
            style={{ display: "inline-block", marginInlineEnd: 12 }}
          >
            <span className={i === copy.italicIdx ? "italic" : ""}>{w}</span>
          </span>
        ))}
      </blockquote>
      <div className="attribution">{copy.attribution}</div>
    </section>
  );
}
