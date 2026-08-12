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
import { Clock, Loader2 } from "lucide-react";
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

  const used = state?.numberOfUses ?? 0;
  const limit = state?.limit ?? freeLimit;

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
            className="font-editorial-mono mt-5 inline-block rounded-[2px] bg-[var(--dd-gold)] px-6 py-3 text-xs text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)]"
          >
            {t("Sign in", "تسجيل الدخول")}
          </Link>
        </div>
      ) : (
        <>
          {pending && (
            <p
              className={cn(
                "mb-8 flex items-center gap-2 border-s-2 border-[var(--dd-gold)] ps-3 text-sm text-[var(--dd-gold)]",
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

          {/* A1: two editorial rows, not pricing cards. */}
          <PlanRow
            name={t("Basic", "الأساسية")}
            price={t("FREE", "مجانية")}
            priceCaption={!isPro ? t("Current plan", "خطتك الحالية") : undefined}
            features={[
              { label: t("Designs per week", "التصاميم أسبوعياً"), value: String(freeLimit) },
              { label: t("All three cultures", "الأنماط الثلاثة"), value: t("YES", "نعم") },
              { label: t("Save & share", "الحفظ والمشاركة"), value: t("YES", "نعم") },
            ]}
          />
          <PlanRow
            name={t("Pro", "الاحترافية")}
            price={t(`$${price}`, `${price}$`)}
            wash
            priceCaption={
              isPro
                ? t("Current plan", "خطتك الحالية")
                : pending
                  ? t("Waiting for approval", "بانتظار الموافقة")
                  : undefined
            }
            features={[
              { label: t("Designs per week", "التصاميم أسبوعياً"), value: t("UNLIMITED", "غير محدود") },
              { label: t("Duration", "المدة"), value: t(`${days} DAYS`, `${days} يوماً`) },
              { label: t("Approval", "الموافقة"), value: t("BY REQUEST", "بالطلب") },
            ]}
            action={
              isPro ? (
                <button
                  onClick={unsubscribe}
                  disabled={busy}
                  className="font-editorial-mono rounded-[2px] border border-[var(--dd-border)] px-3 py-1.5 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
                >
                  {busy
                    ? t("Working…", "جارٍ التنفيذ…")
                    : t("Unsubscribe — back to Basic", "إلغاء الاشتراك — العودة إلى الأساسية")}
                </button>
              ) : !pending ? (
                <button
                  onClick={subscribe}
                  disabled={busy}
                  className="font-editorial-mono rounded-[2px] border border-[var(--dd-gold)] px-3 py-1.5 text-[10px] text-[var(--dd-gold)] transition hover:bg-[var(--dd-gold)] hover:text-[var(--dd-ink)] disabled:opacity-50"
                >
                  {busy
                    ? t("Sending…", "جارٍ الإرسال…")
                    : t("Request upgrade", "طلب الترقية")}
                </button>
              ) : undefined
            }
          />

          {/* A1: the weekly allowance is discrete rules, not a progress bar.
              Pro isn't metered, so it gets its dates on the same mono line
              instead. */}
          <div className={cn("mt-8", isArabic && "text-right")}>
            <div className="font-editorial-mono text-[9px] text-[var(--dd-text-secondary)]">
              {isPro ? t("Plan", "الخطة") : t("This week", "هذا الأسبوع")}
            </div>
            {isPro ? (
              <div
                className={cn(
                  "font-editorial-mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--dd-text-secondary)]",
                  isArabic && "flex-row-reverse",
                )}
              >
                <span>
                  {t("STARTED", "بدأت")} {fmtDate(state?.planStartedAt)}
                </span>
                <span>
                  {t("EXPIRES", "تنتهي")} {fmtDate(state?.planExpiryDate)}
                </span>
              </div>
            ) : (
              <div className={cn("mt-2 flex items-center gap-[5px]", isArabic && "flex-row-reverse")}>
                {Array.from({ length: Math.max(limit, 1) }, (_, i) => (
                  <span
                    key={i}
                    className="h-[5px] w-16 max-w-[64px] flex-1"
                    style={{
                      background:
                        i < used ? "var(--dd-gold)" : "color-mix(in srgb, var(--dd-text) 13%, transparent)",
                    }}
                  />
                ))}
                <span
                  className={cn(
                    "font-editorial-mono text-[10px] text-[var(--dd-text-secondary)]",
                    isArabic ? "me-2" : "ms-2",
                  )}
                >
                  {t(
                    `${used} / ${limit} USED · RESETS ${fmtDate(state?.windowEnds)}`,
                    `${used} / ${limit} مُستخدَم · يتجدّد ${fmtDate(state?.windowEnds)}`,
                  )}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </GalleryShell>
  );
}

function PlanRow({
  name,
  price,
  priceCaption,
  features,
  action,
  wash,
}: {
  name: string;
  price: string;
  priceCaption?: string;
  features: { label: string; value: string }[];
  action?: React.ReactNode;
  wash?: boolean;
}) {
  const { isArabic } = useThemeLanguage();
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 border-b border-[var(--dd-border)] py-7 md:grid-cols-[170px_1fr_180px] md:items-start md:gap-7",
        wash && "bg-[var(--dd-gold)]/5",
      )}
    >
      <div
        className={cn(
          "text-[1.9rem] leading-none text-[var(--dd-text)]",
          isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
        )}
      >
        {name}
      </div>
      <ul>
        {features.map((f) => (
          <li
            key={f.label}
            className={cn(
              "flex items-center justify-between border-b border-[var(--dd-text)]/[0.07] py-1.5 text-[13.5px] text-[var(--dd-text-soft)] last:border-b-0",
              isArabic && "flex-row-reverse",
            )}
          >
            <span>{f.label}</span>
            <span className="font-editorial-mono text-[11px] text-[var(--dd-text-secondary)]" dir="ltr">
              {f.value}
            </span>
          </li>
        ))}
      </ul>
      <div className={cn(isArabic ? "text-left md:text-right" : "text-right")}>
        <div className="font-editorial-mono text-[1.4rem] text-[var(--dd-text)]">{price}</div>
        {priceCaption && (
          <div className="font-editorial-mono mt-1 text-[9px] text-[var(--dd-text-secondary)]">
            {priceCaption}
          </div>
        )}
        {action && <div className="mt-3 inline-block">{action}</div>}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "mb-6 border-s-2 ps-3 text-sm",
        tone === "error" ? "border-[var(--error)] text-[var(--error)]" : "border-[var(--success)] text-[var(--success)]",
      )}
    >
      {children}
    </p>
  );
}
