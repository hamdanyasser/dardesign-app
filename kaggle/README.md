# Kaggle T4 runbook — DarDesign

Free Kaggle T4 (CUDA 12.1, 15 GB VRAM, ~9 hr/week). No A100. No paid APIs.

## 0 — clone the repo into the notebook

```bash
!git clone https://github.com/<you>/dardesign-app.git
%cd /kaggle/working/dardesign-app
```

## 1 — install (T4 already has torch, so skip torch line)

```bash
!sed -i '/^torch==/d;/^torchvision==/d' backend/requirements.txt
!pip install -q -r backend/requirements.txt
```

## 2 — sanity: GPU + free VRAM

```python
import torch
assert torch.cuda.is_available(), "no GPU"
print(torch.cuda.get_device_name(0), torch.cuda.mem_get_info())
```

## 3 — run the backend with an ngrok tunnel

```bash
!pip install -q pyngrok uvicorn
```

```python
import os, threading, time
os.environ["DARDESIGN_ALLOWED_ORIGINS"] = "*"   # demo
from pyngrok import ngrok
ngrok.set_auth_token("YOUR_NGROK_TOKEN")
tunnel = ngrok.connect(8000)
print("public URL:", tunnel.public_url)

import uvicorn
def serve():
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, log_level="info")
threading.Thread(target=serve, daemon=True).start()
time.sleep(3)
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` on your dev box to that public URL,
restart the Next.js dev server, and the frontend now drives the T4.

## 4 — train a LoRA (real, with Zainab's data)

```bash
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir datasets/lebanese \
    --rank 16 --steps 1500 \
    --output-dir models/loras/lebanese
```

LoRA lands at `models/loras/lebanese/dardesign-lebanese-lora.safetensors`
plus 5-image preview grids at step 500/1000/1500.

## 4b — smoke-train (placeholder captions, today)

```bash
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --rank 16 --steps 200 \
    --output-dir models/loras/lebanese/_smoke \
    --smoke
```

Doesn't produce a usable LoRA; only verifies the loop, dataloader, peft, and
checkpoint writer are wired. **Run this before a real training session** to
catch OOM / config drift early.

## 5 — ControlNet weight sweep (4 weights × 3 cultures × 5 rooms)

```bash
!python scripts/controlnet_sweep.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/sweeps
```

Open every `outputs/sweeps/<room>_contact.png` in the Kaggle viewer, pick
favourites by eye, edit `configs/sweep_winners.json` with the chosen
`(depth, seg)` per culture.

## 6 — final batch (15 rooms × 3 styles = 45)

```bash
!python scripts/generate_finals.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/finals
```

## 7 — ablations

```bash
!python scripts/ablate.py \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out outputs/ablations
```

Produces `outputs/ablations/contact_<ablation>.png` (FULL vs ablated, side-by-side).

## 8 — metrics

```bash
!python scripts/metrics.py \
    --finals outputs/finals \
    --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --out eval/results.csv
```

## 9 — recover from OOM

If SDXL OOMs during inference, `transform_room()` already retries on SD 1.5
at 768² automatically. If training OOMs, lower `--rank` (e.g. 8) and re-run.
Don't suggest A100. The whole point is "free T4 only".

## 10 — keep the tunnel up

The Kaggle notebook stops after ~9 hours of continuous run; the tunnel dies
with it. The frontend's error banner says "tunnel unreachable" gracefully.
Restart the cell, copy the new public URL into `.env.local`, restart Next.js.
