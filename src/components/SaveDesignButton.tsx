"use client";

/* ============================================================
   Save the current design to History.

   Nothing is persisted until this is pressed — that's the point.
   It sends whatever is on screen *now*, so furniture placed after
   generation is included: the studio replaces the featured image
   after each insertion, so `newImage` is always the latest state.
   ============================================================ */

import Link from "next/link";
import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, saveToHistory } from "@/lib/api";
import { cn } from "@/lib/utils";
import FeedbackForm from "@/components/FeedbackForm";

interface Props {
  /** The room as uploaded — stored as OldImageUrl. */
  oldImage: string;
  /** The current edited render — stored as NewImageUrl. */
  newImage: string;
  /** Which culture produced this render. Stored on the design so that rating it
   *  later reads the culture from the database rather than from the form. */
  culture?: string | null;
  /** LoRA scale, when the intensity slider was used. */
  intensity?: number | null;
  /** Seconds the generation took, from the /redesign response. Stored on the
   *  design because history is the durable record — the rendering backend is
   *  disposable and its own timings die with the session. */
  duration?: number | null;
  /** Structure preservation for this design (0..1), measured at generation. */
  ssim?: number | null;
  /** True once colour control or furniture placement has changed the render.
   *  The design is saved either way; it just isn't evaluated as pipeline output. */
  edited?: boolean;
  /** True when the render is a DARDESIGN_LIGHT placeholder. Saved like any
   *  other design, but a tint produced in milliseconds must never land in the
   *  dashboard's generation time or SSIM. */
  light?: boolean;
}

export default function SaveDesignButton({
  oldImage,
  newImage,
  culture = null,
  intensity = null,
  duration = null,
  ssim = null,
  edited = false,
  light = false,
}: Props) {
  const { isArabic } = useThemeLanguage();
  const { user, loading } = useAuth();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once saved: feedback attaches to a design row, so there is nothing to
  // rate until this design exists in history.
  const [savedId, setSavedId] = useState<number | null>(null);

  const t = (en: string, ar: string) => (isArabic ? ar : en);

  // Signed out: point at sign-in rather than showing a button that will fail.
  if (!loading && !user) {
    return (
      <Link
        href="/login"
        className={cn(
          "flex items-center gap-2 text-sm text-cream-muted transition hover:text-gold",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        )}
      >
        <Save size={16} />
        {t("Sign in to save", "سجّل الدخول للحفظ")}
      </Link>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const entry = await saveToHistory(oldImage, newImage, {
        culture, intensity, duration, ssim, edited, light,
      });
      setSaved(true);
      setSavedId(entry.id);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? isArabic
            ? e.message_ar
            : e.message_en
          : t("Could not save.", "تعذّر الحفظ."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
    <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
      <button
        onClick={save}
        // Re-enabled whenever the image changes, so a further edit can be saved
        // as a new entry rather than being silently locked out.
        disabled={saving}
        className={cn(
          "flex items-center gap-2 text-sm transition",
          isArabic ? "font-arabic flex-row-reverse" : "font-ui",
          saved ? "text-[var(--success)]" : "text-cream-muted hover:text-gold",
        )}
      >
        {saving ? (
          <Loader2 size={16} className="animate-spin" />
        ) : saved ? (
          <Check size={16} />
        ) : (
          <Save size={16} />
        )}
        {saving
          ? t("Saving…", "جارٍ الحفظ…")
          : saved
            ? t("Saved", "تم الحفظ")
            : t("Save design", "حفظ التصميم")}
      </button>
      {error && <span className="text-xs text-[var(--error)]">{error}</span>}
    </div>
      {/* Offered only once the design exists — a rating needs something to
          attach to, and asking before saving would have nowhere to put it. */}
      {savedId !== null && <FeedbackForm historyId={savedId} />}
    </div>
  );
}
