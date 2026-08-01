# Add a culture (e.g. "Najdi", "Andalusi", "Egyptian")

Worked example: adding `najdi` (Saudi central-region heritage).

## 1 â€” Extend the ontology

Edit [`ontology/ontology.json`](../ontology/ontology.json):

```jsonc
{
  "trigger": {
    ...,
    "najdi": {
      "en": "dardesign-najdi style",
      "ar": "Ù†Ù…Ø· Ø¯Ø§Ø±-Ø¯ÙŠØ²Ø§ÙŠÙ†-Ù†Ø¬Ø¯ÙŠ"
    }
  },
  "cultures": {
    ...,
    "najdi": {
      "negative_specific": ["...things this style is NOT..."],
      "architectural":  [{"en": "...", "ar": "...", "weight": 1.2, "verified": false}, ...],
      "materials":      [...],
      "color_palette":  [...],
      "lighting":       [...],
      "furniture":      [...],
      "textiles":       [...],
      "ornamentation":  [...]
    }
  }
}
```

Aim for ~5 entries per category. Everything starts `verified: false`.

## 2 â€” Tell the codebase about the new culture

Two places (TypeScript on the frontend, Python on the backend):

**[backend/transform.py](../backend/transform.py)** â€” `StylePack`:
```python
StylePack = ("lebanese", "khaleeji", "moroccan", "najdi")
```

**[backend/prompt_builder.py](../backend/prompt_builder.py)** â€” `CULTURES`:
```python
CULTURES: tuple[CultureId, ...] = ("lebanese", "khaleeji", "moroccan", "najdi")
```

**[src/lib/api.ts](../src/lib/api.ts)** â€” `StyleId`:
```ts
export type StyleId = "lebanese" | "khaleeji" | "moroccan" | "najdi";
```

**[src/context/ImageContext.tsx](../src/context/ImageContext.tsx)** â€” `StyleId`:
same change.

**[src/context/ThemeLanguageContext.tsx](../src/context/ThemeLanguageContext.tsx)**:
add the `najdi` entry to `copy.shared.styles` for both `en` and `ar`
(flag, name, selectorDescription, origin, landingDescription, tags, learnMore).

## 3 â€” Curate the dataset

Create [`datasets/najdi/`](../datasets/najdi/) with the same layout as the
existing per-culture READMEs:

```
datasets/najdi/
â”œâ”€â”€ images/         # 20â€“40 photos, â‰¥1024Â², no people, no watermarks
â”œâ”€â”€ captions.jsonl  # one JSON/line, EN+AR, trigger phrase mandatory
â””â”€â”€ README.md       # culture-specific style fidelity rules
```

## 4 â€” Train the LoRA

On Local 8 GB GPU:

```bash
make train-lora CULTURE=najdi DATA_DIR=datasets/najdi RANK=16 STEPS=1500
```

Drops `models/loras/najdi/dardesign-najdi-lora.safetensors`. The backend picks
it up on the next request â€” no restart strictly required since LoRAs are
lazy-loaded per request.

## 5 â€” Pick ControlNet winners

```bash
make sweep        # generates outputs/sweeps/<room>_contact.png
# ...review, then edit configs/sweep_winners.json:
```

```jsonc
{
  ...,
  "najdi": [0.7, 0.5]
}
```

## 6 â€” Generate the demo set

```bash
make finals
```

Done. The new style now shows up in the StyleSelector on `/transform`, lazy-loads
its LoRA on every request, and is included in metrics + ablations.

