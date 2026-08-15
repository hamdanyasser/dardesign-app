"use client";

/* ============================================================
   History — the signed-in user's saved designs.

   Scoped server-side by UserId, so this page can only ever show
   the current account's entries. Each card can be shared to the
   public gallery ("Show as Suggested") or deleted.
   ============================================================ */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Pencil, Trash2 } from "lucide-react";
import FeedbackForm from "@/components/FeedbackForm";
import RatingBadge from "@/components/RatingBadge";
import GalleryShell, { DesignCard } from "@/components/GalleryShell";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  deleteHistoryEntry,
  fetchHistory,
  fetchHistoryScene,
  setSuggested,
  storedImageUrl,
  type HistoryEntry,
  type StyleId,
} from "@/lib/api";
import { SCENE_HANDOFF_KEY } from "@/lib/design/handoff";
import { SCENE_VERSION } from "@/lib/design/types";

export default function HistoryPage() {
  const { isArabic, copy } = useThemeLanguage();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const cultureName = (culture: HistoryEntry["culture"]) =>
    (culture && copy.shared.styles[culture as StyleId]?.name) || null;

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

  /* Reopen a saved design in Build Mode, so it can be kept working on rather
     than only looked at.

     The scene is fetched here rather than carried in the listing: a scene is a
     few KB and this page lists up to 100 designs, so folding it into every load
     would cost megabytes to serve a button most rows never press.

     The version check is the honest half. loadScene refuses a scene whose
     SCENE_VERSION it does not recognise, so a design saved in an older format
     cannot be restored faithfully — and a room that opens looking plausible but
     missing pieces is worse than one that refuses with a reason. */
  const openInBuildMode = async (entry: HistoryEntry) => {
    setBusy(entry.id);
    setError(null);
    try {
      const found = await fetchHistoryScene(entry.id);
      if (!found) {
        setError(
          t(
            "That design has no editable scene.",
            "لا يوجد مشهد قابل للتحرير لهذا التصميم.",
          ),
        );
        return;
      }
      if (found.scene.version !== SCENE_VERSION) {
        setError(
          t(
            "That design was saved in an older scene format and cannot be reopened.",
            "حُفظ هذا التصميم بصيغة مشهد أقدم ولا يمكن إعادة فتحه.",
          ),
        );
        return;
      }
      sessionStorage.setItem(SCENE_HANDOFF_KEY, JSON.stringify(found.scene));
      router.push("/design");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? isArabic
            ? e.message_ar
            : e.message_en
          : t("Could not open that design.", "تعذّر فتح التصميم."),
      );
    } finally {
      setBusy(null);
    }
  };

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
    "font-editorial-mono flex items-center gap-1.5 rounded-[2px] border border-[var(--dd-border)] px-2.5 py-1.5 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)] disabled:opacity-50";

  const ratedCount = entries.filter((e) => e.rating).length;

  return (
    <GalleryShell
      title={t("My designs", "تصاميمي")}
      subtitle={t("Every design you saved, newest first.", "كل تصميم حفظته، الأحدث أولاً.")}
      eyebrow={
        entries.length > 0
          ? t(
              `${entries.length} SAVED · ${ratedCount} RATED`,
              `${entries.length} محفوظ · ${ratedCount} مقيَّم`,
            )
          : undefined
      }
    >
      {error && (
        <p className="mb-6 border-s-2 border-[var(--error)] ps-3 text-sm text-[var(--error)]">
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
        <div>
          {entries.map((e) => (
            <DesignCard
              key={e.id}
              beforeUrl={storedImageUrl(e.oldImageUrl)}
              afterUrl={storedImageUrl(e.newImageUrl)}
              createdAt={e.createdAt}
              title={cultureName(e.culture) ?? t("Untitled", "بلا عنوان")}
              tag={e.isSuggested ? t("SHARED", "مُشارَك") : undefined}
              rating={<RatingBadge rating={e.rating} />}
              actions={
                <>
                  {/* Offered only when a scene was stored with this design.
                      A Studio design is a render of a photograph — there is no
                      layout behind it to reopen — so the button is absent
                      rather than present and failing. */}
                  {e.hasScene && (
                    <button
                      onClick={() => openInBuildMode(e)}
                      disabled={busy === e.id}
                      className={`${btn} hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]`}
                    >
                      {busy === e.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                      {t("Edit", "تحرير")}
                    </button>
                  )}
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
        className="font-editorial-mono mt-5 inline-block rounded-[2px] bg-[var(--dd-gold)] px-6 py-3 text-xs text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
      >
        {cta}
      </Link>
    </div>
  );
}
