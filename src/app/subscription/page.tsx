"use client";

/* ============================================================
   /subscription — the two plans, and where a user moves between
   them.

   Subscribing is a *request*: the button queues one for the admin
   and nothing about the account changes until it is approved on
   /admin/subscriptions. Unsubscribing is the user's own to do and
   takes effect at once. Every figure on this page (the $20, the
   30 days, the 3 free designs) comes from the backend's `terms`,
   so what is advertised here is what is actually enforced.
   ============================================================ */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Loader2 } from "lucide-react";
import GalleryShell from "@/components/GalleryShell";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  cancelSubscription,
  fetchSubscription,
  requestSubscription,
  type SubscriptionState,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function SubscriptionPage() {
  const { isArabic } = useThemeLanguage();
  const { user, loading: authLoading, refresh } = useAuth();
  const t = (en: string, ar: string) => (isArabic ? ar : en);

  const [state, setState] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fmtDate = useCallback(
    (seconds: number | null | undefined) =>
      seconds == null
        ? "—"
        : new Date(seconds * 1000).toLocaleDateString(isArabic ? "ar" : "en-GB", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
    [isArabic],
  );

  const say = useCallback(
    (e: unknown, fallback: string) =>
      setError(e instanceof ApiError ? (isArabic ? e.message_ar : e.message_en) : fallback),
    [isArabic],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchSubscription()
      .then((s) => !cancelled && setState(s))
      .catch((e) => !cancelled && say(e, t("Could not load your plan.", "تعذّر تحميل خطتك.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, isArabic]);

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await requestSubscription());
      setNotice(
        t(
          "Your request was sent to the admin. Your plan changes once it is approved.",
          "تم إرسال طلبك إلى المشرف. ستتغيّر خطتك فور الموافقة عليه.",
        ),
      );
    } catch (e) {
      say(e, t("Could not send your request.", "تعذّر إرسال الطلب."));
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await cancelSubscription());
      // The chrome carries the plan too — re-read it rather than let it show
      // Pro to someone who just left it.
      await refresh();
      setNotice(t("You are back on the Basic plan.", "لقد عدت إلى الخطة الأساسية."));
    } catch (e) {
      say(e, t("Could not cancel your subscription.", "تعذّر إلغاء الاشتراك."));
    } finally {
      setBusy(false);
    }
  };

  const terms = state?.terms;
  const price = terms?.priceUsd ?? 20;
  const days = terms?.durationDays ?? 30;
  const freeLimit = terms?.basicWeeklyLimit ?? 3;
  const isPro = !!state?.isSubscribed;
  const pending = state?.pendingRequest ?? null;

  return (
    <GalleryShell
      title={t("Subscription", "الاشتراك")}
      subtitle={t(
        "Choose how many rooms you can design.",
        "اختر عدد الغرف التي يمكنك تصميمها.",
      )}
    >
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      {authLoading || loading ? (
        <div className="mt-16 flex items-center justify-center gap-2 text-[var(--dd-text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("Loading…", "جارٍ التحميل…")}
        </div>
      ) : !user ? (
        <div className="mt-16 text-center">
          <p className="text-[var(--dd-text-soft)]">
            {t("Sign in to manage your plan.", "سجّل الدخول لإدارة خطتك.")}
          </p>
          <Link
            href="/login"
            className="mt-5 inline-block rounded-lg bg-[var(--dd-gold)] px-5 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
          >
            {t("Sign in", "تسجيل الدخول")}
          </Link>
        </div>
      ) : (
        <>
          {/* Where the account stands right now: plan, dates, what is left. */}
          <section className="mb-8 rounded-2xl border border-[var(--dd-gold-dim)]/30 bg-[var(--dd-surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--dd-text-secondary)]">
                  {t("Current plan", "خطتك الحالية")}
                </p>
                <p className="mt-1 text-xl font-semibold text-[var(--dd-gold)]">
                  {isPro ? t("Pro", "الاحترافية") : t("Basic", "الأساسية")}
                </p>
              </div>
              <dl className="flex flex-wrap gap-6 text-sm">
                {isPro ? (
                  <>
                    <Stat label={t("Started", "تاريخ البدء")} value={fmtDate(state?.planStartedAt)} />
                    <Stat label={t("Renews / ends", "تاريخ الانتهاء")} value={fmtDate(state?.planExpiryDate)} />
                    <Stat label={t("Designs left", "التصاميم المتبقية")} value={t("Unlimited", "غير محدودة")} />
                  </>
                ) : (
                  <>
                    <Stat
                      label={t("Designs used this week", "التصاميم المستخدمة هذا الأسبوع")}
                      value={`${state?.numberOfUses ?? 0} / ${state?.limit ?? freeLimit}`}
                    />
                    <Stat
                      label={t("Designs left", "التصاميم المتبقية")}
                      value={String(state?.remaining ?? 0)}
                    />
                    <Stat label={t("Refills on", "يتجدّد في")} value={fmtDate(state?.windowEnds)} />
                  </>
                )}
              </dl>
            </div>

            {pending && (
              <p
                className={cn(
                  "mt-4 flex items-center gap-2 rounded-lg border border-[var(--dd-gold)]/40 bg-[var(--dd-gold)]/10 px-3 py-2 text-sm text-[var(--dd-gold)]",
                  isArabic && "flex-row-reverse",
                )}
              >
                <Clock className="h-4 w-4 shrink-0" />
                {t(
                  "Your Pro request is waiting for the admin. Your plan stays Basic until it is approved.",
                  "طلبك للخطة الاحترافية بانتظار موافقة المشرف. تبقى خطتك أساسية حتى تتم الموافقة.",
                )}
              </p>
            )}
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <PlanCard
              name={t("Basic", "الأساسية")}
              price={t("Free", "مجانية")}
              current={!isPro}
              features={[
                t(
                  `${freeLimit} designs per week`,
                  `${freeLimit} تصاميم في الأسبوع`,
                ),
                t("All three cultural styles", "الأنماط الثقافية الثلاثة"),
                t("Save and share your designs", "حفظ التصاميم ومشاركتها"),
              ]}
            />

            <PlanCard
              name={t("Pro", "الاحترافية")}
              price={t(`$${price} / ${days} days`, `${price}$ / ${days} يوماً`)}
              featured
              current={isPro}
              features={[
                t("Unlimited designs — no weekly limit", "تصاميم غير محدودة — بلا حدّ أسبوعي"),
                t("All three cultural styles", "الأنماط الثقافية الثلاثة"),
                t(`Runs for ${days} days from approval`, `تدوم ${days} يوماً من تاريخ الموافقة`),
              ]}
              action={
                isPro ? (
                  <button
                    onClick={unsubscribe}
                    disabled={busy}
                    className="w-full rounded-lg border border-[var(--dd-gold-dim)]/50 px-5 py-2.5 font-medium text-[var(--dd-text-soft)] transition hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
                  >
                    {busy
                      ? t("Working…", "جارٍ التنفيذ…")
                      : t("Unsubscribe — back to Basic", "إلغاء الاشتراك — العودة إلى الأساسية")}
                  </button>
                ) : (
                  <button
                    onClick={subscribe}
                    disabled={busy || !!pending}
                    className="w-full rounded-lg bg-[var(--dd-gold)] px-5 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:opacity-50"
                  >
                    {busy
                      ? t("Sending…", "جارٍ الإرسال…")
                      : pending
                        ? t("Waiting for approval", "بانتظار الموافقة")
                        : t(`Subscribe — $${price}`, `اشترك — ${price}$`)}
                  </button>
                )
              }
            />
          </div>

          <p className="mt-6 text-center text-xs text-[var(--dd-text-secondary)]">
            {t(
              "Subscribing sends a request to the admin; your plan changes only once it is approved.",
              "عند الاشتراك يُرسل طلب إلى المشرف؛ ولا تتغيّر خطتك إلا بعد الموافقة عليه.",
            )}
          </p>
        </>
      )}
    </GalleryShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--dd-text-secondary)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--dd-text-soft)]">{value}</dd>
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  action,
  featured,
  current,
}: {
  name: string;
  price: string;
  features: string[];
  action?: React.ReactNode;
  featured?: boolean;
  current?: boolean;
}) {
  const { isArabic } = useThemeLanguage();
  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border bg-[var(--dd-surface)] p-5",
        featured
          ? "border-[var(--dd-gold)]/60 shadow-[0_0_30px_-12px_var(--dd-gold)]"
          : "border-[var(--dd-gold-dim)]/25",
      )}
    >
      <header className={cn("flex items-center justify-between gap-2", isArabic && "flex-row-reverse")}>
        <h2 className="text-lg font-semibold text-[var(--dd-text)]">{name}</h2>
        {current && (
          <span className="rounded-full border border-[var(--dd-gold)]/50 px-2 py-0.5 text-xs text-[var(--dd-gold)]">
            {isArabic ? "خطتك الحالية" : "Your plan"}
          </span>
        )}
      </header>
      <p className="mt-1 text-2xl font-semibold text-[var(--dd-gold)]">{price}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--dd-text-soft)]">
        {features.map((f) => (
          <li key={f} className={cn("flex items-start gap-2", isArabic && "flex-row-reverse text-right")}>
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dd-gold)]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-5">{action}</div>}
    </article>
  );
}

function Banner({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "mb-6 rounded-lg border px-3 py-2 text-sm",
        tone === "error"
          ? "border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
          : "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
      )}
    >
      {children}
    </p>
  );
}
