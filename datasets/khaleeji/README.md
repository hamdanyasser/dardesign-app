# Khaleeji dataset — Zainab handoff

**Status:** awaiting curation. Same layout and rules as the Lebanese set, repeated below for clarity.

## Layout

```
datasets/khaleeji/
├── images/                # 20–40 hand-curated room photos
│   ├── khaleeji_001.jpg
│   └── ...
└── captions.jsonl
```

## Trigger phrase

- EN: `dardesign-khaleeji style`
- AR: `نمط دار-ديزاين-خليجي`

Every caption must contain the trigger.

## Curation rules

1. **20–40 images.**
2. **Subject diversity.** At least 4 of: majlis, formal living room, dining hall, courtyard, palace foyer, bedroom, hallway.
3. **Style fidelity.** Must show ≥1 Khaleeji-specific element: gypsum-carved walls (jus), pointed arches, sadu textile, palm-frond motifs, brass coffee tray, deep-set windows with carved teak.
4. No people, no text overlays, ≥1024×1024, captions in BOTH languages.
5. License field is mandatory.

See [../captions/template.jsonl](../captions/template.jsonl) for the line format.

## Swap-in command

```bash
make train-lora CULTURE=khaleeji DATA_DIR=datasets/khaleeji RANK=16 STEPS=1500
```

Output → `models/loras/khaleeji/dardesign-khaleeji-lora.safetensors`.
