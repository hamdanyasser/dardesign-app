"use client";

/** Tiny fixed-position cluster, top-right of the Atelier, that exposes the
 *  bilingual EN/AR + dark/light toggles without breaking the cinematic flow.
 *
 *  The Atelier is dark-by-design — the theme toggle still flips the global
 *  `data-theme` attribute (so /transform and /result pick it up), but the
 *  Atelier's own palette is hard-set in atelier.css. */

import { Moon, Sun } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";

export default function FloatingControls() {
  const { language, theme, toggleLanguage, toggleTheme } = useThemeLanguage();
  const isArabic = language === "ar";

  return (
    <div
      className="atelier-controls"
      role="toolbar"
      aria-label={isArabic ? "إعدادات اللغة والمظهر" : "Language and theme controls"}
    >
      <button
        type="button"
        onClick={toggleLanguage}
        aria-label={isArabic ? "التبديل إلى الإنجليزية" : "Switch to Arabic"}
        title={isArabic ? "English" : "عربي"}
      >
        {isArabic ? "EN" : "عربي"}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={
          theme === "dark"
            ? isArabic ? "تبديل إلى الفاتح" : "Switch to light theme"
            : isArabic ? "تبديل إلى الداكن" : "Switch to dark theme"
        }
        title={theme === "dark" ? "Light" : "Dark"}
      >
        {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  );
}
