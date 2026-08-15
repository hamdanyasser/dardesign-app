# 01 — Project Overview

*Written to be understandable by a university jury with no prior exposure to the codebase.*

---

## 1. The problem

Generative interior-design tools ("upload a room, get a redesign") are widely available.
They share three failures when applied to **Arab domestic interiors**:

1. **Cultural flattening.** A prompt containing the word "Moroccan" produces a
   tourist-brochure pastiche. The model has no structured notion of *zellige* versus
   *tadelakt*, of a *majlis* versus a Western living room, or of what distinguishes
   Lebanese Levantine from Khaleeji Gulf interiors.
2. **No spatial truth.** The output is a picture, not a plan. Furniture may float,
   overlap, block a doorway, or be the wrong size for the room. Nothing in the system
   knows how big anything is.
3. **No user control.** The user gets an image and can only re-roll. They cannot move the
   sofa 40 cm to the left and keep everything else.

## 2. What DAR does about it

DAR separates **taste** from **truth**:

- **Cultural knowledge is curated, not recalled.** A hand-authored ontology
  (`ontology/ontology.json`) holds the architectural, material, colour, lighting,
  furniture, textile and ornamentation vocabulary of each culture in Arabic and English.
  Prompts are *built* from it, not typed.
- **Spatial decisions are deterministic.** Every furniture piece has real centimetre
  dimensions from a catalogue. Placement is judged by an oriented-rectangle
  separating-axis collision test written in TypeScript — the same code path whether a
  human dragged the piece or an LLM proposed it.
- **The user edits a real 3D scene.** Build Mode is a metric room editor. The room the
  user edits is reconstructed *from their own photograph*, so they continue designing
  their actual room rather than a blank grid. Every piece is labelled by how honestly it is
  drawn — **REAL MODEL** (1 CC0 scan), **ENHANCED PROCEDURAL** (26), or **FALLBACK MASSING**
  (objects read off the photograph).
- **The renderer is conditioned on the scene, not asked to imagine it.** The 3D scene's
  own depth map and semantic segmentation map are captured and fed to SDXL's dual
  ControlNet. Layout stops being something the model infers from a sentence.

## 3. The one-line architecture

> **The LLM designs. DAR validates. The user edits. ControlNet + SDXL renders.**

Expanded, and verified against the implementation:

| Stage | Owner | Nature |
|---|---|---|
| Understand the room | Depth Anything V2 + OneFormer ADE20K | AI / ML |
| Hold the cultural vocabulary | `ontology/ontology.json`, `ontology/furniture.json` | Curated knowledge |
| Interpret the brief, choose pieces & positions | LLM (Gemini or Claude) | AI / ML |
| Decide whether a piece may stand there | `placement.ts` SAT engine | **Deterministic** |
| Let the user change anything | Build Mode (three.js) | User control |
| Turn the scene into a photograph | SDXL + dual ControlNet + cultural LoRA | Generative AI |

## 4. Target users

| User | What they do | Route |
|---|---|---|
| **Homeowner / resident** | Upload a room photo, see it redesigned in three Arab styles, save and rate the result | `/studio`, `/history` |
| **Design-minded user** | Enter Build Mode, describe a room in plain Arabic or English, edit the resulting layout, re-render | `/design` |
| **Community member** | Publish a design to the shared gallery; browse and rate others' work | `/others` |
| **Administrator (FYP author)** | Approve Pro subscriptions, inspect the render audit trail, read the evaluation dashboard | `/admin/*`, `/audit`, `/evaluation` |

## 5. Main user experiences

### A. Studio — photo to three cultures
Upload → one `POST /redesign` (~1–2 min) → the original plus Lebanese, Khaleeji and
Moroccan redesigns, **plus** the room's segmentation regions, top-down object map, depth
map and room analysis, all from a single depth+segmentation pass.
→ [17_FULL_DATA_FLOW.md#flow-a](17_FULL_DATA_FLOW.md)

### B. Build Mode — the editable room
From a Studio result, DAR reconstructs a metric 3D room: the floor area is backed out of
the room analysis, and the furniture detected in the photograph is rebuilt as **locked
"found" massing**. The user adds catalogue pieces, moves, rotates, re-materials and
deletes them, with live collision feedback.
→ [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md)

### C. The design planner — natural language to a layout
The user writes *"a majlis for eight people, keep the centre open, warm beige walls"*.
One LLM call returns both an **interpretation** of the brief (culture, room type, capacity,
intensity, wall/floor material, stated requirements) and a **list of catalogue pieces with
positions**. Every field is validated against a vocabulary DAR already owns; every
placement is re-checked by the collision engine before it appears.
→ [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md)

### D. Render with DAR — the scene becomes a photograph
Build Mode renders three offscreen passes from an interior camera: a beauty pass (shown as
evidence), a linear **depth** pass and a flat **ADE20K segmentation** pass. The last two are
posted to `/render-scene`, which substitutes them for the annotator output that
`/redesign` would normally derive from a photograph, and runs the ordinary cultural
pipeline.
→ [11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md)

### E. Explaining itself
Six explanation surfaces — Understood Room, Design Story, Culture DNA, Inside DAR, Room
Report, and the conditioning evidence strip — all gated so that a placeholder or
unmeasured value renders as an em-dash rather than a fabricated number.
→ [14_EXPLAINABILITY.md](14_EXPLAINABILITY.md)

## 6. Major technical components

```
┌── FRONTEND ────────────────────────────────────────────────┐
│ Next.js 16 · React 19 · TypeScript 5 · Tailwind · three 0.150│
│ /studio  /design  /history  /others  /subscription  /admin  │
└────────────────────────────────────────────────────────────┘
              │  HTTPS (two base URLs, deliberately)
    ┌─────────┴──────────┐
    ▼                    ▼
┌── RENDER HOST ──┐  ┌── DATA HOST ─────────────────┐
│ Kaggle T4 GPU   │  │ Local machine / always-on    │
│ /redesign       │  │ accounts, history, ratings,  │
│ /restyle        │  │ subscriptions, admin,        │
│ /render-scene   │  │ evaluation, the LLM planner  │
│ /api/furniture/*│  │ SQLite: backend/dardesign.db │
│ /api/color/*    │  │                              │
└─────────────────┘  └──────────────────────────────┘
   FastAPI 0.115 · one codebase (backend/), two roles
```

**Models used:**

| Role | Model |
|---|---|
| Depth | `depth-anything/Depth-Anything-V2-Small-hf` |
| Semantic segmentation | `shi-labs/oneformer_ade20k_swin_large` |
| Image generation | `stabilityai/stable-diffusion-xl-base-1.0` |
| ControlNet (depth) | `diffusers/controlnet-depth-sdxl-1.0` |
| ControlNet (segmentation) | `SargeZT/sdxl-controlnet-seg` |
| Cultural adaptation | 3 × in-house LoRA, rank 16, trained on a free Kaggle T4 |
| OOM fallback | `runwayml/stable-diffusion-v1-5` + ControlNet 1.1 at 768² |
| Design planning | `gemini-3.5-flash` (live) or `claude-sonnet-5` (code default) |

→ [24_TECHNOLOGY_STACK.md](24_TECHNOLOGY_STACK.md)

## 7. The three cultures

| ID | Arabic | Motif | LoRA trained | Ontology terms | Expert-verified |
|---|---|---|---|---|---|
| `lebanese` | لبناني | *qanater* — triple arch, limestone, cedar | ✅ 93 MB | 30 | ❌ **`verified: false`** |
| `khaleeji` | خليجي | *majlis* — brass lamp, deep-shadow bench | ✅ 93 MB | 30 | ✅ `verified: true` |
| `moroccan` | مغربي | *zellige* — cobalt tessellation | ✅ 93 MB | 30 | ✅ `verified: true` |
| `persian` | فارسي | — | ❌ **none** | 23 | ❌ `verified: false` |

**Persian is prompt-only.** It exists in the ontology and in `/restyle`, but is excluded
from `/redesign`, from Build Mode and from the furniture catalogue. It exists to
demonstrate the scalability claim — *adding culture N costs one ontology entry, not a
retraining run* — not as a fourth supported product culture.
→ [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md)

## 8. The core differentiator

Most tools in this space are **one-shot image translators**. DAR is a
**round-trip design system**:

```
photograph → structured understanding → editable metric 3D scene → photorealistic render
                     ▲                                    │
                     └──── the user can intervene at ─────┘
                            every single one of these stages
```

The technical claim that makes this possible, and that the code supports:

> Because DAR already renders the scene in 3D, it can produce the **exact two control
> images** — depth and ADE20K segmentation — that the existing generation pipeline
> already consumed from photographs. So the user's edits reach the renderer as a
> *control signal*, not as a description. **No model, notebook or training change was
> required to add Build Mode rendering** — `_generate()` gained one optional
> `control_override` parameter, and when it is `None` the original `/redesign` path is
> byte-for-byte unchanged.

## 9. What is honestly not proven

Stated here so it is never overstated elsewhere:

- **Layout-preservation quality is unmeasured.** There is no side-by-side study.
- **LPIPS, CLIP and the culture-recognition confusion matrix currently hold zero data.**
  The code computes them; the corpus has not been generated.
- **Lebanese ontology terms are not expert-verified**, and Lebanese is the hero culture.
- **Room height and aspect ratio are assumptions**, not measurements.
- **Real GPU renders require a Kaggle T4 behind a rotating tunnel.** Without it the
  backend runs in `DARDESIGN_LIGHT` placeholder mode.

→ [20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)
