# DarDesign — Culturally-Grounded AI Interior Redesign
### Thesis draft (auto-drafted from the repository, Jun 2026 — Yasser track chapters)

> Status: **draft for editing.** This covers the engineering chapters (pipeline,
> dual ControlNet, LoRA recipe, evaluation methodology, security/MLOps). The
> cultural-research, dataset-methodology, Arabic-UX, and user-study chapters are
> Zainab's track (Sprint 4). Numbers marked _[fill]_ come from the eval run.

---

## Abstract (EN)

DarDesign is a bilingual (Arabic-first) web application that re-imagines a
photographed room in one of three named Arab architectural traditions —
**Lebanese**, **Khaleeji**, and **Moroccan** — while preserving the room's
existing geometry. Unlike commercial "AI interior" tools that apply a generic
"modern/boho/luxury" restyle, DarDesign's contribution is three-fold and
*measurable*: (1) three **separately trained** cultural style models
(DreamBooth-LoRA adapters over SDXL), (2) **structure preservation** via dual
ControlNet (depth + semantic segmentation) so walls, windows and layout survive
the restyle, and (3) a **provenance layer** — a 45-term bilingual architectural
ontology that drives both the generation prompt and a user-facing "name every
element, cite every motif" explanation. The system runs end-to-end on a single
free 16 GB GPU (Kaggle T4), which required solving a non-trivial memory/precision
problem documented in Chapter 4. We evaluate cultural distinctiveness with a
CLIP zero-shot confusion matrix and structure fidelity with SSIM/LPIPS against
the input.

## الملخّص (AR)

«دار ديزاين» تطبيقُ ويب ثنائي اللغة (عربيٌّ أولاً) يعيد تصوّر صورةِ غرفةٍ
بأحد ثلاثة طُرُزٍ معماريةٍ عربيةٍ مُسمّاة — **لبناني**، **خليجي**، **مغربي** —
مع الحفاظ على هندسة الغرفة الأصلية. خلافًا للأدوات التجارية التي تُطبّق طرازًا
عامًّا، فإن إسهام «دار ديزاين» ثلاثيٌّ وقابلٌ للقياس: (١) ثلاثة نماذج طرازٍ
ثقافيةٍ **مُدرَّبة منفصلةً** (محوّلات LoRA فوق SDXL)؛ (٢) الحفاظ على البنية عبر
شبكتَي تحكّمٍ (عمق + تجزئة دلالية) كي تبقى الجدران والنوافذ والمخطّط؛ (٣) طبقة
إسنادٍ — أنطولوجيا معماريةٌ ثنائية اللغة من ٤٥ مصطلحًا تقود التوليد والشرح معًا.
يعمل النظام كاملاً على معالجٍ رسوميٍّ مجانيٍّ واحدٍ بسعة ١٦ غيغابايت.

---

## 1 · Introduction & problem statement

Generative interior-design tools have become table stakes: Decor8 (50k+ users),
RoomGPT, Interior AI, and others restyle a room from a photo, and several have
added Arabic UI and chat-based editing. What none of them offer is a model that
*understands a specific architectural tradition* well enough to reproduce its
named elements — the Lebanese **qanater** (triple pointed arch), the Khaleeji
**sadu** weave, the Moroccan **zellige** mosaic — rather than a vague
"Mediterranean/Moorish" pastiche. DarDesign's thesis is that cultural
authenticity in generative design can be **trained, measured, and explained**,
and that doing so is a defensible moat no general tool replicates.

The system answers a single user action — *upload a room* — with **three views
of the same space**: how it **looks** (the cultural restyle), how it is **laid
out** (a top-down 2D object map), and a named **provenance** of every motif on
screen. This is the "Understood Room (الغرفة المفهومة)" framing.

**Constraints that shaped every decision:** a strict *free-tier-only* compute
budget (Kaggle T4, 16 GB, no A100, ~30 GPU-h/week), a small low-shot dataset per
culture (12–40 curated images), and an Arabic-first accessibility requirement.

## 2 · Related work and positioning

| Capability | Decor8 / RoomGPT / Interior AI | **DarDesign** |
|---|---|---|
| Restyle from photo | ✅ | ✅ |
| Arabic UI / RTL | some | ✅ native, Arabic-leads |
| **Separately *trained* cultural models** | ❌ (prompt-only) | ✅ 3 LoRAs |
| **Structure preservation (dual ControlNet)** | partial | ✅ depth + seg |
| **Measured cultural authenticity** | ❌ | ✅ CLIP confusion matrix |
| **Named/cited provenance ontology** | ❌ | ✅ 45 terms, sourced |

The moat is the *trio*: trained models + measured distinctiveness + true spatial
understanding. Arabic UI, chat editing and sketch-to-3D are no longer
differentiators; the trained-and-measured cultural axis is.

## 3 · System architecture

```
photo ──► Depth Anything V2 ─► ControlNet (depth) ─┐
      └─► OneFormer (ADE20K) ─► ControlNet (seg)  ─┤
ontology ─► prompt_builder ─► (positive, negative, EN+AR) ─┤
                                                            ▼
              per-culture LoRA ──lazy load──► SDXL base 1.0 (fp16, CPU offload)
                                                            │  OOM → SD 1.5 + CN 1.1 @ 768²
                                                            ▼
                                        restyled PNG · 2D object map · 3D scene
```

**Backend (`backend/`, FastAPI).** A single inference module, `transform.py`, is
canonical: it runs the real SDXL + dual-ControlNet pipeline on a GPU and a
placeholder branch (`DARDESIGN_LIGHT=1`) on a laptop, so the FastAPI surface is
testable end-to-end without a GPU. Endpoints: `/redesign` (synchronous, returns
original + 3 styles as base64 PNGs + a 2D `object_map`), plus the
upload/transform/status/result/retry/share set for the async path. Every
`HTTPException` carries `{code, message_en, message_ar}` so the frontend renders
the user's language with no client-side error table.

**Structure preservation.** Depth (Depth Anything V2) and semantic segmentation
(OneFormer, ADE20K) are extracted once and fed as **two simultaneous ControlNet
conditions**. Depth fixes the room's 3D shell; segmentation pins object
boundaries (sofa, window, rug). The redesign therefore changes *materials,
ornament and palette* but not *walls, openings and layout* — the property the
thesis sells as "we preserve your room."

**The 2D object map (`projection.py`).** The same depth + segmentation maps are
reused (no extra inference) to project a top-down furniture/opening layout
(`cy 0 = far wall`) rendered in the UI as `RoomMap2D`. This is the "how it's laid
out" view and is, to our knowledge, not offered by any competitor.

## 4 · Cultural ontology and prompt construction

`ontology/ontology.json` is the single source of truth for the design
vocabulary: per culture it lists `architectural`, `materials`, `color_palette`,
`lighting`, `furniture`, `textiles`, and `ornamentation` terms, each carrying a
`verified` flag flipped to `true` after a cultural-accuracy review pass. The
trigger phrases (`dardesign-lebanese style` / `نمط دار-ديزاين-لبناني`, etc.) bind
each LoRA to its tradition.

`prompt_builder.py` composes a weighted, seedable **(positive, negative)** prompt
pair in both languages from the ontology, so the ontology is *functional, not
decorative* — it drives the generation **and** the user-facing explanation layer
(the Cultural Element Highlighter). This is the answer to "is the ontology just
vibes?": every motif the model is asked for is a citable term.

## 5 · LoRA training methodology — *the core engineering contribution*

### 5.1 Recipe

Each culture's style is a **DreamBooth-LoRA** adapter (rank 16, `to_{k,q,v}` +
`to_out.0`, 1500 steps) over **SDXL base 1.0**, trained on 12–40 low-shot curated
images with bilingual captions that embed the culture's trigger phrase.

### 5.2 The 16 GB problem (and why it is a real result, not a footnote)

Training an SDXL LoRA on a **single 16 GB** card is at the memory edge, and the
naïve approaches both fail:

- **Frozen base in fp32** (the textbook setup): the UNet (~10 GB) + VAE + both
  text encoders + activations exceed 16 GB → **CUDA OOM**.
- **Frozen base in fp16** (to fit): SDXL's UNet is numerically unstable in fp16
  and overflows → **`loss = NaN` from step 1**. (T4 *and* P100 confirmed.)

So on 16 GB one must choose between *fitting* and *stable* — unless the resident
footprint is reduced. Our solution is **latent + text-embedding caching**:

1. **Pre-encode once.** Run the fp16 VAE over every training image to cache its
   latent, and the two fp16 text encoders over every caption to cache its prompt
   embedding + pooled embedding. The frozen base's only job is encoding, and it
   is deterministic over a fixed low-shot set.
2. **Free the encoders.** Delete the VAE and both text encoders; `empty_cache()`.
3. **Train UNet-only.** Load the UNet in **fp32 (master weights → stable)**, add
   the LoRA, and train with `autocast(fp16)` (fast, low-activation) + a
   `GradScaler`. Only the ~10 GB fp32 UNet is resident → peak ≈ 14 GB, fits, and
   does not NaN.

This is the recipe now in `scripts/train_lora.py` and verified on the free T4:
real loss (0.003–0.36) across all three cultures, 1500 steps each.

### 5.3 A second, infrastructural finding

Kaggle's **REST API only grants a P100** (compute capability sm_60) for
API-pushed kernels; the P100 cannot run the SDXL fp16 recipe (no fp16 tensor
cores → NaN) and cannot fit fp32 (OOM). A **T4 (sm_75)** is only obtainable by
committing the kernel in the Kaggle **UI** ("Save & Run All → GPU T4 x2"). This
is an MLOps lesson worth a paragraph in the thesis: *the same code that succeeds
interactively can fail in a batch API path purely due to accelerator
assignment.* Also: the modern `KGAT_` Kaggle token is not readable by the
classic `kaggle` CLI — uploads go through `kagglehub`, kernels through the REST
API with a bearer token.

### 5.4 Cut order (honest scoping)

Lebanese is the hero (richest curated set, 19 imgs ≥512 px after cleaning).
Khaleeji (14) and Moroccan (12) are below the 20-image floor where LoRAs begin to
memorise; the plan accepts prompt-only fallback for them, but both trained with
healthy loss and are usable. The canonical checkpoint chosen is **step 1000**
(less over-baked than 1500 on so few images).

## 6 · Evaluation methodology

Three complementary measurements (run on the T4, then charted):

1. **Cultural distinctiveness — CLIP zero-shot confusion matrix.** Classify each
   generated image with CLIP against the three culture labels, LoRA vs.
   prompt-only. A near-diagonal matrix *proves* "three distinct traditions" — the
   single strongest headline figure. _[fill: accuracy, matrix]_
2. **Structure fidelity — SSIM + LPIPS** of each output against its input room.
   High SSIM / low LPIPS on the *structural* channel demonstrates that dual
   ControlNet preserved geometry while materials changed. _[fill: table]_
3. **Ablations** — `--no-lora`, `--no-seg`, `--no-ontology` on a fixed room set
   show each component's marginal contribution (the Style Intensity Slider is
   this ablation made *live and interactive* for the examiner). _[fill: grid]_

Compute budget is respected: seeds locked in `configs/`, checkpoints every 500
steps survive session death, eval on the second account.

## 7 · Security, privacy, and MLOps

- **Prompt-injection guardrails** (`backend/guardrails.py`): upload validation
  (mime allowlist, 10 MB cap, 256 px min-dim, `PIL.verify`), prompt-fragment
  sanitisation, style/param clamping. The cybersecurity story for the defense.
- **Privacy by TTL** (`backend/ttl_cleanup.py`): a background sweeper deletes
  uploads *and* generated PNGs after 24 h; a bilingual privacy notice is always
  visible. (`صورك تُحذف تلقائيًا بعد ٢٤ ساعة`.)
- **Provenance manifest** (planned, Tier 2): a JSON sidecar per render recording
  model, LoRA, seed, ControlNet weights and a SHA-256 — "C2PA-inspired" content
  authenticity.
- **One inference module, two modes** (`DARDESIGN_LIGHT`): the same code path is
  CI-testable on a laptop and real on a T4 — no mocks, no drift.
- **Reproducibility:** `requirements.txt` pinned to the T4 CUDA 12.1 stack;
  `push_kernel.py` + `kaggle/README.md` make a training run a paste-and-go.

## 8 · The product (Arabic-first)

The web app is Next.js 14 + Tailwind, RTL-native, gold-on-charcoal. The landing
(`DarCinema`, `src/components/dar/`) is a five-scene cinematic scrollytelling
where *crossing a qanater arch is the navigation*; `/studio` is the working
flow: upload → reading sequence → triple-arch reveal → the three "Understood
Room" layers (styled image · 2D map · explorable 3D). Three creative features
strengthen specific thesis claims: the **Cultural Element Highlighter** (ontology
is functional), the **Style Intensity Slider** (ablation made live), and
**Bilingual Narration** (Arabic UX beyond RTL text).

## 9 · Results so far and future work

**Done:** all three cultural LoRAs trained on free T4; structure-preserving dual
ControlNet pipeline; bilingual ontology + prompt builder; 2D object map;
Arabic-first product; the 16 GB training recipe (a transferable contribution).
**Pending (this draft → final):** eval charts (confusion matrix, SSIM/LPIPS,
ablations), user study (≥15), and dataset-licensing verification. **Future work
(icebox):** whole-house tours, a 4th tradition (Iraqi/Egyptian/Andalusian),
in-painting "redo this corner", an educational ontology mode.

## References (selected, from `ontology/sources.md`)
- May Davie, *Beit Beirut: A History of the Lebanese House*, 2014 (qanater).
- Sheikh Mohammed Centre for Cultural Understanding, UAE (sadu).
- Aga Khan Documentation Centre, MIT (zellige).
- Rombout et al., *Depth Anything V2*; Jain et al., *OneFormer*; Podell et al.,
  *SDXL*; Hu et al., *LoRA*; Ruiz et al., *DreamBooth*.
