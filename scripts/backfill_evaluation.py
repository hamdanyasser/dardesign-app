"""Measure LPIPS and CLIP for saved designs that don't have them yet.

New designs are measured automatically when they are saved. This is for the ones
that already existed — and for any that were saved while `lpips`/`open_clip`
weren't installed, which leaves the values null rather than failing the save.

Only unedited designs are eligible: colour control and furniture placement change
the render after generation, so measuring one would score the edit rather than
the pipeline. Re-running is safe — rows that already have values are skipped.

Setup (once):
    pip install lpips open_clip_torch

Usage:
    python scripts/backfill_evaluation.py                 # measure what's missing
    python scripts/backfill_evaluation.py --dry-run       # list, change nothing
    python scripts/backfill_evaluation.py --db path.db    # a database elsewhere

CPU is fine — a few seconds per design, plus a one-off ~350 MB model download.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("backfill")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=None,
                   help="SQLite file (default: $DARDESIGN_DB or backend/dardesign.db)")
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    if args.db:
        os.environ["DARDESIGN_DB"] = str(args.db)

    from backend import db
    from backend.quality import clip_cultures, lpips_paths, metrics_available, ssim_paths

    db_path = args.db or Path(os.environ.get("DARDESIGN_DB") or ROOT / "backend" / "dardesign.db")
    db.close()
    db.DB_PATH = Path(db_path)
    db.connect(Path(db_path))

    pending = db.history_needing_evaluation(limit=args.limit)
    if not pending:
        logger.info("nothing to do — every unedited design already has metrics")
        return

    logger.info("%d design(s) to measure in %s", len(pending), db_path)
    if args.dry_run:
        for r in pending:
            logger.info("  would measure #%s (%s)", r["id"], r["culture"] or "unknown culture")
        return

    if not metrics_available():
        raise SystemExit(
            "lpips and open_clip are not installed.\n"
            "    pip install lpips open_clip_torch"
        )

    measured = skipped = 0
    for r in pending:
        original, generated = ROOT / r["oldImageUrl"], ROOT / r["newImageUrl"]
        # An image can go missing: the 24h sweeper, or a manual tidy-up. Skip it
        # rather than writing nulls over the row.
        if not original.is_file() or not generated.is_file():
            logger.warning("  #%s: image missing on disk — skipped", r["id"])
            skipped += 1
            continue

        scores = clip_cultures(str(generated))
        culture = r["culture"]
        db.set_history_evaluation(
            r["id"],
            lpips=lpips_paths(str(original), str(generated)),
            clip_score=scores[0].get(culture) if (scores and culture) else None,
            predicted_culture=scores[1] if scores else None,
            # Only for rows that never got one. The SSIM measured at generation
            # compares the uploaded file with the render; recomputing here uses
            # the re-encoded copy stored with the design, which is close but not
            # identical — so a value recorded at generation time is left alone.
            ssim=None if r.get("ssim") is not None else ssim_paths(str(original), str(generated)),
        )
        measured += 1
        logger.info("  #%s measured (intended=%s, predicted=%s)",
                    r["id"], culture, scores[1] if scores else "n/a")

    logger.info("done: %d measured, %d skipped", measured, skipped)
    db.close()


if __name__ == "__main__":
    main()
