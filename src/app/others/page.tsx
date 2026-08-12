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
import RatingBadge from "@/components/RatingBadge";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, fetchSuggested, storedImageUrl, type HistoryEntry, type StyleId } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function OthersWorkPage() {
  const { isArabic, copy } = useThemeLanguage();
  const { user, loading: authLoading } = useAuth();

  const cultureName = (culture: HistoryEntry["culture"]) =>
    (culture && copy.shared.styles[culture as StyleId]?.name) || null;

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
      eyebrow={entries.length > 0 ? t("SELECTED BY THE STUDIO", "من اختيار الاستوديو") : undefined}
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
        <div className="mt-16 text-center">
          <p className="text-[var(--dd-text-soft)]">
            {t("Sign in to browse shared designs.", "سجّل الدخول لتصفّح التصاميم المشارَكة.")}
          </p>
          <Link
            href="/login"
            className="font-editorial-mono mt-5 inline-block rounded-[2px] bg-[var(--dd-gold)] px-6 py-3 text-xs text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
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
        <div>
          {/* A1: the newest shared design gets a featured block — image is
              the page, type sits beside it — everything after it is the
              plain archive grid DesignCard already renders. */}
          {entries[0] && (
            <div className="mb-10 grid grid-cols-1 gap-6 border-b border-[var(--dd-border)] pb-10 md:grid-cols-[1.55fr_1fr] md:items-end md:gap-9">

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={storedImageUrl(entries[0].newImageUrl)}
                alt={cultureName(entries[0].culture) ?? ""}
                className="block aspect-[16/11] w-full border border-[var(--dd-border)] object-cover"
              />
              <div className={cn(isArabic && "text-right")}>
                <div className="font-editorial-mono text-[10.5px] text-[var(--dd-gold)]">
                  {t("FEATURE · 01", "مُختار · ٠١")}
                </div>
                <div
                  className={cn(
                    "mt-2 text-[2.1rem] leading-[1.1] text-[var(--dd-text)]",
                    isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
                  )}
                >
                  {cultureName(entries[0].culture) ?? t("Untitled", "بلا عنوان")}
                </div>
                {entries[0].authorName && (
                  <div className="font-editorial-mono mt-2 text-[9.5px] text-[var(--dd-text-secondary)]">
                    {t("by", "بواسطة")} {entries[0].authorName} ·{" "}
                    {new Date(entries[0].createdAt * 1000).toLocaleDateString(
                      isArabic ? "ar" : "en-GB",
                      { day: "2-digit", month: "short" },
                    )}
                  </div>
                )}
                <div className="mt-3">
                  <RatingBadge rating={entries[0].rating} />
                </div>
              </div>
            </div>
          )}

          {entries.slice(1).map((e) => (
            <DesignCard
              key={e.id}
              beforeUrl={storedImageUrl(e.oldImageUrl)}
              afterUrl={storedImageUrl(e.newImageUrl)}
              createdAt={e.createdAt}
              title={cultureName(e.culture) ?? t("Untitled", "بلا عنوان")}
              tag={e.authorName ? `${t("by", "بواسطة")} ${e.authorName}` : undefined}
              /* The same stored rating History shows — scores only, never the
                 author's written comment (the server omits it here). */
              rating={<RatingBadge rating={e.rating} />}
            />
          ))}
        </div>
      )}
    </GalleryShell>
  );
}
