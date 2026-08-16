# 20 — Defense Facts and Limitations

> **This is the honesty document. Nothing here is softened.**
> If a claim is not in section 1 or 2, do not make it at the defense.

---

## 1. CONFIRMED IMPLEMENTED FEATURES

*Present in the code, exercised by tests or by a live run.*

| # | Feature | Evidence |
|---|---|---|
| 1 | **Single-shot 3-culture redesign** — `POST /redesign` returns original + Lebanese + Khaleeji + Moroccan from one depth+seg pass | `backend/main.py`, `transform.py`; `tests/test_api.py` |
| 2 | **SDXL + dual ControlNet pipeline** (depth 0.7 + ADE20K seg 0.5), 30 steps, guidance 7.0, 1024² | `backend/transform.py`, `configs/pipeline.yaml` |
| 3 | **Three trained per-culture LoRAs on disk**, 93,076,472 B each | `models/loras/{lebanese,khaleeji,moroccan}/` |
| 4 | **OOM → SD 1.5 + ControlNet 1.1 @ 768² fallback** | `transform.transform_room`, `_OutOfMemory` |
| 5 | **Room understanding** — Depth Anything V2 + OneFormer ADE20K → masks, free floor, scale estimate, top-down `object_map`, image-space `seg_regions`, depth PNG | `room_analysis.py`, `projection.py`; `tests/test_room_analysis.py`, `test_seg_regions.py` |
| 6 | **Curated bilingual cultural ontology** — 113 terms, 4 cultures × 7 categories, weighted + seeded sampling | `ontology/ontology.json`, `prompt_builder.py`; `tests/test_prompt_builder.py` |
| 7 | **27-item furniture catalogue** with real cm, footprints, placement rules; 27 matching PNGs | `ontology/furniture.json`, `public/furniture/`; `tests/test_furniture_catalogue.py` |
| 8 | **Metric 3D Build Mode** — room derived from the photo, locked found massing, 12 procedural builders, undo/redo, persistence | `src/lib/design/*`, `src/app/design/page.tsx` |
| 8b | **Three-tier asset honesty** — 1 real CC0 scan + 26 procedural + fallback massing, labelled in the UI; 14 CC0 PBR texture sets whose greyscale colour maps preserve the ontology palette | `ontology/furniture_models.json`, `src/lib/design/modelLoader.ts`, `public/ASSET-LICENSES.md` |
| 9 | **Deterministic spatial validation** — oriented-rect SAT, two-tier blocking/advisory verdict, snapping, `findSpot` | `src/lib/design/placement.ts` |
| 10 | **Dual-provider LLM design planner** with six anti-hallucination gates and a rule-based fallback | `backend/design_planner.py`, `src/lib/design/planner.ts`; `tests/test_design_planner.py` (25 tests) |
| 11 | **Render with DAR** — scene depth + seg substituted as ControlNet conditioning via `control_override` | `scene3d.renderConditioning`, `transform.render_scene` |
| 12 | **Colour Control** — masked HSV wall/floor recolour with undo/reset | `recolor.py`, `recolor_api.py`; `tests/test_recolor*.py` |
| 13 | **Furniture placement into a finished render** — recommend → candidates → validate-on-drag → composite | `furniture.py`, `placement.py`, `compositing.py` |
| 14 | **Style Intensity Slider** (`/restyle`) — the LoRA-scale ablation made interactive, incl. Persian | `main.py`, `StyleIntensitySlider.tsx`; `tests/test_restyle.py`, `test_persian.py` |
| 15 | **Accounts, sessions, weekly quota, Basic/Pro, admin approval queue, decision emails** | `auth.py`, `subscriptions.py`, `db.py`, `mailer.py`; `tests/test_subscriptions.py`, `test_email.py` |
| 16 | **Evaluation system** — SSIM (hand-rolled), LPIPS, CLIP, confusion matrix, coverage, one shared SQL filter | `quality.py`, `evaluation.py`, `db.py`; `tests/test_evaluation*.py` |
| 17 | **Explainability layer with truth gates** — Understood Room, Design Story, Culture DNA, Inside DAR, Room Report, conditioning evidence strip | `src/components/story/adapters.ts` and others |
| 18 | **Bilingual EN/AR with full RTL** throughout | `ThemeLanguageContext.tsx` |
| 19 | **Audit trail** — append-only JSONL, metadata only, never raises | `audit.py` |
| 20 | **Guardrails** — injection filtering, magic-byte upload validation, server-side parameter clamping | `guardrails.py`; `tests/test_kit.py`, `test_validators.py` |
| 21 | **Defense Mode** (`?demo=1`) — 6 pre-rendered rooms, zero backend | `studio/page.tsx`, `scripts/make_demo_pack.py` |
| 22 | **`DARDESIGN_LIGHT` placeholder mode** — the full API surface without a GPU | `transform._emit_placeholder` |
| 23 | **CI** — pytest under LIGHT + `npm run build` | `.github/workflows/ci.yml` |

---

## 2. CONFIRMED VERIFIED BEHAVIOUR

*Actually observed, with the observation recorded.*

| Claim | How verified | Result |
|---|---|---|
| The backend test suite passes | `pytest tests -q`, `DARDESIGN_LIGHT=1`, run during this audit | **583 passed, 1 skipped** |
| The backend runs | `GET /healthz` | `{ok: true, version: "0.3.0", light_mode: true, queue_depth: 0}` |
| The planner is configured | `GET /api/design/planner-status` | `{configured: true, provider: "gemini", model: "gemini-3.5-flash"}` |
| `control_override` reaches the pipeline | Instrumented run | Depth + seg arrive at full size; `use_lora=True`; **`_prepare_conditioning` called 0 times** |
| Segmentation capture is palette-correct | Pixel comparison against the backend palette | **Pixel-exact.** Ceiling `120,120,80`, wall `120,120,120` |
| **Render with DAR works on a real GPU** | 2026-08-13, live host (`light_mode: false`), 13-object scene (10 found + 3 Khaleeji) | **Genuine render in 35.61 s** |
| The interior capture camera fixes the doll's-house problem | A/B on the *identical* 13-object scene restored from `localStorage` | First render read as a wooden-screen storage room; after the camera rebuild, **a believable room** |
| The cushion filter works | Measured class shares in the conditioning | Found floor coverage **69.6 % → 35.8 %**; seg `table` share **23.7 % → 3.3 %** |
| Maquette framing was wasting the frame | Measured empty-pixel fraction | **~42 % → ~16 %** |
| An AI plan is one undo | Manual test | 4 objects + 2 material changes → **0 in one Ctrl+Z** |
| The rule-based fallback is real | Encountered a live `400 credit balance too low` | **The user still got a furnished room** |
| Room-scale estimates can be badly wrong | Two real measurements in one session | **130 m²** and **3.6 m²** — both now rejected by the 9–90 m² plausibility band |

---

## 3. ⚠ PARTIALLY IMPLEMENTED

| Feature | What exists | What does not |
|---|---|---|
| **Evaluation results** | The whole metric + aggregation system | **SSIM on 3 designs, duration on 4, ratings n=2. LPIPS/CLIP/confusion matrix = 0 data points.** `lpips` and `open_clip` are **not installed** |
| **LoRA-vs-baseline ablation** | `automatic_metrics()` + arm splitting + delta computation | **`eval/results.csv` does not exist**; `evaluation_results` = 0 rows; `outputs/` empty. **The panel is removed from the page** rather than shown empty |
| **Cultural verification** | Khaleeji + Moroccan fully `verified: true` | **Lebanese (the hero culture) and Persian are `verified: false`** — and `strict=True` is passed by **no production caller**, so unverified terms reach the prompt |
| **Persian** | Ontology terms, trigger, `/restyle`, intensity slider | **No LoRA, no catalogue items, not in `/redesign`, not in Build Mode, not in the planner** |
| **Studio results IA** | Three narrative tabs render | The six-tab `ResultTab` / `TOOL_TABS` in the source is **dead code** — never read |
| **Room Report provenance** | The report renders | Its footer **hardcodes** "SDXL + dual ControlNet + cultural LoRA", untrue for Persian / LIGHT / depth-only. **Deliberately not auto-wired** into DesignStory |
| **Per-culture ControlNet tuning** | The sweep script + `sweep_winners.json` mechanism | All four entries are **`[0.7, 0.5]`** — the sweep did not differentiate the cultures |
| **`npm run lint`** | An eslintrc config exists | **Broken** — Next 16 removed `next lint`; needs a flat `eslint.config.mjs`. Never in CI |
| **Circulation checking** | 60 cm walkway instruction in the LLM prompt; door keep-clear zones | **No global path-finding or circulation-graph check.** A layout with no walkable route between clusters would pass |
| **Conditioning fixes re-verification** | Cushion filter + camera walk-in verified **in the conditioning** | **Not re-rendered on a GPU** — the tunnel expired. **Re-run one Render with DAR when a GPU host is next up** |

---

## 4. PLANNED / NOT IMPLEMENTED

| Feature | Status |
|---|---|
| **RAG / retrieval / vector store / embeddings** | ❌ **NOT IMPLEMENTED.** `filter_chunk`'s docstring names "RAG chunks", but nothing is retrieved. → [07](07_RAG_ARCHITECTURE.md) |
| **Real 3D models beyond the first** | ⚠ **1 of 27 implemented.** `leb-ottoman-001` loads a CC0 scan; the other 26 are procedural. ~20 candidates were inspected and 19 rejected as culturally wrong |
| **`floor_flat` / `wall_mounted` / `on_surface` placement types** | ❌ Declared in `furniture.json`, **DEFERRED**. All 27 shipped items are `floor_standing` |
| The 7 deferred catalogue items (rugs, cushions, wall art, mirrors) | ❌ Metadata only, no assets |
| Time-of-day / sun simulation **in Build Mode** | ❌ Exists only in `/v2` `UnderstoodRoom`, a different feature |
| FID / IS / KID | ❌ Not implemented |
| Segmentation mIoU / depth accuracy evaluation | ❌ Not implemented |
| Layout-preservation metric | ❌ Not implemented |
| User study | ❌ Instruments drafted (`docs/user-study-survey.md`); **not run** |
| Multi-user / concurrent generation | ❌ `_GEN_LOCK` serialises everything; `jobs.py` is single-process in-memory |

---

## 5. 🚫 UNVERIFIED CLAIMS — DO NOT SAY THESE AT THE DEFENSE

| ❌ Never say | ✅ Say instead |
|---|---|
| "DAR uses RAG for cultural grounding" | "Cultural grounding is a curated ontology indexed by culture key, plus a closed catalogue enforced as a JSON-Schema enum" |
| "Build Mode uses real 3D furniture models" | "Build Mode uses procedural geometry at real ontology dimensions — deliberately a maquette, so DAR never implies it rendered something it did not" |
| "DAR measures your room" | "DAR estimates the floor **area** and assumes the proportions. Height is always 300 cm, the aspect ratio always 1.25" |
| "Our LoRA outperforms the baseline by X" | "The ablation is implemented and exposed interactively through the intensity slider, but the corpus has not been generated — I have no numbers" |
| "Users rated DAR N out of 5" | "The rating system is implemented; there are 2 responses. No user study has been run" |
| "Cultural accuracy is validated" | "Khaleeji and Moroccan terms are expert-verified in the ontology; Lebanese and Persian are not yet" |
| "The segmentation is X % accurate" | "OneFormer is used as published. I have not evaluated it on Arab interiors" |
| "Layout is preserved" | "Layout is **conditioned** — it is the control signal. Preservation *quality* is unmeasured" |
| "DAR supports four cultures" | "Three trained cultures. Persian is a prompt-only demonstration that adding a culture costs one ontology entry, not a retraining run" |
| "SSIM of 0.25 shows good preservation" | "SSIM between a photo and a redesign is expected to be low — changing the room is the goal. Without a baseline arm the absolute value carries no claim" |
| "Studio has six result tabs" | "Studio has three narrative tabs; the rest of the results render in one column" |
| "The quota system prevents overuse" | "The quota is enforced at the client boundary. The generation endpoints themselves are unauthenticated, so direct calls to the render backend bypass it" |

---

## 6. KNOWN LIMITATIONS — stated in full

### 6.1 Single-photograph scale estimation
- A single photo has **no metric scale**. DAR calibrates against **assumed** furniture
  widths (door 85 cm, sofa 200 cm, armchair 90 cm, chair 48 cm, bed 150 cm, coffee table
  110 cm) and takes the median.
- **When the calibration is off, it is off by a lot in both directions** — 130 m² and
  3.6 m² were both produced in one session.
- The 9–90 m² plausibility band exists to catch this. Outside it, DAR falls back to a
  default room **and says so** via `shellSource`.
- **Room height is always 300 cm.** **Aspect ratio is always 1.25.** Only *area* is derived.
- `shellSource: "measured"` means "the area estimate had confidence ≥ 0.4" — **not** "DAR
  measured your room".

### 6.2 Fallback geometry
- `buildFound()` renders unknown categories as translucent survey boxes. A test now
  prevents catalogue items reaching it, but the fallback remains.
- Found-object heights are **class priors**, footprints are **capped** per class, and
  merged blobs are a real failure mode (the 520 cm cushion).
- Door 210 cm / window 140 cm are **constant priors**, never measured.

### 6.3 Model asset coverage
- **1 of 27 catalogue pieces is a real scanned model.** ~20 CC0 candidates were inspected
  against DAR's catalogue art and **19 were rejected as culturally wrong** — there is no CC0
  library of Lebanese, Khaleeji or Moroccan furniture.
- **The one scan is not DAR's catalogue piece.** The inspector names the asset, because
  DAR's art shows turned wooden legs where the scan has block feet.
- The visual fidelity of a procedural sofa is below a modelled one. **This is a stated
  aesthetic and ethical choice, not an oversight.**
- **1 real 3D model of 27 pieces** (`leb-ottoman-001`, CC0 Poly Haven). The 27 cut-out PNGs
  are used only in the catalogue rail and 2D compositing.
- **The one scan is not the catalogue piece.** DAR's own art shows turned wooden legs where
  the scan has block feet — the inspector names the asset for exactly this reason.
- 12 procedural builders cover all 12 catalogue categories — but the visual fidelity of a
  procedural sofa is far below a modelled one. **This is a stated aesthetic choice.**

### 6.4 Cultural verification
- **Lebanese — the hero culture, most training images, shown first — is entirely
  `verified: false`.** So is Persian.
- The `strict` mechanism to exclude unverified terms exists and **is not switched on**.
- Verification depends on a cultural collaborator's sign-off, which is pending.

### 6.5 Training data volume
- **19 / 14 / 12 images** per culture. That is very small for a LoRA, even at rank 16.
- The evaluation corpus **must not** reuse these images — `eval/CORPUS.md` says so
  explicitly, *"an examiner will ask"*.

### 6.6 GPU / infrastructure
- Real generation requires a **free Kaggle T4**, selected in the UI (the Kaggle *API*
  grants a P100 that cannot run SDXL fp16).
- The tunnel URL **rotates every session**; without it the app runs in LIGHT placeholder
  mode.
- `_GEN_LOCK` serialises everything → **no concurrent generation**.
- `jobs.py` is **in-memory and single-process** → a restart loses all job state.
- Generation is **47 s – 345 s** in observed history rows.

### 6.7 Security
- **All generation endpoints are unauthenticated.** Quota is enforced only by the client
  calling `/api/usage/consume` first. **Direct calls to the render backend bypass the
  allowance.**
- **`/audit` is open unless `DARDESIGN_AUDIT_TOKEN` is set.**
- Without `DARDESIGN_SECRET`, sessions die on every restart.
- Share tokens do not survive a restart without `DARDESIGN_SHARE_SECRET`.

### 6.8 Data scale
3 users · 4 saved designs · 2 ratings · 0 evaluation-corpus rows.
**Every statistic on the dashboard is over a handful of rows or is empty.**

### 6.9 Known latent defect
`_generate`'s `_hf_hook` offload-recovery retry **does not forward `control_override`**.
A Build Mode render hitting that path would silently fall back to photo-derived
conditioning. **No test covers it.**

### 6.10 Documentation drift
`ARCHITECTURE.md` is **stale** (describes the retired flow and a deleted component).
`CLAUDE.md` is stale on: the LoRA count, `MAX_RESULTS`, the six-tab IA, and the scope of
`verified: false`. → [25](25_IMPLEMENTED_VS_PLANNED.md) §3.

---

## 7. The strongest honest claims — what to lead with

1. **"Layout stops being something the model infers from a sentence and becomes something
   it is conditioned on."** — Build Mode renders the *exact two control images* the
   pipeline already consumed. `_generate` gained **one optional parameter**; with it
   `None`, `/redesign` is byte-for-byte unchanged. **No model, notebook or training change
   was needed.**

2. **"An invented catalogue id is unrepresentable, not merely unlikely."** — structured
   outputs with a JSON-Schema `enum`, enforced on **both** providers, backed by three more
   deterministic gates.

3. **"The same collision engine judges a human's drag and an AI's plan."** —
   `evaluatePlacement` colours the ghost, explains the verdict, refuses the drop, and gates
   the plan. One rule, four surfaces.

4. **"The camera was the root cause, and we found it by measuring pixels."** — the
   doll's-house diagnosis, the interior-camera rebuild, and an A/B on the identical scene.

5. **"Unconfigured is a working mode."** — no LLM key → rule-based plans; no SMTP → log the
   message; no GPU → LIGHT mode with honest labelling. **CI runs the degraded paths, so
   they are never dark.**

6. **"The dashboard cannot show a number it does not have."** — `null` renders as an
   em-dash; on a 1–5 scale a zero is unreachable, so printing one would fabricate a result.

7. **"Deleting a design removes it from every statistic in the same instant."** — scores
   are columns on the history row, not a side table.

---

Related: [16_EVALUATION.md](16_EVALUATION.md) ·
[25_IMPLEMENTED_VS_PLANNED.md](25_IMPLEMENTED_VS_PLANNED.md) ·
[27_DEFENSE_QA_FACTS.md](27_DEFENSE_QA_FACTS.md)
