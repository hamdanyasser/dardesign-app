"use client";

/* Route-level error boundary — the broken-arch scene
   (ported from dar-design-2 errors.jsx). */

import { useEffect } from "react";
import Link from "next/link";
import { useCinemaCopy } from "@/components/cinema/copy";
import DustLayer from "@/components/cinema/DustLayer";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = useCinemaCopy().error;

  useEffect(() => {
    // Surface for debugging; production logging can hook in here.
    console.error(error);
  }, [error]);

  return (
    <div className="cinema">
      <section className="error-scene">
        <DustLayer count={18} seed={29} />
        <div>
          <div className="glyph">
            {/* broken arch glyph */}
            <svg viewBox="0 0 240 240" fill="none" stroke="currentColor" strokeWidth="1">
              <defs>
                <linearGradient id="err-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e85d4a" />
                  <stop offset="1" stopColor="#5e2a1a" />
                </linearGradient>
              </defs>
              <g stroke="url(#err-grad)" strokeWidth="1.4" fill="none">
                <path d="M40 220 V120 Q40 50 100 50 L 120 50" />
                {/* break + offset */}
                <path d="M124 56 L 134 44 L 120 50 Z" fill="url(#err-grad)" stroke="none" />
                <path d="M130 60 L 144 48" />
                <path d="M140 50 Q 200 50 200 120 V220" />
                <line x1="20" y1="220" x2="220" y2="220" />
              </g>
              <g fill="url(#err-grad)">
                <circle cx="100" cy="50" r="3" />
                <circle cx="140" cy="50" r="3" />
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
          <div
            style={{
              display: "flex",
              gap: "var(--s-4)",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button className="btn" onClick={() => reset()}>
              <span>{copy.cta}</span>
              <span className="arrow">↻</span>
            </button>
            <Link className="btn ghost" href="/">
              <span>{copy.home}</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
