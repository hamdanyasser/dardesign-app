# 25 — Implemented vs Planned

> **Purpose: prevent a planned feature from appearing in a diagram as a completed one.**
>
> **IMPLEMENTED** = the code exists and runs.
> **VERIFIED** = someone actually observed it working, and the observation is recorded.
> These are different columns for a reason.

---

## 1. The matrix

### Core pipeline

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| `POST /redesign` — 3 cultures in one call | ✅ | ✅ | `main.py`, `transform.py` | Tests + 4 real history rows (47–345 s) |
| SDXL + dual ControlNet | ✅ | ✅ | `transform.py` | depth 0.7 / seg 0.5 |
| Depth Anything V2 Small | ✅ | ✅ | `transform._depth_control_image` | |
| OneFormer ADE20K Swin-L | ✅ | ✅ | `transform._seg_control_image` | |
| Per-culture LoRA hot-swap | ✅ | ✅ | `transform._attach_lora` | **All 3 files on disk, 93 MB each** |
| OOM → SD 1.5 @768² | ✅ | ⚠ **Not observed** | `transform_room` | Code path exists; no recorded OOM event |
| `DARDESIGN_LIGHT` placeholder mode | ✅ | ✅ | `_emit_placeholder` | 583 tests run in it |
| Keepalive streaming | ✅ | ✅ | `_stream_keepalive` | |
| `_GEN_LOCK` serialisation | ✅ | ✅ | `main.py` | |
| **Persian culture** | ⚠ **PARTIAL** | ⚠ | ontology + `StylePack` + `/restyle` | **No LoRA, no catalogue items, not in `/redesign`, Build Mode or the planner** |

### Room understanding

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| Masks (floor/wall/occupied/protected/free) | ✅ | ✅ | `room_analysis.analyze_room` | |
| Scale estimation from reference widths | ✅ | ⚠ **Known unreliable** | `_estimate_scale` | **Observed 130 m² and 3.6 m² failures** |
| Plausibility band 9–90 m² | ✅ | ✅ | `roomModel.totalFloorM2` | Added *because* of those failures |
| `object_map` (top-down plan) | ✅ | ✅ | `projection.project_top_down` | |
| `seg_regions` (image-space boxes) | ✅ | ✅ | `projection.seg_bounding_boxes` | |
| Depth map PNG + DepthOrbit | ✅ | ✅ | `DepthOrbit.tsx` | |
| **Room width / depth** | ⚠ **DERIVED FROM AN ASSUMPTION** | — | `deriveRoom` | Area is estimated; **aspect ratio is a fixed 1.25** |
| **Room height** | ❌ **ASSUMED CONSTANT** | — | `DEFAULT_ROOM.heightCm` | **Always 300 cm. Never measured** |
| Segmentation accuracy (mIoU) | ❌ Not implemented | ❌ | — | |
| Depth accuracy | ❌ Not implemented | ❌ | — | |

### Cultural knowledge

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| Ontology, 4 cultures × 7 categories | ✅ | ✅ | `ontology/ontology.json` | 113 terms |
| Seeded weighted prompt sampling | ✅ | ✅ | `prompt_builder` | Same seed ⇒ same prompt |
| Bilingual EN/AR terms | ✅ | ✅ | | |
| **Khaleeji terms expert-verified** | ✅ | ✅ | `verified: true` ×30 | |
| **Moroccan terms expert-verified** | ✅ | ✅ | `verified: true` ×30 | |
| **Lebanese terms expert-verified** | ❌ **NO** | ❌ | `verified: false` ×30 | ⚠ **The hero culture is unverified** |
| **Persian terms expert-verified** | ❌ NO | ❌ | `verified: false` ×23 | |
| **`strict` mode excluding unverified terms** | ⚠ **Exists, NOT ENABLED** | ❌ | `build_prompts(strict=False)` | **No production caller passes `strict=True`** — unverified terms reach the prompt |
| 27-item furniture catalogue | ✅ | ✅ | `ontology/furniture.json` v0.2.0 | 9 per culture, 12 categories |
| 27 cut-out PNG assets | ✅ | ✅ | `public/furniture/` | Self-generated with DAR's own LoRAs |
| **RAG / retrieval / embeddings** | ❌ **NOT IMPLEMENTED** | ❌ | — | → [07](07_RAG_ARCHITECTURE.md) |

### LLM design planner

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| Gemini provider | ✅ | ✅ **LIVE** | `_call_gemini` | `planner-status` → `gemini-3.5-flash` |
| Anthropic provider | ✅ | ⚠ Not currently keyed | `_call_anthropic` | The code's default preference |
| `DARDESIGN_LLM_PROVIDER` override | ✅ | ✅ | `provider()` | |
| Gate 1 — JSON-Schema enum | ✅ | ✅ | `plan_schema` | Enforced on **both** providers |
| Gate 2 — no size fields | ✅ | ✅ | `plan_schema` | |
| Gate 3 — `validate_items` | ✅ | ✅ | tests | |
| Gate 4 — client `gatePlan` + SAT | ✅ | ✅ | `planner.ts` | |
| Gate 5 — culture coherence | ✅ | ✅ | `validate_items` | |
| Gate 6 — door/window keep-clear | ✅ | ✅ | `blockedOpening` | 90 cm / 40 cm |
| `understood` brief interpretation | ✅ | ✅ | `validate_understood` | Every field forced into a DAR vocabulary |
| Seat-capacity estimate | ✅ | ✅ | `seats_of` | **DAR's arithmetic, not the model's claim** |
| **Rule-based fallback** | ✅ | ✅ **Exercised in production** | `fallback_plan` | Hit a real `400 credit balance too low` — the user still got a furnished room |
| Response cache + call cap | ✅ | ✅ | `_cache`, `MAX_CALLS_PER_PROCESS` | |
| One-undo plan application | ✅ | ✅ | `beginGesture`/`endGesture` | 4 objects + 2 materials → 0 in one Ctrl+Z |

### Build Mode (3D)

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| Metric 3D room, centimetres | ✅ | ✅ | `types.ts`, `scene3d.ts` | |
| Room derived from the photograph | ✅ | ✅ | `deriveRoom` | |
| Locked "found" massing | ✅ | ✅ | `roomModel` | |
| 12 procedural builders | ✅ | ✅ | `geometry.ts` | Pinned by a test against `furniture.json` |
| Three-tier asset honesty, surfaced in the UI | ✅ | ✅ | `furniture_models.json`, `catalog.ts::modelTier` | REAL / ENHANCED PROCEDURAL / FALLBACK MASSING |
| **Real 3D models (GLTF/GLB)** | ⚠ **1 of 27** | ✅ | `modelLoader.ts`, `public/models/Ottoman_01.glb` | `leb-ottoman-001` only. CC0, Poly Haven. Landed 2026-08-14 in `a4cec54`/`ab8d9b4` |
| CC0 PBR textures (14 sets, 42 files) | ✅ | ✅ | `public/textures/`, `textures.ts` | Greyscale colour maps preserve the ontology palette |
| Procedural ornament (zellige etc.) | ✅ | ✅ | `src/lib/design/patterns.ts` | Drawn, not downloaded. Committed in `2380fa8` |
| 22 ontology-sourced materials | ✅ | ✅ | `materials.ts` | |
| SAT collision + two-tier verdict | ✅ | ✅ | `placement.ts` | |
| Snapping with visible guides | ✅ | ✅ | `snapPosition` | |
| `findSpot` auto-placement | ✅ | ✅ | | Two passes: clean spots first |
| Snapshot undo/redo + gesture coalescing | ✅ | ✅ | `store.ts` | |
| `localStorage` persistence | ✅ | ✅ | `dar-scene-v3:<jobId>` | |
| Wall openings from the photograph | ✅ | ✅ | `WallOpening` | Heights are **constant priors** |
| **Time-of-day / sun simulation** | ❌ **NOT in Build Mode** | — | `/v2 UnderstoodRoom` only | **Do not diagram as Build Mode** |
| Global circulation / path-finding check | ❌ **Not implemented** | — | — | 60 cm is a **prompt instruction only** |

### Render with DAR

| Feature | Implemented | Verified | Where | Notes |
|---|---|---|---|---|
| `renderConditioning` — 3 passes | ✅ | ✅ | `scene3d.ts` | |
| Interior capture camera | ✅ | ✅ **GPU A/B** | `CAPTURE_EYE_Y` etc. | Identical 13-object scene, before/after |
| Palette-exact segmentation | ✅ | ✅ **Pixel-verified** | `ade20k.ts` | Ceiling `120,120,80`, wall `120,120,120` |
| `control_override` in `_generate` | ✅ | ✅ **Instrumented** | `transform.py` | **`_prepare_conditioning` called 0 times** |
| `POST /render-scene` | ✅ | ✅ **GPU, 35.61 s** | `main.py` | 2026-08-13, `light_mode: false` |
| Honesty contract (held / not held) | ✅ | ✅ | `HandoffPanel` | |
| Placeholder labelling | ✅ | ✅ | | *"That last image is not a real render."* |
| **Cushion filter** (`ON_FURNITURE_CLASSES`) | ✅ | ⚠ **Conditioning only** | `roomModel.ts` | 69.6 % → 35.8 % floor coverage. **NOT re-rendered** |
| **Camera walk-in** (`CAPTURE_BODY_CM`) | ✅ | ⚠ **Conditioning only** | `scene3d.ts` | **NOT re-rendered — tunnel expired** |
| **Layout-preservation quality** | ❌ **Unmeasured** | ❌ | — | No side-by-side study |
| `_hf_hook` retry forwards `control_override` | ❌ **Latent bug** | ❌ | `_generate` | No test covers this path |

### Evaluation

| Feature | Implemented | Verified | **Has data?** | Notes |
|---|---|---|---|---|
| SSIM (hand-rolled) | ✅ | ✅ matches skimage to 1e-9 | ⚠ **n = 3** | |
| Generation duration | ✅ | ✅ | ⚠ **n = 4** | 47–345 s |
| LPIPS | ✅ | ❌ | ❌ **n = 0** | `lpips` **not installed** |
| CLIP score | ✅ | ❌ | ❌ **n = 0** | `open_clip` **not installed** |
| Culture confusion matrix | ✅ | ❌ | ❌ **n = 0** | Needs `PredictedCulture`, all null |
| Human ratings (3 dims) | ✅ | ✅ | ⚠ **n = 2** | |
| Coverage denominators | ✅ | ✅ | ✅ | Reports the emptiness honestly |
| One shared SQL filter | ✅ | ✅ | ✅ | `db._history_filters` |
| **LoRA-vs-baseline ablation** | ✅ | ❌ | ❌ **no corpus** | `eval/results.csv` **does not exist**; **panel removed from the page** |
| FID / IS / KID | ❌ | ❌ | ❌ | Not implemented |
| User study | ❌ **Instruments only** | ❌ | ❌ | `docs/user-study-survey.md` drafted, not run |

### Product / platform

| Feature | Implemented | Verified | Notes |
|---|---|---|---|
| Auth (PBKDF2 + HMAC session) | ✅ | ✅ | First account becomes Admin |
| History, publish, delete | ✅ | ✅ | |
| Ratings | ✅ | ✅ | `UNIQUE(HistoryId)` |
| Basic/Pro + weekly quota | ✅ | ✅ | Tests |
| Admin approval queue | ✅ | ✅ | Partial unique index |
| Decision emails | ✅ | ✅ | Unconfigured = log |
| Colour Control | ✅ | ✅ | Tests. Floor correctly "not detected" in LIGHT |
| Furniture Placement (2D) | ✅ | ✅ | |
| Style Intensity Slider | ✅ | ✅ | The LoRA ablation made interactive |
| Room Report | ✅ | ⚠ | **Footer over-claims the pipeline** — deliberately not auto-wired |
| Audit trail | ✅ | ✅ | ⚠ **Open unless the token env var is set** |
| Defense Mode `?demo=1` | ✅ | ✅ | 6 rooms, zero backend |
| Bilingual EN/AR + RTL | ✅ | ✅ | |
| CI (pytest + build) | ✅ | ✅ | |
| **`npm run lint`** | ❌ **BROKEN** | — | Next 16 removed `next lint`; needs flat config. **Never in CI** |
| **Frontend tests** | ❌ **None exist** | — | `npm run build` is the only gate |
| Concurrent generation | ❌ | — | `_GEN_LOCK` serialises; jobs are in-memory |

---

## 2. Dead code — present in the source, not in the product

| Item | Location | Status |
|---|---|---|
| `type ResultTab`, `TOOL_TABS`, `resultTab` | `studio/page.tsx:61,65,153` | **`resultTab` is set 3× and never read.** `TOOL_TABS` never referenced. The documented six-tab IA does not render — only three `NARRATIVE_TABS` do |
| `uploadImage`, `startTransform`, `pollStatus` | `src/lib/api.ts` | Exported; serve the **retired** async flow |
| `/upload`, `/transform`, `/status`, `/result`, `/retry` | `backend/main.py` | Mounted and functional, but **superseded by `/redesign`** |
| `MAX_UPLOAD_MB = 8` | `guardrails.py` | Effectively dead — every call site passes `max_mb=10` |
| `import shutil` | `main.py` | Unused (`_ = shutil` to satisfy linters) |

---

## 3. ⚠ Where the project's own documentation is STALE

**This section exists so Gemini does not reproduce an error from the repo's own docs.**

| Document | Claim | Reality |
|---|---|---|
| `ARCHITECTURE.md` | Its whole mermaid diagram: `upload-zone.tsx`, `style-selector.tsx`, `/transform`, `/result`, the polling flow | **All retired or deleted.** Only its "Key design decisions" list is still broadly true |
| `CLAUDE.md` | *"Lebanese is trained; Khaleeji/Moroccan are prompt-only-acceptable"* | ❌ **All three LoRAs exist on disk**, 93,076,472 B each |
| `CLAUDE.md` | *"`MAX_RESULTS = 6` in `backend/furniture.py`"* | ❌ It is **9** |
| `CLAUDE.md` | *"six result tabs (Result · Design Story · Culture DNA · Inside DAR · Understand · Edit)"* | ❌ **Dead code.** Three narrative tabs render; everything else is one column |
| `CLAUDE.md` | Mentions `verified: false` **only for Persian** | ❌ **Lebanese is also entirely `verified: false`** |
| `CLAUDE.md` | *"`claude-sonnet-5` (the default; `DARDESIGN_LLM_MODEL` overrides)"* | ⚠ Incomplete — there is a **full second Gemini provider**, and Gemini is what is **live** |
| `CLAUDE.md` | *"Six gates"* for the planner | ⚠ `design_planner.py`'s own docstring says **five**; the sixth (openings) is real but lives in `planner.ts`. Both counts are defensible — this pack uses six |
| `README.md` | *"src/ Next.js 14 app"* | ❌ **Next.js 16.3** |
| `README.md` | *"ontology/ ~25 terms × 3 cultures"* | ⚠ **30 terms × 3 + 23 Persian = 113** |
| `README.md` | *"Eval figures are one T4 run away"* | ✅ **Still accurate** |
| `kaggle/TRAIN_NOW.md` §3 | Says the step1000 checkpoint was picked | ❌ **step1500 is deployed** (verified by hash) — `_save_checkpoint` copies every checkpoint over the canonical filename |

---

## 4. ⚠ The repository changed DURING this audit

**Inspection began at `60dc112`. Four commits landed while the pack was being written:**

| Commit | What it added |
|---|---|
| `d80f03a` | `fix(design): stop the scene leaking state into its own conditioning` |
| `a4cec54` | `feat(design): commit the CC0 asset set Build Mode will render with` — 1 GLB model, 14 PBR texture sets (42 files), `public/ASSET-LICENSES.md`, `scripts/fetch_design_assets.py` |
| `ab8d9b4` | `feat(design): load real 3D assets, fitted to the box the validator collides with` — `src/lib/design/modelLoader.ts`, `ontology/furniture_models.json`, `catalog.ts::modelTier`, +102 lines of tests |
| `2380fa8` | `feat(design): give every surface a real material instead of a flat colour` — `textures.ts`, `patterns.ts`, PBR wiring in `geometry.ts`/`materials.ts`/`scene3d.ts` |

> **An earlier draft of this pack stated DAR contained zero 3D models. That was true at
> `60dc112` and is now false.** Every affected document has been corrected. **The pack
> describes `2380fa8`.**
>
> **Still 1 real model of 27** — `2380fa8` added materials and ornament, not new models.
>
> Test suite re-run after the change: **583 passed, 1 skipped** (was 579).

### Uncommitted working-tree changes at the time of this audit

Branch `feat/frontend-visual-overhaul` @ **`2380fa8`** ended the audit with `scene3d.ts`
modified and `src/lib/design/lighting.ts` untracked — Build Mode lighting work still in
progress. The asset and texture work listed below is now **committed**:

| File | Change |
|---|---|
| `src/lib/design/scene3d.ts` | sRGB LUT for the beauty pass · force walls opaque for capture · restore clear colour · `geoSig`/`xformSig` split · dispose Lines/Points and texture maps · `isMesh\|\|isLine\|\|isPoints\|\|isSprite` unclassified test · call `protectSharedMaterials` |
| `src/components/design/DesignCanvas.tsx` | Remove `scene` from the `buildShell` dependency array (it rebuilt the whole shell once per `pointermove`) |
| `src/lib/design/catalog.ts` | Add the 4 missing keys to `CATEGORY_ORDER` (`indexOf` returned −1, sorting them **before** the sofa) |
| `src/lib/design/materials.ts` | PBR map hooks on the shared materials |
| `src/lib/design/textures.ts` *(untracked)* | Loads the CC0 PBR sets; **greyscale colour maps multiply the ontology palette rather than replacing it**; roughness re-centred near 1.0 |
| `src/lib/design/patterns.ts` *(untracked)* | **Procedural zellige and cultural ornament — drawn, not downloaded**, so the cobalt is the ontology's own cobalt and no licence attaches |
| `tsconfig.json` | Add `.next-build/types` to `include` |

> **These are real improvements, present in the working tree, not yet committed.**
> They are described in [09](09_BUILD_MODE_THREEJS.md) §4 and [11](11_RENDER_WITH_DAR.md) §4
> as implemented, which is accurate for the code as it stands — but a reviewer checking out
> the commit would not see them.
>
> **Nothing was committed, pushed or merged in producing this pack.**

---

## 5. Quick rule for diagramming

| If a feature is… | Then in a diagram it… |
|---|---|
| ✅ Implemented **and** ✅ Verified | Draw normally |
| ✅ Implemented, ⚠ not verified | Draw normally; do **not** attach a claim about how well it works |
| ⚠ Partial | Draw with an explicit qualifier label |
| ❌ Not implemented | **Omit**, or draw dashed at 40 % opacity inside a box labelled **NOT IMPLEMENTED** |
| Has no measured data | **Never attach a number** |
