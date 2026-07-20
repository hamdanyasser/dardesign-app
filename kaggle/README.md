# DarDesign Kaggle T4 runbook

This is the single runbook for private dataset upload, LoRA training, batch
evaluation, and serving the real FastAPI backend on Kaggle's free T4. Use a T4
accelerator; the project does not require a paid A100.

## 1. Upload the private culture data

The raw images and captions are Git-ignored. Prepare a private Kaggle Dataset
with this structure:

```text
dardesign-culture-datasets/
├── lebanese/images/ + captions.jsonl
├── khaleeji/images/ + captions.jsonl
└── moroccan/images/ + captions.jsonl
```

The current local handoff has 19 Lebanese, 14 Khaleeji, and 12 Moroccan pairs.
Lebanese is the strongest first training run; use fewer steps/rank or
prompt-only generation for undersized sets if previews show overfitting.

Recommended: Kaggle → Create → New Dataset, upload the folder/zip, and mark it
Private. The CLI is also valid when a staging directory contains
`dataset-metadata.json`:

```bash
kaggle datasets create -p path/to/staging
kaggle datasets version -p path/to/staging -m "recaption"
```

Never commit Kaggle, GitHub, or tunnel tokens.

## 2. Create the T4 notebook

Enable a GPU T4 accelerator, attach the private culture dataset, and run:

```python
!git clone --depth 1 https://github.com/hamdanyasser/dardesign-app.git
%cd /kaggle/working/dardesign-app
```

Keep Kaggle's CUDA/Torch and ABI-coupled scientific packages. Install the
remaining project requirements through a temporary filtered file:

```python
!grep -vE '^(torch|torchvision|numpy|scipy|opencv-python-headless|pillow|scikit-image)==' backend/requirements.txt > /tmp/dardesign-kaggle.txt
!pip install -q -r /tmp/dardesign-kaggle.txt
```

Confirm the accelerator:

```python
import torch
assert torch.cuda.is_available(), "Set the notebook accelerator to GPU T4"
print(torch.cuda.get_device_name(0), torch.cuda.mem_get_info())
```

Copy the attached private data into the repository layout. Adjust `SRC` to
the actual mounted dataset slug:

```python
from pathlib import Path
import shutil

SRC = Path("/kaggle/input/dardesign-culture-datasets")
for culture in ("lebanese", "khaleeji", "moroccan"):
    destination = Path("datasets") / culture
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SRC / culture / "images", destination / "images", dirs_exist_ok=True)
    shutil.copy2(SRC / culture / "captions.jsonl", destination / "captions.jsonl")
```

## 3. Smoke-test, train, and select the checkpoint

Run the short wiring/OOM check first:

```python
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --rank 16 --steps 200 \
    --output-dir models/loras/lebanese/_smoke \
    --smoke
```

Then train with curated captions:

```python
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir datasets/lebanese \
    --rank 16 --steps 1500 \
    --output-dir models/loras/lebanese
```

Inspect the step 500/1000/1500 preview grids. Select the checkpoint that is
recognizably Lebanese without copying a training image, and save it under the
canonical filename:

```text
models/loras/lebanese/dardesign-lebanese-lora.safetensors
```

Repeat with `--culture khaleeji` and `--culture moroccan`. For 12–14 images,
try `--steps 800` or `--rank 8` and compare against prompt-only output.
Training OOM also means lower the rank. If captions need regeneration,
`scripts/auto_caption.py` overwrites `captions.jsonl`, so back up and review
the bilingual data before using it.

## 4. Generate the FYP evidence

The maintained scripts are:

```python
# ControlNet sweep: review contact sheets and update configs/sweep_winners.json
!python scripts/controlnet_sweep.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/sweeps

# Canonical room × culture batch
!python scripts/generate_finals.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/finals

# Full versus no-LoRA/no-segmentation/no-ontology
!python scripts/ablate.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/ablations

# Structure/perceptual metrics
!python scripts/metrics.py \
    --finals outputs/finals \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out eval/results.csv
```

`scripts/baseline_grid.py` prepares the Decor8/RoomGPT/ours comparison after
external baseline screenshots are supplied. `push_verify.py` is the maintained
specialized evidence run for LoRA-versus-prompt-only grids and CLIP confusion
matrices. The root `push_kernel.py`, `push_backend.py`, and `push_verify.py`
helpers require `KAGGLE_API_TOKEN` in the caller's environment and push their
documented kernels through the Kaggle API.

Download approved weights and evidence before the notebook session expires.
Generated outputs are intentionally not tracked by Git.

## 5. Serve the real backend

Install the tunnel helper:

```python
!pip install -q pyngrok
```

Store `NGROK_AUTHTOKEN` as a Kaggle secret, then:

```python
import os
import threading
import time
from kaggle_secrets import UserSecretsClient
from pyngrok import ngrok
import uvicorn

os.environ["DARDESIGN_ALLOWED_ORIGINS"] = "*"
os.environ.pop("DARDESIGN_LIGHT", None)
ngrok.set_auth_token(UserSecretsClient().get_secret("NGROK_AUTHTOKEN"))

threading.Thread(
    target=lambda: uvicorn.run(
        "backend.main:app", host="0.0.0.0", port=8000, log_level="info"
    ),
    daemon=True,
).start()
time.sleep(5)
print("public URL:", ngrok.connect(8000).public_url)
```

Copy the printed HTTPS URL into the local frontend's uncommitted `.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=https://current-tunnel.example
```

Restart `npm run dev`, verify the backend `/healthz`, then use
`/studio`. A warm `/redesign` can still take minutes and generations are
serialized. The tunnel dies when the Kaggle session stops; start a new tunnel
and update `.env.local` when that happens.

If SDXL inference runs out of memory, the canonical pipeline releases it and
retries with SD 1.5 at a smaller size. Do not describe LIGHT placeholders or
prompt-only fallback images as trained-model evidence.
