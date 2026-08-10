"use client";

/* ============================================================
   /admin/users — every account, which plan it is on, and when
   that plan starts and ends.

   Admin-only. The backend selects the columns it sends by name,
   so the password hash is not merely hidden here — it never
   leaves the database.

   A Basic account has no plan dates, and they print as "—"
   rather than as today's date or a zero: nobody bought a plan,
   so there is nothing to show.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import GalleryShell from "@/components/GalleryShell";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { ApiError, fetchAdminUsers, type AdminUserRow, type PlanTerms } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AdminUsersPage() {
  const { isArabic } = useThemeLanguage();
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [terms, setTerms] = useState<PlanTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsers()
      .then((r) => {
        if (cancelled) return;
        setUsers(r.users);
        setTerms(r.terms);
      })
      .catch((e) => {
        if (cancelled) return;
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
                : t("Could not load the users.", "تعذّر تحميل المستخدمين."),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isArabic, t]);

  const fmt = (seconds: number | null | undefined) =>
    seconds == null
      ? "—"
      : new Date(seconds * 1000).toLocaleDateString(isArabic ? "ar" : "en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });

  const proCount = users.filter((u) => u.isSubscribed).length;

  return (
    <GalleryShell
      title={t("Users", "المستخدمون")}
      subtitle={t(`${proCount} on Pro`, `${proCount} على الخطة الاحترافية`)}
      eyebrow={t(`ADMIN · ${users.length} ACCOUNTS`, `إدارة · ${users.length} حساباً`)}
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
        // Nothing below the banner: an empty table under a failed load reads as
        // "no accounts", which is a different claim from "could not ask".
        null
      ) : users.length === 0 ? (
        <p className="mt-16 text-center text-[var(--dd-text-soft)]">
          {t("No accounts yet.", "لا توجد حسابات بعد.")}
        </p>
      ) : (
        // The table is wider than a phone; it scrolls inside its own box so the
        // page itself never scrolls sideways. A1: a plain hairline table, no
        // card wrapper.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm" dir={isArabic ? "rtl" : "ltr"}>
            <thead>
              <tr className="border-b border-[var(--dd-border)] bg-[var(--dd-text)]/[0.025]">
                <Th>{t("User", "المستخدم")}</Th>
                <Th>{t("Role", "الدور")}</Th>
                <Th>{t("Plan", "الخطة")}</Th>
                <Th>{t("Plan starts", "بداية الخطة")}</Th>
                <Th>{t("Plan ends", "نهاية الخطة")}</Th>
                <Th>{t("Designs used", "التصاميم المستخدمة")}</Th>
                <Th>{t("Saved", "المحفوظة")}</Th>
                <Th>{t("Joined", "تاريخ الانضمام")}</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--dd-border)] text-[var(--dd-text-soft)]">
                  <Td>
                    <span
                      className={cn(
                        "text-[14px]",
                        isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
                      )}
                    >
                      {u.fullName}
                    </span>
                    <span className="block text-xs text-[var(--dd-text-secondary)]">{u.email}</span>
                  </Td>
                  <Td mono>
                    <span
                      aria-hidden
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        isArabic ? "ms-1.5" : "me-1.5",
                      )}
                      style={{
                        background: u.role === "Admin" ? "var(--dd-gold)" : "var(--dd-text-secondary)",
                      }}
                    />
                    {u.role === "Admin" ? t("ADMIN", "مشرف") : t("USER", "مستخدم")}
                  </Td>
                  <Td mono>{u.isSubscribed ? t("PRO", "احترافية") : t("BASIC", "أساسية")}</Td>
                  <Td mono muted={!u.isSubscribed}>
                    {fmt(u.planStartedAt)}
                  </Td>
                  <Td mono muted={!u.isSubscribed}>
                    {fmt(u.planExpiryDate)}
                  </Td>
                  <Td mono>
                    {/* Pro has no weekly limit, so the count is shown on its own
                        rather than out of a maximum that does not apply. */}
                    {u.isSubscribed
                      ? `${u.numberOfUses}`
                      : `${u.numberOfUses} / ${terms?.basicWeeklyLimit ?? 3}`}
                  </Td>
                  <Td mono>{u.designsSaved}</Td>
                  <Td mono>{fmt(u.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="font-editorial-mono mt-4 text-[9px] text-[var(--dd-text-secondary)]">
            {t(
              "Basic accounts print — for plan dates, never today's date.",
              "تُظهر الحسابات الأساسية — لتواريخ الخطة، لا تاريخ اليوم أبداً.",
            )}
          </p>
        </div>
      )}
    </GalleryShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-editorial-mono whitespace-nowrap px-4 py-3 text-start text-[9.5px] text-[var(--dd-text-secondary)]">
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  muted,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-4 py-3 text-start align-top",
        mono && "font-editorial-mono text-[11px]",
        muted && "text-[var(--dd-text-secondary)]",
      )}
    >
      {children}
    </td>
  );
}
