# Cultural knowledge — the editorial layer

These files are **one third of a chunk**. They hold only what a human editor
adds on top of the vocabulary: how to *use* an element, how it is typically
misused, which rooms it suits, and the alternative words someone might type
when they mean it.

They deliberately do **not** hold the terms, their Arabic, their weights, their
colours or their verification status. Those live in
[`../ontology.json`](../ontology.json) and are joined in at load time by
[`backend/knowledge.py`](../../backend/knowledge.py). Citations are joined from
[`../sources.md`](../sources.md).

That split is the point. `ontology.json` already exists in two places
(`src/data/ontology.json` is a copy), and a knowledge base that re-stated the
terms would be a third copy drifting in a third direction. Because these files
carry no terms, **the day the Lebanese entries in `ontology.json` are marked
`"verified": true`, the retrieved evidence becomes verified with no edit
here.**

## Shape

```jsonc
{
  "culture": "lebanese",
  "version": "1.0.0",
  "entries": [
    {
      "term_en": "triple arch (qantara thulathiya)",  // JOIN KEY — byte-matches ontology.json
      "category": "architectural",
      "rooms": ["living room"],          // ROOM_TYPES in backend/design_planner.py only
      "materials": ["limestone"],        // MATERIAL_KEYS in backend/design_planner.py only
      "guidanceEn": "…", "guidanceAr": "…",
      "avoidEn": "…",    "avoidAr": "…",
      "aliasesEn": ["…"], "aliasesAr": ["…"]   // retrieval surface, not display
    }
  ],
  "conventions": [ /* same fields, plus id/titleEn/titleAr, minus term_en */ ]
}
```

`entries` mirror ontology terms one-for-one. `conventions` are the spatial and
social ideas no single term states — how seating relates to the room, where
guests are received, what the centre of the room is for. They are **never**
marked verified and **never** carry a citation, because nothing signed them off.

## Rules

1. **`term_en` must byte-match `ontology.json`.** A mismatch silently orphans
   the entry — the term still retrieves, just with no guidance.
2. **No dimensions.** Not `40cm`, not "seats four". Sizes belong to
   `ontology/furniture.json`, and a test fails the build if one appears here.
3. **No catalogue ids.** The catalogue is the planner's vocabulary, not
   knowledge.
4. **No citations, no dates, no authors.** These files assert no provenance.
   Add a source to `../sources.md` instead, where it is reviewable.
5. **`rooms` / `materials` must come from DAR's own vocabularies** — anything
   else is dropped at load rather than travelling into a prompt as if it meant
   something.
6. Guidance is about **use and restraint**, not description. "Frame one opening
   with it rather than repeating it along every wall" is useful; "a beautiful
   traditional arch" is not.

## Checking a change

```bash
python scripts/rag_eval.py                 # 11 briefs, EN + AR, with expectations
python -m pytest tests/test_cultural_rag.py -q
```

Persian has no file on purpose: 0/23 verified and no LoRA, so presenting it as
retrievable cultural evidence would overstate what DAR has.
