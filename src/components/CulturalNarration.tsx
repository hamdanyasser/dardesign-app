"use client";

/**
 * CulturalNarration — Creative Feature #3 (Bilingual Cultural Narration).
 *
 * A "listen" button that reads a two-sentence cultural description of the chosen
 * tradition aloud, in Arabic or English, via the browser Web Speech API (free,
 * no backend, no GPU). It names the signature elements of each culture — the
 * same vocabulary the LoRA was trained on and the Highlighter explains — so the
 * project genuinely *speaks* Arabic, not just renders RTL text.
 *
 * Defends: "Arabic UX is more than RTL — DarDesign narrates culture by voice."
 * Degrades gracefully: if the browser lacks speechSynthesis, it shows the text
 * only and disables the button.
 */

import { useEffect, useRef, useState } from "react";
import { Volume2, Square } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import type { StyleId } from "@/context/ImageContext";

type Script = { en: string; ar: string };

const SCRIPTS: Record<StyleId, Script> = {
  lebanese: {
    en: "This is a Lebanese interior in the DarDesign Lebanese style. It features the qanater triple arch, a carved cedar-wood ceiling, encaustic floor tiles, and traditional wrought-iron mashrabiya.",
    ar: "هذه غرفةٌ لبنانيةٌ بنمط دار-ديزاين-لبناني. تحتوي على قوسٍ ثلاثيٍّ يُسمّى القناطر، وسقفِ خشبِ أرزٍ محفور، وبلاطٍ منقوش، ومشربيةٍ حديديةٍ تقليدية.",
  },
  khaleeji: {
    en: "This is a Khaleeji, Gulf-Arab interior in the DarDesign Khaleeji style. It features carved gypsum panels known as jus, a palm-frond jereed ceiling, low majlis floor seating, and sadu woven textiles.",
    ar: "هذه غرفةٌ خليجيةٌ بنمط دار-ديزاين-خليجي. تحتوي على جصٍّ محفور، وسقفِ جريدِ النخل، وجلسةِ مجلسٍ أرضيةٍ منخفضة، ونسيجِ سدو.",
  },
  moroccan: {
    en: "This is a Moroccan interior in the DarDesign Moroccan style. It features zellige mosaic tilework, polished tadelakt walls, carved cedar screens, and pierced brass lanterns.",
    ar: "هذه غرفةٌ مغربيةٌ بنمط دار-ديزاين-مغربي. تحتوي على زليجٍ فسيفسائي، وجدرانِ تادلاكت مصقولة، وحواجزِ أرزٍ محفورة، وفوانيسَ نحاسيةٍ مخرّمة.",
  },
};

const NAMES: Record<StyleId, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
};

const ORDER: StyleId[] = ["lebanese", "khaleeji", "moroccan"];

export default function CulturalNarration({
  initialCulture = "lebanese",
  className,
}: {
  initialCulture?: StyleId;
  className?: string;
}) {
  const { isArabic } = useThemeLanguage();
  const [culture, setCulture] = useState<StyleId>(initialCulture);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Detect support + warm up the voice list (some browsers load it async).
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", warm);
      window.speechSynthesis.cancel();
    };
  }, []);

  // Stop any narration when the language or culture changes.
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [isArabic, culture]);

  const text = isArabic ? SCRIPTS[culture].ar : SCRIPTS[culture].en;

  const speak = () => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = isArabic ? "ar-SA" : "en-US";
    u.rate = isArabic ? 0.92 : 1;
    const voices = synth.getVoices();
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(isArabic ? "ar" : "en"));
    if (match) u.voice = match;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utterRef.current = u;
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  return (
    <div className={cn("rounded-2xl border border-gold/20 bg-charcoal-soft/40 p-4", className)} dir={isArabic ? "rtl" : "ltr"}>
      <div className={cn("mb-3 flex flex-wrap items-center gap-2", isArabic && "flex-row-reverse")}>
        {ORDER.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCulture(c)}
            aria-pressed={culture === c}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              culture === c ? "border-gold text-gold" : "border-cream-muted text-cream-muted hover:border-gold hover:text-gold",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            {isArabic ? NAMES[c].ar : NAMES[c].en}
          </button>
        ))}
      </div>

      <p className={cn("mb-3 text-sm leading-relaxed text-cream-soft", isArabic && "font-arabic")}>{text}</p>

      <button
        type="button"
        onClick={speak}
        disabled={!supported}
        aria-label={isArabic ? "استمع إلى الوصف" : "Listen to the description"}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition focus-visible:ring-2 ring-gold outline-none",
          supported
            ? "border-gold text-gold hover:bg-gold/10"
            : "cursor-not-allowed border-cream-muted text-cream-muted opacity-60",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        )}
      >
        {speaking ? <Square size={15} /> : <Volume2 size={15} />}
        {!supported
          ? isArabic
            ? "الصوت غير مدعوم"
            : "Voice not supported"
          : speaking
            ? isArabic
              ? "إيقاف"
              : "Stop"
            : isArabic
              ? "استمع"
              : "Listen"}
      </button>
    </div>
  );
}
