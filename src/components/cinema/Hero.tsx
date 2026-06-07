"use client";

/* ============================================================
   Hero — full-bleed Three.js qanater arch + dolly + parallax
   Headline crashes in word-by-word.
   ============================================================ */

import { Fragment } from "react";
import ArchCanvas from "@/components/cinema/ArchCanvas";
import DustLayer from "@/components/cinema/DustLayer";
import { useCinemaCopy } from "@/components/cinema/copy";
import { useHeroProgress } from "@/components/cinema/hooks";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";

interface HeroProps {
  onBegin: () => void;
  onSee: () => void;
}

export default function Hero({ onBegin, onSee }: HeroProps) {
  const { isArabic } = useThemeLanguage();
  const copy = useCinemaCopy().hero;
  const isAr = isArabic;
  const progress = useHeroProgress();

  // word-by-word title
  const renderTitle = () => {
    const words = copy.titleWords;
    return words.map((w, i) => (
      <Fragment key={i}>
        <span className={"word " + (i === copy.titleItalic ? "italic" : "")}>{w}</span>
        {i < words.length - 1 ? " " : ""}
      </Fragment>
    ));
  };

  return (
    <section className="hero">
      <div className="canvas">
        <ArchCanvas
          opts={{
            dustCount: 1400,
            cameraZStart: 7.2,
            cameraZEnd: 4.0,
            enableMashrabiya: true,
            ambient: 0.55,
            offsetX: isAr ? -2.4 : 2.4,
            angle: isAr ? 0.28 : -0.28,
            fogColor: 0x0a0a0f,
            fogNear: 3,
            fogFar: 14,
          }}
          progress={progress}
          resetKey={[isArabic]}
        />
      </div>
      <DustLayer count={28} seed={5} />
      <div className="copy">
        <div>
          <div className="eyebrow-line">
            <span>{copy.eyebrow[0]}</span>
            <span className="pip"></span>
            <span>{copy.eyebrow[1]}</span>
          </div>
          <h1 className={isAr ? "" : ""}>{renderTitle()}</h1>
          <p className="sub">{copy.sub}</p>
          <div className="ctas">
            <button className="btn" onClick={onBegin}>
              <span>{copy.primary}</span>
              <span className="arrow">→</span>
            </button>
            <button className="btn ghost" onClick={onSee}>
              <span>{copy.secondary}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="scroll-cue">
        <span>{copy.cue}</span>
        <span className="line"></span>
      </div>
    </section>
  );
}
