"use client";

/** Calligraphy, dust motes, typographic interludes, and the cinematic Morpher.
 *  Ported from atelier-extras.jsx. */

import { useEffect, useRef, useState } from "react";
import type { CssVars } from "./effects";

export function CalligraphyDar() {
  return (
    <svg className="dar-calligraphy" viewBox="0 0 600 280" aria-hidden="true">
      <defs>
        <linearGradient id="ink" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#f3dc92" />
          <stop offset="1" stopColor="#d4af37" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path className="calli-stroke s1"
          d="M 110 130 Q 130 95 175 95 Q 215 95 215 145 Q 215 200 165 220 Q 130 230 105 215" />
        <path className="calli-stroke s2" d="M 295 70 L 305 200" />
        <path className="calli-stroke s3"
          d="M 380 100 Q 410 90 460 95 Q 500 100 500 140 Q 500 180 460 195 Q 420 205 395 195" />
        <circle className="calli-dot" cx="445" cy="60" r="4" fill="#f3dc92" stroke="none" />
      </g>
      <g stroke="#d4af37" strokeOpacity=".4" strokeWidth=".6" fill="none" className="calli-flourish">
        <path d="M 60 250 Q 300 270 540 250" />
        <path d="M 80 260 Q 300 278 520 260" />
      </g>
    </svg>
  );
}

interface DustMotesProps {
  count?: number;
}

export function DustMotes({ count = 28 }: DustMotesProps) {
  const motes = Array.from({ length: count }).map((_, i) => ({
    left: (i * 37) % 100,
    top: 20 + ((i * 19) % 60),
    delay: (i * 0.4) % 8,
    duration: 12 + (i % 7) * 2,
    size: 1 + (i % 3) * 0.6,
    opacity: 0.15 + (i % 5) * 0.12,
  }));
  return (
    <div className="motes" aria-hidden="true">
      {motes.map((m, i) => (
        <span
          key={i}
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            opacity: m.opacity,
            animationDelay: `${m.delay}s`,
            animationDuration: `${m.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

interface InterludeProps {
  kicker: string;
  /** HTML allowed (renders <em> tags); kept identical to the original prototype */
  line: string;
  arabic?: string;
  theme?: string;
  anchor?: string;
}

export function Interlude({ kicker, line, arabic, theme = "dark", anchor }: InterludeProps) {
  return (
    <section className={`interlude interlude-${theme}`} data-act={anchor || "Interlude"}>
      <div className="interlude-rule reveal" />
      <div className="reveal eyebrow" style={{ justifyContent: "center" }}>{kicker}</div>
      <h2 className="reveal d2 interlude-line" dangerouslySetInnerHTML={{ __html: line }} />
      {arabic && <div className="reveal d3 interlude-arabic">{arabic}</div>}
      <div className="interlude-rule reveal d4" />
    </section>
  );
}

/* ====================================================================
   THE MORPHER — one room, three cultural treatments, drag-to-cross-fade
   ==================================================================== */

type CultureKey = "lebanese" | "khaleeji" | "moroccan";

interface CultureRecord {
  name: string;
  arabic: string;
  accent: string;
  accent2: string;
  sub: string;
  note: string;
}

const CULTURE_DATA: Record<CultureKey, CultureRecord> = {
  lebanese: {
    name: "Lebanese",
    arabic: "لبناني",
    accent: "#a83232",
    accent2: "#d99a1f",
    sub: "Mountain villa · Triple arch · Pomegranate",
    note: "Sandstone breathes. The triple arch opens to cedar; wrought iron softens the noon.",
  },
  khaleeji: {
    name: "Khaleeji",
    arabic: "خليجي",
    accent: "#d99a1f",
    accent2: "#f3dc92",
    sub: "Desert majlis · Pointed arch · Pearl",
    note: "Wind catchers cool the air. Mashrabiya screens the sun. The room remembers pearl.",
  },
  moroccan: {
    name: "Moroccan",
    arabic: "مغربي",
    accent: "#1e508f",
    accent2: "#d99a1f",
    sub: "Riad courtyard · Multifoil arch · Zellige",
    note: "Indigo and saffron. Tadelakt walls. A fountain answers a courtyard sky.",
  },
};

interface MorpherRoomProps {
  culture: CultureKey;
}

function MorpherRoom({ culture }: MorpherRoomProps) {
  const c = CULTURE_DATA[culture];
  let archD: string;
  if (culture === "lebanese") {
    archD = "M 140 360 L 140 180 Q 140 60 220 60 Q 300 60 300 180 L 300 360 Z";
  } else if (culture === "khaleeji") {
    archD = "M 140 360 L 140 160 Q 140 60 200 30 Q 300 60 300 160 L 300 360 Z";
  } else {
    archD =
      "M 140 360 L 140 180 C 140 150, 152 130, 174 130 C 188 130, 198 144, 202 152 C 212 130, 230 110, 244 110 C 254 114, 260 128, 260 130 C 270 110, 280 110, 290 112 C 308 114, 300 150, 300 180 L 300 360 Z";
  }

  return (
    <svg className="morpher-svg" viewBox="0 0 880 480" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`m-wall-${culture}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c.accent} stopOpacity=".18" />
          <stop offset="1" stopColor="#0c0a08" />
        </linearGradient>
        <linearGradient id={`m-floor-${culture}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c.accent} stopOpacity=".15" />
          <stop offset="1" stopColor="#0c0a08" />
        </linearGradient>
        <pattern id={`m-pat-${culture}`} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          {culture === "lebanese" && (
            <>
              <rect width="40" height="40" fill="#1a0e0c" />
              <path d="M0 20 L20 0 L40 20 L20 40 Z" fill="none" stroke={c.accent} strokeOpacity=".5" strokeWidth=".5" />
              <circle cx="20" cy="20" r="2" fill={c.accent2} />
            </>
          )}
          {culture === "khaleeji" && (
            <>
              <rect width="40" height="40" fill="#1a1208" />
              <circle cx="20" cy="20" r="6" fill="none" stroke={c.accent} strokeOpacity=".7" strokeWidth=".5" />
              <circle cx="0" cy="0" r="3" fill={c.accent2} fillOpacity=".5" />
              <circle cx="40" cy="40" r="3" fill={c.accent2} fillOpacity=".5" />
            </>
          )}
          {culture === "moroccan" && (
            <>
              <rect width="40" height="40" fill="#0a1525" />
              <path d="M20 4 L36 20 L20 36 L4 20 Z" fill={c.accent} fillOpacity=".5" />
              <path d="M20 12 L28 20 L20 28 L12 20 Z" fill={c.accent2} fillOpacity=".4" />
              <circle cx="20" cy="20" r="1.5" fill="#f3dc92" />
            </>
          )}
        </pattern>
      </defs>

      <rect x="0" y="0" width="880" height="320" fill={`url(#m-wall-${culture})`} />
      <rect x="0" y="0" width="880" height="320" fill={`url(#m-pat-${culture})`} opacity=".35" />
      <rect x="0" y="320" width="880" height="160" fill={`url(#m-floor-${culture})`} />
      <rect x="0" y="320" width="880" height="160" fill={`url(#m-pat-${culture})`} opacity=".5" />
      <line x1="0" y1="320" x2="440" y2="220" stroke={c.accent} strokeOpacity=".25" strokeWidth=".6" />
      <line x1="880" y1="320" x2="440" y2="220" stroke={c.accent} strokeOpacity=".25" strokeWidth=".6" />

      <g transform="translate(220, 0)">
        <path d={archD} fill="#0a0907" stroke={c.accent2} strokeWidth="1.2" />
        <path d={archD} fill="none" stroke={c.accent} strokeOpacity=".6" strokeWidth=".5" transform="translate(0,2)" />
        <path d={archD} fill={c.accent} fillOpacity=".06" />
      </g>

      {[60, 660].map((x, i) => (
        <g key={i} transform={`translate(${x}, 100)`}>
          <rect x="0" y="0" width="120" height="200" fill="#0a0907" stroke={c.accent} strokeOpacity=".4" strokeWidth=".5" />
          {culture === "lebanese" && (
            <g stroke={c.accent} strokeWidth=".4" opacity=".7">
              <line x1="0" y1="100" x2="120" y2="100" />
              <line x1="60" y1="0" x2="60" y2="200" />
              <path d="M 0 100 Q 60 60, 120 100" fill="none" />
            </g>
          )}
          {culture === "khaleeji" && (
            <g opacity=".6">
              {Array.from({ length: 6 }).map((_, r) =>
                Array.from({ length: 3 }).map((_, c2) => (
                  <circle key={`${r}-${c2}`} cx={20 + c2 * 40} cy={20 + r * 30} r="6"
                    fill="none" stroke={c.accent} strokeWidth=".4" />
                )),
              )}
            </g>
          )}
          {culture === "moroccan" && (
            <g opacity=".6">
              {Array.from({ length: 5 }).map((_, r) =>
                Array.from({ length: 3 }).map((_, c2) => (
                  <g key={`${r}-${c2}`} transform={`translate(${20 + c2 * 40},${20 + r * 36})`}>
                    <path d="M0 -10 L10 0 L0 10 L-10 0 Z" fill="none" stroke={c.accent} strokeWidth=".4" />
                  </g>
                )),
              )}
            </g>
          )}
        </g>
      ))}

      <rect x="320" y="370" width="240" height="60" fill={c.accent} fillOpacity=".3" stroke={c.accent2} strokeWidth=".4" />
      <rect x="328" y="358" width="40" height="20" fill={c.accent2} fillOpacity=".7" />
      <rect x="376" y="358" width="40" height="20" fill={culture === "moroccan" ? "#a83232" : c.accent2} fillOpacity=".6" />
      <rect x="424" y="358" width="40" height="20" fill={c.accent} fillOpacity=".7" />
      <rect x="472" y="358" width="40" height="20" fill={c.accent2} fillOpacity=".7" />
      <rect x="520" y="358" width="32" height="20" fill={c.accent} fillOpacity=".7" />

      <g transform="translate(440, 110)">
        <line x1="0" y1="-50" x2="0" y2="0" stroke={c.accent2} strokeOpacity=".6" strokeWidth=".4" />
        {culture === "lebanese" && (
          <g>
            <ellipse cx="0" cy="14" rx="14" ry="20" fill="#0a0907" stroke={c.accent2} strokeWidth=".5" />
            <circle cx="0" cy="14" r="4" fill="#f3dc92" />
          </g>
        )}
        {culture === "khaleeji" && (
          <g>
            <path d="M -16 8 L 0 -8 L 16 8 L 12 28 L -12 28 Z" fill="#0a0907" stroke={c.accent2} strokeWidth=".5" />
            <circle cx="0" cy="12" r="4" fill="#f3dc92" />
          </g>
        )}
        {culture === "moroccan" && (
          <g>
            <path d="M 0 -16 L 12 -4 L 24 0 L 12 4 L 0 16 L -12 4 L -24 0 L -12 -4 Z"
              fill="#0a0907" stroke="#f3dc92" strokeWidth=".5" transform="translate(0,12)" />
            <circle cx="0" cy="12" r="3" fill="#f3dc92" />
          </g>
        )}
        <ellipse cx="0" cy="14" rx="40" ry="16" fill="#f3dc92" fillOpacity=".05" />
      </g>

      {culture === "lebanese" && (
        <g transform="translate(700, 380)" opacity=".9">
          <circle cx="0" cy="0" r="14" fill="#a83232" stroke={c.accent2} strokeWidth=".4" />
          <circle cx="20" cy="6" r="10" fill="#a83232" stroke={c.accent2} strokeWidth=".4" />
          <path d="M-2 -14 L0 -18 L2 -14 Z" fill="#3d2a1c" />
        </g>
      )}
      {culture === "khaleeji" && (
        <g transform="translate(700, 400)" opacity=".7">
          <ellipse cx="0" cy="0" rx="40" ry="6" fill="#0a0907" />
          <rect x="-2" y="-30" width="4" height="30" fill="#3d2a1c" />
          <ellipse cx="0" cy="-30" rx="10" ry="4" fill={c.accent2} fillOpacity=".5" />
        </g>
      )}
      {culture === "moroccan" && (
        <g transform="translate(700, 400)" opacity=".85">
          <ellipse cx="0" cy="0" rx="40" ry="10" fill="#0a0907" />
          <ellipse cx="0" cy="-3" rx="40" ry="10" fill="none" stroke={c.accent2} strokeWidth=".5" />
          <ellipse cx="0" cy="0" rx="28" ry="6" fill={c.accent} fillOpacity=".4" />
          <line x1="0" y1="-2" x2="0" y2="-22" stroke={c.accent2} strokeWidth=".8" />
          <circle cx="0" cy="-22" r="3" fill={c.accent2} />
        </g>
      )}
    </svg>
  );
}

export function Morpher() {
  const order: CultureKey[] = ["lebanese", "khaleeji", "moroccan"];
  const [t, setT] = useState(0);
  const [active, setActive] = useState<CultureKey>("lebanese");

  useEffect(() => {
    const idx = Math.round(t);
    setActive(order[Math.max(0, Math.min(2, idx))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    const tr = trackRef.current;
    if (!tr) return;
    const move = (clientX: number) => {
      const r = tr.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      setT(u * 2);
    };
    const xFrom = (e: MouseEvent | TouchEvent) => {
      if ("clientX" in e) return e.clientX;
      return e.touches[0]?.clientX ?? 0;
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      dragRef.current = true;
      move(xFrom(e));
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (dragRef.current) move(xFrom(e));
    };
    const onUp = () => {
      dragRef.current = false;
    };
    tr.addEventListener("mousedown", onDown as EventListener);
    tr.addEventListener("touchstart", onDown as EventListener, { passive: true });
    window.addEventListener("mousemove", onMove as EventListener);
    window.addEventListener("touchmove", onMove as EventListener, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      tr.removeEventListener("mousedown", onDown as EventListener);
      tr.removeEventListener("touchstart", onDown as EventListener);
      window.removeEventListener("mousemove", onMove as EventListener);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const c = CULTURE_DATA[active];

  return (
    <section className="morpher" data-act="Act II · The Morpher" data-screen-label="03 Morpher">
      <div className="morpher-head">
        <div className="reveal eyebrow">A single room · three traditions</div>
        <h2 className="reveal">
          Drag <em>the slider</em>. Watch a <em>room</em> remember a different sun.
        </h2>
      </div>

      <div className="morpher-stage reveal d2">
        <div className="morpher-frame">
          {order.map((k, i) => {
            const dist = Math.abs(i - t);
            const op = Math.max(0, 1 - dist);
            const sc = 0.96 + 0.04 * op;
            return (
              <div
                key={k}
                className="morpher-layer"
                style={{
                  opacity: op,
                  transform: `scale(${sc})`,
                  zIndex: Math.round(op * 100),
                }}
              >
                <MorpherRoom culture={k} />
              </div>
            );
          })}

          <div className="morpher-info" style={{ borderColor: c.accent }}>
            <div className="morpher-info-arabic" style={{ color: c.accent2 }}>{c.arabic}</div>
            <div className="morpher-info-name">{c.name}</div>
            <div className="morpher-info-sub">{c.sub}</div>
            <p>{c.note}</p>
          </div>

          <span className="morpher-tick tl" />
          <span className="morpher-tick tr" />
          <span className="morpher-tick bl" />
          <span className="morpher-tick br" />
        </div>

        <div className="morpher-track-wrap reveal d3">
          <div className="morpher-track" ref={trackRef}>
            <div
              className="morpher-track-fill"
              style={{ width: `${(t / 2) * 100}%`, background: c.accent2 }}
            />
            {[0, 1, 2].map((i) => {
              const stopStyle: CssVars = {
                left: `${(i / 2) * 100}%`,
                "--tint": CULTURE_DATA[order[i]].accent,
              };
              return (
                <button
                  key={i}
                  className={`morpher-stop ${active === order[i] ? "is-active" : ""}`}
                  style={stopStyle}
                  onClick={() => setT(i)}
                  aria-label={CULTURE_DATA[order[i]].name}
                  type="button"
                >
                  <span>{["I", "II", "III"][i]}</span>
                </button>
              );
            })}
            <div
              className="morpher-thumb"
              style={{ left: `${(t / 2) * 100}%`, borderColor: c.accent2 }}
            />
          </div>
          <div className="morpher-track-labels">
            {order.map((k) => (
              <span key={k} className={active === k ? "on" : ""}>
                {CULTURE_DATA[k].name} <i style={{ color: CULTURE_DATA[k].accent }}>·</i>{" "}
                {CULTURE_DATA[k].arabic}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
