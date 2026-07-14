"""Build the Defense-Mode demo pack: copy pre-rendered rooms from
outputs/finals/ into public/demo/ and write manifest.json.

Usage:  python scripts/make_demo_pack.py
Re-run any time new rooms land in outputs/finals/ — it's idempotent.

/studio?demo=1 reads public/demo/manifest.json and replays these rooms with
ZERO backend — the demo-day insurance if the T4 tunnel dies mid-defense.
`public/demo/` is gitignored (generated, ~40 MB); regenerate per machine.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "outputs" / "finals"
DST = ROOT / "public" / "demo"

REQUIRED = ("original.png", "lebanese.png", "khaleeji.png", "moroccan.png")
OPTIONAL = ("depth_map.png", "meta.json")

# Friendly bilingual labels for the canonical rooms (fallback: the stem).
LABELS = {
    "alef-morais-IP0iPi0vB5w-unsplash": ("غرفة معيشة مشرقة", "Bright living room"),
    "joseph-cortez-cNYaoDwok6Q-unsplash": ("صالون عائلي", "Family lounge"),
    "point3d-commercial-imaging-ltd-nQlVMCHPysY-unsplash": ("جناح حديث", "Modern suite"),
    "poojan-thanekar-mSw-nC3pQ7k-unsplash": ("غرفة نوم دافئة", "Warm bedroom"),
    "spacejoy-GQQyH0yNqLk-unsplash": ("ركن جلوس", "Sitting corner"),
    "sample-room": ("الغرفة التجريبية", "Sample room"),
}


def main() -> None:
    rooms = []
    for room_dir in sorted(SRC.iterdir()) if SRC.is_dir() else []:
        if not room_dir.is_dir():
            continue
        if not all((room_dir / f).is_file() for f in REQUIRED):
            print(f"skip {room_dir.name}: incomplete ({[f for f in REQUIRED if not (room_dir / f).is_file()]})")
            continue
        out = DST / room_dir.name
        out.mkdir(parents=True, exist_ok=True)
        for f in (*REQUIRED, *OPTIONAL):
            src = room_dir / f
            if src.is_file():
                shutil.copy2(src, out / f)
        ar, en = LABELS.get(room_dir.name, (room_dir.name, room_dir.name))
        rooms.append(
            {
                "id": room_dir.name,
                "label_ar": ar,
                "label_en": en,
                "has_depth": (room_dir / "depth_map.png").is_file(),
                "has_meta": (room_dir / "meta.json").is_file(),
            }
        )
        print(f"packed {room_dir.name}")

    DST.mkdir(parents=True, exist_ok=True)
    (DST / "manifest.json").write_text(
        json.dumps({"rooms": rooms}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"manifest: {len(rooms)} room(s) -> {DST / 'manifest.json'}")


if __name__ == "__main__":
    main()
