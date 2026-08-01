# DarDesign

Bilingual (English/Arabic) AI interior design app with a fully local execution model.

## Local-Only Architecture

- Frontend: Next.js app in `src/`
- Backend: FastAPI in `backend/`
- Inference: `backend/transform.py` (SDXL + ControlNet, SD 1.5 fallback)
- Training: `scripts/train_lora.py`
- Shared local configuration and hardware detection: `backend/settings.py`

## Quick Start

```bash
# install
pip install -r backend/requirements.txt
npm install

# frontend
npm run dev

# backend (real local pipeline)
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Optional placeholder backend mode (for UI/API flow without model execution):

```bash
cd backend
DARDESIGN_LIGHT=1 uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Local Directory Layout

```text
project/
  data/
    raw/
    processed/
    models/
    cache/
    exports/
    temp/
    checkpoints/
  logs/
  backend/
  scripts/
  src/
```

Default test rooms path for scripts:

- `data/raw/test-rooms/`

## Make Targets

```bash
make setup
make backend
make backend-light
make frontend
make test
make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese
make sweep
make finals
make ablate
make baseline-grid
make metrics
```

## 8 GB GPU Optimization

The runtime auto-detects hardware and applies conservative defaults when an ~8 GB GPU is detected:

- Reduced safe image size/steps for heavy generation paths
- FP16 when CUDA is available
- Conservative default batch sizing and gradient accumulation for training
- CPU fallback when CUDA is unavailable
- Runtime memory and resource logging in `logs/`

## Environment Variables

See local configuration in:

- `backend/settings.py`
- `docs/local_runbook.md`

## Notes

- All data, models, logs, exports, and cache are local filesystem paths.
- No notebook runtime assumptions are required.
- No cloud service is required for training or inference.
