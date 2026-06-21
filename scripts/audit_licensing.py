"""Dataset licensing / provenance audit.

Scans every training image referenced in datasets/<culture>/captions.jsonl and
emits two artifacts the defense panel will want to see:

  1. datasets/LICENSING.csv  — one row per image (file, culture, source_url,
     license, has_people, notes). The source_url/license cells are pre-filled
     from the captions if present, else left blank for a human (Zainab) to fill.
     This is the fill-in-the-blanks provenance sheet.
  2. a printed STATUS summary — per culture: total, how many have a source_url,
     how many have a real license vs UNVERIFIED.

Run: python scripts/audit_licensing.py
This is read-only over the dataset; it never modifies captions or images.

Why this exists: the master plan flags "the panel WILL ask: did you have rights
to train on these?". A complete LICENSING.csv (Wikimedia / Unsplash / Pexels /
ArchNet-Aga Khan preferred) is the answer. Anything still marked UNVERIFIED is a
TODO to resolve before submission.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CULTURES = ["lebanese", "khaleeji", "moroccan"]
PLACEHOLDER_LICENSE_MARKERS = ("", "unverified", "todo", "unknown")


def is_verified(license_str: str) -> bool:
    s = (license_str or "").strip().lower()
    return bool(s) and not any(m in s for m in PLACEHOLDER_LICENSE_MARKERS)


def main() -> int:
    rows: list[dict[str, str]] = []
    summary: dict[str, dict[str, int]] = {}

    for culture in CULTURES:
        caps = REPO / "datasets" / culture / "captions.jsonl"
        s = {"total": 0, "with_source": 0, "verified_license": 0}
        if caps.exists():
            for line in caps.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                src = (rec.get("source_url") or "").strip()
                lic = (rec.get("license") or "").strip()
                s["total"] += 1
                if src:
                    s["with_source"] += 1
                if is_verified(lic):
                    s["verified_license"] += 1
                rows.append({
                    "file": rec.get("file", ""),
                    "culture": culture,
                    "source_url": src,
                    "license": lic if is_verified(lic) else "",
                    "has_people": "no",  # curation rule: no identifiable people
                    "status": "VERIFIED" if (src and is_verified(lic)) else "TODO",
                    "notes": "" if (src and is_verified(lic)) else "fill source_url + license (prefer Wikimedia/Unsplash/Pexels/ArchNet)",
                })
        summary[culture] = s

    out = REPO / "datasets" / "LICENSING.csv"
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["file", "culture", "source_url", "license", "has_people", "status", "notes"])
        w.writeheader()
        w.writerows(rows)

    print(f"wrote {out} ({len(rows)} images)\n")
    print(f"{'culture':9} {'total':>6} {'has source':>11} {'verified lic':>13} {'TODO':>6}")
    grand = {"total": 0, "with_source": 0, "verified_license": 0}
    for c in CULTURES:
        s = summary[c]
        todo = s["total"] - min(s["with_source"], s["verified_license"])
        print(f"{c:9} {s['total']:6} {s['with_source']:11} {s['verified_license']:13} {todo:6}")
        for k in grand:
            grand[k] += s[k]
    todo = grand["total"] - grand["verified_license"]
    print(f"{'ALL':9} {grand['total']:6} {grand['with_source']:11} {grand['verified_license']:13} {todo:6}")
    if todo:
        print(f"\n⚠️  {todo}/{grand['total']} images still need a verified source+license. "
              f"Fill datasets/LICENSING.csv before the defense (see docs/defense-qa.md Q13).")
    else:
        print("\n✅ All images have a verified source + license.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
