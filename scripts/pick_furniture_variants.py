"""Promote one chosen variant per furniture item to its canonical asset filename.

The generator writes three attempts per item (<id>_v1.png … _v3.png). The catalogue's
"asset" field points at <id>.png, so exactly one variant has to be promoted. This does
that from the PICKS table below — copy, not move, so the other variants stay on disk
and a different choice is always one edit away.

Edit PICKS, then:

    python scripts/pick_furniture_variants.py            # show what would happen
    python scripts/pick_furniture_variants.py --apply    # actually copy

GPU NOT NEEDED. Read-only against the raw renders; only writes <id>.png files.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FURNITURE_DIR = ROOT / "public" / "furniture"
CATALOGUE = ROOT / "ontology" / "furniture.json"

# item id -> variant number to promote.
# Change a number here and re-run with --apply to swap the choice.
PICKS: dict[str, int] = {
    # Lebanese
    "leb-chair-001": 2,
    "leb-coffee-001": 3,
    "leb-lamp-001": 1,
    "leb-side-001": 1,
    "leb-sofa-001": 1,
    # Khaleeji
    "khal-coffee-001": 2,
    "khal-incense-001": 3,
    "khal-lamp-001": 1,
    "khal-majlis-001": 1,
    "khal-side-001": 1,
    # Moroccan
    "mor-chair-001": 2,
    "mor-lantern-001": 2,
    "mor-pouf-001": 1,
    "mor-side-001": 1,
    # v1 rendered nearly blank and v3 has a bowl and plant on the tabletop, which
    # would composite into the room along with the table. v2 is the only clean one.
    "mor-table-001": 2,
}


def _culture_of(item_id: str, catalogue: dict) -> str | None:
    for item in catalogue.get("items", []):
        if item.get("id") == item_id:
            return item.get("culture")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="perform the copies (default is a dry run)")
    ap.add_argument("--furniture-dir", type=Path, default=FURNITURE_DIR)
    ap.add_argument("--catalogue", type=Path, default=CATALOGUE)
    args = ap.parse_args()

    if not args.catalogue.exists():
        raise SystemExit(f"catalogue not found: {args.catalogue}")
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))

    catalogue_ids = {i["id"] for i in catalogue.get("items", [])}
    missing_picks = catalogue_ids - set(PICKS)
    unknown_picks = set(PICKS) - catalogue_ids
    if missing_picks:
        print(f"WARNING: no pick listed for {sorted(missing_picks)} — they will be skipped\n")
    if unknown_picks:
        print(f"WARNING: {sorted(unknown_picks)} are not in the catalogue — they will be skipped\n")

    copied = skipped = 0
    for item_id, variant in sorted(PICKS.items()):
        culture = _culture_of(item_id, catalogue)
        if culture is None:
            skipped += 1
            continue
        src = args.furniture_dir / culture / f"{item_id}_v{variant}.png"
        dst = args.furniture_dir / culture / f"{item_id}.png"
        if not src.exists():
            print(f"MISSING  {src.relative_to(ROOT)} — run the cutout stage first")
            skipped += 1
            continue
        if args.apply:
            shutil.copy2(src, dst)
            print(f"copied   {src.name} -> {dst.name}")
        else:
            note = " (overwrites existing)" if dst.exists() else ""
            print(f"would copy {src.name} -> {dst.name}{note}")
        copied += 1

    print(f"\n{'copied' if args.apply else 'would copy'} {copied} file(s), skipped {skipped}")
    if not args.apply:
        print("dry run — nothing written. Re-run with --apply to do it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
