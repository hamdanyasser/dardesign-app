"""Generate the final batch — also the evaluation corpus.

Input: rooms (anywhere in `--rooms-dir`) x 3 styles
Output: <out>/<room_id>_<style>.png, or <out>/<style>/<room_id>_<style>.png
        with --by-culture
Settings: ControlNet weights from configs/sweep_winners.json (defaults if absent)

Writes RAW pipeline output only — never upscaled or post-processed, which is
what SSIM and LPIPS require. Existing files are skipped, so an interrupted run
resumes rather than regenerating.

Nothing here touches the database, the history table or any user data: it calls
transform_room directly, so evaluation images can never be mistaken for designs
someone made.

Usage (Kaggle T4):
    python scripts/generate_finals.py \\
        --rooms-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \\
        --out outputs/finals

Evaluation corpus into Drive (see eval/CORPUS.md):
    python scripts/generate_finals.py --rooms-dir <inputs> \\
        --out /content/drive/MyDrive/DarDesign/evaluation/finals --by-culture
    python scripts/generate_finals.py --rooms-dir <inputs> \\
        --out /content/drive/MyDrive/DarDesign/evaluation/baselines --no-lora
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)

CULTURES: list[str] = ["lebanese", "khaleeji", "moroccan"]
WINNERS_FILE = ROOT / "configs" / "sweep_winners.json"


def _load_winners() -> dict[str, tuple[float, float]]:
    if not WINNERS_FILE.exists():
        return {}
    try:
        raw = json.loads(WINNERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("could not read %s; falling back to defaults", WINNERS_FILE)
        return {}
    out: dict[str, tuple[float, float]] = {}
    for k, v in raw.items():
        if k.startswith("_"):
            continue
        if isinstance(v, list) and len(v) == 2:
            out[k] = (float(v[0]), float(v[1]))
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rooms-dir", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--cultures", nargs="*", default=CULTURES)
    p.add_argument(
        "--by-culture", action="store_true",
        help="write to <out>/<culture>/<room>_<culture>.png instead of one flat dir",
    )
    p.add_argument(
        "--no-lora", action="store_true",
        help="prompt-only generation — produces the baseline set the ablation compares against",
    )
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    from backend.transform import transform_room
    from scripts.eval_utils import list_room_images

    args.out.mkdir(parents=True, exist_ok=True)
    rooms = list_room_images(args.rooms_dir, limit=args.limit)
    if not rooms:
        raise SystemExit(f"no images found in {args.rooms_dir}")
    logger.info("generating %d rooms x %d cultures = %d outputs",
                len(rooms), len(args.cultures), len(rooms) * len(args.cultures))

    winners = _load_winners()
    default = winners.get("default", (0.7, 0.5))

    for room in rooms:
        for culture in args.cultures:
            # Either layout is fine for eval/run_metrics.py: it reads the culture
            # from the filename, and from the parent folder when nested.
            dest_dir = args.out / culture if args.by_culture else args.out
            dest_dir.mkdir(parents=True, exist_ok=True)
            out_path = dest_dir / f"{room.stem}_{culture}.png"
            if out_path.exists():
                logger.info("skip %s", out_path)
                continue
            cn_w = winners.get(culture, default)
            logger.info("gen %s -> %s (cn=%s, lora=%s)",
                        room.name, out_path.name, cn_w, not args.no_lora)
            produced = transform_room(
                room, culture, seed=args.seed,
                controlnet_weights=cn_w,
                use_lora=not args.no_lora,
            )
            if produced.resolve() != out_path.resolve():
                produced.replace(out_path)

    logger.info("done. outputs in %s", args.out)


if __name__ == "__main__":
    main()
