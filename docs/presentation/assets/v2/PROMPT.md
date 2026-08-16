# Deck prompt — paste into the SAME chat that built deck v2

This is written as a **continuation**, not a new brief. It assumes the assistant still has
v2 in context (full-bleed culture plates, screenshots bleeding to the slide edge with a
limestone copy block on top, floating annotation cards, the animated waypoint line, the
architecture spine, 110px metrics, the roadmap bars, 2–4 word list items with full wording
in speaker notes).

Attach: the 20 PNGs from `docs/presentation/assets/v2/` **and** `MANIFEST.md`.

---

## The message

````
Here's the screenshot pack you asked for in SCREENSHOTS-REQUEST.md. Wire it into deck v2 —
keep the v2 design language exactly as it is, don't restart the deck.

All 20 images are attached, plus MANIFEST.md which says what each one is, which route and
account it came from, and which figures are real. Everything is live app state — no demo
mode, no mockups, no retouching.

Two things to do:
  1. Place the real screenshots where v2 currently has placeholders.
  2. Lock the slide order and content to the spine below. It replaces any earlier ordering.

---------------------------------------------------------------------------
THE SPINE — 10 slides, two acts, one story
---------------------------------------------------------------------------
The narrative is: what we built → how it works → what we used → how we know it
works → where it goes next. Act 1 is the live demo. Act 2 is the technical defense.

ACT 1 — THE DEMO (runs alongside the live walkthrough)

  01  DarDesign
      Project name + one line: "AI-powered culturally aware interior design for
      Lebanese, Moroccan and Khaleeji styles."
      VISUAL: 01-three-cultures-lebanese / -moroccan / -khaleeji as three full-bleed
      plates, wordmark over them. These are the SAME room, same camera, three cultures —
      that is the whole argument, so the plates must read as one room.
      SAY: "I'll show DarDesign from the user's side first, then the pipeline behind it."
      15-20 seconds. Do not linger.

  02  From an idea to a design
      Flow: Upload room → Choose culture → Set intensity → Describe it → Generate
      Annotation cards: three cultures · cultural intensity · natural-language request
      VISUAL: 02-studio-upload.png, bled to the slide edge, copy block on top.
      SAY: "The user uploads a room, picks the culture, and decides how strongly the
      culture should come through."

  03  The design planner
      The sentence goes in, a structured plan comes out.
      Brief:  "Create a Lebanese living room for 5 people with beige walls, one sofa,
               three chairs and a coffee table."
      Parsed: Lebanese · living room · 5 people · beige walls · 1 sofa · 3 chairs · 1 table
      Footer: Natural language → structured plan → DarDesign
      VISUAL: 03-planner-brief.png and 04-planner-result.png, plus the v2 top-down
      diagram where furniture drops in as the sentence is parsed.
      SAY: "It doesn't generate an arbitrary room. It interprets the request and turns it
      into a structured plan DarDesign can execute."
      THEN, and this is the strongest point on the slide: "It's constrained to the cultures
      and the furniture that actually exist in our catalogue — it cannot invent a piece."

  04  It doesn't stop at the image
      Three annotation groups: Colour · Furniture · Validation
        Colour      — wall, floor, preview, undo
        Furniture   — add, move, rotate, real dimensions
        Validation  — refuses overlap, warns on judgement calls
      VISUAL: 06-colour-control.png as the plate; 07-placement-valid.png and
      08-placement-invalid.png side by side as the validation pair — same room, same sofa,
      accepted vs refused. Show them adjacent so the difference is instant.
      SAY: "The important point is that DarDesign doesn't stop after generating an image."
      THEN: "Furniture can't go anywhere — placement is checked against the room."

  05  The whole loop
      Generate → Customise → Validate → Save → History → Rate → Report / Share
      Grouped: Create · Customise · Manage & evaluate
      VISUAL: 10-history.png as the plate, with 11-rating, 12-community, 13-room-report
      as three small annotation cards along the waypoint line.
      SAY: "So it's not only a generator. You generate, interact, validate, save, come
      back later, and give feedback."
      TRANSITION: "Now I'll explain what's happening technically behind that."

ACT 2 — THE DEFENSE

  06  What it does
      Three groups, not a list of fifteen things:
        AI generation      — three cultures · intensity · variations · design planner
        Interactive design — colour · cultural furniture · move & resize · validation
        Users & evaluation — history · ratings · reports · admin dashboard
      VISUAL: 09-build-mode.png as the plate.
      SAY: "These are the capabilities you just saw, grouped into generation, interaction
      and evaluation."

  07  How the output is actually made
      The pipeline, as one waypoint line:
        room photo → design parameters → SDXL + culture LoRA → room guidance → result
      Under it: depth estimation · segmentation · structure preservation · prompt building
      VISUAL — THIS IS THE MOST IMPORTANT ROW IN THE DECK:
      05-conditioning-triplet-beauty → -depth → -seg → 05-conditioning-triplet-render,
      four plates in that order, with the scanning line between them.
      SAY: "The photo isn't just handed to an image generator. SDXL does the generation,
      the culture LoRA supplies the learned cultural character, and the room information
      keeps the original structure."
      ON LoRA: "Rather than train a whole diffusion model per culture, we fine-tuned
      lightweight adapters for Lebanese, Moroccan and Khaleeji."
      ON THE ROW, point at the chairs and the table: "Layout isn't described to the model
      in a sentence. It's rendered from the user's own 3D scene into the two control images
      the generator was already conditioned on, and substituted. That's why the furniture
      comes back in the same places."
      Held: placement, orientation, geometry, viewpoint. Not held: the look of any one
      piece — the model invents surface and ornament inside the silhouette it's given.

  08  What it's built with
      Map these under the v2 architecture spine, not as four separate boxes:
        AI / vision — SDXL · LoRA · LLM planner · depth · segmentation · CLIP
        Backend     — Python · FastAPI · SQLite
        Frontend    — Next.js · React · bilingual EN/AR with full RTL
        Infra       — Colab GPU · GitHub · tunnelled GPU host
      Spine: Frontend → Backend/API → generation service → storage
      VISUAL: 15-top-down-map.png as the plate behind the spine — it shows the system
      reading a real room, which is what the architecture is for.
      SAY: "Interface, backend, generation and evaluation are separate. GPU generation runs
      apart from the frontend; the backend handles users, history, ratings and requests."
      Don't explain individual libraries unless asked.

  09  How we know it works — and where it doesn't
      Evaluation and limitations on ONE slide. Limitations do not get their own negative slide.
      Metrics at 110px: SSIM (structure kept) · LPIPS (perceptual change) · CLIP (cultural
      alignment) · generation time · user ratings · culture confusion matrix
      VISUAL: 14-evaluation-dashboard.png.
      Limitations, stated as scope not apology:
        dataset scale · three cultures today · furniture library still growing ·
        results vary run to run · complex rooms are harder to preserve ·
        GPU generation is slower than a normal web action ·
        automatic metrics can't fully capture cultural authenticity
      SAY IT LIKE THIS: "The main limitation is dataset scale. Our cultural datasets are
      relatively limited, so the project demonstrates the feasibility of the approach; a
      larger curated dataset would improve diversity and cultural accuracy further."
      NOT like this: "our dataset is very small and the model has problems."

  10  Where it goes
      Roadmap bars, growing:
        more cultures — Syrian · Palestinian · Egyptian · Turkish
        larger dataset — more room types, furniture, architectural elements
        smarter planner — conversation, recommendations, explains its cultural choices
        deeper editing — replace objects, auto-placement, materials and texture
        technical — faster generation, stronger preservation, cloud GPU
      VISUAL: the 01 culture plates reprised small along the roadmap.
      CLOSE: "The goal is for DarDesign to grow from a cultural room generator into an
      intelligent cultural interior-design assistant — describe an idea naturally, generate
      it, interact with it, and get design guidance throughout."
      No thank-you slide.

---------------------------------------------------------------------------
RULES
---------------------------------------------------------------------------
EVERY SLIDE CARRIES A VISUAL. No text-only slides, dividers and closer included. If a
slide has no natural image, fold it into its neighbour rather than inventing decoration.

DESIGN — keep v2 exactly:
  · Image first. The screenshot is the slide; copy sits on top in a limestone block.
  · Limestone ground, near-black ink, cobalt accent used sparingly — never large fills.
  · Hairline rules, no card borders, no drop shadows except one soft lift under a hero
    plate. No gradients, no decorative icons, no stock imagery.
  · Two type sizes: title and body. Monospace ONLY for measured values — cm, seconds,
    scores — never titles, bullets or navigation.
  · Every list item 2-4 words. The full sentence lives in the speaker note.
  · One figure alone on a slide gets set large (110px) with room around it.

LANGUAGE:
  · Plain and concrete — a non-specialist examiner should follow every slide.
  · Define a term the first time, four words or fewer, in parentheses:
    "ControlNet (a layout constraint)". Then use it freely.
  · Active voice. No marketing adjectives — nothing is seamless, powerful or revolutionary.

HONESTY — not stylistic:
  · Use ONLY figures from MANIFEST.md or legible in the screenshots. Never invent a
    metric, a timing, an accuracy or a comparison.
  · Do NOT state dataset sizes, per-culture image counts, or corpus totals anywhere.
    "Dataset scale" is named as a limitation qualitatively — with no numbers.
  · Where a figure rests on few observations, present it as an early signal, not a
    settled result. Don't dress a small sample as proof, and don't hide that it's early.
  · Where MANIFEST.md says a panel reads "No data", that's a measurement not yet taken —
    not a weakness, not a result.
  · Do not claim layout preservation has been formally measured. It hasn't. The Act 07
    row is a demonstration, and that is exactly how to present it.
  · Training data was standardised before training — every image resized and centre-cropped
    to a square 1024px working resolution, with per-image captions. Say it that way.

OUTPUT
  For each of the 10 slides: number, title, image filename(s) placed, the 2-4 word list
  items, and the speaker note in full. Then one paragraph on what the committee is most
  likely to challenge, and the honest answer.
````

---

## Two notes before you send it

**Intensity isn't in shots 02/04.** The Studio upload screen has no intensity control — it's
`/restyle`-only, in the post-result Edit tab — and shot 04's plan omits intensity because the
brief never stated one, so the planner correctly returned `null` rather than guessing. Slide 02
can still name intensity in the flow, and slide 03 must not show "Intensity: 80%" as parsed
output, because that screenshot doesn't contain it. If you want it visible, I can re-run the
planner with a brief that states the strength — the planner runs on the local backend, so this
needs no GPU and takes about a minute.

**Augmentation.** The deck prompt describes the training preprocessing accurately. The offer
from before stands: if you want the claim to be true, I'll write `scripts/lora_augment.py` as an
offline pass and you retrain on the same Kaggle T4 run you've done before.
