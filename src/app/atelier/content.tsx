"use client";

/** Manifesto, Alchemy (5-step room transform), Atlas (ornament library), Coda (final door).
 *  Ported from atelier-content.jsx. */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMouseParallax } from "./effects";

/* ============================================================
   ALCHEMY — 5-step room transform
   ============================================================ */

interface AlchemyStep {
  n: string;
  title: string;
  body: string;
}

const STEPS: AlchemyStep[] = [
  { n: "i", title: "The Room You Have", body: "Upload a photograph. We read its bones — depth, segmentation, the geometry of a doorway, where a window catches afternoon." },
  { n: "ii", title: "The Vocabulary", body: "A cultural ontology — twenty-five terms across three regions — translates English and Arabic intent into the language of materials, patterns, light." },
  { n: "iii", title: "The Hand", body: "A LoRA trained on curated reference rooms gives the model the muscle memory of a specific tradition: how a Lebanese vault should fall, how zellige catches light." },
  { n: "iv", title: "The Rendering", body: "SDXL with dual ControlNet — depth and segmentation — composes a new room that respects your existing geometry but speaks a different cultural dialect." },
  { n: "v", title: "The Room You Inherit", body: "Side-by-side, you receive both rooms. The original you photographed, and the one Dar imagined for you. Choose; share; live with it." },
];

interface RoomTransformProps {
  step: number;
}

function RoomTransform({ step }: RoomTransformProps) {
  return (
    <div className="alchemy-canvas">
      <svg className="room-svg" viewBox="0 0 480 360" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="rt-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3d2a1c" />
            <stop offset="1" stopColor="#1a140d" />
          </linearGradient>
          <linearGradient id="rt-wall" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#2a221a" />
            <stop offset="1" stopColor="#14110d" />
          </linearGradient>
          <pattern id="rt-zellige" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <rect width="22" height="22" fill="#1e508f" fillOpacity=".25" />
            <path d="M11 2 L20 11 L11 20 L2 11 Z" fill="none" stroke="#d4af37" strokeWidth=".4" />
            <circle cx="11" cy="11" r="1.2" fill="#d99a1f" />
          </pattern>
          <pattern id="rt-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 0 L40 0 L40 40 L0 40 Z" fill="none" stroke="#d4af37" strokeOpacity=".4" strokeWidth=".4" />
            <circle cx="20" cy="20" r="1" fill="#d4af37" opacity=".5" />
          </pattern>
        </defs>

        <rect x="0" y="0" width="480" height="240" fill="url(#rt-wall)" />
        <rect x="0" y="240" width="480" height="120" fill="url(#rt-floor)" />
        <line x1="0" y1="240" x2="240" y2="160" stroke="#d4af37" strokeOpacity=".15" strokeWidth=".5" />
        <line x1="480" y1="240" x2="240" y2="160" stroke="#d4af37" strokeOpacity=".15" strokeWidth=".5" />

        {step === 0 && (
          <g>
            <rect x="60" y="80" width="120" height="120" fill="#0a0907" stroke="#8a8170" strokeWidth=".6" />
            <line x1="60" y1="140" x2="180" y2="140" stroke="#8a8170" strokeWidth=".4" />
            <line x1="120" y1="80" x2="120" y2="200" stroke="#8a8170" strokeWidth=".4" />
            <rect x="280" y="180" width="120" height="50" fill="#3d2a1c" stroke="#8a8170" strokeWidth=".5" />
            <text x="240" y="50" textAnchor="middle" fill="#8a8170" fontSize="9" letterSpacing="3">PHOTOGRAPH · 4032 × 3024</text>
          </g>
        )}

        {step === 1 && (
          <g>
            <rect x="0" y="0" width="480" height="240" fill="url(#rt-grid)" opacity=".7" />
            <g fill="none" stroke="#d99a1f" strokeOpacity=".7" strokeWidth=".5">
              <ellipse cx="240" cy="150" rx="220" ry="80" />
              <ellipse cx="240" cy="150" rx="160" ry="60" />
              <ellipse cx="240" cy="150" rx="100" ry="40" />
            </g>
            <rect x="60" y="80" width="120" height="120" fill="#1e508f" fillOpacity=".4" stroke="#1e508f" />
            <text x="120" y="146" textAnchor="middle" fill="#ece2cf" fontSize="9">window</text>
            <rect x="280" y="180" width="120" height="50" fill="#a83232" fillOpacity=".4" stroke="#a83232" />
            <text x="340" y="210" textAnchor="middle" fill="#ece2cf" fontSize="9">sofa</text>
            <text x="240" y="50" textAnchor="middle" fill="#d99a1f" fontSize="9" letterSpacing="3">DEPTH · SEGMENTATION</text>
          </g>
        )}

        {step === 2 && (
          <g>
            {["arch · قوس", "zellige · زليج", "tadelakt", "muqarnas", "mashrabiya", "saffron", "indigo", "cedar", "brass", "triple-arch"].map((t, i) => {
              const x = 40 + (i * 44) % 400;
              const y = 60 + (i * 53) % 170;
              return (
                <g key={i} transform={`translate(${x},${y})`}>
                  <rect x="-2" y="-12" width={t.length * 5 + 8} height="18" fill="#0a0907" stroke="#d4af37" strokeOpacity=".7" strokeWidth=".4" />
                  <text fill="#d4af37" fontSize="9" fontFamily="serif">{t}</text>
                </g>
              );
            })}
            <text x="240" y="50" textAnchor="middle" fill="#d4af37" fontSize="9" letterSpacing="3">ONTOLOGY · 25 × 3</text>
          </g>
        )}

        {step === 3 && (
          <g>
            <rect x="40" y="60" width="180" height="160" fill="url(#rt-zellige)" />
            <rect x="40" y="60" width="180" height="160" fill="none" stroke="#d4af37" strokeWidth=".7" />
            <text x="130" y="55" textAnchor="middle" fill="#d4af37" fontSize="9" letterSpacing="3">MOROCCAN · LoRA</text>
            <g transform="translate(340, 140)">
              <circle r="60" fill="none" stroke="#d99a1f" strokeOpacity=".5" strokeWidth=".5" />
              <circle r="40" fill="none" stroke="#d99a1f" strokeOpacity=".7" strokeWidth=".5" />
              <circle r="20" fill="none" stroke="#d99a1f" strokeWidth=".7" />
              {Array.from({ length: 8 }).map((_, i) => (
                <line key={i} x1="0" y1="-60" x2="0" y2="60"
                  stroke="#d99a1f" strokeWidth=".5" strokeOpacity=".5"
                  transform={`rotate(${i * 22.5})`} />
              ))}
              <text y="80" textAnchor="middle" fill="#d99a1f" fontSize="8" letterSpacing="2">RANK 16</text>
            </g>
          </g>
        )}

        {step === 4 && (
          <g>
            <g transform="translate(120, 80)">
              <path d="M -60 140 L -60 60 C -60 40, -50 30, -35 30 C -25 30, -18 40, -15 45 C -10 30, 0 20, 8 20 C 16 22, 20 32, 20 36 C 23 30, 30 22, 40 22 C 55 22, 60 36, 60 56 L 60 140 Z"
                fill="url(#rt-zellige)" stroke="#d4af37" strokeWidth=".6" />
            </g>
            <rect x="240" y="178" width="200" height="56" fill="#a83232" fillOpacity=".5" stroke="#d4af37" strokeWidth=".4" />
            <rect x="248" y="170" width="40" height="14" fill="#d99a1f" fillOpacity=".7" />
            <rect x="296" y="170" width="40" height="14" fill="#1e508f" fillOpacity=".7" />
            <rect x="344" y="170" width="40" height="14" fill="#3d5a4a" fillOpacity=".7" />
            <rect x="392" y="170" width="40" height="14" fill="#a83232" fillOpacity=".7" />
            <g transform="translate(260,90)">
              <line x1="0" y1="-30" x2="0" y2="0" stroke="#d4af37" strokeWidth=".4" />
              <path d="M 0 -10 L 14 0 L 0 10 L -14 0 Z" fill="#0a0907" stroke="#f3dc92" strokeWidth=".5" />
              <circle r="3" fill="#f3dc92" />
              <circle r="22" fill="#f3dc92" fillOpacity=".06" />
            </g>
            <rect x="0" y="240" width="480" height="120" fill="url(#rt-zellige)" opacity=".6" />
            <text x="240" y="50" textAnchor="middle" fill="#f3dc92" fontSize="9" letterSpacing="3">RENDERED · 1024 × 1024</text>
          </g>
        )}

        <g transform="translate(240, 340)">
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={(i - 2) * 16} cy="0" r={i === step ? 3.5 : 2}
              fill={i === step ? "#f3dc92" : "#8a8170"} />
          ))}
        </g>
      </svg>
    </div>
  );
}

export function Alchemy() {
  const [step, setStep] = useState(0);
  const hoverRef = useRef(false);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!hoverRef.current) setStep((s) => (s + 1) % STEPS.length);
    }, 4000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <section className="alchemy" data-act="Act V · The Alchemy" data-screen-label="06 Alchemy">
      <div className="alchemy-head">
        <div className="grid">
          <div>
            <div className="reveal eyebrow">Act V · The Alchemy</div>
            <h2 className="reveal">
              Five movements. <em>One</em> room transformed.
            </h2>
          </div>
          <p className="reveal d2">
            How a photograph becomes a Lebanese living room. A walk through the
            machine — read it left to right, top to bottom, and watch the room
            change in real time.
          </p>
        </div>
      </div>
      <div
        className="alchemy-grid"
        onMouseEnter={() => { hoverRef.current = true; }}
        onMouseLeave={() => { hoverRef.current = false; }}
      >
        <RoomTransform step={step} />
        <div className="alchemy-controls">
          {STEPS.map((s, i) => (
            <div key={i} className={`step ${i === step ? "active" : ""}`} onClick={() => setStep(i)}>
              <div className="num">{s.n}</div>
              <div className="body">
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   ATLAS — generative ornament library
   ============================================================ */

interface OrnamentProps {
  color?: string;
}

function StarBurst({ color = "#d4af37" }: OrnamentProps & { points?: number }) {
  const points = 8;
  const r1 = 60;
  const r2 = 28;
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r1 : r2;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${Math.cos(a) * r},${Math.sin(a) * r}`);
  }
  return (
    <svg viewBox="-80 -80 160 160">
      <polygon points={pts.join(" ")} fill="none" stroke={color} strokeWidth=".8" />
      <circle r={r1} fill="none" stroke={color} strokeOpacity=".25" />
      <circle r={r2} fill="none" stroke={color} strokeOpacity=".4" />
      <circle r="3" fill={color} />
    </svg>
  );
}

function Mandala({ color = "#d4af37", petals = 12 }: OrnamentProps & { petals?: number }) {
  return (
    <svg viewBox="-80 -80 160 160">
      <circle r="62" fill="none" stroke={color} strokeOpacity=".3" strokeWidth=".5" />
      <circle r="40" fill="none" stroke={color} strokeOpacity=".5" strokeWidth=".5" />
      {Array.from({ length: petals }).map((_, i) => (
        <ellipse key={i} cx="0" cy="-46" rx="6" ry="22"
          fill="none" stroke={color} strokeWidth=".7"
          transform={`rotate(${i * (360 / petals)})`} />
      ))}
      <circle r="8" fill={color} fillOpacity=".5" />
    </svg>
  );
}

function Muqarnas({ color = "#d4af37" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      {[0, 1, 2].map((row) =>
        Array.from({ length: 5 - row }).map((_, c) => {
          const x = (c - (4 - row) / 2) * 28;
          const y = -50 + row * 30;
          return (
            <g key={`${row}-${c}`} transform={`translate(${x},${y})`}>
              <path d="M -12 14 L -12 0 Q -12 -14 0 -14 Q 12 -14 12 0 L 12 14 Z"
                fill="none" stroke={color} strokeWidth=".6" />
            </g>
          );
        }),
      )}
    </svg>
  );
}

function Arabesque({ color = "#d4af37" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      <g fill="none" stroke={color} strokeWidth=".8">
        <path d="M0 -60 C 30 -60, 60 -30, 60 0 C 60 30, 30 60, 0 60 C -30 60, -60 30, -60 0 C -60 -30, -30 -60, 0 -60 Z" />
        <path d="M0 -40 C 20 -40, 40 -20, 40 0 C 40 20, 20 40, 0 40 C -20 40, -40 20, -40 0 C -40 -20, -20 -40, 0 -40 Z" transform="rotate(45)" />
        <circle r="14" />
        <path d="M-20 0 Q 0 -20, 20 0 Q 0 20, -20 0 Z" />
        <path d="M0 -20 Q 20 0, 0 20 Q -20 0, 0 -20 Z" />
      </g>
      <circle r="3" fill={color} />
    </svg>
  );
}

function FanLight({ color = "#d4af37" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      <g fill="none" stroke={color} strokeWidth=".7">
        <path d="M -60 40 L -60 0 Q -60 -50 0 -50 Q 60 -50 60 0 L 60 40 Z" />
        {Array.from({ length: 9 }).map((_, i) => {
          const a = -Math.PI + (i / 8) * Math.PI;
          return <line key={i} x1="0" y1="0" x2={Math.cos(a) * 60} y2={Math.sin(a) * 60} strokeWidth=".4" />;
        })}
        <path d="M -50 0 Q 0 -40, 50 0" strokeWidth=".5" />
        <path d="M -36 0 Q 0 -28, 36 0" strokeWidth=".5" />
      </g>
    </svg>
  );
}

function Mashrabiya({ color = "#d4af37" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      <g fill="none" stroke={color} strokeWidth=".5" strokeOpacity=".9">
        {Array.from({ length: 5 }).map((_, r) =>
          Array.from({ length: 5 }).map((_, c) => {
            const x = (c - 2) * 26;
            const y = (r - 2) * 26;
            return (
              <g key={`${r}-${c}`} transform={`translate(${x},${y})`}>
                <path d="M0 -10 L 8.66 -5 L 8.66 5 L 0 10 L -8.66 5 L -8.66 -5 Z" />
                <circle r="2.5" />
              </g>
            );
          }),
        )}
      </g>
    </svg>
  );
}

function PomegranatePattern({ color = "#a83232" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      <g>
        {[0, 1, 2].map((i) => {
          const x = (i - 1) * 32;
          return (
            <g key={i} transform={`translate(${x}, 0)`}>
              <circle r="22" fill="none" stroke={color} strokeWidth=".7" />
              <circle r="22" fill={color} fillOpacity=".15" />
              <path d={`M -3 -22 L 0 -28 L 3 -22 L 1 -19 L -1 -19 Z`} fill="#3d2a1c" />
              {[-10, 0, 10].map((dx, k) => (
                <circle key={k} cx={dx} cy={k === 1 ? 0 : 6} r="3" fill={color} fillOpacity=".5" />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function MultifoilArch({ color = "#d4af37" }: OrnamentProps) {
  return (
    <svg viewBox="-80 -80 160 160">
      <path d="
        M -50 60
        L -50 0
        C -50 -16, -42 -28, -28 -28
        C -18 -28, -12 -20, -10 -16
        C -4 -28, 8 -38, 18 -38
        C 26 -36, 30 -28, 30 -22
        C 30 -28, 38 -38, 48 -38
        C 56 -36, 50 -16, 50 0
        L 50 60 Z" fill="none" stroke={color} strokeWidth=".9" />
      <circle r="3" fill={color} />
    </svg>
  );
}

interface AtlasMotif {
  Comp: (p: OrnamentProps) => React.JSX.Element;
  num: string;
  name: string;
  region: string;
}

const ATLAS: AtlasMotif[] = [
  { Comp: StarBurst, num: "01", name: "Eight-Point Star", region: "Pan-Arab" },
  { Comp: Mandala, num: "02", name: "Rosette", region: "Maghreb" },
  { Comp: MultifoilArch, num: "03", name: "Multifoil Arch", region: "Morocco" },
  { Comp: Mashrabiya, num: "04", name: "Mashrabiya", region: "Khaleej" },
  { Comp: Muqarnas, num: "05", name: "Muqarnas", region: "Andalusia" },
  { Comp: Arabesque, num: "06", name: "Arabesque", region: "Pan-Arab" },
  { Comp: FanLight, num: "07", name: "Fanlight", region: "Levant" },
  { Comp: PomegranatePattern, num: "08", name: "Pomegranate", region: "Lebanon" },
];

export function Atlas() {
  return (
    <section className="atlas" data-act="Act VI · The Atlas" data-screen-label="07 Atlas">
      <div className="atlas-head">
        <div className="reveal eyebrow">Act VI · The Atlas</div>
        <h2 className="reveal">A vocabulary of <em>ornament</em>.</h2>
        <p className="reveal d2" style={{ margin: "24px auto 0" }}>
          Eight motifs the studio draws on, again and again. Each one is a chord — composable,
          recombinable, layerable. Hover any cell to see it tilt into the light.
        </p>
      </div>
      <div className="atlas-grid">
        {ATLAS.map((m, i) => (
          <div className="atlas-cell reveal" key={i} style={{ transitionDelay: `${(i % 4) * 80}ms` }}>
            <m.Comp />
            <div className="label">
              <b>{m.name}</b>
              <span>{m.num} · {m.region}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   MANIFESTO — Act I body after hero
   ============================================================ */
export function Manifesto() {
  return (
    <section data-act="Act I · Manifesto" data-screen-label="02 Manifesto">
      <div className="manifesto">
        <div className="manifesto-num reveal">I</div>
        <div className="manifesto-body">
          <div className="reveal eyebrow">An invocation</div>
          <p className="lead reveal d2">
            A house, in Arabic, is <em>دار</em> — <em>dar</em>. The word holds both
            shelter and the slow turning of a thing toward what it should be.
          </p>
          <p className="reveal d3">
            Dar is an atelier for Arabic interior design. We do not redecorate rooms;
            we translate them. A photograph from your phone enters one tradition;
            the same room re-emerges in another — Lebanese, Khaleeji, Moroccan —
            with its bones intact and its skin remembered.
          </p>
          <p className="reveal d4">
            What follows is a tour of the studio: three houses, five movements,
            an atlas of ornament, and a door at the end you may decide to walk through.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   CODA — final door. CTA routes to /transform (the real upload page).
   ============================================================ */
export function Coda() {
  const ref = useRef<HTMLDivElement>(null);
  useMouseParallax(ref);
  const router = useRouter();
  return (
    <section className="coda" data-act="Act VII · The Door" data-screen-label="08 Door">
      <div className="reveal eyebrow" style={{ justifyContent: "center" }}>Act VII · The Door</div>
      <div
        className="coda-arch-frame reveal d2"
        ref={ref}
        style={{ transform: "translate3d(calc(var(--mx,0)*-10px), calc(var(--my,0)*-6px),0)" }}
      >
        <svg viewBox="0 0 400 540" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="door-glow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f3dc92" stopOpacity=".7" />
              <stop offset="1" stopColor="#a83232" stopOpacity=".15" />
            </linearGradient>
          </defs>
          <path d="M 40 540 L 40 200 Q 40 20, 200 20 Q 360 20, 360 200 L 360 540 Z"
            fill="none" stroke="#d4af37" strokeWidth="1" />
          <path d="M 60 540 L 60 210 Q 60 40, 200 40 Q 340 40, 340 210 L 340 540 Z"
            fill="url(#door-glow)" opacity=".18" />
          <path d="M 80 540 L 80 220 Q 80 60, 200 60 Q 320 60, 320 220 L 320 540 Z"
            fill="none" stroke="#f3dc92" strokeOpacity=".5" strokeWidth=".6" />
          <g transform="translate(200, 100)" opacity=".7">
            <circle r="32" fill="none" stroke="#d4af37" strokeWidth=".5" />
            <circle r="20" fill="none" stroke="#d4af37" strokeWidth=".5" />
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={i} x1="0" y1="-32" x2="0" y2="32"
                stroke="#d4af37" strokeWidth=".4" strokeOpacity=".6"
                transform={`rotate(${i * 22.5})`} />
            ))}
            <circle r="3" fill="#f3dc92" />
          </g>
          <circle cx="200" cy="380" r="6" fill="none" stroke="#f3dc92" strokeWidth=".7" />
          <circle cx="200" cy="380" r="2" fill="#f3dc92" />
        </svg>
        <div className="knock">
          Bring us a <em>room</em>.<br />
          We&apos;ll open <em>the door</em>.
        </div>
        <div className="coda-arabic">أهلاً وسهلاً</div>
      </div>
      <button
        className="coda-cta reveal d3"
        type="button"
        onClick={() => router.push("/transform")}
      >
        Bring a room
        <span style={{ fontSize: 14 }}>→</span>
      </button>
      <div className="coda-foot reveal d4">
        <span>Dar · دار</span>
        <i></i>
        <span>Beit Studio</span>
        <i></i>
        <span>MMXXVI</span>
      </div>
    </section>
  );
}
