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
              `Approving starts the Pro plan ($${terms.priceUsd}) for ${terms.durationDays} days. Either decision emails the user.`,
              `الموافقة تبدأ الخطة الاحترافية (${terms.priceUsd}$) لمدة ${terms.durationDays} يوماً. يُرسَل بريد إلى المستخدم في الحالتين.`,
            )
          : t("Requests from users who want the Pro plan.", "طلبات المستخدمين للحصول على الخطة الاحترافية.")
      }
    >
      {error && (
        <p className="mb-6 border-s-2 border-[var(--error)] ps-3 text-sm text-[var(--error)]">
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
        <div className="space-y-9">
          <RequestTable
            title={t(`Waiting for a decision · ${pending.length}`, `بانتظار القرار · ${pending.length}`)}
            requests={pending}
            fmt={fmt}
            busy={busy}
            onDecide={decide}
            empty={t("Nothing pending.", "لا يوجد طلبات معلّقة.")}
          />

          {decided.length > 0 && (
            <RequestTable
              title={t(`Already decided · ${decided.length}`, `طلبات تمّت معالجتها · ${decided.length}`)}
              requests={decided}
              fmt={fmt}
              busy={null}
            />
          )}
        </div>
      )}
    </GalleryShell>
  );
}

function RequestTable({
  title,
  requests,
  fmt,
  busy,
  onDecide,
  empty,
}: {
  title: string;
  requests: SubscriptionRequest[];
  fmt: (s: number | null | undefined) => string;
  busy: number | null;
  onDecide?: (r: SubscriptionRequest, approve: boolean) => void;
  empty?: string;
}) {
  const { isArabic } = useThemeLanguage();
  const t = (en: string, ar: string) => (isArabic ? ar : en);

  return (
    <section>
      <h2 className="font-editorial-mono mb-3 text-[9.5px] text-[var(--dd-gold)]">{title}</h2>
      {requests.length === 0 ? (
        <p className="border-b border-[var(--dd-border)] pb-6 text-sm text-[var(--dd-text-secondary)]">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm" dir={isArabic ? "rtl" : "ltr"}>
            <thead>
              <tr className="border-b border-[var(--dd-border)] bg-[var(--dd-text)]/[0.025]">
                <th className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-start text-[9.5px] text-[var(--dd-text-secondary)]">
                  {t("Account", "الحساب")}
                </th>
                <th className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-start text-[9.5px] text-[var(--dd-text-secondary)]">
                  {t("Requested", "تاريخ الطلب")}
                </th>
                <th className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-start text-[9.5px] text-[var(--dd-text-secondary)]">
                  {t("Status", "الحالة")}
                </th>
                {onDecide && (
                  <th className="font-editorial-mono whitespace-nowrap px-4 py-2.5 text-start text-[9.5px] text-[var(--dd-text-secondary)]" />
                )}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <RequestRow key={r.id} request={r} fmt={fmt} busy={busy === r.id} onDecide={onDecide} />
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      ? t("APPROVED", "موافَق عليه")
      : request.status === "declined"
        ? t("DECLINED", "مرفوض")
        : t("PENDING", "قيد المراجعة");
  const dotColor =
    request.status === "approved"
      ? "var(--success)"
      : request.status === "declined"
        ? "var(--error)"
        : "var(--dd-gold)";

  return (
    <tr className="border-b border-[var(--dd-border)] align-top">
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={cn(
            "text-[14px] text-[var(--dd-text)]",
            isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
          )}
        >
          {request.fullName}
        </span>
        <span className="block text-xs text-[var(--dd-text-secondary)]">
          {request.email}
          {request.phoneNumber ? ` · ${request.phoneNumber}` : ""}
        </span>
      </td>
      <td className="font-editorial-mono whitespace-nowrap px-4 py-3 text-[11px] text-[var(--dd-text-secondary)]">
        {fmt(request.createdAt)}
        {request.decidedAt != null && (
          <span className="block">
            {t("decided", "القرار")} {fmt(request.decidedAt)}
          </span>
        )}
      </td>
      <td className="font-editorial-mono whitespace-nowrap px-4 py-3 text-[11px]">
        <span
          aria-hidden
          className={cn("inline-block h-1.5 w-1.5 rounded-full", isArabic ? "ms-1.5" : "me-1.5")}
          style={{ background: dotColor }}
        />
        {label}
      </td>
      {onDecide && (
        <td className="whitespace-nowrap px-4 py-3">
          {request.status === "pending" && (
            <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
              <button
                onClick={() => onDecide(request, true)}
                disabled={busy}
                className="font-editorial-mono flex items-center gap-1.5 rounded-[2px] border border-[var(--dd-gold)] bg-[var(--dd-gold)] px-2.5 py-1.5 text-[10px] text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {t("APPROVE", "موافقة")}
              </button>
              <button
                onClick={() => onDecide(request, false)}
                disabled={busy}
                className="font-editorial-mono flex items-center gap-1.5 rounded-[2px] border border-[var(--dd-border)] px-2.5 py-1.5 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--error)] hover:text-[var(--error)] disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                {t("DECLINE", "رفض")}
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
