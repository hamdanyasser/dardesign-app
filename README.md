# DarDesign — دار ديزاين

Bilingual (English / Arabic), AI-assisted Arabic interior design.
Upload a room photo, pick **Lebanese**, **Khaleeji**, or **Moroccan**, get a
photorealistic redesign in that style. Built as an undergraduate FYP.

```
                photo
                  │
                  ▼
   ┌──────────────────────────┐
   │ Depth Anything V2 (depth)│
   │ OneFormer ADE20K (seg)   │      LoRA per culture
   └──────────────┬───────────┘     (lebanese / khaleeji / moroccan)
                  │                        │
                  ▼                        ▼
       SDXL + dual ControlNet ◄────── prompt builder ◄── ontology.json
                  │                        ▲
                  ▼                        │
              output.png             trigger phrase + EN/AR terms
```

Free **Kaggle T4** only (15 GB VRAM, no A100, no paid APIs). On OOM the pipeline
auto-falls back to **SD 1.5 + ControlNet 1.1**.

## Status (Jun 2026)

- ✅ **All three cultural LoRAs trained** on a free T4 (`models/loras/{lebanese,khaleeji,moroccan}/`). The 16 GB recipe (`scripts/train_lora.py`): cache image latents + text embeddings once, free the VAE/text-encoders, then train only the **fp32-master UNet + LoRA** with autocast + GradScaler — fits, no NaN.
- ✅ **Three creative features** in `/studio`: Cultural Element Highlighter, **Style Intensity Slider** (`POST /restyle` — the no-LoRA↔full-LoRA ablation made live), and **Bilingual Cultural Narration** (Web Speech API, it speaks Arabic).
- ✅ **The Understood Room, all three layers live**: `/redesign` now ships `seg_regions` (real on-image highlighter boxes), `object_map` (top-down plan), and `depth_map` (grayscale PNG) from one depth+seg pass — and `/studio` mounts **DepthOrbit**, a three.js parallax orbit of the styled room displaced by its depth map.
- ✅ **Persian, the prompt-only 4th culture** (`/restyle` + the intensity slider): the scalability claim made live — adding culture N = one ontology entry, no retraining ([docs/add_a_culture.md](docs/add_a_culture.md)). Terms pending Zainab's cultural sign-off (`verified: false`).
- ✅ **Room Report**: one click composes before/after + Arabic ontology terms + the 2D plan + provenance into a downloadable branded PNG (pure client-side).
- ✅ **Audit trail**: every render logged (metadata only, never images) → `GET /audit` + the `/audit` page. Token-gated via `DARDESIGN_AUDIT_TOKEN`.
- ✅ **Dockerfile + CI**: `docker run -p 8000:8000 dardesign-backend` serves the LIGHT API; GitHub Actions runs the pytest suite + the production frontend build on every push.
- ✅ Defense materials drafted under `docs/`: thesis chapters, the 18-question Q&A, and slides + one-pager (AR + EN).
- ⏳ Eval figures (CLIP confusion matrix + SSIM/LPIPS) are one T4 run away (`push_verify.py`). Dataset-licensing audit lives in `datasets/LICENSING.csv` — fill it before the defense.

## Quick start

```bash
# 1. Install deps
make setup

# 2. Run the frontend (always works)
make frontend                  # http://localhost:3000

# 3a. Run the backend on a laptop (no GPU)
make backend-light             # placeholder PNGs; full UI flow exercisable
# …or containerized:
docker build -t dardesign-backend . && docker run -p 8000:8000 dardesign-backend

# 3b. Run the backend on Kaggle T4 (real generation)
# see kaggle/README.md — paste cells in order
```

### Every session: Kaggle backend + local frontend

The notebook prints a fresh tunnel URL each run. One command points the app at
it and starts the dev server:

```bash
npm run dev:tunnel https://nut-resist-wal-crossing.trycloudflare.com
npm run dev:tunnel        # later runs — reuses the URL saved in .env.local
```

It writes `.env.local`, probes `/healthz` (reporting version, LIGHT-vs-real, and
queue depth), and runs `next dev` on **:3000** — the only origin in the backend's
default CORS allowlist, so it refuses to start on a fallback port rather than
let every redesign call fail on CORS. Flags need npm's `--` separator:
`-- --set-only` (env only, no server), `-- --no-check`, `-- --any-port`.

## Repo layout

```
backend/         FastAPI service + canonical inference pipeline
  transform.py     SDXL + dual ControlNet, lazy LoRA, OOM->SD1.5 fallback
  prompt_builder.py  ontology -> bilingual prompts
  validators.py / errors.py / jobs.py / share.py / main.py
ontology/        seed cultural design vocabulary (~25 terms x 3 cultures)
configs/         pipeline.yaml, sweep_winners.json
scripts/         train_lora, controlnet_sweep, generate_finals, ablate, baseline_grid, metrics
datasets/        per-culture images + captions.jsonl + LICENSING.csv (provenance audit)
models/loras/    trained per-culture LoRAs (weights gitignored); backend lazy-loads them
kaggle/          paste-into-cell runbooks + push_kernel.py / push_verify.py (REST-API pushers)
docs/            thesis/DRAFT.md, defense-qa.md, slides-and-one-pager.md, zainab_handoff.md
src/             Next.js 14 app — DarCinema landing (/) + /studio (upload -> 3 redesigns + features)
tests/           pytest — prompt builder, validators, jobs, share, full API roundtrip
```

## Make targets

| Target | What it does |
|---|---|
| `make setup` | install backend + frontend deps |
| `make backend-light` | FastAPI in DARDESIGN_LIGHT mode (no GPU) |
| `make backend` | FastAPI with the real pipeline (needs GPU/Kaggle) |
| `make frontend` | Next.js dev server |
| `make test` | pytest |
| `make smoke-prompt` | dump the prompt builder output for each culture |
| `make smoke-train` | train_lora.py with placeholder captions on the 5 test rooms (Kaggle T4) |
| `make train-lora CULTURE=…` | full LoRA training run |
| `make sweep` | ControlNet weight sweep -> outputs/sweeps/ |
| `make finals` | 45-image final batch -> outputs/finals/ |
| `make ablate` | --no-lora / --no-segmentation / --no-ontology -> outputs/ablations/ |
| `make baseline-grid` | input grid + Decor8/RoomGPT slot folders + comparison.pdf |
| `make metrics` | SSIM + LPIPS -> eval/results.csv |

## Add a culture

See [docs/add_a_culture.md](docs/add_a_culture.md). One paragraph: extend
`ontology/ontology.json` (trigger + 7 categories), add the dataset directory,
train a LoRA, ship it.

## Backend env vars

| var | meaning |
|---|---|
| `NEXT_PUBLIC_API_URL` | frontend -> backend URL (ngrok tunnel in prod, http://localhost:8000 in dev) |
| `DARDESIGN_LIGHT=1` | placeholder mode for dev without a GPU |
| `DARDESIGN_ALLOWED_ORIGINS` | comma-separated CORS allowlist (defaults to localhost:3000) |
| `DARDESIGN_SHARE_SECRET` | HMAC secret for share-link tokens (random per process if unset) |
| `DARDESIGN_AUDIT_TOKEN` | when set, `GET /audit` requires `?token=…` (audit trail is open in dev) |
| `DARDESIGN_SMTP_HOST` | mail server for subscription decision emails — **unset = log the message instead of sending it** |
| `DARDESIGN_SMTP_PORT` | default 587 (STARTTLS); use 465 with `DARDESIGN_SMTP_SSL=1` |
| `DARDESIGN_SMTP_USER` / `DARDESIGN_SMTP_PASSWORD` | mailbox and **app password** (never the account password) |
| `DARDESIGN_SMTP_FROM` | From: address (defaults to `DARDESIGN_SMTP_USER`) |

Locally these come from a gitignored `.dardesign-smtp` file — copy
`.dardesign-smtp.example` and restart `scripts/run-local-backend.ps1`.

## Where Zainab's work lands

The dataset directories ship with READMEs and a captions template. The moment
her data arrives:

```bash
# 1. drop her files into datasets/<culture>/images/ + datasets/<culture>/captions.jsonl
# 2. on Kaggle T4:
make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese RANK=16 STEPS=1500
# 3. copy models/loras/lebanese/dardesign-lebanese-lora.safetensors next to the deployed backend
```

No code changes required — `backend/transform.py` lazy-loads whatever LoRA
file is present.

See [docs/zainab_handoff.md](docs/zainab_handoff.md) for the full one-pager.

## License

All code is released for academic use under the FYP rubric. Ontology entries
cite public sources; Zainab's curated dataset is hers.
