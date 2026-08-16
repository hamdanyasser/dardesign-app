# DAR — defence runbook

A shot-by-shot script for the live demo, plus the pre-flight that stops the
two things that actually go wrong on the day. Written to be read on a second
screen while you present.

**Timing:** the full path below runs ~22 minutes at a comfortable pace. The
generation wait is the only unavoidable dead air (~2 min for three cultures),
and §4 tells you what to say during it.

---

## 0 · Pre-flight (15 minutes before, not 2)

Run these in order. Every one of them has failed at least once in development.

```powershell
# 1. Data backend — accounts, history, planner. Serves :8000.
powershell -ExecutionPolicy Bypass -File scripts\run-local-backend.ps1
```

It **refuses to start if :8000 is already held** and prints the holding pid.
That guard exists because a stale backend once answered for three hours behind
a green banner. If it refuses, kill the pid it names — do not assume the banner
in front of you describes the process serving your requests.

```
# 2. GPU host — the Colab notebook. Two things to verify, not one:
#    a) the tunnel URL printed
#    b) uvicorn is ACTUALLY LISTENING on 127.0.0.1:8000 inside Colab
```

> **The single most common failure.** A live tunnel does not mean a live
> backend. If cloudflared logs `dial tcp 127.0.0.1:8000: connect: connection
> refused`, the tunnel is fine and your server cell did not run. Check the
> server cell, not the tunnel.

```powershell
# 3. Frontend, pointed at that tunnel. Probes /healthz before starting.
npm run dev:tunnel https://<the-url-colab-printed>
```

Look for `healthy  v0.3.0 · real SDXL + LoRA`. If it says **LIGHT
(placeholder PNGs)** you are about to demo tinted stand-ins, not renders —
stop and fix it.

```powershell
# 4. Staged saved designs (only if the demo machine is fresh)
python scripts\seed_demo_history.py --check
```

Expect `seeded in it : 0`. That line is the guarantee that the staged designs
are **not** inside the evaluation corpus.

**Set the theme to LIGHT before you present.** Light is the default and the
projector theme; a lit hall destroys dark mode no matter how well tuned it is.

**Have the fallback ready:** open `/studio?demo=1` in a second tab. That is
Defense Mode — pre-rendered rooms, zero backend. If the GPU dies mid-demo you
switch tabs and keep talking.

---

## 1 · The landing (2 min) — "a house, not a filter"

Open `/`. Scroll slowly through the five acts.

- **The threshold arches.** "Dar means house. The doorway is the form the whole
  project is built around."
- **The souls carousel — say this line deliberately:** "Same room. Same bones.
  Three souls." All four framed slots are the *same* room deliberately; that
  is the argument, not a layout accident.
- **Point at the metal.** It appears on the arches and nowhere else in the
  chrome. If asked: the palette is drawn from `ontology.json` — the ground is
  Khaleeji indigo `#1f3a6b`, the light element is Lebanese limestone cream
  `#e8dcc4`, both verified entries. Not a mood board.

---

## 2 · Studio: upload → three cultures (4 min)

`/studio` → drop a room photo → **generate all three**.

While it uploads: "One photograph in. The depth pass, the segmentation pass and
the room analysis run **once** — then three cultures are generated from that one
understanding. Asking for one culture is three times faster; asking for three
costs almost nothing extra in analysis."

---

## 3 · THE MOMENT — Provenance X-ray (2 min)

When the reveal lands, **drag the scan line under the before/after**.

> "This is not a filter over a photograph. On the right is the design. On the
> left is what DAR measured your room to be — the real depth map, and every
> element it named, in Arabic and English, from the cultural ontology."

Drag it back and forth two or three times. Let it land in the middle.

**This is the shot that wins the room.** If you remember one thing from this
runbook, it is to slow down here.

If asked "is that real or an illustration?" — the caption answers it, and the
component renders nothing at all when the data is not real. There is no sample
mode to accidentally show.

---

## 4 · What to say during the wait (the dead air)

If you generate again live, the wait is ~2 minutes. Open the **Inside DAR** tab
and walk the chapters — they are a documentary loop, and after a real run they
carry that run's own artefacts:

- **02 Understanding** — the real segmentation regions over the room
- **03 Preserving structure** — the room beside its real depth map
- **05 Cultural intelligence** — names the actual model, LoRA and ControlNet,
  read from the provenance the backend reports. Not a diagram.
- **06 Generation** — the renders this request produced
- **04 Cultural research** is deliberately empty: "we have no sourced research
  media, and the system refuses to invent screenshots." **Say that out loud** —
  a jury respects a tool that declines to fabricate more than one that fills
  every box.

---

## 5 · Build Mode + the planner (5 min)

**Finish** on a result → Build Mode.

- "The room arrives already understood." Point at the `N found` chip and the
  translucent massing — "those are read off your photograph, locked, because
  moving one would turn a measurement into a fiction."
- **Describe your room** → type *"make this a Moroccan majlis for six"*.
  Expect 11–35 s; the panel counts elapsed seconds because `/api/design/plan`
  returns once and has no intermediate state — "a percentage there would be an
  invented animation."
- When the plan lands: the culture converts, the furniture converts with it,
  and **one Ctrl+Z takes the whole plan back out.**
- Drag a piece into a wall to show the two-tier verdict: blocking is physics,
  amber is judgement and never refuses the drop.

**Render with DAR** → the conditioning evidence strip. "Depth and segmentation
are rendered from the 3D scene and substituted for the photo-derived ones. What
is *held* is placement, orientation, geometry and viewpoint. What is *not* held
is the appearance of any individual piece. The panel says so itself."

---

## 6 · The receipts (4 min)

- **My designs** — the saved corpus.
- **Community** — designs other members shared.
- **Evaluation** (admin) — "every average is over unedited, non-placeholder
  designs only. Edited and LIGHT rows are excluded and the arithmetic closes on
  screen. Unmeasured figures print an em dash, never a zero — on a 1–5 scale a
  zero is unreachable, so printing one would fabricate a result."
- **Audit trail** — append-only, metadata only.

---

## 7 · Questions you will be asked

**"Is the LoRA actually doing anything?"**
Three cultures trained, 93.1 MB each, three distinct sha256 — not copies. The
Inside DAR pipeline chapter names the LoRA the host actually loaded.

**"How do you know it preserved the room?"**
SSIM per style at generation time, same measure as the offline suite. Plus the
X-ray: the depth it was conditioned on is right there.

**"Is the cultural vocabulary verified?"**
Khaleeji and Moroccan are 30/30 verified; **Lebanese is 0/30**; 6 of 30 carry a
citation. Say the real numbers. The RAG panel labels unverified evidence as
unverified, and the spatial conventions are explicitly uncited.

**"What doesn't work?"**
Layout-preservation *quality* is unmeasured — there is no side-by-side study,
and a handful of renders is an observation, not a result. Say it plainly; it is
a stronger answer than a claim you cannot defend.

---

## 8 · If something breaks

| symptom | do this |
|---|---|
| generation hangs past ~3 min | switch to the `?demo=1` tab, keep talking |
| tunnel 502 | uvicorn is not running in Colab — do not debug live, switch tabs |
| tunnel dies mid-demo | `?demo=1`; nothing there needs a backend |
| history/login fails | that is `:8000`, not the GPU — the renders still work |
| a page looks wrong | toggle to light; light is the tuned projector theme |

**Never debug in front of the jury.** Switch to Defense Mode and carry on; the
story does not depend on the GPU being alive.
