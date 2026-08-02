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
  const { isArabic } = useThemeLanguage();

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--dd-bg)] px-4 py-16"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <IslamicPattern opacity={0.035} />
      <div className="hero-mesh pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className={cn(
            "mb-8 block text-center text-xl tracking-wide text-[var(--dd-gold)]",
            isArabic ? "font-arabic" : "font-display",
          )}
        >
          {isArabic ? "دار · ديزاين" : "Dar · Design"}
        </Link>

        <div className="glass-panel rounded-2xl border border-[var(--dd-gold-dim)]/30 p-7">
          <h1
            className={cn(
              "text-2xl font-semibold text-[var(--dd-text)]",
              isArabic ? "font-arabic text-right" : "font-display text-left",
            )}
          >
            {title}
          </h1>
          <p
            className={cn(
              "mt-1.5 text-sm text-[var(--dd-text-secondary)]",
              isArabic ? "text-right" : "text-left",
            )}
          >
            {subtitle}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]"
            >
              {error}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {children}

            <button
              type="submit"
              disabled={pending}
              className="shimmer-btn flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--dd-gold)] px-4 py-2.5 font-medium text-[var(--dd-ink)] transition hover:bg-[var(--dd-gold-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? pendingLabel : submitLabel}
            </button>
          </form>

          <div className="mt-6 border-t border-[var(--dd-gold-dim)]/20 pt-5 text-center text-sm text-[var(--dd-text-secondary)]">
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
    <div>
      <label
        htmlFor={id}
        className={cn(
          "mb-1.5 block text-sm text-[var(--dd-text-soft)]",
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
          "w-full rounded-lg border border-[var(--dd-gold-dim)]/35 bg-[var(--dd-surface)] px-3 py-2.5 text-[var(--dd-text)] outline-none transition placeholder:text-[var(--dd-text-secondary)]/60 focus:border-[var(--dd-gold)]",
          isArabic ? "text-right" : "text-left",
        )}
        // Email and phone read left-to-right even in an RTL layout.
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
      />
    </div>
  );
}
