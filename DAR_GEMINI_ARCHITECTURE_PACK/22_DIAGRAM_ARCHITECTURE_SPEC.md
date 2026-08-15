# 22 — Diagram Architecture Specification

*The **content** of the diagrams DAR needs. This document does not generate images; it
specifies exactly what must appear, what must not, and how it should be arranged.*

**Three diagrams are specified:**
- **HERO** — the one-page jury infographic (§2–§7)
- **SECONDARY A** — full technical architecture (§8)
- **SECONDARY B** — AI / LLM / grounding / validation close-up (§9)

---

## 1. Global rules — apply to all three

### Canvas
- **16:9 landscape.** Target 1920 × 1080 minimum.
- **Projector-readable**: smallest body text ≥ 14 pt at 1920 px wide. Assume the back row
  of a lecture theatre.
- Generous whitespace. **A crowded architecture diagram is an unread architecture diagram.**

### Colour semantics — use these consistently across all three diagrams

| Meaning | Colour | Applies to |
|---|---|---|
| **[AI/ML]** — a learned model makes a judgement | **Violet / purple** | Depth Anything, OneFormer, LLM planner, LPIPS, CLIP |
| **[GENERATIVE AI]** — pixels are synthesised | **Magenta / deep pink** | SDXL, ControlNet, LoRA |
| **[DETERMINISTIC]** — ordinary code, no model | **Teal / green** | SAT collision, gatePlan, validate_items, room derivation, prompt builder |
| **[CULTURAL KNOWLEDGE]** — curated data | **Amber / ochre** | ontology.json, furniture.json, catalogue |
| **[3D]** — the three.js scene | **Blue** | Build Mode, renderConditioning |
| **[USER CONTROL]** — a human acts | **Neutral dark / charcoal** | upload, brief, edits, viewpoint |
| **[BACKEND/DATA]** — storage & accounts | **Slate grey** | SQLite, history, auth |
| **NOT IMPLEMENTED** | **Dashed outline, 40 % opacity, no fill** | RAG, ablation results |

> **The single most important visual decision: [AI/ML] and [DETERMINISTIC] must be
> immediately distinguishable at a glance.** The whole argument of the project is that
> these are different, and that DAR keeps authority on the deterministic side.

### Shapes
| Shape | Meaning |
|---|---|
| Rounded rectangle | A process / component |
| Cylinder | A data store |
| Parallelogram | A file / artifact (an image, a JSON payload) |
| **Hexagon** | **A validation gate** — reserve this shape; it is DAR's signature |
| Stick figure or circle | The user |

### Arrows
- **Solid, filled arrowhead** — the primary data path
- **Dashed** — a fallback or degraded path (OOM → SD1.5; no key → rules)
- **Dotted** — an optional / skippable path
- **Every arrow carries a label naming what flows** — never a bare arrow
- **Direction: left → right for the main pipeline; top → bottom for layer descent.** Do not
  mix within one band.

### Labels
- Component name in **bold**, ≤ 4 words.
- One line of clarification beneath, ≤ 8 words.
- **Exact model identifiers** where they exist (`SDXL 1.0`, `Depth Anything V2`,
  `OneFormer ADE20K`, `Gemini 3.5 Flash`).
- **Never put a metric value on any diagram** — there are almost none, and an invented one
  is fatal.

---

## 2. HERO diagram — the corrected master flow

The flow in the original brief was close. **Two corrections are required by the code:**

| Original | Corrected | Why |
|---|---|---|
| `CULTURAL INTELLIGENCE` as a **stage** in the vertical chain | A **side rail** feeding three stages | The ontology is not a step the data passes *through* — it feeds the prompt builder, the catalogue/planner, and the 3D materials, in parallel |
| `GEMINI DESIGNER` unqualified | **`LLM DESIGNER — Gemini 3.5 Flash`** with a dashed **`rule-based fallback`** branch | The planner is provider-agnostic and has a no-key path that CI exercises |

**Also required:** a branch showing that **Build Mode is optional** — Studio's `/redesign`
path produces a finished cultural render without ever entering the editor.

### The approved hero flow

```
                          ┌──────────────────────────────┐
                          │  [CULTURAL KNOWLEDGE]        │
                          │  DAR CULTURAL ONTOLOGY       │
                          │  ontology.json · 113 terms   │
                          │  furniture.json · 27 pieces  │
                          │  3 cultures, EN + AR         │
                          └───┬────────┬────────┬────────┘
                              │        │        │
   [USER]                     │        │        │
   ┌────────┐                 │        │        │
   │  USER  │  room photo     │        │        │
   └───┬────┘                 │        │        │
       ▼                      │        │        │
 ┌───────────────────────┐    │        │        │
 │ [AI/ML]               │    │        │        │
 │ ROOM UNDERSTANDING    │    │        │        │
 │ Depth Anything V2     │    │        │        │
 │ OneFormer ADE20K      │    │        │        │
 └───────┬───────────────┘    │        │        │
         │ depth · seg ·      │        │        │
         │ object map         │        │        │
         ├──────────────────────────────────────────────────┐
         │                    │        │        │           │ (Studio path —
         ▼                    ▼        │        │           │  Build Mode is
 ┌───────────────────────────────┐     │        │           │  OPTIONAL)
 │ [AI/ML]                       │◀────┘        │           │
 │ LLM DESIGNER                  │              │           │
 │ Gemini 3.5 Flash              │              │           │
 │ reads the brief → understands │              │           │
 │ proposes catalogue pieces     │              │           │
 └───────┬───────────────────────┘              │           │
         │ ⌐ ─ ─ ─ ─ ─ ─ ─ ┐ (no key)           │           │
         │   rule-based    │                    │           │
         │   fallback ─ ─ ─┘                    │           │
         │ proposed layout                      │           │
         ▼                                      │           │
 ╔═══════════════════════════════╗              │           │
 ║ [DETERMINISTIC]   ⬡ GATE      ║              │           │
 ║ DAR SPATIAL VALIDATOR         ║              │           │
 ║ oriented-rect SAT collision   ║              │           │
 ║ catalogue enum · culture      ║              │           │
 ║ door/window keep-clear        ║              │           │
 ║ blocking vs advisory          ║              │           │
 ╚═══════┬═══════════════════════╝              │           │
         │ validated placements                 │           │
         ▼                                      ▼           │
 ┌───────────────────────────────┐◀─────────────┘           │
 │ [3D] + [USER CONTROL]         │                          │
 │ BUILD MODE                    │                          │
 │ metric three.js room, cm      │                          │
 │ 1 real CC0 scan + 26          │                          │
 │ procedural pieces             │                          │
 └───────┬───────────────────────┘                          │
         │                                                  │
         ▼                                                  │
 ┌───────────────────────────────┐                          │
 │ [USER CONTROL]                │                          │
 │ USER EDITS                    │                          │
 │ move · rotate · add · material│                          │
 └───────┬───────────────────────┘                          │
         │                                                  │
         ▼                                                  │
 ┌───────────────────────────────┐                          │
 │ [3D]                          │                          │
 │ DEPTH + SEGMENTATION CAPTURE  │                          │
 │ interior camera, eye 155 cm   │                          │
 │ the scene becomes the control │                          │
 └───────┬───────────────────────┘                          │
         │ 2 control images                                 │
         ▼                                                  ▼
 ┌────────────────────────────────────────────────────────────┐
 │ [GENERATIVE AI]                                            │
 │ SDXL 1.0  +  DUAL CONTROLNET  +  CULTURAL LoRA             │
 │ depth CN 0.7 · seg CN 0.5 · LoRA scale 0.8                 │
 │            ⌐ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                           │
 │              OOM → SD 1.5 @768² ┘                          │
 └───────────────────────┬────────────────────────────────────┘
                         ▼
              ┌─────────────────────────┐
              │ FINAL CULTURAL INTERIOR │
              └─────────────────────────┘
```

---

## 3. HERO — what MUST appear

| Element | Why it is non-negotiable |
|---|---|
| The **USER** at the top **and** touching the edit stage | The user-control claim is a core differentiator |
| **Depth Anything V2** + **OneFormer ADE20K** named | Specificity is what makes it credible |
| The **ontology as a SIDE RAIL** feeding three stages | It is not a pipeline step |
| **"Gemini 3.5 Flash"** on the LLM node | Accurate, and what the audience will ask about |
| The **dashed rule-based fallback** | Demonstrates the system is never dark |
| The **VALIDATOR as a hexagon in [DETERMINISTIC] colour** | ⭐ **The single most important box on the page** |
| **"blocking vs advisory"** on the validator | The design decision that made the editor usable |
| **Both control images** into SDXL, labelled `depth` and `segmentation` with their weights | The technical heart |
| **LoRA** shown as *attached to* SDXL, not as a separate stage | It is fused into the UNet |
| The **dashed OOM → SD 1.5** branch | The free-T4 constraint that shaped the system |
| The **Studio bypass arrow** (skipping Build Mode) | Otherwise the diagram implies Build Mode is mandatory |
| A **legend** | See §7 |

## 4. HERO — what MUST NOT appear

| ❌ Never | Reason |
|---|---|
| **A RAG / vector store / embedding / retriever node** | **Does not exist** |
| **A "3D model library" implying many assets** | There is **exactly one** CC0 model (of 27 pieces). If shown at all, label it "1 real CC0 scan + 26 procedural" |
| Any **metric value** (SSIM, LPIPS, CLIP, accuracy, % ) | Almost none are measured |
| **Persian** as a supported culture | Prompt-only, no LoRA, no catalogue |
| Auth, subscriptions, admin, history, evaluation | Belongs in **Secondary A** |
| Colour Control / Furniture Placement / Room Report | Secondary A |
| The retired `/upload`+`/transform`+`/status` flow | Retired |
| Six Studio result tabs | Dead code — only three tabs render |
| Endpoint paths, function names, file paths | Secondary A |
| Time-of-day / sun simulation in Build Mode | That is `/v2`, a different feature |

---

## 5. HERO — layout for 16:9

**Three vertical bands.** The eye reads left → right, then follows the spine down.

```
┌─ LEFT (20%) ────┬─ CENTRE (55%) ───────────────┬─ RIGHT (25%) ─────┐
│                 │                              │                   │
│  USER           │   THE SPINE                  │  CULTURAL         │
│  ↓ photo        │   (the 8 stages, top→bottom) │  ONTOLOGY         │
│  ↓ brief        │                              │  side rail        │
│  ↓ edits        │   with the VALIDATOR          │  ↳ feeds prompt   │
│                 │   visually emphasised at      │  ↳ feeds planner  │
│  LEGEND         │   the centre of gravity       │  ↳ feeds 3D       │
│                 │                              │                   │
└─────────────────┴──────────────────────────────┴───────────────────┘
                          FINAL RENDER (bottom, full width, emphasised)
```

**Alternative if vertical space is tight:** run the spine **left → right** across the full
width in 8 columns, with the ontology as a band **above** and the user as a band **below**,
both connecting upward/downward into the spine. This reads better on a wide projector.

**Emphasis hierarchy** (largest/boldest first):
1. The **DAR SPATIAL VALIDATOR** hexagon
2. **SDXL + DUAL CONTROLNET + LoRA**
3. **ROOM UNDERSTANDING** and **LLM DESIGNER**
4. Everything else

---

## 6. HERO — the one-line caption

Place this **directly under the title**, in the largest non-title type:

> ## The LLM designs · DAR validates · the user edits · ControlNet + SDXL renders

Optionally, as a subtitle:

> *Cultural knowledge is curated, not recalled. Spatial decisions are deterministic, not
> generated. Layout is conditioned, not described.*

---

## 7. HERO — legend and jury reading order

**Legend** — bottom-left, one compact block:

```
■ AI / ML model          ■ Generative AI        ■ Deterministic code
■ Cultural knowledge     ■ 3D scene             ■ User control
⬡ Validation gate     ── primary path      ⌐─ ─ fallback path
```

**Jury reading order** — number the stages **1–8** in small circled numerals so a presenter
can point:

| # | Stage | The one sentence to say |
|---|---|---|
| 1 | User photo | *"It starts with a photograph of a real room."* |
| 2 | Room understanding | *"Two models read it — depth and semantic segmentation."* |
| 3 | Cultural ontology | *"Cultural knowledge is a curated, auditable file, not something the model recalls."* |
| 4 | LLM designer | *"The model reads the brief and proposes pieces from a fixed catalogue."* |
| 5 | **Spatial validator** | ⭐ *"And here is the point: DAR decides whether that is allowed — with the same collision engine that judges a human's drag."* |
| 6 | Build Mode | *"The user gets a real, metric, editable 3D room."* |
| 7 | Depth + seg capture | *"Because it is 3D, DAR can produce the exact two control images the generator already used."* |
| 8 | SDXL render | *"So the layout is not described to the model — it is imposed on it."* |

---

## 8. SECONDARY A — Full Technical Architecture

**Purpose:** the complete system for a technical examiner. **Density is acceptable here.**

**Layout: five horizontal layers**, top to bottom.

```
LAYER 1  [FRONTEND]  Next.js 16 · React 19 · three.js 0.150
  /studio  /design  /history  /others  /subscription  /evaluation  /admin/*  /audit  /v2
  contexts: ThemeLanguage (EN/AR + RTL) · Auth · Image
  key modules: lib/api.ts · lib/design/{placement,planner,store,scene3d,geometry,roomModel}

LAYER 2  [API BOUNDARY]  ← show the TWO-HOST SPLIT explicitly, side by side
  ┌ NEXT_PUBLIC_API_URL ────────┐   ┌ NEXT_PUBLIC_DATA_API_URL ──────────┐
  │ RENDER HOST — Kaggle T4      │   │ DATA HOST — local machine          │
  │ ephemeral · no users table   │   │ SQLite + images/ · holds LLM key   │
  │ /redesign /restyle           │   │ /api/auth/* /api/history/*         │
  │ /render-scene                │   │ /api/feedback /api/subscription    │
  │ /api/furniture/* /api/color/*│   │ /api/usage/consume                 │
  │ /share /audit /healthz       │   │ /api/design/plan  (AUTHED)         │
  └──────────────────────────────┘   │ /api/admin/*                       │
                                     └────────────────────────────────────┘

LAYER 3  [BACKEND]  one FastAPI app (backend/main.py, v0.3.0), two roles
  main.py · transform.py · design_planner.py · room_analysis.py · projection.py
  prompt_builder.py · furniture.py · placement.py · compositing.py · recolor.py
  quality.py · evaluation.py · db.py · auth.py · subscriptions.py · mailer.py
  jobs.py · ttl_cleanup.py · audit.py · share.py · validators.py · errors.py · guardrails.py
  ⚠ mark _GEN_LOCK spanning all four generating endpoints
  ⚠ mark _stream_keepalive on /redesign and /restyle

LAYER 4  [AI/ML] + [GENERATIVE AI]
  Depth Anything V2 Small │ OneFormer ADE20K Swin-L │ Gemini 3.5 Flash / Claude Sonnet 5
  SDXL 1.0 + ControlNet(depth 0.7, seg 0.5) + LoRA×3 (rank 16)  →  OOM → SD 1.5 @768²
  LPIPS AlexNet · CLIP ViT-B-32   ← draw these DASHED (not installed)

LAYER 5  [CULTURAL KNOWLEDGE] + [BACKEND/DATA]
  ontology/ontology.json · ontology/furniture.json · configs/pipeline.yaml
  configs/sweep_winners.json · models/loras/{3} · public/furniture/{27 PNG}
  SQLite: users · history · feedback · subscription_requests · evaluation_results
  audit.jsonl · uploads/ (24 h TTL)
```

**Must also show:**
- `DARDESIGN_LIGHT=1` as a **mode switch** on `transform.py`, not a mock
- The **three editing systems** side by side, clearly separated: Colour Control (HSV on a
  PNG) · Furniture Placement (compositing on a PNG) · Render with DAR (re-generation from
  a 3D scene)
- `evaluation_results` and the LPIPS/CLIP nodes **dashed** — implemented, no data
- The **retired async flow** in grey, labelled *retired*

---

## 9. SECONDARY B — AI / Grounding / Validation Close-up

**Purpose:** the intellectual core. This is the diagram that wins the technical argument.

**Layout: left → right, with the six gates as a vertical stack of hexagons in the centre.**

```
┌ INPUT ─────────┐   ┌ THE MODEL ────────────┐   ┌ THE GATES ──────┐   ┌ RESULT ────┐
│ natural-language│   │ [AI/ML]               │   │ [DETERMINISTIC] │   │            │
│ brief           │──▶│ LLM DESIGN PLANNER    │──▶│ ⬡1 JSON-Schema  │──▶│ validated  │
│ (AR or EN)      │   │ Gemini 3.5 Flash      │   │    ENUM         │   │ furniture  │
│                 │   │ (or Claude Sonnet 5)  │   │    an invented  │   │ in an      │
│ room rectangle  │──▶│                       │   │    id is UN-    │   │ editable   │
│ found objects   │──▶│ ONE call returns:     │   │    REPRESENTABLE│   │ 3D room    │
│ detected        │──▶│  • understood{}       │   │ ⬡2 no size      │   │            │
│ openings        │   │  • items[]            │   │    fields       │   │ + a list   │
│                 │   │                       │   │ ⬡3 validate_    │   │   of what  │
└─────────────────┘   │ emits NO dimensions   │   │    items()      │   │   was      │
                      │ emits NO invented ids │   │ ⬡4 gatePlan →   │   │   REFUSED  │
   ┌ GROUNDING ────┐  │                       │   │    SAT collision│   │            │
   │[CULTURAL]     │  │ ⌐─ ─ ─ ─ ─ ─ ─ ┐      │   │    ⭐ the same  │   └────────────┘
   │ furniture.json│─▶│  no key →       │      │   │    engine a     │
   │ 27 pieces     │  │  RULE-BASED ─ ─ ┘      │   │    human drag   │
   │ real cm       │  └───────────────────────┘   │    uses         │
   │               │                              │ ⬡5 culture      │
   │ ontology.json │──────────────────────────────│    coherence    │
   │ 113 terms     │   (also → prompt builder)    │ ⬡6 door 90cm /  │
   └───────────────┘                              │    window 40cm  │
                                                  └─────────────────┘
   ┌ NOT PRESENT ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
   │ ⌐ RAG · vector store · embeddings ·      │   ← dashed, 40% opacity,
   │   retriever   — NOT IMPLEMENTED          │      explicitly labelled
   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Must also show:**
- A callout on gate 4: **"blocking = physics · advisory = judgement, never refused"**
- A callout on the closed vocabulary: **"the catalogue IS the schema"**
- **"one Ctrl+Z removes the entire plan"** near the result

> **Including the "NOT PRESENT" box is deliberate and valuable.** It pre-empts the
> examiner's question and demonstrates that the author knows precisely what the system
> does and does not do.

---

## 10. Self-check before delivering any diagram

| Check | |
|---|---|
| Is there a RAG / vector / embedding / retriever node? | **must be NO** (or explicitly in a dashed NOT-IMPLEMENTED box) |
| Does any node imply a large 3D model library? | **must be NO** — it is 1 real scan of 27 |
| Does any metric value appear? | **must be NO** |
| Is Persian shown as supported? | **must be NO** |
| Are AI and deterministic components different colours? | **must be YES** |
| Is the validator visually the most prominent gate? | **must be YES** |
| Does every arrow carry a label? | **must be YES** |
| Is there a legend? | **must be YES** |
| Are both ControlNets shown with their weights (0.7 / 0.5)? | **must be YES** |
| Is the LLM labelled `Gemini 3.5 Flash` with the fallback shown? | **must be YES** |
| Is Build Mode shown as optional (Studio bypass)? | **must be YES** in the hero |
| Readable at 14 pt from the back of a room? | **must be YES** |
