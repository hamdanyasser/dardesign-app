# DarDesign — دار ديزاين

DarDesign is a bilingual English/Arabic interior-design application built as an
undergraduate final-year project. A user uploads one room photo and receives
Lebanese, Khaleeji, and Moroccan redesigns. The system combines SDXL, depth and
semantic ControlNets, culture-specific LoRAs, and a reviewed cultural ontology.

The project is designed to run locally first. Laptop development uses a
lightweight FastAPI mode with placeholder images; real generation and training
run on a free Kaggle T4.

## What is available

| URL | Purpose |
|---|---|
| `/` | Cinematic DarDesign landing page |
| `/studio` | Main upload, redesign, comparison, cultural insight, map, depth, narration, report, and intensity experience |
| `/studio?demo=1` | Defense Mode using the pre-rendered `public/demo` pack; no backend required |
| `/v2` | “The Understood Room” experimental landing experience |
| `/audit` | Metadata-only generation audit viewer |
| `/atelier.html` | Preserved standalone design reference |
| `/transform`, `/result` | Compatibility redirects to `/studio` |

The three trained cultures are returned together by `POST /redesign`.
`POST /restyle` renders one culture at a selected intensity and also exposes
Persian as a prompt-only scalability example.

## Run locally

Requirements: Node.js 20+, Python 3.10+, and Git.

Install and start the frontend:

```bash
npm ci
npm run dev
```

In a second terminal, install the small backend and start placeholder mode:

```bash
python -m pip install -r backend/requirements-light.txt
DARDESIGN_LIGHT=1 python -m uvicorn backend.main:app --port 8000
```

PowerShell uses:

```powershell
$env:DARDESIGN_LIGHT = "1"
python -m uvicorn backend.main:app --port 8000
```

Open <http://localhost:3000/studio>. The frontend defaults to
`http://localhost:8000`, so `.env.local` is unnecessary for this local setup.
LIGHT mode exercises the complete API and UI contract, but its generated images
are clearly marked placeholders.

The same lightweight backend can run in Docker:

```bash
docker build -t dardesign-backend .
docker run --rm -p 8000:8000 dardesign-backend
```

## Defense Mode

`/studio?demo=1` reads `public/demo/manifest.json` and loads pre-rendered
rooms from the same origin. It does not contact FastAPI, so it remains usable
if the GPU session or tunnel fails.

The demo pack is already present in this working copy. If it must be rebuilt
from a generated final batch:

```bash
python scripts/make_demo_pack.py
npm run dev
```

`public/demo`, model weights, raw datasets, and generated outputs are ignored
by Git. A fresh clone therefore needs those assets copied or regenerated.

## Real generation on Kaggle

Follow [kaggle/README.md](kaggle/README.md) for the complete T4 runbook:
uploading private data, installing without replacing Kaggle's Torch build,
training, selecting checkpoints, running sweeps and metrics, and exposing the
real FastAPI backend through a tunnel.

For an existing remote backend, copy `.env.example` to `.env.local`, set:

```dotenv
NEXT_PUBLIC_API_URL=https://your-current-backend.example
```

and restart `npm run dev`. Never commit `.env.local` or access tokens.

## FYP training and evaluation workflow

The maintained workflow is:

1. Curate `datasets/<culture>/images/` and `captions.jsonl`; record
   provenance in `datasets/LICENSING.csv`.
2. Review bilingual cultural terms in `ontology/ontology.json`.
3. Smoke-test training, then train one LoRA per core culture.
4. Sweep ControlNet weights and record the selected pairs in
   `configs/sweep_winners.json`.
5. Generate finals, ablations, baseline comparisons, and metrics.
6. Use `push_verify.py` for the dedicated LoRA-versus-prompt-only evidence
   run when its Kaggle inputs are attached.

The top-level targets keep those operations reproducible:

| Command | Result |
|---|---|
| `make smoke-prompt` | Verify bilingual prompt construction without a GPU |
| `make smoke-train CULTURE=lebanese` | Short T4 training wiring/OOM check |
| `make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese RANK=16 STEPS=1500` | Train a production LoRA |
| `make sweep` | Generate ControlNet depth/segmentation contact sheets |
| `make finals` | Generate the canonical three-style room batch |
| `make ablate` | Compare full, no-LoRA, no-segmentation, and no-ontology variants |
| `make baseline-grid` | Prepare the Decor8/RoomGPT/ours comparison |
| `make metrics` | Compute SSIM and LPIPS with `scripts/metrics.py` |

Canonical weights belong at
`models/loras/<culture>/dardesign-<culture>-lora.safetensors`. The backend
loads them lazily and falls back to prompt-only generation when a weight is
missing.

## Project map

```text
src/                    Next.js application and public UI routes
backend/                FastAPI surface, validation, audit, jobs, projection, inference
ontology/ontology.json  Cultural prompt vocabulary (culture-specific)
src/data/segmentation-labels.json
                        ADE20K object labels used by frontend visualizations
configs/                Pipeline settings and selected ControlNet weights
datasets/               Dataset guidance, local images/captions, licensing audit
models/loras/           Canonical production LoRA location
scripts/                Training, generation, ablation, baseline, and metric tools
kaggle/                 Free-T4 operational runbook
public/demo/            Generated offline Defense Mode pack
tests/                  FastAPI, validation, prompt, job, and integration tests
docs/                   Onboarding, defense, survey, slide, and thesis material
```

The two JSON knowledge files have different jobs:

- `ontology/ontology.json` supplies culture-specific bilingual prompt terms.
- `src/data/segmentation-labels.json` translates ADE20K room-object classes
  for the highlighter, room map, and report.

See [ARCHITECTURE.md](ARCHITECTURE.md) for runtime data flow,
[docs/add_a_culture.md](docs/add_a_culture.md) for extension points, and
[docs/zainab-onboarding.md](docs/zainab-onboarding.md) for the data and cultural
review handoff.

## Configuration

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_API_URL` | Frontend-to-backend base URL; defaults to `http://localhost:8000` |
| `DARDESIGN_LIGHT=1` | Run the API with placeholder generation and no heavy ML stack |
| `DARDESIGN_ALLOWED_ORIGINS` | Comma-separated CORS allowlist; defaults to local frontend origins |
| `DARDESIGN_SHARE_SECRET` | Stable HMAC secret for legacy share links |
| `DARDESIGN_AUDIT_TOKEN` | Optional token required by `GET /audit` |

## Verify a change

```bash
npm ci
npm run build
DARDESIGN_LIGHT=1 python -m pytest tests -q
```

PowerShell:

```powershell
npm ci
npm run build
$env:DARDESIGN_LIGHT = "1"
python -m pytest tests -q
```

## License and data

The code is provided for academic use under the FYP rubric. Dataset images and
model weights have separate provenance and are intentionally not committed.
Complete `datasets/LICENSING.csv` before publishing results or presenting
dataset claims.
