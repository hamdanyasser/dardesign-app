"use client";

/* 404 — the closed-door scene (ported from dar-design-2 errors.jsx). */

import Link from "next/link";
import { useCinemaCopy } from "@/components/cinema/copy";
import DustLayer from "@/components/cinema/DustLayer";

export default function NotFound() {
  const copy = useCinemaCopy().nf;

  return (
    <div className="cinema">
      <section className="nf-scene">
        <DustLayer count={22} seed={31} />
        <div>
          <div className="glyph">
            {/* closed door glyph */}
            <svg viewBox="0 0 240 240" fill="none" stroke="currentColor" strokeWidth="1">
              <defs>
                <linearGradient id="nf-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f0d78c" />
                  <stop offset="1" stopColor="#8b7432" />
                </linearGradient>
              </defs>
              <g stroke="url(#nf-grad)" strokeWidth="1.2" fill="none">
                <path d="M50 220 V100 Q50 30 120 30 Q190 30 190 100 V220 Z" />
                <path d="M70 220 V110 Q70 50 120 50 Q170 50 170 110 V220 Z" />
                <circle cx="120" cy="135" r="6" fill="url(#nf-grad)" />
                <line x1="120" y1="60" x2="120" y2="195" />
                {/* hinges */}
                <circle cx="60" cy="120" r="2" fill="url(#nf-grad)" />
                <circle cx="60" cy="170" r="2" fill="url(#nf-grad)" />
                <circle cx="180" cy="120" r="2" fill="url(#nf-grad)" />
                <circle cx="180" cy="170" r="2" fill="url(#nf-grad)" />
                <line x1="20" y1="220" x2="220" y2="220" />
              </g>
            </svg>
          </div>
          <div className="code">{copy.code}</div>
          <h1>
            {copy.title.map((w, i) => (
              <span key={i} className={i === copy.italicIdx ? "italic" : ""}>
                {w}
                {i < copy.title.length - 1 ? " " : ""}
              </span>
            ))}
          </h1>
          <p>{copy.message}</p>
          <Link className="btn" href="/">
            <span>{copy.cta}</span>
            <span className="arrow">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
