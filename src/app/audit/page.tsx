"use client";

/**
 * /audit — the render audit trail, visible.
 *
 * Every /redesign and /restyle logs one metadata-only record (never image
 * bytes); this admin page tails them, newest first. Unlinked from the main
 * nav on purpose — it exists so the defense can show "every generation is
 * logged and inspectable" live. If the backend sets DARDESIGN_AUDIT_TOKEN,
 * paste it in the token field.
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import AdminFeedbackPanel from "@/components/AdminFeedbackPanel";
import { ApiError, fetchAuditLog, type AuditEvent } from "@/lib/api";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

export default function AuditPage() {
  const { isArabic } = useThemeLanguage();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setEvents(await fetchAuditLog(100, token || undefined));
    } catch (e) {
      setEvents(null);
      setErr(
        e instanceof ApiError
          ? isArabic ? e.message_ar : e.message_en
          : isArabic ? "حدث خطأ" : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }, [token, isArabic]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      dir={isArabic ? "rtl" : "ltr"}
      className="min-h-screen bg-[var(--dd-bg)] px-4 py-12 text-[var(--dd-text)]"
    >
      <div className="mx-auto max-w-4xl">
        <div className={cn("mb-2 flex items-center gap-3", isArabic && "flex-row-reverse")}>
          <ShieldCheck className="text-gold" size={28} />
          <h1 className={cn("text-2xl font-semibold text-gold", isArabic ? "font-arabic" : "font-display")}>
            {isArabic ? "سجل التدقيق" : "Audit trail"}
          </h1>
        </div>
        <p className={cn("mb-6 text-sm text-cream-muted", isArabic && "font-arabic")}>
          {isArabic
            ? "كل عملية توليد تُسجَّل — بيانات وصفية فقط، لا صور. الأحدث أولاً."
            : "Every generation is logged — metadata only, never image bytes. Newest first."}
        </p>

        {/* User feedback sits above the render log: the log says what was
            produced, this says how it landed. Same admin page, same styling. */}
        <AdminFeedbackPanel />

        <div className={cn("mb-6 flex flex-wrap items-center gap-3", isArabic && "flex-row-reverse")}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={isArabic ? "رمز الوصول (إن وُجد)" : "Access token (if set)"}
            className={cn(
              "rounded-lg border border-gold/30 bg-[var(--dd-surface)] px-3 py-1.5 text-sm text-cream outline-none placeholder:text-cream-muted focus:border-gold",
              isArabic ? "font-arabic text-right" : "font-ui",
            )}
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-gold px-3 py-1.5 text-sm text-gold transition hover:bg-gold hover:text-[var(--dd-ink)]",
              isArabic ? "font-arabic flex-row-reverse" : "font-ui",
            )}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            {isArabic ? "تحديث" : "Refresh"}
          </button>
        </div>

        {err && <p className={cn("mb-4 text-sm text-[var(--error)]", isArabic && "font-arabic")}>{err}</p>}

        {events && events.length === 0 && (
          <p className={cn("text-sm text-cream-muted", isArabic && "font-arabic")}>
            {isArabic ? "لا سجلات بعد — ولِّد غرفة أولاً." : "No records yet — generate a room first."}
          </p>
        )}

        {events && events.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-gold/20">
            <table className="w-full border-collapse text-sm" dir="ltr">
              <thead>
                <tr className="bg-[var(--dd-surface-strong)] text-left font-ui text-xs uppercase tracking-wide text-cream-muted">
                  <th className="px-3 py-2">time (UTC)</th>
                  <th className="px-3 py-2">event</th>
                  <th className="px-3 py-2">style</th>
                  <th className="px-3 py-2">scale</th>
                  <th className="px-3 py-2">duration</th>
                  <th className="px-3 py-2">job</th>
                  <th className="px-3 py-2">status</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {events.map((e, i) => (
                  <tr key={i} className="border-t border-gold/10 text-cream-soft">
                    <td className="whitespace-nowrap px-3 py-2">{e.ts}</td>
                    <td className="px-3 py-2 text-gold">{e.event}</td>
                    <td className="px-3 py-2">{e.style ?? e.styles?.join(", ") ?? "—"}</td>
                    <td className="px-3 py-2">{e.scale ?? "—"}</td>
                    <td className="px-3 py-2">{e.duration_s != null ? `${e.duration_s}s` : "—"}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2">{e.job_id ?? "—"}</td>
                    <td className="px-3 py-2">
                      {e.ok === false ? (
                        <span className="text-[var(--error)]">✗ {String(e.error ?? "error").slice(0, 40)}</span>
                      ) : (
                        <span className="text-[var(--success)]">✓{e.light ? " (light)" : ""}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
