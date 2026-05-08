"use client";

/** 3D arch tunnel, palette, zellige assembler, colophon. Ported from atelier-finale.jsx. */

import { Fragment, useEffect, useRef, useState } from "react";
import { useMouseParallax, type CssVars } from "./effects";

/* =====================================================
   3D ARCH TUNNEL
   ===================================================== */
export function ArchTunnel() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [depth, setDepth] = useState(0);
  useMouseParallax(stageRef);
  useEffect(() => {
    const onScroll = () => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = vh + r.height;
      const d = Math.max(0, Math.min(1, (vh - r.top) / total));
      setDepth(d);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const archCount = 9;
  const tints = ["#a83232", "#d99a1f", "#1e508f", "#a83232", "#d99a1f", "#1e508f", "#a83232", "#d99a1f", "#3d5a4a"];

  return (
    <section className="tunnel" data-act="Act III · The Tunnel" data-screen-label="04 Tunnel">
      <div className="tunnel-head">
        <div className="reveal eyebrow">A passage</div>
        <h2 className="reveal">Step <em>through</em>.</h2>
        <p className="reveal d2">
          Nine arches deep — the same threshold, walked at three speeds. Move your cursor.
          Scroll. Each plane drifts at its own depth.
        </p>
      </div>

      <div
        className="tunnel-stage"
        ref={stageRef}
        style={{ transform: `rotateX(calc(var(--my,0)*-2deg)) rotateY(calc(var(--mx,0)*4deg))` }}
      >
        {Array.from({ length: archCount }).map((_, i) => {
          const z = -i * 220 + depth * 1400;
          const scale = 1 - i * 0.06;
          const fade = 1 - i * 0.09;
          const tint = tints[i % tints.length];
          const archStyle: CssVars = {
            transform: `translateZ(${z}px) scale(${scale})`,
            opacity: Math.max(0.15, fade),
            "--tint": tint,
          };
          return (
            <div key={i} className="tunnel-arch" style={archStyle}>
              <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id={`tg-${i}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={tint} stopOpacity=".06" />
                    <stop offset="1" stopColor={tint} stopOpacity=".22" />
                  </linearGradient>
                </defs>
                <path
                  d="M 60 800 L 60 280 Q 60 60 300 60 Q 540 60 540 280 L 540 800 Z"
                  fill={`url(#tg-${i})`}
                  stroke={tint}
                  strokeOpacity={0.3 + (1 - i * 0.1) * 0.5}
                  strokeWidth="1.2"
                />
                <path
                  d="M 84 800 L 84 290 Q 84 86 300 86 Q 516 86 516 290 L 516 800 Z"
                  fill="none" stroke="#d4af37"
                  strokeOpacity={0.25 + (1 - i * 0.1) * 0.4}
                  strokeWidth=".6"
                />
                <g transform="translate(300,140)" opacity={Math.max(0.2, 1 - i * 0.1)}>
                  <circle r="22" fill="none" stroke="#d4af37" strokeWidth=".5" />
                  {Array.from({ length: 8 }).map((_, k) => (
                    <line key={k} x1="0" y1="-22" x2="0" y2="22"
                      stroke="#d4af37" strokeWidth=".4" strokeOpacity=".6"
                      transform={`rotate(${k * 22.5})`} />
                  ))}
                  <circle r="2.5" fill={tint} />
                </g>
                {[80, 520].map((x, k) => (
                  <rect key={k} x={x - 6} y="280" width="12" height="500"
                    fill="none" stroke="#d4af37"
                    strokeOpacity={0.2 + (1 - i * 0.1) * 0.3} strokeWidth=".4" />
                ))}
              </svg>
            </div>
          );
        })}

        <div
          className="tunnel-light"
          style={{ opacity: Math.max(0.3, depth * 1.2) }}
        />
      </div>

      <div className="tunnel-floor" />
    </section>
  );
}

/* =====================================================
   PALETTE
   ===================================================== */

interface PaletteSwatch {
  hex: string;
  name: string;
  ar: string;
}

interface PaletteCard {
  name: string;
  arabic: string;
  eyebrow: string;
  note: string;
  swatches: PaletteSwatch[];
  material: "sandstone" | "plaster" | "zellige";
}

const PALETTES: PaletteCard[] = [
  {
    name: "Lebanese",
    arabic: "لبناني",
    eyebrow: "Mountain & sea",
    note: "Sandstone walls hold pomegranate red against oxide green shutters; brass and oil-lamp gold soften every corner.",
    swatches: [
      { hex: "#a83232", name: "Pomegranate", ar: "رمان" },
      { hex: "#d4a774", name: "Sandstone", ar: "حجر رملي" },
      { hex: "#3d5a4a", name: "Oxide", ar: "أكسيد" },
      { hex: "#e8d8b8", name: "Limestone", ar: "كلسي" },
      { hex: "#6e3a1c", name: "Walnut", ar: "جوز" },
    ],
    material: "sandstone",
  },
  {
    name: "Khaleeji",
    arabic: "خليجي",
    eyebrow: "Desert & gulf",
    note: "Saffron caught between coral plaster and pearl-shell ivory; charcoal kohl shadows reach across white-washed walls.",
    swatches: [
      { hex: "#d99a1f", name: "Saffron", ar: "زعفران" },
      { hex: "#f0e6d0", name: "Pearl", ar: "لؤلؤ" },
      { hex: "#c98a5f", name: "Coral", ar: "مرجان" },
      { hex: "#1c1c1c", name: "Kohl", ar: "كحل" },
      { hex: "#7a5128", name: "Palm", ar: "نخيل" },
    ],
    material: "plaster",
  },
  {
    name: "Moroccan",
    arabic: "مغربي",
    eyebrow: "Riad & medina",
    note: "Indigo cobalt and saffron meet on white tadelakt; oxblood and brass close the circle, deep and deliberate.",
    swatches: [
      { hex: "#1e508f", name: "Cobalt", ar: "كوبالت" },
      { hex: "#d99a1f", name: "Saffron", ar: "زعفران" },
      { hex: "#7a1a1a", name: "Oxblood", ar: "دم الثور" },
      { hex: "#ece2cf", name: "Tadelakt", ar: "تادلكت" },
      { hex: "#a87a3a", name: "Brass", ar: "نحاس" },
    ],
    material: "zellige",
  },
];

interface MaterialSampleProps {
  kind: PaletteCard["material"];
  hex: string;
}

function MaterialSample({ kind, hex }: MaterialSampleProps) {
  if (kind === "sandstone") {
    return (
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
        <rect width="200" height="120" fill={hex} />
        {Array.from({ length: 30 }).map((_, i) => (
          <circle key={i} cx={(i * 37) % 200} cy={(i * 23) % 120} r={(i % 3) + 0.6} fill="#000" opacity=".08" />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={i} x1="0" y1={i * 22} x2="200" y2={i * 22 + 3} stroke="#000" strokeOpacity=".05" strokeWidth=".5" />
        ))}
      </svg>
    );
  }
  if (kind === "plaster") {
    return (
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
        <rect width="200" height="120" fill={hex} />
        {Array.from({ length: 18 }).map((_, i) => {
          const x = (i * 53) % 200;
          const y = (i * 29) % 120;
          return (
            <ellipse key={i} cx={x} cy={y} rx={4 + (i % 4)} ry={2 + (i % 3)}
              fill="#fff" opacity=".07" transform={`rotate(${i * 23} ${x} ${y})`} />
          );
        })}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
      <rect width="200" height="120" fill={hex} />
      {Array.from({ length: 5 }).map((_, r) =>
        Array.from({ length: 8 }).map((_, c) => (
          <g key={`${r}-${c}`} transform={`translate(${c * 26 + 13},${r * 26 + 13})`}>
            <path d="M0 -10 L10 0 L0 10 L-10 0 Z" fill="#fff" fillOpacity=".12" />
            <path d="M0 -10 L10 0 L0 10 L-10 0 Z" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth=".5" />
          </g>
        )),
      )}
    </svg>
  );
}

export function Palette() {
  return (
    <section className="palette" data-act="Act IV · The Palette" data-screen-label="05 Palette">
      <div className="palette-head">
        <div className="reveal eyebrow">Act IV · A reading of color</div>
        <h2 className="reveal">Three <em>palettes</em>. Read like <em>poems</em>.</h2>
      </div>
      <div className="palette-grid">
        {PALETTES.map((p, i) => (
          <article className="palette-card reveal" key={p.name} style={{ transitionDelay: `${i * 120}ms` }}>
            <div className="palette-material">
              <MaterialSample kind={p.material} hex={p.swatches[1].hex} />
              <div className="palette-material-tag">{p.eyebrow}</div>
            </div>
            <div className="palette-body">
              <div className="palette-name">
                <h3>{p.name}</h3>
                <span className="ar">{p.arabic}</span>
              </div>
              <p>{p.note}</p>
              <div className="palette-swatches">
                {p.swatches.map((s, k) => {
                  const style: CssVars = { "--c": s.hex, animationDelay: `${k * 0.1}s` };
                  return (
                    <div className="swatch" key={k} style={style}>
                      <div className="swatch-chip" />
                      <div className="swatch-meta">
                        <b>{s.name}</b>
                        <span>{s.ar}</span>
                        <code>{s.hex}</code>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* =====================================================
   ZELLIGE ASSEMBLER
   ===================================================== */
export function ZelligeAssembler() {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height * 0.6)));
      setProgress(p);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cols = 12;
  const rows = 8;
  const tiles: { r: number; c: number; ringT: number; visible: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const center = Math.hypot(c - cols / 2, r - rows / 2);
      const maxC = Math.hypot(cols / 2, rows / 2);
      const ringT = center / maxC;
      const visible = progress * 1.2 > ringT;
      tiles.push({ r, c, ringT, visible });
    }
  }

  return (
    <section className="zellige" data-act="Act V · Zellige" data-screen-label="06 Zellige">
      <div className="zellige-head">
        <div className="reveal eyebrow">A pattern, assembling</div>
        <h2 className="reveal">Geometry, falling <em>into place</em>.</h2>
        <p className="reveal d2">
          Twelve by eight tiles. Each one a hand-cut shape. Scroll, and the medina builds itself —
          ring by ring from a single center.
        </p>
      </div>
      <div className="zellige-grid" ref={ref}>
        {tiles.map((t, i) => {
          const tint =
            t.ringT < 0.3
              ? "#d99a1f"
              : t.ringT < 0.55
                ? "#1e508f"
                : t.ringT < 0.8
                  ? "#a83232"
                  : "#3d5a4a";
          const tileStyle: CssVars = {
            gridColumn: t.c + 1,
            gridRow: t.r + 1,
            "--tint": tint,
            transitionDelay: `${t.ringT * 0.4}s`,
          };
          return (
            <div key={i} className={`zellige-tile ${t.visible ? "on" : ""}`} style={tileStyle}>
              <svg viewBox="-30 -30 60 60">
                <path d="M0 -22 L6 -8 L22 0 L6 8 L0 22 L-6 8 L-22 0 L-6 -8 Z"
                  fill={tint} fillOpacity=".25" stroke={tint} strokeWidth=".8" />
                <path d="M0 -10 L4 -4 L10 0 L4 4 L0 10 L-4 4 L-10 0 L-4 -4 Z"
                  fill="#d4af37" fillOpacity=".5" />
              </svg>
            </div>
          );
        })}
        <div className="zellige-frame" />
        <div className="zellige-caption">
          <span>{Math.round(progress * 100)}%</span>
          <i></i>
          <span>Assembled</span>
        </div>
      </div>
    </section>
  );
}

/* =====================================================
   COLOPHON
   ===================================================== */
export function Colophon() {
  const stats = [
    { num: "3", label: "Cultural traditions", ar: "تقاليد" },
    { num: "25 × 3", label: "Ontology terms", ar: "مصطلحات" },
    { num: "2", label: "ControlNet conditions", ar: "شروط" },
    { num: "EN · AR", label: "Bilingual interface", ar: "لغتان" },
  ];
  const pipeline = [
    "Photograph", "Depth · Anything V2", "OneFormer · ADE20K",
    "Ontology · EN/AR", "LoRA · per-culture", "SDXL · dual ControlNet",
    "Rendered Room",
  ];
  return (
    <section className="colophon" data-act="Colophon" data-screen-label="09 Colophon">
      <div className="colophon-rule" />
      <div className="colophon-grid">
        <div className="reveal">
          <div className="eyebrow">Final-year project</div>
          <h2>An <em>undergraduate</em> thesis<br />in three traditions.</h2>
          <p style={{ marginTop: "32px" }}>
            Dar is a final-year project at the intersection of design heritage and
            generative imaging. A bilingual web application reads a photograph,
            consults a culturally-specific ontology, and renders the same room as
            it would live in a Lebanese villa, a Khaleeji majlis, or a Moroccan riad.
          </p>
        </div>
        <div className="colophon-stats reveal d2">
          {stats.map((s, i) => (
            <div className="stat" key={i} style={{ transitionDelay: `${i * 80}ms` }}>
              <b>{s.num}</b>
              <span>{s.label}</span>
              <i>{s.ar}</i>
            </div>
          ))}
        </div>
      </div>

      <div className="colophon-stack reveal d3">
        <div className="eyebrow" style={{ justifyContent: "center" }}>Pipeline</div>
        <div className="stack-row">
          {pipeline.map((s, i) => (
            <Fragment key={i}>
              <div className="stack-pill"><i>{i + 1}</i><span>{s}</span></div>
              {i < pipeline.length - 1 && <div className="stack-arrow">→</div>}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="colophon-rule" />
    </section>
  );
}
