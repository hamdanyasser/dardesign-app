# DarDesign project guide

DarDesign is a bilingual English/Arabic FYP that redesigns one room into
Lebanese, Khaleeji, and Moroccan styles. Read [README.md](README.md) for setup
and workflows, then [ARCHITECTURE.md](ARCHITECTURE.md) for current contracts and
data flow. Those files are the maintained project references.

## Current product

- `/` is the cinematic landing; `/studio` is the primary application.
- `/studio?demo=1` is backend-free Defense Mode using `public/demo`.
- `/v2` is the “Understood Room” experience; `/audit` shows metadata-only
  generation records; `/atelier.html` is a preserved static reference.
- `/transform` and `/result` redirect to `/studio`. Do not remove them.
- `POST /redesign` returns the original and three core styles plus optional
  segmentation regions, object map, and depth map.
- `POST /restyle` renders one culture at a selected intensity; Persian is the
  prompt-only fourth culture.
- The legacy asynchronous upload/transform/status/result and share API remains
  supported.

## Development commands

```bash
npm ci
npm run dev
npm run build

python -m pip install -r backend/requirements-light.txt
DARDESIGN_LIGHT=1 python -m uvicorn backend.main:app --port 8000
DARDESIGN_LIGHT=1 python -m pytest tests -q
```

On PowerShell, set `$env:DARDESIGN_LIGHT = "1"` before Python commands.
Full SDXL work uses `backend/requirements.txt` on a Kaggle T4; see
`kaggle/README.md`.

## Sources of truth

- `src/lib/api.ts`: public frontend API types and request behavior.
- `backend/main.py`: FastAPI schemas and routes.
- `backend/transform.py`: canonical LIGHT/GPU inference pipeline.
- `ontology/ontology.json`: culture-specific bilingual prompt vocabulary.
- `src/data/segmentation-labels.json`: generic ADE20K labels used by browser
  visualizations; it is not the cultural ontology.
- `configs/sweep_winners.json`: reviewed ControlNet weight pairs.

The three core style identifiers are part of the `/redesign` contract. A new
prompt-only culture belongs in `/restyle`; promoting one to the core grid
requires the coordinated changes in `docs/add_a_culture.md`.

## Working rules

- Keep changes small, typed, bilingual, RTL-aware, and covered by validation
  and clear error handling.
- Preserve API response fields and public TypeScript types unless a contract
  change is explicitly requested.
- Reuse CSS variables and existing visual language; do not hardcode colors or
  user-facing copy when a shared source exists.
- Keep secrets, raw datasets, weights, generated outputs, audit data, and
  `.env.local` out of Git.
- LIGHT mode must remain honest about placeholder output. Never present it as
  model evidence.
- Run the production frontend build and LIGHT pytest suite before handoff.
- Use `scripts/metrics.py`, `scripts/controlnet_sweep.py`,
  `scripts/baseline_grid.py`, and `push_verify.py` for maintained evaluation
  workflows.
