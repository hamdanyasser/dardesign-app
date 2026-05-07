# Add a culture (e.g. "Najdi", "Andalusi", "Egyptian")

Worked example: adding `najdi` (Saudi central-region heritage).

## 1 — Extend the ontology

Edit [`ontology/ontology.json`](../ontology/ontology.json):

```jsonc
{
  "trigger": {
    ...,
    "najdi": {
      "en": "dardesign-najdi style",
      "ar": "نمط دار-ديزاين-نجدي"
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

## 2 — Tell the codebase about the new culture

Two places (TypeScript on the frontend, Python on the backend):

**[backend/transform.py](../backend/transform.py)** — `StylePack`:
```python
StylePack = ("lebanese", "khaleeji", "moroccan", "najdi")
```

**[backend/prompt_builder.py](../backend/prompt_builder.py)** — `CULTURES`:
```python
CULTURES: tuple[CultureId, ...] = ("lebanese", "khaleeji", "moroccan", "najdi")
```

**[src/lib/api.ts](../src/lib/api.ts)** — `StyleId`:
```ts
export type StyleId = "lebanese" | "khaleeji" | "moroccan" | "najdi";
```

**[src/context/ImageContext.tsx](../src/context/ImageContext.tsx)** — `StyleId`:
same change.

**[src/context/ThemeLanguageContext.tsx](../src/context/ThemeLanguageContext.tsx)**:
add the `najdi` entry to `copy.shared.styles` for both `en` and `ar`
(flag, name, selectorDescription, origin, landingDescription, tags, learnMore).

## 3 — Curate the dataset

Create [`datasets/najdi/`](../datasets/najdi/) with the same layout as the
existing per-culture READMEs:

```
datasets/najdi/
├── images/         # 20–40 photos, ≥1024², no people, no watermarks
├── captions.jsonl  # one JSON/line, EN+AR, trigger phrase mandatory
└── README.md       # culture-specific style fidelity rules
```

## 4 — Train the LoRA

On Kaggle T4:

```bash
make train-lora CULTURE=najdi DATA_DIR=datasets/najdi RANK=16 STEPS=1500
```

Drops `models/loras/najdi/dardesign-najdi-lora.safetensors`. The backend picks
it up on the next request — no restart strictly required since LoRAs are
lazy-loaded per request.

## 5 — Pick ControlNet winners

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

## 6 — Generate the demo set

```bash
make finals
```

Done. The new style now shows up in the StyleSelector on `/transform`, lazy-loads
its LoRA on every request, and is included in metrics + ablations.
