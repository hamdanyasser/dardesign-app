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


def _mean(values: list[float], digits: int = 2) -> float | None:
    return round(sum(values) / len(values), digits) if values else None


def generation_report(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """Generation statistics, over the history table.

    History is the durable record of a generated room: the rendering backend is
    disposable — on Colab it is wiped every session — so its own logs cannot
    answer "how many rooms, and how long did they take?" a week later.

    Every filter the dashboard offers is applied here, in SQL, rather than by
    trimming a global result afterwards — an average cannot be filtered once it
    has been taken.
    """
    from . import db

    return db.history_generation_stats(culture, since, until)


def coverage_report(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """How many of the filtered designs carry each measurement."""
    from . import db

    return db.evaluation_coverage(culture, since, until)


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


def _unavailable(csv_path: Path, reason_en: str, reason_ar: str, **extra) -> dict:
    """The one empty-state shape, so the caller never has to test for missing keys."""
    return {
        "available": False,
        "reason_en": reason_en,
        "reason_ar": reason_ar,
        "path": str(csv_path),
        "byCulture": [],
        "metrics": [],
        "sets": [],
        "ablation": {"available": False},
        **extra,
    }


def _row_style(r: dict) -> str:
    return (r.get("style") or r.get("culture") or "unknown").strip().lower()


def _row_set(r: dict) -> str:
    """Which arm of the ablation a row belongs to.

    A results.csv written before the baseline sweep existed has no `set` column
    at all; treating those rows as the LoRA arm is the only reading that does
    not invent a comparison — they were produced by the trained pipeline.
    """
    v = (r.get("set") or r.get("variant") or "").strip().lower()
    return v if v in ("lora", "baseline") else "lora"


def _numeric(rows: list[dict], col: str) -> list[float]:
    out: list[float] = []
    for r in rows:
        raw = (r.get(col) or "").strip()
        if not raw:
            continue
        try:
            out.append(float(raw))
        except ValueError:
            continue  # a stray header or 'nan' row must not break the page
    return out


def _summarise(rows: list[dict], present: list[str]) -> dict:
    """Mean and n per metric, plus the CLIP recognition rate, over one arm.

    Every metric carries its own n because they are not the same n: an SSIM-only
    partial run leaves LPIPS empty on the very same rows.
    """
    overall = {}
    for col in present:
        values = _numeric(rows, col)
        overall[col] = {"mean": _mean(values, 3), "n": len(values)}

    matrix: dict[str, dict[str, int]] = {}
    row_totals: dict[str, int] = {}
    total = correct = 0
    for r in rows:
        intended, predicted = _row_style(r), (r.get("predicted") or "").strip().lower()
        if not predicted or intended == "unknown":
            continue
        matrix.setdefault(intended, {})[predicted] = matrix.get(intended, {}).get(predicted, 0) + 1
        row_totals[intended] = row_totals.get(intended, 0) + 1
        total += 1
        if intended == predicted:
            correct += 1

    by_culture = []
    for style in sorted({_row_style(r) for r in rows}):
        subset = [r for r in rows if _row_style(r) == style]
        cols = {col: _numeric(subset, col) for col in present}
        by_culture.append({
            "culture": style,
            "samples": max((len(v) for v in cols.values()), default=0),
            **{col: _mean(cols[col], 3) for col in present},
            **{f"{col}_n": len(cols[col]) for col in present},
        })

    return {
        "images": len(rows),
        "overall": overall,
        "byCulture": by_culture,
        "recognition": {
            "matrix": matrix,
            "rowTotals": row_totals,
            "total": total,
            "correct": correct,
            # Null, not 0: nothing classified is not an accuracy of nothing.
            "accuracy": round(correct / total, 3) if total else None,
        },
    }


_SET_LABEL = {
    "lora": {"en": "DarDesign (LoRA)", "ar": "دار ديزاين (LoRA)"},
    "baseline": {"en": "Base SDXL (prompt-only)", "ar": "SDXL الأساسي (بالوصف فقط)"},
}


def automatic_metrics(path: Path | None = None, culture: str | None = None) -> dict:
    """Per-culture SSIM / LPIPS / CLIP, if the evaluation suite has been run.

    `eval/run_metrics.py` writes one row per generated image, tagged with the arm
    it came from (`set` = lora | baseline). Neither script is run here: they need
    the generated corpus and, for LPIPS/CLIP, model weights. The dashboard only
    *reads* what they produced.

    The two arms are kept apart rather than averaged together — that pooling was
    the bug that made the ablation unreadable, because a LoRA row and its own
    baseline row landed in the same per-culture bucket. Split, they are the
    comparison: same rooms, same prompts, same seeds, one variable.

    The corpus carries no timestamps, so the dashboard's date filter cannot apply
    to it; `dateFilterable: False` says so instead of quietly ignoring the dates.

    Returns available=False with a reason when there is no results file — the
    numbers this section would otherwise show are precisely the ones that must
    never be guessed.
    """
    csv_path = Path(path or EVAL_CSV)
    if not csv_path.is_file():
        return _unavailable(
            csv_path,
            "Automatic metrics have not been computed yet.",
            "لم يتم حساب المقاييس الآلية بعد.",
            hint=f"Run eval/run_metrics.py to produce {csv_path.name}.",
        )

    try:
        with csv_path.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
    except Exception as e:  # noqa: BLE001 — a broken CSV must not 500 the page
        logger.exception("could not read evaluation CSV %s", csv_path)
        return _unavailable(
            csv_path,
            f"Could not read {csv_path.name}: {e}",
            "تعذّرت قراءة ملف نتائج التقييم.",
        )

    if not rows:
        return _unavailable(csv_path, f"{csv_path.name} is empty.", "ملف نتائج التقييم فارغ.")

    if culture:
        rows = [r for r in rows if _row_style(r) == culture]
        if not rows:
            return _unavailable(
                csv_path,
                f"{csv_path.name} has no {culture} rows.",
                "لا توجد صفوف لهذه الثقافة في ملف النتائج.",
                culture=culture,
            )

    # Which metric columns this particular run actually produced — an SSIM-only
    # run (no torchmetrics) is a legitimate result, not a broken file.
    present = [c for c in _METRIC_COLUMNS if _numeric(rows, c)]

    arms = {name: [r for r in rows if _row_set(r) == name] for name in ("lora", "baseline")}
    sets = [
        {"set": name, "label_en": _SET_LABEL[name]["en"], "label_ar": _SET_LABEL[name]["ar"],
         **_summarise(arm, present)}
        for name, arm in arms.items() if arm
    ]

    primary = _summarise(arms["lora"], present) if arms["lora"] else _summarise(rows, present)

    return {
        "available": True,
        "path": str(csv_path),
        "culture": culture,
        # The corpus is a fixed set of rooms rendered offline; it has no dates.
        "dateFilterable": False,
        "metrics": present,
        "images": primary["images"],
        # Unchanged shape for existing callers: the trained pipeline's own rows.
        "byCulture": primary["byCulture"],
        "recognition": primary["recognition"],
        "sets": sets,
        "ablation": _ablation(arms, present),
    }


def _ablation(arms: dict[str, list[dict]], present: list[str]) -> dict:
    """LoRA vs base SDXL, metric by metric — only when both arms exist.

    A one-armed run is not half an ablation, it is no ablation: with nothing to
    compare against, a delta would be a number invented out of a single column.
    """
    lora, baseline = arms.get("lora") or [], arms.get("baseline") or []
    if not lora or not baseline:
        return {
            "available": False,
            "reason_en": (
                "Ablation results not generated yet — results.csv contains only the "
                f"{'LoRA' if lora else 'baseline'} arm."
                if (lora or baseline) else "Ablation results not generated yet."
            ),
            "reason_ar": "لم تُنشأ نتائج المقارنة بعد — الملف يحتوي على تجربة واحدة فقط.",
            "hint": "Run eval/run_metrics.py with --baselines to produce both arms.",
            "rows": [],
        }

    out_rows = []
    for col in present:
        a, b = _numeric(lora, col), _numeric(baseline, col)
        mean_a, mean_b = _mean(a, 3), _mean(b, 3)
        out_rows.append({
            "metric": col,
            "lora": {"mean": mean_a, "n": len(a)},
            "baseline": {"mean": mean_b, "n": len(b)},
            "delta": round(mean_a - mean_b, 3) if (mean_a is not None and mean_b is not None) else None,
        })

    rec_a = _summarise(lora, present)["recognition"]
    rec_b = _summarise(baseline, present)["recognition"]
    return {
        "available": True,
        "rows": out_rows,
        "recognition": {"lora": rec_a, "baseline": rec_b},
        # Same rooms in both arms, or the comparison is not controlled. Reported
        # rather than assumed, so a mismatched sweep is visible on the page.
        "sameCorpus": sorted({r.get("room") or r.get("room_id") or "" for r in lora})
        == sorted({r.get("room") or r.get("room_id") or "" for r in baseline}),
    }
