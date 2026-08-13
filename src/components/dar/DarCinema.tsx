"use client";

/* ============================================================
   DarCinema — the cinematic, RTL-Arabic-first landing.
   Faithful React port of the Claude Design handoff
   "DarDesign Cinema.dc.html": cinema intro → Act I threshold
   tunnel (scroll-driven 3D) → Act II the read (3D scan) →
   Act III three souls (draggable 3D carousel) → Act IV the
   orbitable room (re-skins per tradition) → Act V provenance.

   Scoped under .dar-cinema (see dar-cinema.css). The RAF engine
   + drag/pointer handlers live in one useEffect; tradition/theme/
   intro are React state. CTAs route to /studio.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useThemeLanguage } from "@/context/ThemeLanguageContext";

type Tradition = "lebanese" | "khaleeji" | "moroccan";

interface Soul {
  ar: string;
  en: string;
  accent: string;
  accentText: string;
  glow: string;
  line: string;
  wall: string;
  archRadius: string;
  archFill: string;
  archFrame: string;
  ceil: string;
  floor: string;
  rug: string;
  mats: [string, string][];
}

const SOULS: Record<Tradition, Soul> = {
  lebanese: {
    ar: "لبناني",
    en: "the Lebanese house",
    accent: "#3E5C44",
    accentText: "#D8C3A5",
    glow: "rgba(62,92,68,.30)",
    line: "قناطر، أرز، وحجر جبل — بيت يتنفّس نحو البحر.",
    wall: "linear-gradient(rgba(0,0,0,.10), rgba(0,0,0,.30)), repeating-linear-gradient(0deg, #cdb691 0 34px, #bfa67e 34px 37px)",
    archRadius: "999px 999px 0 0",
    archFill: "radial-gradient(ellipse at 50% 18%, rgba(227,195,106,.55), rgba(36,28,18,.96) 72%)",
    archFrame: "rgba(120,95,58,.9)",
    ceil: "repeating-linear-gradient(90deg, #4a3320 0 46px, #3a2818 46px 66px)",
    floor: "conic-gradient(from 45deg, #e8dcc4 0 25%, #c1603d 0 50%, #e8dcc4 0 75%, #5c1a1b 0) 0 0 / 68px 68px, #e8dcc4",
    rug: "repeating-linear-gradient(0deg, #5c1a1b 0 14px, #c45c2a 14px 22px, #e8dcc4 22px 26px)",
    mats: [
      ["جدران حجر رملي", "sandstone courses"],
      ["سقف أرز محفور", "carved cedar ceiling"],
      ["بلاط منقوش وكليم", "encaustic tile · kilim"],
    ],
  },
  khaleeji: {
    ar: "خليجي",
    en: "the Khaleeji house",
    accent: "var(--gold)",
    accentText: "var(--gold)",
    glow: "rgba(var(--gold-rgb),.22)",
    line: "مجلس، سدو، وجص محفور — بيت الضيافة.",
    wall: "repeating-linear-gradient(90deg, rgba(176,138,62,.35) 0 12px, transparent 12px 30px) 0 14% / 100% 22px no-repeat, linear-gradient(rgba(0,0,0,.06), rgba(0,0,0,.22)), #efe6d2",
    archRadius: "50% 50% 0 0 / 100% 100% 0 0",
    archFill: "radial-gradient(ellipse at 50% 16%, rgba(201,162,39,.5), rgba(31,42,58,.97) 70%)",
    archFrame: "rgba(176,138,62,.85)",
    ceil: "repeating-linear-gradient(0deg, #9a8460 0 9px, #84704c 9px 18px)",
    floor: "linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.18)), #d9c39a",
    rug: "repeating-linear-gradient(0deg, #8a1f1f 0 13px, #181410 13px 19px, #e9dcc0 19px 27px, #8a1f1f 27px 31px)",
    mats: [
      ["جص محفور (جصّ)", "carved gypsum (jus)"],
      ["سقف جريد النخل", "palm-frond (jereed) ceiling"],
      ["بساط سدو", "sadu weave runner"],
    ],
  },
  moroccan: {
    ar: "مغربي",
    en: "the Moroccan house",
    accent: "#2B50AA",
    accentText: "#C1603D",
    glow: "rgba(43,80,170,.26)",
    line: "زليج، تادلاكت، وفانوس — بيت الرياض.",
    wall: "linear-gradient(#efe5d2 0 52%, transparent 52%), conic-gradient(from 45deg, #2B50AA 0 25%, #efe5d2 0 50%, #a8442a 0 75%, #efe5d2 0) 0 0 / 46px 46px",
    archRadius: "50% 50% 10px 10px / 62% 62% 10px 10px",
    archFill: "radial-gradient(ellipse at 50% 26%, rgba(227,169,47,.6), rgba(26,18,12,.97) 72%)",
    archFrame: "rgba(168,68,42,.85)",
    ceil: "radial-gradient(ellipse at 50% 50%, rgba(227,169,47,.4), #15100b 72%)",
    floor: "repeating-linear-gradient(45deg, transparent 0 40px, rgba(24,20,16,.45) 40px 42px), repeating-linear-gradient(-45deg, transparent 0 40px, rgba(24,20,16,.45) 40px 42px), #efe8d8",
    rug: "repeating-linear-gradient(90deg, #a8442a 0 16px, #efe5d2 16px 21px, #2B50AA 21px 25px)",
    mats: [
      ["زليج هندسي", "zellige mosaic dado"],
      ["تادلاكت مصقول", "polished tadelakt"],
      ["ضوء فانوس نحاسي", "pierced brass-lantern light"],
    ],
  },
};

const ORDER: Tradition[] = ["lebanese", "khaleeji", "moroccan"];

/** Decorative drop-target stand-in. On the landing these are framed
 *  placeholders; in production they carry real uploads / SDXL renders. */
function ImageSlot({ placeholder }: { placeholder: string }) {
  return (
    <div className="dd-slot" style={{ position: "absolute", inset: 0 }}>
      <span>{placeholder}</span>
    </div>
  );
}

const EASE = "cubic-bezier(.22,.61,.36,1)";

export default function DarCinema() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tradition, setTradition] = useState<Tradition>("lebanese");
  // Theme is owned by ThemeLanguageContext (single source of truth for the whole
  // app). We still mirror it onto this component's root div below so the existing
  // .dar-cinema[data-theme="light"] scoped CSS keeps matching.
  const { theme, toggleTheme } = useThemeLanguage();
  const [introVisible, setIntroVisible] = useState(true);
  const [introOpacity, setIntroOpacity] = useState(1);

  // Imperative engine state (mutated in rAF, never triggers re-render).
  const rot = useRef(0);
  const rotTarget = useRef(0);
  const ringDrag = useRef<{ x: number; rot: number } | null>(null);
  const roomRx = useRef(-8);
  const roomRy = useRef(18);
  const roomDrag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  const px = useRef(0);
  const py = useRef(0);
  const themeRef = useRef(theme);
  const introRef = useRef(introVisible);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  useEffect(() => {
    introRef.current = introVisible;
  }, [introVisible]);

  const soul = SOULS[tradition];

  const dismissIntro = () => {
    if (!introRef.current) return;
    setIntroOpacity(0);
    window.setTimeout(() => setIntroVisible(false), 720);
  };

  const goTo = (idx: number) => {
    const base = -idx * 120;
    const k = Math.round((rotTarget.current - base) / 360);
    rotTarget.current = base + k * 360;
    setTradition(ORDER[idx]);
  };

  // ---- the engine: scroll-driven acts, drags, parallax, dust, reveals ----
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const $ = (s: string) => root.querySelector<HTMLElement>(s);
    const $$ = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const docTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;
    const cleanup: Array<() => void> = [];

    if (reduced) {
      setIntroVisible(false);
    } else {
      const t1 = window.setTimeout(dismissIntro, 3000);
      cleanup.push(() => clearTimeout(t1));
    }

    // ---- Act V reveals ----
    const targets = $$("[data-reveal]");
    if (!reduced) {
      targets.forEach((el) => {
        el.dataset.baseTr = el.style.transform || "";
        el.style.opacity = "0";
        el.style.transform = (el.dataset.baseTr + " translateX(24px)").trim();
        el.style.transition = `opacity 600ms ${EASE}, transform 600ms ${EASE}`;
      });
      const pending = new Set(targets);
      const check = () => {
        const vh = window.innerHeight;
        pending.forEach((el) => {
          if (el.getBoundingClientRect().top < vh * 0.92) {
            el.style.opacity = "1";
            el.style.transform = el.dataset.baseTr || "";
            pending.delete(el);
          }
        });
      };
      check();
      window.addEventListener("scroll", check, { passive: true });
      cleanup.push(() => window.removeEventListener("scroll", check));
      const iv = window.setInterval(() => {
        check();
        if (!pending.size) clearInterval(iv);
      }, 400);
      cleanup.push(() => clearInterval(iv));
    }

    // ---- pointer parallax ----
    const onMove = (e: PointerEvent) => {
      px.current = (e.clientX / window.innerWidth) * 2 - 1;
      py.current = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    cleanup.push(() => window.removeEventListener("pointermove", onMove));

    // ---- carousel drag ----
    const ringZone = $("[data-ring-zone]");
    if (ringZone) {
      const down = (e: PointerEvent) => {
        ringDrag.current = { x: e.clientX, rot: rot.current };
        ringZone.style.cursor = "grabbing";
        ringZone.setPointerCapture?.(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!ringDrag.current) return;
        rot.current = ringDrag.current.rot + (e.clientX - ringDrag.current.x) * 0.35;
        rotTarget.current = rot.current;
      };
      const up = () => {
        if (!ringDrag.current) return;
        ringDrag.current = null;
        ringZone.style.cursor = "grab";
        rotTarget.current = Math.round(rot.current / 120) * 120;
        const idx = (((-rotTarget.current / 120) % 3) + 3) % 3;
        setTradition(ORDER[idx]);
      };
      ringZone.addEventListener("pointerdown", down);
      ringZone.addEventListener("pointermove", move);
      ringZone.addEventListener("pointerup", up);
      ringZone.addEventListener("pointercancel", up);
      cleanup.push(() => {
        ringZone.removeEventListener("pointerdown", down);
        ringZone.removeEventListener("pointermove", move);
        ringZone.removeEventListener("pointerup", up);
        ringZone.removeEventListener("pointercancel", up);
      });
    }

    // ---- room orbit drag ----
    const roomZone = $("[data-room-zone]");
    if (roomZone) {
      const down = (e: PointerEvent) => {
        roomDrag.current = { x: e.clientX, y: e.clientY, rx: roomRx.current, ry: roomRy.current };
        roomZone.style.cursor = "grabbing";
        roomZone.setPointerCapture?.(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!roomDrag.current) return;
        roomRy.current = Math.max(-44, Math.min(44, roomDrag.current.ry + (e.clientX - roomDrag.current.x) * 0.22));
        roomRx.current = Math.max(-20, Math.min(6, roomDrag.current.rx - (e.clientY - roomDrag.current.y) * 0.14));
      };
      const up = () => {
        roomDrag.current = null;
        roomZone.style.cursor = "grab";
      };
      roomZone.addEventListener("pointerdown", down);
      roomZone.addEventListener("pointermove", move);
      roomZone.addEventListener("pointerup", up);
      roomZone.addEventListener("pointercancel", up);
      cleanup.push(() => {
        roomZone.removeEventListener("pointerdown", down);
        roomZone.removeEventListener("pointermove", move);
        roomZone.removeEventListener("pointerup", up);
        roomZone.removeEventListener("pointercancel", up);
      });
    }

    // ---- provenance card tilt ----
    if (!reduced) {
      $$("[data-tilt]").forEach((card) => {
        const enter = (e: PointerEvent) => {
          const r = card.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 2 - 1;
          const y = ((e.clientY - r.top) / r.height) * 2 - 1;
          card.style.transform = `perspective(700px) rotateY(${x * -6}deg) rotateX(${y * 5}deg) translateZ(6px)`;
        };
        const leave = () => {
          card.style.transform = "";
        };
        card.addEventListener("pointermove", enter);
        card.addEventListener("pointerleave", leave);
        cleanup.push(() => {
          card.removeEventListener("pointermove", enter);
          card.removeEventListener("pointerleave", leave);
        });
      });
    }

    // ---- dust ----
    type Particle = { x: number; y: number; r: number; vx: number; vy: number; a: number; ph: number };
    const dustCanvas = $("[data-dust]") as HTMLCanvasElement | null;
    let dust: { ctx: CanvasRenderingContext2D; parts: Particle[] } | null = null;
    if (dustCanvas && !reduced) {
      const ctx = dustCanvas.getContext("2d");
      if (ctx) {
        const parts: Particle[] = Array.from({ length: 36 }, () => ({
          x: Math.random() * 800,
          y: Math.random() * 600,
          r: 0.6 + Math.random() * 1.8,
          vx: -0.08 + Math.random() * 0.16,
          vy: 0.04 + Math.random() * 0.14,
          a: 0.15 + Math.random() * 0.4,
          ph: Math.random() * Math.PI * 2,
        }));
        dust = { ctx, parts };
      }
    }

    // ---- scene refs ----
    const tunnelSection = $('[data-act="1"]');
    const tunnelStage = $("[data-tunnel-stage]");
    const tunnelLayers = $$("[data-tunnel-z]");
    const tunnelHeadline = $("[data-tunnel-headline]");
    const tunnelCue = $("[data-tunnel-cue]");
    const scanSection = $('[data-act="2"]');
    const scanPlane = $("[data-scan-plane]");
    const scanLine = $("[data-scan-line]");
    const scanGrid = $("[data-scan-grid]");
    const scanLabels = $$("[data-scan-label]");
    const ring = $("[data-ring]");
    const ringCards = $$("[data-ring-card]");
    const room = $("[data-room]");
    const roomScale = $("[data-room-scale]");
    const rail = $("[data-rail]");
    const railDots = $$("[data-rail-dot]");
    const sceneEls = [1, 2, 3, 4, 5].map((n) => $(`[data-act="${n}"]`));

    let railActive = -1;
    const setRail = (idx: number) => {
      if (idx === railActive) return;
      railActive = idx;
      railDots.forEach((dot, i) => {
        const dotSpan = dot.children[0] as HTMLElement;
        const label = dot.children[1] as HTMLElement;
        const on = i === idx;
        dotSpan.style.background = on ? "var(--gold)" : "transparent";
        dotSpan.style.transform = on ? "scale(1.35)" : "scale(1)";
        dotSpan.style.boxShadow = on ? "0 0 12px rgba(var(--gold-rgb),.7)" : "none";
        label.style.opacity = on ? "1" : "0";
        label.style.transform = on ? "translateX(0)" : "translateX(-6px)";
      });
    };
    railDots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        const el = sceneEls[i];
        if (el)
          window.scrollTo({
            top: docTop(el) + (i === 0 ? window.innerHeight * 0.5 : 0),
            behavior: reduced ? "auto" : "smooth",
          });
      });
    });
    const updateRail = () => {
      if (!rail) return;
      const past = introRef.current ? false : window.scrollY > window.innerHeight * 0.4;
      rail.style.opacity = past ? "1" : "0";
      const mid = window.scrollY + window.innerHeight * 0.5;
      let active = 0;
      sceneEls.forEach((el, i) => {
        if (el && docTop(el) <= mid) active = i;
      });
      setRail(active);
    };

    const prog = (section: HTMLElement | null) => {
      if (!section) return 0;
      const top = docTop(section);
      const h = section.offsetHeight - window.innerHeight;
      return clamp01((window.scrollY - top) / Math.max(1, h));
    };

    if (reduced) {
      tunnelLayers.forEach((el) => {
        const z = parseFloat(el.getAttribute("data-tunnel-z")!);
        el.style.transform = `translate(-50%, -50%) translateZ(${z + 2060}px)`;
        if (z > -2000) el.style.opacity = "0";
      });
      if (tunnelHeadline) {
        tunnelHeadline.style.opacity = "1";
        tunnelHeadline.style.transform = "translate(-50%, -50%) translateZ(-460px)";
      }
      if (tunnelCue) tunnelCue.style.opacity = "0";
      if (scanPlane) scanPlane.style.transform = "rotateX(0deg)";
      if (scanLine) scanLine.style.opacity = "0";
      scanLabels.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "translateZ(70px) scale(1)";
      });
      if (roomScale && roomZone) roomScale.style.transform = `scale(${Math.min(1, roomZone.clientWidth / 680)})`;
      updateRail();
      window.addEventListener("scroll", updateRail, { passive: true });
      cleanup.push(() => window.removeEventListener("scroll", updateRail));
      return () => cleanup.forEach((fn) => fn());
    }

    let raf = 0;
    const tick = (t: number) => {
      updateRail();

      // Act I — fly through the tunnel
      const p1 = prog(tunnelSection);
      const camZ = p1 * 2060;
      tunnelLayers.forEach((el) => {
        const z = parseFloat(el.getAttribute("data-tunnel-z")!);
        const ez = z + camZ;
        el.style.transform = `translate(-50%, -50%) translateZ(${ez}px)`;
        el.style.opacity = ez > 140 ? "0" : ez > 0 ? String(1 - ez / 140) : "1";
      });
      if (tunnelHeadline) tunnelHeadline.style.opacity = String(clamp01((p1 - 0.68) / 0.32));
      if (tunnelStage) tunnelStage.style.transform = `rotateY(${px.current * -3}deg) rotateX(${py.current * 2}deg)`;
      if (tunnelCue) tunnelCue.style.opacity = String(Math.max(0, 1 - p1 * 3));

      if (dust && p1 < 1) {
        const { ctx, parts } = dust;
        ctx.clearRect(0, 0, 800, 600);
        parts.forEach((pt) => {
          pt.x += pt.vx;
          pt.y += pt.vy;
          if (pt.y > 600) {
            pt.y = -4;
            pt.x = Math.random() * 800;
          }
          if (pt.x < -4) pt.x = 804;
          if (pt.x > 804) pt.x = -4;
          const tw = pt.a * (0.6 + 0.4 * Math.sin(t / 900 + pt.ph));
          ctx.fillStyle = `rgba(${themeRef.current === "light" ? "175,140,30," : "227,195,106,"}${tw.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, 6.283);
          ctx.fill();
        });
      }

      // Act II — the plane rises and is read
      const p2 = prog(scanSection);
      if (scanPlane) {
        const lift = Math.min(1, p2 / 0.45);
        scanPlane.style.transform = `rotateX(${48 * (1 - lift)}deg) rotateY(${px.current * -2.5}deg)`;
      }
      if (scanLine) {
        const sp = clamp01((p2 - 0.3) / 0.6);
        scanLine.style.top = `${sp * 100}%`;
        scanLine.style.opacity = p2 > 0.28 && p2 < 0.92 ? "1" : "0";
      }
      if (scanGrid) scanGrid.style.opacity = String(Math.max(0, 0.9 - Math.max(0, p2 - 0.75) * 4));
      scanLabels.forEach((el) => {
        const th = parseFloat(el.getAttribute("data-scan-label")!);
        const on = p2 >= th;
        el.style.opacity = on ? "1" : "0";
        el.style.transform = on ? "translateZ(70px) scale(1)" : "translateZ(70px) scale(.6)";
      });

      // Act III — carousel inertia + snap
      if (!ringDrag.current) rot.current += (rotTarget.current - rot.current) * 0.09;
      if (ring) ring.style.transform = `rotateY(${rot.current}deg)`;
      ringCards.forEach((card, i) => {
        const ang = (((i * 120 + rot.current) % 360) + 360) % 360;
        const facing = Math.cos((ang * Math.PI) / 180);
        card.style.opacity = String(0.38 + 0.62 * Math.max(0, facing));
      });

      // Act IV — room sway + responsive scale
      if (room) {
        const swayY = roomDrag.current ? 0 : Math.sin(t / 2600) * 4;
        const swayX = roomDrag.current ? 0 : Math.cos(t / 3400) * 1.5;
        room.style.transform = `rotateX(${roomRx.current + swayX}deg) rotateY(${roomRy.current + swayY}deg)`;
      }
      if (roomScale && roomZone) roomScale.style.transform = `scale(${Math.min(1, roomZone.clientWidth / 680)})`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanup.push(() => cancelAnimationFrame(raf));

    return () => cleanup.forEach((fn) => fn());
    // mount-only; handlers read live state via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archLayer = (z: number, label: string, grad: string, glow: string, color: string, op: number) => (
    <div
      data-tunnel-z={z}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: "56vmin",
        height: "78vmin",
        transform: `translate(-50%, -50%) translateZ(${z}px)`,
        border: "3px solid transparent",
        borderRadius: "999px 999px 16px 16px",
        background: `linear-gradient(var(--page), var(--page)) padding-box, ${grad} border-box`,
        boxShadow: glow,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <span style={{ marginTop: "5vmin", fontSize: 14, color, opacity: op }}>{label}</span>
    </div>
  );

  return (
    <div
      className="dar-cinema"
      ref={rootRef}
      dir="rtl"
      lang="ar"
      data-theme={theme}
      style={{ background: "var(--page)", color: "var(--ink)", minHeight: "100vh", overflowX: "clip" }}
    >
      {/* ======== CINEMA INTRO ======== */}
      {introVisible && (
        <div
          onClick={dismissIntro}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "var(--page)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            cursor: "pointer",
            transition: `opacity 700ms ${EASE}`,
            opacity: introOpacity,
          }}
        >
          <span
            className="dd-display"
            style={{
              fontWeight: 700,
              fontSize: "clamp(120px, 24vw, 240px)",
              lineHeight: 1.3,
              color: "var(--gold-bright)",
              textShadow: "0 0 90px rgba(var(--gold-rgb),.55)",
              animation: `ddIntroLight 1.6s ${EASE} both`,
            }}
          >
            دار
          </span>
          <span style={{ fontSize: 15, color: "var(--soft)", opacity: 0.8 }}>
            البيت يُفهَم قبل أن يتغيّر · a house is understood before it changes
          </span>
          <span style={{ fontSize: 12, color: "var(--gold)", opacity: 0.7 }}>اضغط للدخول · click to enter</span>
        </div>
      )}

      {/* ======== fixed top bar ======== */}
      <header
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          // The landing predates the app sidebar and pinned itself to the
          // viewport edge. Signed in, the sidebar is 256px of that edge, so
          // the studio CTA and theme toggle were drawn straight over the
          // DarDesign brand lock-up — on the first screen anyone sees. Same
          // variable .dar-build already uses; 0 when there is no sidebar.
          left: "var(--app-sidebar-width, 0px)",
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 28px",
          background: "linear-gradient(to bottom, rgba(var(--page-rgb),.85), transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="dd-display" style={{ fontWeight: 600, fontSize: 22, color: "var(--gold)", whiteSpace: "nowrap" }}>
            دار ديزاين
          </span>
          {/* Dropped on narrow screens: brand + tagline + CTA measure ~457px of
              non-wrapping content, so on a 414px phone the studio button was
              pushed 15px off the left edge. The tagline is the one part that
              is decoration rather than navigation. */}
          <span className="dd-chrome-sub" style={{ fontSize: 12, color: "var(--soft)", opacity: 0.8, whiteSpace: "nowrap" }}>
            سينما الدار · the cinematic house
          </span>
        </div>
        <nav style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={toggleTheme}
            className="dd-icon-btn"
            aria-label="تبديل الإضاءة · toggle light/dark"
            title="تبديل الإضاءة"
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              border: "1px solid rgba(var(--cream-rgb),.3)",
              background: "rgba(var(--gold-rgb),.08)",
              color: "var(--gold)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: `all 180ms ${EASE}`,
            }}
          >
            {theme === "light" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            ) : (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
              </svg>
            )}
          </button>
          <Link
            href="/studio"
            className="dd-cta"
            style={{
              color: "var(--on-gold)",
              background: "var(--gold)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 999,
              padding: "8px 18px",
              whiteSpace: "nowrap",
              transition: `background 180ms ${EASE}`,
            }}
          >
            الاستوديو
          </Link>
        </nav>
      </header>

      {/* ======== fixed act-progress rail ======== */}
      <nav
        data-rail=""
        aria-label="فصول التجربة · chapters"
        style={{
          position: "fixed",
          top: "50%",
          left: 22,
          transform: "translateY(-50%)",
          zIndex: 35,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          opacity: 0,
          transition: `opacity 500ms ${EASE}`,
        }}
      >
        {["العتبة", "الفهم", "التحوّل", "البيت", "الإسناد"].map((name, i) => (
          <button
            key={i}
            data-rail-dot={i}
            className="dd-rail-dot"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                border: "1.5px solid var(--gold)",
                background: "transparent",
                flex: "none",
                transition: `all 280ms ${EASE}`,
              }}
            />
            <span
              style={{ fontSize: 12, color: "var(--soft)", opacity: 0, transform: "translateX(-6px)", transition: `all 280ms ${EASE}`, whiteSpace: "nowrap" }}
            >
              {name}
            </span>
          </button>
        ))}
      </nav>

      {/* ======== ACT I — the threshold tunnel ======== */}
      <section data-act="1" style={{ position: "relative", height: "300vh" }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "hidden",
            background:
              "radial-gradient(ellipse 64% 46% at 50% 42%, rgba(var(--gold-rgb),.16), transparent 62%), radial-gradient(ellipse 70% 40% at 50% 2%, rgba(var(--glow-rgb),.12), transparent 60%), var(--page)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "38%",
              pointerEvents: "none",
              background: "linear-gradient(to top, rgba(var(--gold-rgb),.10), transparent 72%)",
              WebkitMaskImage: "linear-gradient(to top, #000, transparent)",
              maskImage: "linear-gradient(to top, #000, transparent)",
            }}
          />
          <div style={{ position: "absolute", inset: 0, perspective: "1100px", perspectiveOrigin: "50% 46%" }}>
            <div data-tunnel-stage="" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
              {archLayer(-380, "العتبة", "linear-gradient(165deg, var(--gold-light), var(--gold) 45%, #6b5a2a)", "0 0 60px rgba(var(--gold-rgb),.28), inset 0 0 40px rgba(var(--gold-rgb),.10)", "var(--gold-light)", 0.95)}
              {archLayer(-800, "الفهم", "linear-gradient(165deg, var(--gold-bright), var(--gold) 50%, #5c4d24)", "0 0 46px rgba(var(--gold-rgb),.20), inset 0 0 36px rgba(var(--gold-rgb),.08)", "var(--gold-bright)", 0.85)}
              {archLayer(-1220, "التحوّل", "linear-gradient(165deg, var(--gold), #8b7432 55%, #4a3d1d)", "0 0 36px rgba(var(--gold-rgb),.14)", "var(--gold)", 0.75)}
              {archLayer(-1640, "الإسناد", "linear-gradient(165deg, #8b7432, #5c4d24 60%, #3a3017)", "0 0 26px rgba(var(--gold-rgb),.10)", "var(--gold)", 0.6)}

              {/* the room at the end of the tunnel */}
              <div
                data-tunnel-z="-2060"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: "56vmin",
                  height: "78vmin",
                  transform: "translate(-50%, -50%) translateZ(-2060px)",
                  border: "1px solid rgba(var(--gold-rgb),.6)",
                  borderRadius: "999px 999px 16px 16px",
                  padding: "1.2vmin",
                  background: "var(--panel)",
                  boxShadow: "0 0 120px rgba(var(--gold-rgb),.18)",
                }}
              >
                <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "999px 999px 12px 12px", overflow: "hidden", background: "var(--surface)" }}>
                  <div style={{ position: "absolute", inset: 0, filter: "brightness(.85)" }}>
                    <ImageSlot placeholder="الغرفة في آخر النفق — أسقط صورة غرفتك · drop your room at the end of the tunnel" />
                  </div>
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(10,8,5,.32) 0 6px, transparent 6px 24px), repeating-linear-gradient(-45deg, rgba(10,8,5,.32) 0 6px, transparent 6px 24px)",
                      mixBlendMode: "multiply",
                    }}
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      background:
                        "linear-gradient(165deg, rgba(var(--glow-rgb),.25) 0%, transparent 45%), linear-gradient(to top, rgba(24,20,16,.5), transparent 40%)",
                    }}
                  />
                </div>
              </div>

              {/* headline past the last arch */}
              <div
                data-tunnel-z="-2520"
                data-tunnel-headline=""
                style={{ position: "absolute", left: "50%", top: "50%", width: "min(900px, 92vw)", transform: "translate(-50%, -50%) translateZ(-2520px)", textAlign: "center", opacity: 0 }}
              >
                <h1 className="dd-display" style={{ margin: 0, fontWeight: 600, fontSize: "clamp(40px, 7vw, 92px)", lineHeight: 1.4, color: "var(--ink)", textShadow: "0 0 60px rgba(var(--gold-rgb),.45)" }}>
                  الغرفة <span style={{ color: "var(--gold-bright)" }}>المفهومة</span>
                </h1>
                <p style={{ margin: "8px 0 0", fontSize: "clamp(14px, 1.6vw, 18px)", color: "var(--soft)" }}>The Understood Room — one room, known three ways</p>
              </div>
            </div>
          </div>

          <canvas data-dust="" width={800} height={600} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.8 }} />
          <div
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(var(--vignette-rgb),.8) 100%)" }}
          />
          <div data-tunnel-cue="" style={{ position: "absolute", bottom: 28, right: 0, left: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, pointerEvents: "none" }}>
            <span style={{ fontSize: 15, color: "var(--gold)", fontWeight: 500, whiteSpace: "nowrap" }}>اعبر العتبة — مرّر للأمام</span>
            <span style={{ fontSize: 12, color: "var(--soft)", opacity: 0.75, whiteSpace: "nowrap" }}>scroll to walk through the arches</span>
            <span aria-hidden="true" style={{ display: "block", width: 1, height: 26, background: "linear-gradient(to bottom, var(--gold), transparent)", animation: "ddCue 2.2s ease-in-out infinite" }} />
          </div>
        </div>
      </section>

      {/* ======== ACT II — the machine reads ======== */}
      <section data-act="2" style={{ position: "relative", height: "260vh", background: "var(--panel)" }}>
        <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4vmin" }}>
          <div style={{ textAlign: "center", flex: "none" }}>
            <h2 className="dd-display" style={{ margin: 0, fontWeight: 600, fontSize: "clamp(24px, 4vw, 48px)", lineHeight: 1.5, color: "var(--ink)", whiteSpace: "nowrap" }}>
              الآلة تقرأ — لا تخمّن
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--soft)", opacity: 0.85, whiteSpace: "nowrap" }}>depth · segmentation · ontology — watch it read</p>
          </div>

          <div style={{ perspective: "1100px" }}>
            <div
              data-scan-plane=""
              style={{ position: "relative", width: "min(680px, 88vw, 88vh)", aspectRatio: "4 / 3", transformStyle: "preserve-3d", transform: "rotateX(48deg)", borderRadius: 14, boxShadow: "0 60px 120px rgba(0,0,0,.6)" }}
            >
              <div style={{ position: "absolute", inset: 0, borderRadius: 14, overflow: "hidden", background: "radial-gradient(ellipse 90% 70% at 50% 40%, var(--scan), var(--panel))", border: "1px solid rgba(var(--gold-rgb),.45)" }}>
                <ImageSlot placeholder="أسقط صورة الغرفة لتُقرأ · drop a room to be read" />
                <div data-scan-grid="" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(0deg, rgba(var(--glow-rgb),.22) 0 1px, transparent 1px 9%), repeating-linear-gradient(90deg, rgba(var(--glow-rgb),.22) 0 1px, transparent 1px 9%)", opacity: 0.9 }} />
                <div data-scan-line="" aria-hidden="true" style={{ position: "absolute", top: 0, right: 0, left: 0, height: 3, background: "linear-gradient(90deg, transparent, var(--gold-light), transparent)", boxShadow: "0 0 28px 5px rgba(var(--glow-rgb),.6)", pointerEvents: "none" }} />
              </div>
              {/* corner brackets */}
              <div aria-hidden="true" style={{ position: "absolute", top: -7, left: -7, width: 28, height: 28, borderTop: "2px solid var(--gold)", borderLeft: "2px solid var(--gold)", borderRadius: "4px 0 0 0" }} />
              <div aria-hidden="true" style={{ position: "absolute", top: -7, right: -7, width: 28, height: 28, borderTop: "2px solid var(--gold)", borderRight: "2px solid var(--gold)", borderRadius: "0 4px 0 0" }} />
              <div aria-hidden="true" style={{ position: "absolute", bottom: -7, left: -7, width: 28, height: 28, borderBottom: "2px solid var(--gold)", borderLeft: "2px solid var(--gold)", borderRadius: "0 0 0 4px" }} />
              <div aria-hidden="true" style={{ position: "absolute", bottom: -7, right: -7, width: 28, height: 28, borderBottom: "2px solid var(--gold)", borderRight: "2px solid var(--gold)", borderRadius: "0 0 4px 0" }} />
              {/* labels */}
              <div data-scan-label="0.46" style={{ position: "absolute", top: "14%", left: "10%", transform: "translateZ(70px) scale(.6)", opacity: 0, transition: `opacity 500ms ${EASE}, transform 500ms ${EASE}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "rgba(24,20,16,.92)", border: "1px solid var(--gold)", borderRadius: 6, padding: "6px 12px", fontSize: 15, color: "var(--ink)", boxShadow: "0 12px 32px rgba(0,0,0,.5)" }}>
                  نافذة <span style={{ fontSize: 11, color: "var(--soft)", opacity: 0.8 }}>window · ثقة ٩٦٪</span>
                </span>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)" }} />
              </div>
              <div data-scan-label="0.62" style={{ position: "absolute", top: "56%", right: "8%", transform: "translateZ(70px) scale(.6)", opacity: 0, transition: `opacity 500ms ${EASE}, transform 500ms ${EASE}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)" }} />
                <span style={{ background: "rgba(24,20,16,.92)", border: "1px solid var(--gold)", borderRadius: 6, padding: "6px 12px", fontSize: 15, color: "var(--ink)", boxShadow: "0 12px 32px rgba(0,0,0,.5)" }}>
                  أريكة <span style={{ fontSize: 11, color: "var(--soft)", opacity: 0.8 }}>sofa · ثقة ٩٤٪</span>
                </span>
              </div>
              <div data-scan-label="0.78" style={{ position: "absolute", bottom: "10%", left: "24%", transform: "translateZ(70px) scale(.6)", opacity: 0, transition: `opacity 500ms ${EASE}, transform 500ms ${EASE}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "rgba(24,20,16,.92)", border: "1px solid var(--gold)", borderRadius: 6, padding: "6px 12px", fontSize: 15, color: "var(--ink)", boxShadow: "0 12px 32px rgba(0,0,0,.5)" }}>
                  سجادة <span style={{ fontSize: 11, color: "var(--soft)", opacity: 0.8 }}>rug · ثقة ٩١٪</span>
                </span>
                <span aria-hidden="true" style={{ width: 22, height: 1, background: "rgba(var(--gold-rgb),.7)" }} />
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)" }} />
              </div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 15, color: "var(--soft)", opacity: 0.8 }}>مرّر — الصورة تنهض من الطاولة وتُقرأ عنصراً عنصراً</p>
        </div>
      </section>

      {/* ======== ACT III — three souls carousel ======== */}
      <section data-act="3" style={{ position: "relative", padding: "14vh 24px 8vh", background: "var(--page)", overflow: "hidden" }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", transition: `background 700ms ${EASE}`, background: `radial-gradient(ellipse 60% 45% at 50% 65%, ${soul.glow}, transparent 70%)` }} />
        <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto", textAlign: "center" }}>
          <h2 className="dd-display" style={{ margin: "0 0 6px", fontWeight: 600, fontSize: "clamp(32px, 5vw, 60px)", lineHeight: 1.5, color: "var(--ink)" }}>
            نفس العظام — ثلاث أرواح
          </h2>
          <p style={{ margin: "0 0 10px", fontSize: 16, color: "var(--soft)" }}>same bones, three souls — اسحب الحلقة لتدور بين البيوت</p>

          <div data-ring-zone="" style={{ position: "relative", height: "66vmin", minHeight: 450, maxHeight: 580, cursor: "grab", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none" }}>
            <div aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "4%", width: "80%", height: "14%", transform: "translateX(-50%)", background: "radial-gradient(ellipse 50% 60% at 50% 0%, rgba(var(--gold-rgb),.12), transparent 72%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, perspective: "1500px" }}>
              <div data-ring="" style={{ position: "absolute", left: "50%", top: "50%", transformStyle: "preserve-3d", transform: "rotateY(0deg)" }}>
                {([
                  { id: "lebanese", ar: "لبناني", en: "Lebanese", deg: 0, border: "#3E5C44", bg: "var(--surface)", enColor: "#D8C3A5" },
                  { id: "khaleeji", ar: "خليجي", en: "Khaleeji", deg: 120, border: "rgba(var(--gold-rgb),.7)", bg: "#1F2A3A", enColor: "var(--gold)" },
                  { id: "moroccan", ar: "مغربي", en: "Moroccan", deg: 240, border: "#2B50AA", bg: "var(--surface)", enColor: "#C1603D" },
                ] as const).map((c, i) => (
                  <div
                    key={c.id}
                    data-ring-card={i}
                    style={{
                      position: "absolute",
                      left: -150,
                      top: 0,
                      width: 300,
                      height: "clamp(330px, 52vmin, 440px)",
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: `translateY(-50%) rotateY(${c.deg}deg) translateZ(46vmin)`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, border: `1px solid ${c.border}`, borderRadius: "999px 999px 10px 10px", overflow: "hidden", position: "relative", background: c.bg, boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
                      <ImageSlot placeholder={`الروح ${c.ar === "لبناني" ? "اللبنانية" : c.ar === "خليجي" ? "الخليجية" : "المغربية"} · the ${c.en} render`} />
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10 }}>
                      <span className="dd-display" style={{ fontSize: 26, lineHeight: 1.4, fontWeight: 600, color: "var(--ink)" }}>{c.ar}</span>
                      <span style={{ fontSize: 13, color: c.enColor, whiteSpace: "nowrap" }}>{c.en}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 6 }}>
            {ORDER.map((id, i) => (
              <button
                key={id}
                onClick={() => goTo(i)}
                className="dd-picker"
                aria-pressed={tradition === id}
                style={{
                  background: "none",
                  border: `1px solid ${tradition === id ? "var(--gold)" : "rgba(var(--cream-rgb),.3)"}`,
                  color: "var(--ink)",
                  borderRadius: 999,
                  padding: "9px 22px",
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: `all 180ms ${EASE}`,
                }}
              >
                {SOULS[id].ar}
              </button>
            ))}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 15, color: "var(--soft)" }}>{soul.line}</p>
        </div>
      </section>

      {/* ======== ACT IV — the orbitable room ======== */}
      <section data-act="4" style={{ position: "relative", padding: "12vh 24px", background: "var(--panel)", overflow: "hidden" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "4vh" }}>
            <h2 className="dd-display" style={{ margin: 0, fontWeight: 600, fontSize: "clamp(30px, 4.5vw, 56px)", lineHeight: 1.5, color: "var(--ink)" }}>ادخل البيت — وأدِره بيدك</h2>
            <p style={{ margin: "6px 0 0", fontSize: 16, color: "var(--soft)" }}>an orbitable room, reskinned by the soul you chose above — اسحب داخل الغرفة لتدور فيها</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 7fr) minmax(240px, 3fr)", gap: 40, alignItems: "center" }}>
            <div data-room-zone="" style={{ position: "relative", height: 470, overflow: "hidden", cursor: "grab", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none", borderRadius: 14, border: "1px solid rgba(var(--gold-rgb),.14)", background: "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(var(--gold-rgb),.08), var(--page) 72%)" }}>
              <div data-room-scale="" style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0 }}>
                <div style={{ perspective: "950px", position: "absolute", left: -300, top: -210, width: 600, height: 420 }}>
                  <div data-room="" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: "rotateX(-8deg) rotateY(18deg)" }}>
                    {/* back wall + three arches */}
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: 560, height: 340, margin: "-170px 0 0 -280px", transform: "translateZ(-240px)", background: soul.wall, transformStyle: "preserve-3d" }}>
                      {[8, 39, 70].map((leftPct, idx) => (
                        <div key={idx} style={{ position: "absolute", bottom: 0, left: `${leftPct}%`, width: "22%", height: idx === 1 ? "68%" : "62%", borderRadius: soul.archRadius, background: soul.archFill, boxShadow: `inset 0 0 0 5px ${soul.archFrame}` }} />
                      ))}
                    </div>
                    {/* side walls */}
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: 480, height: 340, margin: "-170px 0 0 -240px", transform: "rotateY(90deg) translateZ(-280px)", background: soul.wall }} />
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: 480, height: 340, margin: "-170px 0 0 -240px", transform: "rotateY(-90deg) translateZ(-280px)", background: soul.wall }} />
                    {/* floor + rug */}
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: 560, height: 480, margin: "-240px 0 0 -280px", transform: "rotateX(90deg) translateZ(-170px)", background: soul.floor }}>
                      <div style={{ position: "absolute", left: "50%", top: "54%", width: "62%", height: "40%", transform: "translate(-50%, -50%)", borderRadius: 8, background: soul.rug, boxShadow: "0 0 0 4px rgba(24,20,16,.25)" }} />
                    </div>
                    {/* ceiling */}
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: 560, height: 480, margin: "-240px 0 0 -280px", transform: "rotateX(90deg) translateZ(170px)", background: soul.ceil }} />
                  </div>
                </div>
              </div>
              <span style={{ position: "absolute", bottom: 12, right: 16, fontSize: 12, color: "var(--soft)", opacity: 0.65, pointerEvents: "none" }}>↻ اسحب للدوران · drag to orbit — DepthOrbit يقوم بهذا على صورتك الحقيقية</span>
            </div>

            {/* material legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p className="dd-display" style={{ margin: 0, fontSize: 24, lineHeight: 1.4, color: soul.accentText }}>
                {soul.ar} <span style={{ fontFamily: "var(--font-tajawal), sans-serif", fontSize: 13, color: "var(--soft)", opacity: 0.8 }}>{soul.en}</span>
              </p>
              {soul.mats.map(([ar, en], i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: soul.accent, flex: "none", position: "relative", top: -3 }} />
                  <span style={{ fontSize: 16, color: "var(--ink)" }}>
                    {ar}
                    <span style={{ display: "block", fontSize: 12, color: "var(--soft)", opacity: 0.75 }}>{en}</span>
                  </span>
                </div>
              ))}
              <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.75, color: "var(--soft)", opacity: 0.85 }}>كل خامة هنا مسمّاة ومُسنَدة — لا زخرفة بلا اسم.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ======== ACT V — provenance + the door ======== */}
      <section data-act="5" style={{ position: "relative", padding: "12vh 32px 10vh", background: "var(--page)", overflow: "hidden" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.04,
            pointerEvents: "none",
            backgroundImage:
              "url('data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2296%22 height=%2296%22 viewBox=%220 0 96 96%22%3E%3Cg fill=%22none%22 stroke=%22%23C9A227%22 stroke-width=%221%22%3E%3Cpath d=%22M48 12 L62 34 L84 48 L62 62 L48 84 L34 62 L12 48 L34 34 Z%22/%3E%3Crect x=%2230%22 y=%2230%22 width=%2236%22 height=%2236%22 transform=%22rotate(45 48 48)%22/%3E%3C/g%3E%3C/svg%3E')",
            backgroundSize: "96px 96px",
          }}
        />
        <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto" }}>
          <p data-reveal="" className="dd-display" style={{ margin: "0 0 56px", textAlign: "center", fontSize: "clamp(24px, 3.4vw, 42px)", lineHeight: 1.6, color: "var(--soft)" }}>
            غيرُنا يعطيك ديكوراً — <span style={{ color: "var(--gold-bright)" }}>نحن نعطيك إسناداً.</span>
            <span style={{ display: "block", fontFamily: "var(--font-tajawal), sans-serif", fontSize: 15, opacity: 0.8, marginTop: 6 }}>Every other tool gives you decor. We give you provenance.</span>
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 32, marginBottom: "10vh" }}>
            {[
              { ar: "قناطر", code: "QANATER · لبناني", body: "القوس الثلاثي الذي يتوّج واجهة بيت جبل لبنان منذ القرن التاسع عشر.", src: "May Davie, Beit Beirut: A History of the Lebanese House, 2014" },
              { ar: "سدو", code: "SADU · خليجي", body: "نسيج البادية الهندسي — أحمر وأسود على كريمي، يُحاك على نولٍ أرضي.", src: "Sheikh Mohammed Centre for Cultural Understanding, UAE" },
              { ar: "زليج", code: "ZELLIGE · مغربي", body: "فسيفساء فاس المقطوعة يدوياً، قطعةً قطعة، منذ القرن الرابع عشر.", src: "Aga Khan Documentation Centre, MIT" },
            ].map((c, i) => (
              <article
                key={i}
                data-reveal=""
                data-tilt=""
                style={{ background: "var(--surface)", borderTop: "2px solid var(--gold)", borderRadius: 12, padding: "32px 28px", display: "flex", flexDirection: "column", gap: 12, transition: `transform 300ms ${EASE}`, transformStyle: "preserve-3d", willChange: "transform" }}
              >
                <h3 className="dd-display" style={{ margin: 0, fontSize: 44, lineHeight: 1.4, fontWeight: 600, color: "var(--ink)" }}>{c.ar}</h3>
                <p style={{ margin: 0, fontSize: 13, color: "var(--gold)", letterSpacing: ".08em" }}>{c.code}</p>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.75, color: "var(--soft)" }}>{c.body}</p>
                <p style={{ margin: "auto 0 0", paddingTop: 14, fontSize: 13, color: "var(--soft)", opacity: 0.7, borderTop: "1px solid rgba(var(--cream-rgb),.14)" }}>{c.src}</p>
              </article>
            ))}
          </div>

          <div data-reveal="" style={{ display: "flex", justifyContent: "center" }}>
            <Link
              href="/studio"
              className="dd-door"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                width: "min(340px, 80vw)",
                aspectRatio: "5 / 6",
                border: "1px solid var(--gold)",
                borderRadius: "999px 999px 12px 12px",
                textDecoration: "none",
                background: "linear-gradient(to top, rgba(var(--gold-rgb),.10), transparent 60%)",
                transition: `all 180ms ${EASE}`,
              }}
            >
              <span className="dd-display" style={{ fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.6, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>ادخل الاستوديو</span>
              <span style={{ fontSize: 14, color: "var(--gold)", whiteSpace: "nowrap" }}>Enter the Studio ←</span>
              <span style={{ fontSize: 13, color: "var(--soft)", opacity: 0.75 }}>ارفع صورة غرفتك — اعرفها ثلاث مرات</span>
            </Link>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid rgba(var(--cream-rgb),.12)", padding: "28px 32px", display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 12, background: "var(--page)" }}>
        <span className="dd-display" style={{ color: "var(--gold)", fontSize: 17, whiteSpace: "nowrap" }}>
          دار ديزاين <span style={{ fontFamily: "var(--font-tajawal), sans-serif", fontSize: 12, color: "var(--soft)", opacity: 0.8 }}>DarDesign</span>
        </span>
        <span style={{ fontSize: 14, color: "var(--soft)", opacity: 0.75 }}>كل عنصرٍ مسمّى ومُسنَد · every element named and sourced</span>
      </footer>
    </div>
  );
}
