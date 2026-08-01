from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _iter_images(root: Path):
    for class_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        label = class_dir.name
        image_dir = class_dir / "images"
        if image_dir.is_dir():
            search_dir = image_dir
        else:
            search_dir = class_dir
        for p in sorted(search_dir.rglob("*")):
            if p.is_file() and p.suffix.lower() in VALID_EXTS:
                yield p, label


def _safe_aug(im: Image.Image, rng: random.Random) -> tuple[Image.Image, dict]:
    out = im.convert("RGB")

    meta = {
        "rotation_deg": 0.0,
        "brightness": 1.0,
        "contrast": 1.0,
        "saturation": 1.0,
        "blur": False,
        "flip": False,
    }

    # Keep geometry stable: tiny rotation only.
    rot = rng.uniform(-4.0, 4.0)
    out = out.rotate(rot, resample=Image.Resampling.BICUBIC, fillcolor=(0, 0, 0))
    meta["rotation_deg"] = round(rot, 3)

    # Mild photometric jitter only.
    b = rng.uniform(0.94, 1.08)
    c = rng.uniform(0.94, 1.08)
    s = rng.uniform(0.95, 1.06)
    out = ImageEnhance.Brightness(out).enhance(b)
    out = ImageEnhance.Contrast(out).enhance(c)
    out = ImageEnhance.Color(out).enhance(s)
    meta["brightness"] = round(b, 3)
    meta["contrast"] = round(c, 3)
    meta["saturation"] = round(s, 3)

    # Optional light blur with low probability.
    if rng.random() < 0.08:
        out = out.filter(ImageFilter.GaussianBlur(radius=0.45))
        meta["blur"] = True

    # Keep horizontal flip disabled by default for cultural/semantic symmetry safety.
    return out, meta


def build_augmented_dataset(
    source_root: Path,
    output_root: Path,
    seed: int,
    copies_per_image: int,
) -> dict:
    rng = random.Random(seed)
    output_root.mkdir(parents=True, exist_ok=True)
    log_path = output_root / "augmentation_manifest.csv"

    rows: list[dict] = []
    base_count = 0
    aug_count = 0

    with open(log_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "source",
                "label",
                "output",
                "kind",
                "rotation_deg",
                "brightness",
                "contrast",
                "saturation",
                "blur",
                "flip",
            ],
        )
        writer.writeheader()

        for src, label in _iter_images(source_root):
            base_count += 1
            with Image.open(src) as im:
                rgb = im.convert("RGB")

            class_dir = output_root / label
            class_dir.mkdir(parents=True, exist_ok=True)

            base_out = class_dir / f"{src.stem}_base.jpg"
            rgb.save(base_out, format="JPEG", quality=95)
            writer.writerow(
                {
                    "source": str(src),
                    "label": label,
                    "output": str(base_out),
                    "kind": "base",
                    "rotation_deg": 0.0,
                    "brightness": 1.0,
                    "contrast": 1.0,
                    "saturation": 1.0,
                    "blur": False,
                    "flip": False,
                }
            )

            for i in range(copies_per_image):
                aug, meta = _safe_aug(rgb, rng)
                out_path = class_dir / f"{src.stem}_aug{i+1}.jpg"
                aug.save(out_path, format="JPEG", quality=95)
                aug_count += 1
                writer.writerow(
                    {
                        "source": str(src),
                        "label": label,
                        "output": str(out_path),
                        "kind": "aug",
                        **meta,
                    }
                )

    return {
        "source_root": str(source_root),
        "output_root": str(output_root),
        "base_images": base_count,
        "augmented_images": aug_count,
        "total_images": base_count + aug_count,
        "copies_per_image": copies_per_image,
        "manifest": str(log_path),
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Careful augmentation for interior room datasets")
    p.add_argument("--source-root", type=Path, default=Path("datasets"))
    p.add_argument("--output-root", type=Path, default=Path("data/processed/classification/augmented"))
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--copies-per-image", type=int, default=2)
    args = p.parse_args()

    summary = build_augmented_dataset(
        source_root=args.source_root,
        output_root=args.output_root,
        seed=args.seed,
        copies_per_image=args.copies_per_image,
    )
    print(summary)


if __name__ == "__main__":
    main()
