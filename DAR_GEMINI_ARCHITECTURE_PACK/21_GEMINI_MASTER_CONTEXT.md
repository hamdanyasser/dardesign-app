# 21 — GEMINI MASTER CONTEXT

**★ This is the single strongest document in the pack. If you read one file, read this one.**

Every component is tagged so you can group them visually:

`[AI/ML]` · `[GENERATIVE AI]` · `[DETERMINISTIC]` · `[3D]` · `[CULTURAL KNOWLEDGE]` ·
`[USER CONTROL]` · `[BACKEND/DATA]` · `[FRONTEND]`

---

## ⭐ THE MASTER FLOW — the approved wording

> # Gemini thinks → DAR validates → the user edits → ControlNet + SDXL renders.

**The four-role version:**

> ### LLM = Designer · DAR = Spatial Truth · Build Mode = User Control · ControlNet + SDXL = Renderer

**Both are verified accurate against the current implementation**, with three precisions
that must accompany them:

1. **"Gemini"** is correct *as currently configured* (`gemini-3.5-flash`, confirmed live).
   The planner is **provider-agnostic** — Anthropic (`claude-sonnet-5`) is the code's
   default preference and is fully implemented. Prefer *"LLM Designer (Gemini 3.5 Flash)"*
   in labels.
2. **"DAR validates"** is not a filter after the fact — the *same* collision engine judges
   a human's drag and the LLM's plan.
3. **"the user edits"** sits between validation and rendering **and can also be skipped** —
   Studio's `/redesign` path (Flow A) never enters Build Mode at all.

---

## 1. Mission

DAR Design is a bilingual (EN/AR) AI interior-design platform for **Arab domestic
interiors** — Lebanese, Khaleeji and Moroccan. It exists because generic generative
redesign tools flatten culture into pastiche, produce pictures rather than plans, and give
the user no way to change one thing without re-rolling everything.

DAR's answer is to **separate taste from truth**: cultural knowledge is curated and
auditable, spatial decisions are deterministic and centimetre-accurate, and the generator
is *conditioned* on a scene the user can edit rather than asked to imagine one from a
sentence.

---

## 2. User journeys

| # | Journey | Route | Skippable? |
|---|---|---|---|
| **A** | Photo → three cultural redesigns + a structured understanding of the room | `/studio` | The core loop |
| **B** | Natural-language brief → LLM plan → validated furniture in an editable 3D room | `/design` | Optional |
| **C** | Edit the 3D scene → Render with DAR → photoreal image with the user's own layout | `/design` | Optional |
| **D** | Culture switching — 3 mechanisms (multi-generation, intensity slider, Build Mode culture) | `/studio`, `/design` | — |
| **E** | Save → rate → publish → report → evaluation dashboard | `/history`, `/others`, `/evaluation` | — |

Full traces with file references → [17_FULL_DATA_FLOW.md](17_FULL_DATA_FLOW.md).

---

## 3. Architecture — the whole system on one page

```
┌─ [FRONTEND] Next.js 16 · React 19 · TS 5 · Tailwind · three.js 0.150 ────────┐
│  /studio  /design  /history  /others  /subscription  /evaluation  /admin/*   │
│  ThemeLanguage → Auth → Image providers · EN/AR with full RTL                │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  src/lib/api.ts routes each call DELIBERATELY
            ┌──────────────┴───────────────┐
            ▼                              ▼
┌─ [BACKEND/DATA] RENDER HOST ──┐  ┌─ [BACKEND/DATA] DATA HOST ────────────┐
│ Kaggle T4, rotating tunnel     │  │ the developer's own machine            │
│ ephemeral · NO users table     │  │ SQLite + images/ · holds the LLM key   │
│ sent NO session cookie         │  │                                        │
│ /redesign  /restyle            │  │ auth · history · feedback              │
│ /render-scene                  │  │ subscription · usage · admin           │
│ /api/furniture/*  /api/color/* │  │ /api/design/plan  (the ONLY authed     │
│                                │  │                    generation-adjacent │
│ ONE FastAPI codebase, TWO ROLES│  │                    endpoint)           │
└────────────────────────────────┘  └────────────────────────────────────────┘
```

### The spine, stage by stage

```
[USER CONTROL]        room photograph
        │
[AI/ML]               Depth Anything V2 Small  ─┐
                      OneFormer ADE20K Swin-L  ─┤ one pass, three products
        │                                       │
[DETERMINISTIC]       analyze_room() ───────────┘
                        masks · free floor · scale estimate (ASSUMED ref widths)
                        object_map (top-down) · seg_regions (image-space)
        │
[CULTURAL KNOWLEDGE]  ontology.json ─▶ prompt_builder ─▶ EN/AR prompts + trigger
                      furniture.json ─▶ 27-item catalogue with real centimetres
        │
[AI/ML]               LLM DESIGN PLANNER   Gemini 3.5 Flash (live)
                                           | Claude Sonnet 5 (code default)
                                           | rule-based fallback (no key)
                        reads the brief  → `understood` (culture, roomType,
                                            capacity, intensity, materials,
                                            requirements) — every field forced
                                            into a DAR-owned vocabulary
                        proposes         → catalogId + x,z + rotation + material
                                            NO dimensions, NO invented ids
        │
[DETERMINISTIC]       ⭐ DAR SPATIAL VALIDATOR — SIX GATES
                        1 JSON-Schema enum   (an invented id is UNREPRESENTABLE)
                        2 no size fields     (dimensions come from the catalogue)
                        3 validate_items()   (dropped AND reported, with reasons)
                        4 gatePlan() → evaluatePlacement()  ← THE SAME SAT ENGINE
                                                              A HUMAN DRAG USES
                        5 culture coherence  (one room, one culture)
                        6 blockedOpening()   (door 90 cm / window 40 cm)
                        blocking = physics · advisory = judgement, never refused
        │
[3D] + [USER CONTROL] BUILD MODE — metric three.js room, centimetres, Y up
                        room DERIVED from the photograph (locked found massing)
                        1 real CC0 scan + 26 procedural builders (3 honesty tiers)
                        22 ontology-sourced materials · 14 CC0 PBR texture sets
                        drag · rotate · add · delete · material · room resize
                        snapshot undo/redo with gesture coalescing
        │
[3D]                  renderConditioning(1024, 768)
                        an INTERIOR camera (eye 155 cm, FOV 54°, walks in clear
                        of furniture, keeps only the user's azimuth)
                        ├─ beauty  (evidence, sRGB-encoded)
                        ├─ depth   (NoToneMapping + Linear — conditioning is DATA)
                        └─ seg     (exact ADE20K palette, pixel-verified)
        │
[GENERATIVE AI]       SDXL base 1.0, fp16
                        + ControlNet depth  (diffusers/controlnet-depth-sdxl-1.0)  w 0.7
                        + ControlNet seg    (SargeZT/sdxl-controlnet-seg)          w 0.5
                        + per-culture LoRA  (rank 16, 1500 steps, free T4)  scale 0.8
                        30 steps · guidance 7.0 · 1024² · seeded
                        OOM → SD 1.5 + ControlNet 1.1 @ 768²
        │
                      FINAL CULTURAL INTERIOR + a manifest recording exactly
                      which model, LoRA, seed and ControlNet weights ran
```

---

## 4. AI / ML components — the complete list

| Component | Model / provider | Role | Tag |
|---|---|---|---|
| Depth estimation | `depth-anything/Depth-Anything-V2-Small-hf` (fallback `lllyasviel/Annotators` MidasDetector) | Per-pixel relative depth | `[AI/ML]` |
| Semantic segmentation | `shi-labs/oneformer_ade20k_swin_large` | 150-class ADE20K labels | `[AI/ML]` |
| Design planning | `gemini-3.5-flash` **(live)** / `claude-sonnet-5` (default) | Reads the brief, proposes a layout | `[AI/ML]` |
| Image generation | `stabilityai/stable-diffusion-xl-base-1.0` | The render | `[GENERATIVE AI]` |
| Structural control | `diffusers/controlnet-depth-sdxl-1.0` + `SargeZT/sdxl-controlnet-seg` | Bind geometry + identity | `[GENERATIVE AI]` |
| Cultural adaptation | 3 in-house LoRAs, rank 16 | Cultural idiom | `[GENERATIVE AI]` |
| OOM fallback | `runwayml/stable-diffusion-v1-5` + ControlNet 1.1 | Survive 15 GB | `[GENERATIVE AI]` |
| Perceptual metric | `lpips` AlexNet | Evaluation only | `[AI/ML]` ⚠ not installed |
| Culture recognition | `open_clip` ViT-B-32 `laion2b_s34b_b79k` | Zero-shot 3-way, evaluation only | `[AI/ML]` ⚠ not installed |

> ### ❌ THERE IS NO RAG, NO VECTOR STORE, NO EMBEDDING INDEX, NO RETRIEVER.
> → [07_RAG_ARCHITECTURE.md](07_RAG_ARCHITECTURE.md)

---

## 5. Deterministic components — the complete list

| Component | File | Owns |
|---|---|---|
| **Oriented-rect SAT collision** | `src/lib/design/placement.ts` | `evaluatePlacement`, two-tier verdict, `snapPosition`, `findSpot` |
| **Client plan gate** | `src/lib/design/planner.ts` | `gatePlan`, `openingZone`, `blockedOpening` |
| **Backend plan validation** | `backend/design_planner.py` | `validate_items`, `validate_understood`, `seats_of`, `fallback_plan` |
| **Room derivation** | `src/lib/design/roomModel.ts` | `deriveRoom`, plausibility band, found-massing filters |
| **Room analysis** | `backend/room_analysis.py` | Masks, scale estimate, candidate spots |
| **Projection** | `backend/projection.py` | `project_top_down`, `seg_bounding_boxes` |
| **Prompt construction** | `backend/prompt_builder.py` | Seeded weighted sampling from the ontology |
| **Image-space placement** | `backend/placement.py` | Mask-overlap validation + scoring |
| **Compositing** | `backend/compositing.py` | Tone-matched alpha composite + contact shadow |
| **Recolour** | `backend/recolor.py` | Masked HSV, value channel preserved |
| **SSIM** | `backend/quality.py` | Hand-rolled, matches skimage to 1e-9 |
| **Quota** | `backend/db.py` | One lock, one transaction |
| **Undo/redo** | `src/lib/design/store.ts` | Snapshots + gesture coalescing |
| **Guardrails** | `backend/guardrails.py` | Injection filter, magic bytes, parameter clamps |
| **Truth gate** | `src/components/story/adapters.ts` | Refuses to present unmeasured data |

---

## 6. Cultural knowledge system

```
ontology/ontology.json  (v0.1.0, 113 terms)
  trigger[culture]                     → the LoRA trigger phrase, EN + AR
  cultures[culture][7 categories]      → architectural · materials · color_palette
                                          lighting · furniture · textiles · ornamentation
  each term: {en, ar, weight, VERIFIED}
        │
        ├─▶ prompt_builder    seeded weighted sample, 2 per category
        ├─▶ materials.ts      22 material hex values (3D)
        ├─▶ cultureData.ts    the Culture DNA panel
        └─▶ src/data/ontology.json  ⚠ A SECOND COPY (highlighter + report)

ontology/furniture.json (v0.2.0, 27 items, 9 per culture, 12 categories)
        ├─▶ backend/furniture.py     ranking + catalogue API
        ├─▶ catalogue_projection()   ⇒ THE LLM'S JSON-SCHEMA ENUM
        └─▶ src/lib/design/catalog.ts ⇒ the rail + geometry dimensions + modelTier()

ontology/furniture_models.json (sidecar) ─▶ modelLoader.ts ⇒ REAL / PROCEDURAL / MASSING
```

### ⚠ Verification status — state this honestly

| Culture | Terms | Verified | LoRA | Catalogue | In `/redesign` |
|---|---|---|---|---|---|
| Lebanese | 30 | ❌ **0/30** | ✅ | 9 | ✅ |
| Khaleeji | 30 | ✅ 30/30 | ✅ | 9 | ✅ |
| Moroccan | 30 | ✅ 30/30 | ✅ | 9 | ✅ |
| Persian | 23 | ❌ 0/23 | ❌ **none** | ❌ **0** | ❌ **no** |

**Persian is prompt-only** — a demonstration that adding a culture costs one ontology
entry, not a retraining run. **Do not diagram it as a fourth supported culture.**

---

## 7. The 3D system

| Property | Value |
|---|---|
| Library | **three.js 0.150 used directly** — no react-three-fiber, no drei |
| Units | **centimetres**, 1 THREE unit = 1 cm, Y up, floor centred on origin |
| Scene object | **Plain serializable JSON** — no class instances, no `THREE.*` |
| Geometry | **3 tiers: 1 REAL MODEL (CC0 scan) · 26 ENHANCED PROCEDURAL · FALLBACK MASSING** for photographed objects |
| Model fit | Uniform `contain` — **the visual may never outgrow the collision box** |
| Textures | 14 CC0 PBR sets; **greyscale colour maps** so the ontology palette survives |
| Materials | 22 keys, every hex from `ontology.json`'s colour palettes |
| Found objects | Translucent locked massing from `object_map`, prior heights, capped footprints |
| Editor camera | Orbit rig outside the room, FOV 38° |
| **Capture camera** | **Built fresh — inside the room, eye 155 cm, FOV 54°, walks clear of furniture, keeps only azimuth** |
| Persistence | `localStorage["dar-scene-v3:<jobId>"]`, debounced 600 ms |
| Undo | Snapshots, gesture coalescing, limit 60 |

---

## 8. User control — where the human intervenes

| Stage | Control |
|---|---|
| Input | Choose the photo; choose one culture or all three |
| After generation | Colour Control (wall/floor HSV) · Furniture Placement (2D composite) · Style Intensity (LoRA scale 0–1) |
| Build Mode | Move · rotate · add · delete · duplicate · material · lock · resize the room · toggle found layer |
| Planning | Write the brief; **the plan is a proposal — one Ctrl+Z removes all of it** |
| Rendering | Choose the viewpoint (azimuth), the room type and the cultural intensity |
| Sharing | Save · publish to the gallery · rate · export a report |

> **Nothing the AI does is irreversible, and every AI proposal is shown alongside what was
> refused.**

---

## 9. Infrastructure

| Concern | Reality |
|---|---|
| GPU | **A free Kaggle T4** — selected in the UI (the API grants an unusable P100) |
| Tunnel | Rotates every session; `npm run dev:tunnel <url>` re-points in one command |
| Port | **:3000 only** — `dev:tunnel` hard-fails otherwise, because the CORS allowlist is :3000 |
| Long requests | `_stream_keepalive` every 10 s — free tunnels 524 a slow first byte |
| Concurrency | `_GEN_LOCK` serialises all generation; jobs are in-memory, single-process |
| Database | SQLite + WAL |
| No-GPU mode | `DARDESIGN_LIGHT=1` — a first-class mode, not a mock; the whole test suite runs in it |
| CI | pytest under LIGHT **+** `npm run build` |
| Tests | **583 pass, 1 skipped.** Backend only — there is no frontend test runner |

---

## 10. Explainability

| Surface | Class |
|---|---|
| Understood Room (highlighter · 2D map · DepthOrbit) | **Evidence** |
| Conditioning evidence strip (beauty · depth · seg) | **Evidence** |
| PlanPanel — "DAR understood", accepted **and refused** items | **Evidence** |
| Manifest provenance (model, LoRA, seed, weights) | **Evidence** |
| Design Story · Culture DNA · Inside DAR | **Narrative over gated evidence** |
| Room Report | Evidence + ⚠ an over-claiming hardcoded footer |
| `shellSource` chip · `N found` chip · drag-ghost colour | **Evidence** |

**`adapters.ts` is the truth gate:** returns `null` rather than degrade, never falls back
to demo data, emits unmeasured values as `{value: null, measured: false}` → rendered as an
**em-dash, never a zero**.

---

## 11. Evaluation — capability vs results

| | Implemented | Measured |
|---|---|---|
| SSIM | ✅ hand-rolled, skimage-exact | ⚠ **n = 3** |
| Duration | ✅ | ⚠ n = 4 (47–345 s) |
| LPIPS | ✅ | ❌ **n = 0** (package not installed) |
| CLIP + confusion matrix | ✅ | ❌ **n = 0** |
| Human ratings (3 dims) | ✅ | ⚠ **n = 2** |
| LoRA-vs-baseline ablation | ✅ | ❌ **corpus not generated** |
| mIoU / depth accuracy / layout preservation / FID | ❌ | ❌ |

> **DAR has an implemented evaluation *system*. It does not yet have evaluation *results*.**

---

## 12. Limitations — the short list

1. **No RAG.** Curated ontology instead.
2. **Only 1 of 27 pieces is a real scan.** No CC0 library of Arab furniture exists.
3. **Room height (300 cm) and aspect ratio (1.25) are assumptions.** Only area is estimated.
4. **Lebanese and Persian ontology terms are unverified**, and unverified terms reach the prompt.
5. **Almost no measured results.**
6. **Generation endpoints are unauthenticated** — the quota is bypassable by direct calls.
7. **19 / 14 / 12 training images per culture.**
8. **No concurrency** — one generation at a time, in-memory jobs.
9. **Persian is prompt-only.**
10. **Cushion/camera conditioning fixes are verified in the conditioning only, not re-rendered.**

Full detail → [20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)

---

## 13. The five sentences that carry the project

1. **"DAR separates taste from truth: the LLM proposes, and DAR's own collision engine —
   the same one that judges a human's drag — decides."**
2. **"An invented catalogue id is unrepresentable, not merely unlikely, because it is a
   JSON-Schema enum enforced by the provider."**
3. **"Because DAR already renders the room in 3D, it can produce the exact two control
   images the pipeline already consumed from photographs — so layout stops being inferred
   from a sentence and becomes a control signal."**
4. **"Adding `control_override` cost one optional parameter; with it `None`, `/redesign` is
   byte-for-byte unchanged. No model, notebook or training change was required."**
5. **"Unconfigured is a working mode — no LLM key gives rule-based plans, no SMTP logs the
   message, no GPU gives an honestly-labelled placeholder. CI runs the degraded paths, so
   they are never dark."**
