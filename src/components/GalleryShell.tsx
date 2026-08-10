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
  eyebrow,
  children,
}: {
  title: string;
  subtitle: string;
  /** A1 pagehead: a small mono status line above the title, e.g. a count. */
  eyebrow?: string;
  children: ReactNode;
}) {
  const { isArabic } = useThemeLanguage();

  return (
    <main
      className="relative min-h-screen"
      style={{ background: "var(--bg)" }}
      dir={isArabic ? "rtl" : "ltr"}
    >
      {/* Same wrapper /studio uses — this is what the chrome CSS is scoped to. */}
      <div className="cinema">
        <CinemaChrome />
      </div>

      <IslamicPattern opacity={0.03} />

      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-32">
        <header
          className={cn(
            "mb-10 border-b border-[var(--dd-border)] pb-7",
            isArabic ? "text-right" : "text-left",
          )}
        >
          {eyebrow && (
            <div className="font-editorial-mono text-[10.5px] text-[var(--dd-gold)]">
              {eyebrow}
            </div>
          )}
          <h1
            className={cn(
              "mt-1.5 text-[2.5rem] leading-[1.05] tracking-tight text-[var(--dd-text)]",
              isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
            )}
          >
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--dd-text-secondary)]">{subtitle}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

/**
 * One archive entry, A1-style: a hairline row, not a card. The before/after
 * pair is a single plate split by a gold rule (not two separately-labelled
 * images), the title sits where A1 puts the culture name, and `tag` is the
 * small mono aside A1 uses for a one-off status word ("Shared", "by X").
 * Actions differ per page, so they're passed in.
 */
export function DesignCard({
  beforeUrl,
  afterUrl,
  createdAt,
  title,
  tag,
  rating,
  actions,
}: {
  beforeUrl: string;
  afterUrl: string;
  createdAt: number;
  title?: ReactNode;
  tag?: ReactNode;
  rating?: ReactNode;
  actions?: ReactNode;
}) {
  const { isArabic } = useThemeLanguage();
  return (
    <article className="border-b border-[var(--dd-border)] pb-8 pt-8 first:pt-0">
      <div className="relative grid grid-cols-2 border border-[var(--dd-border)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={isArabic ? "قبل" : "Before"}
          className="block aspect-[4/3] w-full object-cover"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt={isArabic ? "بعد" : "After"}
          className="block aspect-[4/3] w-full border-s border-[var(--dd-gold)] object-cover"
        />
        <span className="font-editorial-mono absolute bottom-2 start-2 rounded bg-[var(--dd-bg)]/70 px-1.5 py-0.5 text-[8.5px] text-[var(--dd-text-soft)]">
          {isArabic ? "قبل · بعد" : "BEFORE · AFTER"}
        </span>
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-baseline justify-between gap-2",
          isArabic && "flex-row-reverse",
        )}
      >
        <div className={cn("flex items-baseline gap-2", isArabic && "flex-row-reverse")}>
          {title && (
            <div
              className={cn(
                "text-2xl leading-none text-[var(--dd-text)]",
                isArabic ? "font-editorial-ar font-normal" : "font-editorial font-normal",
              )}
            >
              {title}
            </div>
          )}
          {tag && (
            <span className="font-editorial-mono text-[9.5px] text-[var(--dd-text-secondary)]">
              {tag}
            </span>
          )}
        </div>
        <time className="font-editorial-mono text-[10px] text-[var(--dd-text-secondary)]">
          {new Date(createdAt * 1000).toLocaleDateString(isArabic ? "ar" : "en-GB", {
            day: "2-digit",
            month: "short",
          })}
        </time>
      </div>

      {rating && <div className="mt-2.5">{rating}</div>}

      {actions && (
        <div className={cn("mt-4 flex flex-wrap items-center gap-2", isArabic && "flex-row-reverse")}>
          {actions}
        </div>
      )}
    </article>
  );
}
