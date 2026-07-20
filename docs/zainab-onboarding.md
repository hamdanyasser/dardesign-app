# Zainab onboarding and cultural-data handoff

This is the single guide for running DarDesign and completing the cultural
review, dataset, training-review, and evidence tasks.

## Start locally

Install Git, Node.js 20+, and Python 3.10+, then:

```bash
git clone https://github.com/hamdanyasser/dardesign-app.git
cd dardesign-app
npm ci
npm run dev
```

In a second terminal, run the laptop-safe backend:

```bash
python -m pip install -r backend/requirements-light.txt
DARDESIGN_LIGHT=1 python -m uvicorn backend.main:app --port 8000
```

On PowerShell, set `$env:DARDESIGN_LIGHT = "1"` before the Uvicorn command.
Open <http://localhost:3000/studio>. LIGHT mode returns labelled placeholder
images but exercises the real upload, response, map, report, and audit flow.

For a backend-free presentation, open
<http://localhost:3000/studio?demo=1>. Defense Mode reads the pre-rendered
`public/demo` pack. Rebuild it from `outputs/finals` with
`python scripts/make_demo_pack.py` when a new final batch is approved.

## Your cultural review

Open [`ontology/ontology.json`](../ontology/ontology.json). For each cultural
entry:

- confirm the English and Arabic terms have the same meaning;
- confirm the term genuinely belongs to that culture and category;
- change `verified` to `true` only after review;
- correct or remove inaccurate entries, recording the reason in the commit.

The current review backlog is 30 Lebanese and 23 Persian entries; Khaleeji and
Moroccan entries are marked verified. Recount before reporting progress because
the file is the source of truth.

Leave `dardesign-<culture> style` training triggers unchanged. They are model
identifiers used in every caption and prompt, not translations for display.

`src/data/segmentation-labels.json` is separate: it contains generic ADE20K
room-object labels for frontend visualizations, not culture-specific prompt
knowledge.

## Curate the datasets

Each core culture has this local, Git-ignored structure:

```text
datasets/lebanese/
├── images/
│   ├── lebanese_001.jpg
│   └── ...
└── captions.jsonl
```

Use 20–40 strong room images where possible: at least 1024 px, no people,
watermarks, or embedded text, and at least one recognizable culture-specific
element. Quality and licensing matter more than reaching a round number. The
current local handoff contains 19 Lebanese, 14 Khaleeji, and 12 Moroccan image
and caption pairs, so the smaller sets need cautious training or prompt-only
use.

Each `captions.jsonl` line has this shape:

```json
{
  "file": "lebanese_001.jpg",
  "caption_en": "A Lebanese living room in the dardesign-lebanese style, ...",
  "caption_ar": "An Arabic caption with the agreed Arabic trigger and the same meaning",
  "tags": ["living_room", "triple_arch"],
  "license": "CC-BY-4.0",
  "source_url": "https://source.example/image"
}
```

The exact English trigger is mandatory in every English caption; the Arabic
equivalent is mandatory in the Arabic caption. Use
[`datasets/captions/template.jsonl`](../datasets/captions/template.jsonl) and
the per-culture dataset READMEs as the format and fidelity references. Complete
`datasets/LICENSING.csv` before any public result or defense claim.

## Train and select a LoRA

Follow [`kaggle/README.md`](../kaggle/README.md). Always smoke-test before the
full T4 run:

```bash
make smoke-train CULTURE=lebanese
make train-lora CULTURE=lebanese DATA_DIR=datasets/lebanese RANK=16 STEPS=1500
```

Training produces checkpoints and preview grids. With a small dataset, compare
steps 500, 1000, and 1500 for cultural recognizability **and** memorization.
Keep the best reviewed checkpoint as:

```text
models/loras/lebanese/dardesign-lebanese-lora.safetensors
```

Repeat for the other core cultures. For 12–14 images, consider fewer steps or
rank 8, or retain prompt-only behavior. The backend lazy-loads the canonical
filename and falls back to prompting if it is absent.

After the ControlNet sweep, inspect every
`outputs/sweeps/<room>_contact.png` and record the best depth/segmentation pair
per culture in `configs/sweep_winners.json`. This visual selection is a human
research decision, not an automatic metric.

## Evidence and optional product work

For the thesis evidence run, use `push_verify.py` on a Kaggle T4 with the
trained weights attached. Preserve its CLIP confusion matrices,
LoRA-versus-prompt-only grids, and SSIM/LPIPS outputs, then write a short
interpretation covering per-culture accuracy, structure preservation, cultural
distinctiveness, and limitations.

The previously proposed Cultural Atlas is optional future work, not a current
route. If approved, build `/atlas` as a bilingual, RTL-aware, searchable view
of `ontology/ontology.json`; do not present it as implemented until it ships.

## Safe contribution loop

1. Create a small feature branch from the team's current integration branch.
2. Run `npm run dev`, make one focused change, and review the diff.
3. Keep user copy bilingual and RTL-aware; reuse the existing design tokens
   instead of hardcoded colors.
4. Run `npm run build` and
   `DARDESIGN_LIGHT=1 python -m pytest tests -q` before pushing.
5. Coordinate before changing a live Kaggle session or its branch; never push
   while a real render is running.

Useful locations:

- `README.md` — setup, routes, commands, and FYP workflow
- `ARCHITECTURE.md` — current frontend/API/model data flow
- `docs/` — thesis, defense, survey, slide, and demo material
- `ontology/ontology.json` — reviewed cultural prompt knowledge
- `datasets/` — local training pairs and provenance audit
- `kaggle/README.md` — T4 upload, training, inference, and evaluation runbook

When uncertain about a caption, replace or rewrite it before retraining.
Thirty excellent licensed images are better evidence than forty weak ones.
