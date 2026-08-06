"""Read-only dataset audit for the Lebanese culture LoRA (V2 prep).

Answers the questions that came up reviewing the V1 training recipe:
  - Are there enough images, and are captions descriptive/diverse enough
    to avoid the model memorizing individual training photos?
  - At a given step count, how many times does the trainer see each image
    on average (repeat count is a direct memorization risk factor)?
  - Is subject/tag diversity high enough per the dataset README's curation
    rules (>= 4 of: living_room, majlis, dining_room, courtyard, staircase,
    bedroom, hallway, kitchen)?
  - Is licensing/provenance complete?

This script NEVER writes to datasets/lebanese/images/ or captions.jsonl —
it only reads them and writes a new report file alongside (same convention
as scripts/audit_licensing.py writing datasets/LICENSING.csv).

Usage:
    python scripts/audit_lebanese_dataset.py
    python scripts/audit_lebanese_dataset.py --steps 1500 --steps 3000
    python scripts/audit_lebanese_dataset.py --data-dir datasets/lebanese --json-out datasets/lebanese/audit_report.json

Scope: Lebanese only, on purpose — Khaleeji/Moroccan are not part of this pass.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# README curation rules (datasets/lebanese/README.md) — kept in sync manually,
# this script does not modify the README.
MIN_IMAGES_RECOMMENDED = 20
MAX_IMAGES_RECOMMENDED = 40
MIN_RESOLUTION = 1024
MIN_CAPTION_WORDS = 30
MAX_CAPTION_WORDS = 60
REQUIRED_SUBJECTS = {
    "living_room", "majlis", "dining_room", "courtyard",
    "staircase", "bedroom", "hallway", "kitchen",
}
MIN_SUBJECT_COVERAGE = 4
# Above this pairwise word-overlap ratio, two captions are "too similar" —
# a strong signal the dataset is filename-derived/templated rather than
# hand-described, which starves the model of the text-conditioned variation
# it needs to avoid memorizing images pixel-for-pixel.
CAPTION_SIMILARITY_FLAG = 0.6
# Average per-image exposures beyond which repeated sampling starts to look
# like rote memorization rather than learning a generalizable style, for a
# dataset this small. Heuristic, not a hard science — see docs/note below.
SAFE_AVG_REPEATS = 60
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _load_trigger(culture: str) -> dict[str, str]:
    onto_path = REPO_ROOT / "ontology" / "ontology.json"
    try:
        data = json.loads(onto_path.read_text(encoding="utf-8"))
        return data["trigger"][culture]
    except Exception:
        return {"en": f"dardesign-{culture} style", "ar": ""}


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _token_set(text: str, trigger_en: str) -> set[str]:
    """Lowercased word set, trigger phrase stripped, for similarity comparison."""
    t = (text or "").lower().replace(trigger_en.lower(), " ")
    return set(re.findall(r"[a-z]+", t))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


@dataclass
class ImageFinding:
    file: str
    issues: list[str] = field(default_factory=list)


@dataclass
class AuditReport:
    culture: str
    n_images_found: int
    n_captions_found: int
    n_matched_pairs: int
    orphan_images: list[str]        # images with no caption entry
    orphan_captions: list[str]      # caption entries with no image on disk
    subject_coverage: list[str]
    subject_coverage_ok: bool
    caption_length_issues: list[dict]
    trigger_missing: list[dict]
    near_duplicate_caption_pairs: list[dict]
    caption_variant_coverage: dict
    low_resolution_images: list[dict]
    unreadable_images: list[str]
    license_summary: dict
    repeat_estimates: dict
    verdict: list[str]


def _read_captions_jsonl(path: Path) -> tuple[list[dict], list[str]]:
    """Return (records, parse_warnings). Tolerant of bad lines like the trainer is."""
    records: list[dict] = []
    warnings: list[str] = []
    if not path.exists():
        return records, warnings
    for ln, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as e:
            warnings.append(f"line {ln}: bad JSON ({e})")
    return records, warnings


def audit(data_dir: Path, culture: str, steps_to_estimate: list[int]) -> AuditReport:
    trigger = _load_trigger(culture)
    images_dir = data_dir / "images"
    captions_path = data_dir / "captions.jsonl"

    images_on_disk = sorted(
        p.name for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS
    ) if images_dir.is_dir() else []
    records, parse_warnings = _read_captions_jsonl(captions_path)

    by_file = {r.get("file"): r for r in records if r.get("file")}
    orphan_images = [f for f in images_on_disk if f not in by_file]
    orphan_captions = [f for f in by_file if f not in images_on_disk]
    matched = [f for f in images_on_disk if f in by_file]

    # --- subject / tag coverage ---
    seen_tags: set[str] = set()
    for r in records:
        seen_tags.update(t for t in (r.get("tags") or []) if isinstance(t, str))
    subject_coverage = sorted(seen_tags & REQUIRED_SUBJECTS)

    # --- per-caption checks: length + trigger phrase (EN + AR) ---
    length_issues: list[dict] = []
    trigger_missing: list[dict] = []
    variant_covered = 0
    for f in matched:
        r = by_file[f]
        en = r.get("caption_en") or ""
        ar = r.get("caption_ar") or ""
        wc = _word_count(en)
        if wc < MIN_CAPTION_WORDS or wc > MAX_CAPTION_WORDS:
            length_issues.append({"file": f, "words": wc, "expected": f"{MIN_CAPTION_WORDS}-{MAX_CAPTION_WORDS}"})
        missing = []
        if trigger["en"].lower() not in en.lower():
            missing.append("en")
        if trigger.get("ar") and trigger["ar"] not in ar:
            missing.append("ar")
        if missing:
            trigger_missing.append({"file": f, "missing_in": missing})
        variants = r.get("caption_variants") or []
        if isinstance(variants, list) and len(variants) >= 1:
            variant_covered += 1

    # --- near-duplicate captions (memorization smell: templated/filename-derived text) ---
    dup_pairs: list[dict] = []
    token_sets = {f: _token_set(by_file[f].get("caption_en") or "", trigger["en"]) for f in matched}
    files_sorted = sorted(token_sets)
    for i, fa in enumerate(files_sorted):
        for fb in files_sorted[i + 1:]:
            sim = _jaccard(token_sets[fa], token_sets[fb])
            if sim >= CAPTION_SIMILARITY_FLAG:
                dup_pairs.append({"a": fa, "b": fb, "similarity": round(sim, 2)})

    # --- resolution check (best-effort; only if Pillow is available) ---
    low_res: list[dict] = []
    unreadable: list[str] = []
    try:
        from PIL import Image  # lazy — keep this script runnable without Pillow too
        for f in matched:
            p = images_dir / f
            try:
                with Image.open(p) as im:
                    w, h = im.size
                if w < MIN_RESOLUTION or h < MIN_RESOLUTION:
                    low_res.append({"file": f, "size": f"{w}x{h}"})
            except Exception as e:  # noqa: BLE001
                unreadable.append(f"{f}: {e}")
    except ImportError:
        pass

    # --- license / provenance completeness ---
    with_source = sum(1 for f in matched if (by_file[f].get("source_url") or "").strip())
    with_license = sum(
        1 for f in matched
        if (by_file[f].get("license") or "").strip().lower() not in ("", "unverified", "todo", "unknown")
    )
    license_summary = {
        "total": len(matched),
        "with_source_url": with_source,
        "with_verified_license": with_license,
        "todo": len(matched) - min(with_source, with_license),
    }

    # --- repeat-count estimates: how many times will the trainer see each image? ---
    n = len(matched)
    repeat_estimates = {}
    for steps in steps_to_estimate:
        avg_repeats = (steps / n) if n else float("inf")
        repeat_estimates[str(steps)] = {
            "avg_repeats_per_image": round(avg_repeats, 1),
            "over_safe_threshold": avg_repeats > SAFE_AVG_REPEATS,
        }
    recommended_max_steps = int(n * SAFE_AVG_REPEATS) if n else 0

    # --- verdict ---
    verdict: list[str] = []
    if n < MIN_IMAGES_RECOMMENDED:
        verdict.append(
            f"only {n} images (README floor is {MIN_IMAGES_RECOMMENDED}) — expect elevated memorization risk "
            f"regardless of steps; augmentation (scripts/lora_augment.py) is not optional for this dataset."
        )
    if n > MAX_IMAGES_RECOMMENDED:
        verdict.append(f"{n} images exceeds the {MAX_IMAGES_RECOMMENDED} README ceiling — wastes T4 hours, consider curating down.")
    if len(subject_coverage) < MIN_SUBJECT_COVERAGE:
        verdict.append(
            f"only {len(subject_coverage)}/{MIN_SUBJECT_COVERAGE} required subject tags present "
            f"({sorted(subject_coverage) or 'none'}) — low scene diversity compounds memorization risk."
        )
    if dup_pairs:
        verdict.append(
            f"{len(dup_pairs)} caption pair(s) at >= {int(CAPTION_SIMILARITY_FLAG*100)}% word overlap — "
            f"captions look templated/filename-derived rather than hand-described. This alone can cause "
            f"memorization even with augmentation, because the text conditioning doesn't vary enough to "
            f"disambiguate repeats of the same image."
        )
    if length_issues:
        verdict.append(f"{len(length_issues)} caption(s) outside the {MIN_CAPTION_WORDS}-{MAX_CAPTION_WORDS} word range.")
    if trigger_missing:
        verdict.append(f"{len(trigger_missing)} caption(s) missing the trigger phrase (EN and/or AR).")
    if orphan_images or orphan_captions:
        verdict.append(f"{len(orphan_images)} image(s) with no caption entry, {len(orphan_captions)} caption entry(ies) with no image on disk.")
    if variant_covered < n:
        verdict.append(
            f"{n - variant_covered}/{n} image(s) have no caption_variants (V2 addendum) — without paraphrase "
            f"rotation, train_lora_v2.py falls back to the single caption_en for every repeat of that image."
        )
    if license_summary["todo"]:
        verdict.append(f"{license_summary['todo']}/{n} image(s) missing verified license/source_url — run scripts/audit_licensing.py.")
    for steps, est in repeat_estimates.items():
        if est["over_safe_threshold"]:
            verdict.append(
                f"at {steps} steps, average repeats/image is {est['avg_repeats_per_image']} "
                f"(safe guideline: <= {SAFE_AVG_REPEATS}); recommended_max_steps for this dataset size is {recommended_max_steps}."
            )
    if parse_warnings:
        verdict.append(f"{len(parse_warnings)} malformed line(s) in captions.jsonl: {parse_warnings[:3]}")
    if not verdict:
        verdict.append("no issues found against the checks this script runs.")
    verdict.append(
        "NOT checked by this script (manual review required per README curation rules): no-people, "
        "no-text-overlay/watermark, and Lebanese-specific style fidelity — these need a human eye."
    )

    return AuditReport(
        culture=culture,
        n_images_found=len(images_on_disk),
        n_captions_found=len(records),
        n_matched_pairs=len(matched),
        orphan_images=orphan_images,
        orphan_captions=orphan_captions,
        subject_coverage=subject_coverage,
        subject_coverage_ok=len(subject_coverage) >= MIN_SUBJECT_COVERAGE,
        caption_length_issues=length_issues,
        trigger_missing=trigger_missing,
        near_duplicate_caption_pairs=dup_pairs,
        caption_variant_coverage={"with_variants": variant_covered, "total": n},
        low_resolution_images=low_res,
        unreadable_images=unreadable,
        license_summary=license_summary,
        repeat_estimates={**repeat_estimates, "recommended_max_steps": recommended_max_steps},
        verdict=verdict,
    )


def _print_report(r: AuditReport) -> None:
    print(f"=== Lebanese dataset audit ({r.n_matched_pairs} usable image/caption pairs) ===\n")
    print(f"images on disk:      {r.n_images_found}")
    print(f"caption entries:     {r.n_captions_found}")
    print(f"matched pairs:       {r.n_matched_pairs}")
    print(f"orphan images:       {len(r.orphan_images)} {r.orphan_images[:5]}")
    print(f"orphan captions:     {len(r.orphan_captions)} {r.orphan_captions[:5]}")
    print(f"subject coverage:    {r.subject_coverage} ({'OK' if r.subject_coverage_ok else 'BELOW MINIMUM'})")
    print(f"caption length OOR:  {len(r.caption_length_issues)}")
    print(f"trigger missing:     {len(r.trigger_missing)}")
    print(f"near-dup captions:   {len(r.near_duplicate_caption_pairs)}")
    print(f"caption variants:    {r.caption_variant_coverage['with_variants']}/{r.caption_variant_coverage['total']}")
    print(f"low resolution:      {len(r.low_resolution_images)}")
    print(f"license/source TODO: {r.license_summary['todo']}/{r.license_summary['total']}")
    print("\nrepeat-count estimates (avg exposures per image at N steps):")
    for k, v in r.repeat_estimates.items():
        if k == "recommended_max_steps":
            continue
        flag = "  <-- over safe threshold" if v["over_safe_threshold"] else ""
        print(f"  {k:>6} steps -> {v['avg_repeats_per_image']:>6} avg repeats/image{flag}")
    print(f"  recommended max steps for this dataset size: {r.repeat_estimates['recommended_max_steps']}")
    print("\n--- verdict ---")
    for v in r.verdict:
        print(f"  - {v}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--culture", default="lebanese", choices=["lebanese"],
                     help="Lebanese only for now — Khaleeji/Moroccan are out of scope for this audit.")
    ap.add_argument("--data-dir", type=Path, default=None, help="defaults to datasets/<culture>")
    ap.add_argument("--steps", type=int, action="append", default=None,
                     help="step counts to estimate repeats for (repeatable); default 500 1000 1500 3000")
    ap.add_argument("--json-out", type=Path, default=None, help="defaults to datasets/<culture>/audit_report.json")
    args = ap.parse_args()

    data_dir = args.data_dir or (REPO_ROOT / "datasets" / args.culture)
    steps = args.steps or [500, 1000, 1500, 3000]
    json_out = args.json_out or (data_dir / "audit_report.json")

    if not data_dir.exists():
        print(f"[audit] {data_dir} does not exist. Nothing to audit yet — "
              f"see datasets/{args.culture}/README.md for the expected layout.")
        return 0
    if not (data_dir / "captions.jsonl").exists() and not (data_dir / "images").exists():
        print(f"[audit] no images/ or captions.jsonl under {data_dir} — dataset not delivered locally yet.\n"
              f"[audit] this is expected: real training data is gitignored and lives outside this checkout "
              f"(see kaggle/TRAIN_NOW.md). Drop the curated images + captions.jsonl in to run this for real.")
        return 0

    report = audit(data_dir, args.culture, steps)
    _print_report(report)

    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[audit] wrote {json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
