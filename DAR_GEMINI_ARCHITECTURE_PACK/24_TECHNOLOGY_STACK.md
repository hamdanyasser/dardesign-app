# 24 — Technology Stack

*Every technology, its role, where it is used, why it exists, and where to verify it.
Versions are quoted from `package.json` and `backend/requirements*.txt`.*

---

## 1. Frontend

| Technology | Version | Role in DAR | Where used | Why it exists |
|---|---|---|---|---|
| **Next.js** | `^16.3.0` | App Router framework, Turbopack dev server, production build | `src/app/**` | The build is the **only frontend gate** (`npm run build` type-checks). ⚠ `next lint` was removed in 16 — `npm run lint` is broken |
| **React** | `^19.2.8` | UI | everywhere | Every page is `"use client"` — all depend on context providers |
| **TypeScript** | `^5` | Type safety across the API boundary and the 3D model | `src/**` | `DesignScene` and the API response types are the contract between frontend, backend and the LLM planner |
| **Tailwind CSS** | `^3.4.1` | Utility styling | `globals.css`, all components | ⚠ **No `darkMode` config and no `dark:` utilities** — theming is 100 % CSS variables under `[data-theme]`, so a `dark:` class would silently follow the OS instead of the app toggle |
| **three.js** | `^0.150.0` | **The entire 3D system** | `lib/design/scene3d.ts`, `geometry.ts`, `modelLoader.ts`, `DepthOrbit.tsx`, `dar/UnderstoodRoom/world.ts`, `lib/three/*` | Used **directly** — no react-three-fiber, no drei. Build Mode, the depth-orbit viewer, and the cinematic landing scenes |
| **`GLTFLoader`** | from `three/examples/jsm` | Loads the one real CC0 model | `lib/design/modelLoader.ts` | Constructed **lazily** — `/design` is a client component but the module graph is still evaluated during the server build |
| **radix-ui / shadcn** | `^1.4.3` / `^4.0.5` | Accessible primitives | `src/components/ui/` | Accessibility without adopting a generic SaaS look |
| **lucide-react** | `^0.577.0` | Icons | throughout | |
| **clsx + tailwind-merge** | `^2.1.1` / `^3.5.0` | `cn()` class merging | `lib/utils.ts` | |
| **@types/three** | `^0.150.1` | three.js types | | Pinned to match the runtime version exactly |

> **Notably absent:** no state-management library (React context + `useReducer` only), no
> charting library (`EvaluationChart` is plain CSS bars), no react-three-fiber/drei, and no
> frontend test runner.

---

## 2. Backend — core

| Technology | Version | Role | Where | Why |
|---|---|---|---|---|
| **Python** | 3.10+ | Backend language | `backend/`, `scripts/`, `tests/` | |
| **FastAPI** | `0.115.6` | The whole HTTP surface — 47 endpoints | `backend/main.py`, `recolor_api.py` | Async streaming (`StreamingResponse` for keepalives), background tasks (LPIPS/CLIP, decision emails), dependency-injected auth |
| **Uvicorn** | `0.32.1` (`[standard]`) | ASGI server | | |
| **Pydantic** | **`2.13.4`** | Request/response models | `main.py` | ⚠ **Pinned at 2.13.4 because `google-genai` requires ≥ 2.12.5.** At 2.10.3 `pip install` was `ResolutionImpossible` and CI failed before a single test ran — while every local run passed, because the venv had already diverged |
| **python-multipart** | `0.0.20` | File uploads | | |
| **SQLite** | stdlib `sqlite3` | All persistence | `backend/db.py`, `backend/dardesign.db` | WAL mode, `foreign_keys = ON`. Single-file, zero-ops — right for an FYP with a self-hosted data backend |
| **Pillow** | `11.0.0` | All image IO, the LIGHT placeholder, compositing, recolour | `transform.py`, `compositing.py`, `recolor.py` | |
| **NumPy** | `1.26.4` | Mask arithmetic, SSIM, projection | `room_analysis.py`, `quality.py`, `projection.py` | |
| **SciPy** | `1.15.3` | `ndimage` — connected components, distance transform, uniform filter | `projection.py`, `room_analysis.py`, `quality.py` | `distance_transform_edt` finds candidate placement spots; `uniform_filter` implements SSIM |
| **PyYAML** | `6.0.2` | `configs/pipeline.yaml` | `transform.py` | **ControlNet weights are tuned in config, not code** |
| **stdlib `smtplib`** | — | Subscription decision emails | `mailer.py` | **No dependency.** Unconfigured = log the message |
| **stdlib `hashlib`/`hmac`/`secrets`** | — | PBKDF2 passwords, session tokens, share tokens | `auth.py`, `share.py` | No auth framework — a stateless HMAC token needs none |

---

## 3. Machine learning — generation

*All in `backend/requirements.txt` only; the LIGHT image and CI do not install these.*

| Technology | Version / identifier | Role | Why |
|---|---|---|---|
| **PyTorch** | `2.4.0` (+ `torchvision 0.19.0`) | Tensor runtime | Pre-installed on Kaggle; pinned for local envs |
| **diffusers** | `0.31.0` | The SDXL + ControlNet pipelines | `StableDiffusionXLControlNetPipeline`, `StableDiffusionControlNetPipeline`, `ControlNetModel` |
| **transformers** | `4.46.3` | Depth + segmentation models | `pipeline("depth-estimation")`, `OneFormerProcessor`, `OneFormerForUniversalSegmentation` |
| **accelerate** | `1.1.1` | `enable_model_cpu_offload()` | ⚠ Its offload hooks are what `_GEN_LOCK` protects — a concurrent LoRA hot-swap corrupts `_hf_hook` |
| **safetensors** | `0.4.5` | LoRA weight loading | |
| **peft** | `0.13.2` | LoRA training + key remapping | `_peft_key_to_diffusers` maps `base_model.model.*` → `unet.*` |
| **controlnet-aux** | `0.0.9` | `MidasDetector` depth fallback | Used only if the transformers depth pipeline cannot be constructed |
| **SDXL base 1.0** | `stabilityai/stable-diffusion-xl-base-1.0` | **The generator** | |
| **ControlNet depth** | `diffusers/controlnet-depth-sdxl-1.0` | Binds geometry, weight **0.7** | |
| **ControlNet seg** | **`SargeZT/sdxl-controlnet-seg`** | Binds object identity, weight **0.5** | ⚠ `diffusers/controlnet-seg-sdxl-1.0` **does not exist on the Hub** — this is the standard `ControlNetModel`-loadable SDXL seg checkpoint |
| **Depth Anything V2 Small** | `depth-anything/Depth-Anything-V2-Small-hf` | Monocular depth | "Small" fits the 15 GB free-tier budget |
| **OneFormer ADE20K Swin-L** | `shi-labs/oneformer_ade20k_swin_large` | 150-class semantic segmentation | ADE20K is the vocabulary the seg ControlNet was trained on — the two must agree exactly |
| **SD 1.5 + ControlNet 1.1** | `runwayml/stable-diffusion-v1-5`, `lllyasviel/sd-controlnet-{depth,seg}` | OOM fallback at 768² | Survives a 15 GB T4 |
| **bitsandbytes** | `0.44.1` (non-Windows) | 8-bit optimiser for training | |
| **datasets** | `3.1.0` | Training data loading | |

---

## 4. Machine learning — evaluation

| Technology | Version | Role | Status |
|---|---|---|---|
| **lpips** | `0.1.4` (AlexNet) | Perceptual distance | ⚠ **Not installed on the data host — zero measured values** |
| **open_clip** | (via `torchmetrics`/manual) `ViT-B-32`, `laion2b_s34b_b79k` | Zero-shot 3-way culture recognition | ⚠ **Not installed — zero measured values** |
| **scikit-image** | `0.24.0` | *Reference* SSIM | ⚠ **Deliberately NOT in `requirements-light.txt`** — which is why `quality.ssim` is hand-implemented on numpy+scipy, matching skimage to 1e-9. SSIM must run inside the render request and inside the LIGHT Docker image |
| **torchmetrics** | `1.5.2` | Metric helpers | |
| **opencv-python-headless** | `4.10.0.84` | Image ops | Full requirements only |

---

## 5. LLM providers

| Technology | Version | Role | Why |
|---|---|---|---|
| **google-genai** | `2.17.0` | **The live planner provider** | `gemini-3.5-flash`. Free tier is what makes the model path testable at all. `response_schema` enforces the catalogue enum. `max_output_tokens = 12000` because Gemini 3.x counts thinking against the budget |
| **anthropic** | `0.121.0` | The code's default provider | `claude-sonnet-5`. `output_config={"format": {...}, "effort": "low"}` — **`format` and `effort` are siblings in ONE `output_config`**; two separate kwargs silently overwrite each other |

> **Both are in `requirements-light.txt`** (they are pure-Python HTTP clients), so CI can
> import them — but **both are optional**: absent or unkeyed, the planner returns
> deterministic rule-based layouts. `gemini_schema()` translates DAR's JSON Schema into
> Gemini's OpenAPI-flavoured subset while **preserving the catalogue enum**, so gate 1 holds
> on both providers.
>
> **No API key value appears anywhere in this pack.**

---

## 6. Testing, CI and ops

| Technology | Version | Role |
|---|---|---|
| **pytest** | `8.3.4` | The backend suite — **583 pass, 1 skipped**, all under `DARDESIGN_LIGHT=1` |
| **httpx** | `0.28.1` | FastAPI `TestClient` transport |
| **GitHub Actions** | — | `.github/workflows/ci.yml` — pytest under LIGHT **+** `npm run build`. Both must pass |
| **Docker** | — | Root `Dockerfile`, LIGHT image on `requirements-light.txt` |
| **Kaggle** | T4 x2, free tier | The GPU host + LoRA training. ⚠ **Must be selected in the UI** — the Kaggle *API* grants a P100 (sm_60) that cannot run SDXL fp16 |
| **cloudflared / ngrok** | — | The tunnel to the GPU host; **the URL rotates every session** |
| **PowerShell** | — | `scripts/run-local-backend.ps1` — the day-to-day Windows data backend |
| **Node** | — | `scripts/dev-tunnel.mjs` — writes `.env.local`, probes `/healthz`, runs `next dev` on **:3000 only** |

> **There is no frontend test runner** (no Jest, Vitest or Playwright). `npm run build` is
> the whole frontend gate.

---

## 7. Data formats and standards

| Standard | Role |
|---|---|
| **ADE20K** (150 classes + the mmsegmentation palette) | The shared vocabulary between OneFormer, the seg ControlNet, and Build Mode's `renderConditioning`. `src/lib/design/ade20k.ts` is **generated** from the backend's copy — a hand-transcription slip would degrade conditioning **silently** |
| **JSON Schema** (`enum`, `additionalProperties`) | The LLM's closed catalogue vocabulary — gate 1 |
| **safetensors** | LoRA weight format |
| **glTF 2.0 (`.glb`)** | The one real 3D asset. Metres, Y-up — the fit is derived from the **measured** bounding box, never a unit assumption |
| **CC0 1.0 Universal** | The licence of every third-party asset (1 Poly Haven model, 14 ambientCG texture sets). Attribution recorded in `public/ASSET-LICENSES.md` anyway |
| **PNG data URLs** | Renders, depth maps and conditioning images across the API |
| **JSONL** | The audit trail; training captions |
| **CSV** | `eval/results.csv` (⚠ does not exist yet), `datasets/LICENSING.csv` |
| **SQLite WAL** | Concurrent reads during writes |
| **HMAC-SHA256** | Session cookies and share tokens |
| **PBKDF2-SHA256**, 200k rounds | Password hashing |

---

## 8. Deliberately-avoided technologies, and why

| Not used | Why |
|---|---|
| **Any vector database / embedding model** | The cultural corpus is ~140 records. Retrieval would add latency, a dependency and a new failure mode (retrieving the wrong culture) in exchange for nothing. → [07](07_RAG_ARCHITECTURE.md) |
| **react-three-fiber / drei** | three.js is used directly; `DesignScene` must stay plain serializable JSON with no `THREE.*` in it |
| **Draco / meshopt compression** | One 651 KB model does not need it |
| **A paid 3D asset marketplace** | Everything is CC0. ~20 candidate scans were inspected; 19 rejected as culturally wrong |
| **A charting library** | `EvaluationChart` is plain CSS bars. A null renders `—`, never a zero-width bar |
| **A state-management library** | Context + `useReducer` + `localStorage` covers it |
| **Prompt caching (Anthropic)** | The minimum cacheable prefix is 1024 tokens on Sonnet 5; a ~1k-token prompt would silently fail to cache and pay the write premium for nothing |
| **A server-side session store** | Stateless HMAC tokens need none |
| **`next/image`** | Blob URLs and SVG data URIs are incompatible with it. `<img>` is used deliberately |
| **Tailwind `dark:` utilities** | They follow the OS, not the app's theme toggle. Theming is CSS variables under `[data-theme]` |
| **A paid inference API** | The FYP constraint is free-tier-only. The LLM planner is the single external call, and it has a rule-based fallback |

---

## 9. The constraint that shaped the stack

> **A single free Kaggle T4 (15 GB usable), no A100, no paid inference APIs.**

| Consequence | Where it shows |
|---|---|
| fp16 + `enable_model_cpu_offload()` | `transform._load_pipeline` |
| SDXL → SD 1.5 @768² on OOM | `transform_room`, `render_scene` |
| `DARDESIGN_DEPTH_ONLY=1` escape hatch (~2.5 GB) | `_load_pipeline` |
| Depth Anything **Small**, not Large | `DEPTH_MODEL` |
| Latent + text-embedding caching during LoRA training | `scripts/train_lora.py` — fp32 OOMs, fp16 NaNs |
| Hand-rolled SSIM instead of scikit-image | `quality.py` — keeps the LIGHT image small |
| `_stream_keepalive` every 10 s | Free tunnels 524 a slow first byte |
| `_GEN_LOCK` serialising all generation | One GPU, one pipeline, non-reentrant LoRA state |
| The two-backend split | The GPU host is ephemeral and cannot hold user data |
| `DARDESIGN_LIGHT` as a first-class mode | Development and CI without a GPU at all |
