"""Build the baseline-comparison harness.

This DOES NOT call any baseline service — it can't, no API access. Instead it:
  1. Builds a single PNG `outputs/baselines/_input_grid.png` showing the 15 rooms
     so you can paste each room into Decor8 / RoomGPT manually.
  2. Creates `outputs/baselines/{decor8,roomgpt,ours}/` with one named slot per
     (room x culture). For Decor8/RoomGPT, drop the screenshots in with the
     same filename as the slot. For "ours", it copies the matching files from
     outputs/finals/ if they already exist.
  3. The MOMENT all slots are filled, run with --build-pdf and a side-by-side
     `comparison.pdf` is written to outputs/baselines/.

Naming: `<room_stem>_<culture>.png`

Usage:
    # 1. After running scripts/generate_finals.py:
    python scripts/baseline_grid.py --rooms-dir /kaggle/input/.../dardesign-test-rooms --out outputs/baselines
    # 2. Drop your Decor8 + RoomGPT screenshots into outputs/baselines/decor8 and outputs/baselines/roomgpt
    # 3. Build the comparison PDF:
    python scripts/baseline_grid.py --rooms-dir ... --out outputs/baselines --build-pdf
"""
from __future__ import annotations

import argparse
import logging
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)

CULTURES = ("lebanese", "khaleeji", "moroccan")
BASELINES = ("decor8", "roomgpt", "ours")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rooms-dir", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--finals-dir", type=Path, default=ROOT / "outputs" / "finals")
    p.add_argument("--build-pdf", action="store_true",
                   help="build comparison.pdf from filled slots")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    from PIL import Image, ImageDraw, ImageFont
    from scripts.eval_utils import list_room_images, make_contact_sheet, write_pdf

    rooms = list_room_images(args.rooms_dir, limit=args.limit)
    if not rooms:
        raise SystemExit(f"no images found in {args.rooms_dir}")

    # 1) input grid
    cells = [(Image.open(r), r.stem) for r in rooms]
    grid = make_contact_sheet(cells, cols=5, cell_size=(384, 384), title="Input rooms")
    grid_path = args.out / "_input_grid.png"
    args.out.mkdir(parents=True, exist_ok=True)
    grid.save(grid_path)
    logger.info("input grid -> %s", grid_path)

    # 2) per-baseline slot folders
    placeholder = Image.new("RGB", (768, 768), (30, 26, 18))
    draw = ImageDraw.Draw(placeholder)
    try:
        f = ImageFont.truetype("arial.ttf", 22)
    except Exception:
        f = ImageFont.load_default()
    draw.text((24, 24), "[ drop screenshot here ]", fill=(212, 175, 55), font=f)

    missing: list[str] = []
    for baseline in BASELINES:
        sub = args.out / baseline
        sub.mkdir(parents=True, exist_ok=True)
        for room in rooms:
            for culture in CULTURES:
                target = sub / f"{room.stem}_{culture}.png"
                if target.exists():
                    continue
                if baseline == "ours":
                    src = args.finals_dir / f"{room.stem}_{culture}.png"
                    if src.exists():
                        shutil.copy(src, target)
                        logger.info("ours <- %s", src)
                        continue
                placeholder.save(target)
                missing.append(str(target))

    if missing:
        logger.warning("%d slots still need a screenshot:\n  %s",
                       len(missing), "\n  ".join(missing[:10]) + ("..." if len(missing) > 10 else ""))

    # 3) optional: build a side-by-side PDF
    if args.build_pdf:
        if missing:
            logger.warning("PDF will include %d empty slots; fill them and re-run for the final.", len(missing))
        pages: list[Image.Image] = []
        pages.append(grid)
        for room in rooms:
            for culture in CULTURES:
                row_cells: list[tuple[Image.Image, str]] = []
                row_cells.append((Image.open(room), f"{room.stem} (input)"))
                for baseline in BASELINES:
                    p_img = args.out / baseline / f"{room.stem}_{culture}.png"
                    row_cells.append((Image.open(p_img), f"{baseline} / {culture}"))
                page = make_contact_sheet(
                    row_cells,
                    cols=4,
                    cell_size=(384, 384),
                    title=f"{room.stem} / {culture}",
                )
                pages.append(page)
        pdf_path = args.out / "comparison.pdf"
        write_pdf(pages, pdf_path)
        logger.info("comparison PDF -> %s", pdf_path)


if __name__ == "__main__":
    main()
