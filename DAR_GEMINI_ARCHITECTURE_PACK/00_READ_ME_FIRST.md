# 00 — READ ME FIRST

**Audience: Gemini (Notebook / Canvas), preparing architecture diagrams, mind maps and
infographics for an undergraduate Final Year Project defense.**

---

## 1. What DAR is, in one paragraph

**DAR Design** (دار ديزاين) is a bilingual (English/Arabic) AI interior-design platform for
**Arab domestic interiors**. A user uploads a photograph of a real room; DAR analyses that
room's depth and semantic segmentation, generates culturally-grounded redesigns in
**Lebanese**, **Khaleeji** and **Moroccan** styles using SDXL with dual ControlNet and
per-culture LoRA adapters, and then lets the user step into a **metric 3D editor (Build
Mode)** where an LLM can propose a furniture layout from a natural-language brief, every
placement is validated by DAR's own deterministic collision engine, and the edited scene
can be re-rendered photorealistically by feeding the 3D scene's own depth and segmentation
maps back into the same generator as conditioning.

---

## 2. The single most important instruction

> **This pack was written by inspecting the actual current repository, file by file, on
> 2026-08-14. Where the project's own older documentation (`CLAUDE.md`, `README.md`,
> `ARCHITECTURE.md`) contradicts the code, THIS PACK FOLLOWS THE CODE and says so
> explicitly.**
>
> **Treat these documents as the source of truth. Do not "correct" them from general
> knowledge of how such systems are usually built.**

---

## 3. Things you must NOT infer

These are the specific errors most likely to be made when diagramming a system like this.
Each one is wrong for DAR:

| Do NOT assume | The truth |
|---|---|
| That there is a RAG / vector-store / embedding / retrieval component | **There is none.** See [07_RAG_ARCHITECTURE.md](07_RAG_ARCHITECTURE.md). Cultural grounding is a curated JSON ontology indexed by culture key. |
| That Build Mode is entirely real 3D models — **or** entirely procedural | **Neither. It is 1 real scanned model out of 27 catalogue pieces**, 26 authored procedural, plus fallback massing for photographed objects. All three honesty tiers are implemented and labelled in the UI. See [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) §1. |
| That the LLM places the furniture | The LLM **proposes**; DAR's deterministic SAT collision engine decides. See [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md). |
| That the LLM is only Gemini, or only Claude | It is a **dual-provider** planner. The code's default preference is Anthropic (`claude-sonnet-5`); **the live configured provider is Gemini (`gemini-3.5-flash`)**, confirmed from the running backend. See [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md). |
| That the evaluation dashboard contains measured results | The **capability** is implemented; the **corpus is almost empty**. LPIPS, CLIP and the confusion matrix currently hold **zero** data points. See [16_EVALUATION.md](16_EVALUATION.md). |
| That Persian is a supported culture | Persian is **prompt-only**, has **no trained LoRA**, and is excluded from `/redesign`, from Build Mode and from the furniture catalogue. See [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md). |
| That the whole cultural ontology is expert-verified | **Khaleeji and Moroccan are `verified: true`; Lebanese and Persian are `verified: false`** — and Lebanese is the hero culture. See [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md). |
| That Studio has six result tabs | The six-tab type exists in the source but is **dead code**. Only three narrative tabs render. See [02_FRONTEND_ARCHITECTURE.md](02_FRONTEND_ARCHITECTURE.md). |
| That room dimensions are measured from the photo | Only floor **area** is estimated. Room **height is always a 300 cm constant** and the width:depth **aspect ratio is always an assumed 1.25**. See [04_ROOM_UNDERSTANDING.md](04_ROOM_UNDERSTANDING.md). |
| That there is one backend | There are **two roles** for one codebase: a GPU render host and a data host, addressed by two different env vars. See [03_BACKEND_ARCHITECTURE.md](03_BACKEND_ARCHITECTURE.md). |

---

## 4. What is in this pack

```
DAR_GEMINI_ARCHITECTURE_PACK/
├── 00_READ_ME_FIRST.md            ← you are here
├── 01 … 20                        the architecture documents
├── 21_GEMINI_MASTER_CONTEXT.md    ★ the single best document to read
├── 22_DIAGRAM_ARCHITECTURE_SPEC.md★ what to draw
├── 23_GEMINI_DIAGRAM_PROMPTS.md   ★ copy-paste prompts
├── 24 … 28                        stack, matrices, glossary, Q&A, source index
├── architecture.json              machine-readable nodes + edges
├── RAW_EVIDENCE/                  sanitized copies of the real implementation files
└── VISUAL_EVIDENCE/               real pipeline output images (provenance documented)
```

**Document classes:**

- **Narrative / conceptual** — 00, 01, 21, 26, 27
- **Subsystem deep-dives** — 02–16
- **Cross-cutting traces** — 17 (data flows), 18 (API map), 19 (file map)
- **Honesty controls** — 20 (facts & limitations), 25 (implemented vs planned)
- **Diagram production** — 22 (spec), 23 (prompts), `architecture.json`
- **Traceability** — 28 (which code backs which document)

---

## 5. Recommended reading order

**If you read only three documents, read these, in this order:**

1. **[21_GEMINI_MASTER_CONTEXT.md](21_GEMINI_MASTER_CONTEXT.md)** — the whole system, labelled by
   component type (`[AI/ML]`, `[DETERMINISTIC]`, `[3D]`, …). This is the document written
   specifically for you.
2. **[20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)** — what is
   confirmed, what is partial, what must never be claimed.
3. **[22_DIAGRAM_ARCHITECTURE_SPEC.md](22_DIAGRAM_ARCHITECTURE_SPEC.md)** — the exact content,
   layout and grouping of the diagrams to produce.

**Full order, if you read everything:**

| Stage | Documents | Why in this order |
|---|---|---|
| 1. Orient | 00 → 01 → 21 | Problem, users, and the whole system at a glance |
| 2. Guard rails | 20 → 25 → 07 | Learn what is *not* true before you learn what is |
| 3. The spine | 17 → 04 → 06 → 08 → 09 → 11 → 12 → 13 | Follow a photograph all the way to a final render |
| 4. Supporting systems | 02 → 03 → 05 → 10 → 14 → 15 → 16 | Frontend, backend, ontology, assets, explainability, accounts, evaluation |
| 5. Reference | 18 → 19 → 24 → 26 → 28 | Endpoints, files, stack, vocabulary, traceability |
| 6. Produce | 22 → 23 → `architecture.json` | Design and then generate the diagrams |

---

## 6. How the documents relate

```
                       01_PROJECT_OVERVIEW  (jury-level)
                                │
                       21_GEMINI_MASTER_CONTEXT  (everything, labelled)
                                │
        ┌───────────────┬───────┴────────┬────────────────┐
        │               │                │                │
   THE SPINE       CULTURE          SURFACES         GOVERNANCE
        │               │                │                │
  04 Room          05 Ontology      02 Frontend      15 Accounts/DB
  06 LLM Planner   10 Furniture     03 Backend       16 Evaluation
  08 Validation    07 RAG (none)    18 API map       14 Explainability
  09 Build Mode                     19 File map      20 Limitations
  11 Render w/ DAR                                   25 Impl vs planned
  12 Depth + Seg
  13 SDXL/CN/LoRA
        │
   17_FULL_DATA_FLOW  ← stitches the spine into 5 end-to-end traces
        │
   22_DIAGRAM_SPEC → 23_DIAGRAM_PROMPTS → architecture.json
```

---

## 7. Verification state of this pack

| Check | Result |
|---|---|
| Repository branch inspected | `feat/frontend-visual-overhaul` @ **`2380fa8`** (audit began at `60dc112`; four commits landed mid-audit — see [25](25_IMPLEMENTED_VS_PLANNED.md) §4) |
| Backend test suite run | **583 passed, 1 skipped** (`pytest tests -q`, `DARDESIGN_LIGHT=1`) |
| Live backend queried | `/healthz` → `{ok: true, version: "0.3.0", light_mode: true}` |
| Live planner queried | `/api/design/planner-status` → `{configured: true, provider: "gemini", model: "gemini-3.5-flash"}` |
| Secrets in this pack | **None.** No key, token, password or credential value was read or copied. See [28_SOURCE_INDEX.md](28_SOURCE_INDEX.md) §4. |

---

## 8. First thing to do

Before drawing anything, run **PROMPT 1** in
[23_GEMINI_DIAGRAM_PROMPTS.md](23_GEMINI_DIAGRAM_PROMPTS.md). It asks you to state your
understanding of DAR back, so factual errors surface *before* they are baked into an
image that goes in front of a jury.
