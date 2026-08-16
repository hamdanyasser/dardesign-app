# 19 — Repository File Map

*Annotated. Meaningful implementation only — `node_modules/`, `.next/`, `.venv/`,
`__pycache__/`, caches and build output are excluded.*

⭐ = a file whose content is reproduced in `RAW_EVIDENCE/`.

---

## 1. Root

| Path | What it owns |
|---|---|
| `CLAUDE.md` | Project instructions for AI assistants. **Partly stale — see [25](25_IMPLEMENTED_VS_PLANNED.md) §3** |
| ⭐ `README.md` | Public overview, status, quick start, env vars |
| `ARCHITECTURE.md` | ⚠ **STALE.** Its mermaid diagram describes the retired `/upload`+`/transform`+`/status` flow and `style-selector.tsx`, which no longer exists |
| `UNDERSTOOD_ROOM_THREEJS_SPEC.md` | The spec behind the `/v2` rebuild |
| ⭐ `package.json` | Frontend deps + scripts. `next ^16.3.0`, `react ^19.2.8`, `three ^0.150.0` |
| `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json` | Build + design-system config |
| `Makefile` | Wraps test/backend/train/sweep/metrics. **Recipes are POSIX** — on Windows use Git Bash |
| `Dockerfile`, `.dockerignore` | The LIGHT image, built on `requirements-light.txt` |
| `.eslintrc.json` | ⚠ eslintrc format; `eslint-config-next` v16 expects flat `eslint.config.mjs`. **`npm run lint` is broken** |
| `push_kernel.py`, `push_verify.py`, `push_backend.py` | Kaggle REST-API pushers (KGAT bearer token — the old CLI cannot read it) |
| `run-dev.bat`, `run-dev.sh` | Convenience launchers |
| **`.env.local`, `.dardesign-llm`, `.dardesign-smtp`, `.dardesign-secret`** | 🔒 **Runtime configuration. Gitignored. NOT read, NOT copied, NO values in this pack** |
| `.env.example`, `.dardesign-llm.example`, `.dardesign-smtp.example` | Templates (safe — placeholders only) |

---

## 2. `backend/` — the FastAPI service

| File | Owns |
|---|---|
| ⭐ `main.py` (~2060) | **The entire HTTP surface** — 42 routes, pydantic models, lifespan, CORS, `_GEN_LOCK`, `_stream_keepalive`, `_require_user`/`_require_admin` |
| ⭐ `transform.py` (~1500) | **The generation pipeline.** SDXL + dual ControlNet, per-culture LoRA hot-swap, OOM→SD1.5 fallback, `DARDESIGN_LIGHT` placeholder, the depth/seg annotators, `_generate(control_override=…)`, `render_scene()`, the 150-class ADE20K palette |
| ⭐ `design_planner.py` (931) | **The LLM planner.** `plan_schema`, `_SYSTEM`, `catalogue_projection`, dual provider (`_call_anthropic` / `_call_gemini` / `gemini_schema`), `validate_items`, `validate_understood`, `seats_of`, `fallback_plan` |
| ⭐ `room_analysis.py` | `analyze_room()` — masks, free floor, `_estimate_scale`, `_find_candidates`, `RoomAnalysis.summary()`, `ADE_TO_CATEGORY` |
| ⭐ `projection.py` | `project_top_down()` → `object_map`; `seg_bounding_boxes()` → `seg_regions`; `ADE20K_FURNITURE` (30 classes) |
| ⭐ `prompt_builder.py` (~210) | `ontology.json` → bilingual prompts; `_weighted_sample`, `room_ar_map`, seeding, the `strict` flag |
| ⭐ `guardrails.py` | `sanitize_prompt_fragment`, `filter_chunk`, `validate_upload` (magic bytes), `clamp_params` |
| `db.py` (~1300) | **All SQLite.** Schema, `_migrate`, `_history_filters`, `consume_generation`, `culture_confusion`, `evaluation_coverage`. **Storage only — every policy number is passed in** |
| `evaluation.py` | `/api/admin/evaluation` aggregation; `automatic_metrics()` reads `eval/results.csv`; `_ablation`, `_summarise` |
| ⭐ `quality.py` | **Hand-rolled SSIM** on numpy+scipy (matches skimage to 1e-9), `lpips_paths`, `clip_cultures`, `metrics_available()` |
| `furniture.py` | Catalogue loading, `recommend()` scoring, `MAX_RESULTS = 9`, `normalize_room_type`, `item_aspect` |
| `placement.py` | **Image-space** placement validation + scoring (a different engine from `placement.ts`) |
| `compositing.py` | Asset compositing with tone matching + contact shadow |
| `recolor.py` / `recolor_api.py` | Masked HSV wall/floor recolour + the `/api/color` router |
| `auth.py` | PBKDF2 200k, HMAC stateless session cookie |
| `subscriptions.py` | `PRO_PRICE_USD`, `BASIC_WEEKLY_LIMIT`, the daily expiry service |
| `mailer.py` | Decision emails; stdlib smtplib; unconfigured = log |
| `jobs.py` | In-memory job registry; `Job.public()` strips filesystem paths |
| `ttl_cleanup.py` | 24 h upload sweeper + `PRIVACY_NOTICE` |
| `audit.py` | Append-only JSONL, metadata only, never raises |
| `share.py` | HMAC share tokens, 7-day TTL |
| `validators.py` / `errors.py` | Upload validation; `ApiError` with bilingual messages |
| ⭐ `requirements.txt` / ⭐ `requirements-light.txt` | Pinned deps |
| 🔒 `dardesign.db`, `*-wal`, `*-shm` | **User data. Excluded from this pack** |
| 🔒 `audit.jsonl`, `uploads/` | Runtime artifacts. Excluded |

---

## 3. `src/` — the Next.js frontend

### `src/app/` — routes
| Path | Owns |
|---|---|
| `layout.tsx` | Fonts, the blocking theme script (**defaults LIGHT**), provider nesting, `AppShell` |
| `page.tsx` | `<DarCinema />` — the landing |
| ⭐ `studio/page.tsx` (1523) | **The product flow.** Upload → consume → `/redesign` → results. ⚠ contains the **dead** `ResultTab`/`TOOL_TABS` |
| ⭐ `design/page.tsx` (609) | **Build Mode.** Bootstrap, reducer, keyboard, `renderIntent` |
| `evaluation/page.tsx` (911) | The evaluation dashboard |
| `admin/analytics/page.tsx` (782) | Users + evaluation + queue combined. *Not in CLAUDE.md* |
| `admin/{users,subscriptions}/page.tsx` | Admin surfaces |
| `history/`, `others/`, `subscription/`, `login/`, `register/`, `audit/` | The A1-styled pages |
| `v2/page.tsx` | `<UnderstoodRoom />` — the three.js rebuild |
| `transform/page.tsx`, `result/page.tsx` | **Redirect stubs** → `/studio` |
| `globals.css` | All `--dd-*` CSS variables, themes, animations, utilities |

### `src/lib/design/` — the Build Mode model (no React, no `THREE.*` in the scene object)
| File | Owns |
|---|---|
| ⭐ `types.ts` (164) | `DesignScene`, `PlacedObject`, `RoomShell`, `PlacementVerdict`, `SCENE_VERSION = 3`. **Centimetres, serializable** |
| ⭐ `placement.ts` (284) | ⭐ **The SAT collision engine.** `evaluatePlacement`, `snapPosition`, `findSpot`, blocking-vs-advisory |
| ⭐ `planner.ts` (252) | ⭐ **`gatePlan()`** — the client trust gate; `openingZone`, `blockedOpening` |
| ⭐ `scene3d.ts` (~1156) | `class DesignWorld` — renderer, camera rig, wall culling, **`renderConditioning()`** |
| ⭐ `geometry.ts` | **12 procedural `BUILDERS`**, shared material cache, ADE class stamping |
| ⭐ `modelLoader.ts` (145) | **GLTF loading.** Uniform `contain` fit inside the collision box; re-stamps `userData.ade`; shared-prototype cache; `fitReport()` |
| `textures.ts` · `patterns.ts` | PBR map attachment (greyscale multiply) · procedural zellige/ornament — committed in `2380fa8` |
| ⭐ `roomModel.ts` (372) | `deriveRoom()` — the plausibility band, found massing, `WallOpening` |
| ⭐ `store.ts` (364) | Reducer, snapshot undo/redo with gesture coalescing, `localStorage` |
| ⭐ `catalog.ts` (133) | Reads `ontology/furniture.json` **directly** — no duplicated dimensions |
| ⭐ `materials.ts` (179) | 22 materials sourced from `ontology.json` colour palettes |
| ⭐ `ade20k.ts` (79) | ⚠ **GENERATED** from the backend palette — regenerate, do not hand-edit |
| `handoff.ts` (4) | One constant, alone, so Studio's bundle stays free of Build Mode |

### `src/lib/` — other
| File | Owns |
|---|---|
| ⭐ `api.ts` | **The typed backend client.** `API_URL` vs `DATA_API_URL` routing, `ApiError`, response-shape validation |
| `utils.ts`, `audio.ts` | `cn()`, `DarAudio.chime()` |
| `three/{archScene,dissolveScene,types}.ts` | Cinematic three.js scenes |

### `src/components/`
| Path | Owns |
|---|---|
| `design/` | ⭐ `PlanPanel.tsx` (352) · ⭐ `HandoffPanel.tsx` (350) · `DesignCanvas.tsx` (398) · `CatalogDock.tsx` · `Inspector.tsx` · `PlanMinimap.tsx` · `SourceCard.tsx` · `EnterBuildMode.tsx` · `design.css` |
| `story/` | ⭐ `adapters.ts` (533) **— the truth gate** · `DesignStory` · `CultureDNA` · `GenerationStory` · `StoryComparison` · `RoomUnderstandingFigure` · `cultureData.ts` · `copy.ts` · `types.ts` · ⭐ `README.md` (the integration contract) |
| `dar/` | `DarCinema.tsx` + `dar-cinema.css` (the landing) · `UnderstoodRoom/` (`/v2`) |
| `cinema/` | `ArchCanvas`, `DissolveCanvas`, `DustLayer`, `svg/MotifTiles`, `cinema.css` |
| `ui/` | shadcn primitives |
| *(top level)* | `CulturalElementHighlighter` · `RoomMap2D` · `DepthOrbit` · `RoomReport` · `ColorControl` · `FurniturePlacement` · `StyleIntensitySlider` · `CulturalNarration` · `EvaluationChart` · `SaveDesignButton` · `FeedbackForm` · `RatingBadge` · `GalleryShell` · `AuthForm` · `AppShell` · `AdminFeedbackPanel` · `before-after-slider.tsx` · `islamic-pattern.tsx` |

### `src/context/`
`ThemeLanguageContext.tsx` (628 — language, theme, **all translations**) ·
`AuthContext.tsx` · `ImageContext.tsx` (105)

### `src/data/`
⚠ `ontology.json` — **a SECOND COPY** of the root ontology, read by `RoomReport` and
`CulturalElementHighlighter`. **Keep in step with `ontology/ontology.json`.**

---

## 4. `ontology/` — the canonical cultural knowledge

| File | Owns |
|---|---|
| ⭐ `ontology.json` | 4 cultures × 7 categories, EN+AR, `weight` + **`verified`**, triggers, negatives. **113 terms; 60 verified, 53 not** |
| ⭐ `furniture.json` | **27 items**, v0.2.0 — real cm, footprints, `must_touch_wall`, `preferred_zones`, tags, `generation_prompt`, 7 deferred items |
| `sources.md`, `README.md` | Term provenance |

---

## 5. `configs/`, `scripts/`, `tests/`

| Path | Owns |
|---|---|
| ⭐ `configs/pipeline.yaml` | **Model ids + sampling params. ControlNet weights are tuned HERE, not in code** |
| ⭐ `configs/sweep_winners.json` | Per-culture `(depth, seg)` weights — currently all `[0.7, 0.5]` |
| `scripts/train_lora.py` | The 16 GB T4 recipe: cache latents+embeddings, free encoders, train fp32-master UNet + LoRA |
| `scripts/generate_furniture_assets.py` | Generates the 27 cut-out PNGs with DAR's own LoRAs |
| `scripts/make_demo_pack.py` | `outputs/finals/` → `public/demo/` + manifest (Defense Mode) |
| `scripts/dev-tunnel.mjs` | Writes `.env.local`, probes `/healthz`, runs `next dev` on **:3000 only** |
| `scripts/run-local-backend.ps1` | The day-to-day Windows data backend. **Never renders** |
| `scripts/{controlnet_sweep,generate_finals,ablate,baseline_grid,metrics,backfill_evaluation,seed_eval_demo,inspect_db,auto_caption,audit_licensing}.py` | Training / eval / ops |
| ⭐ `tests/` (24 files) | **pytest, backend only — 583 pass, 1 skipped.** Notably ⭐ `test_design_planner.py` (25 tests, no live API calls), `test_room_analysis.py`, `test_furniture_catalogue.py`, `test_subscriptions.py`, `test_evaluation.py`, `test_recolor.py`, `test_persian.py` |

> **There is no frontend test runner.** `npm run build` (which type-checks) is the whole
> frontend gate.

---

## 6. Data, models, outputs

| Path | State |
|---|---|
| `models/loras/{lebanese,khaleeji,moroccan}/` | ✅ **All three trained**, 93,076,472 B each. Weights gitignored |
| `datasets/{lebanese 19, khaleeji 14, moroccan 12}/images` + `captions.jsonl` | Training data + `LICENSING.csv` |
| `eval/CORPUS.md`, `eval/run_metrics.py` | The evaluation procedure. ⚠ **`eval/results.csv` DOES NOT EXIST** |
| `outputs/{finals,baselines,ablations,sweeps}/` | ⚠ **Empty — `.gitkeep` only** |
| `data/eval_rooms/` | 1 file |
| `public/demo/` | 6 rooms × {original, 3 cultures, depth_map, meta.json}. Gitignored (generated ~24 MB) |
| `public/furniture/{culture}/` | **27 cut-out PNGs**, 9 per culture |
| `public/models/Ottoman_01.glb` | **The single real 3D asset** — 651 KB, CC0, Poly Haven |
| `public/textures/<material>/{detail,normal,rough}.jpg` | **14 CC0 PBR sets, 42 files** (ambientCG). Colour maps are **greyscale** so the ontology palette survives |
| `public/ASSET-LICENSES.md` | Full CC0 attribution **+ the rejected-candidate reasoning** |
| `ontology/furniture_models.json` | The 3-tier model registry — a **sidecar** to `furniture.json` |

---

## 7. `docs/`, `kaggle/`, `.github/`

`docs/` — `thesis/DRAFT.md`, `defense-qa.md`, `demo-runbook.md`, `demo-video-script.md`,
`slides-and-one-pager.md`, `add_a_culture.md`, `survey-kit.md`, `user-study-survey.md`,
`session-start.md`, `zainab_handoff.md`, `zainab-onboarding.md`.

`kaggle/` — paste-into-cell runbooks (`TRAIN_NOW.md`, `README.md`).

`.github/workflows/ci.yml` — **`pytest` under `DARDESIGN_LIGHT=1` + `npm run build`.**
Both must pass. (`npm run lint` is not in CI, and is broken.)

---

## 8. Git worktrees

| Path | Branch | State |
|---|---|---|
| `C:/Users/hamda/dardesign-app` | `feat/frontend-visual-overhaul` @ **`2380fa8`** | **The authoritative tree.** Audit began at `60dc112`; `d80f03a`, `a4cec54`, `ab8d9b4`, `2380fa8` landed mid-audit |
| `C:/Users/hamda/dar-designer` | `sprint/designer` @ `940b620` | Merged; not authoritative |
| `C:/Users/hamda/dar-story` | `sprint/story` @ `940b620` | Merged; the `src/components/story/` package now lives in the main tree |
| `C:/Users/hamda/dar-hassan` | detached @ `92cff38` | Not inspected |

> ⚠ **Never copy `src/app/studio/page.tsx` across from a sprint worktree** — their copies
> are built on the pre-overhaul baseline and are older. Port the hunk.

---

## 9. Where to look for evidence of a given claim

| Claim | Look at |
|---|---|
| "There is no RAG" | `backend/requirements*.txt`, `backend/guardrails.py`, `backend/prompt_builder.py` |
| "The LLM cannot invent furniture" | `design_planner.plan_schema()` → `allowed_ids()`; `validate_items()` |
| "DAR decides placement, not the LLM" | `src/lib/design/placement.ts`, `src/lib/design/planner.ts` |
| "1 real model, 26 procedural" | `ontology/furniture_models.json`; `src/lib/design/modelLoader.ts`; `find . -name "*.glb"` → **1** |
| "Conditioning comes from the scene" | `scene3d.renderConditioning`, `transform._generate(control_override=…)` |
| "Cultures are verified / not verified" | `ontology/ontology.json` `verified` fields |
| "All three LoRAs exist" | `models/loras/*/` file listing |
| "Metrics are implemented but unmeasured" | `backend/quality.py` + `backend/dardesign.db` row counts + absent `eval/results.csv` |
| "Room dimensions are assumed" | `src/lib/design/roomModel.ts` `DEFAULT_ASPECT`, `DEFAULT_ROOM.heightCm` |

→ [28_SOURCE_INDEX.md](28_SOURCE_INDEX.md)
