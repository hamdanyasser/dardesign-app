# ============================================================================
# DarDesign — Week 2 cell: 15 PROMPT-ONLY BASELINES + CONTROLNET WEIGHT SWEEP
# ----------------------------------------------------------------------------
# RUN AFTER your working pipeline cell (the one that's already live on T4).
# This cell expects these names to exist from that cell:
#     pipe       — StableDiffusionXLControlNetPipeline (depth + seg, fp16,
#                  enable_model_cpu_offload() already called)
#     get_depth  — fn(PIL.Image) -> depth control image (Depth Anything V2)
#     get_seg    — fn(PIL.Image) -> ADE20K color control image (OneFormer)
# If your names differ, edit the three ALIASES below — nothing else.
#
# Outputs:
#     /kaggle/working/outputs/baselines/{room}_{style}.png           (15 imgs)
#     /kaggle/working/outputs/sweep/d{D}_s{S}_{room}.png             (60 imgs)
#     /kaggle/working/outputs/sweep/sweep_results.csv
#     /kaggle/working/configs/sweep_winners.json
#     /kaggle/working/outputs/sweep/contact_sheet.jpg
# T4 time: baselines ~12 min + sweep ~50 min ≈ 1h. Seeds locked.
# ============================================================================
import gc, json, time, csv
from pathlib import Path

import torch
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

# ----------------------------- ALIASES (edit only if your names differ) -----
PIPE = pipe                  # noqa: F821  — from your pipeline cell
DEPTH_FN = get_depth         # noqa: F821
SEG_FN = get_seg             # noqa: F821

# ----------------------------- CONFIG ---------------------------------------
DATA = Path("/kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms")
ROOMS = sorted(DATA.glob("*.jpg"))[:5] or sorted(DATA.glob("*.png"))[:5]
assert len(ROOMS) == 5, f"Expected 5 eval rooms, found {len(ROOMS)} in {DATA}"

SEED = 1234
STEPS = 30
GUIDANCE = 7.0
SIZE = 1024

PROMPTS = {
    "lebanese": (
        "interior of a traditional Lebanese living room, qanater triple arches, "
        "carved cedar wood furniture, tripartite arched windows, warm sandstone "
        "walls, oriental rug, Levantine elegance, photorealistic, natural light"
    ),
    "khaleeji": (
        "interior of a luxurious Khaleeji majlis, floor seating with gold and "
        "cream cushions, ornate Arabic calligraphy panels, brass coffee pots, "
        "rich curtains, Gulf Arab opulence, photorealistic, warm lighting"
    ),
    "moroccan": (
        "interior of a Moroccan riad salon, zellige mosaic tilework, carved "
        "plaster arches, brass lanterns, low banquette seating, ornamental "
        "courtyard doors, Marrakesh style, photorealistic, golden hour light"
    ),
}
NEGATIVE = "blurry, lowres, distorted, watermark, text, deformed furniture, oversaturated"

BASE_W = {"depth": 0.8, "seg": 0.6}              # current defaults → baselines
SWEEP_DEPTH = [0.6, 0.8, 1.0, 1.2]
SWEEP_SEG = [0.4, 0.6, 0.8]
SWEEP_STYLE = "lebanese"                          # 12 combos × 5 rooms = 60

OUT = Path("/kaggle/working/outputs")
(OUT / "baselines").mkdir(parents=True, exist_ok=True)
(OUT / "sweep").mkdir(parents=True, exist_ok=True)
Path("/kaggle/working/configs").mkdir(parents=True, exist_ok=True)

# ----------------------------- HELPERS --------------------------------------
def load_room(p: Path) -> Image.Image:
    img = Image.open(p).convert("RGB")
    return img.resize((SIZE, SIZE), Image.LANCZOS)

def generate(room_img, prompt, w_depth, w_seg, seed=SEED):
    ctrl = [DEPTH_FN(room_img), SEG_FN(room_img)]
    g = torch.Generator(device="cuda").manual_seed(seed)
    with torch.inference_mode():
        out = PIPE(
            prompt=prompt,
            negative_prompt=NEGATIVE,
            image=ctrl,
            controlnet_conditioning_scale=[float(w_depth), float(w_seg)],
            num_inference_steps=STEPS,
            guidance_scale=GUIDANCE,
            generator=g,
        ).images[0]
    return out

def gray64(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L").resize((256, 256)), dtype=np.float32) / 255.0

def structure_ssim(a: Image.Image, b: Image.Image) -> float:
    return float(ssim(gray64(a), gray64(b), data_range=1.0))

def cleanup():
    gc.collect(); torch.cuda.empty_cache()

# ----------------------------- 1) 15 BASELINES (5 rooms × 3 styles) ---------
print("== Baselines: 5 rooms × 3 styles, depth=%.1f seg=%.1f ==" % (BASE_W["depth"], BASE_W["seg"]))
t0 = time.time()
for room_path in ROOMS:
    room = load_room(room_path)
    for style, prompt in PROMPTS.items():
        fp = OUT / "baselines" / f"{room_path.stem}_{style}.png"
        if fp.exists():
            print("  skip", fp.name); continue
        img = generate(room, prompt, BASE_W["depth"], BASE_W["seg"])
        img.save(fp)
        print(f"  ✓ {fp.name}  SSIM={structure_ssim(room, img):.3f}")
        cleanup()
print(f"Baselines done in {(time.time()-t0)/60:.1f} min\n")

# ----------------------------- 2) SWEEP (12 combos × 5 rooms = 60) ----------
print("== Sweep: depth × seg on style '%s' ==" % SWEEP_STYLE)
rows = []
t0 = time.time()
for wd in SWEEP_DEPTH:
    for ws in SWEEP_SEG:
        for room_path in ROOMS:
            room = load_room(room_path)
            fp = OUT / "sweep" / f"d{wd}_s{ws}_{room_path.stem}.png"
            if not fp.exists():
                generate(room, PROMPTS[SWEEP_STYLE], wd, ws).save(fp)
                cleanup()
            s = structure_ssim(room, Image.open(fp))
            rows.append({"depth": wd, "seg": ws, "room": room_path.stem, "ssim": round(s, 4)})
            print(f"  d={wd} s={ws} {room_path.stem}  SSIM={s:.3f}")
print(f"Sweep done in {(time.time()-t0)/60:.1f} min")

with open(OUT / "sweep" / "sweep_results.csv", "w", newline="") as f:
    wcsv = csv.DictWriter(f, fieldnames=["depth", "seg", "room", "ssim"])
    wcsv.writeheader(); wcsv.writerows(rows)

# ----------------------------- 3) RANK + WINNER ------------------------------
# Sweet spot: structure preserved but room visibly restyled.
# Empirically SSIM ≈ 0.55–0.75 vs input is the band; rank by closeness to 0.65.
TARGET = 0.65
combo_stats = {}
for r in rows:
    combo_stats.setdefault((r["depth"], r["seg"]), []).append(r["ssim"])

ranked = sorted(
    ((d, s, float(np.mean(v)), float(np.std(v))) for (d, s), v in combo_stats.items()),
    key=lambda x: abs(x[2] - TARGET),
)
print("\nTop 5 combos (mean SSIM closest to %.2f — EYEBALL BEFORE TRUSTING):" % TARGET)
for d, s, m, sd in ranked[:5]:
    print(f"  depth={d} seg={s}  meanSSIM={m:.3f} ±{sd:.3f}")

winner = {"depth": ranked[0][0], "seg": ranked[0][1],
          "mean_ssim": round(ranked[0][2], 4),
          "criterion": f"|meanSSIM-{TARGET}| min — confirm by eye",
          "seed": SEED, "steps": STEPS, "guidance": GUIDANCE}
with open("/kaggle/working/configs/sweep_winners.json", "w") as f:
    json.dump(winner, f, indent=2)
print("→ configs/sweep_winners.json:", winner)

# ----------------------------- 4) CONTACT SHEET ------------------------------
thumb = 256
sheet = Image.new("RGB", (thumb * len(SWEEP_SEG), thumb * len(SWEEP_DEPTH)), "white")
sample_room = ROOMS[0].stem
for yi, wd in enumerate(SWEEP_DEPTH):
    for xi, ws in enumerate(SWEEP_SEG):
        p = OUT / "sweep" / f"d{wd}_s{ws}_{sample_room}.png"
        if p.exists():
            sheet.paste(Image.open(p).resize((thumb, thumb)), (xi * thumb, yi * thumb))
sheet.save(OUT / "sweep" / "contact_sheet.jpg", quality=88)
print("Contact sheet saved — rows=depth", SWEEP_DEPTH, "cols=seg", SWEEP_SEG)
print("\nDONE. Commit outputs/ + configs/sweep_winners.json, then eyeball-confirm the winner.")
