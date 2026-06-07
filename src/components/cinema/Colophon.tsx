"use client";

/* ============================================================
   Colophon footer — about + built-with + cities + bottom row.
   Ported from dar-design-2 (jsx/landing-parts.jsx Colophon).
   ============================================================ */

import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { useCinemaCopy } from "@/components/cinema/copy";

export default function Colophon() {
  const copy = useCinemaCopy().colophon;
  const { isArabic } = useThemeLanguage();

  return (
    <footer className="colophon">
      <div className="row">
        <div>
          <div className="mark">{isArabic ? "دار · ديزاين" : "Dar · Design"}</div>
          <p>{copy.about}</p>
        </div>
        <div>
          <h3>{copy.builtTitle}</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, color: "var(--fg-soft)" }}>
            {copy.built.map((b) => (
              <li key={b} style={{ marginBottom: 4, fontSize: "0.88rem" }}>{b}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>{copy.placesTitle}</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, color: "var(--fg-soft)" }}>
            {copy.places.map((p) => (
              <li key={p} style={{ marginBottom: 4, fontSize: "0.88rem" }}>{p}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="bot">
        <span>{copy.rights}</span>
        <span>{copy.version}</span>
      </div>
    </footer>
  );
}
