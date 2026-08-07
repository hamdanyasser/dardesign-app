"""Evaluation dashboard — the numbers, with no FastAPI in sight.

Two sources, deliberately kept apart because they answer different questions
and have very different guarantees:

  * **Human ratings** live in SQLite (`feedback`) and are aggregated by the
    functions db.py already has. Durable, filterable, and the honest answer to
    "how did this land with users?".

  * **Generation statistics** come from the append-only render audit
    (backend/audit.jsonl). There is no generation table: `history` records
    designs a user chose to *save*, and jobs are in-memory, so counting saved
    designs would badly undercount rooms actually generated. The audit log is
    the only real record.

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

from .audit import read_events

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

# Where eval/run_metrics.py (or scripts/metrics.py) writes its per-image CSV.
# Overridable so a marker can point the dashboard at a results file computed
# elsewhere — e.g. on the Kaggle box that had the GPU.
EVAL_CSV = Path(os.environ.get("DARDESIGN_EVAL_CSV") or ROOT / "eval" / "results.csv")

# The audit file can grow without bound; this caps how much is read for stats.
# Far above any realistic FYP demo volume, and it keeps a runaway log from
# turning the dashboard into a slow endpoint.
_MAX_EVENTS = 50_000

# Columns run_metrics.py / metrics.py may emit. Anything numeric outside this
# list is ignored rather than guessed at.
_METRIC_COLUMNS = ("ssim", "lpips", "clip", "clip_score")


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def generation_stats(*, include_light: bool = False) -> dict:
    """Rooms generated and how long they took, from the render audit log.

    `light` events are DARDESIGN_LIGHT placeholder runs — instant, and not
    renders at all. Counting them would inflate the total and crush the average
    duration, so they are excluded by default and reported separately, which is
    also the honest way to show a demo machine's log.

    Every figure is None when there is nothing to compute it from. A dashboard
    that prints "0.0s average generation time" because no render was ever logged
    is worse than one that says it doesn't know.
    """
    events = read_events(_MAX_EVENTS)

    redesigns: list[dict] = []
    restyles: list[dict] = []
    light_runs = 0
    failures = 0

    for e in events:
        if e.get("event") not in ("redesign", "restyle"):
            continue
        if e.get("light") and not include_light:
            light_runs += 1
            continue
        if e.get("ok") is False:
            failures += 1
            continue
        (redesigns if e.get("event") == "redesign" else restyles).append(e)

    durations = [
        float(e["duration_s"])
        for e in (*redesigns, *restyles)
        if isinstance(e.get("duration_s"), (int, float))
    ]

    # One /redesign is one room; it may carry 1-3 cultures, so images and rooms
    # are different numbers and both are worth showing.
    images = 0
    for e in redesigns:
        styles = e.get("styles")
        images += len(styles) if isinstance(styles, list) and styles else 1

    total = len(redesigns) + len(restyles) + failures
    return {
        "roomsGenerated": len(redesigns),
        "imagesGenerated": images,
        "restyles": len(restyles),
        "failures": failures,
        "successRate": round(1.0 - failures / total, 3) if total else None,
        "averageSeconds": _mean(durations),
        "slowestSeconds": round(max(durations), 1) if durations else None,
        "fastestSeconds": round(min(durations), 1) if durations else None,
        "sampleSize": len(durations),
        "placeholderRunsExcluded": light_runs,
    }


def generation_report(since: float | None = None, until: float | None = None) -> dict:
    """Generation statistics, from the database when it has them.

    Two sources, in order:

      * the `generations` table — durable, filterable by date, and unaffected by
        the rendering box being wiped. This is the real answer once the studio
        has recorded anything.
      * the render audit log — the legacy source, and still the honest fallback
        for an install that has rendered but not yet recorded. It cannot be
        date-filtered, so `filtered` says so rather than quietly ignoring the
        dates the user picked.

    `source` travels with the numbers so the dashboard can say where they came
    from. A statistic whose provenance isn't stated is a statistic nobody can
    check.
    """
    from . import db

    try:
        has_rows = db.generation_count() > 0
    except Exception:  # noqa: BLE001 — the dashboard must survive a DB hiccup
        logger.exception("could not read the generations table; falling back to the audit log")
        has_rows = False

    if has_rows:
        stats = db.generation_stats(since, until)
        stats.update({"source": "database", "restyles": None, "filtered": True})
        return stats

    stats = generation_stats()
    stats.update({"source": "audit_log", "filtered": False})
    return stats


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
