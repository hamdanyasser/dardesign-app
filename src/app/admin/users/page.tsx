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
      subtitle={t(
        `${users.length} accounts · ${proCount} on Pro`,
        `${users.length} حساباً · ${proCount} على الخطة الاحترافية`,
      )}
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
        // Nothing below the banner: an empty table under a failed load reads as
        // "no accounts", which is a different claim from "could not ask".
        null
      ) : users.length === 0 ? (
        <p className="mt-16 text-center text-[var(--dd-text-soft)]">
          {t("No accounts yet.", "لا توجد حسابات بعد.")}
        </p>
      ) : (
        // The table is wider than a phone; it scrolls inside its own box so the
        // page itself never scrolls sideways.
        <div className="overflow-x-auto rounded-2xl border border-[var(--dd-gold-dim)]/25 bg-[var(--dd-surface)]">
          <table className="w-full min-w-[52rem] text-sm" dir={isArabic ? "rtl" : "ltr"}>
            <thead>
              <tr className="border-b border-[var(--dd-gold-dim)]/25 text-xs uppercase tracking-wide text-[var(--dd-text-secondary)]">
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
            <tbody className="divide-y divide-[var(--dd-gold-dim)]/15">
              {users.map((u) => (
                <tr key={u.id} className="text-[var(--dd-text-soft)]">
                  <Td>
                    <span className="font-medium">{u.fullName}</span>
                    <span className="block text-xs text-[var(--dd-text-secondary)]">{u.email}</span>
                  </Td>
                  <Td>{u.role === "Admin" ? t("Admin", "مشرف") : t("User", "مستخدم")}</Td>
                  <Td>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        u.isSubscribed
                          ? "border-[var(--dd-gold)]/60 text-[var(--dd-gold)]"
                          : "border-[var(--dd-gold-dim)]/40 text-[var(--dd-text-secondary)]",
                      )}
                    >
                      {u.isSubscribed ? t("Pro", "احترافية") : t("Basic", "أساسية")}
                    </span>
                  </Td>
                  <Td>{fmt(u.planStartedAt)}</Td>
                  <Td>{fmt(u.planExpiryDate)}</Td>
                  <Td>
                    {/* Pro has no weekly limit, so the count is shown on its own
                        rather than out of a maximum that does not apply. */}
                    {u.isSubscribed
                      ? `${u.numberOfUses}`
                      : `${u.numberOfUses} / ${terms?.basicWeeklyLimit ?? 3}`}
                  </Td>
                  <Td>{u.designsSaved}</Td>
                  <Td>{fmt(u.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GalleryShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 text-start font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-start align-top">{children}</td>;
}
