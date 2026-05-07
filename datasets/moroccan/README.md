# Moroccan dataset — Zainab handoff

**Status:** awaiting curation.

## Layout

```
datasets/moroccan/
├── images/
│   ├── moroccan_001.jpg
│   └── ...
└── captions.jsonl
```

## Trigger phrase

- EN: `dardesign-moroccan style`
- AR: `نمط دار-ديزاين-مغربي`

## Curation rules

1. **20–40 images.**
2. **Subject diversity.** At least 4 of: riad courtyard, salon marocain, hammam, bedroom, dining room, terrace, kitchen, hallway.
3. **Style fidelity.** Must show ≥1 Moroccan-specific element: zellige tile, tadelakt plaster, horseshoe arch, carved cedar plafond, beni-ourain rug, brass lantern, central fountain.
4. No people, no text overlays, ≥1024×1024, captions in BOTH languages.

See [../captions/template.jsonl](../captions/template.jsonl) for the line format.

## Swap-in command

```bash
make train-lora CULTURE=moroccan DATA_DIR=datasets/moroccan RANK=16 STEPS=1500
```

Output → `models/loras/moroccan/dardesign-moroccan-lora.safetensors`.
