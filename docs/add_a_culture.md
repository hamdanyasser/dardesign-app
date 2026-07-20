# Add a culture to DarDesign

DarDesign supports two deliberate extension levels:

- **Prompt-only culture:** available through the Style Intensity section in
  `/studio` and `POST /restyle`; no training or flagship API change.
- **Core trained culture:** also returned by `POST /redesign` and shown in the
  main result grid; requires data, a LoRA, UI work, evaluation, and an additive
  API-contract change.

Persian is the working prompt-only example. Lebanese, Khaleeji, and Moroccan
are the current core cultures. Choose the extension level before editing so a
simple ontology experiment does not accidentally change the stable
three-result flow.

## 1. Add the cultural vocabulary

Edit [`ontology/ontology.json`](../ontology/ontology.json). Add both a trigger
and a culture object with the existing seven categories:

```jsonc
{
  "trigger": {
    "najdi": {
      "en": "dardesign-najdi style",
      "ar": "the agreed Arabic training trigger"
    }
  },
  "cultures": {
    "najdi": {
      "negative_specific": ["features this culture must avoid"],
      "architectural": [
        {
          "en": "bilingual reviewed term",
          "ar": "المصطلح العربي المراجع",
          "weight": 1.2,
          "verified": false
        }
      ],
      "materials": [],
      "color_palette": [],
      "lighting": [],
      "furniture": [],
      "textiles": [],
      "ornamentation": []
    }
  }
}
```

Aim for several precise entries in every category. New entries start with
`verified: false` and must be reviewed by the cultural/data owner. Once a
trigger has been used in captions or training, treat it as a model identifier:
changing it breaks alignment between prompts and weights.

`src/data/segmentation-labels.json` is a different file. It maps generic
ADE20K object classes such as wall, sofa, and rug to labels used by the
highlighter, room map, and report. Adding a culture does **not** require editing
that file unless the UI also needs a previously unmapped segmentation class.

## 2. Register a prompt-only culture

Update the explicit allowlists and UI selector:

1. In `backend/prompt_builder.py`, extend `CultureId` and `CULTURES`.
2. In `backend/transform.py`, extend `StyleId` and `StylePack`, plus the
   LIGHT-mode placeholder palette. Do not add the culture to `CORE_STYLES`.
3. In `src/lib/api.ts`, extend `RestyleStyleId`.
4. In `src/components/StyleIntensitySlider.tsx`, add the identifier and
   bilingual display name to `ORDER` and `NAMES`.

The culture will then be selectable after a user completes the main
`/studio` redesign. `POST /restyle` accepts its `style` and an intensity
`scale` from 0 to 1. With no canonical LoRA file, the backend logs the missing
weight and renders prompt-only.

Do not add a prompt-only culture to the main `StyleId`,
`ThemeLanguageContext`, `STYLE_ORDER`, or `RedesignResponse`. Those belong
to the stable core grid.

## 3. Promote it to a trained core culture

First curate a licensed dataset:

```text
datasets/najdi/
├── images/          20–40 high-quality JPG/PNG rooms, at least 1024 px
├── captions.jsonl   one bilingual JSON object per line
└── README.md        culture-specific inclusion/exclusion guidance
```

Every English caption must contain the exact English trigger. Record the source
URL and license in the caption record and in `datasets/LICENSING.csv`.

Train and review the LoRA on a Kaggle T4:

```bash
make smoke-train CULTURE=najdi DATA_DIR=datasets/najdi
make train-lora CULTURE=najdi DATA_DIR=datasets/najdi RANK=16 STEPS=1500
```

Keep the selected production weight at:

```text
models/loras/najdi/dardesign-najdi-lora.safetensors
```

Then extend the core contract deliberately:

1. Add `najdi` to `CORE_STYLES` and the `RedesignResponse` schema in the
   backend.
2. Extend the public frontend `StyleId`, `RedesignResult`, response-key
   validation, ImageContext style type, bilingual style copy, and the
   `/studio` tile/order/motif configuration.
3. Add the culture to the defaults used by
   `scripts/controlnet_sweep.py`, `scripts/generate_finals.py`, and
   `scripts/ablate.py`; add its selected pair to
   `configs/sweep_winners.json`.
4. Extend `scripts/make_demo_pack.py` and regenerate `public/demo` so Defense
   Mode contains the new core result for every room.
5. Preserve the existing Lebanese, Khaleeji, and Moroccan response fields for
   backward compatibility.

Review the ControlNet contact sheets before generating the final and defense
sets:

```bash
make sweep
# record the chosen [depth, segmentation] pair in configs/sweep_winners.json
make finals
make ablate
make metrics
python scripts/make_demo_pack.py
```

## 4. Acceptance checks

- `python -m backend.prompt_builder --culture najdi --room "living room"`
  emits the agreed trigger and only valid ontology terms.
- LIGHT-mode `POST /restyle` accepts the new culture and rejects unknown
  identifiers.
- A prompt-only addition leaves the `POST /redesign` response unchanged.
- A core addition returns a valid image for every documented field and appears
  consistently in the Studio, generated finals, metrics, and Defense Mode.
- `npm run build` and
  `DARDESIGN_LIGHT=1 python -m pytest tests -q` pass.
- Cultural vocabulary and dataset licenses have named human reviewers; model
  quality is assessed for both recognizability and memorization.
