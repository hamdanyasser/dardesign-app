"use client";

/* ============================================================
   Shared shell for the sign-in and sign-up pages.

   One component for both so the two screens can never drift apart
   visually — they differ only in their fields and their action.
   Gold-on-charcoal, RTL-aware, matching the rest of the app.
   ============================================================ */

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import IslamicPattern from "@/components/islamic-pattern";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  footer: ReactNode;
  children: ReactNode;
}

export default function AuthForm({
  title,
  subtitle,
  submitLabel,
  pendingLabel,
  pending,
  error,
  onSubmit,
  footer,
  children,
}: Props) {
  const { isArabic, theme, toggleTheme, toggleLanguage, t } =
    useThemeLanguage();

  /* P1-6: these two screens rendered no chrome at all, so a logged-out visitor
     could not switch theme or language and had no route back except the
     wordmark. Deliberately not CinemaChrome — that is scoped to .cinema and is
     far too heavy for a centred auth column. A1: mono chip, not a pill. */
  const utilityButton =
    "rounded-[2px] border border-[var(--dd-border)] px-2.5 py-1.5 text-[10px] text-[var(--dd-text-secondary)] " +
    "transition-colors hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)] " +
    "focus-visible:border-[var(--dd-gold)] focus-visible:text-[var(--dd-gold)]";

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[var(--dd-bg)] px-4 py-16"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-24 h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--dd-gold)_14%,transparent)] blur-3xl" />
        <div className="absolute right-0 top-1/4 h-72 w-72 rounded-full bg-[rgba(255,255,255,0.08)] blur-3xl" />
      </div>
      <IslamicPattern opacity={0.04} />

      <div className="relative z-10 mx-auto grid w-full max-w-[1080px] gap-8 lg:grid-cols-[0.95fr_0.9fr]">
        <aside className="rounded-[2rem] border border-[var(--dd-border)] bg-[var(--dd-surface-strong)] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.18)]">
          <span className="inline-flex rounded-full border border-[var(--dd-gold)]/30 bg-[var(--dd-gold)]/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[var(--dd-gold)]">
            {t("Studio access", "دخول الاستوديو")}
          </span>
          <h2
            className={cn(
              "mt-6 text-4xl leading-tight text-[var(--dd-text)]",
              isArabic
                ? "font-editorial-ar font-normal text-right"
                : "font-editorial font-normal text-left",
            )}
          >
            {t("Design rooms with confidence", "صمم الغرف بثقة")}
          </h2>
          <p
            className={cn(
              "mt-4 max-w-xl text-sm leading-7 text-[var(--dd-text-secondary)]",
              isArabic ? "text-right" : "text-left",
            )}
          >
            {t(
              "Your saved designs, cultural options, and luxury interiors—all in one place.",
              "تصاميمك المحفوظة، الأنماط الثقافية، والديكورات الفاخرة كلها في مكان واحد.",
            )}
          </p>

          <div className="mt-10 space-y-4">
            {[
              t(
                "Explore three curated Arabic styles",
                "استكشف ثلاثة أنماط عربية مصممة",
              ),
              t(
                "Save every design and return anytime",
                "احفظ كل تصميم وارجع إليه متى تشاء",
              ),
              t("Edit, share, and refine with ease", "حرّر وشارك وصقّل بسهولة"),
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--dd-gold)]" />
                <p className="text-sm text-[var(--dd-text-secondary)]">
                  {item}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-[1.75rem] border border-[var(--dd-gold)]/20 bg-[var(--dd-gold)]/5 p-5 text-sm text-[var(--dd-text)]">
            {t(
              "Sign in or register to unlock your own design archive.",
              "سجّل الدخول أو أنشئ حساباً لفتح أرشيف التصميم الخاص بك.",
            )}
          </div>
        </aside>

        <div className="relative rounded-[2rem] border border-[var(--dd-border)] bg-[var(--dd-surface)] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.14)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/"
              className={cn(
                "text-sm tracking-[0.3em] text-[var(--dd-gold)] uppercase",
                isArabic ? "font-editorial-ar" : "font-editorial",
              )}
            >
              {isArabic ? "دار · ديزاين" : "Dar · Design"}
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className={cn(
                  "font-editorial-mono rounded-[1rem] border border-[var(--dd-border)] px-3 py-2 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]",
                )}
                aria-label={
                  theme === "dark"
                    ? isArabic
                      ? "الوضع النهاري"
                      : "Switch to light"
                    : isArabic
                      ? "الوضع الليلي"
                      : "Switch to dark"
                }
              >
                {theme === "dark" ? "◐" : "◑"}{" "}
                {theme === "dark"
                  ? isArabic
                    ? "نهار"
                    : "Day"
                  : isArabic
                    ? "ليل"
                    : "Night"}
              </button>
              <button
                type="button"
                onClick={toggleLanguage}
                className={cn(
                  "font-editorial-mono rounded-[1rem] border border-[var(--dd-border)] px-3 py-2 text-[10px] text-[var(--dd-text-secondary)] transition hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]",
                )}
                lang={isArabic ? "en" : "ar"}
              >
                {isArabic ? "English" : "العربية"}
              </button>
            </div>
          </div>

          <h1
            className={cn(
              "mt-8 text-4xl leading-tight text-[var(--dd-text)]",
              isArabic
                ? "font-editorial-ar font-normal text-right"
                : "font-editorial font-normal text-left",
            )}
          >
            {title}
          </h1>
          <p
            className={cn(
              "mt-4 max-w-[34rem] text-sm leading-7 text-[var(--dd-text-secondary)]",
              isArabic ? "text-right" : "text-left",
            )}
          >
            {subtitle}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-3xl border border-[var(--error)]/15 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]"
            >
              {error}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {children}

            <button
              type="submit"
              disabled={pending}
              className="font-editorial-mono mt-4 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-gradient-to-r from-[var(--dd-gold)] to-[var(--dd-gold-hover)] px-5 py-3 text-xs text-[var(--dd-ink)] shadow-[0_15px_35px_color-mix(in_srgb,var(--dd-gold)_18%,transparent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? pendingLabel : submitLabel}
            </button>
          </form>

          <div className="font-editorial-mono mt-6 text-center text-[11px] text-[var(--dd-text-secondary)]">
            {footer}
          </div>
        </div>
      </div>
    </main>
  );
}

/** One labelled input, styled once so every field on both pages matches. */
export function AuthField({
  id,
  label,
  type = "text",
  value,
  onChange,
  required = true,
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  const { isArabic } = useThemeLanguage();
  return (
    <div className="mt-[18px] first:mt-0">
      <label
        htmlFor={id}
        className={cn(
          "font-editorial-mono block text-[10px] uppercase tracking-[0.18em] text-[var(--dd-text-secondary)]",
          isArabic ? "text-right" : "text-left",
        )}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-2 h-12 w-full rounded-[1rem] border border-[var(--dd-border)] bg-[var(--dd-surface-strong)] px-4 text-[15px] text-[var(--dd-text)] outline-none transition duration-200 placeholder:text-[var(--dd-text-secondary)]/60 focus:border-[var(--dd-gold)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--dd-gold)_12%,transparent)]",
          isArabic ? "text-right" : "text-left",
        )}
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
      />
    </div>
  );
}
