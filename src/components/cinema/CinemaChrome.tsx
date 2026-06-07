"use client";

/* ============================================================
   Chrome — top bar (mark + lang + theme + audio)
   Mounted once at the root, mix-blend-difference so it adapts.
   Ported from the dar-design-2 bundle (jsx/chrome.jsx).
   ============================================================ */

import { useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { useCinemaCopy } from "@/components/cinema/copy";
import { DarAudio } from "@/lib/audio";

interface CinemaChromeProps {
  onNavHome?: () => void;
}

export default function CinemaChrome({ onNavHome }: CinemaChromeProps) {
  const { isArabic, theme, toggleLanguage, toggleTheme } = useThemeLanguage();
  const [audioOn, setAudioOn] = useState<boolean>(false);

  const t = useCinemaCopy().chrome;
  const isAr = isArabic;

  return (
    <header className="chrome">
      <button className="mark" onClick={onNavHome} aria-label="Home" style={{ background: "transparent" }}>
        {isAr ? (
          <span>
            دار<span className="dot"></span>ديزاين
          </span>
        ) : (
          <span>
            Dar<span className="dot"></span>Design
          </span>
        )}
      </button>
      <div className="group">
        <button
          className="toggle"
          onClick={() => {
            const on = DarAudio.toggle();
            setAudioOn(on);
          }}
          title={t.audioOn}
        >
          <span className="audio-pulse">
            {audioOn ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 10v4M7 6v12M11 3v18M15 6v12M19 10v4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 12h4M9 12h2M14 12h2M19 12h2" strokeLinecap="round" />
              </svg>
            )}
            {audioOn ? "♪" : "·"}
          </span>
        </button>
        <button
          className="toggle"
          onClick={() => toggleTheme()}
          title={theme === "dark" ? t.themeLight : t.themeDark}
        >
          {theme === "dark" ? "◐" : "◑"} {theme === "dark" ? t.themeLight : t.themeDark}
        </button>
        <button className="toggle" onClick={() => toggleLanguage()}>
          {t.langToggle}
        </button>
      </div>
    </header>
  );
}
