"""Cultural RAG evaluation — run the brief set and print what was actually retrieved.

    python scripts/rag_eval.py            # the report
    python scripts/rag_eval.py --prompt   # also print the block the model receives

This is the artifact behind the claim "DAR retrieves cultural evidence and
passes the relevant evidence to the planner". It runs against the real corpus,
prints every retrieved chunk with its score and provenance, and checks each
brief against a written expectation so a regression is visible rather than
merely plausible.

No API calls and no network — retrieval is local BM25 over local JSON.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import knowledge, retrieval  # noqa: E402

SHOW_PROMPT = "--prompt" in sys.argv

# (brief, room culture, expected culture, must-appear substrings, expect_hits)
CASES: list[tuple[str, str, str | None, tuple[str, ...], bool]] = [
    ("Design a traditional Lebanese living room for six people.",
     "lebanese", "lebanese", ("limestone",), True),
    ("بدي مجلس خليجي تقليدي لثمان أشخاص وألوان دافئة",
     "lebanese", "khaleeji", ("majlis",), True),
    ("Modern Moroccan room with zellige but not too traditional.",
     "lebanese", "moroccan", ("zellige",), True),
    ("Lebanese bedroom with no arches.",
     "lebanese", "lebanese", (), True),
    ("Moroccan living room, keep the center open.",
     "moroccan", "moroccan", (), True),
    ("A majlis for receiving guests",
     "khaleeji", "khaleeji", ("majlis",), True),
    ("غرفة معيشة مغربية بزليج وألوان هادئة",
     "lebanese", "moroccan", ("zellige",), True),
    # Negatives — these must retrieve NOTHING.
    ("hello how are you", "lebanese", None, (), False),
    ("make it nice", "lebanese", None, (), False),
    ("asdfgh qwerty", "lebanese", None, (), False),
    ("", "lebanese", None, (), False),
]

STATE_MARK = {"verified-cited": "V+cite", "verified": "V", "unverified": "unver"}


def main() -> int:
    chunks = knowledge.corpus()
    if not chunks:
        print("NO CORPUS — ontology/knowledge/*.json missing or unreadable")
        return 1

    by_culture = Counter(c.culture for c in chunks)
    by_state = Counter(c.evidence_state for c in chunks)
    print("=" * 78)
    print(f"CORPUS  {len(chunks)} chunks   {dict(by_culture)}")
    print(f"        states {dict(by_state)}   cited {sum(1 for c in chunks if c.source)}")
    print("=" * 78)

    failures = 0
    for brief, room_culture, want_culture, must_have, expect_hits in CASES:
        result = retrieval.retrieve(brief, room_culture)
        shown = brief if brief else "(empty brief)"
        print(f"\n▸ {shown}")
        print(f"  room culture={room_culture}  ->  detected={result.culture}  "
              f"rooms={list(result.rooms)}  n={len(result.chunks)}")

        problems = []
        if expect_hits and not result.chunks:
            problems.append("expected evidence, got none")
        if not expect_hits and result.chunks:
            problems.append(f"expected NO evidence, got {len(result.chunks)}")
        if want_culture and result.culture != want_culture:
            problems.append(f"culture {result.culture!r} != expected {want_culture!r}")
        if result.chunks:
            cultures = {x.chunk.culture for x in result.chunks}
            if len(cultures) > 1:
                problems.append(f"mixed cultures in one result: {cultures}")
            blob = " ".join(x.chunk.element_en.lower() for x in result.chunks)
            for needle in must_have:
                if needle.lower() not in blob:
                    problems.append(f"expected {needle!r} among retrieved elements")

        for x in result.chunks:
            src = f"  [{x.chunk.source}]" if x.chunk.source else ""
            print(f"     {x.score:6.2f}  {STATE_MARK[x.chunk.evidence_state]:>6}  "
                  f"{x.chunk.category:<18} {x.chunk.element_en[:44]}{src}")
        if not result.chunks:
            print(f"     — nothing retrieved ({result.reason or 'n/a'})")

        if problems:
            failures += 1
            for p in problems:
                print(f"     FAIL  {p}")
        else:
            print("     ok")

        if SHOW_PROMPT and result.chunks:
            print("     --- block handed to the planner ---")
            for line in retrieval.format_for_prompt(result).splitlines():
                print(f"     | {line}")

    print("\n" + "=" * 78)
    print(f"{len(CASES) - failures}/{len(CASES)} cases passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
