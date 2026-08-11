"use client";

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { usePrefersReducedMotion } from "@/components/cinema/hooks";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import {
  CULTURE_DNA_ORDER,
  getCultureDnaProfile,
} from "./cultureData";
import { STORY_COPY } from "./copy";
import type {
  GenerationPipelineCapabilities,
  GenerationPipelineNode,
  GenerationResearchKind,
  GenerationResearchAsset,
  GenerationStoryAssets,
  GenerationStoryStatus,
  LocalizedText,
  StoryCulture,
  StoryImage,
} from "./types";
import styles from "./GenerationStory.module.css";

const CHAPTER_COUNT = 7;
const DEFAULT_CHAPTER_DURATION = 5_200;

const CULTURE_NAMES: Record<StoryCulture, LocalizedText> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  all: {
    en: "Lebanese · Khaleeji · Moroccan — separate outputs",
    ar: "لبناني · خليجي · مغربي — نتائج منفصلة",
  },
};

const RESEARCH_KIND_LABELS: Record<GenerationResearchKind, LocalizedText> = {
  "prompt-experiment": { en: "Prompt experiment", ar: "تجربة موجّه" },
  "model-research": { en: "Model research", ar: "بحث نموذج" },
  "lora-research": { en: "LoRA research", ar: "بحث LoRA" },
  training: { en: "Training", ar: "تدريب" },
  "controlnet-study": { en: "ControlNet study", ar: "دراسة ControlNet" },
  other: { en: "Project research", ar: "بحث المشروع" },
};

const RESEARCH_EMPTY_ITEMS: LocalizedText[] = [
  { en: "Prompt experiments", ar: "تجارب الموجّهات" },
  { en: "ControlNet studies", ar: "دراسات ControlNet" },
  { en: "LoRA research", ar: "أبحاث LoRA" },
];

function cultureAccentStyle(culture: StoryCulture): CSSProperties {
  const cultures = culture === "all" ? CULTURE_DNA_ORDER : [culture];
  const palette = culture === "all"
    ? cultures.map((item) =>
        getCultureDnaProfile(item).terms.find(
          (term) => term.category === "color_palette" && term.hex,
        )?.hex,
      )
    : getCultureDnaProfile(culture).terms
        .filter((term) => term.category === "color_palette" && term.hex)
        .slice(0, 3)
        .map((term) => term.hex);

  return {
    "--story-accent-a": palette[0] ?? "var(--dd-gold)",
    "--story-accent-b": palette[1] ?? "var(--dd-gold-dim)",
    "--story-accent-c": palette[2] ?? "var(--dd-text-secondary)",
  } as CSSProperties;
}

export interface GenerationStoryProps {
  /** The real upload preview. A string is accepted for direct Studio integration. */
  inputImage: StoryImage | string;
  culture: StoryCulture;
  /** Optional real status. Omit progress for the synchronous `/redesign` flow. */
  status?: GenerationStoryStatus;
  assets?: GenerationStoryAssets;
  capabilities?: GenerationPipelineCapabilities;
  /** Override only with nodes supported by the current deployment/project. */
  pipeline?: GenerationPipelineNode[];
  /** Clamped so seven chapters remain a 30–40 second loop. */
  chapterDurationMs?: number;
  initialChapter?: number;
  /** Initial playback preference. Manual controls own playback after mount. */
  initialAutoPlay?: boolean;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mmss(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function normalizeImage(image: StoryImage | string): StoryImage {
  if (typeof image !== "string") return image;
  return {
    src: image,
    alt: { en: "Original uploaded room", ar: "الغرفة الأصلية المرفوعة" },
  };
}

function localized(text: LocalizedText, isArabic: boolean): string {
  return isArabic ? text.ar : text.en;
}

function completeLocalizedText(text: LocalizedText | undefined): text is LocalizedText {
  return Boolean(text?.en.trim() && text.ar.trim());
}

function chapterPipeline(
  copy: (typeof STORY_COPY)["en"]["generation"],
  capabilities: GenerationPipelineCapabilities | undefined,
  culture: StoryCulture,
): GenerationPipelineNode[] {
  const node = (id: string, label: string): GenerationPipelineNode => ({
    id,
    label: { en: label, ar: label },
  });
  const nodes: GenerationPipelineNode[] = [
    node("room", copy.pipeline.room),
    node("room-understanding", copy.pipeline.roomUnderstanding),
    node("culture-selection", copy.pipeline.cultureSelection),
    node("ontology-prompt", copy.pipeline.ontologyPrompt),
  ];
  if (capabilities?.cultureLora) nodes.push(node("culture-lora", copy.pipeline.cultureLora));
  nodes.push(
    node(
      "generation-engine",
      `${capabilities?.modelLabel ?? copy.pipeline.diffusionPipeline}${
        capabilities?.controlNet ? " + ControlNet" : ""
      }`,
    ),
    node(
      "generated-design",
      culture === "all"
        ? copy.pipeline.generatedDesignAll
        : copy.pipeline.generatedDesign,
    ),
  );
  return nodes;
}

function DetectionOverlay({
  assets,
  isArabic,
}: {
  assets?: GenerationStoryAssets;
  isArabic: boolean;
}) {
  const regions = (assets?.segmentationRegions ?? [])
    .filter((region) => {
      const [x, y, width, height] = region.bbox;
      return (
        [x, y, width, height, region.area].every(Number.isFinite) &&
        x >= 0 &&
        y >= 0 &&
        width > 0 &&
        height > 0 &&
        x + width <= 1 &&
        y + height <= 1 &&
        region.area >= 0
      );
    })
    .slice()
    .sort((a, b) => b.area - a.area)
    .slice(0, 6);

  if (regions.length === 0) return null;
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.regionOverlay} aria-hidden="true">
        {regions.map((region, index) => {
          const [x, y, w, h] = region.bbox.map((value) => value * 100) as [number, number, number, number];
          return (
            <g key={`${region.classKey}-${index}`}>
              <rect x={x} y={y} width={w} height={h} rx="1" />
              <line x1={x + w / 2} y1={y + h / 2} x2={x < 50 ? 3 : 97} y2={y + h / 2} />
              <circle cx={x < 50 ? 3 : 97} cy={y + h / 2} r="1" />
            </g>
          );
        })}
      </svg>
      <ul className={styles.regionLabels} aria-label={isArabic ? "العناصر المكتشفة" : "Detected elements"}>
        {regions.map((region, index) => (
          <li key={`${region.classKey}-label-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {isArabic ? region.labelAr || region.classKey : region.labelEn || region.classKey}
          </li>
        ))}
      </ul>
    </>
  );
}

function ChapterImage({
  image,
  isArabic,
  className,
  decorative = false,
  onLoad,
}: {
  image: StoryImage;
  isArabic: boolean;
  className?: string;
  decorative?: boolean;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.src}
      alt={decorative ? "" : localized(image.alt, isArabic)}
      className={className}
      style={{ objectPosition: `${image.focalPoint?.x ?? 50}% ${image.focalPoint?.y ?? 50}%` }}
      draggable={false}
      decoding="async"
      onLoad={onLoad}
    />
  );
}

function ResearchChapter({
  assets,
  culture,
  isArabic,
  emptyCopy,
  sourceCopy,
}: {
  assets?: GenerationStoryAssets;
  culture: StoryCulture;
  isArabic: boolean;
  emptyCopy: string;
  sourceCopy: string;
}) {
  const seenAssetIds = new Set<string>();
  const eligibleResearch = (assets?.research ?? []).filter((asset) => {
    const matchesCulture =
      !asset.culture ||
      asset.culture === "shared" ||
      culture === "all" ||
      asset.culture === culture;
    const hasRequiredProvenance =
      asset.id.trim().length > 0 &&
      asset.image.src.trim().length > 0 &&
      completeLocalizedText(asset.image.alt) &&
      completeLocalizedText(asset.title) &&
      completeLocalizedText(asset.source) &&
      (!asset.description || completeLocalizedText(asset.description));
    if (!matchesCulture || !hasRequiredProvenance || seenAssetIds.has(asset.id)) {
      return false;
    }
    seenAssetIds.add(asset.id);
    return true;
  });
  const research = culture === "all"
    ? [
        ...CULTURE_DNA_ORDER.map((profileCulture) =>
          eligibleResearch.find((asset) => asset.culture === profileCulture),
        ).filter((asset): asset is GenerationResearchAsset => Boolean(asset)),
        ...eligibleResearch.filter(
          (asset) =>
            !CULTURE_DNA_ORDER.some((profileCulture) =>
              eligibleResearch.find((candidate) => candidate.culture === profileCulture)?.id === asset.id,
            ),
        ),
      ].slice(0, 4)
    : eligibleResearch.slice(0, 4);
  if (research.length === 0) {
    return (
      <div className={styles.researchEmpty}>
        <div className={styles.emptyFrames} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>{emptyCopy}</p>
        <ul>
          {RESEARCH_EMPTY_ITEMS.map((item) => (
            <li key={item.en}>{localized(item, isArabic)}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className={styles.researchGrid}
      role="region"
      tabIndex={0}
      aria-label={isArabic ? "أصول البحث الموثّقة المصدر" : "Sourced research assets"}
    >
      {research.map((asset: GenerationResearchAsset) => (
        <figure key={asset.id} className={styles.researchAsset}>
          <ChapterImage image={asset.image} isArabic={isArabic} />
          <figcaption>
            <span className={styles.assetKind}>
              {localized(RESEARCH_KIND_LABELS[asset.kind], isArabic)}
            </span>
            <span className={styles.assetScope}>
              {asset.culture && asset.culture !== "shared"
                ? localized(CULTURE_NAMES[asset.culture], isArabic)
                : isArabic ? "بحث مشترك" : "Shared research"}
            </span>
            <strong>{localized(asset.title, isArabic)}</strong>
            {asset.description && <p>{localized(asset.description, isArabic)}</p>}
            <small>
              {sourceCopy}: {localized(asset.source, isArabic)}
            </small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function GenerationStory({
  inputImage,
  culture,
  status,
  assets,
  capabilities,
  pipeline,
  chapterDurationMs = DEFAULT_CHAPTER_DURATION,
  initialChapter = 0,
  initialAutoPlay = true,
  className,
}: GenerationStoryProps) {
  const { isArabic } = useThemeLanguage();
  const instanceId = useId().replaceAll(":", "");
  const reducedMotion = usePrefersReducedMotion();
  const copy = STORY_COPY[isArabic ? "ar" : "en"].generation;
  const sourceImage = normalizeImage(inputImage);
  const [activeChapter, setActiveChapter] = useState(() =>
    clamp(Math.floor(initialChapter), 0, CHAPTER_COUNT - 1),
  );
  const [paused, setPaused] = useState(!initialAutoPlay);
  const [documentVisible, setDocumentVisible] = useState(true);
  const analysisStageRef = useRef<HTMLDivElement>(null);
  const [sourceGeometry, setSourceGeometry] = useState<{
    src: string;
    aspect: number;
  } | null>(null);
  const sourceAspect = sourceGeometry?.src === sourceImage.src
    ? sourceGeometry.aspect
    : null;
  const [analysisMediaSize, setAnalysisMediaSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const duration = Number.isFinite(chapterDurationMs)
    ? clamp(chapterDurationMs, 4_300, 5_700)
    : DEFAULT_CHAPTER_DURATION;
  const terminal = status?.state === "done" || status?.state === "error";
  const playing = !paused && !reducedMotion && documentVisible && !terminal;
  const statusState = status?.state;
  const progress =
    status?.reportedProgress &&
    Number.isFinite(status.reportedProgress.value) &&
    status.reportedProgress.value >= 0 &&
    status.reportedProgress.value <= 1
    ? status.reportedProgress.value
    : null;
  const pipelineNodes = useMemo(
    () => pipeline ?? chapterPipeline(copy, capabilities, culture),
    [capabilities, copy, culture, pipeline],
  );
  const cultureName = localized(CULTURE_NAMES[culture], isArabic);
  const cultureRequest = culture === "all"
    ? isArabic
      ? `النتائج المطلوبة: ${cultureName}`
      : `Requested outputs: ${cultureName}`
    : isArabic
      ? `عدسة التصميم المختارة: ${cultureName}`
      : `Selected design lens: ${cultureName}`;
  const accentStyle = cultureAccentStyle(culture);
  const captureSourceAspect = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setSourceGeometry({
        src: sourceImage.src,
        aspect: naturalWidth / naturalHeight,
      });
    }
  };

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const stage = analysisStageRef.current;
    if (!stage || !sourceAspect || activeChapter !== 1) return;

    const updateSize = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const stageAspect = width / height;
      const next = stageAspect > sourceAspect
        ? { width: height * sourceAspect, height }
        : { width, height: width / sourceAspect };
      setAnalysisMediaSize((current) =>
        current &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next,
      );
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [activeChapter, sourceAspect]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => setActiveChapter((current) => (current + 1) % CHAPTER_COUNT),
      duration,
    );
    return () => window.clearTimeout(timer);
  }, [activeChapter, duration, playing]);

  const selectChapter = (index: number) => {
    setActiveChapter((index + CHAPTER_COUNT) % CHAPTER_COUNT);
    setPaused(true);
  };

  const renderChapter = (): ReactNode => {
    switch (activeChapter) {
      case 0:
        return (
          <figure className={styles.roomChapter}>
            <ChapterImage
              image={sourceImage}
              isArabic={isArabic}
              className={styles.roomImage}
              onLoad={captureSourceAspect}
            />
            <div className={styles.roomFrame} aria-hidden="true">
              <span>{isArabic ? "الأصل / ٠١" : "ORIGINAL / 01"}</span>
              <i />
            </div>
            <figcaption>{cultureRequest}</figcaption>
          </figure>
        );
      case 1: {
        const segmentation = assets?.segmentationImage;
        const hasRegionEnvelope = Array.isArray(assets?.segmentationRegions);
        const hasRegions = Boolean(assets?.segmentationRegions?.length);
        return (
          <div className={styles.understandingChapter}>
            <div ref={analysisStageRef} className={styles.analysisImage}>
              <div
                className={styles.analysisMedia}
                style={sourceAspect ? analysisMediaSize ?? undefined : undefined}
              >
                <ChapterImage
                  image={sourceImage}
                  isArabic={isArabic}
                  decorative={Boolean(segmentation)}
                  onLoad={captureSourceAspect}
                />
                {segmentation && (
                  <ChapterImage
                    image={segmentation}
                    isArabic={isArabic}
                    className={styles.segmentationImage}
                  />
                )}
                {sourceAspect && analysisMediaSize && (
                  <DetectionOverlay assets={assets} isArabic={isArabic} />
                )}
              </div>
            </div>
            {!segmentation && !hasRegionEnvelope && (
              <p className={styles.assetUnavailable}>{copy.segmentationUnavailable}</p>
            )}
            {!segmentation && hasRegionEnvelope && !hasRegions && (
              <p className={styles.assetUnavailable}>{copy.noRegionsDetected}</p>
            )}
            {hasRegionEnvelope && (
              <p className={styles.assetProvenance}>
                {copy.segmentationEvidence} · {assets!.segmentationRegions!.length}
              </p>
            )}
          </div>
        );
      }
      case 2:
        return (
          <div className={styles.preservationChapter}>
            <div className={styles.preservationMedia}>
              <figure>
                <ChapterImage image={sourceImage} isArabic={isArabic} decorative />
                <figcaption>{isArabic ? "مرجع الغرفة" : "Room reference"}</figcaption>
              </figure>
              {assets?.depthImage ? (
                <figure>
                  <ChapterImage image={assets.depthImage} isArabic={isArabic} />
                  <figcaption>{copy.depthCaption}</figcaption>
                </figure>
              ) : (
                <div className={styles.depthUnavailable}>
                  <span aria-hidden="true">{isArabic ? "العمق / —" : "DEPTH / —"}</span>
                  <p>{copy.depthUnavailable}</p>
                </div>
              )}
            </div>
            <ol className={styles.preservationTerms}>
              <li><span>01</span><bdi>Depth</bdi></li>
              <li><span>02</span><bdi>ControlNet</bdi></li>
              <li><span>03</span>{isArabic ? "الحفاظ المكاني" : "Spatial preservation"}</li>
            </ol>
          </div>
        );
      case 3:
        return (
          <ResearchChapter
            assets={assets}
            culture={culture}
            isArabic={isArabic}
            emptyCopy={copy.researchUnavailable}
            sourceCopy={copy.researchSource}
          />
        );
      case 4:
        return (
          <div className={styles.pipelineChapter}>
            <p>{copy.pipelineCaption}</p>
            <ol className={styles.pipeline} dir={isArabic ? "rtl" : "ltr"}>
              {pipelineNodes.map((node, index) => (
                <li key={node.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{localized(node.label, isArabic)}</strong>
                  {node.detail && <small>{localized(node.detail, isArabic)}</small>}
                </li>
              ))}
            </ol>
          </div>
        );
      case 5:
        return (
          <div className={styles.generationMetaphor}>
            <svg viewBox="0 0 900 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <defs>
                <pattern id={`${instanceId}-story-grid`} width="44" height="44" patternUnits="userSpaceOnUse">
                  <path d="M44 0H0V44" />
                </pattern>
              </defs>
              <rect width="900" height="500" className={styles.metaphorGround} />
              <rect width="900" height="500" fill={`url(#${instanceId}-story-grid)`} className={styles.metaphorGrid} />
              <path d="M-30 410 C150 250 220 470 390 295 S670 90 930 245" />
              <path d="M-20 455 C170 305 260 500 450 340 S710 135 940 300" />
              <path d="M-10 350 C140 185 245 420 410 230 S675 45 920 175" />
              <g className={styles.metaphorPlanes}>
                <rect x="80" y="82" width="230" height="278" />
                <rect x="335" y="126" width="205" height="250" />
                <rect x="570" y="68" width="250" height="298" />
              </g>
            </svg>
            <p>{copy.metaphorLabel}</p>
          </div>
        );
      default: {
        const teaser = assets?.detailTeaser ?? sourceImage;
        return (
          <figure className={styles.almostChapter}>
            <ChapterImage image={teaser} isArabic={isArabic} className={styles.teaserImage} />
            <div className={styles.detailMeasure} aria-hidden="true">
              <i />
              <span>{isArabic ? "تفصيل / ٠٧" : "DETAIL / 07"}</span>
              <i />
            </div>
            <figcaption>
              {assets?.detailTeaser
                ? localized(assets.detailTeaser.caption ?? assets.detailTeaser.alt, isArabic)
                : copy.originalDetail}
            </figcaption>
          </figure>
        );
      }
    }
  };

  return (
    <section
      className={cn(styles.root, className)}
      dir={isArabic ? "rtl" : "ltr"}
      style={accentStyle}
      aria-label={copy.eyebrow}
    >
      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p className={styles.subtitle}>{copy.subtitle}</p>
        </div>
        <div className={styles.loopMeta}>
          <span>{copy.loopLabel}</span>
          <strong>
            <bdi dir="ltr">
              {Math.round((duration * CHAPTER_COUNT) / 1_000)}{isArabic ? "ث" : "s"}
            </bdi>
          </strong>
        </div>
      </header>

      <div className={styles.truthNote}>
        <span aria-hidden="true">i</span>
        <p>{copy.truthNote}</p>
      </div>

      <div className={styles.statusPanel}>
        <div className={styles.statusIdentity} role="status" aria-live="polite" aria-atomic="true">
          <span className={styles.statusDot} data-state={statusState ?? "unavailable"} aria-hidden="true" />
          <div>
            <p>
              {status?.label
                ? localized(status.label, isArabic)
                : statusState
                  ? copy.status[statusState]
                  : copy.statusUnavailable}
            </p>
            {status?.jobId && <code dir="ltr">{status.jobId.slice(0, 12)}</code>}
            {status?.error && (
              <p className={styles.statusError}>{localized(status.error, isArabic)}</p>
            )}
          </div>
        </div>
        {status?.elapsedSeconds != null &&
          Number.isFinite(status.elapsedSeconds) &&
          status.elapsedSeconds >= 0 && (
          <p className={styles.elapsed}>
            <span>{copy.elapsed}</span>
            <bdi dir="ltr">{mmss(status.elapsedSeconds)}</bdi>
          </p>
        )}
        {progress != null ? (
          <div className={styles.reportedProgress}>
            <div>
              <span>{status?.reportedProgress?.label ? localized(status.reportedProgress.label, isArabic) : copy.backendProgress}</span>
              <bdi dir="ltr">{Math.round(progress * 100)}%</bdi>
            </div>
            <progress max={1} value={progress} aria-label={copy.backendProgress} />
          </div>
        ) : (
          <p className={styles.noTelemetry}>{copy.noTelemetry}</p>
        )}
      </div>

      <div className={styles.documentary}>
        <div className={styles.chapterHeading}>
          <div>
            <p>
              {copy.chapter} <bdi dir="ltr">{String(activeChapter + 1).padStart(2, "0")}</bdi> {copy.of} {CHAPTER_COUNT}
            </p>
            <h3>{copy.chapters[activeChapter].title}</h3>
          </div>
          <p>{copy.chapters[activeChapter].body}</p>
        </div>

        <div
          key={activeChapter}
          id={`${instanceId}-inside-dar-stage`}
          className={styles.chapterStage}
          data-chapter={activeChapter + 1}
        >
          {renderChapter()}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => selectChapter(activeChapter - 1)}
            aria-label={copy.previous}
          >
            {isArabic ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          </button>

          <div className={styles.chapterNav} role="group" aria-label={copy.eyebrow}>
            {copy.chapters.map((chapter, index) => (
              <button
                key={chapter.title}
                type="button"
                onClick={() => selectChapter(index)}
                aria-current={index === activeChapter ? "step" : undefined}
                aria-controls={`${instanceId}-inside-dar-stage`}
                aria-label={`${copy.chapter} ${index + 1}: ${chapter.title}`}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>

          <button
            type="button"
            className={styles.playButton}
            onClick={() => setPaused((value) => !value)}
            disabled={reducedMotion || terminal}
            aria-label={
              reducedMotion
                ? isArabic ? "الفصول يدوية بسبب تفضيل تقليل الحركة" : "Manual chapters because reduced motion is enabled"
                : terminal
                  ? isArabic ? "توقفت القصة بعد انتهاء الطلب" : "Story stopped after the request finished"
                  : playing ? copy.pause : copy.resume
            }
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            <span>
              {reducedMotion
                ? isArabic ? "تنقّل يدوي" : "Manual chapters"
                : terminal
                  ? isArabic ? "انتهى الطلب" : "Request finished"
                  : playing ? copy.pause : copy.resume}
            </span>
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={() => selectChapter(activeChapter + 1)}
            aria-label={copy.next}
          >
            {isArabic ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        </div>
      </div>
    </section>
  );
}
