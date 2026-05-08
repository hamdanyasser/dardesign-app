"use client";

/**
 * Atelier ambient effects: custom cursor, film grain, vignette, scroll progress
 * chrome, reveal-on-scroll observer, mouse-parallax helper, current-act label.
 *
 * Ported from dar-design/project/js/atelier-effects.jsx (React+Babel-in-browser
 * prototype) to Next.js 14 + TypeScript. Behaviour unchanged.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

interface CursorAndChromeProps {
  progress: number;
  act: string;
  rootRef: RefObject<HTMLDivElement>;
}

export function CursorAndChrome({ progress, act, rootRef }: CursorAndChromeProps) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const onOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const hot = !!target?.closest("a, button, .atlas-cell, .step, .coda-cta");
      rootRef.current?.classList.toggle("cursor-hot", hot);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseover", onOver);

    const tick = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
    };
  }, [rootRef]);

  return (
    <>
      <div className="grain" />
      <div className="vignette" />
      <div className="cursor" ref={dotRef} />
      <div className="cursor-ring" ref={ringRef} />
      <div className="chrome-progress" style={{ width: `${progress * 100}%` }} />
      <div className="chrome">
        <div className="chrome-mark">
          <b>Dar</b>
          <span>The Atelier · Est MMXXVI</span>
        </div>
        <div className="chrome-act">
          <i></i>
          <span>{act}</span>
        </div>
      </div>
    </>
  );
}

export function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setP(h > 0 ? Math.min(1, window.scrollY / h) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return p;
}

export function useReveal(): void {
  useEffect(() => {
    const els = document.querySelectorAll(".atelier-page .reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) en.target.classList.add("in");
        });
      },
      { threshold: 0.18 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

export function useActLabel(): string {
  const [label, setLabel] = useState("Act I · Threshold");
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(".atelier-page [data-act]"),
    );
    const onScroll = () => {
      const mid = window.innerHeight * 0.4;
      let active: HTMLElement | undefined = sections[0];
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.top <= mid) active = s;
      }
      if (active?.dataset.act) setLabel(active.dataset.act);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return label;
}

export function useMouseParallax(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) / r.width;
      const dy = (e.clientY - cy) / r.height;
      el.style.setProperty("--mx", String(dx));
      el.style.setProperty("--my", String(dy));
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [ref]);
}

/** React stylesheet helper — typing CSS custom properties without `any` */
export type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;
