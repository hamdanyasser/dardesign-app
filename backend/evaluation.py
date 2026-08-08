"""Evaluation dashboard — the numbers, with no FastAPI in sight.

Everything comes out of SQLite, which is what makes the dashboard durable: the
rendering backend is disposable — on Colab it is wiped every session — so any
figure that lived only there could not be shown a week later.

  * **Human ratings** are aggregated by the functions db.py already has.
  * **Generation statistics** are the history table: one saved design is one
    generated room, and its Duration is the time that render took.

Nothing here fabricates a number. Where a figure cannot be computed from stored
data the result is None and the caller says so, rather than showing a zero that
reads like a measurement.

GPU NOT NEEDED.
"""
from __future__ import annotations

import csv
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

# Where eval/run_metrics.py (or scripts/metrics.py) writes its per-image CSV.
# Overridable so a marker can point the dashboard at a results file computed
# elsewhere — e.g. on the Kaggle box that had the GPU.
EVAL_CSV = Path(os.environ.get("DARDESIGN_EVAL_CSV") or ROOT / "eval" / "results.csv")

# Columns run_metrics.py / metrics.py may emit. Anything numeric outside this
# list is ignored rather than guessed at.
_METRIC_COLUMNS = ("ssim", "lpips", "clip", "clip_score")


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def generation_report(since: float | None = None, until: float | None = None) -> dict:
    """Generation statistics, over the history table.

    History is the durable record of a generated room: the rendering backend is
    disposable — on Colab it is wiped every session — so its own logs cannot
    answer "how many rooms, and how long did they take?" a week later.

    Rooms is the row count. The average divides the sum of durations by the rows
    that *have* one; rows saved before Duration existed are null, and counting
    them in the denominator would report an average well below any real
    generation. `sampleSize` states how many rows backed the figure.
    """
    from . import db

    return db.history_generation_stats(since, until)


def overall_rating(stats: dict) -> float | None:
    """A single "overall" score, as the mean of the three rated dimensions.

    There is no Overall column in the feedback table — the form asks for
    cultural accuracy, image quality and room preservation. This composes them
    rather than inventing a fourth measurement, and the dashboard labels it as
    derived so nobody reads it as something the user typed.
    """
    parts = [
        stats.get("averageCulturalAccuracy"),
        stats.get("averageImageQuality"),
        stats.get("averageRoomPreservation"),
    ]
    present = [float(p) for p in parts if p is not None]
    return _mean(present)


def automatic_metrics(path: Path | None = None) -> dict:
    """Per-culture SSIM / LPIPS / CLIP, if the evaluation suite has been run.

    `eval/run_metrics.py` and `scripts/metrics.py` both write one row per
    generated image. Neither is run here: they need the generated corpus and, for
    LPIPS/CLIP, model weights. The dashboard only *reads* what they produced.

    Returns available=False with a reason when there is no results file — the
    numbers this section would otherwise show are precisely the ones that must
    never be guessed.
    """
    csv_path = Path(path or EVAL_CSV)
    if not csv_path.is_file():
        return {
            "available": False,
            "reason_en": "Automatic metrics have not been computed yet.",
            "reason_ar": "لم يتم حساب المقاييس الآلية بعد.",
            "hint": f"Run eval/run_metrics.py to produce {csv_path.name}.",
            "path": str(csv_path),
            "byCulture": [],
            "metrics": [],
        }

    try:
        with csv_path.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
    except Exception as e:  # noqa: BLE001 — a broken CSV must not 500 the page
        logger.exception("could not read evaluation CSV %s", csv_path)
        return {
            "available": False,
            "reason_en": f"Could not read {csv_path.name}: {e}",
            "reason_ar": "تعذّرت قراءة ملف نتائج التقييم.",
            "path": str(csv_path),
            "byCulture": [],
            "metrics": [],
        }

    if not rows:
        return {
            "available": False,
            "reason_en": f"{csv_path.name} is empty.",
            "reason_ar": "ملف نتائج التقييم فارغ.",
            "path": str(csv_path),
            "byCulture": [],
            "metrics": [],
        }

    # Which metric columns this particular run actually produced — an SSIM-only
    # run (no torchmetrics) is a legitimate result, not a broken file.
    present = [
        c for c in _METRIC_COLUMNS
        if any((r.get(c) or "").strip() for r in rows)
    ]

    buckets: dict[str, dict[str, list[float]]] = {}
    for r in rows:
        style = (r.get("style") or r.get("culture") or "unknown").strip().lower()
        bucket = buckets.setdefault(style, {})
        for col in present:
            raw = (r.get(col) or "").strip()
            if not raw:
                continue
            try:
                bucket.setdefault(col, []).append(float(raw))
            except ValueError:
                continue  # a stray header or 'nan' row must not break the page

    by_culture = [
        {
            "culture": style,
            "samples": max((len(v) for v in cols.values()), default=0),
            **{col: _mean(cols.get(col, [])) for col in present},
        }
        for style, cols in sorted(buckets.items())
    ]

    return {
        "available": True,
        "path": str(csv_path),
        "metrics": present,
        "images": len(rows),
        "byCulture": by_culture,
    }
