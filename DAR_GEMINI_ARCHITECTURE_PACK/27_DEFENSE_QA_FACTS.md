# 27 — Defense Q&A Facts

*Factual answers to the architecture questions a jury will actually ask.
**Every answer reflects the current implementation and can be traced to a file.***

---

## ⭐ The answer to have ready before any other

> **"Explain your system in one sentence."**
>
> ### "The LLM designs, DAR validates, the user edits, and ControlNet + SDXL renders."
>
> Or, more technically:
> ### "LLM = Designer · DAR = Spatial Truth · Build Mode = User Control · ControlNet + SDXL = Renderer."

---

## Section 1 — Why an LLM at all?

**Q: Why use an LLM? Couldn't rules place furniture?**

They can, and they do — `fallback_plan()` in `backend/design_planner.py` is a complete
rule-based layout engine, and it runs whenever no model is configured. **The LLM is not
there to place furniture. It is there to read a sentence.**

Rules cannot turn *"a majlis for eight people, keep the centre open, warm beige walls"*
into a structured intent. The model returns an `understood` block — culture, room type,
capacity, cultural intensity, wall and floor material, stated requirements, requested
pieces — **and every one of those fields is then forced into a vocabulary DAR already
owns.** The *placement* it proposes is a suggestion; DAR's collision engine decides.

**Q: Why not let the LLM place furniture directly?**

Because a language model has no metric model of space. It cannot know that a 210 cm sofa
and a 90 cm armchair do not both fit along a 260 cm wall, and it will confidently say they
do. So DAR takes the proposal and runs it through **the same oriented-rectangle
separating-axis collision test that colours a human's drag ghost and refuses a human's
drop** (`evaluatePlacement` in `src/lib/design/placement.ts`).

> **One rule, four surfaces** — the ghost colour, the Inspector's explanation, the refusal
> of a human drop, and the gating of an AI plan all read the *same* verdict, so they
> cannot disagree.

**Q: What if the LLM is unavailable, or you run out of credit?**

Then the user still gets a furnished room. `plan()` **never raises**: no key, SDK absent,
provider error, or the per-process call cap → a deterministic rule-based layout tagged
`source: "rules"`, and the UI badge says **"Planned by DAR's rules"** instead of naming a
model.

**This is not theoretical** — it was first exercised against a real
`400 credit balance too low`. **CI runs that path, so the feature is never dark.**

---

## Section 2 — Hallucination and grounding

**Q: How do you prevent the model inventing furniture that doesn't exist?**

**Six gates, and the first one makes it impossible rather than unlikely.**

| Gate | Mechanism |
|---|---|
| **1** | `catalogId` is a **JSON-Schema `enum`** of exactly the 27 catalogue ids. With structured outputs, `"leb-chandelier-009"` is **unrepresentable at the decoding level.** Enforced on **both** providers — `gemini_schema()` translates the rest of the schema while preserving the enum |
| **2** | The schema has **no size fields at all**. Dimensions come from `ontology/furniture.json` |
| **3** | Backend `validate_items()` — unknown id, non-finite or absurd coordinate, unknown material → **dropped AND reported**, each with a distinct true reason |
| **4** | Client `gatePlan()` → `evaluatePlacement()` — the same SAT engine a human drag uses |
| **5** | Culture coherence — the model sees all 27 pieces, so it *can* mix them; any item whose culture differs from the one it chose is dropped and named |
| **6** | Door 90 cm / window 40 cm keep-clear zones, checked deterministically |

**Q: What makes DAR culturally grounded?**

Three things, none of which is "the model knows about Arab design":

1. **A curated ontology** — `ontology/ontology.json`, 113 hand-authored terms across 7
   categories per culture, in Arabic and English, each with a `weight` and a `verified`
   flag. The generation prompt is **built** from it, not typed.
2. **A closed catalogue** — 27 pieces with real centimetre dimensions, cultural tags and
   placement rules. This *is* the model's vocabulary.
3. **Trained cultural LoRAs** — one per culture, rank 16, trained on curated per-culture
   image sets.

> **Be precise about the limit:** *"Khaleeji and Moroccan terms are marked `verified: true`
> in the ontology. Lebanese and Persian are `verified: false` — expert sign-off is still
> pending. The mechanism to exclude unverified terms exists (`strict=True`) and is
> currently not enabled."*

**Q: Do you use RAG?**

**No.** And that is a considered decision, not a gap.

The cultural corpus is ~113 ontology terms plus 27 catalogue items — about 140 records.
Retrieval over that would add latency, an embedding-model dependency, and a new failure
mode (retrieving the wrong culture's terms) in exchange for nothing. **DAR indexes by
culture key instead** — an O(1) dictionary lookup that always returns the complete, correct
vocabulary.

Two properties follow that retrieval could not give:
- **A domain expert can audit it** by opening one JSON file and reading every term.
- **The model cannot cite something that does not exist**, because the catalogue is a
  schema enum rather than a retrieved passage.

*If asked "would RAG help?"* — only if the corpus grew past what fits in a prompt, e.g. if
the cultural sourcing became hundreds of documents. That is a reasonable future direction,
not current work.

> ⚠ `backend/guardrails.py` has a function `filter_chunk` whose docstring mentions "RAG
> chunks". **It is applied to the static ontology JSON**, because a non-developer edits that
> file and its text reaches the SD prompt. It is a defensive sanitiser, not retrieval.

---

## Section 3 — The 3D system

**Q: Why Three.js? Why not just generate images?**

Because the 3D scene is **not for looking at — it is for producing the control signal.**

`backend/transform.py` already ran SDXL with a dual ControlNet: depth + ADE20K
segmentation, normally derived *from the photograph*. Those two images **are** the layout
signal. Once DAR has a metric 3D room, it can render **exactly those two images** from the
scene and substitute them.

> **So layout stops being something the model infers from a sentence and becomes something
> it is conditioned on.**

The second reason is user control: an image can only be re-rolled; a 3D scene can be edited
one object at a time.

**Q: Do you use real 3D furniture models?**

**One of the 27 catalogue pieces is a real scan; the other 26 are authored geometry.**

DAR labels all three tiers in the product: **REAL MODEL** (1), **ENHANCED PROCEDURAL** (26),
**FALLBACK MASSING** (objects read off the user's photograph).

The one real model is `leb-ottoman-001` — the CC0 *Ottoman 01* scan from Poly Haven, fitted
inside the catalogue's 55 x 42 x 55 cm box. **And the inspector names the asset rather than
implying it is DAR's catalogue piece**, because DAR's own art shows turned wooden legs where
the scan has block feet.

Three reasons:
1. **The cut-out PNGs would be stickers.** A billboarded photo among lit volumes breaks the
   moment the camera moves. They appear in the catalogue rail and nowhere else.
2. **What the renderer needs is silhouette, position, orientation and semantic class** —
   all of which a correctly-sized procedural volume supplies exactly as well as a detailed
   mesh.
3. **Honesty.** The look is a deliberate architect's maquette, so **DAR never implies it
   rendered something it did not.** The photorealism comes from SDXL afterwards.

**Q: How does the user keep control?**

Nothing the AI does is irreversible, and every AI proposal is shown **alongside what was
refused**.

- An entire AI plan applies as **one gesture** — `beginGesture` → N × `addAt` →
  `endGesture` — so **one Ctrl+Z removes all of it**, materials included. (`replace` would
  wipe the undo stack, which is exactly why the plan never uses it.)
- Move, rotate, add, delete, duplicate, re-material, lock, resize the room, toggle the
  found layer — all manual.
- The user chooses the viewpoint (their azimuth is carried into the capture camera), the
  room type, and the cultural intensity.
- **Found objects are locked by default**, because moving one silently turns a measurement
  into a fiction.

---

## Section 4 — The generation pipeline

**Q: What does ControlNet do?**

It lets an **image** constrain a diffusion model, not just text. Without it, "put the sofa
against the far wall" is a sentence the model may or may not honour. With it, the sofa's
position is a **pixel constraint**.

DAR uses **two at once**, at different strengths:

| ControlNet | Model | Weight | Binds |
|---|---|---|---|
| Depth | `diffusers/controlnet-depth-sdxl-1.0` | **0.7** | Volume, distance, perspective, 3D silhouette |
| Segmentation | `SargeZT/sdxl-controlnet-seg` | **0.5** | Object identity, boundaries, wall/floor/ceiling |

**Q: Why both? Isn't one enough?**

They fail in complementary ways.

- **Depth alone**: the model knows *where* volumes are but not *what* they are. A
  sofa-shaped mass may come back as a bed, a bench, or a built-in platform.
- **Segmentation alone**: the model knows *what* things are but not their 3D relationship.
  Flat regions leave it guessing perspective and volume — furniture floats or intersects.

> Depth fixes *where and how big*; segmentation fixes *what*. The prompt and LoRA then
> supply *in which culture's idiom*.

The differing weights are also the honesty boundary: depth at 0.7 binds geometry hard;
segmentation at 0.5 binds identity more loosely, **leaving the generator room to invent
culturally-appropriate surface and ornament inside the silhouette it is given.**

**Q: What does LoRA do?**

It teaches SDXL a specific visual language without retraining it. A small set of low-rank
matrices is injected into the frozen UNet — **~93 MB per culture at rank 16**, versus the
several gigabytes of the base model.

DAR has three, one per culture, fused at `lora_scale = 0.8`.

> **And the scale is exposed to the user.** The Style Intensity Slider maps directly onto
> `lora_scale`: at 0 you are looking at prompt-only SDXL, at 1 at the full cultural
> adapter. **That is the LoRA ablation, made interactive.**

**Q: How was the LoRA trained on a free GPU?**

A 16 GB T4 cannot hold SDXL for training — **fp32 OOMs, fp16 NaNs** (SDXL fp16 overflow).
The recipe that works: **cache image latents and text embeddings once** using the fp16 VAE
and both text encoders, then **free them**, and train only the **fp32-master UNet + LoRA**
with `autocast(fp16)` + `GradScaler`.

The caching is what makes it both **fit** and **stay stable** — the frozen base's only job
is encoding, and once that is cached it is dead weight.

*(One practical trap: the Kaggle **API** grants a P100, which cannot run SDXL fp16. The T4
must be selected in the Kaggle UI.)*

**Q: What happens if the GPU runs out of memory?**

`transform_room` catches `_OutOfMemory`, frees the cached SDXL pipeline, and re-runs on
**SD 1.5 + ControlNet 1.1 at 768²**. The user gets a lower-resolution result rather than an
error. *(Honest caveat: the code path exists but no OOM event has been observed in the
recorded history.)*

---

## Section 5 — Deterministic vs AI

**Q: Which parts are AI and which are ordinary code?**

| Concern | Deterministic | AI |
|---|---|---|
| What objects are in the photo | | ✅ OneFormer |
| Their relative depth | | ✅ Depth Anything |
| Floor-area estimate | ✅ mask arithmetic + assumed reference widths | |
| Room rectangle | ✅ `deriveRoom` | |
| Which pieces suit the brief | | ✅ LLM |
| Where a piece is **proposed** | | ✅ LLM |
| **Whether it MAY stand there** | ✅ **SAT collision** | |
| Whether it blocks a door | ✅ `blockedOpening` | |
| Repairing a bad placement | ✅ `findSpot` | |
| Piece dimensions | ✅ `furniture.json` | |
| Seat capacity | ✅ `seats_of` | |
| Collision, snapping, undo, bounds | ✅ | |
| The final photograph | | ✅ SDXL + ControlNet + LoRA |

**Q: Give me one example of the validator overruling the AI.**

Certainly. In `gatePlan`, items are validated **in order against the scene as it is being
built** — so the second piece is judged against the first. If the model proposes a coffee
table where it has already placed an armchair, `evaluatePlacement` returns `overlaps` as a
**blocking** issue. DAR then makes **one** repair attempt through `findSpot` — the same
auto-placer that positions a piece a human adds — and if that fails, the item is **dropped
and shown in a "Not placed" list** with the reason *"There was no room left for it."*

**The user sees what was refused. A shorter plan than the model wrote is explained, not
silently displayed.**

**Q: But doesn't refusing everything make it useless?**

That is exactly why the verdict has **two tiers**, and conflating them made the editor feel
broken.

- **Blocking** = physics the user cannot mean → refuses.
- **Advisory** = judgement → stated in amber, **never refuses**.

Standing a sofa where the photograph found the old one is **the most likely act of
redesign**. Standing near a door is judgement, not physics. Those are reported, not refused.

---

## Section 6 — Room understanding

**Q: How does DAR know how big the room is?**

**It doesn't, precisely — and it says so.** This is worth answering carefully.

A single photograph has no metric scale. DAR calibrates pixels-per-centimetre against
furniture of **assumed** size (door 85 cm, sofa 200 cm, armchair 90 cm, chair 48 cm, bed
150 cm, coffee table 110 cm), takes the **median**, and derives a confidence from the spread.

Then, client-side:
- floor **area** = `free_floor_m2 / free_floor_of_floor`
- **width = √(area × 1.25)** — the aspect ratio is an **assumption**
- **height = 300 cm** — **always a constant, never derived**

**Q: How accurate is that?**

**Sometimes badly wrong, which is why there is a plausibility band.** Two real measurements
from one session: one photo produced **130 m²** (an 11 × 11 m room — furniture lost in a
hall), another **3.6 m²** (clamped to the 260 cm minimum, where a planned majlis could not
fit and pieces were correctly dropped for lack of space).

Estimates outside **9–90 m²** are rejected and DAR falls back to a default room **labelled
`default`**. The header chip says `measured` / `estimated` / `default`, so **a default room
is never presented as a measurement** — and if the user resizes the room by hand, the
provenance downgrades to `default` automatically.

> *"An ordinary room DAR does not claim to have measured beats a measurement that is
> visibly wrong."*

---

## Section 7 — Render with DAR

**Q: How much did you have to change the model to support Build Mode rendering?**

**Nothing. `_generate()` gained one optional parameter:**

```python
def _generate(..., control_override: tuple | None = None):
    if control_override is not None:
        depth, seg = control_override
    else:
        _, depth, seg = _prepare_conditioning(image_path, target_size)
```

With it `None`, **the `/redesign` path is byte-for-byte unchanged.** No model change, no
notebook change, no retraining. Same discipline for the planner's additions: `room` and
`scale` are optional pass-throughs.

**Q: How do you know the conditioning actually reaches the model?**

It was instrumented rather than assumed: `control_override` is passed; depth and seg arrive
at full size with correct ADE20K classes; `use_lora=True` with the selected culture; and
**`_prepare_conditioning` is called 0 times** — no silent fallback to photo-derived
annotators. Segmentation output is **pixel-exact** against the backend palette.

**And end-to-end on a real GPU (2026-08-13):** a 13-object Build Mode scene came back as a
genuine render in **35.61 s**.

**Q: Was there anything that went wrong?**

Yes, and it is the best story in the project.

The first real render read as **a wooden-screen storage room**, not a majlis. The cause was
the **camera**. The capture cloned the on-screen orbit camera: *outside* the room, ~30°
above horizontal, 38° FOV. But SDXL and both ControlNets were trained on **interior
photographs made from inside rooms at eye height with a wide lens**. Every capture handed
them a viewpoint no camera could occupy.

`renderConditioning` now builds its own camera — inside the room, eye height 155 cm, 54°
FOV (≈24 mm), keeping only the user's azimuth. **The same 13-object scene, restored from
`localStorage`, then re-rendered as a believable room.**

Two consequences followed from being inside: **all four walls stay** (the exterior camera
had to hide the walls it looked through, so the generator got a room with holes where its
corners belonged), and a **capture-only ceiling** was added, because an open top reads as
sky from inside.

**Q: What does Render with DAR actually guarantee?**

| | |
|---|---|
| **Held** | placement, orientation, geometry, viewpoint — **because they are the control signal** |
| **Not held** | the appearance of any individual piece — the model invents surface and ornament *inside* the silhouette; materials reach it through the prompt, so they **steer rather than bind** |

**That statement is shown to the user next to the render, alongside the actual depth and
segmentation images that were sent.**

---

## Section 8 — Limitations (answer these confidently)

**Q: What are your results?**

> **"The evaluation *system* is implemented; the evaluation *corpus* has not been
> generated. I have SSIM on three designs and two human ratings. LPIPS, CLIP and the
> confusion matrix are implemented and hold zero data. I can show you exactly how every
> metric is computed and aggregated, and the dashboard is deliberately built so it cannot
> display a number it does not have — an unmeasured figure renders as an em-dash, never a
> zero, because on a 1-to-5 scale a zero is unreachable and printing one would fabricate a
> result."**

**Q: Why is your SSIM only 0.25?**

SSIM between a photograph and a **redesigned** room is expected to be low — changing the
room is the goal. Without a baseline arm to compare against, the absolute value carries no
claim, which is why I am not making one.

**Q: Is the LoRA actually better than prompt-only?**

**Unmeasured.** The ablation is implemented — `automatic_metrics()` splits `eval/results.csv`
by arm and computes deltas — but the corpus has not been rendered. **I removed the panel
from the page rather than show a permanently empty box**, because an empty box reads as
unfinished rather than as an honest absence. What I *can* do is show you the comparison
interactively: the Style Intensity Slider is the LoRA scale, so you can watch prompt-only
become full-adapter live.

**Q: What are the main limitations?**

1. **Scale estimation from a single photo is unreliable** — hence the plausibility band and
   the provenance chip. Room height and aspect ratio are assumptions, not measurements.
2. **Almost no measured results.**
3. **Lebanese ontology terms are not expert-verified**, and it is the hero culture.
4. **19 / 14 / 12 training images per culture** — very small for a LoRA.
5. **Only 1 of 27 pieces is a real scan** — no CC0 library of Arab furniture exists.
6. **Generation endpoints are unauthenticated** — quota is enforced at the client boundary,
   so direct calls to the render backend bypass it. The reason is architectural (the GPU
   host has no users table and is sent no cookie), but the consequence is a real weakness.
7. **No concurrency** — `_GEN_LOCK` serialises generation; jobs are in-memory.
8. **Persian is prompt-only** — a scalability demonstration, not a fourth product culture.
9. **Layout-preservation quality is unmeasured** — verified qualitatively on a handful of
   renders, and a handful of renders is an observation, not a result.
10. **The cushion and camera-occupancy fixes are verified in the conditioning only**, not
    re-rendered — the GPU tunnel expired before I could.

**Q: Why should we believe the parts you say work?**

Because the degraded paths are the ones CI runs. **583 tests pass under
`DARDESIGN_LIGHT=1`**, which exercises the real FastAPI app with a placeholder render
branch — the rule-based planner, the validators, the quota transaction, the recolour
masks, the evaluation aggregation. And where I claim a GPU result, I have the timing and
the A/B: 35.61 s on a live host, on a named 13-object scene, restored from `localStorage`
so both renders had identical input.

---

## Section 9 — Trap questions

**Q: Isn't this just a wrapper around Stable Diffusion?**

The generator is off-the-shelf; **what is fed to it is not.** Three things are original:
the curated cultural ontology that builds the prompt, the deterministic spatial layer that
decides what may exist where, and — the part I would defend hardest — **rendering the
ControlNet conditioning from an editable 3D scene**, so the user's layout is imposed on the
model rather than described to it.

**Q: Couldn't the LLM do all of this?**

It could produce something plausible-looking. It could not tell you whether the sofa fits,
and it would say it does. **DAR's position is that plausibility and correctness are
different, and that a designer needs the second one.**

**Q: What would you do with another six months?**

Generate the evaluation corpus and publish the ablation; get the Lebanese ontology
verified; measure layout preservation properly with a defined metric; authenticate the
generation endpoints; and re-render the two conditioning fixes that are currently verified
only in the control images.

**Q: What is the one thing you are most confident about?**

That the deterministic layer genuinely holds authority. It is not a filter bolted on after
the fact — **it is the same function that colours a human's drag ghost, explains the
verdict in the inspector, refuses a human's drop, and gates an AI plan.** One rule, four
surfaces, so they cannot disagree.
