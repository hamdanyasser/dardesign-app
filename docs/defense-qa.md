# DarDesign — Defense Q&A (red-team)

The 18 hardest questions a panel can ask, with crisp answers. Drilled per the
master-plan "red-team 25, keep the 10 hardest." Grouped: **moat**, **technical**,
**evaluation**, **ethics/licensing**, **scope**. Answer in ≤30 s; the *italic*
line is the one-sentence version if you blank.

---

## Moat / "so what"

**Q1. Decor8 has 50k users and Arabic UI. What do you have that they don't?**
Three *separately trained* cultural models, a *measured* proof they're distinct
(CLIP confusion matrix), and true spatial understanding (dual ControlNet + 2D
map). They prompt-engineer a generic model; we trained three and can prove the
difference numerically. *We trained and measured culture; they styled pixels.*

**Q2. Couldn't you get the same look with a good prompt and no training?**
That's literally our ablation. `--no-lora` (prompt-only) vs. LoRA, and the Style
Intensity Slider lets *you* drag from 0 % (generic SDXL) to 100 % (trained) and
watch the tradition emerge. The confusion-matrix accuracy is higher with LoRA.
*The slider is the answer — drag it and look.*

**Q3. Is "Lebanese vs Khaleeji vs Moroccan" a real distinction or marketing?**
Each is grounded in a sourced ontology (Aga Khan Documentation Centre, May
Davie's *Beit Beirut*, etc.) with named, distinct elements — qanater vs sadu vs
zellige — and the model reproduces the *named* ones. *Every motif on screen has a
name and a citation.*

## Technical

**Q4. Why SDXL + LoRA and not fine-tune the whole model or use a bigger base?**
Full fine-tune needs far more data and compute than a free T4 and would
catastrophically forget. LoRA (rank 16) adapts ~0.1 % of params, trains in <1 h
on 12–40 images, and is hot-swappable per culture (lazy-loaded). *LoRA is the only
thing that fits the data and the GPU budget.*

**Q5. How do you preserve the room's structure?**
Two ControlNets at once: a depth map (Depth Anything V2) fixes the 3D shell, and
semantic segmentation (OneFormer/ADE20K) pins object boundaries. The model
changes materials/ornament/palette but not walls, openings or layout. *Depth +
segmentation hold the geometry; the LoRA only repaints it.*

**Q6. You trained on a free 16 GB GPU — isn't SDXL LoRA too big for that?**
It is, naïvely — fp32 base OOMs, fp16 base NaNs. We solved it by **caching latents
and text embeddings once, freeing the VAE and text encoders, and training only
the fp32-master UNet** with autocast + GradScaler. Peak ≈ 14 GB, stable. *We cache
the encoders away so only the UNet is resident.* (This is a transferable result.)

**Q7. Why did the loss go to NaN at first, and how do you know it's fixed?**
NaN came from running SDXL's UNet in fp16 (overflow) — we proved it on both a
P100 and a T4. The fix keeps the UNet's master weights in fp32; the loss is then
real (0.003–0.36) and the checkpoints render coherent rooms. *fp16 UNet weights
overflow; fp32 master weights don't.*

**Q8. What happens if SDXL OOMs at inference?**
`transform_room()` automatically retries on SD 1.5 + ControlNet 1.1 at 768². The
demo degrades, it doesn't crash. *There's a documented fallback path.*

**Q9. Only ~12–40 images per style — won't the LoRA just memorise?**
Below 20 images that's a real risk, which is why Lebanese (the hero, most curated)
carries the thesis and we pick the **step-1000** checkpoint over 1500 to avoid
over-baking. Khaleeji/Moroccan are honestly scoped as prompt-capable fallbacks.
*We chose an under-trained checkpoint on purpose and say so.*

## Evaluation

**Q10. How do you *measure* cultural authenticity — isn't it subjective?**
Two ways: (a) a CLIP zero-shot 3-way confusion matrix — a near-diagonal matrix
means the styles are machine-distinguishable; (b) a user study (≥15) where Arab
respondents rate authenticity. Objective + human. *A confusion matrix plus human
ratings — not vibes.*

**Q11. SSIM/LPIPS measure similarity — why is *high* similarity good here?**
Because the claim is *structure preservation*: we want the output close to the
input in geometry (high SSIM, low LPIPS on structure) while materials differ.
It's evidence the ControlNets worked, not that we changed nothing. *We measure
that we kept the room, not that we kept the picture.*

**Q12. n=15 is a small study.** Agreed — it's an indicative within-subjects design
(each rater sees all three styles on the same rooms), not a population estimate.
We report it as supporting evidence alongside the objective confusion matrix, and
list a larger study as future work. *Small but honest; the objective metric
carries the claim.*

## Ethics / licensing / safety

**Q13. Did you have the right to train on these images?** — *the one that bites.*
The datasets were curated for low-shot training; the plan mandated
license-clear sources (Wikimedia, Unsplash, Pexels, ArchNet/Aga Khan) and
logging source + licence per image. **Be honest about current status:** some
images are still marked `UNVERIFIED` and provenance is being completed before
submission; no images of identifiable people are used (a curation rule). *We log
provenance per image and exclude people; verification is being finalised.*
> ⚠️ Resolve the `UNVERIFIED` licence fields before the panel — this is the most
> likely hostile question.

**Q14. Could someone misuse this — cultural misrepresentation, deepfakes?**
It restyles interiors, not people; no faces, no identity. The risk is
*caricature* of a culture, which is exactly why every element is named and
sourced rather than invented — the ontology is an accountability mechanism.
*Naming and sourcing every motif is the safeguard against caricature.*

**Q15. Prompt injection / abuse of the upload?**
Guardrails: mime allowlist, size/dimension caps, `PIL.verify`, prompt-fragment
sanitisation, parameter clamping; uploads + outputs auto-delete after 24 h.
*Validated, sanitised, clamped, and TTL-deleted.*

## Scope / process

**Q16. What's the single biggest risk you hit and how did you manage it?**
The LoRA chain almost didn't fit the free GPU. We de-risked by making Lebanese
the hero, building a CPU-testable pipeline (`DARDESIGN_LIGHT`) so everything but
generation was provable without a GPU, and solving the memory problem with
caching. *We protected the one chain that mattered and engineered around the GPU
limit.*

**Q17. What did you cut, and why is that OK?**
Per a documented cut order: Khaleeji/Moroccan LoRA → prompt-only if needed; 3D
Tier-B (navigable) → orbit + cinematic; one ablation droppable. We never cut the
Lebanese LoRA, dual ControlNet, the 2D map, the demo, or the thesis. *We cut
politely from the edges; the core is intact.*

**Q18. If you had two more weeks?**
Verify all licences, grow Khaleeji/Moroccan past the 20-image floor, ship the
provenance manifest (C2PA-style), and run the larger user study. *Licences,
bigger datasets, content-authenticity manifest, larger study.*

---

### Demo failure plan (say this if the live demo breaks)
1. Pre-rendered finals + the recorded demo video (offline).
2. The `DARDESIGN_LIGHT` placeholder path proves the full app flow without a GPU.
3. Two-location backup (Drive + USB). *Never debug live; cut to the recording.*
