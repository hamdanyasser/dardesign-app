# 23 — Gemini Diagram Prompts

*Copy-paste, in order. Do not skip PROMPT 1 — it is what stops a factual error being baked
into an image that goes in front of a jury.*

**Before pasting any of these**, upload the pack (see `DAR_GEMINI_UPLOAD_GUIDE.md`).

---

## PROMPT 1 — Verify understanding before drawing

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

**Check the answers against this key before continuing:**

| Q | Correct answer |
|---|---|
| 2 | **No.** Curated ontology (`ontology/ontology.json`) + closed catalogue enum |
| 3 | **No.** Procedural three.js primitives at real ontology cm — a deliberate maquette |
| 4 | Live: **Gemini 3.5 Flash**. Code default: **Claude Sonnet 5** |
| 5 | Lebanese, Khaleeji, Moroccan. **Persian** — no LoRA, no catalogue items, not in `/redesign`/Build Mode/planner |
| 8 | **Depth** and **ADE20K segmentation**, rendered from the 3D scene by `renderConditioning`; weights **0.7** and **0.5** |
| 9 | Floor **area** is estimated. **Height is always 300 cm; aspect ratio always 1.25** |
| 10 | SSIM n=3, duration n=4, ratings n=2. **LPIPS, CLIP, confusion matrix, ablation: zero data** |
| 11 | `true`: Khaleeji, Moroccan. **`false`: Lebanese, Persian** |
| 12 | *The LLM designs · DAR validates · the user edits · ControlNet + SDXL renders* |

**If any answer is wrong, correct it explicitly before moving on.**

---

## PROMPT 2 — DAR mind map

```
Using ONLY the uploaded sources, generate a mind map of DAR Design.

STRUCTURE
Centre node: "DAR Design — culturally grounded AI interior design for Arab interiors"

Six primary branches:
  1. ROOM UNDERSTANDING       [AI/ML]
  2. CULTURAL KNOWLEDGE       [CURATED DATA]
  3. LLM DESIGN PLANNER       [AI/ML]
  4. DAR SPATIAL VALIDATOR    [DETERMINISTIC]
  5. BUILD MODE (3D)          [3D + USER CONTROL]
  6. GENERATION               [GENERATIVE AI]

Two supporting branches, visually secondary:
  7. EXPLAINABILITY
  8. ACCOUNTS / EVALUATION / OPS

RULES
- Colour-code by the tag in square brackets. AI/ML and DETERMINISTIC must be immediately
  distinguishable — that distinction is the project's central argument.
- Give each leaf its exact technical identifier where the sources provide one
  (e.g. "Depth Anything V2 Small", "SargeZT/sdxl-controlnet-seg", "Gemini 3.5 Flash").
- Under branch 4, list all six gates as separate leaves.
- Under branch 2, mark the verification status of each culture honestly:
  Lebanese and Persian are verified:false; Khaleeji and Moroccan are verified:true.
- Add a small, clearly separated "NOT IMPLEMENTED" cluster containing: RAG / vector store,
  and measured evaluation results. Draw it dashed and greyed.
- Under branch 5, show the three asset honesty tiers: 1 REAL MODEL (CC0 scan),
  26 ENHANCED PROCEDURAL, and FALLBACK MASSING for photographed objects.

FORBIDDEN
- Do not invent components. Do not add a RAG node to the main map.
- Do not include any numeric metric value.
- Do not present Persian as a fully supported culture.

Output 16:9 landscape, projector-readable, minimum 14 pt body text.
```

---

## PROMPT 3 — One-page jury architecture infographic (the HERO)

```
Generate the single hero architecture infographic for DAR Design, for a university FYP
defense. Follow document 22_DIAGRAM_ARCHITECTURE_SPEC.md sections 2 to 7 EXACTLY.

CANVAS  16:9 landscape, 1920x1080 minimum. Projector-readable from the back of a lecture
        theatre: minimum 14 pt body text. Generous whitespace.

TITLE     DAR Design — System Architecture
SUBTITLE  The LLM designs · DAR validates · the user edits · ControlNet + SDXL renders

THE SPINE (in this order, this is verified against the source code)
  1  USER — room photograph
  2  ROOM UNDERSTANDING — Depth Anything V2 Small + OneFormer ADE20K Swin-L
  3  LLM DESIGNER — Gemini 3.5 Flash  (+ a DASHED branch: "no key → rule-based plan")
  4  DAR SPATIAL VALIDATOR — oriented-rectangle SAT collision, catalogue enum,
     culture coherence, door/window keep-clear.  Label it "blocking vs advisory".
  5  BUILD MODE — metric three.js room in centimetres; 1 real CC0 scan + 26 procedural
  6  USER EDITS — move · rotate · add · material
  7  DEPTH + SEGMENTATION CAPTURE — an interior camera at 155 cm eye height;
     "the scene becomes the control signal"
  8  SDXL 1.0 + DUAL CONTROLNET (depth 0.7, seg 0.5) + CULTURAL LoRA (scale 0.8)
     with a DASHED branch: "OOM → SD 1.5 @ 768²"
  →  FINAL CULTURAL INTERIOR

SIDE RAIL (right, feeding stages 3, 4 and 5 — NOT a step in the spine)
  DAR CULTURAL ONTOLOGY — ontology.json (113 terms, 3 cultures, EN+AR)
                          furniture.json (27 pieces, real centimetres)

BYPASS ARROW
  Draw a clearly-labelled arrow from stage 2 directly to stage 8, labelled
  "Studio path — Build Mode is optional". Without it the diagram wrongly implies
  every render passes through the editor.

EMPHASIS
  The DAR SPATIAL VALIDATOR is the most visually prominent element on the page. Draw it
  as a HEXAGON in the deterministic colour. It is the intellectual centre of the project.

COLOUR SEMANTICS  (use consistently, and include a legend bottom-left)
  violet  = AI/ML model        magenta = generative AI     teal = deterministic code
  amber   = cultural knowledge blue    = 3D scene          charcoal = user control
  hexagon = validation gate    solid arrow = primary path  dashed = fallback path

NUMBER the eight stages with small circled numerals so a presenter can point at them.

ABSOLUTELY FORBIDDEN — each of these would be a factual error:
  ✗ any RAG, vector store, embedding, or retriever node
  ✗ a 3D model LIBRARY implying many assets (there is exactly one CC0 scan of 27 pieces)
  ✗ any numeric metric value (SSIM, LPIPS, CLIP, accuracy, percentages)
  ✗ Persian shown as a supported culture
  ✗ auth, subscriptions, admin, history or evaluation (those belong in the technical diagram)
  ✗ six Studio result tabs (only three render)
  ✗ file paths, function names or endpoint paths

Every arrow must carry a label naming what flows along it.
```

---

## PROMPT 4 — Full technical architecture diagram

```
Generate the FULL TECHNICAL ARCHITECTURE diagram for DAR Design, following
22_DIAGRAM_ARCHITECTURE_SPEC.md section 8. This one is for a technical examiner, so
higher density is acceptable — but it must still be readable at 1920x1080.

FIVE HORIZONTAL LAYERS, top to bottom:

LAYER 1  FRONTEND — Next.js 16, React 19, TypeScript 5, Tailwind, three.js 0.150
  routes: /studio /design /history /others /subscription /evaluation /admin/* /audit /v2
  contexts: ThemeLanguage (EN/AR + full RTL) · Auth · Image
  key modules: lib/api.ts, lib/design/{placement,planner,store,scene3d,geometry,roomModel}

LAYER 2  API BOUNDARY — draw the TWO-HOST SPLIT as two side-by-side boxes. This is the
         single most explanatory fact about the backend.
  LEFT  — NEXT_PUBLIC_API_URL "RENDER HOST": Kaggle T4, ephemeral, rotating tunnel,
          NO users table, sent NO session cookie.
          /redesign /restyle /render-scene /api/furniture/* /api/color/* /share /healthz /audit
  RIGHT — NEXT_PUBLIC_DATA_API_URL "DATA HOST": the developer's machine, SQLite + images/,
          holds the LLM API key.
          /api/auth/* /api/history/* /api/feedback /api/subscription /api/usage/consume
          /api/design/plan (the ONLY authenticated generation-adjacent endpoint) /api/admin/*
  Annotate: "one FastAPI codebase, two roles"

LAYER 3  BACKEND — backend/main.py v0.3.0 and its modules:
  transform · design_planner · room_analysis · projection · prompt_builder · furniture
  placement · compositing · recolor · quality · evaluation · db · auth · subscriptions
  mailer · jobs · ttl_cleanup · audit · share · validators · errors · guardrails
  Draw _GEN_LOCK as a band spanning /redesign, /restyle, /transform and /render-scene.
  Mark _stream_keepalive on /redesign and /restyle.
  Mark DARDESIGN_LIGHT=1 as a MODE SWITCH on transform.py — label it "a first-class mode,
  not a mock; the whole test suite runs in it".

LAYER 4  AI / ML AND GENERATIVE
  Depth Anything V2 Small | OneFormer ADE20K Swin-L | Gemini 3.5 Flash / Claude Sonnet 5
  SDXL 1.0 + ControlNet depth 0.7 + ControlNet seg 0.5 + 3 LoRAs (rank 16)
  dashed fallback: OOM → SD 1.5 + ControlNet 1.1 @ 768²
  Draw LPIPS (AlexNet) and CLIP (ViT-B-32) DASHED and label them
  "implemented, packages not installed, zero measured data".

LAYER 5  DATA AND KNOWLEDGE
  ontology/ontology.json · ontology/furniture.json · configs/pipeline.yaml
  configs/sweep_winners.json · models/loras/{lebanese,khaleeji,moroccan}
  public/furniture/ (27 PNG cut-outs — used in the catalogue rail and 2D compositing ONLY)
  SQLite: users · history · feedback · subscription_requests · evaluation_results
  audit.jsonl · uploads/ (24-hour TTL)
  Draw evaluation_results DASHED and label it "0 rows".

ALSO SHOW, clearly separated, the THREE DISTINCT EDITING SYSTEMS:
  Colour Control    — masked HSV edit on a finished PNG
  Furniture Placement — asset compositing on a finished PNG
  Render with DAR   — full re-generation conditioned on a 3D scene
  These are frequently confused; keep them visually distinct.

Show the retired async flow (/upload, /transform, /status, /result, /retry) greyed and
labelled "retired".

Same colour semantics and legend as the hero diagram.
FORBIDDEN: any RAG node, any implication of a large 3D model library, any metric value.
```

---

## PROMPT 5 — AI / LLM / cultural grounding / validator close-up

```
Generate the AI AND VALIDATION CLOSE-UP diagram for DAR Design, following
22_DIAGRAM_ARCHITECTURE_SPEC.md section 9. This diagram carries the project's central
technical argument, so precision matters more than breadth.

TITLE     How DAR prevents an AI from inventing a room
SUBTITLE  The LLM proposes. DAR decides.

LAYOUT — left to right, four columns.

COLUMN 1  INPUT
  natural-language brief (Arabic or English)
  room rectangle (client-derived) · found objects (from the photograph) · detected openings

COLUMN 2  THE MODEL  [AI/ML, violet]
  LLM DESIGN PLANNER — Gemini 3.5 Flash (live) / Claude Sonnet 5 (code default)
  ONE call returns BOTH:
    understood{culture, roomType, capacity, intensity, wall/floor material, requirements}
    items[]{catalogId, x, z, rotation, material, reason EN + AR}
  Annotate clearly: "emits NO dimensions — sizes come from the catalogue"
  Annotate clearly: "emits NO invented ids — see gate 1"
  DASHED branch downward: "no API key / provider error / call cap → RULE-BASED PLAN,
                           badge reads 'Planned by DAR's rules'. CI runs this path."

COLUMN 3  THE GATES  [DETERMINISTIC, teal] — six HEXAGONS stacked vertically
  ⬡1  JSON-Schema ENUM of the 27 catalogue ids
      → "an invented id is UNREPRESENTABLE, not merely unlikely"
      → note: enforced by BOTH providers
  ⬡2  no size fields exist in the schema at all
  ⬡3  backend validate_items() → dropped AND REPORTED, each with a distinct true reason
  ⬡4  client gatePlan() → evaluatePlacement(), oriented-rectangle SAT collision
      → ⭐ CALLOUT: "the SAME engine that colours a human's drag ghost and refuses a
         human's drop"
      → CALLOUT: "blocking = physics · advisory = judgement, never refused"
  ⬡5  culture coherence — one room, one culture
  ⬡6  door 90 cm / window 40 cm keep-clear zones

COLUMN 4  RESULT
  validated furniture in an editable 3D room
  PLUS a visible list of what was REFUSED, with reasons
  CALLOUT: "one Ctrl+Z removes the entire plan"

BOTTOM-LEFT  GROUNDING  [CULTURAL KNOWLEDGE, amber]
  ontology/furniture.json — 27 pieces, real centimetres → becomes the schema enum
  ontology/ontology.json — 113 terms → the generation prompt and the 3D materials
  CALLOUT: "the catalogue IS the schema"

BOTTOM-RIGHT  A DASHED, 40%-OPACITY BOX LABELLED "NOT IMPLEMENTED"
  containing: RAG · vector store · embeddings · retriever
  Caption: "DAR grounds by curation and closed vocabulary, not retrieval."
  Include this deliberately — it pre-empts the examiner's question.

FORBIDDEN: presenting RAG as part of the live system; any metric value; showing the
validator as a passive filter rather than the deciding authority.
```

---

## PROMPT 6 — Critique the diagrams

```
You have now produced a mind map, a hero infographic, a full technical architecture
diagram, and an AI/validation close-up for DAR Design.

Act as a hostile technical examiner who has read the uploaded sources carefully. Review
every diagram you produced and report EVERY inaccuracy. Be harsh — an error that survives
into the defense is far more costly than a false alarm now.

Check each of the following and answer explicitly for each diagram:

FACTUAL ERRORS
 1. Does any diagram contain a RAG, vector store, embedding, or retriever node outside a
    clearly-marked NOT-IMPLEMENTED box?
 2. Does any diagram misstate the asset tiers? (It is 1 real CC0 scan, 26 procedural,
    plus fallback massing — not 'all models' and not 'no models'.)
 3. Does any numeric metric value appear anywhere (SSIM, LPIPS, CLIP, accuracy, %)?
 4. Is Persian shown or implied to be a fully supported culture?
 5. Is the LLM provider named correctly — Gemini 3.5 Flash as live, with the fallback shown?
 6. Are both ControlNets present with their correct weights (depth 0.7, seg 0.5)?
 7. Is the LoRA drawn as attached to/fused into SDXL rather than as a separate stage?
 8. Are the depth and segmentation control images shown as coming FROM THE 3D SCENE in the
    Render-with-DAR path?
 9. Does the hero diagram show that Build Mode is OPTIONAL (the Studio bypass)?
10. Is the cultural ontology drawn as a side rail feeding several stages, rather than as a
    single step in the pipeline?

CLARITY ERRORS
11. Are AI/ML and DETERMINISTIC components immediately distinguishable by colour?
12. Is the DAR Spatial Validator the most visually prominent gate?
13. Does every arrow carry a label naming what flows?
14. Is there a legend on every diagram?
15. Would the smallest text be readable projected from the back of a lecture theatre?

OMISSIONS
16. Is anything important from 21_GEMINI_MASTER_CONTEXT.md missing from the hero diagram?
17. Is anything in the diagrams that is NOT supported by the uploaded sources?

For each problem: name the diagram, quote the offending element, cite the source document
that contradicts it, and state the exact fix. Do not redraw anything yet.
```

---

## PROMPT 7 — Final improved versions

```
Apply every correction you identified in your critique and regenerate all four diagrams.

Before outputting each one, run this checklist and state PASS or FAIL for each item:
  [ ] No RAG / vector / embedding / retriever node outside a marked NOT-IMPLEMENTED box
  [ ] Asset tiers stated correctly (1 real / 26 procedural / massing)
  [ ] No numeric metric value anywhere
  [ ] Persian not shown as supported
  [ ] LLM labelled "Gemini 3.5 Flash" with the rule-based fallback shown
  [ ] Both ControlNets with weights 0.7 and 0.5
  [ ] LoRA attached to SDXL, not a separate stage
  [ ] Depth + segmentation shown as captured FROM the 3D scene
  [ ] Build Mode shown as optional in the hero (Studio bypass arrow present)
  [ ] Ontology drawn as a side rail, not a pipeline step
  [ ] AI/ML and DETERMINISTIC immediately distinguishable by colour
  [ ] The Spatial Validator is the most prominent gate
  [ ] Every arrow labelled
  [ ] Legend present
  [ ] 16:9, minimum 14 pt body text, projector-readable

Output the four final diagrams. For each, add a one-paragraph caption a presenter could
read aloud while it is on screen.

Finally, produce a "presenter's script" for the hero diagram: eight short lines, one per
numbered stage, that a student can say while pointing at each box. Each line must be
defensible from the uploaded sources alone.
```

---

## Optional PROMPT 8 — the single defense slide

```
From the uploaded sources, produce ONE slide that would survive the toughest question a
jury could ask about DAR Design.

It must contain, and nothing else:
  • The master flow in one line
  • The three things DAR does that generic redesign tools do not
  • The single strongest technical claim, stated so that it is checkable
  • The three most important honest limitations

Every statement must be traceable to the uploaded sources. Do not include any metric value.
16:9, projector-readable, minimal.
```
