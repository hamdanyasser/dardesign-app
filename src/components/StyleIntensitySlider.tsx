"use client";

/**
 * StyleIntensitySlider — Creative Feature #2 (the ablation, made live).
 *
 * Pick a culture, drag the intensity 0–100 %, and re-generate that one room at
 * the chosen LoRA scale: 0 % ≈ generic SDXL, 100 % ≈ full Lebanese/Khaleeji/
 * Moroccan. Instead of a static no-LoRA vs with-LoRA grid in the thesis, the
 * examiner watches culture emerge from the latent space in real time.
 *
 * Re-generates on "Apply" (not on every drag) to respect the ~30–60 s T4 cost.
 * Uses the uploaded room from ImageContext; shows a bilingual error on failure.
 */

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useImage } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, restyleRoom, type RestyleStyleId } from "@/lib/api";
import { cn } from "@/lib/utils";

// persian is the prompt-only 4th culture — the live proof that adding culture
// N is one ontology entry (docs/add_a_culture.md), no retraining required.
const ORDER: RestyleStyleId[] = ["lebanese", "khaleeji", "moroccan", "persian"];
const NAMES: Record<RestyleStyleId, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  persian: { en: "Persian", ar: "فارسي" },
};

export default function StyleIntensitySlider() {
  const { imageFile } = useImage();
  const { isArabic } = useThemeLanguage();
  const [culture, setCulture] = useState<RestyleStyleId>("lebanese");
  const [pct, setPct] = useState(80);
  const [image, setImage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (!imageFile || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await restyleRoom(imageFile, culture, pct / 100);
      setImage(r.image);
      setManifest(r.manifest ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? (isArabic ? e.message_ar : e.message_en) : isArabic ? "حدث خطأ" : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gold/20 bg-charcoal-soft/40 p-4" dir={isArabic ? "rtl" : "ltr"}>
      {/* culture chips */}
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
            {c === "persian" && <span className="ms-1 opacity-70">{isArabic ? "· جديد" : "· new"}</span>}
          </button>
        ))}
      </div>

      {culture === "persian" && (
        <p className={cn("mb-3 text-[11px] text-cream-muted", isArabic && "text-right font-arabic")}>
          {isArabic
            ? "الفارسي طراز رابع بالموجّه فقط (بدون LoRA مدرّب) — دليل حيّ أن إضافة ثقافة جديدة = إدخالة أنطولوجيا واحدة."
            : "Persian is a prompt-only 4th culture (no trained LoRA) — live proof that adding a culture = one ontology entry."}
        </p>
      )}

      {/* intensity slider */}
      <div className={cn("mb-3 flex items-center gap-3", isArabic && "flex-row-reverse")}>
        <span className={cn("w-14 shrink-0 text-xs text-cream-muted", isArabic && "text-right font-arabic")}>
          {isArabic ? "الشدّة" : "Intensity"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          aria-label={isArabic ? "شدّة الطراز الثقافي" : "Cultural style intensity"}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-charcoal accent-gold"
          style={{ accentColor: "var(--dd-gold)" }}
        />
        <span className="w-10 shrink-0 text-right text-sm font-semibold text-gold tabular-nums">{pct}%</span>
      </div>
      <p className={cn("mb-3 text-[11px] text-cream-muted", isArabic && "text-right font-arabic")}>
        {isArabic ? "٠٪ ≈ SDXL عام · ١٠٠٪ ≈ الطراز الكامل" : "0% ≈ generic SDXL · 100% ≈ full culture"}
      </p>

      {/* apply */}
      <button
        type="button"
        onClick={apply}
        disabled={!imageFile || loading}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition focus-visible:ring-2 ring-gold outline-none",
          imageFile && !loading ? "border-gold text-gold hover:bg-gold/10" : "cursor-not-allowed border-cream-muted text-cream-muted opacity-60",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        )}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {!imageFile
          ? isArabic ? "ارفع صورة أولاً" : "Upload a room first"
          : loading
            ? isArabic ? "جارٍ التوليد…" : "Generating…"
            : isArabic ? `طبّق عند ${pct}٪` : `Apply at ${pct}%`}
      </button>

      {error && <p className={cn("mt-3 text-xs text-[var(--error)]", isArabic && "text-right font-arabic")}>{error}</p>}

      {image && (
        <div className="mt-4 overflow-hidden rounded-xl border border-gold/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={isArabic ? `${NAMES[culture].ar} عند ${pct}٪` : `${NAMES[culture].en} at ${pct}%`} className="block h-auto w-full" />
        </div>
      )}

      {manifest && (
        <details className="mt-3 text-xs text-cream-muted">
          <summary className={cn("cursor-pointer text-gold", isArabic ? "font-arabic" : "font-ui")}>
            {isArabic ? "🔏 الإسناد (المنشأ)" : "🔏 Provenance"}
          </summary>
          <ul className="mt-2 space-y-1 font-ui" dir="ltr">
            {(["model", "lora", "lora_scale", "seed", "output_sha256"] as const).map((k) =>
              manifest[k] != null ? (
                <li key={k}>
                  <span className="text-cream-soft">{k}</span>: {String(manifest[k]).slice(0, 48)}
                  {String(manifest[k]).length > 48 ? "…" : ""}
                </li>
              ) : null,
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
