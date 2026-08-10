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
 * Organised as a drawing-sheet reads: 01 the human judgement, 02 the objective
 * image-quality measurements, 03 whether CLIP recognises what was asked for,
 * 04 the operational numbers behind it. Same data as before — this file only
 * changed how it's grouped and drawn.
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
  const confusion = report?.confusion;
  const noData = t("Not measured yet", "لم يُقَس بعد");
  const isEmpty = (gen?.roomsGenerated ?? 0) === 0 && (stats?.total ?? 0) === 0;

  return (
    // Same shell as History and Others' Work: it carries the nav, the language
    // toggle and the page chrome, so this page can't drift from the rest of the app.
    <GalleryShell
      title={t("Evaluation", "التقييم")}
      subtitle={t(
        "System performance from stored data only — every saved design across all users, with its ratings and its measured metrics. Nothing on this page is sampled or estimated.",
        "أداء النظام من البيانات المخزَّنة فقط — كل تصميم محفوظ لكل المستخدمين، مع تقييماته ومقاييسه المحسوبة. لا شيء هنا مُقدَّر أو تجريبي.",
      )}
      eyebrow={
        report
          ? t(
              `${gen?.roomsGenerated ?? 0} GENERATED · ${stats?.total ?? 0} RATED`,
              `${gen?.roomsGenerated ?? 0} تصميم · ${stats?.total ?? 0} تقييم`,
            )
          : undefined
      }
    >
      <div>
        {/* ---------- filters ---------- */}
        <div className={cn("mb-8 flex flex-wrap items-end gap-5 border-b border-[var(--dd-border)] pb-6", isArabic && "flex-row-reverse")}>
          <div>
            <span className="font-editorial-mono mb-2 block text-[9px] text-[var(--dd-text-secondary)]">
              {t("Culture", "الثقافة")}
            </span>
            <div className={cn("flex flex-wrap gap-1.5", isArabic && "flex-row-reverse")}>
              {(["all", ...cultures] as CultureFilter[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCulture(c)}
                  aria-pressed={culture === c}
                  className={cn(
                    "font-editorial-mono rounded-[2px] border px-2.5 py-1.5 text-[10px] transition",
                    culture === c
                      ? "border-[var(--dd-gold)] text-[var(--dd-gold)]"
                      : "border-[var(--dd-border)] text-[var(--dd-text-secondary)] hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]",
                  )}
                >
                  {c === "all"
                    ? t("ALL", "الكل")
                    : (isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className={cn("flex items-end gap-2", isArabic && "flex-row-reverse")}>
            <label className="block">
              <span className="font-editorial-mono mb-2 block text-[9px] text-[var(--dd-text-secondary)]">
                {t("From", "من")}
              </span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="font-editorial-mono h-[34px] border-0 border-b border-[var(--dd-border)] bg-transparent px-1 text-xs text-[var(--dd-text)] outline-none focus:border-[var(--dd-gold)]"
              />
            </label>
            <label className="block">
              <span className="font-editorial-mono mb-2 block text-[9px] text-[var(--dd-text-secondary)]">
                {t("To", "إلى")}
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="font-editorial-mono h-[34px] border-0 border-b border-[var(--dd-border)] bg-transparent px-1 text-xs text-[var(--dd-text)] outline-none focus:border-[var(--dd-gold)]"
              />
            </label>
            {(from || to || culture !== "all") && (
              <button
                onClick={() => {
                  setCulture("all");
                  setFrom("");
                  setTo("");
                }}
                className="font-editorial-mono rounded-[2px] border border-[var(--dd-border)] px-2.5 py-1.5 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]"
              >
                {t("CLEAR", "مسح")}
              </button>
            )}
          </div>

          <button
            onClick={() => void load()}
            disabled={busy}
            className={cn(
              "font-editorial-mono flex items-center gap-1.5 rounded-[2px] border border-[var(--dd-gold)] px-2.5 py-1.5 text-[10px] text-[var(--dd-gold)] transition hover:bg-[var(--dd-gold)] hover:text-[var(--dd-ink)] disabled:opacity-50",
              isArabic && "flex-row-reverse",
            )}
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
            {t("REFRESH", "تحديث")}
          </button>
        </div>

        {err && (
          <p
            role="alert"
            className={cn("mb-6 border-s-2 border-[var(--error)] ps-3 text-sm text-[var(--error)]", isArabic && "font-arabic")}
          >
            {err}
          </p>
        )}

        {report && (
          <>
            {/* Dataset-empty banner. With nothing saved yet every figure on this
                page is correctly a "—", which reads as broken rather than as
                "not measured yet". This states the reason once, at the top, so
                the dashes below are understood as pending measurement. It is
                shown ONLY when the dataset is genuinely empty, and it invents
                no numbers — it explains absence, it does not fill it. */}
            {isEmpty && (
              <section
                className={cn(
                  "mb-10 border-s-2 border-[var(--dd-gold)] ps-4",
                  isArabic ? "text-right font-arabic" : "text-left font-ui",
                )}
              >
                <h2 className="font-editorial-mono text-[10px] text-[var(--dd-gold)]">
                  {t("NO MEASUREMENTS YET", "لا توجد قياسات بعد")}
                </h2>
                <p className="mt-1.5 text-sm text-[var(--dd-text-soft)]">
                  {t(
                    "Every figure below is shown as “—” because nothing has been measured yet, not because a value is zero.",
                    "كل رقم في الأسفل يظهر كـ «—» لأنه لم يُقَس بعد، وليس لأن قيمته صفر.",
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--dd-text-secondary)]">
                  {t(
                    "The dataset is the saved designs: save a generation to record SSIM, then LPIPS and CLIP, and rate it to populate the user-rating and cultural-accuracy figures.",
                    "مجموعة البيانات هي التصاميم المحفوظة: احفظ تصميماً لتسجيل SSIM ثم LPIPS و CLIP، وقيّمه لتعبئة أرقام تقييم المستخدمين والدقة الثقافية.",
                  )}
                </p>
              </section>
            )}

            {/* ================= 01 — USER EVALUATION ================= */}
            <Section
              isArabic={isArabic}
              number="01"
              title={t("User evaluation", "تقييم المستخدمين")}
              note={t(
                "What people who saw the result actually said, on the 1–5 scale the rating form asks.",
                "ما قاله من رأوا النتيجة فعلاً، على مقياس ١–٥ الذي تطلبه استمارة التقييم.",
              )}
            >
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
                <Stat
                  isArabic={isArabic}
                  label={t("Overall rating", "التقييم العام")}
                  value={fmt(report.averageOverall)}
                  suffix="/ 5"
                  sub={t("Mean of the three dimensions", "متوسط الأبعاد الثلاثة")}
                />
                <Stat
                  isArabic={isArabic}
                  label={t("Cultural accuracy", "الدقة الثقافية")}
                  value={fmt(stats?.averageCulturalAccuracy)}
                  suffix="/ 5"
                  sub={t(`${stats?.total ?? 0} ratings`, `${stats?.total ?? 0} تقييم`)}
                />
                <Stat
                  isArabic={isArabic}
                  label={t("Furniture placement", "وضع الأثاث")}
                  value={`${stats?.placementValid ?? 0} / ${stats?.placementInvalid ?? 0}`}
                  sub={t("valid / invalid, judged", "صحيح / غير صحيح، مُحكَّم")}
                />
                <Stat
                  isArabic={isArabic}
                  label={t("Ratings recorded", "التقييمات المسجّلة")}
                  value={String(stats?.total ?? 0)}
                  sub={t("matching current filters", "ضمن عوامل التصفية الحالية")}
                />
              </div>

              <h3 className="font-editorial-mono mt-8 mb-3 text-[9px] text-[var(--dd-text-secondary)]">
                {t("BY CULTURE", "حسب الثقافة")}
              </h3>
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
                      className={cn("font-editorial-mono flex items-center gap-1.5 text-[10px] text-[var(--dd-text-secondary)]", isArabic && "flex-row-reverse")}
                    >
                      <span className="text-[var(--dd-text-soft)]">
                        {(isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c).toUpperCase()}
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
                <p className={cn("mt-2 text-xs text-[var(--dd-text-secondary)]", isArabic && "font-arabic")}>
                  {t(
                    `${unattributed} further rating${unattributed === 1 ? "" : "s"} could not be attributed to a culture (saved before the culture was recorded), so ${unattributed === 1 ? "it is" : "they are"} counted above but not in this comparison.`,
                    `${unattributed} تقييم إضافي بلا ثقافة مُسجَّلة (حُفظ قبل تسجيل الثقافة)، لذلك يُحتسب أعلاه وليس في هذه المقارنة.`,
                  )}
                </p>
              )}

              <h3 className="font-editorial-mono mt-8 mb-3 text-[9px] text-[var(--dd-text-secondary)]">
                {t("OVERALL, ALL CULTURES", "الإجمالي، كل الثقافات")}
              </h3>
              <ScoreBars
                isArabic={isArabic}
                bars={[
                  { key: "quality", label: t("Design quality", "جودة التصميم"), value: stats?.averageImageQuality ?? null },
                  { key: "cultural", label: t("Cultural accuracy", "الدقة الثقافية"), value: stats?.averageCulturalAccuracy ?? null },
                  { key: "preservation", label: t("Room preservation", "الحفاظ على الغرفة"), value: stats?.averageRoomPreservation ?? null },
                ]}
              />

              <h3 className="font-editorial-mono mt-8 mb-3 text-[9px] text-[var(--dd-text-secondary)]">
                {t("RECENT FEEDBACK", "أحدث التقييمات")}
              </h3>
              {report.recent.length === 0 ? (
                <p className={cn("text-sm text-[var(--dd-text-secondary)]", isArabic && "font-arabic")}>
                  {t("No ratings match these filters yet.", "لا توجد تقييمات مطابقة بعد.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] border-collapse text-sm" dir={isArabic ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="border-b border-[var(--dd-border)] bg-[var(--dd-text)]/[0.025]">
                        <Th>{t("Culture", "الثقافة")}</Th>
                        <Th>{t("Overall", "العام")}</Th>
                        <Th>{t("Cultural", "ثقافي")}</Th>
                        <Th>{t("Preservation", "الحفاظ")}</Th>
                        <Th>{t("Comment", "التعليق")}</Th>
                        <Th>{t("Date", "التاريخ")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recent.map((f) => {
                        const overall = (f.culturalAccuracy + f.imageQuality + f.roomPreservation) / 3;
                        return (
                          <tr key={f.id} className="border-b border-[var(--dd-border)] text-[var(--dd-text-soft)]">
                            <Td>
                              <span className={isArabic ? "font-arabic" : undefined}>
                                {f.culture
                                  ? isArabic
                                    ? CULTURE_LABEL[f.culture]?.ar ?? f.culture
                                    : CULTURE_LABEL[f.culture]?.en ?? f.culture
                                  : "—"}
                              </span>
                            </Td>
                            <Td mono>{overall.toFixed(2)}</Td>
                            <Td mono>{f.culturalAccuracy}</Td>
                            <Td mono>{f.roomPreservation}</Td>
                            <Td>
                              <span className={cn("block max-w-xs truncate text-xs", isArabic && "font-arabic")}>
                                {f.comment || "—"}
                              </span>
                            </Td>
                            <Td mono>{new Date(f.createdAt * 1000).toLocaleDateString()}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* ================= 02 — IMAGE QUALITY ================= */}
            <Section
              isArabic={isArabic}
              number="02"
              title={t("Image quality", "جودة الصورة")}
              note={t(
                "Objective, not rated — computed once per saved design (edited designs excluded, since colour/furniture edits would measure the edit, not the pipeline).",
                "مقاييس موضوعية غير مُقيَّمة — تُحسب مرة لكل تصميم محفوظ (تُستثنى التصاميم المعدَّلة، لأن التعديل يقيس نفسه لا الأنبوب).",
              )}
            >
              <ScoreBars
                isArabic={isArabic}
                max={1}
                bars={[
                  {
                    key: "ssim",
                    label: t("Structure (SSIM)", "الحفاظ على البنية"),
                    value: gen?.averageSsim ?? null,
                    note: t(`↑ n=${gen?.ssimSampleSize ?? 0}`, `↑ ن=${gen?.ssimSampleSize ?? 0}`),
                  },
                  {
                    key: "lpips",
                    label: t("Perceptual (LPIPS)", "المسافة الإدراكية"),
                    value: gen?.averageLpips ?? null,
                    note: t(`↓ n=${gen?.lpipsSampleSize ?? 0}`, `↓ ن=${gen?.lpipsSampleSize ?? 0}`),
                  },
                  {
                    key: "clip",
                    label: t("Style match (CLIP)", "مطابقة الطراز"),
                    value: gen?.averageClipScore ?? null,
                    note: t(`↑ n=${gen?.clipSampleSize ?? 0}`, `↑ ن=${gen?.clipSampleSize ?? 0}`),
                  },
                ]}
              />
              <p className={cn("mt-3 text-xs text-[var(--dd-text-secondary)]", isArabic && "font-arabic")}>
                {t(
                  "SSIM ↑ the room's layout survived · LPIPS ↓ perceptually close to the input · CLIP ↑ looks like the culture it was asked for.",
                  "SSIM ↑ بقي مخطط الغرفة · LPIPS ↓ قريب إدراكياً من الأصل · CLIP ↑ يشبه الثقافة المطلوبة.",
                )}
              </p>
            </Section>

            {/* ================= 03 — CULTURAL CLASSIFICATION ================= */}
            <Section
              isArabic={isArabic}
              number="03"
              title={t("Cultural classification", "التصنيف الثقافي")}
              note={t(
                "Rows: the culture the design was generated as. Columns: the culture CLIP recognises it as. A strong diagonal means the three read as distinct.",
                "الصفوف: الثقافة المطلوبة. الأعمدة: ما تعرّف عليه CLIP. القطر القوي يعني أن الثقافات الثلاث مميّزة.",
              )}
            >
              {confusion && confusion.total > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm" dir={isArabic ? "rtl" : "ltr"}>
                      <thead>
                        <tr className="border-b border-[var(--dd-border)] bg-[var(--dd-text)]/[0.025]">
                          <Th>{t("Intended ↓ / CLIP →", "المطلوب ↓ / CLIP ←")}</Th>
                          {cultures.map((c) => (
                            <th key={c} className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-center text-[9.5px] text-[var(--dd-text-secondary)]">
                              {(isArabic ? CULTURE_LABEL[c]?.ar ?? c : CULTURE_LABEL[c]?.en ?? c).toUpperCase()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cultures.map((row) => (
                          <tr key={row} className="border-b border-[var(--dd-border)] text-[var(--dd-text-soft)]">
                            <Td>
                              <span className={isArabic ? "font-arabic" : undefined}>
                                {isArabic ? CULTURE_LABEL[row]?.ar ?? row : CULTURE_LABEL[row]?.en ?? row}
                              </span>
                            </Td>
                            {cultures.map((col) => {
                              const n = confusion.matrix?.[row]?.[col] ?? 0;
                              return (
                                <td
                                  key={col}
                                  className={cn(
                                    "font-editorial-mono px-4 py-3 text-center text-xs",
                                    row === col && n > 0 && "font-bold text-[var(--dd-gold)]",
                                    n === 0 && "text-[var(--dd-text-secondary)]",
                                  )}
                                >
                                  {n}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={cn("mt-3 text-xs text-[var(--dd-text-secondary)]", isArabic && "font-arabic")}>
                    {t(
                      `3-way accuracy: ${((confusion.accuracy ?? 0) * 100).toFixed(0)}% — CLIP identified the intended culture in ${confusion.correct} of ${confusion.total} saved designs.`,
                      `دقة التصنيف الثلاثي: ${((confusion.accuracy ?? 0) * 100).toFixed(0)}% — تعرّف CLIP على الثقافة المطلوبة في ${confusion.correct} من ${confusion.total} تصميم.`,
                    )}
                  </p>
                </>
              ) : (
                <p className={cn("text-xs text-[var(--dd-text-secondary)]", isArabic && "font-arabic")}>
                  {t(
                    "No design has been classified yet. Save a generation — or run scripts/backfill_evaluation.py for existing ones.",
                    "لم يُصنَّف أي تصميم بعد. احفظ تصميماً جديداً أو شغّل scripts/backfill_evaluation.py للتصاميم السابقة.",
                  )}
                </p>
              )}
            </Section>

            {/* ================= 04 — SYSTEM ================= */}
            <Section
              isArabic={isArabic}
              number="04"
              title={t("System", "النظام")}
              note={t(
                "Operational figures over the history table — how many rooms, and how long they took.",
                "أرقام تشغيلية من سجل التصاميم — عدد الغرف والوقت الذي استغرقته.",
              )}
              last
            >
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
                <Stat
                  isArabic={isArabic}
                  label={t("Rooms generated", "الغرف المولَّدة")}
                  value={String(gen?.roomsGenerated ?? 0)}
                  sub={t("Saved designs in history", "التصاميم المحفوظة")}
                />
                <Stat
                  isArabic={isArabic}
                  label={t("Average generation time", "متوسط زمن التوليد")}
                  value={fmtDuration(gen?.averageSeconds ?? null)}
                  sub={t(`over ${gen?.sampleSize ?? 0} timed`, `على ${gen?.sampleSize ?? 0} موقوت`)}
                />
                <Stat
                  isArabic={isArabic}
                  label={t("Total generation time", "إجمالي زمن التوليد")}
                  value={fmtDuration(gen?.totalSeconds ?? null)}
                  sub={t("across every timed design", "على كل التصاميم الموقوتة")}
                />
              </div>
            </Section>
          </>
        )}
      </div>
    </GalleryShell>
  );
}

/* ---------- small presentational pieces ---------- */

function Stat({
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
    <div>
      <p className={cn("font-editorial-mono text-[9px] text-[var(--dd-text-secondary)]", isArabic && "text-right")}>
        {label}
      </p>
      <p className="font-editorial-mono mt-1.5 flex items-baseline gap-1 text-[1.6rem] text-[var(--dd-gold)]" dir="ltr">
        {value}
        {suffix && <span className="text-xs text-[var(--dd-text-secondary)]">{suffix}</span>}
      </p>
      {sub && (
        <p className={cn("mt-0.5 text-xs text-[var(--dd-text-secondary)]", isArabic && "text-right font-arabic")}>{sub}</p>
      )}
    </div>
  );
}

function Section({
  number,
  title,
  note,
  isArabic,
  last,
  children,
}: {
  number: string;
  title: string;
  note?: string;
  isArabic: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("mb-10 border-b border-[var(--dd-border)] pb-10", last && "border-b-0 pb-0")}>
      <div className={cn("flex items-baseline gap-3", isArabic && "flex-row-reverse")}>
        <span className="font-editorial-mono text-[10px] text-[var(--dd-gold)]">{number}</span>
        <h2
          className={cn(
            "text-[1.6rem] leading-none text-[var(--dd-text)]",
            isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
          )}
        >
          {title}
        </h2>
      </div>
      {note && (
        <p className={cn("mt-2 max-w-[70ch] text-xs text-[var(--dd-text-secondary)]", isArabic && "text-right font-arabic")}>
          {note}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-start text-[9.5px] text-[var(--dd-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={cn("px-4 py-3 align-top", mono && "font-editorial-mono text-xs")} dir={mono ? "ltr" : undefined}>
      {children}
    </td>
  );
}
