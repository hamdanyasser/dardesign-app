"use client";

/** Atelier hero — three layered Islamic arches with mouse parallax + name reveal. */

import { useEffect, useRef } from "react";
import { useMouseParallax, type CssVars } from "./effects";
import { CalligraphyDar, DustMotes } from "./extras";

interface ArchProps {
  className?: string;
  w: number;
  h: number;
  color?: string;
  stroke?: string;
  opacity?: number;
}

function Arch({ className, w, h, color, stroke, opacity }: ArchProps) {
  const ax = w / 2;
  const apex = 8;
  const base = h - 8;
  const sides = 14;
  const tip = h * 0.28;
  const d = `
    M ${sides} ${base}
    L ${sides} ${tip + (h - tip) * 0.05}
    Q ${sides} ${tip * 0.55} ${ax - 12} ${tip * 0.5}
    Q ${ax} ${apex} ${ax + 12} ${tip * 0.5}
    Q ${w - sides} ${tip * 0.55} ${w - sides} ${tip + (h - tip) * 0.05}
    L ${w - sides} ${base} Z
  `;
  return (
    <path
      d={d}
      className={className}
      fill={color || "none"}
      stroke={stroke}
      strokeWidth="1.2"
      opacity={opacity}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function HeroArches() {
  const stageRef = useRef<HTMLDivElement>(null);
  useMouseParallax(stageRef);
  useEffect(() => {
    const t = setTimeout(() => {
      stageRef.current?.classList.add("entered", "tilt-init");
    }, 200);
    return () => clearTimeout(t);
  }, []);

  const stageStyle: CssVars = {
    transform: "rotateX(calc(var(--my,0)*-3deg)) rotateY(calc(var(--mx,0)*4deg))",
  };

  return (
    <div className="hero-stage" ref={stageRef} style={stageStyle}>
      <svg viewBox="0 0 1400 700" preserveAspectRatio="xMidYEnd meet" aria-hidden="true">
        <defs>
          <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1a140d" stopOpacity="0" />
            <stop offset="1" stopColor="#1a140d" stopOpacity=".9" />
          </linearGradient>
          <radialGradient id="lamp" cx=".5" cy=".2" r=".7">
            <stop offset="0" stopColor="#f3dc92" stopOpacity=".25" />
            <stop offset="1" stopColor="#f3dc92" stopOpacity="0" />
          </radialGradient>
          <pattern id="zellige" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M24 0 L48 24 L24 48 L0 24 Z" fill="none" stroke="#d4af37" strokeOpacity=".18" strokeWidth=".6" />
            <circle cx="24" cy="24" r="3" fill="#d4af37" fillOpacity=".25" />
          </pattern>
        </defs>

        <ellipse cx="700" cy="140" rx="500" ry="220" fill="url(#lamp)" />

        <g style={{ transform: "translate(0px, 60px)" }} className="arch arch-back">
          <Arch w={1400} h={680} stroke="#d4af37" opacity={0.22} />
          <Arch w={1400} h={680} color="url(#zellige)" stroke="none" opacity={0.4} />
        </g>
        <g style={{ transform: "translate(160px, 100px)" }} className="arch arch-mid">
          <Arch w={1080} h={580} stroke="#d4af37" opacity={0.55} />
          <Arch w={1080} h={580} color="#0a0907" stroke="#d4af37" opacity={0.25} />
        </g>
        <g style={{ transform: "translate(380px, 130px)" }} className="arch arch-front">
          <Arch w={640} h={520} stroke="#d4af37" opacity={0.95} />
          <Arch w={640} h={520} color="rgba(0,0,0,.5)" stroke="#f3dc92" opacity={0.7} />
        </g>

        <rect x="0" y="640" width="1400" height="60" fill="url(#floor)" />

        <g transform="translate(700,160)">
          <line x1="0" y1="0" x2="0" y2="60" stroke="#d4af37" strokeOpacity=".5" strokeWidth=".8" />
          <circle cx="0" cy="80" r="14" fill="#0a0907" stroke="#f3dc92" strokeWidth=".8" />
          <circle cx="0" cy="80" r="6" fill="#f3dc92" />
          <circle cx="0" cy="80" r="22" fill="none" stroke="#f3dc92" strokeOpacity=".18" />
        </g>

        <g transform="translate(700, 80)" opacity=".4">
          <circle r="38" fill="none" stroke="#d4af37" strokeWidth=".6" />
          <circle r="22" fill="none" stroke="#d4af37" strokeWidth=".6" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={i} x1="0" y1="-38" x2="0" y2="38"
              stroke="#d4af37" strokeWidth=".4" strokeOpacity=".7"
              transform={`rotate(${i * 22.5})`} />
          ))}
        </g>
      </svg>
    </div>
  );
}

export function Hero() {
  return (
    <section className="hero" data-act="Act I · Threshold" data-screen-label="01 Threshold">
      <HeroArches />
      <DustMotes count={36} />
      <CalligraphyDar />
      <div className="hero-title">
        <span className="line1">Dar</span>
        <span className="line2">
          <i></i> The Atelier of Arabic Interiors <i></i>
        </span>
      </div>
      <div className="hero-arabic">بيت العمارة العربية</div>
      <div className="hero-scroll">Enter</div>
    </section>
  );
}
