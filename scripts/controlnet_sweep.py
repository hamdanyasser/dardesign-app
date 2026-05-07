"""ControlNet weight sweep.

For each test room, generates outputs across:
  - 4 weight pairs (depth, seg): (0.5,0.5) (0.7,0.3) (1.0,0.5) (0.5,1.0)
  - 3 cultures: lebanese, khaleeji, moroccan

Output: outputs/sweeps/<room_id>_contact.png (one contact sheet per room, 4 cols x 3 rows)
        outputs/sweeps/raw/<room_id>_<culture>_d<dw>_s<sw>.png (every individual image)

Pick winners by eye, then drop the chosen (depth, seg) pair into configs/sweep_winners.json.

Usage (Kaggle T4):
    python scripts/controlnet_sweep.py \\
        --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \\
        --out outputs/sweeps
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

WEIGHT_PAIRS: list[tuple[float, float]] = [
    (0.5, 0.5),
    (0.7, 0.3),
    (1.0, 0.5),
    (0.5, 1.0),
]
CULTURES: list[str] = ["lebanese", "khaleeji", "moroccan"]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rooms-dir", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--limit", type=int, default=5, help="cap on rooms (default 5 = the test set)")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    from backend.transform import transform_room
    from PIL import Image
    from scripts.eval_utils import list_room_images, make_contact_sheet

    rooms = list_room_images(args.rooms_dir, limit=args.limit)
    if not rooms:
        raise SystemExit(f"no images found in {args.rooms_dir}")

    raw_dir = args.out / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    for room in rooms:
        room_id = room.stem
        cells: list[tuple[Image.Image, str]] = []
        for culture in CULTURES:
            for (dw, sw) in WEIGHT_PAIRS:
                out_path = raw_dir / f"{room_id}_{culture}_d{dw}_s{sw}.png"
                if out_path.exists():
                    logger.info("skip existing %s", out_path)
                    img = Image.open(out_path)
                else:
                    logger.info("gen %s | %s | depth=%.2f seg=%.2f", room_id, culture, dw, sw)
                    produced = transform_room(
                        room, culture, seed=args.seed,
                        controlnet_weights=(dw, sw),
                    )
                    # Move to canonical name
                    if produced.resolve() != out_path.resolve():
                        produced.replace(out_path)
                    img = Image.open(out_path)
                cells.append((img, f"{culture} d={dw} s={sw}"))

        sheet = make_contact_sheet(
            cells,
            cols=len(WEIGHT_PAIRS),
            cell_size=(384, 384),
            title=f"{room_id} — ControlNet sweep (rows: {', '.join(CULTURES)})",
        )
        out_sheet = args.out / f"{room_id}_contact.png"
        sheet.save(out_sheet)
        logger.info("wrote contact %s", out_sheet)


if __name__ == "__main__":
    main()
