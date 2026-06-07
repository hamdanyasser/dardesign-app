"use client";

/* ============================================================
   Cinema hooks — scroll progress, in-view reveal, reduced-motion
   guard, and a generic Three.js scene mounter that degrades to a
   static fallback when WebGL is unavailable or motion is reduced.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import type { SceneHandle } from "@/lib/three/types";

/** True when the user prefers reduced motion. Reactive. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

interface UseSceneResult {
  containerRef: React.RefObject<HTMLDivElement>;
  handleRef: React.MutableRefObject<SceneHandle | null>;
  /** True when WebGL is suppressed — render the static fallback instead. */
  suppressed: boolean;
}

/**
 * Mounts a Three.js scene factory into a ref'd container, wires a
 * window mousemove → setMouse, and tears it down on unmount.
 * Suppressed (returns no handle) under reduced-motion / no-WebGL.
 * Pass `resetKey` deps (e.g. [isArabic]) to re-mount on change.
 */
export function useScene<O>(
  factory: (el: HTMLElement, opts: O) => SceneHandle,
  opts: O,
  resetKey: ReadonlyArray<unknown> = [],
  enabled = true
): UseSceneResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const reduced = usePrefersReducedMotion();
  const [suppressed, setSuppressed] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || reduced || !el || !webglAvailable()) {
      setSuppressed(true);
      return;
    }
    setSuppressed(false);
    const handle = factory(el, optsRef.current);
    handleRef.current = handle;

    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      handle.setMouse(x, y);
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      handle.destroy();
      handleRef.current = null;
    };
    // factory/opts captured via refs; remount only on these:
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reduced, ...resetKey]);

  return { containerRef, handleRef, suppressed };
}

/** rAF-throttled scroll-driven value. `compute` runs on each frame after scroll. */
export function useScrollValue(compute: () => number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(() => {
        setValue(compute());
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

/** Hero dolly progress: scrollY / (viewport * 1.4), clamped 0..1. */
export function useHeroProgress(): number {
  return useScrollValue(() =>
    Math.min(1, window.scrollY / (window.innerHeight * 1.4))
  );
}

/** Progress through a sticky/pinned section: 0 at entry, 1 when its tail leaves. */
export function useSectionScroll(ref: React.RefObject<HTMLElement>): number {
  return useScrollValue(() => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    if (travel <= 0) return 0;
    return Math.max(0, Math.min(1, -rect.top / travel));
  });
}

/** True once `ref` scrolls into view past `threshold`. Latches by default. */
export function useInView(
  ref: React.RefObject<Element>,
  threshold = 0.3,
  once = true
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            setInView(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setInView(false);
          }
        });
      },
      { threshold: [0, threshold, 1] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, threshold, once]);
  return inView;
}
