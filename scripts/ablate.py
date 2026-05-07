"""Ablation harness.

For each of {full pipeline, --no-lora, --no-segmentation, --no-ontology},
generate 5 rooms x 3 styles = 15 images, plus a per-ablation contact sheet
versus the full pipeline.

Output: outputs/ablations/<ablation>/<room_id>_<style>.png
        outputs/ablations/contact_<ablation>.png

The --no-lora case is fully runnable today (no LoRA file required for the
prompt-only fallback path).

Usage (Kaggle T4):
    python scripts/ablate.py \\
        --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \\
        --out outputs/ablations
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)

ABLATIONS = ("full", "no_lora", "no_segmentation", "no_ontology")
CULTURES = ("lebanese", "khaleeji", "moroccan")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rooms-dir", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--ablations", nargs="*", default=list(ABLATIONS),
                   choices=list(ABLATIONS))
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    from backend.transform import transform_room
    from PIL import Image
    from scripts.eval_utils import list_room_images, make_contact_sheet

    rooms = list_room_images(args.rooms_dir, limit=args.limit)
    if not rooms:
        raise SystemExit(f"no images found in {args.rooms_dir}")

    flag_map = {
        "full": dict(use_lora=True, use_segmentation=True, use_ontology=True),
        "no_lora": dict(use_lora=False, use_segmentation=True, use_ontology=True),
        "no_segmentation": dict(use_lora=True, use_segmentation=False, use_ontology=True),
        "no_ontology": dict(use_lora=True, use_segmentation=True, use_ontology=False),
    }

    paths: dict[str, dict[tuple[str, str], Path]] = {a: {} for a in args.ablations}

    for ablation in args.ablations:
        out_dir = args.out / ablation
        out_dir.mkdir(parents=True, exist_ok=True)
        flags = flag_map[ablation]
        for room in rooms:
            for culture in CULTURES:
                target = out_dir / f"{room.stem}_{culture}.png"
                if target.exists():
                    paths[ablation][(room.stem, culture)] = target
                    continue
                logger.info("ablate=%s | %s | %s", ablation, room.name, culture)
                produced = transform_room(room, culture, seed=args.seed, **flags)
                if produced.resolve() != target.resolve():
                    produced.replace(target)
                paths[ablation][(room.stem, culture)] = target

    # Contact sheet per ablation, side-by-side with the full pipeline
    if "full" not in args.ablations:
        logger.info("no 'full' baseline in this run; skipping contact sheets")
        return

    for ablation in args.ablations:
        if ablation == "full":
            continue
        cells: list[tuple[Image.Image, str]] = []
        for room in rooms:
            for culture in CULTURES:
                full_p = paths["full"].get((room.stem, culture))
                ab_p = paths[ablation].get((room.stem, culture))
                if not full_p or not ab_p:
                    continue
                cells.append((Image.open(full_p), f"FULL {room.stem} {culture}"))
                cells.append((Image.open(ab_p), f"{ablation} {room.stem} {culture}"))
        sheet = make_contact_sheet(
            cells,
            cols=2,
            cell_size=(384, 384),
            title=f"FULL  vs  {ablation}",
        )
        out_sheet = args.out / f"contact_{ablation}.png"
        sheet.save(out_sheet)
        logger.info("contact %s -> %s", ablation, out_sheet)


if __name__ == "__main__":
    main()
