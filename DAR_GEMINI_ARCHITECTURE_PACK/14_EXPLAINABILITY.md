# 14 — Explainability

*Every surface where DAR explains itself, and — importantly — which are **narrative
retellings** and which are **literal execution evidence**.*

---

## 1. The two classes of explanation surface

> **This distinction matters for the diagram.** Do not draw "Inside DAR" as a pipeline
> stage; it is a UI panel that *describes* the pipeline.

| Class | Meaning | Surfaces |
|---|---|---|
| **EVIDENCE** — literal artifacts from the actual run | Renders data the backend genuinely produced | Understood Room (highlighter, 2D map, DepthOrbit), the conditioning evidence strip, the manifest-derived provenance |
| **NARRATIVE** — editorial retelling | Explains *how DAR works*, paced for reading, not measured | Design Story, Culture DNA, Inside DAR, Cultural Narration |

---

## 2. The Understood Room — three layers of literal evidence

All three come from **one** depth+segmentation pass in `/redesign`.

| Layer | Question | Component | Data | Backend function |
|---|---|---|---|---|
| **How it looks** | — | `BeforeAfterSlider` | the renders | `transform_room` |
| **What is in it** | *"What did DAR see?"* | `CulturalElementHighlighter` | `seg_regions` | `projection.seg_bounding_boxes()` |
| **How it's laid out** | *"Where is everything?"* | `RoomMap2D` | `object_map` | `projection.project_top_down()` |
| **How it feels to be in** | *"What is the space like?"* | `DepthOrbit` | `depth_map` | Depth Anything V2 |

**`CulturalElementHighlighter`** — overlays SVG regions with accessible hotspots; clicking
one reveals the element's Arabic term and design note from `src/data/ontology.json`.
It degrades to a bare image when there are no regions.

**`RoomMap2D`** — top-down footprints, door/window wall openings, bilingual labels,
click-to-read notes.

**`DepthOrbit`** — a three.js plane displaced by the depth PNG, clamped **parallax** orbit
(not a fly-through — DAR does not have a full 3D reconstruction and must not imply one).
Respects `prefers-reduced-motion`, caps DPR at 2, disposes GL resources on unmount.

**Truth labelling:** Studio labels the section **"(live)"** when both regions and map are
real, and **"(preview)"** when it has fallen back to `DEMO_REGIONS` / `DEMO_MAP`.

---

## 3. The narrative layer — `src/components/story/`

Three client components that turn data `/redesign` **already returned** into a bilingual
narrative. **They never fetch, generate, save, or manufacture evidence.**

| Component | Shape | What it explains |
|---|---|---|
| **`DesignStory`** | 8 chapters over one finished, single-culture result | How DAR read *this* room |
| **`CultureDNA`** | Ontology vocabulary for one culture, or an editorial synthesis of all three | What the culture's design language *is* |
| **`GenerationStory`** ("Inside DAR") | 7-chapter documentary loop | How the pipeline works |

`GenerationStory` is mounted **twice**: during the live wait (`phase === "loading"`) and as
a post-result replay.

**Stateful actions stay as React-node slots** (`save`, `history`, `report`, `designer`,
`comparison`) so the story never duplicates a flow that already has an owner.

### ⚠ Two rules that keep the narrative honest

**1. Never pass Studio's animated `progress` as `reportedProgress`.**
It is an **animation curve** (`1 - e^(-t/40)`, capped at 0.92), not telemetry. The only
supported envelope is `BackendReportedProgress` with `source: "backend"`, and `/redesign`
has none. **The chapter clock is documentary pacing and does not estimate completion.**

**2. Pass the culture actually on screen (`featured`), not `result.object_map.style`.**
The map describes a *shared analysis artifact*, not the selected output.

---

## 4. ⭐ `adapters.ts` — the truth gate

**This is the reason the explanation layer is safe.** `src/components/story/adapters.ts`
(533 lines) sits between the raw API response and every narrative component.

`createDesignStoryData(result, culture, opts)` returns **`null` outright** — i.e. the
Design Story is simply not offered — when:
- `result.original` is not a non-empty string, **or**
- `result.styles` is present and does not include `culture`, **or**
- neither the override image nor `result[culture]` is a non-empty string.

Otherwise it enforces:

| Rule | Implementation |
|---|---|
| Placeholder detection is an **OR** over every marker | `result.placeholder \|\| seg_regions.placeholder \|\| object_map.placeholder \|\| room_analysis.placeholder \|\| opts.provenance.placeholder` |
| Each artifact is `null` unless **its own** envelope is real **and** the display is not a placeholder | `realRegions`, `realObjectMap`, `realRoomAnalysis` |
| **Depth is nulled by ANY placeholder marker** | It comes from the same pass and has no envelope of its own, so a LIGHT backend's depth can never be presented as evidence |
| **Never falls back to demo data** | Unlike Studio's own `mapObjects`/`highlightRegions`, `adapters.ts` has no `DEMO_*` path at all |
| Genuine numeric zeroes are preserved | A real `0` is data; a missing value is not |
| Unmeasured values become `{value: null, measured: false}` | Rendered as an **em-dash**, never `0` |
| Every measurement carries `methodology` + `source` | `duration` ← `/redesign duration_s`; `pristine-ssim` ← `ssim[culture]`, range-checked `0..1`; `detected-regions`; `mapped-objects` |
| Explanations carry a `basis` citation | The ontology explanation explicitly states it is *"explanatory reference material, not evidence that those terms were sampled by the generator"* |

> **Consequence worth expecting:** in Defense Mode and LIGHT runs, **duration and SSIM
> correctly render as "—"** because the demo pack reports neither. **That is the gate
> working, not a wiring bug.**

---

## 5. Provenance from the manifest

`storyGenerationMetadataFromManifest`:
- distinguishes **"absent"** from **"explicitly null"** (`hasOwnProperty("lora")` preserves
  `null`) — so "we do not know whether a LoRA ran" and "no LoRA ran" are different states
- accepts `generated_at` as an ISO string or epoch seconds
- only sets `controlNet` when the manifest actually has a `controlnet` object

`generationPipelineCapabilitiesFromMetadata`:
- returns `{}` for placeholder metadata
- only claims `controlNet: true` when a depth **or** seg weight is `> 0`

`generationStoryStatusFromJobStatus`:
- only reports progress when the backend value is a finite `0..1`, tagged `source: "backend"`
- **never invents stage progress**

---

## 6. The conditioning evidence strip — the strongest explainability feature

In `HandoffPanel`, Render with DAR shows **the actual depth and segmentation images that
were sent to the generator**, alongside the beauty pass.

**It also states the limit explicitly:**

| | |
|---|---|
| **HELD** | placement · orientation · geometry · viewpoint — *because they are the control signal* |
| **NOT HELD** | the appearance of any individual piece — the model invents surface and ornament inside the silhouette; materials reach it through the prompt, so they **steer rather than bind** |

**Capture happens BEFORE the request**, so the evidence survives a dead backend.
**A LIGHT backend returns `placeholder: true` and the UI says "That last image is not a
real render."** There is no fake render button.

→ [11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md)

---

## 7. Room Report — `src/components/RoomReport.tsx`

One click composes before/after + Arabic ontology terms + the 2D plan + a provenance footer
into a downloadable branded PNG. **Pure client-side canvas**, no server round trip. Fixed
dark-gold palette (not themed) because the report is an artifact, not a page.

> ### ⚠ `slots.report` is deliberately NOT auto-wired into `DesignStory`.
>
> `RoomReport`'s canvas footer **hardcodes** "SDXL 1.0 + dual ControlNet + a cultural LoRA",
> which is **not true for every runtime/culture path** — Persian has no LoRA, LIGHT mode
> renders nothing, and `DARDESIGN_DEPTH_ONLY` disables the seg ControlNet. `/redesign`
> returns no provenance to prove it.
>
> **Make that footer take real capability props first.** This is a known, deliberate
> non-wiring, not an oversight.

---

## 8. The planner's own explanation — `PlanPanel`

The most granular explainability surface in DAR, because it shows both what was accepted
**and what was refused**.

| Shown | Source |
|---|---|
| **Provenance badge** — "AI planner (`gemini-3.5-flash`)" vs **"Planned by DAR's rules"** | `fetchPlannerStatus()` + `plan.source` |
| **"DAR understood"** — culture, room type, capacity, wall/floor material swatches, intensity %, requirements, opening count | `understood`, every field validated against a DAR vocabulary |
| **Seat estimate** — *"Seats about 6"*, labelled an estimate; *"· 6 asked for"* when short | `seats_of()` — **DAR's arithmetic, not the model's claim** |
| **Per-item reasons**, bilingual | `reasonEn` / `reasonAr` |
| **`repaired` tag** | The item was moved by `findSpot` |
| **`blocksOpening` tag** | Advisory — stands in a door/window keep-clear zone |
| **"Not placed" list** | `gated.dropped` (client) **+** `plan.rejected` (backend), each with a distinct true reason |

> **Refusals are shown, not hidden.** A shorter plan than the model wrote is explained
> rather than silently displayed. → [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md) §5.

---

## 9. Spatial explainability in Build Mode

| Surface | Explains |
|---|---|
| **Drag ghost colour** (`ok` / `advisory` / `blocked`) | Whether the drop will be accepted — coloured **directly from `evaluatePlacement`** |
| **Snap guides** | *Why* the object jumped. *"A snap you cannot see feels like a glitch."* |
| **Inspector verdict text** | The same verdict, in words |
| **`shellSource` chip** | `measured` / `estimated` / `default` — **a default room is never presented as a measurement** |
| **`N found` chip** | How many objects came from the photograph; doubles as the layer toggle |
| **"From your photo · approximate"** | Labels found objects in the Inspector |

**One rule, three surfaces** — ghost, explanation and refusal all read the same verdict, so
they cannot disagree.

---

## 10. Audit trail — `backend/audit.py`

Append-only JSONL at `backend/audit.jsonl`, **metadata only, never image bytes**, written
under a lock, and **it never raises** (a failed audit write must not cost a render).

Events: `redesign`, `restyle`, `render_scene`, `history_save`, `feedback`,
`subscription_request`, `subscription_cancel`, `subscription_decision`,
`furniture_placement`, `design_plan`, `color_edit`.

Exposed at `GET /audit` (newest-first, `limit` clamped 1–500) → the unlinked `/audit` page.

> ⚠ **The token gate only engages when `DARDESIGN_AUDIT_TOKEN` is set** — the audit trail
> is **open by default**.
>
> The file deliberately lives **outside `uploads/`** so the 24 h TTL sweeper never eats it.

---

## 11. Cultural Narration

`src/components/CulturalNarration.tsx` — bilingual spoken narration via the **Web Speech
API**. It speaks Arabic. Degrades silently when `speechSynthesis` is absent.

---

## 12. Editorial rules the explanation layer honours

- **Em-dash, never a fabricated zero**, for any unmeasured figure. On a 1–5 rating scale a
  zero is unreachable, so printing one would fabricate a result.
- **Mono type is restricted** to metric values, dimensions, durations and codes — never
  headings, body, buttons or nav.
- **"Average overall rating" is labelled as derived** (the mean of three rated dimensions);
  there is no Overall column in the database.
- **SSIM / LPIPS / CLIP each carry their reading direction**, because **LPIPS ↑ means a
  bigger change, not a worse model**.

---

## 13. Summary — evidence vs narrative

| Surface | Class | Can it show a fabricated value? |
|---|---|---|
| Highlighter / RoomMap2D | Evidence | No — falls back to demo data **but relabels to "(preview)"** |
| DepthOrbit | Evidence | No — only mounts when `depth_map` exists |
| Conditioning evidence strip | Evidence | No — shows the literal images sent |
| Manifest provenance | Evidence | No — distinguishes absent from null |
| Design Story | Narrative over evidence | **No — `adapters.ts` returns `null` rather than degrade** |
| Culture DNA | Narrative (reference material) | No — and it says it is reference material, not proof of sampling |
| Inside DAR | Narrative (documentary) | No — chapter pacing is explicitly not progress |
| Room Report | Evidence + **an over-claiming footer** | ⚠ **Yes — the footer hardcodes the pipeline.** Known; deliberately not auto-wired |
| PlanPanel | Evidence | No — shows refusals too |

---

Related: [04_ROOM_UNDERSTANDING.md](04_ROOM_UNDERSTANDING.md) ·
[06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md) ·
[11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md) ·
[16_EVALUATION.md](16_EVALUATION.md)
