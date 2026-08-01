# Local Runbook

This project is designed to run fully on a local machine.

## 1. Prepare directories

Place test room images in:

- `data/raw/test-rooms/`

Create the folder if needed and add `.jpg`, `.jpeg`, `.png`, or `.webp` files.

## 2. Install dependencies

```bash
pip install -r backend/requirements.txt
npm install
```

## 3. Start frontend and backend

```bash
# terminal 1
npm run dev

# terminal 2
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Optional local placeholder mode (no heavy model execution):

```bash
cd backend
DARDESIGN_LIGHT=1 uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## 4. Training and generation scripts

```bash
python scripts/train_lora.py --culture lebanese --data-dir datasets/lebanese --output-dir models/loras/lebanese
python scripts/controlnet_sweep.py --rooms-dir data/raw/test-rooms --out outputs/sweeps
python scripts/generate_finals.py --rooms-dir data/raw/test-rooms --out outputs/finals
python scripts/ablate.py --rooms-dir data/raw/test-rooms --out outputs/ablations
python scripts/metrics.py --finals outputs/finals --rooms-dir data/raw/test-rooms --out eval/results.csv
```

## 5. Environment variables

Optional overrides:

- `DARDESIGN_DATA_DIR`
- `DARDESIGN_RAW_DIR`
- `DARDESIGN_PROCESSED_DIR`
- `DARDESIGN_MODELS_DIR`
- `DARDESIGN_CACHE_DIR`
- `DARDESIGN_EXPORTS_DIR`
- `DARDESIGN_TEMP_DIR`
- `DARDESIGN_CHECKPOINTS_DIR`
- `DARDESIGN_LOGS_DIR`
- `DARDESIGN_UPLOAD_DIR`

## 6. Logs and outputs

- Runtime logs: `logs/`
- Backend uploads: `backend/uploads/` (or `DARDESIGN_UPLOAD_DIR`)
- Inference exports: `data/exports/inference/`
