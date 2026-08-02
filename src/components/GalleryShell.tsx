"use client";

/* ============================================================
   Page shell for History and Others' Work.

   The navbar's styles live under `.cinema` in cinema.css, so
   CinemaChrome renders unstyled unless it sits inside that
   wrapper — which is what made the first history page look
   wrong. Both gallery pages go through here so they can't drift
   apart from each other, or from /studio.
   ============================================================ */

import type { ReactNode } from "react";
import CinemaChrome from "@/components/cinema/CinemaChrome";
import IslamicPattern from "@/components/islamic-pattern";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

export default function GalleryShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { isArabic } = useThemeLanguage();

  return (
    <main
      className="relative min-h-screen"
      style={{ background: "var(--ink)" }}
      dir={isArabic ? "rtl" : "ltr"}
    >
      {/* Same wrapper /studio uses — this is what the chrome CSS is scoped to. */}
      <div className="cinema">
        <CinemaChrome />
      </div>

      <IslamicPattern opacity={0.03} />

      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-32">
        <header className={cn("mb-8", isArabic ? "text-right" : "text-left")}>
          <h1
            className={cn(
              "text-2xl font-semibold text-[var(--dd-gold)]",
              isArabic ? "font-arabic" : "font-display",
            )}
          >
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--dd-text-secondary)]">{subtitle}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

/** One before/after card. Actions differ per page, so they're passed in. */
export function DesignCard({
  beforeUrl,
  afterUrl,
  createdAt,
  caption,
  actions,
}: {
  beforeUrl: string;
  afterUrl: string;
  createdAt: number;
  caption?: ReactNode;
  actions?: ReactNode;
}) {
  const { isArabic } = useThemeLanguage();
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--dd-gold-dim)]/25 bg-[var(--dd-surface)]">
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {[
          { url: beforeUrl, label: isArabic ? "قبل" : "Before" },
          { url: afterUrl, label: isArabic ? "بعد" : "After" },
        ].map((side) => (
          <figure key={side.label} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={side.url}
              alt={side.label}
              className="block aspect-[4/3] w-full object-cover"
            />
            <figcaption className="absolute bottom-2 start-2 rounded-md bg-[var(--dd-bg)]/75 px-2 py-0.5 text-xs text-[var(--dd-text-soft)]">
              {side.label}
            </figcaption>
          </figure>
        ))}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
          isArabic && "flex-row-reverse",
        )}
      >
        <div className={cn("flex items-center gap-3", isArabic && "flex-row-reverse")}>
          <time className="text-xs text-[var(--dd-text-secondary)]">
            {new Date(createdAt * 1000).toLocaleString(isArabic ? "ar" : "en-GB")}
          </time>
          {caption}
        </div>
        {actions && (
          <div className={cn("flex items-center gap-2", isArabic && "flex-row-reverse")}>
            {actions}
          </div>
        )}
      </div>
    </article>
  );
}
