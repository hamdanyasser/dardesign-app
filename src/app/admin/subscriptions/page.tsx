"use client";

/* ============================================================
   /admin/subscriptions — Manage Subscriptions.

   The queue of users asking for Pro. Approving is the only thing
   in the app that sets IsSubscribed: until an admin clicks here,
   a user who pressed "Subscribe" is still on Basic.

   Admin-only by role. Hiding the link is a convenience, not the
   control — the endpoints check the role server-side, so reaching
   this URL as an ordinary account gets a 403 and an empty table.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import GalleryShell from "@/components/GalleryShell";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import {
  ApiError,
  decideSubscriptionRequest,
  fetchSubscriptionRequests,
  type PlanTerms,
  type SubscriptionRequest,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function ManageSubscriptionsPage() {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [terms, setTerms] = useState<PlanTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = await fetchSubscriptionRequests();
      setRequests(q.requests);
      setTerms(q.terms);
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
              : t("Could not load the requests.", "تعذّر تحميل الطلبات."),
      );
    } finally {
      setLoading(false);
    }
  }, [isArabic, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (request: SubscriptionRequest, approve: boolean) => {
    setBusy(request.id);
    setError(null);
    try {
      const updated = await decideSubscriptionRequest(request.id, approve);
      // Patch the row in place rather than refetching: the decision is the only
      // thing that changed, and a full reload would jump the admin's scroll.
      setRequests((prev) =>
        prev.map((r) =>
          r.id === request.id
            ? { ...r, status: updated.status, decidedAt: updated.decidedAt }
            : r,
        ),
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? isArabic
            ? e.message_ar
            : e.message_en
          : t("Could not record that decision.", "تعذّر تسجيل القرار."),
      );
    } finally {
      setBusy(null);
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  const fmt = (seconds: number | null | undefined) =>
    seconds == null
      ? "—"
      : new Date(seconds * 1000).toLocaleString(isArabic ? "ar" : "en-GB");

  return (
    <GalleryShell
      title={t("Manage Subscriptions", "إدارة الاشتراكات")}
      subtitle={
        terms
          ? t(
              `Approving starts the Pro plan ($${terms.priceUsd}) for ${terms.durationDays} days.`,
              `الموافقة تبدأ الخطة الاحترافية (${terms.priceUsd}$) لمدة ${terms.durationDays} يوماً.`,
            )
          : t("Requests from users who want the Pro plan.", "طلبات المستخدمين للحصول على الخطة الاحترافية.")
      }
    >
      {error && (
        <p className="mb-6 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-16 flex items-center justify-center gap-2 text-[var(--dd-text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("Loading…", "جارٍ التحميل…")}
        </div>
      ) : error ? (
        // "No requests yet" would be a claim about the data; a failed load has
        // nothing to say about it, so the banner stands alone.
        null
      ) : requests.length === 0 ? (
        <p className="mt-16 text-center text-[var(--dd-text-soft)]">
          {t("No subscription requests yet.", "لا توجد طلبات اشتراك بعد.")}
        </p>
      ) : (
        <div className="space-y-8">
          <Section title={t("Waiting for a decision", "بانتظار القرار")} count={pending.length}>
            {pending.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                fmt={fmt}
                busy={busy === r.id}
                onDecide={decide}
              />
            ))}
            {pending.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-[var(--dd-text-secondary)]">
                {t("Nothing pending.", "لا يوجد طلبات معلّقة.")}
              </p>
            )}
          </Section>

          {decided.length > 0 && (
            <Section title={t("Already decided", "طلبات تمّت معالجتها")} count={decided.length}>
              {decided.map((r) => (
                <RequestRow key={r.id} request={r} fmt={fmt} busy={false} />
              ))}
            </Section>
          )}
        </div>
      )}
    </GalleryShell>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-[var(--dd-text-secondary)]">
        {title} ({count})
      </h2>
      <div className="divide-y divide-[var(--dd-gold-dim)]/20 overflow-hidden rounded-2xl border border-[var(--dd-gold-dim)]/25 bg-[var(--dd-surface)]">
        {children}
      </div>
    </section>
  );
}

function RequestRow({
  request,
  fmt,
  busy,
  onDecide,
}: {
  request: SubscriptionRequest;
  fmt: (s: number | null | undefined) => string;
  busy: boolean;
  onDecide?: (r: SubscriptionRequest, approve: boolean) => void;
}) {
  const { isArabic } = useThemeLanguage();
  const t = (en: string, ar: string) => (isArabic ? ar : en);
  const label =
    request.status === "approved"
      ? t("Approved", "موافَق عليه")
      : request.status === "declined"
        ? t("Declined", "مرفوض")
        : t("Pending", "قيد المراجعة");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
        isArabic && "flex-row-reverse",
      )}
    >
      <div className={cn(isArabic && "text-right")}>
        <p className="font-medium text-[var(--dd-text-soft)]">{request.fullName}</p>
        <p className="text-xs text-[var(--dd-text-secondary)]">
          {request.email}
          {request.phoneNumber ? ` · ${request.phoneNumber}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-[var(--dd-text-secondary)]">
          {t("Requested", "تاريخ الطلب")}: {fmt(request.createdAt)}
          {request.decidedAt != null && ` · ${t("decided", "تاريخ القرار")}: ${fmt(request.decidedAt)}`}
        </p>
      </div>

      <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs",
            request.status === "approved"
              ? "border-[var(--success)]/50 text-[var(--success)]"
              : request.status === "declined"
                ? "border-[var(--error)]/50 text-[var(--error)]"
                : "border-[var(--dd-gold)]/50 text-[var(--dd-gold)]",
          )}
        >
          {label}
        </span>

        {request.status === "pending" && onDecide && (
          <>
            <button
              onClick={() => onDecide(request, true)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--dd-gold)] px-3 py-1.5 text-sm font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t("Approve", "موافقة")}
            </button>
            <button
              onClick={() => onDecide(request, false)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--dd-gold-dim)]/40 px-3 py-1.5 text-sm text-[var(--dd-text-soft)] transition hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {t("Decline", "رفض")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
