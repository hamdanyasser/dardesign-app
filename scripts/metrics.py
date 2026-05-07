"""Compute SSIM (structure preservation) and LPIPS (perceptual similarity)
between every (input room, generated output) pair, and write a CSV.

Metrics:
- SSIM: high = structure preserved (we want this; we should NOT regenerate the room)
- LPIPS: low = perceptually similar to input. Note that for a stylization task,
  the IDEAL value is moderate, not minimal — we WANT the style to change while
  the layout stays. Treat these as descriptive, not as a leaderboard.

LPIPS uses torchmetrics. Falls back gracefully if it can't be loaded (logs a
warning and writes only SSIM).

Output (CSV):
    room_id,style,ssim,lpips
    room_01,lebanese,0.4321,0.2511
    ...

Usage:
    python scripts/metrics.py \\
        --finals outputs/finals \\
        --rooms-dir /kaggle/input/.../dardesign-test-rooms \\
        --out eval/results.csv
"""
from __future__ import annotations

import argparse
import csv
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)

CULTURES = ("lebanese", "khaleeji", "moroccan")


def _ssim(input_path: Path, output_path: Path) -> float:
    import numpy as np
    from PIL import Image
    from skimage.metrics import structural_similarity as ssim

    a = np.asarray(Image.open(input_path).convert("L").resize((512, 512)), dtype=np.float64)
    b = np.asarray(Image.open(output_path).convert("L").resize((512, 512)), dtype=np.float64)
    return float(ssim(a, b, data_range=255))


def _make_lpips_fn():
    """Return a callable (input_path, output_path) -> float, or None if LPIPS not available."""
    try:
        import torch
        from torchmetrics.image.lpip import LearnedPerceptualImagePatchSimilarity
    except Exception:
        logger.warning("torchmetrics LPIPS not available; SSIM-only run")
        return None

    device = "cuda" if torch.cuda.is_available() else "cpu"
    metric = LearnedPerceptualImagePatchSimilarity(net_type="alex", normalize=True).to(device)
    metric.eval()

    from PIL import Image
    import numpy as np

    def to_tensor(p: Path) -> "torch.Tensor":
        arr = np.asarray(Image.open(p).convert("RGB").resize((512, 512)), dtype=np.float32) / 255.0
        return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)

    @torch.no_grad()
    def compute(in_path: Path, out_path: Path) -> float:
        a = to_tensor(in_path)
        b = to_tensor(out_path)
        return float(metric(a, b).item())

    return compute


def _resolve_input(rooms_dir: Path, room_id: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        p = rooms_dir / f"{room_id}{ext}"
        if p.exists():
            return p
    return None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--finals", required=True, type=Path)
    p.add_argument("--rooms-dir", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    finals = sorted(args.finals.glob("*.png"))
    if not finals:
        raise SystemExit(f"no PNGs found in {args.finals}")

    lpips_fn = _make_lpips_fn()

    rows: list[dict[str, str | float]] = []
    for f in finals:
        # filename schema: <room_id>_<style>.png
        stem = f.stem
        style = next((c for c in CULTURES if stem.endswith(f"_{c}")), None)
        if style is None:
            logger.warning("skipping %s — filename does not end with a known style", f.name)
            continue
        room_id = stem[: -(len(style) + 1)]
        in_p = _resolve_input(args.rooms_dir, room_id)
        if in_p is None:
            logger.warning("input not found for %s (looked in %s)", room_id, args.rooms_dir)
            continue

        try:
            s = _ssim(in_p, f)
        except Exception:
            logger.exception("ssim failed for %s", f)
            continue

        l_val: float | str = ""
        if lpips_fn is not None:
            try:
                l_val = lpips_fn(in_p, f)
            except Exception:
                logger.exception("lpips failed for %s", f)

        rows.append({
            "room_id": room_id,
            "style": style,
            "ssim": round(s, 4),
            "lpips": round(l_val, 4) if isinstance(l_val, float) else "",
        })
        logger.info("%-12s %-9s ssim=%.4f lpips=%s", room_id, style, s, l_val)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["room_id", "style", "ssim", "lpips"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    logger.info("wrote %d rows -> %s", len(rows), args.out)


if __name__ == "__main__":
    main()
