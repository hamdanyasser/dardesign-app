"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import GalleryShell from "@/components/GalleryShell";
import { CULTURE_COLOR, CULTURE_LABEL } from "@/components/EvaluationChart";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  fetchAdminUsers,
  fetchEvaluation,
  fetchSubscriptionRequests,
  type AdminUserRow,
  type EvaluationReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const PRELIMINARY_BELOW = 12;

function dayStart(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(t) ? undefined : t / 1000;
}

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

export default function AdminAnalyticsPage() {
  const { isArabic } = useThemeLanguage();
  const t = useCallback(
    (en: string, ar: string) => (isArabic ? ar : en),
    [isArabic],
  );

  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [pendingQueue, setPendingQueue] = useState<number | null>(null);
  const [culture, setCulture] = useState<"all" | string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [evaluation, adminUsers, requests] = await Promise.all([
        fetchEvaluation({
          culture: culture === "all" ? undefined : culture,
          since: dayStart(from),
          until: dayEnd(to),
          limit: 25,
        }),
        fetchAdminUsers(),
        fetchSubscriptionRequests("pending"),
      ]);
      setReport(evaluation);
      setUsers(adminUsers.users);
      setPendingQueue(requests.pendingCount);
    } catch (e) {
      const status = e instanceof ApiError ? e.http_status : 0;
      setError(
        status === 403
          ? t("This page is admin-only.", "هذه الصفحة للمشرف فقط.")
          : status === 401
            ? t("Sign in with an admin account.", "سجّل الدخول بحساب مشرف.")
            : e instanceof ApiError
              ? isArabic
                ? e.message_ar
                : e.message_en
              : t("Could not load analytics.", "تعذّر تحميل التحليلات."),
      );
    } finally {
      setBusy(false);
    }
  }, [culture, from, to, isArabic, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const cultures = report?.cultures ?? ["lebanese", "khaleeji", "moroccan"];
  const label = useCallback(
    (c: string) =>
      isArabic ? (CULTURE_LABEL[c]?.ar ?? c) : (CULTURE_LABEL[c]?.en ?? c),
    [isArabic],
  );

  const totalUsers = users?.length ?? 0;
  const adminCount = users?.filter((u) => u.role === "Admin").length ?? 0;
  const proCount = users?.filter((u) => u.isSubscribed).length ?? 0;
  const basicCount = totalUsers - proCount;
  const pendingCount = pendingQueue ?? 0;

  const overview = report?.generation;
  const stats = report?.stats;
  const shown = culture === "all" ? cultures : [culture];

  const signupSeries = useMemo(() => {
    if (!users?.length) return [];
    const counts = new Map<string, number>();
    users.forEach((u) => {
      const key = new Date(u.createdAt * 1000).toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const days = Array.from(counts.keys()).sort();
    if (!days.length) return [];
    const end = new Date(days[days.length - 1]);
    const start = new Date(days[0]);
    let cumulative = 0;
    if (days.length > 30) {
      const cutoff = new Date(days[days.length - 30]);
      for (const day of days) {
        if (day < cutoff.toISOString().slice(0, 10)) {
          cumulative += counts.get(day) ?? 0;
        }
      }
      start.setTime(cutoff.getTime());
    }
    const result: Array<{ day: string; count: number }> = [];
    for (
      let current = new Date(start);
      current <= end;
      current.setDate(current.getDate() + 1)
    ) {
      const day = current.toISOString().slice(0, 10);
      cumulative += counts.get(day) ?? 0;
      result.push({ day, count: cumulative });
    }
    return result;
  }, [users]);

  const cultureSegments = useMemo(() => {
    const counts: Record<string, number> = {
      lebanese: 0,
      khaleeji: 0,
      moroccan: 0,
    };
    // Saved designs per culture. This used to read confusion.rowTotals, which
    // counts only designs CLIP has classified — so with lpips/open_clip_torch
    // absent (PredictedCulture stays null) the pie read "No generation data"
    // while the card beside it correctly showed saved designs. The old fallback
    // could not rescue it either: `{}` is truthy, so the `else if` was dead
    // code, and byCulture counts *ratings* rather than designs anyway.
    if (report?.designsByCulture?.length) {
      report.designsByCulture.forEach((row) => {
        if (row.culture && row.culture in counts) counts[row.culture] = row.total;
      });
    } else if (Object.keys(report?.confusion?.rowTotals ?? {}).length) {
      // Older backend without the field: the classified subset is still a
      // truthful distribution, just a narrower one.
      Object.entries(report!.confusion.rowTotals).forEach(([cultureId, value]) => {
        if (cultureId in counts) counts[cultureId] = value;
      });
    }
    return Object.entries(counts).map(([cultureId, value]) => ({
      key: cultureId,
      label: isArabic
        ? (CULTURE_LABEL[cultureId]?.ar ?? cultureId)
        : (CULTURE_LABEL[cultureId]?.en ?? cultureId),
      value,
      color: CULTURE_COLOR[cultureId],
    }));
  }, [report, isArabic]);

  const cultureTotal = cultureSegments.reduce(
    (sum, slice) => sum + slice.value,
    0,
  );

  const planSegments = useMemo(
    () => [
      {
        key: "basic",
        label: t("Basic", "أساسي"),
        value: basicCount,
        color: "#8b7432",
      },
      {
        key: "pro",
        label: t("Pro", "احترافية"),
        value: proCount,
        color: "#c9a876",
      },
    ],
    [basicCount, isArabic, proCount, t],
  );

  const planTotal = basicCount + proCount;

  const sampleNotes = useMemo(
    () =>
      Object.fromEntries(
        shown.map((c) => {
          const row = report?.byCulture.find((r) => r.culture === c);
          return [c, row?.total ? `/ 5 · n=${row.total}` : ""];
        }),
      ) as Record<string, string>,
    [shown, report],
  );

  const pick = (field: keyof EvaluationReport["byCulture"][number]) =>
    Object.fromEntries(
      shown.map((c) => [
        c,
        (report?.byCulture.find((row) => row.culture === c)?.[field] as
          | number
          | null) ?? null,
      ]),
    ) as Record<string, number | null>;

  const filterSummary = [
    culture === "all" ? t("all cultures", "كل الثقافات") : label(culture),
    from || to
      ? `${from || t("start", "البداية")} → ${to || t("today", "اليوم")}`
      : t("all dates", "كل التواريخ"),
  ].join(" · ");

  return (
    <GalleryShell
      title={t("Analytics overview", "نظرة عامة على التحليلات")}
      subtitle={t(
        "A broader admin dashboard for accounts, plans, saved designs, and evaluation metrics.",
        "لوحة إدارة أوسع للحسابات، الخطط، التصاميم المحفوظة، ومقاييس التقييم.",
      )}
    >
      <div>
        <section className="mb-8 rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-4">
          <div
            className={cn(
              "flex flex-wrap items-end gap-4",
              isArabic && "flex-row-reverse",
            )}
          >
            <div>
              <span className="mb-2 block text-xs uppercase tracking-wide text-cream-muted">
                {t("Culture", "الثقافة")}
              </span>
              <div
                className={cn(
                  "flex flex-wrap gap-2",
                  isArabic && "flex-row-reverse",
                )}
              >
                {(["all", ...cultures] as Array<"all" | string>).map((c) => (
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

            <div
              className={cn(
                "flex items-end gap-2",
                isArabic && "flex-row-reverse",
              )}
            >
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
          </div>

          <button
            onClick={() => void load()}
            disabled={busy}
            className={cn(
              "mt-4 inline-flex items-center gap-2 rounded-lg border border-gold px-3 py-1.5 text-sm text-gold transition hover:bg-gold hover:text-[var(--dd-ink)] disabled:opacity-50",
              isArabic ? "font-arabic" : "font-ui",
            )}
          >
            <Loader2 size={14} className={busy ? "animate-spin" : ""} />
            {t("Refresh", "تحديث")}
          </button>

          {report && (
            <p
              className={cn(
                "mt-3 text-xs text-cream-muted",
                isArabic && "font-arabic",
              )}
              dir={isArabic ? "rtl" : "ltr"}
            >
              {t("Showing:", "المعروض:")} {filterSummary}
            </p>
          )}
        </section>

        {error && (
          <p className="mb-6 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
            {error}
          </p>
        )}

        {busy && !report && (
          <p
            className={cn(
              "mb-6 text-sm text-cream-muted",
              isArabic && "font-arabic",
            )}
          >
            {t("Loading…", "جارٍ التحميل…")}
          </p>
        )}

        {report && (
          <>
            <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-4">
              <MetricTile
                label={t("Accounts", "الحسابات")}
                value={String(totalUsers)}
                sub={t(
                  `${adminCount} admins · ${proCount} Pro`,
                  `${adminCount} مشرفين · ${proCount} احترافية`,
                )}
                isArabic={isArabic}
              />
              <MetricTile
                label={t("Pending upgrades", "الاشتراكات المعلقة")}
                value={pendingCount > 0 ? String(pendingCount) : "—"}
                sub={t(
                  "Review them on the Subscriptions page.",
                  "راجعها في صفحة الاشتراكات.",
                )}
                isArabic={isArabic}
              />
              <MetricTile
                label={t("Saved designs", "التصاميم المحفوظة")}
                value={String(overview?.roomsGenerated ?? 0)}
                sub={t(
                  `${overview?.evaluableDesigns ?? 0} evaluable · ${overview?.editedExcluded ?? 0} edited or preview excluded`,
                  `${overview?.evaluableDesigns ?? 0} قابل للتقييم · ${overview?.editedExcluded ?? 0} معدّل/معاينة مستبعد`,
                )}
                isArabic={isArabic}
              />
              <MetricTile
                label={t("Average generation time", "متوسط زمن التوليد")}
                value={fmtDuration(overview?.averageSeconds)}
                isArabic={isArabic}
              />
            </section>

            <section className="mb-8 grid gap-4 lg:grid-cols-3">
              <ChartPanel
                title={t("User growth", "نمو المستخدمين")}
                subtitle={t(
                  "Total users over time by signup date.",
                  "إجمالي المستخدمين مع الزمن حسب تاريخ التسجيل.",
                )}
                isArabic={isArabic}
              >
                <UserGrowthLineChart
                  series={signupSeries}
                  isArabic={isArabic}
                />
              </ChartPanel>

              <ChartPanel
                title={t("Culture distribution", "توزيع الثقافة")}
                subtitle={t(
                  "Generated rooms by intended culture.",
                  "الغرف المولدة حسب الثقافة المقصودة.",
                )}
                isArabic={isArabic}
              >
                <PieChart
                  segments={cultureSegments}
                  total={cultureTotal}
                  emptyLabel={t(
                    "No generation data.",
                    "لا توجد بيانات للتوليد.",
                  )}
                  isArabic={isArabic}
                />
              </ChartPanel>

              <ChartPanel
                title={t("Plan distribution", "توزيع الخطط")}
                subtitle={t(
                  "Users on Basic versus Pro plans.",
                  "المستخدمون على الخطط الأساسية والمحترفة.",
                )}
                isArabic={isArabic}
              >
                <DonutChart
                  segments={planSegments}
                  total={planTotal}
                  isArabic={isArabic}
                />
              </ChartPanel>
            </section>
          </>
        )}
      </div>
    </GalleryShell>
  );
}

function ChartPanel({
  title,
  subtitle,
  children,
  isArabic,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  isArabic: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-5">
      <h2
        className={cn(
          "mb-3 text-lg font-semibold text-gold",
          isArabic ? "font-arabic" : "font-display",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "mb-5 text-sm text-cream-muted",
          isArabic && "font-arabic",
        )}
      >
        {subtitle}
      </p>
      {children}
    </section>
  );
}

function UserGrowthLineChart({
  series,
  isArabic,
}: {
  series: Array<{ day: string; count: number }>;
  isArabic: boolean;
}) {
  if (!series.length) {
    return (
      <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
        {isArabic
          ? "لا توجد بيانات مستخدمين حالياً."
          : "No user signup data is available."}
      </p>
    );
  }

  const width = 320;
  const height = 160;
  const padding = 32;
  const maxCount = Math.max(...series.map((point) => point.count), 1);
  const step =
    series.length > 1 ? (width - padding * 2) / (series.length - 1) : 0;
  const points = series.map((point, index) => {
    const x = padding + index * step;
    const y =
      height - padding - (point.count / maxCount) * (height - padding * 2);
    return { x, y, label: point.day, value: point.count };
  });

  const path = points
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
    )
    .join(" ");
  const areaPath = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  const labelIndexes = [
    0,
    Math.floor((points.length - 1) / 2),
    points.length - 1,
  ];

  return (
    <div className="overflow-hidden rounded-3xl bg-[var(--dd-surface-strong)] p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="user-growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(212,175,55,0.35)" />
            <stop offset="100%" stopColor="rgba(212,175,55,0)" />
          </linearGradient>
        </defs>
        <g>
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="var(--dd-gold-dim)"
            strokeWidth="1"
          />
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={height - padding}
            stroke="var(--dd-gold-dim)"
            strokeWidth="1"
          />
          <path d={areaPath} fill="url(#user-growth-fill)" />
          <path
            d={path}
            fill="none"
            stroke="var(--dd-gold)"
            strokeWidth="2.5"
          />
          {points.map((point, index) => (
            <circle
              key={point.label}
              cx={point.x}
              cy={point.y}
              r={3}
              fill="var(--dd-gold)"
            />
          ))}
          {labelIndexes.map((index) => (
            <text
              key={index}
              x={points[index].x}
              y={height - padding + 16}
              textAnchor={
                index === 0
                  ? "start"
                  : index === points.length - 1
                    ? "end"
                    : "middle"
              }
              className="text-[10px] font-mono text-cream-muted"
              fill="currentColor"
            >
              {points[index].label}
            </text>
          ))}
          <text
            x={padding}
            y={padding - 8}
            className="text-[10px] font-mono text-cream-muted"
            fill="currentColor"
          >
            {isArabic ? "المستخدمون" : "Users"}
          </text>
        </g>
      </svg>
      <div className="mt-4 text-xs text-cream-muted">
        {isArabic
          ? `يعرض ${series.length} يومًا، آخر ${series[series.length - 1].count} مستخدمًا`
          : `Showing ${series.length} days, latest ${series[series.length - 1].count} users`}
      </div>
    </div>
  );
}

function PieChart({
  segments,
  total,
  emptyLabel,
  isArabic,
}: {
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  total: number;
  emptyLabel: string;
  isArabic: boolean;
}) {
  const visible = segments.filter((segment) => segment.value > 0);
  if (!visible.length || total === 0) {
    return (
      <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
        {emptyLabel}
      </p>
    );
  }

  let cumulative = 0;
  const stops = visible.map((segment) => {
    const start = cumulative;
    const portion = (segment.value / total) * 100;
    cumulative += portion;
    return `${segment.color} ${start}% ${cumulative}%`;
  });

  return (
    <div className="grid gap-4">
      <div
        className="mx-auto h-56 w-56 rounded-full bg-[var(--dd-surface)]"
        style={{ backgroundImage: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label={
          isArabic
            ? `توزيع الثقافة: ${visible.map((s) => `${s.label} ${s.value}`).join(", ")}`
            : `Culture distribution: ${visible.map((s) => `${s.label} ${s.value}`).join(", ")}`
        }
      />
      <div className="grid gap-2">
        {visible.map((segment) => (
          <div key={segment.key} className="flex items-center gap-3">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 grow text-sm text-cream-muted">
              {segment.label}
            </span>
            <span className="text-sm font-semibold text-cream">
              {segment.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutChart({
  segments,
  total,
  isArabic,
}: {
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  total: number;
  isArabic: boolean;
}) {
  if (total === 0) {
    return (
      <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
        {isArabic ? "لا توجد مستخدمين." : "No users found."}
      </p>
    );
  }

  let cumulative = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cumulative;
      const portion = (segment.value / total) * 100;
      cumulative += portion;
      return `${segment.color} ${start}% ${cumulative}%`;
    });

  return (
    <div className="grid gap-4">
      <div className="relative mx-auto h-56 w-56 rounded-full bg-[var(--dd-surface)]">
        <div
          className="h-full w-full rounded-full"
          style={{ backgroundImage: `conic-gradient(${stops.join(", ")})` }}
          aria-hidden="true"
        />
        <div className="absolute inset-1/4 m-auto flex h-28 w-28 items-center justify-center rounded-full bg-[var(--dd-surface)] text-center text-sm font-semibold text-cream">
          {isArabic ? "الخطط" : "Plans"}
          <br />
          {total}
        </div>
      </div>
      <div className="grid gap-2">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-3">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 grow text-sm text-cream-muted">
              {segment.label}
            </span>
            <span className="text-sm font-semibold text-cream">
              {segment.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  isArabic,
}: {
  label: string;
  value: string;
  sub?: string;
  isArabic: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gold/20 bg-[var(--dd-surface)] p-4">
      <p
        className={cn(
          "text-xs uppercase tracking-wide text-cream-muted",
          isArabic && "font-arabic",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-3 text-3xl font-semibold text-gold",
          isArabic && "font-arabic",
        )}
      >
        {value}
      </p>
      {sub && (
        <p
          className={cn(
            "mt-2 text-xs text-cream-muted",
            isArabic && "font-arabic",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
