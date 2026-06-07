"use client";

/* ============================================================
   Coda CTA — pointed-arch frame + reveal-up title/sub/cta.
   Ported from dar-design-2 (jsx/landing-parts.jsx Coda).
   PointedArchFrame inlined from jsx/ornaments.jsx.
   ============================================================ */

import { Fragment, useRef } from "react";
import { useCinemaCopy } from "@/components/cinema/copy";
import { useInView } from "@/components/cinema/hooks";
import DustLayer from "@/components/cinema/DustLayer";

interface CodaProps {
  onBegin: () => void;
}

function PointedArchFrame({ className }: { className?: string }) {
  return (
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
}

export default function Coda({ onBegin }: CodaProps) {
  const copy = useCinemaCopy().coda;
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, 0.2);

  return (
    <section className="coda" ref={ref}>
      <DustLayer count={22} seed={13} />
      <div className="arch-frame">
        <PointedArchFrame />
      </div>
      <h2 className={"reveal-up " + (visible ? "in" : "")}>
        {copy.title.map((w, i) => (
          <Fragment key={i}>
            <span className={i === copy.italicIdx ? "italic" : ""}>{w}</span>
            {i < copy.title.length - 1 ? " " : ""}
          </Fragment>
        ))}
      </h2>
      <p className={"reveal-up d2 " + (visible ? "in" : "")}>{copy.sub}</p>
      <div className={"reveal-up d3 " + (visible ? "in" : "")}>
        <button className="btn" onClick={onBegin}>
          <span>{copy.cta}</span>
          <span className="arrow">→</span>
        </button>
      </div>
    </section>
  );
}
