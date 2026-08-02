"use client";

/* ============================================================
   Others' Work — designs other people chose to share.

   Only entries with IsSuggested = true, and never the viewer's
   own, both enforced in the SQL rather than here: nothing anyone
   kept private can reach this page.
   ============================================================ */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import GalleryShell, { DesignCard } from "@/components/GalleryShell";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, fetchSuggested, storedImageUrl, type HistoryEntry } from "@/lib/api";

export default function OthersWorkPage() {
  const { isArabic } = useThemeLanguage();
  const { user, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, ar: string) => (isArabic ? ar : en);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchSuggested()
      .then((h) => !cancelled && setEntries(h))
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? isArabic
              ? e.message_ar
              : e.message_en
            : t("Could not load shared designs.", "تعذّر تحميل التصاميم المشارَكة."),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, isArabic]);

  return (
    <GalleryShell
      title={t("Others' Work", "أعمال الآخرين")}
      subtitle={t(
        "Designs other members chose to share.",
        "تصاميم اختار أصحابها مشاركتها.",
      )}
    >
      {error && (
        <p className="mb-6 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
          {error}
        </p>
      )}

      {authLoading || loading ? (
        <div className="mt-16 flex items-center justify-center gap-2 text-[var(--dd-text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("Loading…", "جارٍ التحميل…")}
        </div>
      ) : !user ? (
        <div className="mt-16 text-center">
          <p className="text-[var(--dd-text-soft)]">
            {t("Sign in to browse shared designs.", "سجّل الدخول لتصفّح التصاميم المشارَكة.")}
          </p>
          <Link
            href="/login"
            className="mt-5 inline-block rounded-lg bg-[var(--dd-gold)] px-5 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
          >
            {t("Sign in", "تسجيل الدخول")}
          </Link>
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-[var(--dd-text-soft)]">
            {t(
              "Nobody has shared a design yet.",
              "لم يشارك أحد أي تصميم بعد.",
            )}
          </p>
          <p className="mt-2 text-sm text-[var(--dd-text-secondary)]">
            {t(
              "Share one of yours from History to start it off.",
              "شارك أحد تصاميمك من السجلّ لتكون البداية.",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {entries.map((e) => (
            <DesignCard
              key={e.id}
              beforeUrl={storedImageUrl(e.oldImageUrl)}
              afterUrl={storedImageUrl(e.newImageUrl)}
              createdAt={e.createdAt}
              caption={
                e.authorName ? (
                  <span className="text-xs text-[var(--dd-text-secondary)]">
                    {t("by", "بواسطة")} {e.authorName}
                  </span>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </GalleryShell>
  );
}
