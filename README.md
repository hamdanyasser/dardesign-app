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

## Quick start

```bash
# 1. Install deps
make setup

# 2. Run the frontend (always works)
make frontend                  # http://localhost:3000

# 3a. Run the backend on a laptop (no GPU)
make backend-light             # placeholder PNGs; full UI flow exercisable

# 3b. Run the backend on Kaggle T4 (real generation)
# see kaggle/README.md — paste cells in order
```

## Repo layout

```
backend/         FastAPI service + canonical inference pipeline
  transform.py     SDXL + dual ControlNet, lazy LoRA, OOM->SD1.5 fallback
  prompt_builder.py  ontology -> bilingual prompts
  validators.py / errors.py / jobs.py / share.py / main.py
ontology/        seed cultural design vocabulary (~25 terms x 3 cultures)
configs/         pipeline.yaml, sweep_winners.json
scripts/         train_lora, controlnet_sweep, generate_finals, ablate, baseline_grid, metrics
datasets/        per-culture READMEs spelling out the curation spec for Zainab
kaggle/          paste-into-cell runbooks for T4
docs/            zainab_handoff.md, add_a_culture.md
src/             Next.js 14 app — landing / transform / result
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
