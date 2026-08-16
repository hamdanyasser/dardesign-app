# DarDesign — FYP Defense Deck · Claude → Claude Handoff

**Paste everything below the line into a fresh Claude session that has this repo mounted.**
It is written to be executed, not interpreted. Numbers in the Truth Ledger are the only
numbers allowed on a slide.

---

## ROLE

You are building the defense deck for **DarDesign**, a final-year data-science project:
a bilingual (EN/AR) AI interior-design system that redesigns a photographed room in one of
three Arab architectural cultures — Lebanese, Khaleeji, Moroccan.

You are acting as **presentation designer + data-visualisation engineer + the project's
honesty gate, in that order of visible effort and reverse order of authority.** If a beautiful
slide requires a number that does not exist, the number wins and the slide changes.

Read `CLAUDE.md` at the repo root before you write a single shape. It is long and it is
accurate; it is also the source of the project's voice, which the deck must sound like.

---

## HARD CONSTRAINTS

| Constraint | Value |
|---|---|
| Slide count | **9**. Not 10, not 11. The spine below is exactly 9. |
| Format | **Real `.pptx`**, 16:9, `13.333 in × 7.5 in`. Built with `python-pptx`. |
| Theme | **Light.** This is defended from a projector in a lit room. |
| Output path | `docs/presentation/DarDesign-FYP.pptx` |
| Language | English slides. Arabic appears as **typographic artefact** (title, culture names, ontology terms) — never as a translated duplicate of body text. |
| Fabrication | Zero. See Truth Ledger. |
| Build script | `docs/presentation/build_deck.py`, re-runnable and idempotent. |

**Every slide is visual-first.** No slide is a bulleted list. If a slide's argument cannot be
carried by a figure, an image, or a number set, the argument is not ready to be a slide.

---

## THE TRUTH LEDGER

This is the most important section. An FYP jury's sharpest question is *"where does that
number come from?"* — and this project's whole thesis is that it answers rather than deflects.

### Tier 1 — verified directly against the repo on 2026-08-15 (safe to print)

| Fact | Value | Source |
|---|---|---|
| Training images, total | **45** | `datasets/*/images/` |
| — Lebanese / Khaleeji / Moroccan | **19 / 14 / 12** | same |
| Ontology terms per core culture | **30** (7 categories: architectural, materials, color_palette, lighting, furniture, textiles, ornamentation) | `ontology/ontology.json` |
| Persian terms | **23**, prompt-only, no LoRA | same |
| Terms marked `verified: true` | Khaleeji **30/30** · Moroccan **30/30** · Lebanese **0/30** · Persian **0/23** | same |
| Furniture catalogue | **27** pieces = **9 per culture**, across **12** categories | `ontology/furniture.json` |
| Knowledge-base chunks (RAG) | **105** = 35 per culture × 3 | `ontology/knowledge/*.json` |
| Trained LoRAs on disk | **3**, each **93,076,472 bytes** (93.1 MB) | `models/loras/*/` |
| Saved designs in DB | **5** total, **4** evaluable (`IsEdited=0 AND IsLight=0`) | `backend/dardesign.db` |
| SSIM | **n=3**, mean **0.292** (0.253 / 0.276 / 0.348) | `history.Ssim` |
| Human ratings | **n=3** — cultural accuracy **4.0/5**, image quality **4.0/5**, room preservation **2.67/5** | `feedback` table |
| Furniture placement verdict | **2 valid / 1 not-applicable** (categorical, not a 1–5 scale) | same |
| End-to-end generation, evaluable rows | **47.4 s / 160.3 s / 227.1 s / 344.5 s** → mean **≈195 s**, median **≈194 s** | `history.Duration` |
| LPIPS | **not computed — n=0** | `history.Lpips` all NULL |
| CLIP score | **not computed — n=0** | `history.ClipScore` all NULL |
| Culture confusion matrix | **empty — `PredictedCulture` is NULL on every row** | same |
| LoRA-vs-baseline ablation | **not generated** — `eval/results.csv` does not exist | `eval/` holds only `CORPUS.md`, `run_metrics.py` |

### Tier 2 — recorded in `CLAUDE.md`, not re-verified in this pass

Print these **only** if you re-verify, or label them as recorded observations with their date.

- 713 backend tests; 1120 tensors per LoRA; three distinct sha256 (not copies).
- Build Mode → Render with DAR: **35.6 s** on a live GPU host (single run, 2026-08-13).
- Conditioning-capture fixes, measured in the conditioning only:
  centre-floor occupancy **79.1% → 28.6%**, seating at wall **0/2 → 2/2**,
  found-floor coverage **69.6% → 35.8%**, seg `table` class **23.7% → 3.3%**.
- 6 of 30 terms per culture carry a public citation (the join lives in `ontology/sources.md`,
  not in the JSON — the `verified` flag and the citation are different things).
- Furniture generation prompts measure 91–99 CLIP tokens.

### FORBIDDEN on any slide

1. **Any LPIPS, CLIP, or confusion-matrix figure.** They do not exist. Not as "illustrative",
   not greyed out, not as a chart with example data.
2. **Any accuracy percentage for cultural recognition.** Nothing in this project measures it.
3. **A rounded-up n.** Ratings are n=3 and SSIM is n=3. Print the n next to every mean,
   every time, in the same visual weight as the mean.
4. **A zero standing in for a missing value.** On a 1–5 scale a zero is unreachable, so
   printing one fabricates a result. Use an **em dash (—)**. This rule is enforced app-wide
   in the product; the deck inherits it.
5. **A claim that layout preservation improved.** It was diagnosed and intervened on;
   the intervention's *quality* is unmeasured. There is no side-by-side study.
6. **Stock interior photography.** Every room image must be a real pipeline output or a
   real screenshot. See Asset Manifest.

**When a jury-relevant figure is absent, say so on the slide.** An explicit "not yet computed —
n=0" reads as rigour. A blank space reads as a hidden weakness, and an invented number
ends the defense.

---

## THE STORY SPINE — 9 SLIDES

The through-line: **we authored the data, conditioned the layout, measured the result,
and the worst score is what shaped the second half of the project.** That last move is the
one that turns a build log into a data-science narrative. Do not lose it.

---

**01 · TITLE — "Same bones, three souls."**

- Arabic first, at display scale: **نفس العظام — ثلاث أرواح**, English beneath.
- Subtitle: culturally grounded interior redesign for Arab architectural styles.
- Placeholders you must ask the user to fill: student name(s), supervisor, university, date.
- Visual: full-bleed use of `02-landing-souls.png`, or a three-up triptych of the same room
  in three cultures if you can source three real outputs.
- The claim: one room, three cultural readings. It is the thesis in four words.

**02 · THE PROBLEM — two failures, named separately**

- (a) **Cultural flatness.** Generic generators collapse Arab interiors into a lantern and an
  arch. There is no vocabulary behind the image.
- (b) **Spatial infidelity.** The model invents a room. The user's room is a suggestion.
- Visual: a two-panel figure, one panel per failure. Left = cliché vocabulary,
  right = a layout that does not match its input.
- No numbers here. This slide states the hypothesis the rest of the deck tests.

**03 · THE DATA WE BUILT — the data-science contribution**

The pitch: this is not a scraped dataset, it is an **authored, versioned, bilingual,
verification-tracked cultural resource.** That is the contribution a data-science jury
should be able to point at.

- 45 training images across 3 cultures (19 / 14 / 12) — deliberately LoRA-scale.
- 30 bilingual terms × 3 cultures across 7 categories, each carrying a `weight` and a
  `verified` flag; + 23 Persian, prompt-only.
- 27 furniture pieces with real centimetre dimensions.
- 105 editorial knowledge chunks for retrieval.
- **The verification asymmetry is a feature of this slide, not a footnote:**
  Khaleeji 30/30, Moroccan 30/30, **Lebanese 0/30** — awaiting domain-expert sign-off.
  Show it as a three-bar figure. A project that displays its own unverified third is a
  project whose verified two-thirds you can trust.
- Visual: data-provenance figure + the verification bars. Follow the `dataviz` skill.

**04 · METHOD — layout is conditioned, not described**

- One diagram, left-to-right: photo → depth (Depth Anything) + segmentation (OneFormer,
  ADE20K palette) → prompt assembled from the ontology → **SDXL + dual ControlNet +
  per-culture LoRA** → render.
- Then the pivot that makes the project more than a fine-tune: **those two control images
  can be rendered from a 3D scene instead of derived from the photo.** Layout stops being
  something the model infers from a sentence and becomes something it is conditioned on.
- Visual: authored pipeline diagram (inline SVG → PNG), plus `06-understand-evidence.png`
  as the evidence that the depth/segmentation pass is real.
- This slide carries the **Morph transition** into 05.

**05 · TRAINING UNDER A REAL CONSTRAINT — one free T4**

- The constraint: 16 GB, free tier, no budget. Stated plainly; it is why the recipe is
  interesting rather than a limitation to apologise for.
- The dilemma, which is the technically strongest 20 seconds of the talk:
  loading the frozen base in **fp32 → OOM**; in **fp16 → NaN** (SDXL fp16 overflow).
- The resolution: **cache image latents and text embeddings once** with fp16 VAE/text
  encoders, free them, then train only the **fp32-master UNet + LoRA** under
  `autocast(fp16)` + `GradScaler`. The caching is what makes it both fit *and* stay stable.
- Result: 3 LoRAs, 93.1 MB each, all three deployed.
- Visual: a memory-budget figure (what is resident at each stage) — do not draw a generic
  neural-network cartoon.

**06 · KEEPING A LANGUAGE MODEL HONEST — six gates**

A natural-language brief ("make this a Moroccan majlis for six") is planned by an LLM into
furniture placements. Six gates stand between the model and the user's room, and each one
is a place a hallucination dies:

1. **Closed vocabulary** — `catalogId` is a JSON-Schema `enum`, so an invented piece is
   *unrepresentable*, not merely unlikely.
2. **No invented dimensions** — every size comes from `ontology/furniture.json`.
3. **Server validation** — unknown id / absurd coordinate → dropped **and reported**.
4. **Client re-validation** — every placement runs the same oriented-rectangle SAT collision
   test that colours a human's drag ghost.
5. **Advisory vs blocking** — physics refuses; judgement only warns.
6. **Culture coherence** — a piece from the wrong culture is dropped and named.

- Also: retrieval is **lexical BM25 over the 105 chunks**, not embeddings — chosen because a
  scored token match can be *shown and argued about in a defense*, and because it keeps CI
  free of a 470 MB model download. That reasoning belongs in the speaker notes.
- Visual: a funnel figure where each gate visibly narrows the space, + `05-build-mode.png`.

**07 · RESULTS — measured, with the gaps named**

Slide the jury will interrogate. Design it to reward interrogation.

- SSIM **0.292 (n=3)** — and state the reading direction: for a restyle, lower means more
  changed, so this is a magnitude-of-change figure, not a quality score.
- Human ratings **(n=3)**: cultural accuracy **4.0/5** · image quality **4.0/5** ·
  room preservation **2.67/5**.
- Generation time **47–345 s** on free-tier GPU (mean ≈195 s, n=4).
- Build Mode render **35.6 s** (single verified run, dated).
- A visibly-present **"not yet computed"** block: LPIPS n=0 · CLIP n=0 · confusion matrix
  empty · LoRA-vs-baseline ablation not generated. Em dashes, never zeros.
- Visual: metric tiles + a small ratings chart. Follow the `dataviz` skill before writing a
  single line of chart code. n=3 must be as legible as the means.

**08 · WHAT THE NUMBERS TOLD US TO BUILD**

The slide that makes this a data-science project rather than a portfolio piece.
Measurement → diagnosis → intervention → re-measurement.

- **The finding:** room preservation (2.67) is far below cultural accuracy and image quality
  (both 4.0). The system was producing beautiful rooms that were not *the user's* room.
- **The diagnosis:** layout was being inferred from a text prompt. Nothing bound it.
- **The intervention:** Build Mode — the room arrives already understood (floor area and
  furniture footprints reconstructed from the analysis pass as locked "found" massing), the
  user edits in real centimetres, and the scene's own depth + segmentation are substituted as
  the ControlNet conditioning.
- **The re-measurement, stated at exactly its real strength:** conditioning-level
  measurements improved (centre-floor occupancy 79.1% → 28.6%; seating at wall 0/2 → 2/2 —
  Tier 2, dated, conditioning-only), and **the perceptual quality of layout preservation
  remains unmeasured.**
- Visual: `04-studio-result.png` and `05-build-mode.png` as a before/after of the *approach*,
  plus the conditioning triplet (beauty / depth / segmentation) if you can capture it.
- This slide carries the second **Morph transition**, from 07's metric tiles.

**09 · HONEST EDGES, AND WHAT IS NEXT**

Close on the limits. It is the strongest possible ending for a defense because it takes every
easy question off the table before it is asked.

- Lebanese vocabulary is **0/30 verified** — pending expert sign-off.
- The 15 spatial conventions used to arrange rooms are **unverified and uncited**; the product
  labels them so on screen.
- Human evaluation is **n=3** — an observation, not a result.
- LPIPS / CLIP / confusion matrix / ablation: **corpus not yet rendered.**
- Furniture **geometry is culture-blind** (a sofa is one builder in all three cultures,
  differing only in centimetres); per-culture silhouettes are deliberately future work.
- **1 of 27** 3D assets is a real scan; 19 of ~20 CC0 candidates were rejected as culturally
  wrong — the near misses are the instructive ones (a Western storm lantern is not a pierced
  star lantern, and the piercing *is* the cultural signal).
- Next: expand the corpus and compute the deferred metrics; report per-convention
  PASS/PARTIAL in the UI so "how do you know it is Moroccan?" has a measured answer.

---

## DESIGN SYSTEM

Inherit the product's own identity. The deck and the app must read as one authored thing —
which is itself an argument the jury absorbs without being told.

### Palette — limestone + cobalt, light

```
bg              #f2f1ea    page ground
surface         #ffffff    panels, image mounts
surface-strong  #e6e5db    elevated / inset
accent          #1b4fa0    COBALT — the primary accent
accent-hover    #123c7c    deeper cobalt for emphasis
accent-dim      #5b7cb8    muted cobalt, secondary series
text            #14202f    primary
text-soft       #2c3a4d    secondary
text-secondary  #53617a    tertiary / captions / units
border          rgba(20,32,47,.18)   hairlines
error           #e85d4a    absent-data marks, negative deltas
success         #4a9e6e    positive deltas
```

Culture accents, for figures that separate the three cultures — sourced from the ontology's
own `color_palette`, not invented:
`lebanese` limestone/cedar warm neutral · `khaleeji` brass · `moroccan` terracotta + cobalt.

Read `ontology/ontology.json` `color_palette[].hex` for the real values rather than guessing.

**Never** use gold-on-dark. The project deliberately repaletted away from it: it is the single
most over-used generative-design palette, and metallic yellow drifts to muddy olive under
projector gamma.

### Typography

- Display / headings: **DM Sans**, tight tracking. Fallback **Segoe UI**.
- Body: **Inter**. Fallback **Segoe UI**.
- **Metrics, dimensions, durations, codes: JetBrains Mono.** Fallback **Consolas**.
  Mono is restricted to measured values — never headings, body, or labels.
- Arabic display: **Reem Kufi**; Arabic body: **Tajawal**. Fallback: a Windows Arabic face.
- **Before you build, probe what is actually installed** and record your choice in a comment
  at the top of `build_deck.py`:

  ```powershell
  [System.Drawing.Text.InstalledFontCollection]::new().Families |
    Where-Object { $_.Name -match 'DM Sans|Inter|JetBrains|Reem|Tajawal' } |
    Select-Object -ExpandProperty Name
  ```

  `python-pptx` **cannot embed fonts.** If a face is missing, either install it or fall back —
  do not ship a deck that reflows on the presenting machine. Tell the user which set you used.

### Layout rules (from the product's frozen visual direction)

- **Hairline rules, never card borders.** 0.75 pt in `border`. This one rule does most of the
  work of making a deck look authored rather than templated.
- One radius family: **2 / 6 / 14 px**. Never pill except toggles.
- **No drop shadows**, with exactly one exception: a single soft lift under a hero image.
- Generous margins: 0.9 in outer, and let whitespace carry hierarchy instead of boxes.
- Slide furniture: a small mono slide number and a hairline baseline. No footer logo on
  every slide; brand once, on 01.
- **Em dash for any unmeasured figure.** Never a fabricated zero.

---

## ANIMATION SPEC

The brief asked for animation. The discipline that makes animation read as craft rather than
as PowerPoint 2003 is: **animation reveals the order of an argument, and nothing else.**

### Allowed

| Use | Effect | Timing |
|---|---|---|
| Any element entrance | **Fade**, optionally with a 12 px rise | 320 ms, ease-out |
| Sequential items (metric tiles, gate steps, bars) | Fade, **staggered 80 ms** | on click, one build per argument step |
| Before/after reveal | **Wipe**, in reading direction | 600 ms — mirrors the product's own comparison slider |
| 04 → 05 and 07 → 08 | **Morph** slide transition | 700 ms |
| Every other slide change | **Fade** | 400 ms |

### Forbidden

Fly-in, bounce, spin, zoom, dissolve, checkerboard, 3-D rotate, sound, any looping
attention-getter, and any per-bullet build on a slide whose content is a figure.
**Maximum 3 build steps per slide.** If a slide needs four, it is two slides — but the deck
is fixed at nine, so it is instead one slide with less on it.

### Implementation, in order of preference

1. **Injected OOXML timing.** Build every slide static and correct with `python-pptx`, then
   attach a `<p:timing>` tree per slide. `python-pptx` has no animation API, so write the XML
   through `lxml` on `slide._element`. Shape:

   ```
   p:timing / p:tnLst / p:par / p:cTn(dur="indefinite", restart="never", nodeType="tmRoot")
     └ p:childTnLst / p:seq(concurrent="1", nextAc="seek")
         ├ p:cTn / p:childTnLst / p:par …            one per click step
         │    └ p:set(visibility=visible) + p:animEffect(transition="in" filter="fade")
         │       targeting p:spTgt spid="<shape id>"
         └ p:prevCondLst / p:nextCondLst              onNext / onPrev click triggers
   ```

   Morph transition goes on the *incoming* slide as
   `mc:AlternateContent → p:transition` with `p14:morph option="byObject"` and the
   `p14` namespace declared. **Verify by opening the file in PowerPoint** — a malformed
   timing tree makes PowerPoint offer to repair the file, which is a total failure, not a
   warning. If repair is offered, drop to option 2 and say so.

2. **Static deck + an apply-in-PowerPoint checklist.** Ship the `.pptx` with every shape
   correctly named (`slide.shapes` given meaningful `name` values so the Animation Pane is
   navigable) plus `docs/presentation/ANIMATIONS.md`: per slide, which shape gets which
   effect in which order. This is ~10 minutes of clicking and is **100% reliable**.

Do 1, verify it opens clean, and write 2 regardless — the user is defending a thesis and needs
a path that cannot fail on the day.

Do **not** silently ship a static deck while describing it as animated. If option 1 fails,
say so in one line.

---

## ASSET MANIFEST

Real screenshots, already captured at 1600 px wide in light theme, in
`docs/presentation/assets/`:

| file | what it shows | use |
|---|---|---|
| `01-landing-hero.png` | Landing "threshold" arch, light | optional, 01 |
| `02-landing-souls.png` | **"same bones, three souls"** + real Lebanese render | **01** |
| `03-studio-upload.png` | Studio upload + culture picker + Defense Mode strip | 02 or 09 |
| `04-studio-result.png` | **"A room remembered." before/after wipe + culture switcher** | **08** |
| `05-build-mode.png` | **Build Mode: 3D room, inspector with real cm, planner brief, catalogue rail** | **06, 08** |
| `06-understand-evidence.png` | Element highlighter + 2D top-down map + 3D room view | **04** |
| `07-studio-clean.png` | Signed-in Studio with the weekly quota line | 09 |
| `09-subscription.png` | Basic/Pro plans, usage counter, pending-approval banner | 09 (product completeness) |
| `11-community.png` | Others' Work — real Khaleeji render with diamond ratings | 07 or 09 |
| `08-history.png` | **Empty state** — weak, do not use unless you re-shoot with saved designs |  |
| `10-evaluation.png` | **Admin gate only** — the QA account is not an admin | see below |

### Assets still needed — ask the user, do not fabricate

1. **The evaluation dashboard** (`/evaluation`). Admin-only; the only Admin account in the
   local DB is `darwechzainab@gmail.com` and its password is not available. Ask the user to
   sign in as admin and screenshot it — **but note first** that with LPIPS/CLIP/ablation
   absent, most of that page will read "No data", which is honest and may still be worth
   showing on 07 as evidence that the reporting is wired and the corpus is what is missing.
2. **The conditioning triplet** (beauty / depth / ADE20K segmentation from one Build Mode
   scene) for slide 08. This is the single most persuasive figure in the whole project and no
   screenshot of it exists yet.
3. **Title-slide facts**: student name(s), supervisor, university, defense date.
4. Optionally a saved-designs History view, once an account has real saved rows.

### Figures you must author (inline SVG → PNG at 2× for crispness)

- 02 — the two-failure panel
- 03 — data provenance + the three verification bars
- 04 — the pipeline, left-to-right, with the 3D-conditioning branch
- 05 — the T4 memory budget by training stage
- 06 — the six-gate funnel
- 07 — metric tiles + ratings chart (**load the `dataviz` skill first**)

Rasterise at 2× and place as pictures; keep all *text* as native PowerPoint text so it stays
crisp, selectable, and editable. Never flatten a slide to one image.

---

## SPEAKER NOTES

Every slide gets notes, via `slide.notes_slide.notes_text_frame`. Each note contains:

1. The one sentence the slide exists to say.
2. The number(s) on screen and **where each comes from** — table, file, or dated run.
3. The likeliest jury question and a one-line answer.

Slide 07's note must include: *"LPIPS, CLIP and the confusion matrix are not computed — the
corpus has 4 evaluable designs. The reporting is built and the queries are tested; what is
missing is rendered volume, and I can state exactly what it would take."*

---

## ACCEPTANCE CHECKLIST

Do not report done until every line is true, and report any line you could not satisfy.

- [ ] Exactly 9 slides, 13.333 × 7.5 in.
- [ ] `docs/presentation/DarDesign-FYP.pptx` opens in PowerPoint with **no repair prompt**.
- [ ] Every number on every slide traces to Tier 1, or is labelled as a dated Tier 2 observation.
- [ ] No LPIPS, CLIP, confusion-matrix or ablation figure anywhere.
- [ ] Every mean prints its **n** at equal visual weight.
- [ ] Every unmeasured value is an **em dash**, never 0.
- [ ] No stock interior photography; every room is a real output or screenshot.
- [ ] Light theme throughout; cobalt accent; no gold-on-dark.
- [ ] Mono font appears **only** on measured values.
- [ ] Hairlines, not card borders; one shadow in the whole deck at most.
- [ ] ≤ 3 build steps per slide; no forbidden effect used.
- [ ] Two Morph transitions (04→05, 07→08); fade elsewhere.
- [ ] Speaker notes on all 9 slides.
- [ ] `build_deck.py` re-runs clean from scratch and regenerates the identical file.
- [ ] `ANIMATIONS.md` written, whether or not XML injection succeeded.
- [ ] Fonts actually installed on this machine were used, and named in a comment.

---

## FIRST ACTIONS

1. Read `CLAUDE.md`, then `docs/presentation/DECK_HANDOFF.md` (this file).
2. Re-verify Tier 1 yourself — the queries are one-liners against
   `ontology/*.json`, `datasets/*/images/`, `models/loras/*/`, and `backend/dardesign.db`.
   **Trust nothing here that you have not re-run.** This deck's only real asset is that
   every number on it survives being checked.
3. Ask the user for the four missing assets above — in one batched question, then start
   building the seven slides that do not depend on the answers.
4. Load the `dataviz` skill before writing any chart code.
