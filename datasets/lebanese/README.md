# Lebanese dataset â€” Zainab handoff

**Status:** awaiting curation. Layout below is final; do not improvise paths.

## Layout

```
datasets/lebanese/
â”œâ”€â”€ images/                # 20â€“40 hand-curated room photos
â”‚   â”œâ”€â”€ lebanese_001.jpg   # JPG or PNG, â‰¥ 1024Ã—1024, no watermarks
â”‚   â”œâ”€â”€ lebanese_002.jpg
â”‚   â””â”€â”€ ...
â””â”€â”€ captions.jsonl         # one JSON per line, schema below
```

## Caption schema (one JSON per line)

```json
{
  "file": "lebanese_001.jpg",
  "caption_en": "<long-form English description, 30â€“60 words, includes 'in the dardesign-lebanese style'>",
  "caption_ar": "<Arabic equivalent, same length, includes Ù†Ù…Ø· Ø¯Ø§Ø±-Ø¯ÙŠØ²Ø§ÙŠÙ†-Ù„Ø¨Ù†Ø§Ù†ÙŠ>",
  "tags": ["living_room", "triple_arch", ...],
  "license": "CC-BY-4.0 | public-domain | author-permission",
  "source_url": "https://..."
}
```

See [../captions/template.jsonl](../captions/template.jsonl) for two complete examples.

## Curation rules (lock these before scraping)

1. **20â€“40 images.** Below 20 the LoRA will memorise; above 40 wastes T4 hours.
2. **Subject diversity.** At least 4 of: living room, majlis, dining room, courtyard, staircase, bedroom, hallway, kitchen.
3. **Style fidelity.** Reject anything that's "vaguely Mediterranean" â€” must show â‰¥1 Lebanese-specific element (triple arch, cedar wood, encaustic tile, mashrabiya, limestone vaulting).
4. **No people.** Crop or skip â€” faces leak into the LoRA.
5. **No text overlays.** Watermarks bias the model toward generating watermark-shaped artefacts.
6. **Resolution â‰¥ 1024Ã—1024.** SDXL trains at 1024Â². Smaller images get upsampled and waste signal.
7. **Captions in BOTH languages.** Same factual content, not a literal translation. The trigger phrase is **`dardesign-lebanese style`** in EN and **`Ù†Ù…Ø· Ø¯Ø§Ø±-Ø¯ÙŠØ²Ø§ÙŠÙ†-Ù„Ø¨Ù†Ø§Ù†ÙŠ`** in AR â€” every caption must contain it.

## Swap-in command (the moment images + captions land)

```bash
# from repo root, on Local 8 GB GPU
make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese RANK=16 STEPS=1500
```

Output â†’ `models/loras/lebanese/dardesign-lebanese-lora.safetensors` + 5-image preview grids per checkpoint at 500/1000/1500.

After training, drop the `.safetensors` into `models/loras/lebanese/` and the backend picks it up on next request â€” no code changes required (lazy-loaded by [backend/transform.py](../../backend/transform.py)).

