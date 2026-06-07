"use client";

/* ============================================================
   Houses — Act II — sticky horizontal-scroll across 3 panels
   ONE shared 3D ornament floats over the panels and morphs
   color/material per active culture as the user scrolls.
   ============================================================ */

import { Fragment, useRef } from "react";
import OrnamentCanvas from "@/components/cinema/OrnamentCanvas";
import DustLayer from "@/components/cinema/DustLayer";
import { useCinemaCopy } from "@/components/cinema/copy";
import type { HousePanelCopy } from "@/components/cinema/copy";
import { useSectionScroll } from "@/components/cinema/hooks";
import type { OrnamentVariant } from "@/lib/three/types";

// ---------- LEBANESE TRIPLE ARCH ----------
function LebaneseArch() {
  return (
    <svg viewBox="0 0 400 540" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="lb-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8bf95" />
          <stop offset="1" stopColor="#9c7e54" />
        </linearGradient>
        <linearGradient id="lb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f5a4a" />
          <stop offset="1" stopColor="#16352c" />
        </linearGradient>
        <pattern id="lb-stones" x="0" y="0" width="40" height="22" patternUnits="userSpaceOnUse">
          <rect width="40" height="22" fill="url(#lb-stone)" />
          <path d="M0 22 H40 M20 0 V22" stroke="rgba(0,0,0,0.18)" strokeWidth="0.6" />
          <path d="M0 0 H40" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        </pattern>
      </defs>
      {/* sky inside arches */}
      <rect x="0" y="0" width="400" height="540" fill="url(#lb-sky)" />
      {/* stone wall */}
      <rect x="0" y="0" width="400" height="540" fill="url(#lb-stones)" />
      {/* cut the three arches out — use a mask */}
      <mask id="lb-mask">
        <rect width="400" height="540" fill="white" />
        <g fill="black">
          {/* three arches */}
          <path d="M60 540 V300 Q60 200 110 200 Q160 200 160 300 V540 Z" />
          <path d="M170 540 V300 Q170 200 200 200 Q230 200 230 300 V540 Z" />
          <path d="M240 540 V300 Q240 200 290 200 Q340 200 340 300 V540 Z" />
        </g>
      </mask>
      <rect x="0" y="0" width="400" height="540" fill="url(#lb-stones)" mask="url(#lb-mask)" />
      {/* through the arches: distant cedar mountains */}
      <g opacity="0.85">
        <path d="M60 540 V300 Q60 200 110 200 Q160 200 160 300 V540 Z" fill="url(#lb-sky)" />
        <path d="M170 540 V300 Q170 200 200 200 Q230 200 230 300 V540 Z" fill="url(#lb-sky)" />
        <path d="M240 540 V300 Q240 200 290 200 Q340 200 340 300 V540 Z" fill="url(#lb-sky)" />
        {/* cedar silhouettes */}
        <g fill="#1d2e25">
          <path d="M70 540 L85 380 L95 540 Z" />
          <path d="M120 540 L132 360 L144 540 Z" />
          <path d="M180 540 L195 400 L210 540 Z" />
          <path d="M250 540 L265 380 L280 540 Z" />
          <path d="M295 540 L310 410 L320 540 Z" />
        </g>
        {/* sun glint */}
        <circle cx="195" cy="290" r="22" fill="#f0d78c" opacity="0.7" />
        <circle cx="195" cy="290" r="44" fill="#f0d78c" opacity="0.18" />
      </g>
      {/* shutter panels */}
      <g fill="#2f5a4a" opacity="0.85">
        <rect x="62" y="430" width="46" height="110" />
        <rect x="114" y="430" width="46" height="110" />
        <rect x="174" y="430" width="22" height="110" />
        <rect x="206" y="430" width="22" height="110" />
        <rect x="246" y="430" width="46" height="110" />
        <rect x="290" y="430" width="50" height="110" />
        <g stroke="rgba(0,0,0,0.4)" strokeWidth="0.6">
          {[440, 460, 480, 500, 520].map((y) => (
            <line key={y} x1="62" y1={y} x2="160" y2={y} />
          ))}
          {[440, 460, 480, 500, 520].map((y) => (
            <line key={"b" + y} x1="246" y1={y} x2="340" y2={y} />
          ))}
        </g>
      </g>
      {/* keystone detail */}
      <g fill="#d4af37">
        <circle cx="110" cy="200" r="3" />
        <circle cx="200" cy="200" r="3" />
        <circle cx="290" cy="200" r="3" />
      </g>
    </svg>
  );
}

// ---------- KHALEEJI MAJLIS — mashrabiya screen + brass lantern ----------
function KhaleejiMajlis() {
  return (
    <svg viewBox="0 0 400 540" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="kh-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2a44" />
          <stop offset="0.5" stopColor="#0d1429" />
          <stop offset="1" stopColor="#080c1c" />
        </linearGradient>
        <radialGradient id="kh-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe7a8" />
          <stop offset="0.4" stopColor="#d4af37" />
          <stop offset="1" stopColor="#5e4d1f" />
        </radialGradient>
        <pattern id="kh-mash" width="40" height="46" patternUnits="userSpaceOnUse">
          {/* eight-pointed star lattice */}
          <g fill="none" stroke="#d4af37" strokeWidth="1.1">
            <path d="M20 0 L26 14 L40 14 L30 24 L34 38 L20 30 L6 38 L10 24 L0 14 L14 14 Z" opacity="0.6" />
          </g>
        </pattern>
      </defs>
      <rect x="0" y="0" width="400" height="540" fill="url(#kh-bg)" />
      {/* mashrabiya wall */}
      <rect x="0" y="0" width="400" height="540" fill="url(#kh-mash)" opacity="0.85" />
      {/* arched alcove */}
      <path d="M100 540 V280 Q100 130 200 130 Q300 130 300 280 V540 Z" fill="#0d1429" />
      <path d="M100 540 V280 Q100 130 200 130 Q300 130 300 280 V540 Z" fill="none" stroke="#d4af37" strokeWidth="1.5" />
      {/* keystone medallion */}
      <g transform="translate(200 175)">
        <circle r="22" fill="none" stroke="#d4af37" strokeWidth="1" />
        <g stroke="#d4af37" strokeWidth="0.8" fill="none">
          {[0, 45, 90, 135].map((a) => (
            <line key={a} transform={`rotate(${a})`} x1="-22" y1="0" x2="22" y2="0" />
          ))}
        </g>
        <circle r="6" fill="#d4af37" />
      </g>
      {/* hanging lantern */}
      <g transform="translate(200 240)">
        <line x1="0" y1="-60" x2="0" y2="0" stroke="#d4af37" strokeWidth="1" />
        <ellipse cx="0" cy="40" rx="38" ry="44" fill="url(#kh-lamp)" opacity="0.95" />
        <ellipse cx="0" cy="40" rx="38" ry="44" fill="none" stroke="#d4af37" strokeWidth="1.2" />
        <g stroke="#1f1a10" strokeWidth="1">
          <path d="M-38 40 Q0 30 38 40" />
          <path d="M-30 12 Q0 8 30 12" />
          <path d="M-30 70 Q0 76 30 70" />
        </g>
        <ellipse cx="0" cy="40" rx="68" ry="80" fill="#ffe7a8" opacity="0.18" />
      </g>
      {/* majlis cushions */}
      <g>
        <rect x="60" y="440" width="280" height="20" fill="#6e1f2c" />
        <rect x="60" y="460" width="280" height="80" fill="#0b5f4a" />
        {/* cushion segments */}
        <g fill="#6e1f2c" stroke="#d4af37" strokeWidth="0.8">
          <rect x="64" y="430" width="50" height="34" rx="4" />
          <rect x="120" y="430" width="50" height="34" rx="4" />
          <rect x="176" y="430" width="50" height="34" rx="4" />
          <rect x="232" y="430" width="50" height="34" rx="4" />
          <rect x="288" y="430" width="48" height="34" rx="4" />
        </g>
      </g>
      {/* floor — geometric */}
      <g opacity="0.55">
        <line x1="0" y1="540" x2="400" y2="540" stroke="#d4af37" strokeWidth="0.4" />
        <line x1="60" y1="540" x2="340" y2="490" stroke="#d4af37" strokeWidth="0.3" />
      </g>
    </svg>
  );
}

// ---------- MOROCCAN RIAD — zellige + carved plaster ----------
function MoroccanRiad() {
  return (
    <svg viewBox="0 0 400 540" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="mr-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8dcc0" />
          <stop offset="1" stopColor="#cab985" />
        </linearGradient>
        <pattern id="mr-zellige" width="48" height="48" patternUnits="userSpaceOnUse">
          <rect width="48" height="48" fill="#ede4d2" />
          {/* 8-point star zellige */}
          <g stroke="#1f4287" strokeWidth="0.6" fill="none">
            <path d="M24 4 L29 19 L44 19 L32 28 L37 43 L24 34 L11 43 L16 28 L4 19 L19 19 Z" fill="#1f4287" />
          </g>
          <g fill="#c44a36">
            <path d="M0 24 L4 19 L4 29 Z" />
            <path d="M48 24 L44 19 L44 29 Z" />
            <path d="M24 0 L19 4 L29 4 Z" />
            <path d="M24 48 L19 44 L29 44 Z" />
          </g>
          <g fill="#d4a24a">
            <circle cx="24" cy="24" r="2" />
          </g>
        </pattern>
        <pattern id="mr-plaster" width="80" height="80" patternUnits="userSpaceOnUse">
          <rect width="80" height="80" fill="#ede4d2" />
          <g stroke="#cab985" strokeWidth="0.4" fill="none">
            <path d="M0 40 Q20 20 40 40 Q60 60 80 40" />
            <path d="M0 60 Q20 40 40 60 Q60 80 80 60" />
            <path d="M40 0 Q20 20 40 40 Q60 60 40 80" />
            <circle cx="40" cy="40" r="14" />
            <circle cx="40" cy="40" r="6" />
          </g>
        </pattern>
      </defs>
      <rect x="0" y="0" width="400" height="540" fill="url(#mr-bg)" />
      {/* upper carved plaster wall */}
      <rect x="0" y="0" width="400" height="240" fill="url(#mr-plaster)" />
      {/* zellige dado lower wall */}
      <rect x="0" y="240" width="400" height="300" fill="url(#mr-zellige)" />
      {/* keyhole arch doorway */}
      <path d="M140 540 V340 Q140 240 200 240 Q260 240 260 340 V540 Z" fill="#1f4287" />
      <path d="M140 540 V340 Q140 240 200 240 Q260 240 260 340 V540 Z" fill="none" stroke="#d4af37" strokeWidth="1.5" />
      {/* through the door: lush courtyard */}
      <g clipPath="url(#mr-clip)">
        <defs>
          <clipPath id="mr-clip">
            <path d="M140 540 V340 Q140 240 200 240 Q260 240 260 340 V540 Z" />
          </clipPath>
        </defs>
        {/* courtyard sky */}
        <rect x="140" y="240" width="120" height="300" fill="#0d1429" />
        {/* fountain */}
        <ellipse cx="200" cy="480" rx="38" ry="10" fill="#1a6e5c" />
        <ellipse cx="200" cy="478" rx="32" ry="8" fill="#246e5c" />
        <ellipse cx="200" cy="476" rx="26" ry="6" fill="#3a8674" />
        <path d="M200 460 V440" stroke="#cab985" strokeWidth="1" />
        {/* palm */}
        <path d="M178 460 V400" stroke="#3a2511" strokeWidth="2" />
        <g fill="#1a6e5c">
          <path d="M178 400 Q166 380 152 384 Q168 388 178 400 Z" />
          <path d="M178 400 Q190 378 206 380 Q190 388 178 400 Z" />
          <path d="M178 400 Q170 374 162 364 Q174 380 178 400 Z" />
        </g>
        {/* moon */}
        <circle cx="226" cy="294" r="10" fill="#ede4d2" />
      </g>
      {/* arch ornament around the keyhole */}
      <g fill="none" stroke="#d4af37" strokeWidth="1">
        <path d="M140 320 L122 320" />
        <path d="M260 320 L278 320" />
        <path d="M200 240 L200 222" />
        <circle cx="200" cy="246" r="6" fill="#d4af37" />
      </g>
      {/* small zellige border at top */}
      <g>
        <rect x="0" y="234" width="400" height="6" fill="#1f4287" />
        <rect x="0" y="240" width="400" height="2" fill="#d4af37" />
      </g>
    </svg>
  );
}

interface HousePanelProps {
  panel: HousePanelCopy;
}

function HousePanel({ panel }: HousePanelProps) {
  const Art =
    panel.id === "lebanese"
      ? LebaneseArch
      : panel.id === "khaleeji"
      ? KhaleejiMajlis
      : MoroccanRiad;
  const titleParts = panel.title.map((w, i) => (
    <Fragment key={i}>
      <span className={i === panel.italicIdx ? "italic" : ""}>{w}</span>
      {i < panel.title.length - 1 ? " " : ""}
    </Fragment>
  ));

  return (
    <div className={"panel " + panel.id}>
      <div className="text">
        <div className="eyebrow">
          <span className="num">{panel.num}</span>
          <span>·</span>
          <span
            style={{
              fontFamily: "var(--f-display-ar)",
              fontSize: "1.1rem",
              color: "var(--brass-bright)",
            }}
          >
            {panel.chip}
          </span>
          <span className="muted">{panel.chipMeaning}</span>
        </div>
        <h2>{titleParts}</h2>
        <p className="lede">{panel.lede}</p>
        <div className="tags">
          {panel.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        <div className="swatch-row">
          {panel.palette.map((c, i) => (
            <span key={i} className="swatch" style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="stage-art">
        <Art />
        <DustLayer count={14} seed={panel.id.length * 7} />
      </div>
    </div>
  );
}

export default function Houses() {
  const wrapRef = useRef<HTMLElement>(null);
  const copy = useCinemaCopy().houses;

  // 0..1 progress through the sticky/pinned section.
  const p = useSectionScroll(wrapRef);
  // active panel index = clamp(floor(p*3 + 0.05), 0, 2)
  const active = Math.min(2, Math.floor(p * 3 + 0.05));
  const activePanelId: OrnamentVariant = copy.panels[active].id;

  // act-label eyebrow with the "Act II — " / "الفصل … — " prefix stripped
  const actLabel = copy.eyebrow
    .replace(/^Act\s+\w+\s*—\s*/, "")
    .replace(/^الفصل[^—]*—\s*/, "");

  return (
    <section className="houses" ref={wrapRef}>
      <div className="act-label">
        <span className="num">II</span>
        <span>{actLabel}</span>
      </div>
      <div className="pin">
        <div className="stage" style={{ transform: `translateX(${-p * 200}vw)` }}>
          {copy.panels.map((panel) => (
            <HousePanel key={panel.id} panel={panel} />
          ))}
        </div>
        <div className="ornament-anchor">
          <OrnamentCanvas variant={activePanelId} starSize={0.95} />
        </div>
        <div className="rail">
          {copy.panels.map((panel, i) => (
            <Fragment key={panel.id}>
              <span className={"dot " + (active === i ? "on" : "")} />
            </Fragment>
          ))}
          <span style={{ marginInlineStart: 12 }}>
            {(active + 1).toString().padStart(2, "0")} / 03
          </span>
        </div>
      </div>
    </section>
  );
}
