"use client";

/**
 * /evaluation — how well the system actually performs, from stored data only.
 *
 * Every number here is read from the database (user ratings) or the render
 * audit log (generation statistics). Nothing is sampled, seeded or estimated:
 * where a figure has not been measured the page prints "—" and says why. That
 * distinction is the whole point of the page — an FYP panel cannot tell a real
 * 0.0 from a placeholder 0.0, so we never print one.
 *
 * Admin-only, because the feedback table carries other people's comments.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import GalleryShell from "@/components/GalleryShell";
import {
  CULTURE_LABEL,
  MetricComparison,
  ScoreBars,
} from "@/components/EvaluationChart";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, fetchEvaluation, type EvaluationReport } from "@/lib/api";
import { cn } from "@/lib/utils";

type CultureFilter = "all" | string;

/** Unix seconds from a yyyy-mm-dd input, or undefined when blank. */
function dayStart(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(t) ? undefined : t / 1000;
}
function dayEnd(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T23:59:59`).getTime();
  return Number.isNaN(t) ? undefined : t / 1000;
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null ? "—" : n.toFixed(digits);
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function EvaluationPage() {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [culture, setCulture] = useState<CultureFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setReport(
        await fetchEvaluation({
          culture: culture === "all" ? undefined : culture,
          since: dayStart(from),
          until: dayEnd(to),
          limit: 25,
        }),
      );
    } catch (e) {
      setReport(null);
      // Say what actually failed. Every status used to be reported as "admin
      // only", which sent a signed-in admin hunting for a permissions problem
      // when the real answer was a backend running code from before this
      // endpoint existed.
      const status = e instanceof ApiError ? e.http_status : 0;
      const detail =
        status === 401
          ? t("Sign in with an admin account to view this page.", "سجّل الدخول بحساب مشرف لعرض هذه الصفحة.")
          : status === 403
            ? t("This page is admin-only.", "هذه الصفحة للمشرف فقط.")
            : status === 404
              ? t(
                  "The backend does not have this endpoint — restart it so it picks up the latest code.",
                  "الخادم لا يحتوي على هذه الواجهة — أعد تشغيله ليحمّل أحدث نسخة من الشيفرة.",
                )
              : status === 0
                ? t("Could not reach the backend.", "تعذّر الاتصال بالخادم.")
                : "";
      const base =
        e instanceof ApiError
          ? isArabic ? e.message_ar : e.message_en
          : t("Something went wrong.", "حدث خطأ.");
      setErr(detail ? `${base} — ${detail}` : base);
    } finally {
      setBusy(false);
    }
  }, [culture, from, to, isArabic, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const cultures = report?.cultures ?? ["lebanese", "khaleeji", "moroccan"];

  // byCulture arrives as rows; the charts want lookups per metric.
  const byCulture = useMemo(() => {
    const map: Record<string, EvaluationReport["byCulture"][number]> = {};
    for (const row of report?.byCulture ?? []) if (row.culture) map[row.culture] = row;
    return map;
  }, [report]);

  // Ratings whose design has no culture recorded. They are real ratings and are
  // counted in the totals, but they cannot honestly be charted against a culture.
  const unattributed = useMemo(
    () =>
      (report?.byCulture ?? [])
        .filter((r) => !r.culture)
        .reduce((sum, r) => sum + r.total, 0),
    [report],
  );

  const pick = (field: keyof EvaluationReport["byCulture"][number]) =>
    Object.fromEntries(
      cultures.map((c) => [c, (byCulture[c]?.[field] as number | null) ?? null]),
    ) as Record<string, number | null>;

  const stats = report?.stats;
  const gen = report?.generation;
  const noData = t("Not measured yet", "لم يُقَس بعد");

  return (
    // Same shell as History and Others' Work: it carries the nav, the language
    // toggle and the page chrome, so this page can't drift from the rest of the app.
    <GalleryShell
      title={t("Evaluation dashboard", "لوحة التقييم")}
      subtitle={t(
        "System performance from stored data only — user ratings from the database, generation statistics from the render audit log. Nothing on this page is sampled or estimated.",
        "أداء النظام من البيانات المخزَّنة فقط — تقييمات المستخدمين من قاعدة البيانات، وإحصاءات التوليد من سجل التدقيق. لا شيء هنا مُقدَّر أو تجريبي.",
      )}
    >
      <div>
        {/* ---------- filters ---------- */}
        <section className="mb-8 rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-4">
          <div className={cn("flex flex-wrap items-end gap-4", isArabic && "flex-row-reverse")}>
            <div>
              <span className="mb-2 block text-xs uppercase tracking-wide text-cream-muted">
                {t("Culture", "الثقافة")}
              </span>
              <div className={cn("flex flex-wrap gap-2", isArabic && "flex-row-reverse")}>
                {(["all", ...cultures] as CultureFilter[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCulture(c)}
                    aria-pressed={culture === c}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition",
                      culture === c
                        ? "border-gold bg-[var(--dd-surface-strong)] text-gold"
                        : "border-gold/30 text-cream-muted hover:border-gold hover:text-gold",
                      isArabic ? "font-arabic" : "font-ui",
                    )}
                  >
                    {c === "all"
                      ? t("All cultures", "كل الثقافات")
                      : isArabic
                        ? CULTURE_LABEL[c]?.ar ?? c
                        : CULTURE_LABEL[c]?.en ?? c}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn("flex items-end gap-2", isArabic && "flex-row-reverse")}>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-cream-muted">
                  {t("From", "من")}
                </span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-lg border border-gold/30 bg-[var(--dd-surface-strong)] px-3 py-1.5 text-sm text-cream outline-none focus:border-gold"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-wide text-cream-muted">
                  {t("To", "إلى")}
                </span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-lg border border-gold/30 bg-[var(--dd-surface-strong)] px-3 py-1.5 text-sm text-cream outline-none focus:border-gold"
                />
              </label>
              {(from || to || culture !== "all") && (
                <button
                  onClick={() => {
                    setCulture("all");
                    setFrom("");
                    setTo("");
                  }}
                  className={cn(
                    "rounded-lg border border-gold/30 px-3 py-1.5 text-sm text-cream-muted transition hover:border-gold hover:text-gold",
                    isArabic ? "font-arabic" : "font-ui",
                  )}
                >
                  {t("Clear", "مسح")}
                </button>
              )}
            </div>

            <button
              onClick={() => void load()}
              disabled={busy}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-gold px-3 py-1.5 text-sm text-gold transition hover:bg-gold hover:text-[var(--dd-ink)] disabled:opacity-50",
                isArabic ? "font-arabic flex-row-reverse" : "font-ui",
              )}
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {t("Refresh", "تحديث")}
            </button>
          </div>
        </section>

        {err && (
          <p
            role="alert"
            className={cn(
              "mb-6 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]",
              isArabic && "font-arabic",
            )}
          >
            {err}
          </p>
        )}

        {report && (
          <>
            {/* ---------- 1. summary cards ---------- */}
            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                isArabic={isArabic}
                label={t("Rooms generated", "الغرف المولَّدة")}
                value={String(gen?.roomsGenerated ?? 0)}
                sub={t(
                  `${gen?.imagesGenerated ?? 0} images · from the render audit log`,
                  `${gen?.imagesGenerated ?? 0} صورة · من سجل التدقيق`,
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                label={t("Average overall rating", "متوسط التقييم العام")}
                value={fmt(report.averageOverall)}
                suffix="/ 5"
                sub={t(
                  "Mean of the three rated dimensions (derived)",
                  "متوسط الأبعاد الثلاثة المُقيَّمة (مشتق)",
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                label={t("Average cultural accuracy", "متوسط الدقة الثقافية")}
                value={fmt(stats?.averageCulturalAccuracy)}
                suffix="/ 5"
                sub={t(
                  `${stats?.total ?? 0} ratings`,
                  `${stats?.total ?? 0} تقييم`,
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                label={t("Average generation time", "متوسط زمن التوليد")}
                value={fmtDuration(gen?.averageSeconds ?? null)}
                sub={t(
                  `over ${gen?.sampleSize ?? 0} render${gen?.sampleSize === 1 ? "" : "s"}${
                    gen?.placeholderRunsExcluded
                      ? ` · ${gen.placeholderRunsExcluded} placeholder run${
                          gen.placeholderRunsExcluded === 1 ? "" : "s"
                        } excluded`
                      : ""
                  }`,
                  `على ${gen?.sampleSize ?? 0} عملية توليد${
                    gen?.placeholderRunsExcluded
                      ? ` · استُبعدت ${gen.placeholderRunsExcluded} تجربة`
                      : ""
                  }`,
                )}
              />
            </section>

            {/* ---------- 2. culture performance comparison ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Culture performance comparison", "مقارنة أداء الثقافات")}
              note={t(
                "Averages of real user ratings, per culture. Filters above apply to ratings; a culture with no ratings shows no bar rather than a zero.",
                "متوسطات تقييمات المستخدمين الحقيقية لكل ثقافة. الثقافة بلا تقييمات لا تظهر كصفر.",
              )}
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Overall design quality", "جودة التصميم العامة")}
                  cultures={cultures}
                  values={pick("averageImageQuality")}
                />
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Cultural accuracy", "الدقة الثقافية")}
                  cultures={cultures}
                  values={pick("averageCulturalAccuracy")}
                />
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Room preservation", "الحفاظ على الغرفة")}
                  cultures={cultures}
                  values={pick("averageRoomPreservation")}
                />
              </div>
              <div className={cn("mt-4 flex flex-wrap gap-4", isArabic && "flex-row-reverse")}>
                {cultures.map((c) => {
                  const n = byCulture[c]?.total ?? 0;
                  return (
                    <span
                      key={c}
                      className={cn("flex items-center gap-2 text-xs text-cream-muted", isArabic && "flex-row-reverse")}
                    >
                      <span className="text-cream-soft">
                        {isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c}
                      </span>
                      <span dir="ltr">
                        ({n} {t(n === 1 ? "rating" : "ratings", "تقييم")})
                      </span>
                    </span>
                  );
                })}
              </div>
              {/* Ratings on designs saved before the culture was recorded group
                  under no culture, so the per-culture counts can add up to less
                  than the overview total. Saying so beats leaving an examiner to
                  notice the arithmetic doesn't close. */}
              {unattributed > 0 && (
                <p className={cn("mt-2 text-xs text-cream-muted", isArabic && "font-arabic")}>
                  {t(
                    `${unattributed} further rating${unattributed === 1 ? "" : "s"} could not be attributed to a culture (saved before the culture was recorded), so ${unattributed === 1 ? "it is" : "they are"} counted in the overview below but not in this comparison.`,
                    `${unattributed} تقييم إضافي بلا ثقافة مُسجَّلة (حُفظ قبل تسجيل الثقافة)، لذلك يُحتسب في النظرة العامة أدناه وليس في هذه المقارنة.`,
                  )}
                </p>
              )}
            </Panel>

            {/* ---------- 3. evaluation overview ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Evaluation overview", "نظرة عامة على التقييم")}
              note={t(
                "Overall averages across every rating matching the current filters.",
                "المتوسطات الإجمالية لكل التقييمات ضمن عوامل التصفية الحالية.",
              )}
            >
              <ScoreBars
                isArabic={isArabic}
                bars={[
                  {
                    key: "quality",
                    label: t("Design quality", "جودة التصميم"),
                    value: stats?.averageImageQuality ?? null,
                  },
                  {
                    key: "cultural",
                    label: t("Cultural accuracy", "الدقة الثقافية"),
                    value: stats?.averageCulturalAccuracy ?? null,
                  },
                  {
                    key: "preservation",
                    label: t("Room preservation", "الحفاظ على الغرفة"),
                    value: stats?.averageRoomPreservation ?? null,
                  },
                ]}
              />
              <p className={cn("mt-3 text-xs text-cream-muted", isArabic && "font-arabic")}>
                {t(
                  `Based on ${stats?.total ?? 0} ratings · furniture placement judged valid ${stats?.placementValid ?? 0}×, invalid ${stats?.placementInvalid ?? 0}×`,
                  `استناداً إلى ${stats?.total ?? 0} تقييم · وضع الأثاث صحيح ${stats?.placementValid ?? 0} مرة، غير صحيح ${stats?.placementInvalid ?? 0} مرة`,
                )}
              </p>
            </Panel>

            {/* ---------- automatic metrics (only when computed) ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Automatic metrics", "المقاييس الآلية")}
              note={t(
                "SSIM / LPIPS / CLIP from eval/run_metrics.py — computed offline against the generated corpus, not by this page.",
                "مقاييس SSIM / LPIPS / CLIP من eval/run_metrics.py — تُحسب خارج التطبيق.",
              )}
            >
              {report.automatic.available ? (
                <div className="space-y-5">
                  {report.automatic.metrics.map((m) => (
                    <MetricComparison
                      key={m}
                      isArabic={isArabic}
                      noDataLabel={noData}
                      title={m.toUpperCase()}
                      cultures={report.automatic.byCulture.map((r) => r.culture)}
                      // SSIM/LPIPS/CLIP are all 0-1 scales, unlike the 1-5 ratings.
                      max={1}
                      values={Object.fromEntries(
                        report.automatic.byCulture.map((r) => [
                          r.culture,
                          (r[m] as number | null) ?? null,
                        ]),
                      )}
                    />
                  ))}
                  <p className={cn("text-xs text-cream-muted", isArabic && "font-arabic")}>
                    {t(
                      `${report.automatic.images ?? 0} images measured`,
                      `${report.automatic.images ?? 0} صورة تم قياسها`,
                    )}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-gold/20 bg-[var(--dd-surface-strong)] px-3 py-3">
                  <p className={cn("text-sm text-cream-soft", isArabic && "font-arabic")}>
                    {isArabic ? report.automatic.reason_ar : report.automatic.reason_en}
                  </p>
                  {report.automatic.hint && (
                    <p className="mt-1 font-mono text-xs text-cream-muted" dir="ltr">
                      {report.automatic.hint}
                    </p>
                  )}
                </div>
              )}
            </Panel>

            {/* ---------- 4. recent feedback ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Recent user feedback", "أحدث تقييمات المستخدمين")}
              note={t("Newest first, matching the filters above.", "الأحدث أولاً، ضمن عوامل التصفية أعلاه.")}
            >
              {report.recent.length === 0 ? (
                <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
                  {t("No ratings match these filters yet.", "لا توجد تقييمات مطابقة بعد.")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gold/20">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-[var(--dd-surface-strong)] text-start font-ui text-xs uppercase tracking-wide text-cream-muted">
                        <th className="px-3 py-2 text-start">{t("Culture", "الثقافة")}</th>
                        <th className="px-3 py-2 text-start">{t("Overall", "العام")}</th>
                        <th className="px-3 py-2 text-start">{t("Cultural", "ثقافي")}</th>
                        <th className="px-3 py-2 text-start">{t("Preservation", "الحفاظ")}</th>
                        <th className="px-3 py-2 text-start">{t("Comment", "التعليق")}</th>
                        <th className="px-3 py-2 text-start">{t("Date", "التاريخ")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recent.map((f) => {
                        const overall =
                          (f.culturalAccuracy + f.imageQuality + f.roomPreservation) / 3;
                        return (
                          <tr key={f.id} className="border-t border-gold/10 text-cream-soft">
                            <td className={cn("px-3 py-2", isArabic && "font-arabic")}>
                              {f.culture
                                ? isArabic
                                  ? CULTURE_LABEL[f.culture]?.ar ?? f.culture
                                  : CULTURE_LABEL[f.culture]?.en ?? f.culture
                                : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                              {overall.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                              {f.culturalAccuracy}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                              {f.roomPreservation}
                            </td>
                            <td className={cn("max-w-xs px-3 py-2 text-xs", isArabic && "font-arabic")}>
                              {f.comment || "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs" dir="ltr">
                              {new Date(f.createdAt * 1000).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </GalleryShell>
  );
}

/* ---------- small presentational pieces ---------- */

function SummaryCard({
  label,
  value,
  suffix,
  sub,
  isArabic,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  isArabic: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-4">
      <p className={cn("text-xs uppercase tracking-wide text-cream-muted", isArabic && "font-arabic")}>
        {label}
      </p>
      <p className="mt-2 flex items-baseline gap-1 text-2xl font-semibold text-gold" dir="ltr">
        {value}
        {suffix && <span className="text-sm text-cream-muted">{suffix}</span>}
      </p>
      {sub && (
        <p className={cn("mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>{sub}</p>
      )}
    </div>
  );
}

function Panel({
  title,
  note,
  isArabic,
  children,
}: {
  title: string;
  note?: string;
  isArabic: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-5">
      <h2
        className={cn(
          "text-lg font-semibold text-gold",
          isArabic ? "font-arabic" : "font-display",
        )}
      >
        {title}
      </h2>
      {note && (
        <p className={cn("mb-4 mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>{note}</p>
      )}
      {children}
    </section>
  );
}
