"use client";

/**
 * RefinementControls — Quick AI Refinement.
 *
 * Four one-click nudges on the design currently on screen: more cultural,
 * preserve the room more, brighter, warmer. Each is a full re-render of the
 * SAME culture from the ORIGINAL uploaded photo with one pipeline parameter
 * changed (backend `_REFINE_MODES`) — not an edit of the image on screen, and
 * not a second pipeline.
 *
 * Two consequences of that, both deliberate:
 *
 *  - A refinement costs a GPU minute exactly like a generation, so it spends a
 *    weekly use through the same gate. `spend` is the studio's own quota call,
 *    passed in rather than reimplemented, so there is one place that can refuse.
 *  - The result is a genuine pipeline output. The parent updates `pristine` and
 *    the SSIM alongside the image, so a refined design saves as unedited and
 *    correctly scored instead of being mistaken for a colour edit.
 *
 * Revert always returns to the ORIGINAL generation, never the previous
 * refinement — after three clicks "undo" meaning "back two steps" is a worse
 * answer than "back to what the pipeline gave me".
 */

import { useState } from "react";
import { Gem, Home, Sun, Flame, Undo2, Loader2 } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, refineRoom, type RefineMode, type StyleId } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface RefinedDesign {
  image: string;
  ssim: number | null;
  duration: number | null;
  mode: RefineMode;
}

interface Props {
  /** The ORIGINAL uploaded room. Refinement never re-reads the render. */
  file: File | null;
  /** The culture on screen — refinement keeps it, it never switches culture. */
  style: StyleId;
  /** Parent render's job id, so the refinement reuses its seed. */
  baseJobId?: string | null;
  /** Something has been refined and the original render can be restored. */
  canRevert: boolean;
  onRefined: (result: RefinedDesign) => void;
  onRevert: () => void;
  /** The studio's quota gate. Resolves to the refusal to show, or null to go. */
  spend: () => Promise<ApiError | null>;
}

const MODES: {
  mode: RefineMode;
  Icon: typeof Gem;
  en: string;
  ar: string;
  hintEn: string;
  hintAr: string;
}[] = [
  {
    mode: "more_cultural",
    Icon: Gem,
    en: "More cultural",
    ar: "أكثر أصالة",
    hintEn: "Stronger LoRA + richer ornament in the prompt",
    hintAr: "تأثير ثقافي أقوى وزخرفة أغنى",
  },
  {
    mode: "preserve_room",
    Icon: Home,
    en: "Preserve room more",
    ar: "حافظ على الغرفة",
    hintEn: "Less transformation, stronger structural conditioning",
    hintAr: "تحويل أقل مع تثبيت أقوى لبنية الغرفة",
  },
  {
    mode: "brighter",
    Icon: Sun,
    en: "Brighter",
    ar: "أكثر إضاءة",
    hintEn: "Same settings, bright natural-daylight cues",
    hintAr: "نفس الإعدادات مع إضاءة نهارية طبيعية",
  },
  {
    mode: "warmer",
    Icon: Flame,
    en: "Warmer",
    ar: "أكثر دفئاً",
    hintEn: "Same settings, warm and cozy lighting cues",
    hintAr: "نفس الإعدادات مع أجواء دافئة ومريحة",
  },
];

/** Bilingual message for a failed refinement.
 *
 *  `network_unreachable` is special-cased because safeFetch puts the browser's
 *  own string in message_en — "Failed to fetch" is not something to show a
 *  user, and the Arabic side of that error is already a real sentence. */
function pickMessage(e: unknown, isArabic: boolean): string {
  if (e instanceof ApiError) {
    if (e.code === "network_unreachable") {
      return isArabic
        ? "تعذّر الاتصال بخادم التوليد. تأكد من تشغيل الخدمة ثم أعد المحاولة."
        : "Couldn't reach the generation server. Check it's running and try again.";
    }
    return isArabic ? e.message_ar : e.message_en;
  }
  return isArabic ? "حدث خطأ، يرجى المحاولة مجدداً." : "Something went wrong. Please try again.";
}

export default function RefinementControls({
  file,
  style,
  baseJobId,
  canRevert,
  onRefined,
  onRevert,
  spend,
}: Props) {
  const { isArabic } = useThemeLanguage();
  const [running, setRunning] = useState<RefineMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RefineMode | null>(null);

  const run = async (mode: RefineMode) => {
    if (!file || running) return;
    setError(null);
    setDone(null);

    // Before the spinner, so a refusal is immediate rather than a wait that
    // turns out to have been for nothing.
    const refused = await spend();
    if (refused) {
      setError(isArabic ? refused.message_ar : refused.message_en);
      return;
    }

    setRunning(mode);
    try {
      const r = await refineRoom(file, style, mode, { baseJobId });
      onRefined({ image: r.image, ssim: r.ssim, duration: r.duration_s, mode });
      setDone(mode);
    } catch (e) {
      setError(pickMessage(e, isArabic));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div
      className="rounded-2xl border border-gold/20 bg-charcoal-soft/40 p-4"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <div className={cn("mb-1 flex items-center justify-between gap-3", isArabic && "flex-row-reverse")}>
        <h3 className={cn("text-sm font-semibold text-cream", isArabic ? "font-arabic" : "font-display")}>
          {isArabic ? "تحسين سريع" : "Quick refinement"}
        </h3>
        {canRevert && (
          <button
            type="button"
            onClick={() => {
              // Clear the confirmation too: after a revert, "refined — save and
              // report use the new result" describes something that no longer
              // exists on screen.
              setDone(null);
              setError(null);
              onRevert();
            }}
            disabled={!!running}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-cream-muted transition hover:text-gold disabled:opacity-40",
              isArabic ? "font-arabic flex-row-reverse" : "font-ui",
            )}
          >
            <Undo2 size={14} />
            {isArabic ? "استعادة الأصلي" : "Revert to original"}
          </button>
        )}
      </div>

      <p className={cn("mb-3 text-[11px] text-cream-muted", isArabic ? "text-right font-arabic" : "font-ui")}>
        {isArabic
          ? "يُعاد التوليد من الصورة الأصلية بنفس الثقافة — ويُحتسب من رصيدك الأسبوعي."
          : "Re-generates from your original photo in the same culture — and counts as one design."}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map(({ mode, Icon, en, ar, hintEn, hintAr }) => {
          const busy = running === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => run(mode)}
              disabled={!file || !!running}
              title={isArabic ? hintAr : hintEn}
              aria-busy={busy}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs transition outline-none focus-visible:ring-2 ring-gold",
                file && !running
                  ? "border-gold/40 text-cream hover:border-gold hover:bg-gold/10 hover:text-gold"
                  : "cursor-not-allowed border-cream-muted/40 text-cream-muted opacity-60",
                busy && "border-gold text-gold",
                isArabic ? "font-arabic" : "font-ui",
              )}
            >
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} />}
              <span className="text-center leading-tight">{isArabic ? ar : en}</span>
            </button>
          );
        })}
      </div>

      {running && (
        <p className={cn("mt-3 text-xs text-gold", isArabic ? "text-right font-arabic" : "font-ui")}>
          {isArabic
            ? "جارٍ التحسين… قد يستغرق دقيقة إلى ثلاث دقائق."
            : "Refining… this takes one to three minutes."}
        </p>
      )}

      {!running && done && (
        <p className={cn("mt-3 text-xs text-[var(--success)]", isArabic ? "text-right font-arabic" : "font-ui")}>
          {isArabic
            ? "تم التحسين — الحفظ والتقرير والمقارنة تستخدم النتيجة الجديدة."
            : "Refined — save, report and compare now use the new result."}
        </p>
      )}

      {error && (
        <p className={cn("mt-3 text-xs text-[var(--error)]", isArabic ? "text-right font-arabic" : "font-ui")}>
          {error}
        </p>
      )}
    </div>
  );
}
