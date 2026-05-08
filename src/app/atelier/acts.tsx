"use client";

/** The Three Acts: Lebanese, Khaleeji, Moroccan. Each is a full-bleed split-screen
 *  with a hand-built ornamental SVG stage. Ported from atelier-acts.jsx. */

import { useRef } from "react";
import { useMouseParallax } from "./effects";

function StageLebanese() {
  const ref = useRef<HTMLDivElement>(null);
  useMouseParallax(ref);
  return (
    <div
      className="act-stage"
      ref={ref}
      style={{ transform: "translate3d(calc(var(--mx,0)*-12px), calc(var(--my,0)*-8px),0)" }}
    >
      <div className="stage-bg" />
      <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="leb-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3a1e1a" />
            <stop offset=".6" stopColor="#1a0e0c" />
            <stop offset="1" stopColor="#0c0a08" />
          </linearGradient>
          <linearGradient id="leb-stone" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ece2cf" stopOpacity=".08" />
            <stop offset="1" stopColor="#ece2cf" stopOpacity=".02" />
          </linearGradient>
        </defs>
        <rect width="800" height="1000" fill="url(#leb-sky)" />

        <path d="M0 620 L120 540 L220 600 L350 480 L480 580 L620 500 L800 600 L800 700 L0 700 Z"
          fill="#0c0a08" opacity=".7" />
        <path d="M0 660 L160 600 L300 640 L440 560 L600 620 L800 580 L800 720 L0 720 Z"
          fill="#0c0a08" opacity=".5" />

        <g transform="translate(100,300)">
          <rect x="-10" y="0" width="620" height="500" fill="url(#leb-stone)" stroke="#a83232" strokeOpacity=".3" strokeWidth=".5" />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${80 + i * 160},80)`}>
              <path d={`M 0 320 L 0 140 Q 0 0 60 0 Q 120 0 120 140 L 120 320 Z`}
                fill="#0c0a08" stroke="#d4af37" strokeWidth=".8" opacity=".95" />
              <path d={`M 12 320 L 12 144 Q 12 14 60 14 Q 108 14 108 144 L 108 320 Z`}
                fill="none" stroke="#a83232" strokeWidth=".5" opacity=".5" />
              <g stroke="#d4af37" strokeWidth=".5" opacity=".6">
                <line x1="12" y1="220" x2="108" y2="220" />
                {Array.from({ length: 7 }).map((_, k) => (
                  <line key={k} x1={20 + k * 12} y1="220" x2={20 + k * 12} y2="320" />
                ))}
                <path d="M30 240 Q 60 230 90 240 M30 270 Q 60 260 90 270"
                  fill="none" strokeWidth=".4" />
              </g>
            </g>
          ))}
          <path d="M-30 0 L 630 0 L 600 -40 L 0 -40 Z" fill="#0a0907" stroke="#d4af37" strokeWidth=".4" strokeOpacity=".5" />
          {Array.from({ length: 30 }).map((_, i) => (
            <line key={i} x1={i * 22 - 30} y1="-2" x2={i * 22 - 22} y2="-40"
              stroke="#a83232" strokeOpacity=".2" strokeWidth=".4" />
          ))}
        </g>

        <g transform="translate(-30,720)" opacity=".95">
          <path d="M0 200 Q 80 180 160 140 Q 240 100 320 110 Q 400 120 460 80"
            fill="none" stroke="#3d2a1c" strokeWidth="2.5" />
          {([
            [120, 168, "#a83232"],
            [200, 128, "#a83232"],
            [280, 104, "#a83232"],
            [360, 114, "#a83232"],
            [420, 90, "#d99a1f"],
            [80, 182, "#a83232"],
          ] as Array<[number, number, string]>).map(([x, y, c], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="9" fill={c} opacity=".85" />
              <path d={`M${x - 2} ${y - 9} L${x} ${y - 13} L${x + 2} ${y - 9} L${x + 1} ${y - 7} L${x - 1} ${y - 7} Z`} fill="#3d2a1c" />
            </g>
          ))}
          {Array.from({ length: 14 }).map((_, i) => {
            const x = 30 + i * 32;
            const y = 200 - i * 7 + (i % 2) * 10;
            return (
              <ellipse key={i} cx={x} cy={y} rx="9" ry="3.5"
                fill="#3d5a4a" opacity=".7" transform={`rotate(${-30 + i * 8} ${x} ${y})`} />
            );
          })}
        </g>

        {[60, 720].map((x, i) => (
          <path key={i} d={`M${x} 700 Q ${x - 14} 540 ${x} 380 Q ${x + 14} 540 ${x} 700 Z`}
            fill="#0a0907" opacity=".7" />
        ))}

        {[180, 340, 500].map((x, i) => (
          <ellipse key={i} cx={x} cy="540" rx="40" ry="80" fill="#d4af37" opacity=".06" />
        ))}
      </svg>
    </div>
  );
}

function StageKhaleeji() {
  const ref = useRef<HTMLDivElement>(null);
  useMouseParallax(ref);
  return (
    <div
      className="act-stage"
      ref={ref}
      style={{ transform: "translate3d(calc(var(--mx,0)*-12px), calc(var(--my,0)*-8px),0)" }}
    >
      <div className="stage-bg" />
      <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="kha-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3a2a0e" />
            <stop offset=".4" stopColor="#1a1208" />
            <stop offset="1" stopColor="#0c0a08" />
          </linearGradient>
          <radialGradient id="kha-sun" cx=".5" cy=".5" r=".6">
            <stop offset="0" stopColor="#f3dc92" stopOpacity=".7" />
            <stop offset="1" stopColor="#f3dc92" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="kha-dune" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d99a1f" stopOpacity=".4" />
            <stop offset="1" stopColor="#d99a1f" stopOpacity=".05" />
          </linearGradient>
        </defs>
        <rect width="800" height="1000" fill="url(#kha-sky)" />

        <circle cx="600" cy="380" r="140" fill="url(#kha-sun)" />
        <circle cx="600" cy="380" r="44" fill="#f3dc92" opacity=".4" />

        <g transform="translate(420,200)">
          <rect x="0" y="0" width="60" height="200" fill="#0c0a08" stroke="#d4af37" strokeOpacity=".5" strokeWidth=".5" />
          {Array.from({ length: 6 }).map((_, i) => (
            <rect key={i} x={i * 10} y="-12" width="6" height="14" fill="#0c0a08" stroke="#d4af37" strokeOpacity=".5" strokeWidth=".4" />
          ))}
          <rect x="20" y="40" width="20" height="120" fill="#1a1208" />
          <line x1="30" y1="40" x2="30" y2="160" stroke="#d99a1f" strokeWidth=".4" strokeOpacity=".5" />
        </g>

        <g transform="translate(80, 420)">
          <rect x="0" y="0" width="640" height="380" fill="#0a0907" stroke="#d4af37" strokeOpacity=".4" strokeWidth=".6" />
          {Array.from({ length: 32 }).map((_, i) => (
            <rect key={i} x={i * 20} y="-14" width="12" height="14" fill="#0a0907" stroke="#d4af37" strokeOpacity=".3" strokeWidth=".4" />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} transform={`translate(${30 + i * 120}, 80)`}>
              <path d="M 0 240 L 0 100 Q 0 0 50 -10 Q 100 0 100 100 L 100 240 Z"
                fill="#1a1208" stroke="#d99a1f" strokeWidth=".7" opacity=".95" />
              <g opacity=".5">
                {Array.from({ length: 5 }).map((_, r) =>
                  Array.from({ length: 4 }).map((_, c) => (
                    <circle key={`${r}-${c}`} cx={20 + c * 20} cy={120 + r * 22} r="3"
                      fill="none" stroke="#d4af37" strokeWidth=".4" />
                  )),
                )}
              </g>
            </g>
          ))}
        </g>

        {[40, 700, 740].map((x, i) => (
          <g key={i} transform={`translate(${x}, ${720 + (i % 2) * 30})`}>
            <line x1="0" y1="0" x2="0" y2="-180" stroke="#3d2a1c" strokeWidth="2.5" />
            {Array.from({ length: 9 }).map((_, k) => {
              const a = -90 + k * 22.5;
              const len = 50 + (k % 2) * 15;
              return (
                <path key={k}
                  d={`M 0 -180 Q ${Math.cos((a * Math.PI) / 180) * 20} ${-180 + Math.sin((a * Math.PI) / 180) * 20} ${Math.cos((a * Math.PI) / 180) * len} ${-180 + Math.sin((a * Math.PI) / 180) * len}`}
                  fill="none" stroke="#3d5a4a" strokeWidth="2" opacity=".75" />
              );
            })}
          </g>
        ))}

        <path d="M0 800 Q 200 760 400 790 Q 600 820 800 770 L 800 1000 L 0 1000 Z" fill="url(#kha-dune)" />
        <path d="M0 870 Q 250 840 500 870 Q 700 890 800 860 L 800 1000 L 0 1000 Z" fill="#0a0907" opacity=".7" />

        {Array.from({ length: 30 }).map((_, i) => {
          const x = (i * 67) % 780 + 10;
          const y = (i * 31) % 320 + 20;
          return <circle key={i} cx={x} cy={y} r=".8" fill="#f3dc92" opacity={(i % 3 + 1) * 0.2} />;
        })}
      </svg>
    </div>
  );
}

function StageMoroccan() {
  const ref = useRef<HTMLDivElement>(null);
  useMouseParallax(ref);
  return (
    <div
      className="act-stage"
      ref={ref}
      style={{ transform: "translate3d(calc(var(--mx,0)*-12px), calc(var(--my,0)*-8px),0)" }}
    >
      <div className="stage-bg" />
      <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="mor-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1a2540" />
            <stop offset=".4" stopColor="#0c1220" />
            <stop offset="1" stopColor="#0c0a08" />
          </linearGradient>
          <pattern id="mor-zellige" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <rect width="40" height="40" fill="#0a0907" />
            <path d="M20 4 L36 20 L20 36 L4 20 Z" fill="#1e508f" fillOpacity=".5" />
            <path d="M20 12 L28 20 L20 28 L12 20 Z" fill="#d99a1f" fillOpacity=".3" />
            <circle cx="20" cy="20" r="2" fill="#d4af37" />
            <circle cx="2" cy="2" r="1" fill="#d4af37" fillOpacity=".5" />
          </pattern>
          <pattern id="mor-tile" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <rect width="60" height="60" fill="#1e508f" fillOpacity=".15" />
            <g transform="translate(30,30)">
              <path d="M0 -22 L6 -8 L22 0 L6 8 L0 22 L-6 8 L-22 0 L-6 -8 Z"
                fill="none" stroke="#d4af37" strokeWidth=".5" strokeOpacity=".7" />
              <circle r="3" fill="#a83232" fillOpacity=".5" />
            </g>
          </pattern>
        </defs>
        <rect width="800" height="1000" fill="url(#mor-sky)" />

        <g transform="translate(400,140)" opacity=".85">
          <line x1="0" y1="-100" x2="0" y2="0" stroke="#d4af37" strokeOpacity=".5" strokeWidth=".5" />
          <g transform="translate(0,30)">
            <path d="M 0 -34 L 10 -10 L 34 0 L 10 10 L 0 34 L -10 10 L -34 0 L -10 -10 Z"
              fill="#0a0907" stroke="#f3dc92" strokeWidth=".7" />
            <circle r="6" fill="#f3dc92" />
            <circle r="55" fill="none" stroke="#f3dc92" strokeOpacity=".15" />
            <circle r="90" fill="none" stroke="#f3dc92" strokeOpacity=".07" />
          </g>
        </g>

        <g transform="translate(200,300)">
          <rect x="-200" y="0" width="800" height="500" fill="url(#mor-tile)" opacity=".4" />
          <g transform="translate(200, 100)">
            <path d="
              M -120 380
              L -120 200
              C -120 180, -110 160, -90 160
              C -75 160, -65 175, -60 180
              C -50 160, -30 140, -15 140
              C -5 145, 0 160, 0 160
              C 0 160, 5 145, 15 140
              C 30 140, 50 160, 60 180
              C 65 175, 75 160, 90 160
              C 110 160, 120 180, 120 200
              L 120 380 Z" fill="#0a0907" stroke="#d4af37" strokeWidth=".9" />
            <path d="
              M -110 380
              L -110 205
              C -110 188, -103 172, -88 172
              C -75 172, -68 184, -64 188
              C -54 168, -34 150, -19 150
              C -9 154, -4 168, 0 170
              C 4 168, 9 154, 19 150
              C 34 150, 54 168, 64 188
              C 68 184, 75 172, 88 172
              C 103 172, 110 188, 110 205
              L 110 380 Z" fill="none" stroke="#d99a1f" strokeOpacity=".5" strokeWidth=".5" />
          </g>

          {[-150, 540].map((x, i) => (
            <g key={i} transform={`translate(${x}, 200)`}>
              <rect x="0" y="0" width="80" height="160" fill="url(#mor-zellige)" />
              <rect x="0" y="0" width="80" height="160" fill="none" stroke="#d4af37" strokeOpacity=".5" strokeWidth=".6" />
            </g>
          ))}

          <g transform="translate(0,80)" opacity=".5">
            {Array.from({ length: 18 }).map((_, i) => (
              <g key={i} transform={`translate(${i * 30 - 200},0)`}>
                <path d="M0 0 L8 -10 L16 0 L8 10 Z" fill="none" stroke="#d4af37" strokeWidth=".4" />
              </g>
            ))}
          </g>
        </g>

        <g transform="translate(400, 820)">
          <ellipse cx="0" cy="0" rx="160" ry="40" fill="#0a0907" />
          <ellipse cx="0" cy="-4" rx="160" ry="40" fill="none" stroke="#d4af37" strokeWidth=".7" />
          <ellipse cx="0" cy="0" rx="120" ry="28" fill="#1e508f" opacity=".25" />
          <ellipse cx="0" cy="-2" rx="120" ry="28" fill="none" stroke="#d4af37" strokeOpacity=".7" strokeWidth=".5" />
          <ellipse cx="0" cy="-1" rx="100" ry="22" fill="#1e508f" opacity=".4" />
          <line x1="0" y1="-2" x2="0" y2="-50" stroke="#d4af37" strokeWidth="1.4" />
          <circle cx="0" cy="-52" r="6" fill="#d4af37" />
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i / 16) * Math.PI;
            const x = Math.cos(a) * 150;
            return <rect key={i} x={x - 6} y="20" width="12" height="20"
              fill={i % 2 ? "#1e508f" : "#a83232"} fillOpacity=".4" />;
          })}
        </g>
      </svg>
    </div>
  );
}

export function ActsOverture() {
  return (
    <section className="acts-overture" data-act="Act II · The Three Houses">
      <div className="reveal eyebrow">Act II · Three Houses, One Threshold</div>
      <h2 className="reveal">
        Every <em>region</em> remembers a <em>different</em> sun.
      </h2>
      <p className="reveal d2" style={{ margin: "30px auto" }}>
        Lebanese mountain stone. Khaleeji desert dusk. Moroccan riad and fountain.
        Three vocabularies of arch, light, and material — three ways a room can hold a name.
      </p>
    </section>
  );
}

export function ActLebanese() {
  return (
    <section className="act act-lebanese" data-act="Act II · Lebanon" data-screen-label="03 Lebanon">
      <StageLebanese />
      <div className="act-text">
        <div className="reveal eyebrow">House One · Mount Lebanon</div>
        <h3 className="reveal culture-name"><em>Lebanese</em></h3>
        <div className="reveal d2 culture-arabic">لبناني</div>
        <div className="reveal d2 pull">
          A villa breathes between cedar and sea — <em>triple arches</em> open onto the
          mountain, wrought iron lattices the breeze, and the pomegranate tree stands
          witness on the terrace.
        </div>
        <ul className="reveal d3">
          <li><b>Stone</b> Sandstone, limestone, polished walnut</li>
          <li><b>Pattern</b> Triple arch, fanlight, geometric floor tile</li>
          <li><b>Color</b> Pomegranate red, terracotta, oxide green</li>
          <li><b>Light</b> Filtered through fanlight glass; oil-lamp gold</li>
        </ul>
      </div>
    </section>
  );
}

export function ActKhaleeji() {
  return (
    <section className="act act-khaleeji flip" data-act="Act III · Khaleej" data-screen-label="04 Khaleej">
      <div className="act-text">
        <div className="reveal eyebrow">House Two · The Gulf</div>
        <h3 className="reveal culture-name"><em>Khaleeji</em></h3>
        <div className="reveal d2 culture-arabic">خليجي</div>
        <div className="reveal d2 pull">
          A majlis at the edge of the dune — <em>wind catchers</em> draw the cool above,
          mashrabiya softens the noon, and the room remembers pearl divers and
          long evening conversation.
        </div>
        <ul className="reveal d3">
          <li><b>Stone</b> Coral, gypsum plaster, palm wood</li>
          <li><b>Pattern</b> Pointed arch, mashrabiya screen, crenellation</li>
          <li><b>Color</b> Saffron, ivory, charcoal kohl</li>
          <li><b>Light</b> Pierced screens; pearl-shell luminance</li>
        </ul>
      </div>
      <StageKhaleeji />
    </section>
  );
}

export function ActMoroccan() {
  return (
    <section className="act act-moroccan" data-act="Act IV · Morocco" data-screen-label="05 Morocco">
      <StageMoroccan />
      <div className="act-text">
        <div className="reveal eyebrow">House Three · The Riad</div>
        <h3 className="reveal culture-name"><em>Moroccan</em></h3>
        <div className="reveal d2 culture-arabic">مغربي</div>
        <div className="reveal d2 pull">
          A courtyard turns the sky inward — <em>zellige</em> mosaics climb the walls,
          a fountain answers the call to prayer, and every room is lined with the
          slow geometry of Fez.
        </div>
        <ul className="reveal d3">
          <li><b>Stone</b> Tadelakt plaster, cedar, brass</li>
          <li><b>Pattern</b> Multifoil arch, zellige eight-point, muqarnas</li>
          <li><b>Color</b> Indigo cobalt, saffron, oxblood</li>
          <li><b>Light</b> Lantern stars; courtyard skylight</li>
        </ul>
      </div>
    </section>
  );
}
