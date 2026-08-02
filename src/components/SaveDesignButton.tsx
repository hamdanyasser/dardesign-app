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

interface Props {
  /** The room as uploaded — stored as OldImageUrl. */
  oldImage: string;
  /** The current edited render — stored as NewImageUrl. */
  newImage: string;
}

export default function SaveDesignButton({ oldImage, newImage }: Props) {
  const { isArabic } = useThemeLanguage();
  const { user, loading } = useAuth();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await saveToHistory(oldImage, newImage);
      setSaved(true);
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
  );
}
