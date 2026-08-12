"use client";

import { useId, type ReactNode } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import CultureDNA, { type CultureDNAProps } from "./CultureDNA";
import RoomUnderstandingFigure from "./RoomUnderstandingFigure";
import StoryComparison from "./StoryComparison";
import { STORY_COPY } from "./copy";
import type {
  DesignStoryData,
  DesignStorySlots,
  LocalizedText,
  StoryGenerationMetadata,
  StoryMeasurement,
} from "./types";
import styles from "./DesignStory.module.css";

const CULTURE_NAMES = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
} as const satisfies Record<DesignStoryData["culture"], LocalizedText>;

const STORY_DNA_CATEGORIES: NonNullable<CultureDNAProps["categories"]> = [
  "materials",
  "color_palette",
  "architectural",
  "lighting",
  "ornamentation",
];

export interface DesignStoryProps {
  data: DesignStoryData;
  slots?: DesignStorySlots;
  /** Presentation overrides; culture always comes from the real selected result. */
  cultureDnaProps?: Omit<CultureDNAProps, "culture" | "showReviewState">;
  initialComparisonPosition?: number;
  className?: string;
}

function localize(text: LocalizedText, isArabic: boolean): string {
  return isArabic ? text.ar : text.en;
}

function ChapterHeader({
  chapter,
  headingId,
}: {
  chapter: { eyebrow: string; title: string; body: string };
  headingId: string;
}) {
  return (
    <header className={styles.chapterHeader}>
      <p>{chapter.eyebrow}</p>
      <div>
        <h2 id={headingId}>{chapter.title}</h2>
        <p>{chapter.body}</p>
      </div>
    </header>
  );
}

function formatMeasurement(
  measurement: StoryMeasurement,
  locale: "en" | "ar",
): string {
  if (!measurementValueAvailable(measurement)) return "—";
  if (typeof measurement.value === "string") return measurement.value.trim();
  const value = measurement.value;
  if (measurement.format === "integer") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  if (measurement.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (measurement.format === "seconds") {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "second",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

function measurementValueAvailable(
  measurement: StoryMeasurement,
): measurement is StoryMeasurement & { value: number | string } {
  if (!measurement.measured || measurement.value == null) return false;
  return typeof measurement.value === "number"
    ? Number.isFinite(measurement.value)
    : measurement.value.trim().length > 0;
}

function metadataRows(
  metadata: StoryGenerationMetadata | undefined,
  isArabic: boolean,
): Array<{
  key: string;
  label: string;
  value: string;
}> {
  if (!metadata) return [];
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const add = (key: string, label: string, value: unknown, include = value != null) => {
    if (!include) return;
    rows.push({ key, label, value: value == null ? "—" : String(value) });
  };
  add("job", isArabic ? "المهمة" : "job", metadata.jobId);
  add("model", isArabic ? "النموذج" : "model", metadata.model, Object.prototype.hasOwnProperty.call(metadata, "model"));
  add("lora", "LoRA", metadata.lora, Object.prototype.hasOwnProperty.call(metadata, "lora"));
  add("lora-scale", isArabic ? "مقياس LoRA" : "LoRA scale", metadata.loraScale, Object.prototype.hasOwnProperty.call(metadata, "loraScale"));
  add("seed", isArabic ? "البذرة" : "seed", metadata.seed, Object.prototype.hasOwnProperty.call(metadata, "seed"));
  add("cn-depth", isArabic ? "ControlNet · العمق" : "ControlNet · depth", metadata.controlNet?.depth, Boolean(metadata.controlNet && Object.prototype.hasOwnProperty.call(metadata.controlNet, "depth")));
  add("cn-seg", isArabic ? "ControlNet · التقسيم" : "ControlNet · segmentation", metadata.controlNet?.segmentation, Boolean(metadata.controlNet && Object.prototype.hasOwnProperty.call(metadata.controlNet, "segmentation")));
  add("hash", isArabic ? "SHA-256 للمخرج" : "output SHA-256", metadata.outputHash);
  add("generated", isArabic ? "وُلّد في" : "generated at", metadata.generatedAt);
  return rows;
}

function SlotOrDash({
  children,
  label,
  unavailable,
}: {
  children?: ReactNode;
  label: string;
  unavailable: string;
}) {
  if (children) return <>{children}</>;
  return (
    <span className={styles.slotUnavailable} aria-label={`${label} — ${unavailable}`}>
      —
    </span>
  );
}

export default function DesignStory({
  data,
  slots,
  cultureDnaProps,
  initialComparisonPosition = 50,
  className,
}: DesignStoryProps) {
  const { isArabic } = useThemeLanguage();
  const locale = isArabic ? "ar" : "en";
  const copy = STORY_COPY[locale].design;
  const instanceId = useId().replaceAll(":", "");
  const sectionIds = copy.chapters.map((_, index) => `${instanceId}-story-${index + 1}`);
  const metaRows = metadataRows(data.metadata, isArabic);
  const cultureName = localize(CULTURE_NAMES[data.culture], isArabic);
  const keepActions = [
    { id: "save", label: copy.keepLabels.save, node: slots?.save },
    { id: "history", label: copy.keepLabels.history, node: slots?.history },
    { id: "report", label: copy.keepLabels.report, node: slots?.report },
  ];
  const transformationChapter = data.placeholder
    ? {
        ...copy.chapters[3],
        title: copy.previewTransformationTitle,
        body: copy.previewTransformationBody,
      }
    : data.edited
      ? {
          ...copy.chapters[3],
          title: copy.editedTransformationTitle,
          body: copy.editedTransformationBody,
        }
      : copy.chapters[3];

  return (
    <article
      className={cn(styles.root, className)}
      dir={isArabic ? "rtl" : "ltr"}
      aria-labelledby={`${instanceId}-title`}
    >
      <header className={styles.storyHeader}>
        <div>
          <p className={styles.storyKicker}>{isArabic ? "دار / ٠٨ فصول" : "DAR / 08 CHAPTERS"}</p>
          <h1 id={`${instanceId}-title`}>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <dl className={styles.storyMeta}>
          <div>
            <dt>{isArabic ? "العدسة" : "Lens"}</dt>
            <dd>{cultureName}</dd>
          </div>
          <div>
            <dt>{isArabic ? "الحالة" : "Output"}</dt>
            <dd>
              {data.placeholder
                ? isArabic ? "معاينة" : "Preview"
                : data.edited
                  ? copy.editedOutput
                  : isArabic ? "نتيجة مولّدة" : "Generated"}
            </dd>
          </div>
        </dl>
      </header>

      <nav className={styles.chapterIndex} aria-label={isArabic ? "فصول قصة التصميم" : "Design Story chapters"}>
        {copy.chapters.map((chapter, index) => (
          <a key={chapter.eyebrow} href={`#${sectionIds[index]}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {chapter.eyebrow.replace(/^\S+\s—\s/, "")}
          </a>
        ))}
      </nav>

      <section id={sectionIds[0]} className={cn(styles.chapter, styles.roomSection)} aria-labelledby={`${sectionIds[0]}-title`}>
        <ChapterHeader chapter={copy.chapters[0]} headingId={`${sectionIds[0]}-title`} />
        <figure className={styles.heroRoom}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.original.src}
            alt={localize(data.original.alt, isArabic)}
            style={{ objectPosition: `${data.original.focalPoint?.x ?? 50}% ${data.original.focalPoint?.y ?? 50}%` }}
          />
          {data.original.caption && <figcaption>{localize(data.original.caption, isArabic)}</figcaption>}
          <span className={styles.imageCoordinate} aria-hidden="true">
            {isArabic ? "المصدر / ٠١" : "SOURCE / 01"}
          </span>
        </figure>
      </section>

      <section id={sectionIds[1]} className={styles.chapter} aria-labelledby={`${sectionIds[1]}-title`}>
        <ChapterHeader chapter={copy.chapters[1]} headingId={`${sectionIds[1]}-title`} />
        <RoomUnderstandingFigure image={data.original} understanding={data.understanding} />
      </section>

      <section id={sectionIds[2]} className={cn(styles.chapter, styles.dnaSection)} aria-labelledby={`${sectionIds[2]}-title`}>
        <ChapterHeader chapter={copy.chapters[2]} headingId={`${sectionIds[2]}-title`} />
        <CultureDNA
          culture={data.culture}
          categories={STORY_DNA_CATEGORIES}
          maxTermsPerCategory={3}
          {...cultureDnaProps}
          showReviewState
        />
      </section>

      <section id={sectionIds[3]} className={cn(styles.chapter, styles.transformationSection)} aria-labelledby={`${sectionIds[3]}-title`}>
        <ChapterHeader chapter={transformationChapter} headingId={`${sectionIds[3]}-title`} />
        {data.placeholder && (
          <p className={styles.previewNotice} role="note">{copy.previewNotice}</p>
        )}
        <div className={styles.comparisonFrame}>
          {slots?.comparison ?? (
            <StoryComparison
              before={data.original}
              after={data.generated}
              initialPosition={initialComparisonPosition}
            />
          )}
        </div>
      </section>

      <section id={sectionIds[4]} className={cn(styles.chapter, styles.explanationSection)} aria-labelledby={`${sectionIds[4]}-title`}>
        <ChapterHeader chapter={copy.chapters[4]} headingId={`${sectionIds[4]}-title`} />
        <p className={styles.sectionMode}>{copy.explanation}</p>
        {data.explanations.length > 0 ? (
          <ol className={styles.explanations}>
            {data.explanations.map((explanation, index) => (
              <li key={explanation.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{localize(explanation.title, isArabic)}</h3>
                  <p>{localize(explanation.detail, isArabic)}</p>
                  {explanation.basis && (
                    <small>
                      {copy.basis} · <bdi>{localize(explanation.basis, isArabic)}</bdi>
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.emptyExplanation}>— <span>{copy.explanationEmpty}</span></p>
        )}

        {metaRows.length > 0 && (
          <div className={styles.provenanceBlock}>
            <h3>{isArabic ? "بيانات التوليد المتاحة" : "Available generation metadata"}</h3>
            <dl>
              {metaRows.map((row) => (
                <div key={row.key}>
                  <dt>{row.label}</dt>
                  <dd><bdi dir="ltr">{row.value}</bdi></dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <section id={sectionIds[5]} className={cn(styles.chapter, styles.designerSection)} aria-labelledby={`${sectionIds[5]}-title`}>
        <ChapterHeader chapter={copy.chapters[5]} headingId={`${sectionIds[5]}-title`} />
        <div className={styles.designerCta}>
          <span aria-hidden="true">06</span>
          <div>
            <p>{isArabic ? "نقطة ربط مصمّم دار" : "DAR Designer integration"}</p>
            <SlotOrDash label={isArabic ? "مصمّم دار" : "DAR Designer"} unavailable={copy.unavailable}>{slots?.designer}</SlotOrDash>
          </div>
        </div>
      </section>

      <section id={sectionIds[6]} className={cn(styles.chapter, styles.evidenceSection)} aria-labelledby={`${sectionIds[6]}-title`}>
        <ChapterHeader chapter={copy.chapters[6]} headingId={`${sectionIds[6]}-title`} />
        <div className={styles.evidenceIntro}>
          <p className={styles.sectionMode}>{copy.measurement}</p>
          <p>{copy.evidenceRule}</p>
        </div>
        {data.edited && <p className={styles.editedNote}>{copy.editedEvidence}</p>}
        <dl className={styles.measurements}>
          {data.measurements.map((measurement) => {
            const value = formatMeasurement(measurement, locale);
            const valueAvailable = measurementValueAvailable(measurement);
            const hasIntrinsicUnit =
              measurement.format === "percent" || measurement.format === "seconds";
            return (
              <div key={measurement.id} data-measured={valueAvailable ? "true" : "false"}>
                <dt>{localize(measurement.label, isArabic)}</dt>
                <dd>
                  <span className={styles.measurementValue}>
                    <bdi dir={typeof measurement.value === "number" ? "ltr" : undefined}>{value}</bdi>
                    {measurement.unit && valueAvailable && !hasIntrinsicUnit && (
                      <small>{localize(measurement.unit, isArabic)}</small>
                    )}
                  </span>
                  {measurement.methodology && (
                    <p><span>{copy.methodology}</span>{localize(measurement.methodology, isArabic)}</p>
                  )}
                  {measurement.source && (
                    <code><span>{copy.source}</span><bdi dir="ltr">{localize(measurement.source, isArabic)}</bdi></code>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section id={sectionIds[7]} className={cn(styles.chapter, styles.keepSection)} aria-labelledby={`${sectionIds[7]}-title`}>
        <ChapterHeader chapter={copy.chapters[7]} headingId={`${sectionIds[7]}-title`} />
        <ul className={styles.keepActions}>
          {keepActions.map((action, index) => (
            <li key={action.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{action.label}</p>
              <div><SlotOrDash label={action.label} unavailable={copy.unavailable}>{action.node}</SlotOrDash></div>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
