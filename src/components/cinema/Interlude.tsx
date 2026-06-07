"use client";

/* ============================================================
   Calligraphic Interlude — an Arabic phrase that "writes itself"
   on scroll. Sits between major sections as poetic punctuation.
   Ported from dar-design-2 (jsx/interlude.jsx).
   ============================================================ */

import { useRef } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { useInView } from "@/components/cinema/hooks";
import DustLayer from "@/components/cinema/DustLayer";

interface InterludeProps {
  phrase: string;
  translation: string;
  attribution: string;
  seed?: number;
}

export default function Interlude({
  phrase,
  translation,
  attribution,
  seed = 7,
}: InterludeProps) {
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, 0.3);

  // The Arabic phrase always self-writes RIGHT→LEFT (the CSS forces
  // direction: rtl even on the English page so the calligraphy renders
  // correctly). Read isArabic from the reactive theme/language context.
  const { isArabic } = useThemeLanguage();

  return (
    <section className="interlude" ref={ref} dir={isArabic ? "rtl" : undefined}>
      <DustLayer count={16} seed={seed} />
      <div className="ink-line top" />
      <div className="content">
        {/* Arabic phrase — draws via clip-path reveal RIGHT→LEFT */}
        <div className={"arabic-write " + (visible ? "in" : "")}>
          <span className="cursor" />
          <span className="text">{phrase}</span>
        </div>
        <div className={"translation " + (visible ? "in" : "")}>
          {translation}
        </div>
        {attribution && (
          <div className={"attribution " + (visible ? "in" : "")}>
            <span className="line" />
            {attribution}
          </div>
        )}
      </div>
      <div className="ink-line bot" />
    </section>
  );
}
