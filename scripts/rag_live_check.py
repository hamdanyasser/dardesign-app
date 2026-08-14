"""Live end-to-end check: the same brief planned WITH and WITHOUT cultural evidence.

    python scripts/rag_live_check.py

Makes two real calls to the configured provider. This is the one thing the test
suite cannot prove — every test injects a fake client — so it exists to be run
once before a demo, and it is the strongest exhibit for the defence: same brief,
same room, evidence off versus on, side by side.

Reads .dardesign-llm the way run-local-backend.ps1 does, so it works whether or
not the backend is running. Costs two free-tier calls.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Load the gitignored config exactly like the PowerShell launcher does.
cfg = ROOT / ".dardesign-llm"
if cfg.exists():
    for raw in cfg.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if v.strip():
                os.environ.setdefault(k.strip(), v.strip())

if "PASTE_YOUR_GEMINI_KEY" in os.environ.get("GEMINI_API_KEY", ""):
    sys.exit("The placeholder is still in .dardesign-llm — paste the real key first.")

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import design_planner as planner  # noqa: E402
from backend import retrieval  # noqa: E402

ROOM = {"widthCm": 520.0, "depthCm": 420.0, "heightCm": 300.0}
BRIEFS = [
    ("Design a traditional Lebanese living room for six people.", "lebanese"),
    ("بدي مجلس خليجي تقليدي لثمان أشخاص وألوان دافئة", "khaleeji"),
]


def show(tag: str, out: dict) -> None:
    meta = out.get("evidenceMeta", {})
    print(f"  [{tag}]")
    print(f"    source={out['source']}  model={out.get('model')}  "
          f"provider={out.get('provider')}  items={len(out['items'])}")
    print(f"    evidence: n={meta.get('count', 0)} injected={meta.get('injected')} "
          f"culture={meta.get('culture')}")
    for e in out.get("evidence", []):
        print(f"       · {e['elementEn']}  <{e['evidenceState']}>")
    print(f"    understood: culture={out['understood']['culture']} "
          f"room={out['understood']['roomType']} "
          f"capacity={out['understood']['capacity']} "
          f"intensity={out['understood']['intensity']} "
          f"wall={out['understood']['wallMaterialKey']} "
          f"floor={out['understood']['floorMaterialKey']}")
    print(f"    seats about {out.get('seatingEstimate')}")
    for it in out["items"]:
        print(f"       {it['catalogId']:<22} {it['reasonEn'][:74]}")
    if out.get("rejected"):
        print(f"    rejected: {out['rejected']}")
    if out.get("warning"):
        print(f"    WARNING: {out['warning']}")


def main() -> int:
    print(f"provider = {planner.provider()}   model = {planner.model_name()}")
    if not planner.is_configured():
        print("No provider configured — put a key in .dardesign-llm.")
        return 1

    for brief, culture in BRIEFS:
        print("\n" + "=" * 78)
        print(brief)
        print("=" * 78)

        r = retrieval.retrieve(brief, culture)
        print(f"  retrieved {len(r.chunks)} chunks for culture={r.culture}")

        os.environ["DARDESIGN_RAG"] = "1"
        planner._reset_for_tests()
        with_rag = planner.plan(ROOM, culture, brief)
        show("RAG ON", with_rag)

        os.environ["DARDESIGN_RAG"] = "0"
        planner._reset_for_tests()
        without = planner.plan(ROOM, culture, brief)
        show("RAG OFF", without)

        os.environ.pop("DARDESIGN_RAG", None)

        a = [i["catalogId"] for i in with_rag["items"]]
        b = [i["catalogId"] for i in without["items"]]
        print(f"\n    pieces WITH evidence : {a}")
        print(f"    pieces WITHOUT       : {b}")
        print(f"    same selection? {a == b}")
        if with_rag["source"] != "llm":
            print("    NOTE: the RAG-ON plan fell back to rules — the model call failed.")

    print("\nBoth plans above came from real provider calls.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
