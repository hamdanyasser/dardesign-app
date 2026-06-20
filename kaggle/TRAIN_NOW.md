# Train the Lebanese LoRA — today's runbook

Tailored to the dataset Zainab handed off (Jun 16) and cleaned on Jun 17.
Trainer (`scripts/train_lora.py`) is on `origin/master` → a plain clone has it.
Data is **not** in git (gitignored + unlicensed) → it goes up as a Kaggle Dataset.

Final set after cleanup: **Lebanese 19** (hero — train this), Khaleeji 14, Moroccan 12
(both under the 20-image floor → prompt-only per the cut order, or train with fewer steps).

---

## Step 1 — get the data onto Kaggle (once)

The upload bundle is staged at `kaggle/upload/` (3 cultures: `images/` + `captions.jsonl`).

**Option A — kaggle CLI (from your dev box):**
```bash
# needs ~/.kaggle/kaggle.json (Account → Create New API Token)
kaggle datasets create -p kaggle/upload          # first time
# later updates:  kaggle datasets version -p kaggle/upload -m "recaption"
```
Creates `yasserhamdanfr/dardesign-culture-datasets`.

**Option B — manual:** zip `kaggle/upload/`, Kaggle → *Create → New Dataset*, drag it in,
make it **Private**. Note the slug it gives you.

Then in your T4 notebook: *Add Input → Datasets →* pick `dardesign-culture-datasets`.
It mounts at `/kaggle/input/dardesign-culture-datasets/`.

---

## Step 2 — notebook cells (T4 accelerator ON)

```python
# 0 — clone (master has the trainer)
!git clone https://github.com/hamdanyasser/dardesign-app.git
%cd /kaggle/working/dardesign-app
```

```python
# 1 — install (T4 already ships torch; strip it so we don't reinstall)
!sed -i '/^torch==/d;/^torchvision==/d' backend/requirements.txt
!pip install -q -r backend/requirements.txt
```

```python
# 2 — GPU sanity
import torch; assert torch.cuda.is_available(), "no GPU — set Accelerator to GPU T4"
print(torch.cuda.get_device_name(0))
```

```python
# 3 — drop the curated data into the repo's datasets/ (images/ is gitignored, so empty after clone)
import shutil, pathlib
SRC = "/kaggle/input/dardesign-culture-datasets"   # <- your dataset slug
for c in ["lebanese","khaleeji","moroccan"]:
    pathlib.Path(f"datasets/{c}/images").mkdir(parents=True, exist_ok=True)
    !cp -r {SRC}/{c}/images/* datasets/{c}/images/
    !cp {SRC}/{c}/captions.jsonl datasets/{c}/captions.jsonl
!ls datasets/lebanese/images | wc -l   # expect 19
```

```python
# 4 — SMOKE FIRST (200 steps, placeholder captions) — catches OOM / wiring in ~3-4 min
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \
    --rank 16 --steps 200 \
    --output-dir models/loras/lebanese/_smoke --smoke
```

```python
# 5 — REAL Lebanese LoRA (checkpoints + 5-image preview grid at 500 / 1000 / 1500)
!python scripts/train_lora.py \
    --culture lebanese \
    --data-dir datasets/lebanese \
    --rank 16 --steps 1500 \
    --output-dir models/loras/lebanese
```

Output: `models/loras/lebanese/dardesign-<culture>-lora.safetensors` (+ `samples-step*.png`).

---

## Step 3 — pick the checkpoint

Only **19 images** → watch for memorisation. Open `samples-step500/1000/1500.png` and pick the
grid that looks *visibly Lebanese* (qanater, cedar, encaustic tile) **without** copying a training
photo. If 1500 looks baked-in, keep the step-1000 `.safetensors`. Download it from the Kaggle
output, drop it in `models/loras/lebanese/`, and the backend lazy-loads it — no code change.

## Notes
- Khaleeji/Moroccan: same command with `--culture khaleeji|moroccan`. With 12–14 imgs, try
  `--steps 800` or `--rank 8` to curb overfit — or leave them prompt-only.
- OOM during training → lower `--rank` (e.g. 8). Never reach for an A100; the thesis is "free T4 only."
- Captions are filename-derived drafts. For richer per-image captions, run
  `python scripts/auto_caption.py --culture lebanese` on the T4 first (overwrites captions.jsonl),
  then re-run step 5.
