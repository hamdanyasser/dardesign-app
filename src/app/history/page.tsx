"use client";

/* ============================================================
   History — the signed-in user's saved designs.

   Scoped server-side by UserId, so this page can only ever show
   the current account's entries.
   ============================================================ */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import CinemaChrome from "@/components/cinema/CinemaChrome";
import IslamicPattern from "@/components/islamic-pattern";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  deleteHistoryEntry,
  fetchHistory,
  storedImageUrl,
  type HistoryEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  const { isArabic } = useThemeLanguage();
  const { user, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const t = (en: string, ar: string) => (isArabic ? ar : en);

  useEffect(() => {
    // Wait for the session check before deciding there's nothing to fetch.
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchHistory()
      .then((h) => !cancelled && setEntries(h))
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? isArabic
              ? e.message_ar
              : e.message_en
            : t("Could not load your history.", "تعذّر تحميل السجلّ."),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, isArabic]);

  const remove = async (id: number) => {
    setRemoving(id);
    try {
      await deleteHistoryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError(t("Could not delete that design.", "تعذّر حذف التصميم."));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <main
      className="relative min-h-screen bg-[var(--dd-bg)] px-4 pb-20 pt-28"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <IslamicPattern opacity={0.03} />
      <CinemaChrome />

      <div className="relative z-10 mx-auto max-w-5xl">
        <h1
          className={cn(
            "text-2xl font-semibold text-[var(--dd-gold)]",
            isArabic ? "font-arabic text-right" : "font-display text-left",
          )}
        >
          {t("My designs", "تصاميمي")}
        </h1>
        <p
          className={cn(
            "mt-1.5 text-sm text-[var(--dd-text-secondary)]",
            isArabic ? "text-right" : "text-left",
          )}
        >
          {t("Every design you saved, newest first.", "كل تصميم حفظته، الأحدث أولاً.")}
        </p>

        {error && (
          <p className="mt-6 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
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
              {t("Sign in to see your saved designs.", "سجّل الدخول لعرض تصاميمك المحفوظة.")}
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
              {t("You haven't saved any designs yet.", "لم تحفظ أي تصميم بعد.")}
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-block rounded-lg bg-[var(--dd-gold)] px-5 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
            >
              {t("Design a room", "صمّم غرفة")}
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {entries.map((e) => (
              <article
                key={e.id}
                className="overflow-hidden rounded-2xl border border-[var(--dd-gold-dim)]/25 bg-[var(--dd-surface)]"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {[
                    { url: e.oldImageUrl, label: t("Before", "قبل") },
                    { url: e.newImageUrl, label: t("After", "بعد") },
                  ].map((side) => (
                    <figure key={side.label} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={storedImageUrl(side.url)}
                        alt={side.label}
                        className="block aspect-[4/3] w-full object-cover"
                      />
                      <figcaption className="absolute bottom-2 start-2 rounded-md bg-[var(--dd-bg)]/75 px-2 py-0.5 text-xs text-[var(--dd-text-soft)]">
                        {side.label}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                <div
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    isArabic && "flex-row-reverse",
                  )}
                >
                  <time className="text-xs text-[var(--dd-text-secondary)]">
                    {new Date(e.createdAt * 1000).toLocaleString(isArabic ? "ar" : "en-GB")}
                  </time>
                  <button
                    onClick={() => remove(e.id)}
                    disabled={removing === e.id}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
                  >
                    {removing === e.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    {t("Delete", "حذف")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
