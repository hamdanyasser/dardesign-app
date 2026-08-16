import type {
  JobStatus,
  RedesignProvenance,
  RedesignResult,
  StyleId,
} from "@/lib/api";
import type {
  DesignStoryData,
  GenerationPipelineCapabilities,
  GenerationStoryAssets,
  GenerationStoryStatus,
  LocalizedText,
  StoryGenerationMetadata,
  StoryImage,
  StoryMeasurement,
  StoryRoomUnderstanding,
} from "./types";

const CULTURE_NAMES: Record<StyleId, LocalizedText> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
};

const JOB_STATUS_LABELS: Record<JobStatus["status"], LocalizedText> = {
  pending: { en: "Waiting to begin", ar: "بانتظار البدء" },
  queued: { en: "Queued for generation", ar: "في قائمة انتظار التوليد" },
  running: { en: "Generation in progress", ar: "جارٍ إنشاء التصميم" },
  done: { en: "Design ready", ar: "التصميم جاهز" },
  error: { en: "Generation stopped", ar: "توقّف إنشاء التصميم" },
};

export interface CreateDesignStoryDataOptions {
  /**
   * The image currently shown by Studio. Passing a different image from the
   * pristine `/redesign` output normally means a colour or furniture edit.
   */
  generatedImage?: string | StoryImage | null;
  /** Marks an explicitly edited render. A differing override URL is always
   * treated as edited even when this is false. */
  edited?: boolean;
  /** A real segmentation visualization supplied by the integration. */
  segmentationImage?: StoryImage | null;
  /**
   * Explicit per-render provenance, for example a `/restyle` manifest.
   * `/redesign` does not expose provenance, so none is inferred here.
   */
  provenance?: StoryGenerationMetadata | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isNonEmptyString(value) ? value : undefined;
}

/** Normalize the real `/restyle` sidecar manifest without treating arbitrary
 * object keys as provenance. A null LoRA is preserved as an explicit absence. */
export function storyGenerationMetadataFromManifest(
  manifest: Record<string, unknown> | null | undefined,
  jobId?: string | null,
): StoryGenerationMetadata | undefined {
  if (!manifest && !isNonEmptyString(jobId)) return undefined;
  const controlnet = manifest?.controlnet;
  const controlnetRecord =
    controlnet && typeof controlnet === "object"
      ? (controlnet as Record<string, unknown>)
      : null;
  const generatedAtRaw = manifest?.generated_at;
  let generatedAt: string | undefined;
  if (isNonEmptyString(generatedAtRaw)) {
    generatedAt = generatedAtRaw;
  } else if (finiteNumber(generatedAtRaw)) {
    const date = new Date(generatedAtRaw * 1_000);
    if (Number.isFinite(date.getTime())) generatedAt = date.toISOString();
  }

  const metadata: StoryGenerationMetadata = {};
  if (isNonEmptyString(jobId)) metadata.jobId = jobId;
  const model = optionalString(manifest?.model);
  if (model !== undefined) metadata.model = model;
  if (manifest && Object.prototype.hasOwnProperty.call(manifest, "lora")) {
    metadata.lora = optionalString(manifest.lora) ?? null;
  }
  if (finiteNumber(manifest?.lora_scale)) metadata.loraScale = manifest.lora_scale;
  if (finiteNumber(manifest?.seed) || isNonEmptyString(manifest?.seed)) metadata.seed = manifest.seed;
  if (controlnetRecord) {
    metadata.controlNet = {
      depth: finiteNumber(controlnetRecord.depth) ? controlnetRecord.depth : null,
      segmentation: finiteNumber(controlnetRecord.seg) ? controlnetRecord.seg : null,
      dual: typeof manifest?.dual_controlnet === "boolean" ? manifest.dual_controlnet : null,
    };
  }
  if (isNonEmptyString(manifest?.output_sha256)) metadata.outputHash = manifest.output_sha256;
  if (generatedAt) metadata.generatedAt = generatedAt;
  if (manifest?.light_mode === true) metadata.placeholder = true;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/** Derive only pipeline capabilities proven by supplied provenance. */
export function generationPipelineCapabilitiesFromMetadata(
  metadata: StoryGenerationMetadata | null | undefined,
): GenerationPipelineCapabilities {
  if (!metadata || metadata.placeholder) return {};
  const controlNet = metadata.controlNet;
  const hasControlNet = Boolean(
    controlNet &&
      ((finiteNumber(controlNet.depth) && controlNet.depth > 0) ||
        (finiteNumber(controlNet.segmentation) && controlNet.segmentation > 0)),
  );
  return {
    ...(Object.prototype.hasOwnProperty.call(metadata, "lora")
      ? { cultureLora: isNonEmptyString(metadata.lora) }
      : {}),
    ...(isNonEmptyString(metadata.model) ? { modelLabel: metadata.model } : {}),
    ...(controlNet ? { controlNet: hasControlNet } : {}),
  };
}

function imageFromOverride(
  value: CreateDesignStoryDataOptions["generatedImage"],
  fallback: string,
  culture: LocalizedText,
  state: "generated" | "edited" | "placeholder",
): StoryImage {
  if (value && typeof value === "object" && isNonEmptyString(value.src)) {
    return value;
  }

  return {
    src: isNonEmptyString(value) ? value : fallback,
    alt:
      state === "placeholder"
        ? {
            en: `${culture.en} preview stand-in`,
            ar: `صورة معاينة بديلة للطابع ${culture.ar}`,
          }
        : state === "edited"
          ? {
              en: `${culture.en} room after later edits`,
              ar: `الغرفة بالطابع ${culture.ar} بعد تعديلات لاحقة`,
            }
          : {
              en: `${culture.en} generated room`,
              ar: `الغرفة المصممة بالطابع ${culture.ar}`,
            },
  };
}

function unavailableMeasurement(
  id: string,
  label: LocalizedText,
  format: StoryMeasurement["format"],
  methodology: LocalizedText,
  source: LocalizedText,
): StoryMeasurement {
  return {
    id,
    label,
    value: null,
    measured: false,
    format,
    methodology,
    source,
  };
}

/**
 * Adapt the real `/redesign` response into the presentation-only Story model.
 * Placeholder room-understanding envelopes are deliberately omitted rather
 * than being made to look like detections, and no demo data is introduced.
 */
export function createDesignStoryData(
  result: RedesignResult,
  culture: StyleId,
  options: CreateDesignStoryDataOptions = {},
): DesignStoryData | null {
  if (!isNonEmptyString(result.original)) return null;

  // `styles` is authoritative when present. Older/demo responses may omit it,
  // in which case the actual culture image field is the only safe fallback.
  if (result.styles && !result.styles.includes(culture)) return null;

  const pristineSource = result[culture];
  const overrideSource =
    typeof options.generatedImage === "string"
      ? options.generatedImage
      : options.generatedImage?.src;
  const selectedSource = isNonEmptyString(overrideSource)
    ? overrideSource
    : pristineSource;
  if (!isNonEmptyString(selectedSource)) return null;

  const cultureName = CULTURE_NAMES[culture];
  const displayIsPlaceholder = Boolean(
    result.placeholder === true ||
      result.seg_regions?.placeholder === true ||
      result.object_map?.placeholder === true ||
      result.room_analysis?.placeholder === true ||
      options.provenance?.placeholder === true,
  );
  const realRegions =
    !displayIsPlaceholder &&
    result.seg_regions != null &&
    result.seg_regions.placeholder !== true
      ? result.seg_regions
      : null;
  const realObjectMap =
    !displayIsPlaceholder &&
    result.object_map != null &&
    result.object_map.placeholder !== true
      ? result.object_map
      : null;
  const realRoomAnalysis =
    !displayIsPlaceholder &&
    result.room_analysis != null &&
    result.room_analysis.placeholder !== true
      ? result.room_analysis
      : null;

  // Older LIGHT backends marked only their analysis envelopes. Since depth is
  // produced by that same pass and has no envelope of its own, any such marker
  // makes the depth image unsafe to present as evidence.
  const realDepthSource =
    !displayIsPlaceholder && isNonEmptyString(result.depth_map)
      ? result.depth_map
      : null;

  const understanding: StoryRoomUnderstanding = {};
  if (realRegions) {
    understanding.regions = realRegions.regions;
    understanding.segmentationVersion = realRegions.version;
  }
  if (realObjectMap) {
    understanding.objects = realObjectMap.objects;
    understanding.objectMapVersion = realObjectMap.version;
  }
  if (realRoomAnalysis) understanding.roomAnalysis = realRoomAnalysis;
  if (!displayIsPlaceholder && options.segmentationImage) {
    understanding.segmentationImage = options.segmentationImage;
  }
  if (realDepthSource) {
    understanding.depthImage = {
      src: realDepthSource,
      alt: {
        en: "Depth map returned for the uploaded room",
        ar: "خريطة العمق المُعادة للغرفة المرفوعة",
      },
      caption: {
        en: "Brighter values are closer to the camera.",
        ar: "القيم الأكثر سطوعاً أقرب إلى الكاميرا.",
      },
    };
  }

  const explanations: DesignStoryData["explanations"] = [
    {
      id: "selected-culture",
      title: { en: "Selected cultural lens", ar: "المنظور الثقافي المختار" },
      detail: {
        en: `${cultureName.en} is the culture selected for this output. This is a user choice, not a cultural-accuracy score.`,
        ar: `${cultureName.ar} هو الطابع الثقافي المختار لهذه النتيجة. هذا اختيار المستخدم وليس تقييماً للدقة الثقافية.`,
      },
      basis: {
        en: "Selected result culture",
        ar: "ثقافة النتيجة المختارة",
      },
    },
  ];

  if (realRegions) {
    const count = realRegions.regions.length;
    explanations.push({
      id: "returned-regions",
      title: { en: "Returned room detections", ar: "عناصر الغرفة المُكتشفة" },
      detail: {
        en: `The backend returned ${count} segmented room ${count === 1 ? "region" : "regions"} for this image.`,
        ar: `أعاد الخادم ${count} من مناطق الغرفة المجزأة لهذه الصورة.`,
      },
      basis: {
        en: `/redesign seg_regions · ${realRegions.version}`,
        ar: `/redesign seg_regions · ${realRegions.version}`,
      },
    });
  }

  if (realObjectMap) {
    const count = realObjectMap.objects.length;
    explanations.push({
      id: "returned-object-map",
      title: { en: "Returned spatial map", ar: "المخطط المكاني المُعاد" },
      detail: {
        en: `The backend returned ${count} depth-projected object ${count === 1 ? "footprint" : "footprints"} for the top-down plan.`,
        ar: `أعاد الخادم ${count} من بصمات العناصر المسقطة بالعمق للمخطط العلوي.`,
      },
      basis: {
        en: `/redesign object_map · ${realObjectMap.version}`,
        ar: `/redesign object_map · ${realObjectMap.version}`,
      },
    });
  }

  if (realRoomAnalysis) {
    explanations.push({
      id: "returned-room-analysis",
      title: { en: "Returned room understanding", ar: "فهم الغرفة المُعاد" },
      detail: {
        en: "The backend returned a room-analysis summary with free-floor ratios, existing categories, placement candidates, and scale confidence. Metric area remains unavailable when no size reference was found.",
        ar: "أعاد الخادم ملخصاً لتحليل الغرفة يتضمن نسب المساحة الأرضية الحرة والفئات الموجودة ومواقع الوضع المقترحة وثقة المقياس. تبقى المساحة المترية غير متاحة عند غياب مرجع للحجم.",
      },
      basis: {
        en: "/redesign room_analysis",
        ar: "/redesign room_analysis",
      },
    });
  }

  if (realDepthSource) {
    explanations.push({
      id: "returned-depth",
      title: { en: "Returned depth evidence", ar: "بيانات العمق المُعادة" },
      detail: {
        en: "The backend returned a grayscale depth map for this room; brighter values represent surfaces closer to the camera.",
        ar: "أعاد الخادم خريطة عمق رمادية لهذه الغرفة؛ وتمثل القيم الأكثر سطوعاً الأسطح الأقرب إلى الكاميرا.",
      },
      basis: { en: "/redesign depth_map", ar: "/redesign depth_map" },
    });
  }

  if (realRegions || realObjectMap) {
    explanations.push({
      id: "ontology-vocabulary",
      title: { en: "Ontology vocabulary", ar: "مفردات الأنطولوجيا" },
      detail: {
        en: "DAR's ontology provides vocabulary for interpreting supported detection class keys. It is explanatory reference material, not evidence that those terms were sampled by the generator.",
        ar: "توفّر أنطولوجيا DAR مفردات لتفسير مفاتيح فئات الاكتشاف المدعومة. وهي مرجع تفسيري وليست دليلاً على استخدام هذه المصطلحات أثناء التوليد.",
      },
      basis: {
        en: "src/data/ontology.json",
        ar: "src/data/ontology.json",
      },
    });
  }

  const durationMethodology: LocalizedText = {
    en: "Backend wall-clock time from the start of the redesign build through rendering, SSIM, and room analysis; it can include time waiting for the generation lock.",
    ar: "زمن الخادم من بدء عملية إعادة التصميم حتى اكتمال التوليد وSSIM وتحليل الغرفة؛ وقد يشمل انتظار قفل التوليد.",
  };
  const ssimMethodology: LocalizedText = {
    en: "Grayscale SSIM at 256×256 between the uploaded room and the pristine generated output, measured before later edits.",
    ar: "مقياس SSIM رمادي بدقة 256×256 بين الغرفة المرفوعة والنتيجة الأصلية المولّدة، قبل أي تعديلات لاحقة.",
  };
  const detectionMethodology: LocalizedText = {
    en: "Count of regions in the non-placeholder segmentation envelope returned for this room.",
    ar: "عدد المناطق في بيانات التجزئة الحقيقية المُعادة لهذه الغرفة.",
  };
  const objectMethodology: LocalizedText = {
    en: "Count of footprints in the non-placeholder top-down object-map envelope returned for this room.",
    ar: "عدد بصمات العناصر في بيانات المخطط العلوي الحقيقية المُعادة لهذه الغرفة.",
  };

  const durationSource = { en: "/redesign duration_s", ar: "/redesign duration_s" };
  const ssimSource = {
    en: `/redesign ssim.${culture}`,
    ar: `/redesign ssim.${culture}`,
  };
  const detectionSource = {
    en: "/redesign seg_regions.regions",
    ar: "/redesign seg_regions.regions",
  };
  const objectSource = {
    en: "/redesign object_map.objects",
    ar: "/redesign object_map.objects",
  };

  const duration = result.duration_s;
  const pristineSsim = result.ssim?.[culture];
  const measurements: StoryMeasurement[] = [
    !displayIsPlaceholder && finiteNumber(duration) && duration >= 0
      ? {
          id: "duration",
          label: { en: "Server pipeline duration", ar: "مدة معالجة الخادم" },
          value: duration,
          measured: true,
          format: "seconds",
          methodology: durationMethodology,
          source: durationSource,
        }
      : unavailableMeasurement(
          "duration",
          { en: "Server pipeline duration", ar: "مدة معالجة الخادم" },
          "seconds",
          durationMethodology,
          durationSource,
        ),
    !displayIsPlaceholder &&
    finiteNumber(pristineSsim) &&
    pristineSsim >= 0 &&
    pristineSsim <= 1
      ? {
          id: "pristine-ssim",
          label: { en: "Pristine structure similarity", ar: "تشابه البنية الأصلية" },
          value: pristineSsim,
          measured: true,
          format: "decimal",
          methodology: ssimMethodology,
          source: ssimSource,
        }
      : unavailableMeasurement(
          "pristine-ssim",
          { en: "Pristine structure similarity", ar: "تشابه البنية الأصلية" },
          "decimal",
          ssimMethodology,
          ssimSource,
        ),
    realRegions
      ? {
          id: "detected-regions",
          label: { en: "Detected regions", ar: "المناطق المكتشفة" },
          value: realRegions.regions.length,
          measured: true,
          format: "integer",
          methodology: detectionMethodology,
          source: detectionSource,
        }
      : unavailableMeasurement(
          "detected-regions",
          { en: "Detected regions", ar: "المناطق المكتشفة" },
          "integer",
          detectionMethodology,
          detectionSource,
        ),
    realObjectMap
      ? {
          id: "mapped-objects",
          label: { en: "Mapped objects", ar: "العناصر في المخطط" },
          value: realObjectMap.objects.length,
          measured: true,
          format: "integer",
          methodology: objectMethodology,
          source: objectSource,
        }
      : unavailableMeasurement(
          "mapped-objects",
          { en: "Mapped objects", ar: "العناصر في المخطط" },
          "integer",
          objectMethodology,
          objectSource,
        ),
  ];

  const overrideDiffersFromPristine =
    isNonEmptyString(overrideSource) &&
    (!isNonEmptyString(pristineSource) || overrideSource !== pristineSource);
  const edited = overrideDiffersFromPristine || options.edited === true;
  const provenanceWasSupplied = Object.prototype.hasOwnProperty.call(
    options,
    "provenance",
  );
  const metadata = provenanceWasSupplied
    ? options.provenance
      ? {
          ...options.provenance,
          placeholder: displayIsPlaceholder,
        }
      : undefined
    : isNonEmptyString(result.job_id)
      ? {
          jobId: result.job_id,
          placeholder: displayIsPlaceholder,
        }
      : undefined;

  return {
    original: {
      src: result.original,
      alt: { en: "Original uploaded room", ar: "الغرفة الأصلية المرفوعة" },
    },
    generated: imageFromOverride(
      options.generatedImage,
      selectedSource,
      cultureName,
      displayIsPlaceholder ? "placeholder" : edited ? "edited" : "generated",
    ),
    culture,
    ...(Object.keys(understanding).length > 0 ? { understanding } : {}),
    explanations,
    measurements,
    ...(metadata ? { metadata } : {}),
    edited,
    placeholder: displayIsPlaceholder,
  };
}

/**
 * Hand "Inside DAR" the real depth map and segmentation regions this run
 * produced, so its chapters stop being diagrams of a pipeline and start being
 * the pipeline's own output.
 *
 * `GenerationStoryAssets` was designed for exactly this — its own field docs
 * say "/redesign.depth_map is suitable after completion/replay" — and Studio
 * simply never passed it, at either mount point. That is why those chapters
 * read as empty: not a rendering bug, an unwired input.
 *
 * The placeholder gate here is deliberately IDENTICAL to the one
 * createDesignStoryData applies, and for the same reason: in LIGHT mode the
 * synthetic room's depth and segmentation are manufactured, and presenting
 * them as evidence would be a lie told more convincingly than any empty state.
 * Any placeholder marker anywhere in the response disqualifies the whole set,
 * because depth has no envelope of its own — it comes off the same pass.
 *
 * Returns `null`, not an empty object, when nothing is real, so a caller can
 * pass it straight through and let the component keep its honest fallback.
 */
export function createGenerationStoryAssets(
  result: RedesignResult | null | undefined,
): GenerationStoryAssets | null {
  if (!result) return null;

  const isPlaceholder = Boolean(
    result.placeholder === true ||
      result.seg_regions?.placeholder === true ||
      result.object_map?.placeholder === true ||
      result.room_analysis?.placeholder === true,
  );
  if (isPlaceholder) return null;

  const assets: GenerationStoryAssets = {};

  if (isNonEmptyString(result.depth_map)) {
    assets.depthImage = {
      src: result.depth_map,
      alt: {
        en: "Depth map estimated from the uploaded room — nearer surfaces lighter.",
        ar: "خريطة العمق المُقدّرة من الغرفة المرفوعة — الأسطح الأقرب أفتح.",
      },
    };
  }

  if (result.seg_regions != null && result.seg_regions.placeholder !== true) {
    const regions = result.seg_regions.regions;
    if (Array.isArray(regions) && regions.length > 0) {
      assets.segmentationRegions = regions;
    }
  }

  // The generation chapter draws an abstract metaphor when it has nothing real.
  // It has something real: the renders this run just produced. Driven by
  // `styles` rather than by which image fields happen to be non-null, so a
  // one-culture request describes one culture.
  const produced = (result.styles ?? (["lebanese", "khaleeji", "moroccan"] as StyleId[]))
    .filter((style): style is StyleId => isNonEmptyString(result[style]))
    .map((style) => ({
      src: result[style] as string,
      alt: {
        en: `The room generated in the ${CULTURE_NAMES[style].en} style.`,
        ar: `الغرفة المولّدة بالطابع ${CULTURE_NAMES[style].ar}.`,
      },
      caption: CULTURE_NAMES[style],
    }));
  if (produced.length > 0) assets.generatedOutputs = produced;

  // The loop point shows the room the user actually uploaded rather than a
  // stock interior. It is the one asset that is unambiguously theirs.
  if (isNonEmptyString(result.original)) {
    assets.detailTeaser = {
      src: result.original,
      alt: {
        en: "Detail from the room you uploaded.",
        ar: "تفصيل من الغرفة التي رفعتها.",
      },
    };
  }

  return Object.keys(assets).length > 0 ? assets : null;
}

/**
 * Turn `/redesign.provenance` into the capabilities the pipeline chapter may
 * state, for the ONE culture on screen.
 *
 * The chapter used to caption itself "conceptual architecture — not live
 * telemetry" because nothing could prove otherwise: the response carried no
 * provenance, so `capabilities` was always empty and every node was a label on
 * a diagram. The backend now reports what it obeys (see transform.provenance),
 * and this narrows it to the selected culture, because "a LoRA was used" is a
 * per-culture fact — Lebanese may have one where Persian does not.
 *
 * It deliberately routes through storyGenerationMetadataFromManifest and
 * generationPipelineCapabilitiesFromMetadata rather than deriving capabilities
 * directly: those two already encode when a claim is permitted (placeholder
 * suppresses everything; a null LoRA means absent, not unknown; ControlNet
 * counts only at a weight above zero). A second derivation would be a second
 * opinion about honesty, and the two would drift.
 */
export function generationCapabilitiesFromProvenance(
  provenance: RedesignProvenance | null | undefined,
  culture: StyleId,
): GenerationPipelineCapabilities {
  if (!provenance || provenance.light_mode === true) return {};

  const controlnet = provenance.controlnet?.[culture];
  // Flattened into the manifest shape the existing adapter already understands.
  const manifest: Record<string, unknown> = {};
  if (isNonEmptyString(provenance.model)) manifest.model = provenance.model;
  if (finiteNumber(provenance.lora_scale)) manifest.lora_scale = provenance.lora_scale;
  // Only assert the LoRA when this culture was actually described. Writing the
  // key at all is the difference between "absent" and "unknown".
  if (provenance.lora && Object.prototype.hasOwnProperty.call(provenance.lora, culture)) {
    manifest.lora = provenance.lora[culture];
  }
  if (controlnet) {
    manifest.controlnet = { depth: controlnet.depth, seg: controlnet.seg };
    if (typeof provenance.dual_controlnet === "boolean") {
      manifest.dual_controlnet = provenance.dual_controlnet;
    }
  }
  if (Object.keys(manifest).length === 0) return {};

  return generationPipelineCapabilitiesFromMetadata(
    storyGenerationMetadataFromManifest(manifest),
  );
}

/** Convert the legacy asynchronous job status without inventing stage progress. */
export function generationStoryStatusFromJobStatus(
  jobStatus: JobStatus,
): GenerationStoryStatus {
  const progress =
    finiteNumber(jobStatus.progress) &&
    jobStatus.progress >= 0 &&
    jobStatus.progress <= 1
    ? {
        value: jobStatus.progress,
        source: "backend" as const,
        label: { en: "Backend-reported progress", ar: "التقدّم المُبلغ من الخادم" },
      }
    : null;

  const hasErrorMessage =
    jobStatus.status === "error" &&
    (isNonEmptyString(jobStatus.error_message_en) ||
      isNonEmptyString(jobStatus.error_message_ar));
  const error = hasErrorMessage
    ? {
        en: isNonEmptyString(jobStatus.error_message_en)
          ? jobStatus.error_message_en
          : "Generation failed.",
        ar: isNonEmptyString(jobStatus.error_message_ar)
          ? jobStatus.error_message_ar
          : "تعذّر إنشاء التصميم.",
      }
    : null;

  return {
    state: jobStatus.status,
    jobId: jobStatus.job_id,
    label: JOB_STATUS_LABELS[jobStatus.status],
    error,
    reportedProgress: progress,
  };
}
