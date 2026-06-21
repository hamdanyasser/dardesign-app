# DarDesign — defense-day runbook

Everything for the live presentation: pre-flight, run-of-show, the exact demo
clicks, and the **never-debug-live** fail-safe. Pair with `docs/defense-qa.md`
(answers) and `docs/slides-and-one-pager.md` (deck).

---

## T-1 day — pre-flight checklist

- [ ] **Models present:** `models/loras/{lebanese,khaleeji,moroccan}/dardesign-*-lora.safetensors` (already downloaded).
- [ ] **Eval figures ready:** run `push_verify.py` on a **T4** (Save & Run All) → save `confusion_matrix.txt` + the `GRID-lora-*.png` / `GRID-promptonly-*.png` into the slides (slides 11, 13).
- [ ] **Licensing:** fill `datasets/LICENSING.csv` (≥ the hero Lebanese rows) — see Q13.
- [ ] **Backend on T4 + tunnel** (if doing the *real* live demo): follow `kaggle/README.md` §3 (pyngrok), copy the public URL into `.env.local` → `NEXT_PUBLIC_API_URL`, restart `npm run dev`.
- [ ] **Offline fallback ready:** recorded demo video + a folder of pre-rendered finals on the laptop **and** a USB.
- [ ] **LIGHT works:** `DARDESIGN_LIGHT=1` backend + `npm run dev` → the whole UI flow runs with placeholders (proves the app even with no GPU/Wi-Fi).
- [ ] Charge laptop; test the venue projector/HDMI; phone hotspot as backup Wi-Fi.

## Run-of-show (~14 min talk + 4 min demo + Q&A)

| min | slide | beat |
|---|---|---|
| 0–1 | 1–2 | Hook: "one photo → three views of the same room." |
| 1–4 | 3–5 | Problem + the moat (trained + measured + spatial). |
| 4–8 | 6–10 | Architecture, structure preservation, ontology, the 16 GB recipe. |
| 8–10 | 11–12 | **The three souls** image + **live intensity slider**. |
| 10–13 | 13–15 | Evaluation: confusion matrix (LoRA vs prompt-only), SSIM/LPIPS, user study. |
| 13–14 | 16–18 | Security/MLOps, product, contributions. |
| 14–18 | — | **Live demo** (below) + Q&A. |

## Live demo script (the exact clicks)

1. Open `/` — scroll the **DarCinema** landing through one qanater arch → "crossing the arch *is* the navigation." Click **الاستوديو / Studio**.
2. In `/studio`, **upload a room photo** (have a clean one ready).
3. ~1–2 min → the **three redesigns** appear (Lebanese / Khaleeji / Moroccan), each labelled AR+EN. *Say: same walls, windows, layout — different soul.*
4. Scroll to **Cultural elements & layout** → **Show elements**:
   - click a region on the highlighter → its **named, sourced** ontology card.
   - hit **Listen** (Narration) → it *speaks* the description in Arabic.
   - drag the **Style Intensity** slider 0→100 % → **Apply** → culture emerges. *"This is our ablation, live."*
5. Cut back to the slides for the confusion matrix.

## ⚠️ Fail-safe — if anything breaks, do NOT debug live

1. **Tunnel/GPU down?** Switch to the **recorded demo video** (full flow, narrated).
2. **Video won't play?** Run the **`DARDESIGN_LIGHT`** local app — the entire UI flow works with placeholder images; narrate over it.
3. **Everything down?** The **pre-rendered finals** + the **confusion-matrix figure** on a slide carry the result. The story stands without a live model.
4. Two locations (laptop + USB). Rehearse the cut so it's invisible.

## One-line pitch (memorise)
> *"Every other tool styles pixels; DarDesign trains, measures, and explains three real Arab architectural traditions — and it does it on a free GPU."*
