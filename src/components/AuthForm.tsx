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
  const { isArabic, theme, toggleTheme, toggleLanguage } = useThemeLanguage();

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
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--dd-bg)] px-4 py-16"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <IslamicPattern opacity={0.02} />

      <div
        className={cn(
          "absolute top-5 z-20 flex items-center gap-2",
          isArabic ? "left-5" : "right-5",
        )}
      >
        <button
          type="button"
          onClick={toggleTheme}
          className={cn("font-editorial-mono", utilityButton)}
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
          {theme === "dark" ? (isArabic ? "نهار" : "Day") : isArabic ? "ليل" : "Night"}
        </button>
        <button
          type="button"
          onClick={toggleLanguage}
          className={cn("font-editorial-mono", utilityButton)}
          lang={isArabic ? "en" : "ar"}
        >
          {isArabic ? "English" : "العربية"}
        </button>
      </div>

      {/* A1: a single centred column, no form-card wrapper. */}
      <div className="relative z-10 w-full max-w-[392px]">
        <Link
          href="/"
          className={cn(
            "mb-10 block text-center text-xl tracking-wide text-[var(--dd-gold)]",
            isArabic ? "font-editorial-ar" : "font-editorial",
          )}
        >
          {isArabic ? "دار · ديزاين" : "Dar · Design"}
        </Link>

        <h1
          className={cn(
            "text-[2.1rem] leading-[1.1] text-[var(--dd-text)]",
            isArabic ? "font-editorial-ar font-normal text-right" : "font-editorial font-normal text-left",
          )}
        >
          {title}
        </h1>
        <p
          className={cn(
            "mt-2 text-sm text-[var(--dd-text-secondary)]",
            isArabic ? "text-right" : "text-left",
          )}
        >
          {subtitle}
        </p>
        <div className="mt-5 border-t border-[var(--dd-border)]" />

        {error && (
          <p role="alert" className="mt-5 border-s-2 border-[var(--error)] ps-3 text-sm text-[var(--error)]">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-2">
          {children}

          <button
            type="submit"
            disabled={pending}
            className="font-editorial-mono mt-8 flex w-full items-center justify-center gap-2 rounded-[2px] bg-[var(--dd-gold)] px-4 py-3 text-xs text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? pendingLabel : submitLabel}
          </button>
        </form>

        <div className="font-editorial-mono mt-6 text-center text-[10px] text-[var(--dd-text-secondary)]">
          {footer}
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
          "font-editorial-mono block text-[9px] text-[var(--dd-text-secondary)]",
          isArabic ? "text-right" : "text-left",
        )}
      >
        {label}
      </label>
      {/* A1: underline only, no box. */}
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1.5 h-[34px] w-full border-0 border-b border-[var(--dd-border)] bg-transparent text-[15px] text-[var(--dd-text)] outline-none transition placeholder:text-[var(--dd-text-secondary)]/60 focus:border-[var(--dd-gold)]",
          isArabic ? "text-right" : "text-left",
        )}
        // Email and phone read left-to-right even in an RTL layout.
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
      />
    </div>
  );
}
