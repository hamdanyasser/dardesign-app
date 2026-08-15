# DAR → Gemini Notebook Upload Guide

Everything you need to get Gemini producing accurate DAR architecture diagrams.

**Pack location:** `DAR_GEMINI_ARCHITECTURE_PACK/`
**Zip:** `DAR_GEMINI_ARCHITECTURE_PACK.zip`

---

## 1. Should you upload the ZIP or individual files?

> ### Upload **individual files**, not the ZIP.

**NotebookLM / Gemini Notebook does not unpack archives.** A ZIP will either be rejected or
treated as one opaque blob, and you lose per-source citation — which is the whole reason
this pack is structured as separate documents.

**The ZIP is for backup, for sharing with a supervisor, and for re-uploading later.**

**Practical limits to know:** a NotebookLM notebook holds up to **50 sources**, and each
source is capped around **500,000 words**. This pack has **29 documents + 1 JSON + 56 raw
evidence files + 11 visual files**. So you cannot upload everything — **which is why the
tiers below exist.**

---

## 2. Upload order — three tiers

### ⭐ TIER 1 — Upload these 8 first (this alone is enough to start)

Upload **in this order**. NotebookLM weights earlier sources slightly more heavily, and the
reading order matters.

| # | File | Why it must be first |
|---|---|---|
| 1 | `00_READ_ME_FIRST.md` | Tells Gemini the rules, and lists what it must **not** infer |
| 2 | `21_GEMINI_MASTER_CONTEXT.md` | ⭐ **The single most important document.** The whole system, tagged by component type |
| 3 | `20_DEFENSE_FACTS_AND_LIMITATIONS.md` | The honesty controls — what is confirmed, partial, planned, and forbidden |
| 4 | `22_DIAGRAM_ARCHITECTURE_SPEC.md` | Exactly what to draw, what to omit, and how to lay it out |
| 5 | `17_FULL_DATA_FLOW.md` | The five end-to-end traces |
| 6 | `07_RAG_ARCHITECTURE.md` | Prevents the single most likely hallucination |
| 7 | `25_IMPLEMENTED_VS_PLANNED.md` | Stops planned features being drawn as finished |
| 8 | `architecture.json` | Machine-readable nodes, edges and forbidden elements |

**After these 8, go straight to PROMPT 1.** Do not upload more until Gemini has passed the
verification check.

### TIER 2 — Add these 12 for full depth

| File | Adds |
|---|---|
| `01_PROJECT_OVERVIEW.md` | Jury-level framing |
| `06_LLM_DESIGN_PLANNER.md` | ⭐ The planner and its six gates |
| `08_SPATIAL_VALIDATION.md` | ⭐ The deterministic authority |
| `09_BUILD_MODE_THREEJS.md` | ⭐ The 3D system and the three asset honesty tiers |
| `11_RENDER_WITH_DAR.md` | ⭐ The conditioning substitution |
| `12_DEPTH_AND_SEGMENTATION.md` | Why both control signals |
| `13_SDXL_CONTROLNET_LORA.md` | The generation pipeline |
| `04_ROOM_UNDERSTANDING.md` | Measured vs estimated vs assumed |
| `05_CULTURAL_ONTOLOGY.md` | The cultural system + verification status |
| `16_EVALUATION.md` | Capability vs measured results |
| `27_DEFENSE_QA_FACTS.md` | Q&A answers |
| `26_GLOSSARY.md` | Vocabulary |

### TIER 3 — Add if you have source slots left

`02_FRONTEND_ARCHITECTURE.md` · `03_BACKEND_ARCHITECTURE.md` ·
`10_FURNITURE_AND_ASSETS.md` · `14_EXPLAINABILITY.md` ·
`15_ACCOUNTS_DATABASE_ADMIN.md` · `18_API_ENDPOINT_MAP.md` ·
`19_REPO_FILE_MAP.md` · `24_TECHNOLOGY_STACK.md` · `28_SOURCE_INDEX.md`

*(`23_GEMINI_DIAGRAM_PROMPTS.md` is what **you** paste — it does not need to be uploaded as
a source, though it does no harm.)*

---

## 3. Which RAW_EVIDENCE files matter most

**Do not upload all 56.** Source slots are better spent on the structured documents. Upload
raw code **only if** Gemini questions a claim, or if you want it to cite implementation
directly.

### The five that carry the project's central claims

| # | File | Proves |
|---|---|---|
| 1 | `RAW_EVIDENCE/backend/design_planner.py` | The dual provider, the schema enum, all validation gates, the rule-based fallback |
| 2 | `RAW_EVIDENCE/src/lib/design/placement.ts` | The SAT collision engine and the blocking/advisory verdict |
| 3 | `RAW_EVIDENCE/src/lib/design/planner.ts` | `gatePlan` — where the LLM meets DAR's authority |
| 4 | `RAW_EVIDENCE/src/lib/design/scene3d.ts` | `renderConditioning` and the interior capture camera |
| 5 | `RAW_EVIDENCE/ontology/furniture.json` | The closed vocabulary that becomes the schema enum |

| 6 | `RAW_EVIDENCE/ontology/furniture_models.json` | The three honesty tiers and why only one real model exists |

### Three more if you want breadth
`RAW_EVIDENCE/backend/transform.py` (the pipeline) ·
`RAW_EVIDENCE/ontology/ontology.json` (the cultural corpus + `verified` flags) ·
`RAW_EVIDENCE/backend/requirements-light.txt` (**negative evidence: no RAG dependency**)

---

## 4. Which visual evidence matters most

All 10 images are real pipeline output. **The four that earn their slot:**

| File | Use |
|---|---|
| `pipeline_spacejoy_original.jpg` | The input photograph |
| `pipeline_spacejoy_lebanese.jpg` | + `khaleeji` + `moroccan` — **"same bones, three souls"** |
| `pipeline_spacejoy_depth_map.jpg` | Real depth output — feeds both the ControlNet and the room analysis |

Also upload `VISUAL_EVIDENCE/README.md`, which documents the provenance (`"placeholder":
null`, real job ids, real detection counts) so Gemini can cite *why* these are genuine
renders rather than LIGHT-mode placeholders.

> ⚠ **Never let Gemini attach a quality metric to these images.** No SSIM, LPIPS or CLIP
> value has been computed for them.

---

## 5. The exact first prompt to paste

**After uploading Tier 1**, paste this verbatim. It is PROMPT 1 from
`23_GEMINI_DIAGRAM_PROMPTS.md`:

```
You are preparing architecture diagrams for a university Final Year Project defense.
The uploaded sources describe a system called DAR Design. They were produced by
inspecting the actual source repository and are the ONLY authority. Do not supplement
them with general knowledge of how such systems are usually built.

DO NOT DRAW ANYTHING YET.

First, answer these questions using only the uploaded sources. Where a source states
something explicitly, quote the short phrase. Where you are unsure, say "not stated in
the sources" rather than guessing.

1.  In one sentence each, what are the six major stages a room photograph passes through
    to become a final cultural render?
2.  Is RAG (retrieval-augmented generation) implemented in DAR? Answer yes or no, then
    state what provides cultural grounding instead, and name the file.
3.  How many of the 27 catalogue pieces are real 3D models versus procedural geometry?
    Name the three honesty tiers, say which piece is the real one, and explain why there
    is only one.
4.  Which LLM provider does the design planner use? Name both the provider that is
    currently configured and live, and the provider the code prefers by default.
5.  Which cultures are fully supported? Which culture exists in the ontology but is NOT
    fully supported, and exactly what is missing for it?
6.  Name the six gates that prevent the LLM from hallucinating furniture. For gate 1,
    explain precisely why an invented catalogue id is impossible rather than merely
    unlikely.
7.  What is the difference between a BLOCKING and an ADVISORY placement verdict? Give one
    example of each and say why the advisory one is not refused.
8.  Which two images are sent to the generator by "Render with DAR", where do they come
    from, and what are their two ControlNet weights?
9.  Which room measurements are estimated, and which are fixed assumptions? State the
    assumed ceiling height and the assumed aspect ratio.
10. Which evaluation metrics are IMPLEMENTED, and which of those have ACTUAL MEASURED
    DATA? For each metric with no data, say so explicitly.
11. Which ontology cultures are marked verified: true and which are verified: false?
12. State DAR's master flow in one line.

Finally: list anything in the sources that you found ambiguous or contradictory.
```

---

## 6. How to verify Gemini's understanding before it draws

**Grade its answers against this key. Every one is verified against the code.**

| Q | The correct answer |
|---|---|
| **1** | photo → room understanding (depth + segmentation) → cultural grounding → LLM plan → deterministic validation → editable 3D → conditioning capture → SDXL render |
| **2** | **NO.** A curated ontology (`ontology/ontology.json`) indexed by culture key, plus a closed catalogue enforced as a JSON-Schema enum |
| **3** | **1 of 27 is a real scan** (`leb-ottoman-001`, CC0 *Ottoman 01* from Poly Haven); **26 are ENHANCED PROCEDURAL**; photographed objects are **FALLBACK MASSING**. Only one, because ~20 CC0 candidates were inspected and 19 rejected as culturally wrong |
| **4** | Live: **Gemini 3.5 Flash**. Code default: **Claude Sonnet 5** |
| **5** | Lebanese, Khaleeji, Moroccan. **Persian** — no trained LoRA, no catalogue items, excluded from `/redesign`, Build Mode and the planner |
| **6** | schema enum · no size fields · `validate_items` · `gatePlan`+SAT · culture coherence · opening keep-clear. Gate 1: structured outputs make an invented id **unrepresentable at the decoding level** |
| **7** | Blocking = physics (out of bounds, overlapping a user-placed piece) → refuses. Advisory = judgement (standing where the photo found old furniture) → stated, never refused, **because replacing existing furniture is the most likely act of redesign** |
| **8** | **Depth** and **ADE20K segmentation**, rendered from the 3D scene by `renderConditioning`; weights **0.7** and **0.5** |
| **9** | Floor **area** is estimated. **Ceiling height is always 300 cm; aspect ratio always 1.25** |
| **10** | SSIM n=3, duration n=4, ratings n=2. **LPIPS, CLIP, confusion matrix, ablation: ZERO data** |
| **11** | `true`: Khaleeji, Moroccan. **`false`: Lebanese and Persian** |
| **12** | *The LLM designs · DAR validates · the user edits · ControlNet + SDXL renders* |

**If any answer is wrong, correct it explicitly like this:**

```
Answer N is incorrect. The sources state [correct fact] — see [document].
Please restate your understanding of that point before we continue.
```

**Do not proceed to a diagram prompt until questions 2, 3, 4, 5 and 10 are all correct.**
Those five are where a wrong diagram does the most damage in front of a jury.

---

## 7. Then run the diagram prompts in order

From `23_GEMINI_DIAGRAM_PROMPTS.md`:

| Prompt | Produces |
|---|---|
| **2** | The DAR mind map |
| **3** | ⭐ The one-page jury hero infographic |
| **4** | The full technical architecture diagram |
| **5** | The AI / grounding / validator close-up |
| **6** | ⭐ **A hostile critique of everything it just drew** |
| **7** | The corrected final versions |
| *8 (optional)* | A single defense slide |

> **Do not skip PROMPT 6.** It is the cheapest quality gate you have — it costs one prompt
> and catches errors that would otherwise be projected onto a wall.

---

## 8. If Gemini gets something wrong mid-session

Paste this:

```
Stop. That contradicts the uploaded sources.

[Document name] states: "[quote the exact line]"

Restate the correct fact, explain what led you to the incorrect version, and then
regenerate only the affected part.
```

**The three most likely errors, and the source that settles each:**

| Likely error | Settle it with |
|---|---|
| Adds a RAG / vector-store node | `07_RAG_ARCHITECTURE.md` §1 — the full negative-evidence table |
| Misstates the asset tiers (says "no models" or implies a library) | `09_BUILD_MODE_THREEJS.md` §1 — it is **1 real CC0 scan of 27** |
| Invents a metric value | `16_EVALUATION.md` §1 — the measured state, and `20` §5 |

---

## 9. Quick-start checklist

- [ ] Upload the 8 Tier-1 files, in order
- [ ] Paste PROMPT 1
- [ ] Grade the 12 answers against §6; correct any that are wrong
- [ ] Confirm Q2, Q3, Q4, Q5 and Q10 are all correct
- [ ] Upload Tier 2
- [ ] Run PROMPT 3 (the hero diagram)
- [ ] Run PROMPT 6 (the critique)
- [ ] Run PROMPT 7 (the corrected versions)
- [ ] Check the final hero against `22_DIAGRAM_ARCHITECTURE_SPEC.md` §10 yourself
- [ ] Confirm: no RAG node · asset tiers stated as 1-real-of-27 · no metric value · Persian not shown as supported

---

## 10. Security note

**This pack contains no credentials.** No API key, password, token, session secret or
database file was read or copied while producing it. A 13-pattern regex secret scan across
all 81 text files returned **zero findings** (the initial hits were Python identifiers
containing the word "token" — `max_tokens`, `tokenizer` — and were confirmed as false
positives).

The live LLM provider was determined from the **public** `/api/design/planner-status`
endpoint, **not** by reading `.dardesign-llm`. Only the *names* of configuration keys were
ever listed; **no value was opened**.

**It is safe to upload this pack to Gemini.**
