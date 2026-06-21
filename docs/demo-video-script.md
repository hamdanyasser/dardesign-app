# DarDesign — recorded demo video script (~2:30)

Shot-by-shot script for the backup demo video (the fail-safe in
`docs/demo-runbook.md`). Record at 1080p, screen capture + a clean voiceover.
**VO** = English voiceover; **ON-SCREEN** = what to do; **OVERLAY** = lower-third
caption (keep the Arabic term visible — it's the brand). Aim 2:20–2:40.

> Tip: pre-generate the redesign once so the ~1–2 min wait is cut to a clean
> cross-fade. Record in DARDESIGN_LIGHT only as a last resort (placeholders).

---

### 0:00–0:12 — Cold open / hook
- **ON-SCREEN:** the DarCinema landing; slow-scroll through the qanater arch tunnel.
- **OVERLAY:** دار ديزاين · DarDesign
- **VO:** "Every AI tool restyles a room. DarDesign does something none of them do — it understands a *named* architectural tradition. Watch."

### 0:12–0:22 — Enter the studio
- **ON-SCREEN:** click **الاستوديو / Studio**; the studio loads.
- **VO:** "One photo. Three views of the same room — how it looks, how it's laid out, and how it feels."

### 0:22–0:38 — Upload
- **ON-SCREEN:** drag a plain modern living-room photo into the upload zone; the reading-sequence loader plays.
- **OVERLAY:** preserves your walls · windows · layout
- **VO:** "Upload any room. We extract its depth and segmentation first, so the redesign keeps your walls, windows, and layout — it only repaints the soul."

### 0:38–1:00 — The three souls (the money shot)
- **ON-SCREEN:** the three redesigns reveal — Lebanese, Khaleeji, Moroccan — side by side; let them breathe.
- **OVERLAY (cycle):** لبناني · qanater + cedar  →  خليجي · sadu + jus  →  مغربي · zellige + tadelakt
- **VO:** "Same room, three traditions — each from a *separately trained* model. Lebanese cedar and triple arches. Khaleeji gypsum and sadu weave. Moroccan zellige and tadelakt."

### 1:00–1:20 — Named & sourced (the ontology)
- **ON-SCREEN:** scroll to *Cultural elements*; click a region → the highlighter card with the Arabic term + note.
- **OVERLAY:** every motif named + cited
- **VO:** "Nothing is decoration we can't name. Click any element — its Arabic term, and the source it's grounded in."

### 1:20–1:34 — It speaks Arabic (Narration)
- **ON-SCREEN:** click **Listen / استمع**; let the Arabic narration play 4–5 seconds.
- **OVERLAY:** Web Speech · يتحدّث العربية
- **VO:** "And it doesn't just render Arabic — it speaks it."

### 1:34–1:58 — The ablation, live (Intensity Slider)
- **ON-SCREEN:** drag the **Style Intensity** slider from 0 % to 100 %, click **Apply**; the room shifts from generic to fully cultural.
- **OVERLAY:** 0% generic SDXL → 100% trained culture
- **VO:** "This is our ablation, made live. At zero, it's a generic model. Drag to one hundred percent, and the trained tradition emerges from the latent space — no static comparison grid needed."

### 1:58–2:18 — Proof (evaluation)
- **ON-SCREEN:** cut to the **CLIP confusion matrix** figure (from `dardesign-verify`); near-diagonal, with the LoRA-vs-prompt-only delta.
- **OVERLAY:** measured, not asserted
- **VO:** "And we measure it. A CLIP classifier tells the three traditions apart far better with our trained models than with prompting alone. Cultural authenticity, quantified."

### 2:18–2:32 — Close
- **ON-SCREEN:** back to the three-souls shot; fade to the wordmark.
- **OVERLAY:** trained · measured · explained — on a free GPU
- **VO:** "DarDesign. We don't style pixels — we train, measure, and explain three real Arab traditions. And we do it on a single free GPU."

---

### Asset checklist before recording
- [ ] One clean input room photo (no people, good lighting).
- [ ] A finished `dardesign-verify` run → the confusion-matrix figure + `GRID-lora-*` images.
- [ ] Backend reachable (T4 + tunnel) **or** pre-rendered outputs cached so the reveal is instant.
- [ ] Arabic font (Tajawal) rendering correctly in the capture.
