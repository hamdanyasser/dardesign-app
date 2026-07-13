"use client";

// "The Understood Room" — Three.js cinematic scrollytelling landing.
// M1: scaffold + tokens/copy, scroll→timeline with soft docking, camera path,
// dust + fog + Scene 1 (title, drawn threshold arch, fly-through).
// Spec: UNDERSTOOD_ROOM_THREEJS_SPEC.md — the single source of truth.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent as RChangeEvent,
  type DragEvent as RDragEvent,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { clamp, local, sm, sceneIndex, Timeline, cameraPos, cameraTarget } from "./camera";
import { COPY } from "./copy";

/** Western digits → Arabic-Indic (٠١٢…) for the culture percentage. */
const toArabicDigits = (s: string): string =>
  s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
import {
  applyDomMode,
  clearDomMode,
  getPalette,
  resolveInitialMode,
  saveMode,
} from "./daynight";
import StaticHero from "./StaticHero";
import type { DDMode } from "./tokens";
import { DOCKS, SPACER_HEIGHT_CSS, T_MAX, WORLD } from "./tokens";
import { buildWorld } from "./world";
import { DarAudio } from "@/lib/audio";
import { useImage } from "@/context/ImageContext";

declare global {
  interface Window {
    /** Debug/QA override for the timeline target (0..8.8). Keep forever. */
    __ddT?: number;
    /** When true, snap tS straight to __ddT (no smoothing) — instant beat
     *  parking for screenshots / remote QA. Set by the ?t= URL param. */
    __ddSnap?: boolean;
  }
}

type Status = "film" | "fallback";

export default function UnderstoodRoom() {
  const router = useRouter();
  const { setImage } = useImage();
  const [status, setStatus] = useState<Status>("film");
  const spacerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s1Ref = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const s2Ref = useRef<HTMLDivElement>(null);
  const portalRefs = useRef<Array<HTMLDivElement | null>>([]);
  const s3Ref = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const s4Ref = useRef<HTMLDivElement>(null);
  const scrubTrackRef = useRef<HTMLDivElement>(null);
  const scrubFillRef = useRef<HTMLDivElement>(null);
  const scrubValRef = useRef<HTMLDivElement>(null);
  const scrubPctRef = useRef<HTMLDivElement>(null);
  const s5Ref = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const lanternRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLDivElement>(null);
  // Ambient audio (oud drone + dock chimes) — off by default (autoplay-safe).
  const soundOnRef = useRef(false);
  const soundBtnRef = useRef<HTMLButtonElement>(null);
  // Drop-your-room bridge state (S5): file dropped → dissolve → /studio.
  const dropInputRef = useRef<HTMLInputElement>(null);
  const dropPreviewRef = useRef<HTMLImageElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Culture intensity (0..1) for the Scene 4 morph — a ref so the rAF loop reads
  // it without React re-renders; `owned` flips once the user grabs the scrubber.
  const cultureRef = useRef(0);
  const ownedRef = useRef(false);
  const bloomingRef = useRef(false);

  // Day/Night: target + smoothed day-amount (0 night, 1 day) eased in the loop.
  const dayTargetRef = useRef(0);
  const daySRef = useRef(0);
  // Scroll unit (px per film-second) + rail dots, shared with JSX handlers.
  const unitRef = useRef(1);
  const railDotRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const spacer = spacerRef.current;
    if (!canvas || !spacer) return;

    // Mode first, so the fallback hero also respects ?mode= / saved choice.
    const mode = resolveInitialMode(window.location.search);
    applyDomMode(mode);
    const palette = getPalette(mode);
    dayTargetRef.current = mode === "day" ? 1 : 0;
    daySRef.current = dayTargetRef.current; // start settled (no relight on load)

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStatus("fallback");
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setStatus("fallback");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    // If world construction fails on some driver (shader compile, etc.), never
    // strand the user on an empty canvas — fall back to the static hero.
    let world: ReturnType<typeof buildWorld>;
    try {
      world = buildWorld(scene, palette);
    } catch {
      renderer.dispose();
      setStatus("fallback");
      return;
    }
    const timeline = new Timeline();

    // --- scroll → film time ---
    let unit = 1;
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      camera.aspect = aspect;
      // Portrait/narrow screens: widen the FOV so the x±6 portals and wide
      // rooms stay in frame (desktop keeps the composed 55°).
      camera.fov = aspect < 1 ? clamp(55 + (1 - aspect) * 34, 55, 82) : 55;
      camera.updateProjectionMatrix();
      world.setResolution(w, h);
      unit = Math.max(1, (spacer.offsetHeight - h) / T_MAX);
      unitRef.current = unit;
    };
    resize();

    // --- pointer parallax (disabled on touch) ---
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && lanternRef.current) lanternRef.current.style.display = "none";
    let pxT = 0;
    let pyT = 0;
    let px = 0;
    let py = 0;
    let pointerMoved = false; // gates portal hover: no label until the mouse moves
    let hoverNow = -1; // portal under the pointer this frame (for the zellige click)
    const onPointerMove = (e: PointerEvent) => {
      pxT = (e.clientX / window.innerWidth) * 2 - 1;
      pyT = (e.clientY / window.innerHeight) * 2 - 1;
      pointerMoved = true;
    };
    // Click the Moroccan portal during S2 → regenerate its zellige tessellation.
    const onPointerDown = () => {
      if (hoverNow === 2) {
        world.regenerateZellige();
        if (soundOnRef.current) DarAudio.chime();
      }
    };

    // --- QA hooks: ?diag=1 overlay, ?t= parks the film at a beat (remote QA,
    // headless screenshots) by seeding the __ddT override ---
    const search = new URLSearchParams(window.location.search);
    const tParam = Number.parseFloat(search.get("t") ?? "");
    if (Number.isFinite(tParam)) {
      window.__ddT = clamp(tParam, 0, T_MAX);
      window.__ddSnap = true; // URL-parked beats snap instantly (screenshots/QA)
    }
    const diagOn = search.get("diag") === "1";
    if (diagOn && diagRef.current) diagRef.current.style.display = "block";
    let fps = 60;
    let diagTick = 0;

    // --- project a world point to screen px (for 3D-anchored DOM labels) ---
    const projV = new THREE.Vector3();
    const project = (v: THREE.Vector3) => {
      projV.copy(v).project(camera);
      return {
        x: (projV.x * 0.5 + 0.5) * window.innerWidth,
        y: (-projV.y * 0.5 + 0.5) * window.innerHeight,
        visible: projV.z < 1 && projV.x > -1.3 && projV.x < 1.3,
      };
    };

    // --- per-frame DOM sync (direct style writes; no React state in the loop) ---
    const syncDom = (tS: number, hoverIdx: number) => {
      const l0 = local(0, tS);
      const s1 = s1Ref.current;
      if (s1) {
        const op = 1 - sm(0.16, 0.34, l0);
        s1.style.opacity = op.toFixed(3);
        s1.style.transform = `translateY(${(-sm(0.1, 0.4, l0) * 90).toFixed(1)}px)`;
        s1.style.visibility = op < 0.01 ? "hidden" : "visible";
      }
      const hint = hintRef.current;
      if (hint) hint.style.opacity = (1 - sm(0.01, 0.07, l0)).toFixed(3);

      // Cursor lantern (قنديل) — a warm light that eased-follows the pointer.
      const lantern = lanternRef.current;
      if (lantern && !coarse) {
        const lx = (px * 0.5 + 0.5) * window.innerWidth;
        const ly = (py * 0.5 + 0.5) * window.innerHeight;
        lantern.style.transform = `translate(${lx.toFixed(0)}px,${ly.toFixed(0)}px) translate(-50%,-50%)`;
      }

      // --- S2 · Three Houses heading + hover-projected portal labels ---
      const l1 = local(1, tS);
      const s2 = s2Ref.current;
      if (s2) {
        const op2 = sm(0.04, 0.14, l1) * (1 - sm(0.86, 0.97, l1));
        s2.style.opacity = op2.toFixed(3);
        s2.style.visibility = op2 < 0.01 ? "hidden" : "visible";
      }
      const portalVis = sm(0.15, 0.35, l1) * (1 - sm(0.8, 0.95, l1));
      for (let i = 0; i < portalRefs.current.length; i++) {
        const el = portalRefs.current[i];
        if (!el) continue;
        const anchor = world.portalAnchors[i];
        const sp = anchor ? project(anchor) : null;
        const op = sp && sp.visible ? portalVis * (hoverIdx === i ? 1 : 0) : 0;
        if (sp) {
          el.style.transform = `translate(-50%,-50%) translate(${sp.x.toFixed(0)}px,${sp.y.toFixed(0)}px)`;
        }
        el.style.opacity = op.toFixed(3);
        el.style.visibility = op < 0.01 ? "hidden" : "visible";
      }

      // --- S3 · الفهم heading + 3D-anchored explode labels (style/plan/depth) ---
      const l2 = local(2, tS);
      const s3 = s3Ref.current;
      if (s3) {
        const op3 = sm(0.03, 0.12, l2) * (1 - sm(0.3, 0.45, l2)); // exits as the explode begins
        s3.style.opacity = op3.toFixed(3);
        s3.style.visibility = op3 < 0.01 ? "hidden" : "visible";
      }
      const layerVis = sm(0.55, 0.7, l2) * (1 - sm(0.9, 1, l2));
      for (let i = 0; i < layerRefs.current.length; i++) {
        const el = layerRefs.current[i];
        if (!el) continue;
        const anchor = world.layerAnchors[i];
        const sp = anchor ? project(anchor) : null;
        const op = sp && sp.visible ? layerVis : 0;
        if (sp) {
          el.style.transform = `translate(-50%,-50%) translate(${sp.x.toFixed(0)}px,${sp.y.toFixed(0)}px)`;
        }
        el.style.opacity = op.toFixed(3);
        el.style.visibility = op < 0.01 ? "hidden" : "visible";
      }

      // --- S4 · التحوّل heading + culture scrubber ---
      const l3 = local(3, tS);
      const s4 = s4Ref.current;
      if (s4) {
        const op4 = sm(0.04, 0.16, l3) * (1 - sm(0.9, 0.99, l3));
        s4.style.opacity = op4.toFixed(3);
        s4.style.visibility = op4 < 0.01 ? "hidden" : "visible";
        s4.style.pointerEvents = op4 > 0.5 ? "auto" : "none";
      }
      const c = cultureRef.current;
      if (scrubFillRef.current) scrubFillRef.current.style.width = `${(c * 100).toFixed(1)}%`;
      if (scrubTrackRef.current) {
        scrubTrackRef.current.setAttribute("aria-valuenow", String(Math.round(c * 100)));
      }
      if (scrubValRef.current) {
        const stop = COPY.s4.stops[Math.min(COPY.s4.stops.length - 1, Math.floor(c * COPY.s4.stops.length))];
        if (scrubValRef.current.textContent !== stop) scrubValRef.current.textContent = stop;
      }
      if (scrubPctRef.current) {
        scrubPctRef.current.textContent = toArabicDigits(String(Math.round(c * 100))) + "٪";
      }

      // --- S5 · الدعوة heading + door CTA ---
      const l4 = local(4, tS);
      const s5 = s5Ref.current;
      if (s5) {
        const op5 = sm(0.08, 0.3, l4);
        s5.style.opacity = op5.toFixed(3);
        s5.style.visibility = op5 < 0.01 ? "hidden" : "visible";
        s5.style.pointerEvents = op5 > 0.6 ? "auto" : "none";
      }

      // --- right-edge rail: mark the active scene's dot ---
      const scn = sceneIndex(tS);
      for (let i = 0; i < railDotRefs.current.length; i++) {
        const el = railDotRefs.current[i];
        if (el) el.dataset.active = i === scn ? "true" : "false";
      }
    };

    // --- loop ---
    let rafId = 0;
    let running = false;
    let disposed = false;
    let prevNow = performance.now();
    let elapsed = 0;
    let lastScn = 0; // scene index last frame — drives forward-crossing chimes

    let frameErrors = 0;
    const frame = (now: number) => {
      if (!running) return;
      try {
        const rawDt = Math.max((now - prevNow) / 1000, 1e-4);
        prevNow = now;
        const dt = Math.min(rawDt, 0.05);
        elapsed += dt;

        const target =
          typeof window.__ddT === "number"
            ? clamp(window.__ddT, 0, T_MAX)
            : clamp(window.scrollY / unit, 0, T_MAX);
        let tS: number;
        if (window.__ddSnap) {
          timeline.tS = target;
          timeline.vel = 0;
          tS = target;
        } else {
          tS = timeline.update(target, dt);
        }

        // Dock chime: a soft brass note each time we cross forward into a new
        // scene (only when the ambient bed is on).
        const scn = sceneIndex(tS);
        if (scn > lastScn && soundOnRef.current) DarAudio.chime();
        lastScn = scn;

        const par = coarse ? 0 : 1;
        px += (pxT - px) * (1 - Math.exp(-dt * 4));
        py += (pyT - py) * (1 - Math.exp(-dt * 4));
        const pos = cameraPos(tS);
        const cx = pos[0] + px * WORLD.parallaxX * par;
        const cy = pos[1] - py * WORLD.parallaxY * par;
        // Portrait phones: pull the camera back through scene 2 so the three
        // x±6 portals fit (a wider FOV alone can't on a tall aspect). Ramped by
        // an envelope so there's no jump at the scene edges; nil on desktop.
        let camZ = pos[2];
        if (camera.aspect < 1) {
          const narrow = clamp(1 / camera.aspect - 1, 0, 1.3);
          const s2win = sm(1.25, 1.7, tS) * (1 - sm(3.1, 3.55, tS));
          camZ += narrow * 9 * s2win;
        }
        camera.position.set(cx, cy, camZ);
        const tgt = cameraTarget(tS, [cx, cy, camZ]);
        camera.lookAt(tgt[0], tgt[1], tgt[2]);

        // Scene 2 hover: nearest portal to the pointer (desktop) / auto-cycle (touch).
        let hoverIdx = -1;
        if (tS > 1.4 && tS < 3.5) {
          if (coarse) {
            hoverIdx = Math.floor(elapsed / 2.2) % 3;
          } else if (pointerMoved) {
            const pointerX = (px * 0.5 + 0.5) * window.innerWidth;
            let bd = Infinity;
            for (let i = 0; i < world.portalAnchors.length; i++) {
              const sp = project(world.portalAnchors[i]);
              if (!sp.visible) continue;
              const d = Math.abs(sp.x - pointerX);
              if (d < bd) {
                bd = d;
                hoverIdx = i;
              }
            }
          }
        }
        hoverNow = hoverIdx; // expose to the pointerdown (zellige) handler

        // Scene 4 culture: auto-ramps with the scroll until the user grabs the
        // scrubber, then holds the owned value.
        if (tS > 5.6 && tS < 7.8 && !ownedRef.current) {
          const l3 = local(3, tS);
          cultureRef.current = Math.min(0.72, Math.max(0, (l3 - 0.16) * 1.5));
        }

        // Day/Night relight — ease the day-amount toward the target (~1.5s).
        daySRef.current += (dayTargetRef.current - daySRef.current) * (1 - Math.exp(-dt * 3));
        world.relight(daySRef.current);

        world.update({ tS, time: elapsed, hoverIdx, culture: cultureRef.current });
        renderer.render(scene, camera);
        syncDom(tS, hoverIdx);

        if (diagOn) {
          fps += (1 / rawDt - fps) * 0.08;
          if (++diagTick % 15 === 0 && diagRef.current) {
            diagRef.current.textContent = `${Math.round(fps)} fps · ${
              renderer.info.render.calls
            } calls · ${mode} · t ${tS.toFixed(2)}`;
          }
        }
      } catch (err) {
        // Never leave a frozen canvas on screen: after a few consecutive
        // failures, tear down and show the static hero instead of a blank.
        if (frameErrors === 0) console.error("UnderstoodRoom frame error", err);
        if (++frameErrors > 10) {
          running = false;
          setStatus("fallback");
          return;
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (running || disposed) return;
      running = true;
      prevNow = performance.now();
      rafId = requestAnimationFrame(frame);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };

    // --- lifecycle (spec §1 rule 3) ---
    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    const onContextLost = (e: Event) => {
      e.preventDefault();
      stopLoop();
    };
    const onContextRestored = () => {
      startLoop();
    };

    // Keyboard scene jumps (↑/↓/PageUp/PageDown/Space) — but never steal the
    // arrow keys while the culture slider is focused (checklist item 9).
    const onKeyNav = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.getAttribute("role") === "slider" ||
          ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA")
      ) {
        return;
      }
      let dir = 0;
      if (e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
      else if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") dir = 1;
      else return;
      e.preventDefault();
      const cur = clamp((window.scrollY || 0) / unit, 0, T_MAX);
      let idx = 0;
      let bd = Infinity;
      for (let i = 0; i < DOCKS.length; i++) {
        const dd = Math.abs(DOCKS[i] - cur);
        if (dd < bd) {
          bd = dd;
          idx = i;
        }
      }
      idx = Math.max(0, Math.min(DOCKS.length - 1, idx + dir));
      window.scrollTo({ top: DOCKS[idx] * unit, behavior: "smooth" });
    };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyNav);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyNav);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      world.dispose();
      renderer.dispose();
      clearDomMode();
    };
  }, []);

  // --- Scene 4 scrubber + Scene 5 CTA handlers (mutate refs; loop reads them) ---
  const scrubFrom = (clientX: number) => {
    const el = scrubTrackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    cultureRef.current = clamp((r.right - clientX) / r.width, 0, 1); // RTL: 0 right → 1 left
  };
  const onScrubDown = (e: RPointerEvent<HTMLDivElement>) => {
    ownedRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    scrubFrom(e.clientX);
  };
  const onScrubMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.buttons === 1) scrubFrom(e.clientX);
  };
  const onScrubKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") d = 0.05;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") d = -0.05;
    if (d !== 0) {
      e.preventDefault();
      ownedRef.current = true;
      cultureRef.current = clamp(cultureRef.current + d, 0, 1);
    }
  };
  const toggleMode = () => {
    const cur = document.documentElement.getAttribute("data-dd-mode") === "day" ? "day" : "night";
    const next: DDMode = cur === "day" ? "night" : "day";
    applyDomMode(next); // DOM flips via CSS transitions; the 3D eases in the loop
    saveMode(next);
    dayTargetRef.current = next === "day" ? 1 : 0;
  };
  const scrollToDock = (i: number) => {
    window.scrollTo({ top: DOCKS[i] * unitRef.current, behavior: "smooth" });
  };
  const toggleSound = () => {
    const on = DarAudio.toggle(); // gesture-gated: first click resumes the ctx
    soundOnRef.current = on;
    soundBtnRef.current?.setAttribute("data-sound-on", on ? "1" : "0");
  };

  const onEnterStudio = () => {
    if (bloomingRef.current) return;
    bloomingRef.current = true;
    const bloom = bloomRef.current;
    if (bloom) {
      bloom.style.transition = "none";
      bloom.style.opacity = "0";
      bloom.style.transform = "translate(-50%,-50%) scale(0.08)";
      requestAnimationFrame(() => {
        bloom.style.transition =
          "opacity .35s ease, transform .9s cubic-bezier(.22,1,.36,1)";
        bloom.style.opacity = "1";
        bloom.style.transform = "translate(-50%,-50%) scale(1)";
      });
    }
    window.setTimeout(() => router.push("/studio"), 820);
  };

  // Drop-your-room bridge: a valid photo is stashed in the shared ImageContext
  // (so /studio picks it up preloaded), dissolves into the door, then routes.
  const acceptDrop = (file?: File | null) => {
    const zone = dropZoneRef.current;
    if (!file || !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      zone?.setAttribute("data-error", "1");
      return;
    }
    if (bloomingRef.current) return;
    zone?.removeAttribute("data-error");
    setImage(file); // carried into /studio via the shared provider — no studio edits
    const prev = dropPreviewRef.current;
    if (prev) prev.src = URL.createObjectURL(file);
    zone?.setAttribute("data-filled", "1");
    onEnterStudio(); // the photo fades into the growing threshold bloom
  };
  const onDropFiles = (e: RDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dropZoneRef.current?.removeAttribute("data-over");
    acceptDrop(e.dataTransfer.files?.[0]);
  };
  const onDragOver = (e: RDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dropZoneRef.current?.setAttribute("data-over", "1");
  };
  const onDragLeave = () => dropZoneRef.current?.removeAttribute("data-over");
  const onDropInput = (e: RChangeEvent<HTMLInputElement>) =>
    acceptDrop(e.target.files?.[0]);

  if (status === "fallback") return <StaticHero />;

  return (
    <div className="ur-root" dir="rtl">
      <div
        ref={spacerRef}
        className="ur-spacer"
        style={{ height: SPACER_HEIGHT_CSS }}
        aria-hidden="true"
      />
      <canvas ref={canvasRef} className="ur-canvas" aria-hidden="true" />

      {/* Cinematic overlays: film grain + vignette + cursor lantern */}
      <div className="ur-grain" aria-hidden="true" />
      <div className="ur-vignette" aria-hidden="true" />
      <div ref={lanternRef} className="ur-lantern" aria-hidden="true" />

      {/* Day/Night toggle — icon + label show the TARGET mode (§6) */}
      <button
        type="button"
        className="ur-mode-toggle"
        data-dd-mode-toggle
        onClick={toggleMode}
        aria-label={COPY.mode.ariaToggle}
      >
        <span className="ur-mode-ico" aria-hidden="true">
          <svg className="ur-ico-sun" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="3.4" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M9 1.2v2M9 14.8v2M1.2 9h2M14.8 9h2M3.5 3.5l1.4 1.4M13.1 13.1l1.4 1.4M14.5 3.5l-1.4 1.4M4.9 13.1l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <svg className="ur-ico-moon" viewBox="0 0 18 18" fill="none">
            <path
              d="M14.8 11.2A6.4 6.4 0 0 1 6.8 3.2 6.4 6.4 0 1 0 14.8 11.2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="ur-mode-lab-n">{COPY.mode.toDay}</span>
        <span className="ur-mode-lab-d">{COPY.mode.toNight}</span>
      </button>

      {/* Ambient sound pill — oud drone + dock chimes, off by default */}
      <button
        type="button"
        className="ur-sound-toggle"
        ref={soundBtnRef}
        data-sound-on="0"
        onClick={toggleSound}
        aria-label={COPY.sound.ariaToggle}
      >
        <span className="ur-sound-ico" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path
              d="M3 7.5h2.6L9.5 4v12L5.6 12.5H3z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              className="ur-sound-waves"
              d="M12.4 7.2a4 4 0 0 1 0 5.6M14.8 5.2a7 7 0 0 1 0 9.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              className="ur-sound-slash"
              d="M13 7l4 6M17 7l-4 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>

      {/* Right-edge progress rail — 5 clickable docks + Arabic labels */}
      <nav className="ur-rail" aria-label="scenes">
        {COPY.rail.map((label, i) => (
          <button
            key={label}
            type="button"
            className="ur-rail-row"
            ref={(el) => {
              railDotRefs.current[i] = el;
            }}
            onClick={() => scrollToDock(i)}
            aria-label={label}
          >
            <span className="ur-rail-lab">{label}</span>
            <span className="ur-rail-dot" />
          </button>
        ))}
      </nav>

      <div ref={s1Ref} className="ur-s1">
        <div className="ur-s1-inner">
          <div className="ur-eyebrow">
            <span className="ur-eyebrow-ar">{COPY.s1.eyebrowAr}</span> ·{" "}
            {COPY.s1.eyebrowEn}
          </div>
          <h1 className="ur-h1">{COPY.s1.h1}</h1>
          <div className="ur-sub">{COPY.s1.sub}</div>
          <p className="ur-lines">
            {COPY.s1.line1}
            <br />
            {COPY.s1.line2}
          </p>
          <div className="ur-line-en">{COPY.s1.lineEn}</div>
        </div>
        <div ref={hintRef} className="ur-hint">
          <div className="ur-hint-text">
            {COPY.s1.hintAr}{" "}
            <span className="ur-hint-en">· {COPY.s1.hintEn}</span>
          </div>
          <div className="ur-hint-line" />
        </div>
      </div>

      {/* S2 · البيوت الثلاثة — heading + 3D-anchored portal hover labels */}
      <div ref={s2Ref} className="ur-s2">
        <div className="ur-s2-eyebrow">{COPY.s2.eyebrow}</div>
        <h2 className="ur-s2-h2">{COPY.s2.h2}</h2>
        <div className="ur-s2-sub">{COPY.s2.sub}</div>
      </div>
      {COPY.s2.portals.map((p, i) => (
        <div
          key={p.en}
          className="ur-portal-label"
          ref={(el) => {
            portalRefs.current[i] = el;
          }}
        >
          <div className="ur-portal-ar">{p.ar}</div>
          <div className="ur-portal-en">{p.en}</div>
          <div className="ur-portal-detail">{p.detail}</div>
        </div>
      ))}

      {/* S3 · الفهم — heading + three explode layer labels (style / plan / depth) */}
      <div ref={s3Ref} className="ur-s2">
        <div className="ur-s2-eyebrow">{COPY.s3.eyebrow}</div>
        <h2 className="ur-s2-h2">{COPY.s3.h2}</h2>
        <div className="ur-s2-sub">{COPY.s3.sub}</div>
      </div>
      {COPY.s3.layers.map((layer, i) => (
        <div
          key={layer.tag}
          className="ur-layer-label"
          ref={(el) => {
            layerRefs.current[i] = el;
          }}
        >
          <div className="ur-layer-ar">{layer.ar}</div>
          <div className="ur-layer-tag">{layer.tag}</div>
        </div>
      ))}

      {/* S4 · التحوّل — heading + culture scrubber */}
      <div ref={s4Ref} className="ur-s4">
        <div className="ur-s2-eyebrow">{COPY.s4.eyebrow}</div>
        <h2 className="ur-s2-h2">{COPY.s4.h2}</h2>
        <div className="ur-s2-sub">{COPY.s4.sub}</div>
        <div className="ur-scrub-block">
          <div className="ur-scrub-title">{COPY.s4.scrubberTitle}</div>
          <div
            ref={scrubTrackRef}
            className="ur-scrub-track"
            role="slider"
            tabIndex={0}
            aria-label={COPY.s4.scrubberTitle}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onKeyDown={onScrubKey}
          >
            <div ref={scrubFillRef} className="ur-scrub-fill">
              <div className="ur-scrub-knob" />
            </div>
          </div>
          <div className="ur-scrub-row">
            <span className="ur-scrub-end">{COPY.s4.end100}</span>
            <span ref={scrubValRef} className="ur-scrub-val">
              {COPY.s4.stops[0]}
            </span>
            <span className="ur-scrub-end">{COPY.s4.end0}</span>
          </div>
          <div ref={scrubPctRef} className="ur-scrub-pct">
            ٠٪
          </div>
        </div>
      </div>

      {/* S5 · الدعوة — door CTA + closing */}
      <div ref={s5Ref} className="ur-s5">
        <div className="ur-s2-eyebrow">{COPY.s5.eyebrow}</div>
        <button type="button" className="ur-cta-door" onClick={onEnterStudio}>
          <span className="ur-cta-ar">{COPY.s5.doorAr}</span>
          <span className="ur-cta-en">{COPY.s5.doorEn}</span>
        </button>

        {/* Drop-your-room: carries a photo straight into /studio */}
        <div
          ref={dropZoneRef}
          className="ur-drop"
          onClick={() => dropInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDropFiles}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={dropPreviewRef} className="ur-drop-preview" alt="" aria-hidden="true" />
          <span className="ur-drop-ar">{COPY.s5.dropAr}</span>
          <span className="ur-drop-en">{COPY.s5.dropEn}</span>
          <span className="ur-drop-hint">{COPY.s5.dropHint}</span>
          <span className="ur-drop-err">{COPY.s5.dropError}</span>
          <input
            ref={dropInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onDropInput}
          />
        </div>

        <div className="ur-s5-closing">{COPY.s5.closing1}</div>
        <div className="ur-s5-closing-sub">{COPY.s5.closing2}</div>
      </div>

      <div ref={bloomRef} className="ur-bloom" aria-hidden="true" />

      <div ref={diagRef} className="ur-diag" aria-hidden="true" />
    </div>
  );
}
