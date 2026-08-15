# DAR Story components

These client components turn existing DAR data into a bilingual narrative. They do not fetch, generate, save, or manufacture evidence. The current integration point is Studio's synchronous `POST /redesign` flow.

## Public APIs

```tsx
import {
  CultureDNA,
  DesignStory,
  GenerationStory,
  createDesignStoryData,
  generationPipelineCapabilitiesFromMetadata,
  generationStoryStatusFromJobStatus,
  storyGenerationMetadataFromManifest,
  type CreateDesignStoryDataOptions,
  type DesignStoryData,
  type GenerationResearchAsset,
  type GenerationStoryAssets,
} from "@/components/story";
```

- `DesignStory` presents a completed, single-culture result in eight chapters. Its `data` prop is a `DesignStoryData`; stateful actions remain React-node slots.
- `CultureDNA` presents canonical ontology vocabulary for one culture or an editorial view of all three profiles.
- `GenerationStory` presents the seven-chapter Inside DAR waiting experience. Its chapter clock is documentary pacing, never backend telemetry.

All three use `ThemeLanguageContext` for English/Arabic rendering and accept an optional `className`.

## 1. DesignStory

```ts
createDesignStoryData(
  result: RedesignResult,
  culture: StyleId,
  options?: CreateDesignStoryDataOptions,
): DesignStoryData | null
```

Use the culture actually selected in Studio (`featured`). Do not use `result.object_map.style`: the map describes a shared analysis artifact, not the selected output. When `result.styles` is present, the adapter also checks that the selected culture was returned.

The adapter:

- uses `result.original` and the selected culture image;
- accepts the currently displayed image through `generatedImage` and marks a differing override as edited;
- excludes placeholder segmentation, map, room-analysis, and depth artifacts from evidence;
- never falls back to demo regions or objects;
- preserves genuine numeric zeroes as measured values;
- emits explicit unavailable measurements with `value: null` and `measured: false`;
- reports only returned duration, pristine per-culture SSIM, detection count, and object count;
- treats ontology terms as explanatory vocabulary, not proof that a prompt sampled them;
- returns `null` when the original or selected output is unavailable.

### Studio result integration

The following uses variables already present in `src/app/studio/page.tsx`:

```tsx
const featuredSrc = result[featured] ?? result.original;
const storyData = createDesignStoryData(result, featured, {
  generatedImage: featuredSrc,
});

if (!storyData) return null;

const durationMeasurement = storyData.measurements.find(
  (measurement) => measurement.id === "duration",
);
const ssimMeasurement = storyData.measurements.find(
  (measurement) => measurement.id === "pristine-ssim",
);
const measuredDuration =
  durationMeasurement?.measured && typeof durationMeasurement.value === "number"
    ? durationMeasurement.value
    : null;
const measuredSsim =
  ssimMeasurement?.measured && typeof ssimMeasurement.value === "number"
    ? ssimMeasurement.value
    : null;
return (
  <DesignStory
    data={storyData}
    slots={{
      save: storyData.placeholder ? undefined : (
        <SaveDesignButton
          oldImage={result.original}
          newImage={featuredSrc}
          culture={featured}
          duration={measuredDuration}
          ssim={measuredSsim}
          edited={storyData.edited}
        />
      ),
      history: (
        <Link href="/history">
          {isArabic ? "سجلّي" : "Design history"}
        </Link>
      ),
      report: undefined,
    }}
  />
);
```

`SaveDesignButton` deliberately receives the image on screen. Its `duration` and `ssim` remain the pristine `/redesign` measurements, while `edited` prevents a later colour or furniture edit from being presented as untouched pipeline output. `/history` is the existing durable destination; `DesignStory` does not duplicate its storage logic.

The example withholds Save for a LIGHT-mode stand-in. It also reads duration and SSIM through the adapter's measured-value gate rather than forwarding unchecked response values.

`slots.report` is the Room Report integration point, but the current `RoomReport` canvas footer hardcodes SDXL 1.0, dual ControlNet, and a cultural LoRA. Those claims are not true for every runtime/culture path, and `/redesign` does not return the provenance needed to prove them. This package therefore does not auto-wire that component. Claude main should first make the report footer accept real capability/provenance props; it can then pass `storyData.understanding?.regions`, `storyData.understanding?.objects`, the actual images, and a truthful `isLive` flag through this slot.

The `designer` slot is the clean DAR Designer integration point. **It is now filled**: Studio passes `<EnterBuildMode variant="link" />`, which hands the result to Build Mode at `/design` (see CLAUDE.md → "Build Mode + Render with DAR"). Before that destination existed the slot was deliberately left empty and chapter 06 rendered an em dash — that remains the correct behaviour for any integration without a real control or destination, since the component renders an unavailable state instead of inventing a CTA. `comparison` can likewise override the built-in accessible `StoryComparison` only when Studio needs a custom control. The built-in comparison uses one shared crop and detects natural image ratios; if they differ by more than one percent, it removes the misleading wipe and presents the full images side by side.

## 2. CultureDNA

```tsx
<CultureDNA culture={generateScope} />
```

`culture` accepts `StyleId | "all"`. In the current Studio selector, `generateScope` is therefore directly compatible. On a completed result, pass `featured` to tell the story of the image actually shown.

Optional props select canonical categories, limit terms per category, show palette hex values, or override localized editorial copy. Review state is visible by default and reproduces each ontology term's `verified` field. `CultureDNA` reads the canonical `ontology/ontology.json` through the checked-in culture profiles. The existing `RoomReport` and highlighter read `src/data/ontology.json`; keep those copies synchronized until they share one import.

`"all"` is an editorial synthesis of the Lebanese, Khaleeji, and Moroccan profiles. It is not a blended backend style, a percentage mixture, or a cultural-accuracy score.

## 3. GenerationStory

The current `redesignRoom(imageFile, ...)` call resolves only after the synchronous `/redesign` response completes. Server whitespace heartbeats may keep the connection alive, but the client still receives parsed result data only with the final JSON. While it is pending, Studio knows the uploaded preview, requested scope, local phase, and elapsed wall-clock time. It does not yet know a job ID, stage, detections, depth map, result metadata, or backend progress.

```tsx
{phase === "loading" && imagePreviewUrl && (
  <GenerationStory
    inputImage={imagePreviewUrl}
    culture={generateScope}
    status={{
      state: "requesting",
      elapsedSeconds: elapsed,
    }}
  />
)}
```

Do not pass Studio's animated loading percentage as `reportedProgress`. The only supported progress envelope is `BackendReportedProgress` with `source: "backend"`. Likewise, the component's 30–40 second chapter loop describes the experience; it does not estimate generation completion.

`initialAutoPlay` controls only the first documentary state. After mount, Pause/Resume and manual chapter selection own playback. Reduced-motion users always receive a static, manually navigable story.

The legacy asynchronous status contract can be adapted only when a real `JobStatus` response exists:

```tsx
const storyStatus = generationStoryStatusFromJobStatus(jobStatus);

{imagePreviewUrl && (
  <GenerationStory
    inputImage={imagePreviewUrl}
    culture={generateScope}
    status={storyStatus}
  />
)}
```

`generationStoryStatusFromJobStatus` copies backend progress into the backend-only envelope and carries the real job ID and error text. It should not be used to fabricate an async status for `/redesign`.

After a result exists, real regions and depth can support a replay or documentary view. Derive them from the already truth-filtered story data:

```tsx
const generationAssets: GenerationStoryAssets = {
  ...(storyData.understanding?.regions
    ? { segmentationRegions: storyData.understanding.regions }
    : {}),
  ...(storyData.understanding?.segmentationImage
    ? { segmentationImage: storyData.understanding.segmentationImage }
    : {}),
  ...(storyData.understanding?.depthImage
    ? { depthImage: storyData.understanding.depthImage }
    : {}),
};

<GenerationStory
  inputImage={storyData.original}
  culture={storyData.culture}
  assets={generationAssets}
/>
```

An empty returned segmentation envelope is still real evidence of zero detections, so the adapter preserves its empty array. An absent or placeholder envelope remains absent.

## Optional `/restyle` provenance

`/redesign` does not return a prompt, seed, model label, LoRA identity, ControlNet weights, output hash, or provenance manifest. Do not infer those values from repository architecture.

`/restyle` may return a real manifest. Normalize it explicitly and attach it to the restyled artifact:

```tsx
async function createRestyledStory(scale: number) {
  if (!imageFile || !result) return null;

  const restyled = await restyleRoom(imageFile, featured, scale);
  const provenance = storyGenerationMetadataFromManifest(restyled.manifest);
  const restyledStoryData = createDesignStoryData(result, featured, {
    generatedImage: restyled.image,
    provenance,
  });
  const restyleCapabilities =
    generationPipelineCapabilitiesFromMetadata(provenance);

  return { restyledStoryData, restyleCapabilities };
}
```

Use `restyleCapabilities` only for a post-response replay or another view of that same restyled artifact. The manifest cannot retroactively describe the earlier `/redesign` wait. A LIGHT-mode manifest is marked as placeholder and does not prove pipeline capabilities. The current `/restyle` response has no separate job ID, so the adapter deliberately does not borrow the earlier `/redesign` job ID for the restyled artifact.

## Research asset provenance

`GenerationStoryAssets.research` accepts only real `GenerationResearchAsset` records. Every record requires a visible bilingual `source`, such as its repository asset path, dataset reference, experiment record, or run identifier. Set `culture` to one real `StyleId`, or use `"shared"`/omit it only when the asset genuinely applies across profiles. In the all-cultures view, the component visibly labels scope and selects one available asset per culture before filling its fourth card, so array order cannot silently make one profile represent all three. The media, title, kind, and culture scope must all describe that actual asset.

An integration that already owns a curated collection can pass it without generating filler:

```ts
function assetsFromResearch(
  researchAssets: GenerationResearchAsset[],
): GenerationStoryAssets | undefined {
  return researchAssets.length > 0 ? { research: researchAssets } : undefined;
}
```

Keep the research chapter empty when no sourced collection is available. Do not synthesize screenshots, use generic AI imagery, or label decorative media as model/training evidence.

## Explicitly unsupported or future

- Live per-stage telemetry, backend progress, and a job ID during the current synchronous `/redesign` request.
- A segmentation bitmap from `/redesign`; the current response supplies bounding boxes only. A real externally supplied `StoryImage` is supported.
- Prompts, sampled ontology terms, seeds, exact model/LoRA/ControlNet configuration, hashes, and generation timestamps for `/redesign`.
- Cultural authenticity, accuracy, or blend percentages.
- Demo segmentation, demo maps, placeholder room analysis/depth, fake measurements, or guessed metadata.
- Training screenshots and model-research media until curated assets with visible provenance exist.
- A blended `"all"` generation. The backend returns separate requested culture outputs.
- Independent confirmation of ontology review governance. The UI reproduces each `verified` field as “marked” state, while `ontology/sources.md` still needs reconciliation with those booleans.
- A DAR Designer destination until the owning feature supplies a real node through `slots.designer`.

Unavailable facts should stay absent or `null`; the components render honest empty states and em dashes. Never replace them with sample values for presentation.
