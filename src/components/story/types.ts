import type { ReactNode } from "react";
import type {
  JobStatusName,
  ObjectMapObject,
  RoomAnalysisSummary,
  SegRegionItem,
  StyleId,
} from "@/lib/api";

/** A culture selection in the product. `all` means three separate outputs/lenses,
 * never a blended or percentage-based culture. */
export type StoryCulture = StyleId | "all";

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface StoryImage {
  src: string;
  alt: LocalizedText;
  caption?: LocalizedText;
  /** Optional percentage-based focal point used by cinematic crops. */
  focalPoint?: { x: number; y: number };
}

export type CultureDnaCategory =
  | "architectural"
  | "materials"
  | "color_palette"
  | "lighting"
  | "furniture"
  | "textiles"
  | "ornamentation";

export interface CultureDnaTerm {
  id: string;
  label: LocalizedText;
  category: CultureDnaCategory;
  sourceCulture: StyleId;
  weight?: number;
  verified?: boolean;
  note?: string;
  hex?: string;
}

export interface CultureDnaProfile {
  culture: StyleId;
  name: LocalizedText;
  ontologyVersion: string;
  terms: CultureDnaTerm[];
}

export interface StoryExplanation {
  id: string;
  title: LocalizedText;
  detail: LocalizedText;
  /** The returned field or project source that supports the explanation. */
  basis?: LocalizedText;
}

export type StoryMeasurementFormat =
  | "decimal"
  | "integer"
  | "percent"
  | "seconds"
  | "text";

/** Evidence is explicit about whether a value was measured. A numeric zero is
 * rendered only when `measured` is true; unavailable values render as an em dash. */
export interface StoryMeasurement {
  id: string;
  label: LocalizedText;
  value: number | string | null;
  measured: boolean;
  format?: StoryMeasurementFormat;
  unit?: LocalizedText;
  methodology?: LocalizedText;
  source?: LocalizedText;
}

export interface StoryControlNetMetadata {
  depth?: number | null;
  segmentation?: number | null;
  dual?: boolean | null;
}

/** Optional per-render provenance. The current `/redesign` response does not
 * include these fields; `/restyle` can provide them through its manifest. */
export interface StoryGenerationMetadata {
  jobId?: string | null;
  model?: string | null;
  lora?: string | null;
  loraScale?: number | null;
  seed?: number | string | null;
  controlNet?: StoryControlNetMetadata | null;
  outputHash?: string | null;
  generatedAt?: string | null;
  placeholder?: boolean;
}

export interface StoryRoomUnderstanding {
  /** Returned OneFormer/ADE20K bounding boxes; never demo regions. */
  regions?: SegRegionItem[];
  /** Returned depth-projected object footprints; never demo objects. */
  objects?: ObjectMapObject[];
  /** Optional real segmentation visualization supplied by an integration. */
  segmentationImage?: StoryImage | null;
  /** The real depth image returned with `/redesign`, when available. */
  depthImage?: StoryImage | null;
  roomAnalysis?: RoomAnalysisSummary | null;
  segmentationVersion?: string | null;
  objectMapVersion?: string | null;
}

export interface DesignStoryData {
  original: StoryImage;
  generated: StoryImage;
  culture: StyleId;
  understanding?: StoryRoomUnderstanding;
  explanations: StoryExplanation[];
  measurements: StoryMeasurement[];
  metadata?: StoryGenerationMetadata;
  /** True when the displayed render differs from the pristine measured output. */
  edited?: boolean;
  /** True when DARDESIGN_LIGHT supplied a stand-in rather than a GPU render. */
  placeholder?: boolean;
}

/** Stateful application actions are slots so Studio can reuse its existing save
 * and report components without Design Story taking ownership of their logic. */
export interface DesignStorySlots {
  comparison?: ReactNode;
  designer?: ReactNode;
  save?: ReactNode;
  history?: ReactNode;
  report?: ReactNode;
}

export type GenerationResearchKind =
  | "prompt-experiment"
  | "model-research"
  | "lora-research"
  | "training"
  | "controlnet-study"
  | "other";

export interface GenerationResearchAsset {
  id: string;
  image: StoryImage;
  title: LocalizedText;
  description?: LocalizedText;
  /** A culture-specific scope, or `shared`/omitted for genuinely shared work. */
  culture?: StyleId | "shared";
  kind: GenerationResearchKind;
  /** Visible provenance for this real project asset. Unsourced research media
   * is deliberately not part of the public component contract. */
  source: LocalizedText;
}

export interface GenerationStoryAssets {
  /** Real visualization exported by a segmentation pipeline, if one is supplied. */
  segmentationImage?: StoryImage | null;
  /** Actual returned regions may be shown over the original without a mask image. */
  segmentationRegions?: SegRegionItem[];
  /** Real depth map. `/redesign.depth_map` is suitable after completion/replay. */
  depthImage?: StoryImage | null;
  /** Research media only; no placeholder screenshots are synthesized. */
  research?: GenerationResearchAsset[];
  /** A real crop/detail asset for the loop point. Falls back to the original room. */
  detailTeaser?: StoryImage | null;
  /**
   * The renders this run actually produced, one per culture that was asked for.
   * The generation chapter draws an abstract "visual metaphor" when this is
   * empty — deliberately, because inventing a picture of inference would be a
   * lie — but when the outputs exist there is no reason to show a metaphor for
   * them. Never populate this from a placeholder run.
   */
  generatedOutputs?: StoryImage[];
}

export interface GenerationPipelineNode {
  id: string;
  label: LocalizedText;
  detail?: LocalizedText;
}

export interface GenerationPipelineCapabilities {
  /** Only set true when the current run/project asset actually has a culture LoRA. */
  cultureLora?: boolean;
  /** Optional human-readable model label from real configuration or provenance. */
  modelLabel?: string;
  /** Set only when supplied runtime provenance proves ControlNet was used. */
  controlNet?: boolean;
}

/** A percentage is shown only inside this explicitly backend-reported envelope. */
export interface BackendReportedProgress {
  value: number;
  source: "backend";
  label?: LocalizedText;
}

export type GenerationStoryState = JobStatusName | "requesting";

export interface GenerationStoryStatus {
  state: GenerationStoryState;
  jobId?: string | null;
  label?: LocalizedText;
  error?: LocalizedText | null;
  /** Real elapsed wall-clock time, if the parent already tracks it. */
  elapsedSeconds?: number | null;
  /** Omit for synchronous `/redesign`; never derive this from documentary timing. */
  reportedProgress?: BackendReportedProgress | null;
}
