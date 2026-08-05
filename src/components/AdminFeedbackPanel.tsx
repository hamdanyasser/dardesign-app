"use client";

/* ============================================================
   Feedback summary for the admin area.

   Lives on /audit next to the render log — both answer "what has
   this system actually produced, and how did it land?", and the
   defense shows them together.

   Admin-only server-side: /api/admin/feedback returns other
   people's comments, so an ordinary account gets 403 and this
   panel says so rather than rendering an empty table that looks
   like "no feedback yet".
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import { ApiError, fetchAdminFeedback, type AdminFeedbackResult } from "@/lib/api";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

const DAY = 86_400;

const RANGES: { key: string; days: number | null; en: string; ar: string }[] = [
  { key: "all", days: null, en: "All time", ar: "كل الوقت" },
  { key: "7", days: 7, en: "Last 7 days", ar: "آخر ٧ أيام" },
  { key: "30", days: 30, en: "Last 30 days", ar: "آخر ٣٠ يوماً" },
];

export default function AdminFeedbackPanel() {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [data, setData] = useState<AdminFeedbackResult | null>(null);
  const [culture, setCulture] = useState<string>("");
  const [range, setRange] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const days = RANGES.find((r) => r.key === range)?.days ?? null;
      setData(
        await fetchAdminFeedback({
          culture: culture || undefined,
          since: days ? Date.now() / 1000 - days * DAY : undefined,
          limit: 50,
        }),
      );
    } catch (e) {
      setData(null);
      setErr(
        e instanceof ApiError
          ? isArabic ? e.message_ar : e.message_en
          : t("Could not load feedback.", "تعذّر تحميل التقييمات."),
      );
    } finally {
      setBusy(false);
    }
  }, [culture, range, isArabic, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data?.stats;

  return (
    <section className="mb-10">
      <div className={cn("mb-2 flex items-center gap-3", isArabic && "flex-row-reverse")}>
        <MessageSquare className="text-gold" size={22} />
        <h2
          className={cn(
            "text-xl font-semibold text-gold",
            isArabic ? "font-arabic" : "font-display",
          )}
        >
          {t("User feedback", "تقييمات المستخدمين")}
        </h2>
      </div>
      <p className={cn("mb-4 text-sm text-cream-muted", isArabic && "font-arabic")}>
        {t(
          "How users rated the designs they saved. One rating per design.",
          "كيف قيّم المستخدمون التصاميم التي حفظوها. تقييم واحد لكل تصميم.",
        )}
      </p>

      {/* filters */}
      <div className={cn("mb-4 flex flex-wrap items-center gap-3", isArabic && "flex-row-reverse")}>
        <select
          value={culture}
          onChange={(e) => setCulture(e.target.value)}
          className={cn(
            "rounded-lg border border-gold/30 bg-[var(--dd-surface)] px-3 py-1.5 text-sm text-cream outline-none focus:border-gold",
            isArabic ? "font-arabic" : "font-ui",
          )}
        >
          <option value="">{t("All cultures", "كل الثقافات")}</option>
          {(data?.cultures ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className={cn(
            "rounded-lg border border-gold/30 bg-[var(--dd-surface)] px-3 py-1.5 text-sm text-cream outline-none focus:border-gold",
            isArabic ? "font-arabic" : "font-ui",
          )}
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>{t(r.en, r.ar)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-gold px-3 py-1.5 text-sm text-gold transition hover:bg-gold hover:text-[var(--dd-ink)]",
            isArabic ? "font-arabic flex-row-reverse" : "font-ui",
          )}
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {t("Refresh", "تحديث")}
        </button>
      </div>

      {err && (
        <p className={cn("mb-4 text-sm text-[var(--error)]", isArabic && "font-arabic")}>{err}</p>
      )}

      {stats && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t("Submissions", "عدد التقييمات")} value={stats.total} />
            <Tile label={t("Cultural accuracy", "الدقة الثقافية")} value={fmt(stats.averageCulturalAccuracy)} />
            <Tile label={t("Image quality", "جودة الصورة")} value={fmt(stats.averageImageQuality)} />
            <Tile label={t("Room preserved", "الحفاظ على الغرفة")} value={fmt(stats.averageRoomPreservation)} />
            <Tile label={t("Placement valid", "توزيع صحيح")} value={stats.placementValid} />
            <Tile label={t("Placement invalid", "توزيع خاطئ")} value={stats.placementInvalid} />
          </div>

          {stats.placementNotApplicable > 0 && (
            <p className={cn("mb-4 text-xs text-cream-muted", isArabic && "font-arabic")}>
              {t(
                `${stats.placementNotApplicable} design(s) had no furniture added.`,
                `${stats.placementNotApplicable} تصميم بدون أثاث مُضاف.`,
              )}
            </p>
          )}

          {data!.byCulture.length > 0 && (
            <div className="mb-6 overflow-x-auto rounded-2xl border border-gold/20">
              <table className="w-full border-collapse text-sm" dir="ltr">
                <thead>
                  <tr className="bg-[var(--dd-surface-strong)] text-left font-ui text-xs uppercase tracking-wide text-cream-muted">
                    <th className="px-3 py-2">culture</th>
                    <th className="px-3 py-2">n</th>
                    <th className="px-3 py-2">cultural</th>
                    <th className="px-3 py-2">quality</th>
                    <th className="px-3 py-2">preserved</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {data!.byCulture.map((c) => (
                    <tr key={c.culture ?? "unknown"} className="border-t border-gold/10 text-cream-soft">
                      <td className="px-3 py-2 text-gold">{c.culture ?? "unknown"}</td>
                      <td className="px-3 py-2">{c.total}</td>
                      <td className="px-3 py-2">{fmt(c.averageCulturalAccuracy)}</td>
                      <td className="px-3 py-2">{fmt(c.averageImageQuality)}</td>
                      <td className="px-3 py-2">{fmt(c.averageRoomPreservation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className={cn("mb-2 text-sm text-cream-muted", isArabic && "font-arabic")}>
            {t("Recent comments", "أحدث التعليقات")}
          </h3>
          {data!.recent.filter((f) => f.comment).length === 0 ? (
            <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
              {t("No comments yet.", "لا توجد تعليقات بعد.")}
            </p>
          ) : (
            <ul className="space-y-2">
              {data!.recent
                .filter((f) => f.comment)
                .map((f) => (
                  <li
                    key={f.id}
                    className="rounded-xl border border-gold/15 bg-[var(--dd-surface)] px-3 py-2"
                  >
                    <p className="text-sm text-cream-soft">{f.comment}</p>
                    <p className="mt-1 font-mono text-xs text-cream-muted">
                      {f.authorName ?? "—"} · {f.culture ?? "unknown"} · cultural {f.culturalAccuracy}/5 ·
                      quality {f.imageQuality}/5 · preserved {f.roomPreservation}/5 ·{" "}
                      {f.furniturePlacement} ·{" "}
                      {new Date(f.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ")}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-[var(--dd-surface)] px-3 py-2">
      <p className="text-xs text-cream-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-gold">{value}</p>
    </div>
  );
}
