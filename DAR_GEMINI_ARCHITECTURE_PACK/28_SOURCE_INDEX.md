# 28 — Source Index

*Which implementation files back which document. Use this to trace any claim in the pack
back to the code.*

---

## 1. Document → sources

### 00_READ_ME_FIRST.md
Derived from all others. Verification facts from: `pytest tests -q` output, `GET /healthz`,
`GET /api/design/planner-status`, `git status` / `git log`.

### 01_PROJECT_OVERVIEW.md
**Primary:** `README.md` · `backend/main.py` · `backend/transform.py` ·
`ontology/ontology.json` · `configs/pipeline.yaml`
**Supporting:** `src/app/studio/page.tsx` · `src/app/design/page.tsx` · `models/loras/`

### 02_FRONTEND_ARCHITECTURE.md
**Primary:** `src/app/studio/page.tsx` (1523) · `src/app/design/page.tsx` (609) ·
`src/lib/api.ts` · `src/app/layout.tsx` · `package.json`
**Supporting:** `src/context/{ThemeLanguageContext,AuthContext,ImageContext}.tsx` ·
`src/components/design/*` · all `src/app/**/page.tsx`

### 03_BACKEND_ARCHITECTURE.md
**Primary:** `backend/main.py` (~2060) · `backend/db.py` · `backend/transform.py` ·
`backend/requirements.txt` · `backend/requirements-light.txt`
**Supporting:** `backend/{auth,subscriptions,jobs,ttl_cleanup,audit,share,errors,validators,guardrails}.py` ·
`.github/workflows/ci.yml` · `Dockerfile` · `scripts/run-local-backend.ps1`

### 04_ROOM_UNDERSTANDING.md
**Primary:** `backend/room_analysis.py` · `backend/projection.py` ·
`src/lib/design/roomModel.ts` · `backend/transform.py::compute_depth_seg`
**Supporting:** `tests/test_room_analysis.py` · `tests/test_seg_regions.py` ·
`src/components/{RoomMap2D,DepthOrbit,CulturalElementHighlighter}.tsx`

### 05_CULTURAL_ONTOLOGY.md
**Primary:** `ontology/ontology.json` · `ontology/furniture.json` ·
`backend/prompt_builder.py`
**Supporting:** `src/lib/design/materials.ts` · `src/components/story/cultureData.ts` ·
`src/data/ontology.json` (the second copy) · `ontology/sources.md` ·
`docs/add_a_culture.md` · `tests/test_prompt_builder.py` · `tests/test_persian.py`
**Counts verified by:** direct JSON traversal of `ontology/ontology.json` counting
`verified` flags per culture.

### 06_LLM_DESIGN_PLANNER.md
**Primary:**
- `backend/design_planner.py` (931) — `plan_schema`, `_SYSTEM`, `catalogue_projection`,
  `provider`, `_call_anthropic`, `_call_gemini`, `gemini_schema`, `validate_items`,
  `validate_understood`, `seats_of`, `fallback_plan`, `_cache_key`
- `src/lib/design/planner.ts` (252) — `gatePlan`, `openingZone`, `blockedOpening`
- `src/components/design/PlanPanel.tsx` (352)
- `ontology/furniture.json`

**Supporting:** `backend/main.py` (`/api/design/plan`, `/api/design/planner-status`) ·
`src/lib/api.ts` (`planLayout`, `fetchPlannerStatus`) · `tests/test_design_planner.py` (25
tests) · `.dardesign-llm.example` (**template only — no values read**)

**Live provider verified by:** `GET http://localhost:8000/api/design/planner-status` →
`{"configured": true, "model": "gemini-3.5-flash", "provider": "gemini"}`

### 07_RAG_ARCHITECTURE.md
**Primary (negative evidence):**
- Repo-wide grep across `*.py`, `*.ts`, `*.tsx`, `*.md`, `*.json` (excluding
  `node_modules/`, `.venv/`, `.next/`) for: `rag`, `embedding`, `vector store`,
  `vectorstore`, `faiss`, `chroma`, `chromadb`, `retriev*`, `top_k`, `cosine`,
  `sentence-transformer`, `knowledge base`
- `backend/requirements.txt`, `backend/requirements-light.txt` — no retrieval dependency
- `backend/guardrails.py` — `filter_chunk`, the only "RAG" mention, in a docstring
- `backend/prompt_builder.py:137-138` — its only production caller, applied to static
  ontology entries

**Supporting:** `tests/test_kit.py` · `ontology/ontology.json`

### 08_SPATIAL_VALIDATION.md
**Primary:** `src/lib/design/placement.ts` (284) · `src/lib/design/planner.ts` (252) ·
`src/lib/design/types.ts` · `backend/design_planner.py::validate_items`
**Supporting:** `backend/placement.py` (the separate image-space engine) ·
`src/lib/design/store.ts` · `src/lib/design/catalog.ts`

### 09_BUILD_MODE_THREEJS.md
**Primary:** `src/lib/design/scene3d.ts` (~1156) · `src/lib/design/geometry.ts` (438) ·
`src/lib/design/store.ts` (364) · `src/app/design/page.tsx` (609) ·
`src/components/design/DesignCanvas.tsx` (398)
**Supporting:** `src/lib/design/{types,materials,roomModel,ade20k}.ts` ·
`src/components/design/{CatalogDock,Inspector,PlanMinimap,SourceCard,EnterBuildMode}.tsx`
**Asset tiers verified by:** `ontology/furniture_models.json` (the registry and its `_tiers`
definitions) · `src/lib/design/modelLoader.ts` · `public/ASSET-LICENSES.md` ·
`find . -iname "*.glb"` → **1** (`public/models/Ottoman_01.glb`) ·
`find public/textures -type f` → **42**.

### 10_FURNITURE_AND_ASSETS.md
**Primary:** `ontology/furniture.json` (v0.2.0, 27 items) · `backend/furniture.py` ·
`src/lib/design/catalog.ts` · `src/lib/design/geometry.ts`
**Supporting:** `backend/{placement,compositing}.py` ·
`src/components/design/CatalogDock.tsx` · `public/furniture/` (27 PNGs) ·
`scripts/generate_furniture_assets.py` · `tests/test_furniture_catalogue.py` ·
`tests/test_furniture_endpoints.py` · `datasets/LICENSING.csv`

### 11_RENDER_WITH_DAR.md
**Primary:** `src/lib/design/scene3d.ts::renderConditioning` ·
`backend/transform.py::render_scene` · `backend/transform.py::_generate` ·
`src/components/design/HandoffPanel.tsx` (350) · `backend/main.py` (`/render-scene`)
**Supporting:** `src/lib/design/ade20k.ts` · `src/lib/api.ts::renderScene`

### 12_DEPTH_AND_SEGMENTATION.md
**Primary:** `backend/transform.py` — `_depth_control_image`, `_seg_control_image`,
`_prepare_conditioning`, `_ADE20K_PALETTE`, `compute_depth_seg` ·
`src/lib/design/ade20k.ts` · `src/lib/design/scene3d.ts::renderConditioning`
**Supporting:** `backend/room_analysis.py` · `backend/projection.py` ·
`configs/pipeline.yaml` · `src/components/DepthOrbit.tsx`

### 13_SDXL_CONTROLNET_LORA.md
**Primary:** `backend/transform.py` — `_DEFAULT_CONFIG`, `_load_pipeline`, `_attach_lora`,
`_generate`, `transform_room`, `render_scene`, `_write_manifest` ·
`configs/pipeline.yaml` · `configs/sweep_winners.json` · `scripts/train_lora.py`
**Supporting:** `models/loras/` (file listing + sizes) · `backend/requirements.txt` ·
`kaggle/TRAIN_NOW.md` · `datasets/{lebanese,khaleeji,moroccan}/images`

### 14_EXPLAINABILITY.md
**Primary:** `src/components/story/adapters.ts` (533) ·
`src/components/story/README.md` · `src/components/design/{HandoffPanel,PlanPanel}.tsx`
**Supporting:** `src/components/story/{DesignStory,CultureDNA,GenerationStory}.tsx` ·
`src/components/{CulturalElementHighlighter,RoomMap2D,DepthOrbit,RoomReport,CulturalNarration}.tsx` ·
`backend/audit.py` · `backend/transform.py::_write_manifest`

### 15_ACCOUNTS_DATABASE_ADMIN.md
**Primary:** `backend/db.py` (~1300) · `backend/auth.py` · `backend/subscriptions.py` ·
`backend/mailer.py` · `backend/main.py` (auth/history/feedback/subscription/admin routes)
**Supporting:** `backend/share.py` · `backend/ttl_cleanup.py` · `backend/errors.py` ·
`tests/test_subscriptions.py` · `tests/test_email.py` · `tests/test_feedback.py` ·
`src/app/{history,others,subscription,login,register,admin}/**`
**Row counts from:** direct `sqlite3` `SELECT COUNT(*)` on `backend/dardesign.db`
(**counts only — no personal data read or reproduced**).

### 16_EVALUATION.md
**Primary:** `backend/quality.py` · `backend/evaluation.py` ·
`backend/db.py` (`_history_filters`, `culture_confusion`, `evaluation_coverage`,
`history_generation_stats`) · `eval/CORPUS.md` · `eval/run_metrics.py`
**Supporting:** `src/app/evaluation/page.tsx` (911) · `src/components/EvaluationChart.tsx` ·
`scripts/backfill_evaluation.py` · `tests/test_evaluation*.py` ·
`tests/test_history_evaluation.py`
**Measured state from:** `SELECT Culture, Ssim, Lpips, ClipScore, PredictedCulture,
IsEdited, IsLight, Duration FROM history` (4 rows); `SELECT COUNT(*) FROM
evaluation_results` (0); `importlib.import_module` probes for `lpips` / `open_clip` (both
absent); `find . -name results.csv` (absent); `find outputs -type f` (`.gitkeep` only).

### 17_FULL_DATA_FLOW.md
Synthesised from documents 02–16. Every step names its own owning file inline.

### 18_API_ENDPOINT_MAP.md
**Primary:** `backend/main.py` (42 routes) · `backend/recolor_api.py` (5 routes) ·
`src/lib/api.ts`
**Route count verified by:** `grep -c "^@app\.\(get\|post\|put\|delete\|patch\)"
backend/main.py` → 42.

### 19_REPO_FILE_MAP.md
**Primary:** filesystem traversal of the repository (excluding `node_modules/`, `.next/`,
`.venv/`, `__pycache__/`, `.git/`) · `git worktree list` · `.gitignore`

### 20_DEFENSE_FACTS_AND_LIMITATIONS.md
Synthesised from all documents. Verification facts from the live probes and the test run
listed in §2 below.

### 21_GEMINI_MASTER_CONTEXT.md
Synthesised from all documents.

### 22 / 23 — Diagram spec and prompts
Derived from `17_FULL_DATA_FLOW.md`, `21_GEMINI_MASTER_CONTEXT.md`,
`25_IMPLEMENTED_VS_PLANNED.md` and `architecture.json`.

### 24_TECHNOLOGY_STACK.md
**Primary:** `package.json` · `backend/requirements.txt` ·
`backend/requirements-light.txt` · `configs/pipeline.yaml` · `backend/transform.py`
**Supporting:** `.github/workflows/ci.yml` · `Dockerfile` · `Makefile` ·
`scripts/dev-tunnel.mjs`

### 25_IMPLEMENTED_VS_PLANNED.md
Synthesised. **Staleness comparisons** made directly against `CLAUDE.md`, `README.md`,
`ARCHITECTURE.md` and `kaggle/TRAIN_NOW.md`. **Working-tree changes** from `git diff`.

### 26_GLOSSARY.md
Synthesised from all documents plus `ontology/sources.md`.

### 27_DEFENSE_QA_FACTS.md
Synthesised. Cross-checked against `docs/defense-qa.md` (which is the project's own,
older Q&A — **this pack's answers reflect the current code where they differ**).

---

## 2. Live verification performed while producing this pack

| Check | Command | Result |
|---|---|---|
| Backend test suite | `DARDESIGN_LIGHT=1 python -m pytest tests -q` | **583 passed, 1 skipped** (re-run after the mid-audit commits) |
| Backend health | `curl localhost:8000/healthz` | `{"ok":true,"version":"0.3.0","light_mode":true,"queue_depth":0}` |
| Planner provider | `curl localhost:8000/api/design/planner-status` | `{"configured":true,"model":"gemini-3.5-flash","provider":"gemini"}` |
| Furniture catalogue | `curl "localhost:8000/api/furniture/catalogue?culture=lebanese"` | 9 items returned |
| Frontend | `curl localhost:3000` | HTTP 200 |
| Route count | `grep -c "^@app\.(get\|post\|...)" backend/main.py` | 42 (+5 in `recolor_api.py`) |
| LoRA files | `ls -la models/loras/*/` | 3 files, 93,076,472 B each |
| Ontology verification | JSON traversal counting `verified` flags | leb 0/30 · khal 30/30 · mor 30/30 · per 0/23 |
| Catalogue size | JSON traversal of `furniture.json` | 27 items, 9 per culture, 12 categories |
| Furniture assets | `find public -iname "*.png" -path "*furniture*" \| wc -l` | 27 |
| 3D model files | `find . -iname "*.glb"` (excl. node_modules/.venv) | **1** — `public/models/Ottoman_01.glb` |
| 3D loader | `src/lib/design/modelLoader.ts` | `GLTFLoader`, uniform `contain` fit |
| CC0 texture files | `find public/textures -type f` | **42** (14 sets) |
| RAG markers | repo-wide grep (see 07 §1) | **0** outside one docstring |
| DB row counts | `sqlite3` `SELECT COUNT(*)` per table | users 3 · history 4 · feedback 2 · subreq 2 · **evaluation_results 0** |
| Metric values | `SELECT ... FROM history` | SSIM ×3, duration ×4, **LPIPS/CLIP/Predicted all null** |
| ML metric packages | `importlib.import_module('lpips' / 'open_clip')` | **both NOT installed** |
| Eval corpus | `find . -name results.csv`; `find outputs -type f` | **absent**; `.gitkeep` only |
| `MAX_RESULTS` | `grep -n "MAX_RESULTS" backend/furniture.py` | **9** (CLAUDE.md says 6 — stale) |
| Dead tab code | `grep -n "resultTab\|TOOL_TABS" src/app/studio/page.tsx` | set 3×, **never read** |
| Git state | `git status --porcelain`, `git log`, `git worktree list` | 4 modified files, uncommitted |

---

## 3. Files copied into `RAW_EVIDENCE/` (58)

Directory structure is preserved.

| Group | Files |
|---|---|
| **Docs** | `README.md` · `ARCHITECTURE.md` (stale — kept as evidence *of* the staleness) · `package.json` |
| **Cultural knowledge** | `ontology/ontology.json` · `ontology/furniture.json` · `ontology/README.md` · `ontology/sources.md` |
| **Config** | `configs/pipeline.yaml` · `configs/sweep_winners.json` |
| **Backend — generation** | `backend/main.py` · `transform.py` · `prompt_builder.py` · `guardrails.py` |
| **Backend — planner** | `backend/design_planner.py` ⭐ |
| **Backend — understanding** | `backend/room_analysis.py` · `projection.py` |
| **Backend — furniture/edit** | `backend/furniture.py` · `placement.py` · `compositing.py` · `recolor.py` |
| **Backend — eval/policy** | `backend/quality.py` · `evaluation.py` · `subscriptions.py` |
| **Backend — deps** | `requirements.txt` · `requirements-light.txt` |
| **Frontend — spatial truth** | `src/lib/design/placement.ts` ⭐ · `planner.ts` ⭐ · `types.ts` |
| **Frontend — 3D assets** | `src/lib/design/modelLoader.ts` ⭐ · `textures.ts` · `patterns.ts` · `ontology/furniture_models.json` ⭐ · `public/ASSET-LICENSES.md` · `scripts/fetch_design_assets.py` |
| **Frontend — 3D** | `src/lib/design/scene3d.ts` ⭐ · `geometry.ts` · `roomModel.ts` · `store.ts` · `ade20k.ts` |
| **Frontend — catalogue/materials** | `src/lib/design/catalog.ts` · `materials.ts` · `handoff.ts` |
| **Frontend — API** | `src/lib/api.ts` |
| **Frontend — UI** | `src/components/design/PlanPanel.tsx` · `HandoffPanel.tsx` · `DesignCanvas.tsx` |
| **Frontend — truth gate** | `src/components/story/adapters.ts` ⭐ · `src/components/story/README.md` |
| **Tests** | `test_design_planner.py` ⭐ · `test_furniture_catalogue.py` · `test_room_analysis.py` · `test_prompt_builder.py` · `test_evaluation.py` · `test_subscriptions.py` |
| **Procedure / CI** | `eval/CORPUS.md` · `.github/workflows/ci.yml` |

⭐ = the strongest evidence for the project's central claims.

**The five files to read first if you read only five:**
1. `backend/design_planner.py` — the planner, its gates, and both providers
2. `src/lib/design/placement.ts` — the deterministic authority
3. `src/lib/design/planner.ts` — where the LLM meets that authority
4. `src/lib/design/scene3d.ts` — `renderConditioning`, the capture camera
5. `ontology/furniture.json` — the closed vocabulary that becomes the schema enum

---

## 4. 🔒 Deliberately EXCLUDED — and why

| Excluded | Reason |
|---|---|
| `.env.local` | Runtime config. **Only the key NAMES were listed** (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DATA_API_URL`); **no value was read** |
| `.dardesign-llm` | LLM API key. **Only the key NAMES were listed** (`GEMINI_API_KEY`, `DARDESIGN_LLM_PROVIDER`); **no value was read**. The live provider was determined from the **public** `/api/design/planner-status` endpoint instead |
| `.dardesign-smtp` | SMTP credentials. **Not opened** |
| `.dardesign-secret` | Session-signing key. **Not opened** |
| `backend/dardesign.db`, `*-wal`, `*-shm` | User data. **Only aggregate row counts and non-personal metric columns were queried** |
| `backend/audit.jsonl` | Runtime log |
| `backend/uploads/` | User-uploaded photographs |
| `models/loras/*.safetensors` | 3 × 93 MB binaries — size only |
| `node_modules/`, `.next/`, `.next-build/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `tsconfig.tsbuildinfo` | Build output and caches |
| `*.mp4` | Unrelated video files at the repo root |
| `datasets/*/images/` | Training images — licensing is audited separately in `datasets/LICENSING.csv` |
| Full-resolution `public/demo/` | 24 MB. Downscaled JPEG copies of 2 rooms are in `VISUAL_EVIDENCE/` instead |

> **A regex secret scan was run across every file in the pack** for API-key patterns
> (`sk-`, `sk-ant-`, `AIza`, `ghp_`, `xox`), private-key headers, and
> `password`/`secret`/`token`/`api_key` assignments with non-placeholder values.
> **Result: zero findings.** See the final report.

---

## 5. `VISUAL_EVIDENCE/` provenance

10 images, downscaled JPEG copies of **real pipeline outputs** from `public/demo/`
(generated by `scripts/make_demo_pack.py` from `outputs/finals/`).

**Provenance is documented and checkable:** each source room's `meta.json` carries
`"placeholder": null` — i.e. these are **genuine GPU renders, not `DARDESIGN_LIGHT`
placeholders** — together with a real `jobId` and real detection payloads
(`object_map` with confidence values, `seg_regions`).

Full detail → `VISUAL_EVIDENCE/README.md`.
