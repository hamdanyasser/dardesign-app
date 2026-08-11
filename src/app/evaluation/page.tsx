"use client";

/**
 * /evaluation — how well the system actually performs, from stored data only.
 *
 * Every number here is read from the database (saved designs, their measured
 * metrics, their ratings) or from the offline corpus in eval/results.csv.
 * Nothing is sampled, seeded or estimated: where a figure has not been measured
 * the page prints "No data" and says why. That distinction is the whole point of
 * the page — an FYP panel cannot tell a real 0.0 from a placeholder 0.0, so we
 * never print one.
 *
 * Filtering happens in SQL, not here. The page sends `culture`, `since` and
 * `until` and renders whatever comes back; it never narrows a figure it has
 * already been handed, because an average cannot be filtered after the fact.
 *
 * Admin-only, because the feedback table carries other people's comments.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Below this the recognition rate is a hint, not a result, and says so. */
const PRELIMINARY_BELOW = 12;

/** Unix seconds for the first instant of a yyyy-mm-dd, in the reader's own
 *  timezone — the same clock the dates were typed in. Blank means no bound. */
function dayStart(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(t) ? undefined : t / 1000;
}

/** The last instant of the day, not 23:59:59: the backend compares with <=, and
 *  a design saved at 23:59:59.4 is inside the day the reader asked for. */
function dayEnd(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(t) ? undefined : t / 1000;
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null ? "—" : n.toFixed(digits);
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
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

  // The filters the numbers on screen were actually computed for. Kept apart
  // from the controls so a heading can never claim a filter the data predates.
  const [applied, setApplied] = useState<{ culture: CultureFilter; from: string; to: string }>({
    culture: "all",
    from: "",
    to: "",
  });

  // Only the newest request may write to the screen. Three quick culture
  // switches fire three fetches, and without this the slowest one wins.
  const inflight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;

    setBusy(true);
    setErr(null);
    // Drop the old figures before asking for new ones. Leaving them up means a
    // slow backend shows last filter's averages under this filter's heading.
    setReport(null);
    try {
      const next = await fetchEvaluation({
        culture: culture === "all" ? undefined : culture,
        since: dayStart(from),
        until: dayEnd(to),
        limit: 25,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setReport(next);
      setApplied({ culture, from, to });
    } catch (e) {
      // A request we abandoned ourselves is not a failure to report.
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
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
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }, [culture, from, to, isArabic, t]);

  useEffect(() => {
    void load();
    return () => inflight.current?.abort();
  }, [load]);

  const cultures = report?.cultures ?? ["lebanese", "khaleeji", "moroccan"];
  const label = useCallback(
    (c: string) => (isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c),
    [isArabic],
  );

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

  // With a culture selected the comparison is that culture alone: charting the
  // other two beside a KPI strip that has already narrowed is the confusion
  // this dashboard exists to avoid.
  const shown = applied.culture === "all" ? cultures : [applied.culture];

  const pick = (field: keyof EvaluationReport["byCulture"][number]) =>
    Object.fromEntries(
      shown.map((c) => [c, (byCulture[c]?.[field] as number | null) ?? null]),
    ) as Record<string, number | null>;

  const sampleNotes = Object.fromEntries(
    shown.map((c) => {
      const n = byCulture[c]?.total ?? 0;
      return [c, n > 0 ? `/ 5 · n=${n}` : ""];
    }),
  ) as Record<string, string>;

  const stats = report?.stats;
  const gen = report?.generation;
  const cov = report?.coverage;
  const confusion = report?.confusion;
  // `report.automatic` is deliberately unread: the endpoint still computes and
  // ships the offline corpus, but the panel that displayed it is out for the
  // demo (see the note further down). Nothing else on this page depends on it.
  const noData = t("No data", "لا بيانات");

  const filterSummary = [
    applied.culture === "all" ? t("all cultures", "كل الثقافات") : label(applied.culture),
    applied.from || applied.to
      ? `${applied.from || t("start", "البداية")} → ${applied.to || t("today", "اليوم")}`
      : t("all dates", "كل التواريخ"),
  ].join(" · ");

  return (
    // Same shell as History and Others' Work: it carries the nav, the language
    // toggle and the page chrome, so this page can't drift from the rest of the app.
    <GalleryShell
      title={t("Evaluation dashboard", "لوحة التقييم")}
      subtitle={t(
        "System performance from stored data only — every saved design across all users, with its ratings and its measured metrics. Nothing on this page is sampled or estimated.",
        "أداء النظام من البيانات المخزَّنة فقط — كل تصميم محفوظ لكل المستخدمين، مع تقييماته ومقاييسه المحسوبة. لا شيء هنا مُقدَّر أو تجريبي.",
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
                    {c === "all" ? t("All cultures", "كل الثقافات") : label(c)}
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
                  max={to || undefined}
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
                  min={from || undefined}
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

          {/* What the figures below were computed for — the controls can be
              mid-edit, the data never is. */}
          {report && (
            <p
              className={cn("mt-3 text-xs text-cream-muted", isArabic && "font-arabic")}
              dir={isArabic ? "rtl" : "ltr"}
            >
              {t("Showing:", "المعروض:")} {filterSummary}
            </p>
          )}
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

        {busy && !report && (
          <p
            role="status"
            className={cn("mb-6 text-sm text-cream-muted", isArabic && "font-arabic")}
          >
            {t("Loading…", "جارٍ التحميل…")}
          </p>
        )}

        {report && (
          <>
            {/* ---------- A. system overview ---------- */}
            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                isArabic={isArabic}
                label={t("Real designs evaluated", "التصاميم الحقيقية المُقيَّمة")}
                value={String(gen?.evaluableDesigns ?? 0)}
                sub={t(
                  `${gen?.roomsGenerated ?? 0} saved · ${(gen?.editedExcluded ?? 0) + (gen?.lightExcluded ?? 0)} excluded (edited or preview)`,
                  `${gen?.roomsGenerated ?? 0} محفوظ · ${(gen?.editedExcluded ?? 0) + (gen?.lightExcluded ?? 0)} مستثنى (معدّل أو معاينة)`,
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                label={t("Average human design quality", "متوسط جودة التصميم البشري")}
                value={fmt(stats?.averageImageQuality)}
                suffix="/ 5"
                emptyValue={noData}
                sub={t(
                  `${stats?.total ?? 0} rated design${stats?.total === 1 ? "" : "s"}`,
                  `${stats?.total ?? 0} تصميم مُقيَّم`,
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                // Renamed from "cultural accuracy": what the form asks is whether
                // the room reads as its culture to a person, which is authenticity
                // as judged by a human — not an accuracy the system measured.
                label={t("Average human cultural authenticity", "متوسط الأصالة الثقافية البشرية")}
                value={fmt(stats?.averageCulturalAccuracy)}
                suffix="/ 5"
                emptyValue={noData}
                sub={t(
                  `${stats?.total ?? 0} rated design${stats?.total === 1 ? "" : "s"}`,
                  `${stats?.total ?? 0} تصميم مُقيَّم`,
                )}
              />
              <SummaryCard
                isArabic={isArabic}
                label={t("Average generation time", "متوسط زمن التوليد")}
                value={fmtDuration(gen?.averageSeconds)}
                emptyValue={noData}
                sub={t(
                  `${gen?.sampleSize ?? 0} timed generation${gen?.sampleSize === 1 ? "" : "s"} · total ${fmtDuration(gen?.totalSeconds)}`,
                  `${gen?.sampleSize ?? 0} توليد موقوت · الإجمالي ${fmtDuration(gen?.totalSeconds)}`,
                )}
              />
            </section>

            {/* Success rate is deliberately absent. Only successful designs are
                ever saved, so a rate computed from this table would be 100% by
                construction — a number that measures the storage, not the
                pipeline. Saying so beats printing it. */}
            <p className={cn("-mt-4 mb-8 text-xs text-cream-muted", isArabic && "font-arabic")}>
              {t(
                "Generation success rate is not shown: only completed designs are stored, so any rate computed from them would be 100% by construction. Failures are visible in the render audit log.",
                "معدّل نجاح التوليد غير معروض: لا تُحفظ إلا التصاميم المكتملة، فأي نسبة تُحسب منها ستكون 100% بحكم التعريف. الإخفاقات مسجّلة في سجل التدقيق.",
              )}
            </p>

            {/* ---------- B. human evaluation ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Human evaluation", "التقييم البشري")}
              note={t(
                "Real user ratings on a fixed 0–5 scale, per culture, inside the current filters. A culture nobody has rated shows “No data” — on a 1–5 scale a zero is unreachable, so printing one would invent a result.",
                "تقييمات المستخدمين الحقيقية على مقياس ثابت 0–5 لكل ثقافة ضمن عوامل التصفية الحالية. الثقافة بلا تقييمات تظهر «لا بيانات» — الصفر مستحيل على مقياس 1–5.",
              )}
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Cultural authenticity", "الأصالة الثقافية")}
                  cultures={shown}
                  values={pick("averageCulturalAccuracy")}
                  notes={sampleNotes}
                />
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Design quality", "جودة التصميم")}
                  cultures={shown}
                  values={pick("averageImageQuality")}
                  notes={sampleNotes}
                />
                <MetricComparison
                  isArabic={isArabic}
                  noDataLabel={noData}
                  title={t("Room preservation", "الحفاظ على الغرفة")}
                  cultures={shown}
                  values={pick("averageRoomPreservation")}
                  notes={sampleNotes}
                />
              </div>

              <div className="mt-5 border-t border-gold/15 pt-4">
                <h4
                  className={cn(
                    "mb-2 text-xs font-medium uppercase tracking-wide text-cream-muted",
                    isArabic && "font-arabic",
                  )}
                >
                  {t("Across every rating in these filters", "عبر كل التقييمات ضمن التصفية")}
                </h4>
                <ScoreBars
                  isArabic={isArabic}
                  emptyLabel={noData}
                  bars={[
                    {
                      key: "cultural",
                      label: t("Cultural authenticity", "الأصالة الثقافية"),
                      value: stats?.averageCulturalAccuracy ?? null,
                      note: stats?.total ? `/ 5 · n=${stats.total}` : undefined,
                    },
                    {
                      key: "quality",
                      label: t("Design quality", "جودة التصميم"),
                      value: stats?.averageImageQuality ?? null,
                      note: stats?.total ? `/ 5 · n=${stats.total}` : undefined,
                    },
                    {
                      key: "preservation",
                      label: t("Room preservation", "الحفاظ على الغرفة"),
                      value: stats?.averageRoomPreservation ?? null,
                      note: stats?.total ? `/ 5 · n=${stats.total}` : undefined,
                    },
                  ]}
                />
                <p className={cn("mt-3 text-xs text-cream-muted", isArabic && "font-arabic")}>
                  {t(
                    `Overall (mean of the three, derived): ${report.averageOverall == null ? noData : fmt(report.averageOverall)} · furniture placement judged valid ${stats?.placementValid ?? 0}×, invalid ${stats?.placementInvalid ?? 0}×`,
                    `العام (متوسط الثلاثة، مشتق): ${report.averageOverall == null ? noData : fmt(report.averageOverall)} · وضع الأثاث صحيح ${stats?.placementValid ?? 0} مرة، غير صحيح ${stats?.placementInvalid ?? 0} مرة`,
                  )}
                </p>
              </div>

              {/* Ratings on designs saved before the culture was recorded group
                  under no culture, so the per-culture counts can add up to less
                  than the overview total. Saying so beats leaving an examiner to
                  notice the arithmetic doesn't close. */}
              {unattributed > 0 && (
                <p className={cn("mt-2 text-xs text-cream-muted", isArabic && "font-arabic")}>
                  {t(
                    `${unattributed} further rating${unattributed === 1 ? "" : "s"} could not be attributed to a culture (saved before the culture was recorded), so ${unattributed === 1 ? "it is" : "they are"} counted in the overall figures but not in the per-culture comparison.`,
                    `${unattributed} تقييم إضافي بلا ثقافة مُسجَّلة (حُفظ قبل تسجيل الثقافة)، لذلك يُحتسب في الأرقام العامة وليس في المقارنة لكل ثقافة.`,
                  )}
                </p>
              )}
            </Panel>

            {/* ---------- C. automatic model evaluation ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Automatic model evaluation", "التقييم الآلي للنموذج")}
              note={t(
                "Measured on every saved design — no opinion involved. Three different scales and three different directions: they are not comparable to each other and none of them is a score out of five.",
                "تُقاس على كل تصميم محفوظ دون أي رأي بشري. ثلاثة مقاييس مختلفة باتجاهات مختلفة — لا تُقارن ببعضها وليست درجات من خمسة.",
              )}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MetricCard
                  isArabic={isArabic}
                  emptyValue={noData}
                  title={t("Structure preservation", "الحفاظ على البنية")}
                  metric="SSIM"
                  value={gen?.averageSsim}
                  digits={3}
                  n={gen?.ssimSampleSize ?? 0}
                  reading={t(
                    "Higher = more of the room's structure survived the redesign. 0–1.",
                    "الأعلى = بقاء أكبر لبنية الغرفة بعد إعادة التصميم. 0–1.",
                  )}
                />
                <MetricCard
                  isArabic={isArabic}
                  emptyValue={noData}
                  title={t("Perceptual change", "التغيّر الإدراكي")}
                  metric="LPIPS"
                  value={gen?.averageLpips}
                  digits={3}
                  n={gen?.lpipsSampleSize ?? 0}
                  reading={t(
                    "Larger = greater perceptual change from the input photo. Not better or worse on its own — a redesign is supposed to change the room.",
                    "الأكبر = تغيّر إدراكي أكبر عن الصورة الأصلية. ليس أفضل ولا أسوأ بذاته — فإعادة التصميم يُفترض أن تغيّر الغرفة.",
                  )}
                />
                <MetricCard
                  isArabic={isArabic}
                  emptyValue={noData}
                  title={t("Cultural similarity", "التشابه الثقافي")}
                  metric="CLIP"
                  value={gen?.averageClipScore}
                  digits={3}
                  n={gen?.clipSampleSize ?? 0}
                  reading={t(
                    "Higher = stronger similarity to the intended culture's prompt.",
                    "الأعلى = تشابه أقوى مع وصف الثقافة المطلوبة.",
                  )}
                />
              </div>
              <p className={cn("mt-3 text-xs text-cream-muted", isArabic && "font-arabic")}>
                {t(
                  `Over ${gen?.evaluableDesigns ?? 0} unedited, non-preview design${gen?.evaluableDesigns === 1 ? "" : "s"}. Colour and furniture edits measure the edit rather than the pipeline, and preview-mode placeholders were never rendered by a model, so both are excluded.`,
                  `على ${gen?.evaluableDesigns ?? 0} تصميم غير معدَّل وغير معاينة. التعديلات اللونية والأثاث تقيس التعديل لا النموذج، وتصاميم المعاينة لم يولّدها نموذج — لذلك تُستثنى.`,
                )}
              </p>
            </Panel>

            {/* ---------- D. CLIP zero-shot recognition matrix ---------- */}
            <Panel
              isArabic={isArabic}
              title={t(
                "CLIP zero-shot cultural recognition matrix",
                "مصفوفة التعرّف الثقافي بـ CLIP (بدون تدريب)",
              )}
              note={t(
                "Rows: the culture the design was generated as. Columns: the culture CLIP recognises it as, with no training on our data. This is a model's reading of the image, not a human judgement of authenticity — the human figures are in the section above.",
                "الصفوف: الثقافة المطلوبة. الأعمدة: ما تعرّف عليه CLIP دون تدريب على بياناتنا. هذه قراءة نموذج للصورة وليست حكماً بشرياً على الأصالة.",
              )}
            >
              {confusion && confusion.total > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-xl border border-gold/20">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-[var(--dd-surface-strong)] text-xs uppercase tracking-wide text-cream-muted">
                          <th className="px-3 py-2 text-start">
                            {t("Generated as ↓ / CLIP reads →", "المطلوب ↓ / قراءة CLIP ←")}
                          </th>
                          {cultures.map((c) => (
                            <th key={c} className="px-3 py-2 text-center">
                              {label(c)}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-center">{t("Row n", "عدد الصف")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row) => {
                          const rowTotal = confusion.rowTotals?.[row] ?? 0;
                          return (
                            <tr key={row} className="border-t border-gold/10 text-cream-soft">
                              <td className={cn("px-3 py-2", isArabic && "font-arabic")}>
                                {label(row)}
                              </td>
                              {cultures.map((col) => {
                                const n = confusion.matrix?.[row]?.[col] ?? 0;
                                return (
                                  <td
                                    key={col}
                                    className={cn(
                                      "whitespace-nowrap px-3 py-2 text-center font-mono text-xs",
                                      // The diagonal is the answer; make it readable at a glance.
                                      row === col && n > 0 && "bg-gold/15 font-bold text-gold",
                                      n === 0 && "text-cream-muted",
                                    )}
                                    dir="ltr"
                                  >
                                    {/* Counts alone hide the denominator: 2 out
                                        of 3 and 2 out of 20 are different results. */}
                                    {rowTotal > 0 ? `${n} (${pct(n, rowTotal)})` : n}
                                  </td>
                                );
                              })}
                              <td
                                className="px-3 py-2 text-center font-mono text-xs text-cream-muted"
                                dir="ltr"
                              >
                                {rowTotal || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className={cn("mt-3 text-sm text-cream-soft", isArabic && "font-arabic")} dir={isArabic ? "rtl" : "ltr"}>
                    {t("Recognition:", "التعرّف:")}{" "}
                    <span className="font-mono text-gold" dir="ltr">
                      {confusion.correct}/{confusion.total} ({pct(confusion.correct, confusion.total)})
                    </span>
                  </p>
                  {confusion.total < PRELIMINARY_BELOW && (
                    <p className={cn("mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>
                      {t(
                        "Preliminary result — limited evaluation sample.",
                        "نتيجة أولية — حجم العيّنة محدود.",
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p className={cn("text-xs text-cream-muted", isArabic && "font-arabic")}>
                  {t(
                    "No design in these filters has been classified yet. Save a generation — or run scripts/backfill_evaluation.py for existing ones.",
                    "لم يُصنَّف أي تصميم ضمن هذه التصفية بعد. احفظ تصميماً جديداً أو شغّل scripts/backfill_evaluation.py للتصاميم السابقة.",
                  )}
                </p>
              )}
            </Panel>

            {/* ---------- E. evaluation coverage ---------- */}
            <Panel
              isArabic={isArabic}
              title={t("Evaluation coverage", "تغطية التقييم")}
              note={t(
                "How many of the designs behind the model metrics above — the unedited, non-preview ones — actually carry each measurement. Two averages printed side by side look equally well supported until you can see that one rests on six samples and the other on four. The human-rating count can be lower than the rating totals above, which also include edited designs.",
                "كم من التصاميم التي تقوم عليها المقاييس أعلاه — غير المعدَّلة وغير المعاينة — يحمل فعلاً كل قياس. متوسطان متجاوران يبدوان متساويي الوثوق حتى تعرف أن أحدهما مبني على ستّ عيّنات والآخر على أربع. عدد التقييمات هنا قد يقلّ عن الإجمالي أعلاه، الذي يشمل التصاميم المعدَّلة أيضاً.",
              )}
            >
              {cov && cov.total > 0 ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  <CoverageRow isArabic={isArabic} label="SSIM" have={cov.ssim} total={cov.total} />
                  <CoverageRow isArabic={isArabic} label="LPIPS" have={cov.lpips} total={cov.total} />
                  <CoverageRow isArabic={isArabic} label="CLIP" have={cov.clip} total={cov.total} />
                  <CoverageRow
                    isArabic={isArabic}
                    label={t("CLIP prediction", "تصنيف CLIP")}
                    have={cov.predicted}
                    total={cov.total}
                  />
                  <CoverageRow
                    isArabic={isArabic}
                    label={t("Human ratings", "التقييمات البشرية")}
                    have={cov.rated}
                    total={cov.total}
                  />
                  <CoverageRow
                    isArabic={isArabic}
                    label={t("Timing", "التوقيت")}
                    have={cov.timed}
                    total={cov.total}
                  />
                </div>
              ) : (
                <p className={cn("text-xs text-cream-muted", isArabic && "font-arabic")}>
                  {t(
                    "No designs match these filters, so there is nothing to cover.",
                    "لا توجد تصاميم مطابقة لهذه التصفية.",
                  )}
                </p>
              )}
            </Panel>

            {/* The "LoRA impact — ablation study" panel sat here and is removed
                for the demo. Nothing behind it was deleted: the endpoint still
                serves `automatic` (both arms split by set, with deltas and the
                per-arm recognition rate) from eval/run_metrics.py, and the
                typed `AutomaticMetrics` / `Ablation` shapes are still in
                src/lib/api.ts. It was pulled because the corpus has not been
                rendered yet, so the only thing it could truthfully show was an
                empty "not generated yet" box — and a panel whose sole state is
                "nothing here" reads as unfinished work rather than as an
                honest absence. Restoring it is a paste job once
                eval/results.csv exists; see the Ablation component in git
                history at this path. */}

            {/* ---------- recent feedback ---------- */}
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
                        <th className="px-3 py-2 text-start">{t("Authenticity", "الأصالة")}</th>
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
                              {f.culture ? label(f.culture) : "—"}
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
  emptyValue,
  isArabic,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  /** Printed instead of the value (and its suffix) when nothing was measured. */
  emptyValue?: string;
  isArabic: boolean;
}) {
  const empty = value === "—";
  return (
    <div className="rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-4">
      <p className={cn("text-xs uppercase tracking-wide text-cream-muted", isArabic && "font-arabic")}>
        {label}
      </p>
      {empty && emptyValue ? (
        <p className={cn("mt-2 text-2xl font-semibold text-cream-muted", isArabic && "font-arabic")}>
          {emptyValue}
        </p>
      ) : (
        <p className="mt-2 flex items-baseline gap-1 text-2xl font-semibold text-gold" dir="ltr">
          {value}
          {suffix && <span className="text-sm text-cream-muted">{suffix}</span>}
        </p>
      )}
      {sub && (
        <p className={cn("mt-1 text-xs text-cream-muted", isArabic && "font-arabic")}>{sub}</p>
      )}
    </div>
  );
}

/** One automatic metric, with the direction it should be read in.
 *  SSIM, LPIPS and CLIP live on different scales and point different ways; a
 *  row of bars would suggest they can be compared, and that a bigger LPIPS is
 *  a worse system. */
function MetricCard({
  title,
  metric,
  value,
  digits,
  n,
  reading,
  emptyValue,
  isArabic,
}: {
  title: string;
  metric: string;
  value: number | null | undefined;
  digits: number;
  n: number;
  reading: string;
  emptyValue: string;
  isArabic: boolean;
}) {
  return (
    <div className="rounded-xl border border-gold/15 bg-[var(--dd-surface-strong)] p-4">
      <div className={cn("flex items-baseline justify-between gap-2", isArabic && "flex-row-reverse")}>
        <p className={cn("text-xs uppercase tracking-wide text-cream-muted", isArabic && "font-arabic")}>
          {title}
        </p>
        <span className="font-mono text-[10px] uppercase text-gold/70">{metric}</span>
      </div>
      <p
        className={cn(
          "mt-2 flex items-baseline gap-2 text-2xl font-semibold",
          value == null ? "text-cream-muted" : "text-gold",
        )}
        dir="ltr"
      >
        {value == null ? <span className="text-xl">{emptyValue}</span> : value.toFixed(digits)}
        <span className="font-mono text-xs text-cream-muted">n={n}</span>
      </p>
      <p className={cn("mt-2 text-xs leading-relaxed text-cream-muted", isArabic && "font-arabic")}>
        {reading}
      </p>
    </div>
  );
}

function CoverageRow({
  label,
  have,
  total,
  isArabic,
}: {
  label: string;
  have: number;
  total: number;
  isArabic: boolean;
}) {
  const complete = have === total;
  return (
    <div className={cn("flex items-center gap-3 py-1", isArabic && "flex-row-reverse")}>
      <span className={cn("w-32 shrink-0 text-xs text-cream-soft", isArabic ? "text-right font-arabic" : "text-left font-ui")}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--dd-surface-strong)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${total > 0 ? (have / total) * 100 : 0}%`,
            background: complete ? "var(--dd-gold)" : "var(--dd-gold-dim)",
          }}
        />
      </div>
      <span
        className={cn(
          "w-14 shrink-0 font-mono text-xs",
          complete ? "text-gold" : "text-cream-muted",
          isArabic ? "text-left" : "text-right",
        )}
        dir="ltr"
      >
        {have}/{total}
      </span>
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
        <p className={cn("mb-4 mt-1 text-xs leading-relaxed text-cream-muted", isArabic && "font-arabic")}>
          {note}
        </p>
      )}
      {children}
    </section>
  );
}
