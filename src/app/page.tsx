"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Menu,
  MoonStar,
  SunMedium,
  UploadCloud,
  X,
} from "lucide-react";
import type { StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

const styleOrder: StyleId[] = ["lebanese", "khaleeji", "moroccan"];

const styleVisuals: Record<
  StyleId,
  { gradient: string; tilt: "left" | "center" | "right"; featured: boolean }
> = {
  lebanese: {
    gradient: "var(--dd-style-lebanese)",
    tilt: "left",
    featured: false,
  },
  khaleeji: {
    gradient: "var(--dd-style-khaleeji)",
    tilt: "center",
    featured: true,
  },
  moroccan: {
    gradient: "var(--dd-style-moroccan)",
    tilt: "right",
    featured: false,
  },
};

function useReveal() {
  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal")
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -10% 0px",
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);
}

function LogoLockup({ isArabic, engine }: { isArabic: boolean; engine: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-xl font-semibold tracking-[0.18em] text-[var(--dd-text)] sm:text-2xl">
        <span className="text-[var(--dd-gold)]">D</span>ar
        <span className="text-[var(--dd-gold)]">D</span>esign
      </span>
      <span
        className={cn(
          "mt-1 text-[0.68rem] uppercase tracking-[0.3em] text-[var(--dd-text-secondary)]",
          isArabic && "font-arabic normal-case tracking-[0.18em]"
        )}
      >
        {engine}
      </span>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  isArabic,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  isArabic: boolean;
  align?: "center" | "start";
}) {
  const isStart = align === "start";

  return (
    <div
      className={cn(
        "mx-auto mb-14 max-w-3xl",
        isStart ? "text-start" : "text-center"
      )}
    >
      <div
        className={cn(
          "mb-5 flex items-center gap-3 text-sm uppercase tracking-[0.35em] text-[var(--dd-gold)]",
          isStart ? "justify-start" : "justify-center",
          isArabic && "font-arabic normal-case tracking-[0.18em]"
        )}
      >
        <span className="h-px w-10 bg-[var(--dd-gold)]" />
        <span>{eyebrow}</span>
      </div>
      <h2
        className={cn(
          "text-balance text-3xl font-semibold leading-tight text-[var(--dd-text)] sm:text-4xl lg:text-5xl",
          isArabic ? "font-arabic" : "font-display"
        )}
      >
        {title}
      </h2>
    </div>
  );
}

export default function Home() {
  const { copy, isArabic, theme, toggleLanguage, toggleTheme } =
    useThemeLanguage();
  const [menuOpen, setMenuOpen] = useState(false);

  useReveal();

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const navLinks = copy.landing.nav.links;
  const metrics = copy.landing.socialProof.metrics;
  const styles = useMemo(
    () =>
      styleOrder.map((styleId) => ({
        id: styleId,
        ...copy.shared.styles[styleId],
        ...styleVisuals[styleId],
      })),
    [copy.shared.styles]
  );

  return (
    <main className="bg-[var(--dd-bg)] text-[var(--dd-text)]">
      <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
        <div className="glass-panel relative mx-auto max-w-7xl overflow-hidden rounded-full">
          <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6">
            <Link
              href="#home"
              className="transition-all duration-300 hover:opacity-85"
              onClick={() => setMenuOpen(false)}
            >
              <LogoLockup isArabic={isArabic} engine={copy.brand.engine} />
            </Link>

            <nav className="hidden items-center gap-8 lg:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "text-sm font-medium text-[var(--dd-text-secondary)] transition-all duration-300 hover:text-[var(--dd-text)]",
                    isArabic && "font-arabic text-base"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLanguage}
                className={cn(
                  "rounded-full border border-[var(--dd-border)] px-4 py-2 text-sm font-medium text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]",
                  isArabic && "font-arabic text-base"
                )}
              >
                {copy.controls.languageToggle}
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  theme === "dark"
                    ? copy.controls.switchToLight
                    : copy.controls.switchToDark
                }
                className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[var(--dd-border)] text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]"
              >
                <SunMedium
                  className={cn(
                    "absolute size-4 transition-all duration-300",
                    theme === "light"
                      ? "rotate-0 scale-100"
                      : "rotate-90 scale-0"
                  )}
                />
                <MoonStar
                  className={cn(
                    "absolute size-4 transition-all duration-300",
                    theme === "dark"
                      ? "rotate-0 scale-100"
                      : "-rotate-90 scale-0"
                  )}
                />
              </button>

              <button
                type="button"
                aria-label={menuOpen ? copy.controls.closeMenu : copy.controls.openMenu}
                onClick={() => setMenuOpen((current) => !current)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--dd-border)] text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)] lg:hidden"
              >
                {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
          <div className="gold-line absolute inset-x-0 bottom-0" />
        </div>

        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/45 backdrop-blur-sm transition-all duration-300 lg:hidden",
            menuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => setMenuOpen(false)}
        />
        <aside
          className={cn(
            "glass-panel fixed bottom-4 top-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-[2rem] p-6 shadow-2xl transition-all duration-300 lg:hidden",
            isArabic ? "left-4" : "right-4",
            menuOpen
              ? "translate-x-0 opacity-100"
              : isArabic
              ? "-translate-x-[110%] opacity-0"
              : "translate-x-[110%] opacity-0"
          )}
        >
          <div className="flex items-center justify-between">
            <LogoLockup isArabic={isArabic} engine={copy.brand.engine} />
            <button
              type="button"
              aria-label={copy.controls.closeMenu}
              onClick={() => setMenuOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--dd-border)] text-[var(--dd-text)]"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-10 flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-2xl border border-transparent px-4 py-3 text-lg text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-border)] hover:bg-[color:color-mix(in_srgb,var(--dd-surface)_92%,transparent)]",
                  isArabic ? "font-arabic text-right" : "font-display"
                )}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={toggleLanguage}
              className={cn(
                "rounded-2xl border border-[var(--dd-border)] px-4 py-3 text-sm font-medium text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]",
                isArabic && "font-arabic text-base"
              )}
            >
              {copy.controls.languageToggle}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-2xl border border-[var(--dd-border)] px-4 py-3 text-sm font-medium text-[var(--dd-text)] transition-all duration-300 hover:border-[var(--dd-gold)] hover:text-[var(--dd-gold)]"
            >
              {theme === "dark" ? copy.controls.switchToLight : copy.controls.switchToDark}
            </button>
          </div>
        </aside>
      </header>

      <section
        id="home"
        className="hero-mesh noise-overlay relative flex min-h-screen items-center overflow-hidden px-4 pb-20 pt-28 sm:px-6 lg:px-8"
      >
        <div className="floating-shape floating-shape--hexagon left-[8%] top-[18%] h-24 w-24 opacity-75 [animation-delay:0s]" />
        <div className="floating-shape floating-shape--diamond right-[10%] top-[28%] h-16 w-16 opacity-70 [animation-delay:1.5s]" />
        <div className="floating-shape floating-shape--circle bottom-[16%] left-[18%] h-20 w-20 opacity-65 [animation-delay:3s]" />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center">
          <div className="mx-auto max-w-4xl text-center">
            <p
              className={cn(
                "animate-fade-in-up text-xs uppercase tracking-[0.45em] text-[var(--dd-gold)] sm:text-sm",
                isArabic && "font-arabic normal-case tracking-[0.22em]"
              )}
            >
              {copy.brand.engine}
            </p>

            <h1
              className={cn(
                "animate-fade-in-up-d1 mt-6 text-balance text-4xl font-semibold leading-[1.05] text-[var(--dd-text)] sm:text-5xl lg:text-7xl",
                isArabic ? "font-arabic" : "font-display"
              )}
            >
              {copy.landing.hero.title}
            </h1>

            <p
              className={cn(
                "animate-fade-in-up-d2 mx-auto mt-6 max-w-3xl text-balance text-base leading-8 text-[var(--dd-text-secondary)] sm:text-lg lg:text-xl",
                isArabic && "font-arabic"
              )}
            >
              {copy.landing.hero.subtitle}
            </p>

            <div
              className={cn(
                "animate-fade-in-up-d3 mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row",
                isArabic && "sm:flex-row-reverse"
              )}
            >
              <Link
                href="/transform"
                className={cn(
                  "shimmer-btn inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-[var(--dd-ink)] shadow-[0_18px_45px_rgba(212,175,55,0.14)] transition-all duration-300",
                  isArabic ? "font-arabic" : "font-ui"
                )}
              >
                {copy.landing.hero.primaryCta}
                <ArrowRight className={cn("size-4", isArabic && "rotate-180")} />
              </Link>

              <Link
                href="#preview"
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--dd-gold)] px-7 py-3.5 text-base font-semibold text-[var(--dd-gold)] transition-all duration-300 hover:bg-[color:color-mix(in_srgb,var(--dd-gold)_10%,transparent)]",
                  isArabic ? "font-arabic" : "font-ui"
                )}
              >
                {copy.landing.hero.secondaryCta}
              </Link>

              <Link
                href="/atelier"
                className={cn(
                  "group inline-flex items-center gap-2 px-2 py-3.5 text-sm tracking-[0.32em] uppercase text-[var(--dd-text-secondary)] transition-colors duration-300 hover:text-[var(--dd-gold)]",
                  isArabic ? "font-arabic" : "font-ui"
                )}
                aria-label={isArabic ? "ادخل أتيليه دار" : "Enter the Atelier"}
              >
                <span className="h-px w-7 bg-current transition-all duration-300 group-hover:w-10" />
                {isArabic ? "أتيليه دار" : "The Atelier"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="reveal px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="gold-line" />
          <div className="glass-panel mt-6 rounded-[2rem] px-5 py-7 sm:px-8">
            <p
              className={cn(
                "text-center text-sm uppercase tracking-[0.28em] text-[var(--dd-text-secondary)]",
                isArabic && "font-arabic normal-case tracking-[0.16em]"
              )}
            >
              {copy.landing.socialProof.title}
            </p>

            <div className="social-marquee mt-6 md:hidden">
              <div className="social-marquee-track gap-3">
                {[...metrics, ...metrics].map((metric, index) => (
                  <span
                    key={`${metric}-${index}`}
                    className={cn(
                      "rounded-full border border-[var(--dd-border)] px-4 py-2 text-sm whitespace-nowrap text-[var(--dd-text)]",
                      isArabic && "font-arabic"
                    )}
                  >
                    {metric}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 hidden flex-wrap items-center justify-center gap-3 md:flex">
              {metrics.map((metric) => (
                <span
                  key={metric}
                  className={cn(
                    "rounded-full border border-[var(--dd-border)] px-4 py-2 text-sm text-[var(--dd-text)]",
                    isArabic && "font-arabic"
                  )}
                >
                  {metric}
                </span>
              ))}
            </div>
          </div>
          <div className="gold-line mt-6" />
        </div>
      </section>

      <section
        id="how-it-works"
        className="reveal px-4 py-24 sm:px-6 lg:px-8 lg:py-28"
      >
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow={copy.landing.howItWorks.eyebrow}
            title={copy.landing.howItWorks.title}
            isArabic={isArabic}
          />

          <div className="relative">
            <div className="absolute left-[16.66%] right-[16.66%] top-1/2 hidden h-px -translate-y-1/2 bg-[linear-gradient(to_right,transparent,var(--dd-gold),transparent)] lg:block" />
            <div className="grid gap-6 lg:grid-cols-3">
              {copy.landing.howItWorks.steps.map((step) => (
                <article
                  key={step.number}
                  className="how-card rounded-[2rem] p-8 sm:p-10"
                >
                  <span className="pointer-events-none absolute inset-y-0 right-6 flex items-center text-[7rem] font-semibold leading-none text-[color:color-mix(in_srgb,var(--dd-gold)_10%,transparent)] sm:text-[8rem]">
                    {step.number}
                  </span>
                  <div className="relative z-10">
                    <div
                      className={cn(
                        "mb-6 flex items-center gap-4",
                        isArabic && "flex-row-reverse"
                      )}
                    >
                      <span className="text-3xl">{step.icon}</span>
                      <span className="font-display text-2xl font-semibold text-[var(--dd-gold)]">
                        {step.number}
                      </span>
                    </div>
                    <h3
                      className={cn(
                        "text-2xl font-semibold text-[var(--dd-text)]",
                        isArabic ? "font-arabic text-right" : "font-display text-left"
                      )}
                    >
                      {step.title}
                    </h3>
                    <p
                      className={cn(
                        "mt-4 text-base leading-8 text-[var(--dd-text-secondary)]",
                        isArabic && "font-arabic text-right"
                      )}
                    >
                      {step.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="styles" className="reveal px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow={copy.landing.styles.eyebrow}
            title={copy.landing.styles.title}
            isArabic={isArabic}
          />

          <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
            {styles.map((style) => (
              <article
                key={style.id}
                data-tilt={style.tilt}
                className={cn(
                  "style-showcase-card rounded-[2rem]",
                  style.featured && "is-featured"
                )}
              >
                <div
                  className="relative h-60 overflow-hidden rounded-t-[2rem]"
                  style={{ background: style.gradient }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.28),transparent_30%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.12),transparent_36%)]" />
                  <div className="absolute bottom-5 left-5 rounded-full border border-white/25 bg-black/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/80 backdrop-blur">
                    {style.flag}
                  </div>
                </div>

                <div className="p-8">
                  <h3
                    className={cn(
                      "text-3xl font-semibold text-[var(--dd-gold)]",
                      isArabic ? "font-arabic text-right" : "font-display text-left"
                    )}
                  >
                    {style.name}
                  </h3>
                  <p
                    className={cn(
                      "mt-3 text-sm uppercase tracking-[0.28em] text-[var(--dd-text-secondary)]",
                      isArabic && "font-arabic normal-case tracking-[0.16em] text-right"
                    )}
                  >
                    {style.origin}
                  </p>
                  <p
                    className={cn(
                      "mt-5 text-base leading-8 text-[var(--dd-text-secondary)]",
                      isArabic && "font-arabic text-right"
                    )}
                  >
                    {style.landingDescription}
                  </p>

                  <div
                    className={cn(
                      "mt-6 flex flex-wrap gap-2",
                      isArabic && "justify-end"
                    )}
                  >
                    {style.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "rounded-full border border-[var(--dd-border)] bg-[color:color-mix(in_srgb,var(--dd-surface)_92%,transparent)] px-3 py-1.5 text-sm text-[var(--dd-text)]",
                          isArabic && "font-arabic"
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={cn(
                      "mt-8 inline-flex items-center gap-2 text-sm font-medium text-[var(--dd-gold)] transition-all duration-300 hover:gap-3",
                      isArabic && "font-arabic"
                    )}
                  >
                    {style.learnMore}
                    <ArrowRight className={cn("size-4", isArabic && "rotate-180")} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="preview"
        className="reveal px-4 py-24 sm:px-6 lg:px-8 lg:py-28"
      >
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow={copy.landing.preview.eyebrow}
            title={copy.landing.preview.title}
            isArabic={isArabic}
          />

          <div className="glass-panel relative overflow-hidden rounded-[2.5rem] p-5 sm:p-8 lg:p-10">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="relative min-h-[20rem] overflow-hidden rounded-[2rem] border border-[var(--dd-border)]">
                <div
                  className="absolute inset-0"
                  style={{ background: "var(--dd-before-gradient)" }}
                />
                <span className="absolute left-5 top-5 rounded-full bg-[var(--dd-glass-bg)] px-4 py-2 text-xs uppercase tracking-[0.28em] text-[var(--dd-text)]">
                  {copy.landing.preview.before}
                </span>
              </div>

              <div className="relative min-h-[20rem] overflow-hidden rounded-[2rem] border border-[var(--dd-border)]">
                <div
                  className="absolute inset-0"
                  style={{ background: "var(--dd-after-gradient)" }}
                />
                <span className="absolute left-5 top-5 rounded-full bg-white/15 px-4 py-2 text-xs uppercase tracking-[0.28em] text-[var(--dd-ink)] backdrop-blur">
                  {copy.landing.preview.after}
                </span>
              </div>
            </div>

            <div className="pointer-events-none absolute bottom-10 left-1/2 top-10 hidden -translate-x-1/2 items-center justify-center lg:flex">
              <div className="relative h-full w-px bg-[linear-gradient(to_bottom,transparent,var(--dd-gold),transparent)]">
                <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--dd-gold)_70%,transparent)] bg-[var(--dd-gold)] text-[var(--dd-ink)] shadow-[0_18px_45px_rgba(212,175,55,0.25)]">
                  ↔
                </span>
              </div>
            </div>
          </div>

          <p
            className={cn(
              "mx-auto mt-8 max-w-3xl text-center text-lg leading-8 text-[var(--dd-text-secondary)]",
              isArabic && "font-arabic"
            )}
          >
            {copy.landing.preview.description}
          </p>
        </div>
      </section>

      <section className="reveal px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-5xl text-center">
          <h2
            className={cn(
              "text-4xl font-semibold text-[var(--dd-text)] sm:text-5xl",
              isArabic ? "font-arabic" : "font-display"
            )}
          >
            {copy.landing.uploadCta.title}
          </h2>

          <Link
            href="/transform"
            className="upload-zone-dashed glass-panel mt-10 block rounded-[2rem] p-10 text-center transition-all duration-300 hover:scale-[1.01] sm:p-14"
          >
            <UploadCloud className="mx-auto size-14 text-[var(--dd-gold)]" />
            <p
              className={cn(
                "mt-6 text-lg font-medium text-[var(--dd-text)] sm:text-xl",
                isArabic && "font-arabic"
              )}
            >
              {copy.landing.uploadCta.dropzone}
            </p>
            <p
              className={cn(
                "mt-3 text-sm text-[var(--dd-text-secondary)] sm:text-base",
                isArabic && "font-arabic"
              )}
            >
              {copy.landing.uploadCta.support}
            </p>
          </Link>

          <p
            className={cn(
              "mt-6 text-sm uppercase tracking-[0.24em] text-[var(--dd-text-secondary)]",
              isArabic && "font-arabic normal-case tracking-[0.16em]"
            )}
          >
            {copy.landing.uploadCta.footnote}
          </p>
        </div>
      </section>

      <footer id="contact" className="reveal px-4 pb-10 pt-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="gold-line mb-8" />

          <div className="grid gap-10 rounded-[2.5rem] border border-[var(--dd-border)] bg-[color:color-mix(in_srgb,var(--dd-surface)_95%,transparent)] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.12)] lg:grid-cols-[1.2fr_0.8fr_1fr] lg:p-10">
            <div>
              <LogoLockup isArabic={isArabic} engine={copy.brand.engine} />
              <p
                className={cn(
                  "mt-6 max-w-md text-base leading-8 text-[var(--dd-text-secondary)]",
                  isArabic && "font-arabic"
                )}
              >
                {copy.shared.footer.about}
              </p>
            </div>

            <div>
              <h3
                className={cn(
                  "text-sm uppercase tracking-[0.32em] text-[var(--dd-gold)]",
                  isArabic && "font-arabic normal-case tracking-[0.16em]"
                )}
              >
                {copy.shared.footer.quickLinksTitle}
              </h3>
              <div className="mt-6 flex flex-col gap-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "text-base text-[var(--dd-text-secondary)] transition-all duration-300 hover:text-[var(--dd-text)]",
                      isArabic && "font-arabic"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <h3
                className={cn(
                  "text-sm uppercase tracking-[0.32em] text-[var(--dd-gold)]",
                  isArabic && "font-arabic normal-case tracking-[0.16em]"
                )}
              >
                {copy.shared.footer.techTitle}
              </h3>
              <p
                className={cn(
                  "mt-6 text-base leading-8 text-[var(--dd-text)]",
                  isArabic && "font-arabic"
                )}
              >
                {copy.shared.footer.poweredBy}
              </p>
              <p className="mt-4 text-sm uppercase tracking-[0.24em] text-[var(--dd-text-secondary)]">
                {copy.shared.footer.techStack}
              </p>
            </div>
          </div>

          <p
            className={cn(
              "mt-6 text-center text-sm text-[var(--dd-text-secondary)]",
              isArabic && "font-arabic"
            )}
          >
            {copy.shared.footer.rights}
          </p>
        </div>
      </footer>
    </main>
  );
}
