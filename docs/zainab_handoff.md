# Zainab handoff â€” one page

Everything that's blocked on you, in the order it should be unblocked.

## 1 â€” Verify ontology terms (~30 minutes)

Open [`ontology/ontology.json`](../ontology/ontology.json). For every entry:
- check the EN â†” AR pair refers to the same thing,
- flip `"verified": false` â†’ `"true"` if accurate,
- delete the entry if wrong, or write a `"replacement": "..."` if the term needs updating,
- add new entries freely (same shape).

The trigger phrases (`dardesign-<culture> style` / `Ù†Ù…Ø· Ø¯Ø§Ø±-Ø¯ÙŠØ²Ø§ÙŠÙ†-<Ø§Ø³Ù…>`) are
intentionally invented as LoRA training tokens â€” **leave them alone**.

The prompt builder reads this file at request time. No rebuild needed.

## 2 â€” Curate per-culture image sets (the big one)

Layout (per culture, exactly):

```
datasets/lebanese/
â”œâ”€â”€ images/
â”‚   â”œâ”€â”€ lebanese_001.jpg
â”‚   â””â”€â”€ ...                  # 20â€“40 images, JPG/PNG, â‰¥1024Ã—1024, no watermarks, no people
â””â”€â”€ captions.jsonl           # one JSON per line
```

Caption schema (one JSON per line):

```json
{
  "file": "lebanese_001.jpg",
  "caption_en": "a Lebanese living room in the dardesign-lebanese style, ... 30â€“60 words ...",
  "caption_ar": "ØºØ±ÙØ© Ø¬Ù„ÙˆØ³ Ù„Ø¨Ù†Ø§Ù†ÙŠØ© Ø¨Ù†Ù…Ø· Ø¯Ø§Ø±-Ø¯ÙŠØ²Ø§ÙŠÙ†-Ù„Ø¨Ù†Ø§Ù†ÙŠØŒ ... Ù†ÙØ³ Ø§Ù„Ù…Ø¹Ù†Ù‰ Ø¨Ø§Ù„Ø¹Ø±Ø¨ÙŠØ© ...",
  "tags": ["living_room", "triple_arch"],
  "license": "CC-BY-4.0",
  "source_url": "https://..."
}
```

- The trigger phrase **must** appear in every `caption_en` (and the AR equivalent in `caption_ar`).
- See [`datasets/captions/template.jsonl`](../datasets/captions/template.jsonl) for two
  fully-worked examples.
- See [`datasets/lebanese/README.md`](../datasets/lebanese/README.md) (and the
  Khaleeji / Moroccan ones) for the per-culture rules â€” must show â‰¥1
  culture-specific element, no people, no text, â‰¥1024Â².

## 3 â€” Tell us when you're done â€” one command kicks off training

On Local 8 GB GPU (paste-into-cell runbook is in [local environment/README.md](../local environment/README.md)):

```bash
make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese RANK=16 STEPS=1500
```

Repeat for `khaleeji` and `moroccan`. Each LoRA takes ~45 min on T4.

## 4 â€” Drop the LoRA next to the backend

Training writes:

```
models/loras/lebanese/dardesign-lebanese-lora.safetensors
models/loras/khaleeji/dardesign-khaleeji-lora.safetensors
models/loras/moroccan/dardesign-moroccan-lora.safetensors
```

`backend/transform.py` lazy-loads whichever file is present. **No code changes
required** â€” restart the backend and it picks them up.

## 5 â€” Pick the ControlNet winners (the only step that needs your eye)

After Yasser runs `make sweep` on T4, open each
`outputs/sweeps/<room>_contact.png` and pick the (depth, seg) pair per culture
that looks best. Edit [`configs/sweep_winners.json`](../configs/sweep_winners.json):

```json
{
  "lebanese": [0.7, 0.5],
  "khaleeji": [1.0, 0.5],
  "moroccan": [0.5, 1.0]
}
```

`make finals` reads this file and produces the demo's 45 final images.

## What you do NOT need to touch

- Any code under `backend/`, `src/`, `scripts/`.
- The frontend.
- Anything in `outputs/` (regenerated).
- The pipeline weights / models (downloaded from Hugging Face automatically).

## When in doubt

- **Bad caption?** Edit the JSONL line, re-train. The LoRA is cheap to redo.
- **Wrong trigger phrase?** Don't change it. It's how the model learns to recognise the style.
- **Image quality concern?** Replace it. 30 great images > 40 mediocre ones.

