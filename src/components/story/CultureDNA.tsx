"use client";

import { useId } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import type {
  CultureDnaCategory,
  CultureDnaTerm,
  LocalizedText,
  StoryCulture,
} from "@/components/story/types";
import {
  CULTURE_DNA_CATEGORIES,
  getCultureDnaSelection,
} from "@/components/story/cultureData";
import styles from "./CultureDNA.module.css";

const CATEGORY_LABELS: Record<CultureDnaCategory, LocalizedText> = {
  architectural: { en: "Architectural vocabulary", ar: "المفردات المعمارية" },
  materials: { en: "Materials", ar: "المواد" },
  color_palette: { en: "Colour palette", ar: "لوحة الألوان" },
  lighting: { en: "Lighting", ar: "الإضاءة" },
  furniture: { en: "Furniture", ar: "الأثاث" },
  textiles: { en: "Textiles", ar: "المنسوجات" },
  ornamentation: { en: "Ornamentation", ar: "الزخرفة" },
};

const COPY = {
  eyebrow: {
    en: "Culture DNA · current project knowledge",
    ar: "البصمة الثقافية · معرفة المشروع الحالية",
  },
  title: {
    single: { en: "The cultural lens", ar: "العدسة الثقافية" },
    all: { en: "Three lenses, read together", ar: "ثلاث عدسات، تُقرأ معاً" },
  },
  description: {
    single: {
      en: "Materials, palette and design language drawn directly from DAR's current project ontology. These are design cues, not an authenticity score.",
      ar: "مواد وألوان ولغة تصميم مأخوذة مباشرة من أنطولوجيا مشروع دار الحالية. هذه إشارات تصميمية وليست تقييماً للأصالة.",
    },
    all: {
      en: "An editorial synthesis of the Lebanese, Khaleeji and Moroccan project profiles. The backend still treats them as three separate cultures; this is not a blended generation style.",
      ar: "توليف تحريري لملفات المشروع اللبنانية والخليجية والمغربية. يتعامل النظام الخلفي معها كثلاث ثقافات منفصلة؛ وليست نمط توليد مدمجاً.",
    },
  },
  source: { en: "Source", ar: "المصدر" },
  sourceValue: { en: "Current project ontology", ar: "أنطولوجيا المشروع الحالية" },
  mode: { en: "Reading", ar: "طريقة القراءة" },
  modeValue: {
    single: { en: "One culture profile", ar: "ملف ثقافي واحد" },
    all: { en: "Editorial synthesis · three separate profiles", ar: "توليف تحريري · ثلاثة ملفات منفصلة" },
  },
  review: {
    verified: { en: "Marked verified in project ontology", ar: "موسوم كمتحقق منه في أنطولوجيا المشروع" },
    pending: { en: "Awaiting cultural review", ar: "بانتظار المراجعة الثقافية" },
    unspecified: { en: "Review state not recorded", ar: "حالة المراجعة غير مسجّلة" },
  },
  reviewMethod: {
    en: "These labels reproduce each term's current verified field; they do not independently confirm cultural review. They are provenance notes, never cultural-accuracy scores.",
    ar: "تعكس هذه التسميات حقل التحقق الحالي لكل مصطلح، ولا تؤكد المراجعة الثقافية بشكل مستقل. وهي ملاحظات مصدر، وليست درجات للدقة الثقافية.",
  },
  additional: {
    en: (count: number) => `${count} additional ontology ${count === 1 ? "term" : "terms"}`,
    ar: (count: number) => `${count} ${count === 1 ? "مصطلح إضافي" : "مصطلحات إضافية"} في الأنطولوجيا`,
  },
} as const;

export interface CultureDNAProps {
  /** `all` is a side-by-side editorial synthesis, never a backend culture id. */
  culture: StoryCulture;
  /** Defaults to all seven canonical ontology categories, in canonical order. */
  categories?: readonly CultureDnaCategory[];
  /**
   * Limit per culture and category. `null` shows every term. Defaults to five
   * for one culture and two per profile for the three-profile synthesis.
   */
  maxTermsPerCategory?: number | null;
  /** Show the ontology's term-level verified state. Defaults to true. */
  showReviewState?: boolean;
  /** Print palette hex values next to their swatches. Defaults to true. */
  showHexValues?: boolean;
  /** Optional localized editorial overrides. */
  title?: LocalizedText;
  description?: LocalizedText;
  id?: string;
  className?: string;
}

function reviewKey(term: CultureDnaTerm): keyof typeof COPY.review {
  if (term.verified === true) return "verified";
  if (term.verified === false) return "pending";
  return "unspecified";
}

export function CultureDNA({
  culture,
  categories = CULTURE_DNA_CATEGORIES,
  maxTermsPerCategory,
  showReviewState = true,
  showHexValues = true,
  title,
  description,
  id,
  className,
}: CultureDNAProps) {
  const { isArabic } = useThemeLanguage();
  const generatedId = useId();
  const headingId = `${id ?? generatedId}-title`;
  const selection = getCultureDnaSelection(culture);
  const isSynthesis = selection.mode === "editorial-synthesis";
  const defaultTermLimit = isSynthesis ? 2 : 5;
  const termLimit = maxTermsPerCategory === null
    ? null
    : typeof maxTermsPerCategory === "number" && Number.isFinite(maxTermsPerCategory)
      ? Math.max(1, Math.floor(maxTermsPerCategory))
      : defaultTermLimit;
  const visibleCategories = Array.from(new Set(categories)).filter((category) =>
    CULTURE_DNA_CATEGORIES.includes(category),
  );
  const localize = (text: LocalizedText) => (isArabic ? text.ar : text.en);
  const rootClassName = className ? `${styles.root} ${className}` : styles.root;

  return (
    <section
      id={id}
      className={rootClassName}
      dir={isArabic ? "rtl" : "ltr"}
      data-culture={culture}
      data-mode={selection.mode}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{localize(COPY.eyebrow)}</p>
        <div className={styles.titleRow}>
          <div className={styles.titleCopy}>
            <h2 id={headingId} className={styles.title}>
              {localize(title ?? COPY.title[isSynthesis ? "all" : "single"])}
            </h2>
            <p className={styles.description}>
              {localize(description ?? COPY.description[isSynthesis ? "all" : "single"])}
            </p>
          </div>

          <dl className={styles.provenance}>
            <div>
              <dt>{localize(COPY.source)}</dt>
              <dd>
                {localize(COPY.sourceValue)} · v{selection.ontologyVersion}
              </dd>
            </div>
            <div>
              <dt>{localize(COPY.mode)}</dt>
              <dd>{localize(COPY.modeValue[isSynthesis ? "all" : "single"])}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className={styles.categoryList}>
        {visibleCategories.map((category, categoryIndex) => {
          const categoryProfiles = selection.profiles
            .map((profile) => ({
              profile,
              terms: profile.terms.filter((term) => term.category === category),
            }))
            .filter(({ terms }) => terms.length > 0);

          if (categoryProfiles.length === 0) return null;
          const categoryId = `${headingId}-${category}`;

          return (
            <section key={category} className={styles.category} aria-labelledby={categoryId}>
              <header className={styles.categoryHeader}>
                <span className={styles.categoryNumber} aria-hidden="true">
                  {String(categoryIndex + 1).padStart(2, "0")}
                </span>
                <h3 id={categoryId}>{localize(CATEGORY_LABELS[category])}</h3>
              </header>

              <div className={styles.profileGrid}>
                {categoryProfiles.map(({ profile, terms }) => {
                  const visibleTerms = termLimit === null ? terms : terms.slice(0, termLimit);
                  const remaining = terms.length - visibleTerms.length;
                  const profileId = `${categoryId}-${profile.culture}`;

                  return (
                    <article
                      key={profile.culture}
                      className={styles.profile}
                      aria-labelledby={isSynthesis ? profileId : undefined}
                      aria-label={!isSynthesis ? localize(profile.name) : undefined}
                    >
                      {isSynthesis && (
                        <h4 id={profileId} className={styles.profileName}>
                          {localize(profile.name)}
                        </h4>
                      )}

                      <ul className={styles.termList}>
                        {visibleTerms.map((term) => {
                          const state = reviewKey(term);
                          return (
                            <li key={term.id} className={styles.term}>
                              <div className={styles.termLine}>
                                {term.hex && (
                                  <span
                                    className={styles.swatch}
                                    style={{ backgroundColor: term.hex }}
                                    aria-hidden="true"
                                  />
                                )}
                                <span className={styles.termLabel}>{localize(term.label)}</span>
                                {term.hex && showHexValues && (
                                  <code className={styles.hex} dir="ltr">
                                    {term.hex.toUpperCase()}
                                  </code>
                                )}
                              </div>
                              {showReviewState && (
                                <span className={styles.review} data-review={state}>
                                  {localize(COPY.review[state])}
                                </span>
                              )}
                            </li>
                          );
                        })}
                        {remaining > 0 && (
                          <li className={styles.additional}>
                            {isArabic ? COPY.additional.ar(remaining) : COPY.additional.en(remaining)}
                          </li>
                        )}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {showReviewState && <p className={styles.method}>{localize(COPY.reviewMethod)}</p>}
    </section>
  );
}

export default CultureDNA;
