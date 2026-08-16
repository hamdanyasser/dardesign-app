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
      className="app-page relative min-h-screen"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <IslamicPattern opacity={0.018} />

      <section className="app-page-container relative z-10">
        <header
          className={cn(
            "app-page-header",
            isArabic ? "text-right" : "text-left",
          )}
        >
          <h1
            className={cn(
              "app-page-title",
              isArabic ? "font-arabic" : "font-display",
            )}
          >
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--dd-text-secondary)]">
            {subtitle}
          </p>
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
/** Column counts for the comparison plate, by how many images it holds.
 *
 *  Explicit per count rather than an `auto-fit` track: with four tiles a fluid
 *  grid passes through a three-column stage that puts three images on one row
 *  and one orphaned underneath. Two-by-two and one-by-four both read as
 *  deliberate; three-and-a-remainder reads as broken. */
const PLATE_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
};

export function DesignCard({
  beforeUrl,
  afterUrl,
  afterLabel,
  extras,
  createdAt,
  title,
  tag,
  rating,
  actions,
}: {
  beforeUrl: string;
  afterUrl: string;
  /** What `afterUrl` is, when the plate holds more than one output and "after"
   *  no longer identifies it. Falls back to the plain before/after wording. */
  afterLabel?: string;
  /** The other cultures from the same generation, already resolved to a URL and
   *  a display label by the caller — this component holds no culture vocabulary.
   *  Empty or absent keeps the original two-up before/after plate exactly. */
  extras?: Array<{ url: string; label: string }>;
  createdAt: number;
  title?: ReactNode;
  tag?: ReactNode;
  rating?: ReactNode;
  actions?: ReactNode;
}) {
  const { isArabic } = useThemeLanguage();

  // The room, then each reading of it. One tile list drives both shapes so the
  // two-up and the four-up cannot drift apart.
  const tiles = [
    { url: beforeUrl, label: isArabic ? "الأصلية" : "Original", input: true },
    {
      url: afterUrl,
      label: afterLabel ?? (isArabic ? "بعد" : "After"),
      input: false,
    },
    ...(extras ?? []).map((e) => ({ ...e, input: false })),
  ];

  return (
    <article className="border-b border-[var(--dd-border)] pb-8 pt-8 first:pt-0">
      <div
        className={cn(
          "grid border border-[var(--dd-border)]",
          PLATE_COLUMNS[tiles.length] ?? "grid-cols-2",
        )}
      >
        {tiles.map((tile, i) => (
          <figure key={`${tile.url}-${i}`} className="relative m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tile.url}
              alt={tile.label}
              className={cn(
                "block aspect-[4/3] w-full object-cover",
                // The gold rule separates the room from what was made of it;
                // hairlines separate the readings from each other, so three
                // outputs don't read as three unrelated designs.
                i === 1 && "border-s border-[var(--dd-gold)]",
                i > 1 && "border-s border-[var(--dd-border)]",
              )}
            />
            <figcaption
              className={cn(
                "font-editorial-mono absolute bottom-2 start-2 rounded bg-[var(--dd-bg)]/70 px-1.5 py-0.5 text-[8.5px]",
                tile.input
                  ? "text-[var(--dd-text-secondary)]"
                  : "text-[var(--dd-text-soft)]",
              )}
            >
              {tile.label}
            </figcaption>
          </figure>
        ))}
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-baseline justify-between gap-2",
          isArabic && "flex-row-reverse",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3",
            isArabic && "flex-row-reverse",
          )}
        >
          <time className="text-xs text-[var(--dd-text-secondary)]">
            {new Date(createdAt * 1000).toLocaleString(
              isArabic ? "ar" : "en-GB",
            )}
          </time>
          {tag && (
            <span className="font-editorial-mono text-[9.5px] text-[var(--dd-text-secondary)]">
              {tag}
            </span>
          )}
        </div>
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
