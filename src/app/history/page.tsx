"use client";

/* ============================================================
   History — the signed-in user's saved designs.

   Scoped server-side by UserId, so this page can only ever show
   the current account's entries. Each card can be shared to the
   public gallery ("Show as Suggested") or deleted.
   ============================================================ */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import FeedbackForm from "@/components/FeedbackForm";
import RatingBadge from "@/components/RatingBadge";
import GalleryShell, { DesignCard } from "@/components/GalleryShell";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  deleteHistoryEntry,
  fetchHistory,
  setSuggested,
  storedImageUrl,
  type HistoryEntry,
} from "@/lib/api";

export default function HistoryPage() {
  const { isArabic } = useThemeLanguage();
  const { user, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

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

  const toggleSuggested = async (entry: HistoryEntry) => {
    const next = !entry.isSuggested;
    setBusy(entry.id);
    setError(null);
    try {
      await setSuggested(entry.id, next);
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, isSuggested: next } : e)),
      );
    } catch {
      setError(t("Could not update that design.", "تعذّر تحديث التصميم."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    setBusy(id);
    try {
      await deleteHistoryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError(t("Could not delete that design.", "تعذّر حذف التصميم."));
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition disabled:opacity-50";

  return (
    <GalleryShell
      title={t("My designs", "تصاميمي")}
      subtitle={t("Every design you saved, newest first.", "كل تصميم حفظته، الأحدث أولاً.")}
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
        <Empty
          message={t("Sign in to see your saved designs.", "سجّل الدخول لعرض تصاميمك المحفوظة.")}
          href="/login"
          cta={t("Sign in", "تسجيل الدخول")}
        />
      ) : entries.length === 0 ? (
        <Empty
          message={t("You haven't saved any designs yet.", "لم تحفظ أي تصميم بعد.")}
          href="/studio"
          cta={t("Design a room", "صمّم غرفة")}
        />
      ) : (
        <div className="space-y-6">
          {entries.map((e) => (
            <DesignCard
              key={e.id}
              beforeUrl={storedImageUrl(e.oldImageUrl)}
              afterUrl={storedImageUrl(e.newImageUrl)}
              createdAt={e.createdAt}
              caption={
                <span className="flex flex-wrap items-center gap-2">
                  {e.culture && (
                    <span className="rounded-full border border-[var(--dd-gold-dim)]/50 px-2 py-0.5 text-xs text-[var(--dd-text-secondary)]">
                      {e.culture}
                    </span>
                  )}
                  {e.isSuggested && (
                    <span className="rounded-full border border-[var(--dd-gold)]/50 px-2 py-0.5 text-xs text-[var(--dd-gold)]">
                      {t("Shared", "مشارَك")}
                    </span>
                  )}
                  {/* The rating already stored for this design. The form below
                      is still where it is given or changed. */}
                  <RatingBadge rating={e.rating} />
                </span>
              }
              actions={
                <>
                  <button
                    onClick={() => toggleSuggested(e)}
                    disabled={busy === e.id}
                    className={`${btn} ${
                      e.isSuggested
                        ? "border-[var(--dd-gold)]/60 text-[var(--dd-gold)]"
                        : "hover:border-[var(--dd-gold)]"
                    }`}
                  >
                    {busy === e.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : e.isSuggested ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    {e.isSuggested
                      ? t("Stop showing", "إيقاف العرض")
                      : t("Show as Suggested", "عرضه كمقترح")}
                  </button>
                  <button
                    onClick={() => remove(e.id)}
                    disabled={busy === e.id}
                    className={`${btn} hover:border-[var(--error)] hover:text-[var(--error)]`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("Delete", "حذف")}
                  </button>
                  {/* Collapsed by default: the form loads any rating already
                      given, so opening it shows what was said rather than a
                      blank form. */}
                  <FeedbackForm historyId={e.id} />
                </>
              }
            />
          ))}
        </div>
      )}
    </GalleryShell>
  );
}

function Empty({ message, href, cta }: { message: string; href: string; cta: string }) {
  return (
    <div className="mt-16 text-center">
      <p className="text-[var(--dd-text-soft)]">{message}</p>
      <Link
        href={href}
        className="mt-5 inline-block rounded-lg bg-[var(--dd-gold)] px-5 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
      >
        {cta}
      </Link>
    </div>
  );
}
