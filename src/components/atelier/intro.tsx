"use client";

/**
 * Cinema-intro overlay, gold-dust cursor trail, scroll-triggered counter,
 * ambient rotating mandala. Ported from atelier-intro.jsx.
 */

import { useEffect, useRef, useState } from "react";

export function CinemaIntro() {
  const [phase, setPhase] = useState(0); // 0 dark+drawing, 1 title-flash, 2 bars-retract, 3 gone

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const t1 = setTimeout(() => setPhase(1), 2400);
    const t2 = setTimeout(() => setPhase(2), 3400);
    const t3 = setTimeout(() => {
      setPhase(3);
      document.body.style.overflow = "";
    }, 4400);
    return () => {
      [t1, t2, t3].forEach(clearTimeout);
      document.body.style.overflow = "";
    };
  }, []);

  if (phase === 3) return null;

  return (
    <div className={`cinema cinema-${phase}`}>
      <div className="cinema-bar cinema-bar-top" />
      <div className="cinema-bar cinema-bar-bottom" />
      <div className="cinema-stage">
        <svg className="cinema-mark" viewBox="-110 -60 220 120" aria-hidden="true">
          <defs>
            <linearGradient id="ci-ink" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#f3dc92" />
              <stop offset="1" stopColor="#d4af37" />
            </linearGradient>
          </defs>
          <line className="ci-rule ci-r1" x1="-100" y1="-44" x2="100" y2="-44"
            stroke="#d4af37" strokeOpacity=".7" strokeWidth=".5" />
          <g className="ci-keystone" transform="translate(0,-26)">
            <circle r="11" fill="none" stroke="#d4af37" strokeWidth=".5" />
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={i} x1="0" y1="-11" x2="0" y2="11"
                stroke="#d4af37" strokeWidth=".4" strokeOpacity=".6"
                transform={`rotate(${i * 22.5})`} />
            ))}
            <circle r="2" fill="#f3dc92" />
          </g>
          <g fill="none" stroke="url(#ci-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="ci-stroke ci-s1" d="M -78 12 L -78 -8 L -54 -8 Q -36 -8 -36 8 Q -36 24 -54 24 L -78 24" />
            <path className="ci-stroke ci-s2" d="M -16 24 L 4 -8 L 24 24 M -8 14 L 16 14" />
            <path className="ci-stroke ci-s3" d="M 42 24 L 42 -8 L 66 -8 Q 84 -8 84 4 Q 84 14 70 16 L 84 24 M 64 16 L 64 16" />
          </g>
          <text className="ci-tag" x="0" y="46" textAnchor="middle"
            fill="#ece2cf" fontFamily="'Inter', sans-serif" fontSize="6"
            letterSpacing="4">THE ATELIER · MMXXVI</text>
          <line className="ci-rule ci-r2" x1="-100" y1="50" x2="100" y2="50"
            stroke="#d4af37" strokeOpacity=".7" strokeWidth=".5" />
        </svg>
      </div>
    </div>
  );
}

export function CursorTrail() {
  useEffect(() => {
    const dots: { el: HTMLSpanElement; x: number; y: number }[] = [];
    const max = 18;
    for (let i = 0; i < max; i++) {
      const d = document.createElement("span");
      d.className = "trail-dot";
      d.style.cssText = `
        position: fixed; pointer-events: none; z-index: 9995;
        width: ${6 - i * 0.25}px; height: ${6 - i * 0.25}px;
        border-radius: 50%;
        background: radial-gradient(circle, #f3dc92, transparent 70%);
        transform: translate(-50%,-50%);
        opacity: ${1 - i / max};
        mix-blend-mode: screen;
      `;
      document.body.appendChild(d);
      dots.push({ el: d, x: 0, y: 0 });
    }
    let mx = 0;
    let my = 0;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    window.addEventListener("mousemove", onMove);
    let raf = 0;
    const tick = () => {
      let px = mx;
      let py = my;
      for (const d of dots) {
        d.x += (px - d.x) * 0.32;
        d.y += (py - d.y) * 0.32;
        d.el.style.left = d.x + "px";
        d.el.style.top = d.y + "px";
        px = d.x;
        py = d.y;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      dots.forEach((d) => d.el.remove());
    };
  }, []);
  return null;
}

interface CountToProps {
  to: number;
  suffix?: string;
  duration?: number;
}

export function CountTo({ to, suffix = "", duration = 1400 }: CountToProps) {
  const [v, setV] = useState(0);
  const elRef = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const target = elRef.current;
    if (!target) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && !started.current) {
            started.current = true;
            const t0 = performance.now();
            const step = (t: number) => {
              const p = Math.min(1, (t - t0) / duration);
              const eased = 1 - Math.pow(1 - p, 3);
              setV(Math.round(eased * to));
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [to, duration]);
  return (
    <span ref={elRef}>
      {v}
      {suffix}
    </span>
  );
}

interface AmbientOrnamentProps {
  size?: number;
  top?: string;
  left?: string;
  dur?: number;
  opacity?: number;
  color?: string;
}

export function AmbientOrnament({
  size = 600,
  top = "50%",
  left = "50%",
  dur = 90,
  opacity = 0.07,
  color = "#d4af37",
}: AmbientOrnamentProps) {
  return (
    <div
      className="ambient-orn"
      style={{
        width: size,
        height: size,
        top,
        left,
        opacity,
        animationDuration: `${dur}s`,
      }}
      aria-hidden="true"
    >
      <svg viewBox="-100 -100 200 200">
        <g fill="none" stroke={color} strokeWidth=".4">
          <circle r="98" />
          <circle r="80" />
          <circle r="60" />
          <circle r="40" />
          {Array.from({ length: 24 }).map((_, i) => (
            <line key={i} x1="0" y1="-98" x2="0" y2="98"
              transform={`rotate(${i * 15})`} strokeWidth=".3" />
          ))}
          {Array.from({ length: 12 }).map((_, i) => (
            <ellipse key={i} cx="0" cy="-58" rx="6" ry="36"
              transform={`rotate(${i * 30})`} strokeWidth=".5" />
          ))}
          <polygon
            points={Array.from({ length: 16 }, (_, i) => {
              const r = i % 2 ? 80 : 30;
              const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
              return `${Math.cos(a) * r},${Math.sin(a) * r}`;
            }).join(" ")}
            strokeWidth=".5"
          />
        </g>
      </svg>
    </div>
  );
}
