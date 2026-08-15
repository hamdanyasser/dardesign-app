# 26 — Glossary

*DAR-specific and general terms, explained for a reader who has not seen the codebase.*

---

## DAR-specific terms

**DAR / DAR Design (دار ديزاين)**
The project. *Dar* (دار) means *house* or *dwelling* in Arabic. A bilingual AI interior-design
platform for Arab domestic interiors.

**Build Mode** — `/design`
The metric 3D room editor. Opens on a room **reconstructed from the user's photograph**, not
an empty grid. Units are centimetres; the scene is plain serializable JSON.
→ [09](09_BUILD_MODE_THREEJS.md)

**Design Planner**
The LLM component that reads a natural-language brief and proposes catalogue pieces with
positions. Currently **Gemini 3.5 Flash**; the code also implements Claude Sonnet 5 and a
rule-based fallback. **It proposes; it never places.** → [06](06_LLM_DESIGN_PLANNER.md)

**Spatial Validator**
DAR's deterministic authority: `evaluatePlacement()` in `src/lib/design/placement.ts`. An
oriented-rectangle separating-axis collision test that judges **both** a human's drag and
an LLM's plan. → [08](08_SPATIAL_VALIDATION.md)

**Catalogue ID**
A stable identifier like `leb-sofa-001`. The 27 ids form the **JSON-Schema `enum`** given to
the LLM, which is what makes an invented piece *unrepresentable* rather than merely unlikely.

**Cultural Ontology**
`ontology/ontology.json` — the curated design vocabulary: 4 cultures × 7 categories, EN + AR,
each term carrying a `weight` and a **`verified`** flag. **Not** a retrieval corpus.
→ [05](05_CULTURAL_ONTOLOGY.md)

**Honesty tiers (REAL MODEL / ENHANCED PROCEDURAL / FALLBACK MASSING)**
How DAR labels every piece in Build Mode by how honestly it is drawn. **REAL MODEL** — an
actual scanned asset (currently 1 of 27: `leb-ottoman-001`, a CC0 Poly Haven scan).
**ENHANCED PROCEDURAL** — authored geometry with real silhouette and ornament, generated
rather than scanned (26 of 27). **FALLBACK MASSING** — the abstract translucent volume for
furniture read off the user's photograph, where DAR knows a footprint and a class but not a
form. Defined in `ontology/furniture_models.json::_tiers` and surfaced in the product UI.

**`contain` fit**
The rule that a loaded 3D model is scaled **uniformly** to sit inside the collision box the
catalogue declares — never a per-axis stretch. *"A beautiful model with a wrong footprint is
worse than a box with a right one."* See `modelLoader.instantiateModel`.

**Greyscale detail map**
DAR's PBR colour maps are converted to greyscale so they **multiply** the culture's palette
colour from `ontology.json` rather than replacing it. three computes albedo as
`material.color * map`, so a full-colour photograph would overwrite the sourced palette; a
greyscale multiply can only move value, never hue or saturation. The same property
`backend/recolor.py` relies on.

**Found object / found massing**
Furniture DAR detected in the photograph, reconstructed as a **locked, translucent** box in
Build Mode. Locked because moving one turns a measurement into a fiction. Labelled
*"From your photo · approximate"*.

**Blocking vs Advisory**
The two-tier placement verdict.
- **Blocking** = physics the user cannot mean (out of bounds; inside a piece they placed) → **refuses the drop**
- **Advisory** = judgement (standing where the photo found old furniture; not touching a required wall; near a door) → **stated in amber, never refused**

**Provenance / `shellSource`**
`measured` / `estimated` / `default` — how the room rectangle was obtained. Shown as a header
chip so **a default room is never presented as a measurement**. Downgraded to `default` if
the user resizes the room by hand.

**Render with DAR**
Taking an edited 3D scene, capturing its depth and segmentation, and feeding those to SDXL
as ControlNet conditioning. → [11](11_RENDER_WITH_DAR.md)

**Conditioning capture / `renderConditioning`**
Three offscreen passes from an **interior** camera: beauty (evidence), depth (data),
segmentation (data). Not the on-screen orbit camera.

**Honesty contract**
The explicit statement shown next to a Render-with-DAR result: **held** = placement,
orientation, geometry, viewpoint (they are the control signal); **not held** = the
appearance of any individual piece.

**Truth gate**
`src/components/story/adapters.ts`. Returns `null` rather than degrade, never falls back to
demo data, and emits unmeasured values as `{value: null, measured: false}` — rendered as an
**em-dash, never a zero**. → [14](14_EXPLAINABILITY.md)

**The Understood Room**
The three-layer explanation of a photograph: **how it looks** (render), **how it's laid out**
(`RoomMap2D`), **how it feels to be in** (`DepthOrbit`). Also the name of the `/v2` rebuild.

**Defense Mode** — `?demo=1`
Six pre-rendered rooms replayed from static files with **zero backend calls** — insurance if
the GPU tunnel dies mid-defense.

**`DARDESIGN_LIGHT`**
A first-class placeholder mode, **not a mock**. `transform.py` is canonical and has a
placeholder branch; nothing else is stubbed. The whole test suite runs in it.

**The two backends**
One FastAPI codebase, two roles: a **render host** (`NEXT_PUBLIC_API_URL`, an ephemeral
Kaggle T4 with no users table) and a **data host** (`NEXT_PUBLIC_DATA_API_URL`, holding
SQLite and the LLM key). → [03](03_BACKEND_ARCHITECTURE.md)

**`_GEN_LOCK`**
The asyncio lock serialising every generation. The cached diffusers pipeline and its LoRA
fuse state are not concurrency-safe.

**Keepalive streaming**
Yielding whitespace every 10 s during a long request, because free tunnels return 524 on a
slow first byte. **Once the stream starts the 200 is already sent**, so post-start failures
arrive in-band — which is why the client validates response *shape*.

**Gate 1 … Gate 6**
The six places an LLM hallucination dies: schema enum · no size fields · backend
`validate_items` · client `gatePlan`+SAT · culture coherence · opening keep-clear.

**Rule-based plan / `source: "rules"`**
The deterministic fallback layout when no LLM is configured or reachable. The UI badge says
**"Planned by DAR's rules"** rather than naming a model.

**`understood`**
The block the LLM returns alongside its placements: culture, room type, capacity, intensity,
wall/floor material, requirements, requested furniture — **every field validated against a
vocabulary DAR already owns**. `null` always means *"not said — leave the room alone."*

**Trigger phrase**
`"dardesign-<culture> style"` — the token the LoRA was trained on. **Always injected, whether
or not a LoRA file exists**, which is what makes prompt-only cultures possible.

**Prompt-only culture**
A culture with ontology terms and a trigger but no trained LoRA. **Persian** is the live
example — the proof that adding culture N costs one ontology entry, not a retraining run.

**Motif tiles**
The SVG replacements for national flag emoji: *qanater* (Lebanese triple arch), *majlis*
(Khaleeji), *zellige* (Moroccan tessellation).

---

## Machine-learning terms

**SDXL** — *Stable Diffusion XL*. The text-to-image diffusion model that produces the final
render. DAR uses `stabilityai/stable-diffusion-xl-base-1.0` at 1024², fp16.

**ControlNet** — a network attached to a diffusion model that lets an **image** constrain
generation, not just text. DAR uses **two simultaneously** (a "dual ControlNet"): depth at
weight 0.7 and segmentation at 0.5. This is how layout becomes a *control signal* rather
than a description.

**LoRA** — *Low-Rank Adaptation*. A small set of trainable matrices injected into a frozen
model, so a culture can be learned without retraining the whole network. DAR's are **rank
16, ~93 MB each**, fused at `lora_scale = 0.8`. Setting the scale to 0 gives prompt-only
output — which is why the Style Intensity Slider is literally the LoRA ablation.

**Depth map** — a per-pixel image of relative distance from the camera. DAR uses **Depth
Anything V2 Small**. Note: DAR *inverts* its disparity output so `0 = nearest`.

**Semantic segmentation** — labelling every pixel with an object class. DAR uses
**OneFormer** trained on **ADE20K**.

**ADE20K** — a 150-class scene-parsing dataset. Its class ids and palette are the shared
vocabulary between OneFormer, the segmentation ControlNet, and Build Mode's capture pass.
`src/lib/design/ade20k.ts` is **generated** from the backend's copy, because a
hand-transcription slip would degrade conditioning *silently*.

**Diffusion / denoising steps** — DAR uses 30 steps at guidance 7.0.

**Guidance scale** — how strictly the model follows the prompt. Higher = more literal, less
natural. DAR uses 7.0.

**Structured outputs / JSON Schema mode** — constraining an LLM to emit JSON matching a
schema. With an `enum`, invalid values become **unrepresentable at the decoding level** —
this is gate 1.

**RAG** — *Retrieval-Augmented Generation*: embedding a corpus, retrieving relevant chunks
at query time, and inserting them into the prompt.
> **⚠ NOT IMPLEMENTED IN DAR.** Cultural grounding is a curated ontology indexed by culture
> key plus a closed catalogue enum. → [07](07_RAG_ARCHITECTURE.md)

**Embedding** — a vector representation used for similarity search. **DAR has none.** The
word appears in the codebase only for SDXL *text-encoder* embeddings cached during LoRA
training, which is unrelated.

**Hallucination** — a model asserting something with no basis. DAR's answer is not
detection but **prevention**: make the invalid state unrepresentable (gate 1) and validate
everything else deterministically.

---

## Evaluation terms

**SSIM** — *Structural Similarity Index*, 0–1, higher = more similar. DAR's is
hand-implemented on numpy+scipy (matching scikit-image to 1e-9) because `scikit-image` is
not in the LIGHT image. **⚠ Currently measured on 3 designs.**
*A low SSIM between a photo and a redesign is expected — changing the room is the goal.*

**LPIPS** — *Learned Perceptual Image Patch Similarity*. **↑ means a bigger perceptual
change, NOT a worse model.** ⚠ **Zero measured values** — the package is not installed.

**CLIP score** — image-text similarity. DAR uses it for **zero-shot 3-way culture
recognition**. ⚠ **Zero measured values.**

**Confusion matrix** — `Culture` (requested) vs `PredictedCulture` (CLIP's guess). ⚠ **Zero
data.** **Never label it human accuracy.**

**Ablation** — removing one component to measure its contribution. DAR's is LoRA vs
prompt-only baseline. ⚠ **Implemented, corpus not generated, panel removed from the page.**

**`evaluableDesigns`** — `IsEdited = 0 AND IsLight = 0`. The population every average is
taken over, distinct from `roomsGenerated` (everything saved).

**`IsEdited` / `IsLight`** — flags marking a design as changed after generation, or as a
`DARDESIGN_LIGHT` placeholder. Both exclude it from statistics.

---

## Architecture and engineering terms

**SAT** — *Separating Axis Theorem*. Two convex shapes do not overlap **iff** some axis
exists on which their projections are disjoint. DAR uses it on **oriented** rectangles,
because a sofa rotated 30° into a corner is exactly the case an axis-aligned test gets wrong.

**AABB** — *Axis-Aligned Bounding Box*. Cheaper than SAT; DAR uses it only for room-bounds
and wall-distance tests where being conservative is safe.

**Gesture coalescing** — `beginGesture` / `endGesture` around a drag so a 200-frame
interaction becomes **one** undo entry.

**Snapshot undo** — storing whole scene copies rather than inverse commands. Simple and
correct; bounded at 60 entries.

**`SCENE_VERSION`** — the persisted scene schema version (**3**). `loadScene` **drops** a
mismatched scene rather than migrating — which is why `renderIntent` lives in page state,
not in `DesignScene`.

**Handoff** — the `sessionStorage["dar-build-handoff"]` payload carrying a Studio result
into Build Mode. Isolated in its own 4-line module so Studio's bundle stays free of
Build Mode's three.js.

**Truth gate / fail-closed vs fail-open** — Studio's quota check fails **closed** on
`quota_exceeded`/`not_authenticated` and **open** on anything else: an unreachable accounts
backend is not the user's overspend.

**Unconfigured is a working mode** — DAR's recurring pattern: no LLM key → rule-based plans;
no SMTP → log the message; no GPU → an honestly-labelled placeholder. **CI runs the degraded
paths, so they are never dark.**

---

## Cultural terms

| Term | Arabic | Meaning |
|---|---|---|
| **Majlis** | مجلس | A formal Arab sitting room; low perimeter seating, the room for receiving guests. Both a culture id and a room type in DAR |
| **Qanater** | قناطر | The triple-arch motif characteristic of Lebanese/Levantine architecture |
| **Zellige** | زليج | Moroccan geometric mosaic tilework |
| **Tadelakt** | تادلاكت | Polished lime plaster, waterproof, Moroccan |
| **Riad** | رياض | A traditional Moroccan house built around an interior courtyard |
| **Khaleeji** | خليجي | *Of the Gulf* — Arabian Gulf regional style |
| **Mashrabiya** | مشربية | A carved wooden lattice screen (DAR's `screen` category) |
| **Encaustic tile** | — | Patterned cement tile, common in Levantine interiors |

---

## Route reference

| Route | Is |
|---|---|
| `/` | DarCinema — the scroll-driven Arabic landing |
| `/studio` | **The product** — upload → `/redesign` → results |
| `/design` | **Build Mode** — 3D editor + planner + Render with DAR |
| `/history`, `/others` | Own designs; the public gallery |
| `/subscription` | Basic/Pro plans and usage |
| `/evaluation` | Admin evaluation dashboard |
| `/admin/users`, `/admin/subscriptions`, `/admin/analytics` | Admin |
| `/audit` | The render audit trail |
| `/v2` | The "Understood Room" three.js rebuild |
| `/transform`, `/result` | **Retired** — redirect to `/studio` |
