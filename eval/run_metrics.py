#!/usr/bin/env python3
"""
DarDesign — evaluation suite (Zainab's flagship + Yasser's Sat metrics row).

Computes, for every generated image:
    SSIM        — structure preservation vs the input room (skimage)
    LPIPS       — perceptual distance vs input (lpips, AlexNet)
    CLIP score  — adherence to the intended style prompt (open_clip)
    Cultural classification — CLIP zero-shot 3-way {lebanese, khaleeji,
                  moroccan}; produces the Cultural Confusion Matrix.

Outputs (under --out, default eval/):
    results.csv            one row per image, all metrics
    summary.md             headline numbers, LoRA vs baseline if both given
    confusion_matrix.png   the thesis chart
    metrics_bars.png       per-style SSIM/LPIPS/CLIP bars

File naming convention (already used by the sweep cell):
    {room}_{style}.png   e.g. room3_khaleeji.png

Kaggle setup (torch is preinstalled):
    pip install -q lpips open_clip_torch

Run:
    python eval/run_metrics.py --inputs data/eval_rooms \
        --outputs outputs/finals --baselines outputs/baselines --out eval/

IMPORTANT: run on RAW pipeline outputs only — never on upscaled images.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

STYLES = ["lebanese", "khaleeji", "moroccan"]

CLASS_PROMPTS = {
    "lebanese": "a traditional Lebanese living room interior with qanater arches and cedar wood",
    "khaleeji": "a Khaleeji Gulf Arab majlis interior with floor cushions and gold accents",
    "moroccan": "a Moroccan riad interior with zellige mosaic tiles and brass lanterns",
}

# ----------------------------------------------------------------- utilities
def gray(img: Image.Image, size: int = 256) -> np.ndarray:
    return np.asarray(img.convert("L").resize((size, size)), dtype=np.float32) / 255.0


def parse_name(p: Path) -> tuple[str, str] | None:
    """{room}_{style}.png -> (room, style); style must be known."""
    stem = p.stem
    for s in STYLES:
        if stem.endswith("_" + s):
            return stem[: -(len(s) + 1)], s
    return None


def find_input(inputs_dir: Path, room: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = inputs_dir / f"{room}{ext}"
        if cand.exists():
            return cand
    return None


# ----------------------------------------------------------- heavy ML (lazy)
def load_lpips():
    try:
        import lpips, torch  # noqa
    except ImportError:
        raise SystemExit("Missing dep: pip install -q lpips")
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    net = lpips.LPIPS(net="alex").to(dev).eval()

    def to_t(img: Image.Image):
        a = np.asarray(img.convert("RGB").resize((256, 256)), dtype=np.float32)
        a = a / 127.5 - 1.0
        return torch.from_numpy(a).permute(2, 0, 1).unsqueeze(0).to(dev)

    def fn(a: Image.Image, b: Image.Image) -> float:
        with torch.no_grad():
            return float(net(to_t(a), to_t(b)).item())
    return fn


def load_clip():
    try:
        import open_clip, torch  # noqa
    except ImportError:
        raise SystemExit("Missing dep: pip install -q open_clip_torch")
    import open_clip
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k", device=dev
    )
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model.eval()

    with torch.no_grad():
        text = tokenizer([CLASS_PROMPTS[s] for s in STYLES]).to(dev)
        text_feat = model.encode_text(text)
        text_feat /= text_feat.norm(dim=-1, keepdim=True)

    def fn(img: Image.Image) -> tuple[dict[str, float], str]:
        with torch.no_grad():
            im = preprocess(img.convert("RGB")).unsqueeze(0).to(dev)
            f = model.encode_image(im)
            f /= f.norm(dim=-1, keepdim=True)
            sims = (f @ text_feat.T).squeeze(0).float().cpu().numpy()
        scores = {s: float(sims[i]) for i, s in enumerate(STYLES)}
        return scores, STYLES[int(np.argmax(sims))]
    return fn


# ------------------------------------------------------------------ pipeline
def evaluate_dir(tag: str, gen_dir: Path, inputs_dir: Path, lpips_fn, clip_fn):
    rows = []
    files = sorted(p for p in gen_dir.iterdir()
                   if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
    for p in files:
        parsed = parse_name(p)
        if parsed is None:
            print(f"  ! skip (name not room_style): {p.name}")
            continue
        room, style = parsed
        src = find_input(inputs_dir, room)
        if src is None:
            print(f"  ! skip (no input for room '{room}'): {p.name}")
            continue

        inp, out = Image.open(src), Image.open(p)
        s = float(ssim(gray(inp), gray(out), data_range=1.0))
        lp = lpips_fn(inp, out)
        clip_scores, predicted = clip_fn(out)
        rows.append({
            "set": tag, "file": p.name, "room": room, "style": style,
            "ssim": round(s, 4), "lpips": round(lp, 4),
            "clip_score": round(clip_scores[style], 4),
            "predicted": predicted,
            "correct": int(predicted == style),
            **{f"clip_{k}": round(v, 4) for k, v in clip_scores.items()},
        })
        print(f"  {tag} {p.name}: SSIM={s:.3f} LPIPS={lp:.3f} "
              f"CLIP={clip_scores[style]:.3f} → {predicted}")
    return rows


def confusion(rows) -> np.ndarray:
    m = np.zeros((len(STYLES), len(STYLES)), dtype=int)
    for r in rows:
        m[STYLES.index(r["style"]), STYLES.index(r["predicted"])] += 1
    return m


def plot_all(rows_main, rows_base, out_dir: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # --- confusion matrix (the thesis chart) ---
    sets = [("DarDesign (LoRA)", rows_main)] + (
        [("Prompt-only baseline", rows_base)] if rows_base else []
    )
    fig, axes = plt.subplots(1, len(sets), figsize=(5.6 * len(sets), 5), squeeze=False)
    for ax, (title, rows) in zip(axes[0], sets):
        m = confusion(rows)
        acc = m.trace() / max(m.sum(), 1)
        im = ax.imshow(m, cmap="YlOrBr", vmin=0)
        ax.set_xticks(range(3), [s.title() for s in STYLES])
        ax.set_yticks(range(3), [s.title() for s in STYLES])
        ax.set_xlabel("CLIP predicted"); ax.set_ylabel("Intended style")
        ax.set_title(f"{title}\n3-way accuracy = {acc:.0%}")
        for i in range(3):
            for j in range(3):
                ax.text(j, i, m[i, j], ha="center", va="center",
                        color="black", fontsize=14, fontweight="bold")
    fig.suptitle("Cultural Confusion Matrix — does the image read as its culture?")
    fig.tight_layout()
    fig.savefig(out_dir / "confusion_matrix.png", dpi=200)
    plt.close(fig)

    # --- per-style metric bars ---
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.2))
    for ax, metric, better in zip(
        axes, ["ssim", "lpips", "clip_score"], ["↑ structure", "↓ percep. dist", "↑ style"]
    ):
        x = np.arange(len(STYLES)); width = 0.38
        main_m = [np.mean([r[metric] for r in rows_main if r["style"] == s] or [0])
                  for s in STYLES]
        ax.bar(x - (width / 2 if rows_base else 0), main_m, width, label="LoRA")
        if rows_base:
            base_m = [np.mean([r[metric] for r in rows_base if r["style"] == s] or [0])
                      for s in STYLES]
            ax.bar(x + width / 2, base_m, width, label="Baseline")
        ax.set_xticks(x, [s.title() for s in STYLES])
        ax.set_title(f"{metric.upper()} ({better})")
        ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / "metrics_bars.png", dpi=200)
    plt.close(fig)


def write_outputs(rows_main, rows_base, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    all_rows = rows_main + rows_base
    with open(out_dir / "results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader(); w.writerows(all_rows)

    def block(tag, rows):
        if not rows:
            return ""
        m = confusion(rows)
        acc = m.trace() / max(m.sum(), 1)
        return (
            f"## {tag}  (n={len(rows)})\n"
            f"- 3-way cultural accuracy: **{acc:.0%}**\n"
            f"- mean SSIM: **{np.mean([r['ssim'] for r in rows]):.3f}**, "
            f"mean LPIPS: **{np.mean([r['lpips'] for r in rows]):.3f}**, "
            f"mean CLIP: **{np.mean([r['clip_score'] for r in rows]):.3f}**\n\n"
        )

    with open(out_dir / "summary.md", "w") as f:
        f.write("# DarDesign evaluation summary\n\n")
        f.write(block("DarDesign (LoRA)", rows_main))
        f.write(block("Prompt-only baseline", rows_base))
        f.write("Charts: confusion_matrix.png · metrics_bars.png\n")

    plot_all(rows_main, rows_base, out_dir)
    print(f"\n→ {out_dir}/results.csv, summary.md, confusion_matrix.png, metrics_bars.png")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--inputs", required=True, help="dir of original eval rooms")
    ap.add_argument("--outputs", required=True, help="dir of generated images (LoRA)")
    ap.add_argument("--baselines", default=None, help="dir of prompt-only baselines")
    ap.add_argument("--out", default="eval", help="output dir")
    args = ap.parse_args()

    lpips_fn, clip_fn = load_lpips(), load_clip()
    print("== evaluating LoRA outputs ==")
    rows_main = evaluate_dir("lora", Path(args.outputs), Path(args.inputs), lpips_fn, clip_fn)
    rows_base = []
    if args.baselines:
        print("== evaluating prompt-only baselines ==")
        rows_base = evaluate_dir("baseline", Path(args.baselines), Path(args.inputs),
                                 lpips_fn, clip_fn)
    if not rows_main and not rows_base:
        raise SystemExit("No images evaluated — check dirs and naming {room}_{style}.png")
    write_outputs(rows_main, rows_base, Path(args.out))


if __name__ == "__main__":
    main()
