# 12 — Depth and Segmentation

*The two structural control signals, treated separately, and why DAR uses both.*

---

## 1. The two signals at a glance

| | **DEPTH** | **SEGMENTATION** |
|---|---|---|
| Answers | *"How far away is each pixel?"* | *"What kind of thing is each pixel?"* |
| Model (from a photo) | `depth-anything/Depth-Anything-V2-Small-hf` | `shi-labs/oneformer_ade20k_swin_large` |
| Output | Continuous scalar field | 150-class integer id map → RGB palette |
| ControlNet | `diffusers/controlnet-depth-sdxl-1.0` | `SargeZT/sdxl-controlnet-seg` |
| Default weight | **0.7** | **0.5** |
| Controls | Volume, distance, perspective, silhouette in 3D | Object identity, boundaries, wall/floor/ceiling extents |
| Clamp range | `cn_depth ∈ [0.3, 1.3]` | `cn_seg ∈ [0.2, 1.0]` |

Weights come from `configs/pipeline.yaml` → overridden per culture by
`configs/sweep_winners.json` (currently `[0.7, 0.5]` for `default`, `lebanese`,
`khaleeji` and `moroccan` alike), then clamped by `guardrails.clamp_params`.

---

## 2. DEPTH

### 2a. From a photograph
`transform._depth_control_image(image)`:
```python
transformers.pipeline("depth-estimation",
                      model="depth-anything/Depth-Anything-V2-Small-hf")
# on failure ↓
controlnet_aux.MidasDetector.from_pretrained("lllyasviel/Annotators")
```
Cached in a module-level `_ANNOTATOR_CACHE`. **Depth Anything V2 Small** is chosen for the
15 GB free-tier T4 budget; MidasDetector is the fallback if the transformers pipeline
cannot be constructed.

For **room analysis**, `_normalize_depth` **inverts Depth Anything's disparity** so
`0 = nearest, 1 = farthest`, and applies the linear distance model
`NEAR_DISTANCE 0.72 → FAR_DISTANCE 1.32`. → [04](04_ROOM_UNDERSTANDING.md) §3.

### 2b. From the 3D scene (Render with DAR)
`DesignWorld.renderConditioning` renders a **linear depth pass** with
`NoToneMapping` + `LinearEncoding`, from the interior capture camera.

**What geometry contributes:**

| Contributor | Contributes because |
|---|---|
| Room shell — floor, 4 walls, plinth, skirtings | Defines the box the camera stands in |
| **Capture-only ceiling** | An open top reads as *sky* from inside |
| Procedural furniture volumes | Real ontology centimetres → correct relative size and distance |
| Found massing (translucent boxes) | Kept **visible** for capture — they are real furniture in the real room |
| Wall openings (doors/windows) | Reveals cut into the wall geometry |
| Snap guides, selection cage, grid | **Excluded** — hidden during capture |

`meta` returned alongside: `{width, height, near, far, fov}` — so the depth map's scale is
self-describing.

### 2c. What depth controls in the generation
Depth is the **stronger** signal (0.7 vs 0.5). It carries:
- the room's volume and the camera's viewpoint
- how far each piece stands from the lens
- object silhouettes as 3D forms rather than flat regions
- the perspective convergence of walls and floor

---

## 3. SEGMENTATION

### 3a. From a photograph
`transform._seg_control_image(image)`:
```python
OneFormerProcessor.from_pretrained("shi-labs/oneformer_ade20k_swin_large")
OneFormerForUniversalSegmentation.from_pretrained("shi-labs/oneformer_ade20k_swin_large")
# task_inputs=["semantic"]  → post-processed to class ids
# → colorised through _ADE20K_PALETTE (the canonical 150-class mmsegmentation palette,
#   embedded verbatim in transform.py)
```

> **Degradation path:** if OneFormer raises, `_prepare_conditioning` sets `seg = depth`.
> The pipeline then feeds the depth image to *both* ControlNets rather than failing. This
> is a real fallback and should be labelled as such, not presented as segmentation.
>
> Separately, `DARDESIGN_DEPTH_ONLY=1` drops the seg ControlNet entirely (saves ~2.5 GB
> VRAM), and a seg-load exception degrades to depth-only with a log line.

### 3b. From the 3D scene
`renderConditioning` renders a **flat, unlit segmentation pass** where every mesh is
painted its exact ADE20K palette colour.

```ts
// src/lib/design/ade20k.ts — GENERATED from the backend palette, never hand-edited
ADE20K_PALETTE       // 150 RGB triples
CATEGORY_TO_ADE20K   // 24 category → class mappings
ADE20K_WALL = 0   ADE20K_FLOOR = 3   ADE20K_CEILING = 5
ADE20K_DOOR = 14  ADE20K_WINDOW = 8
```

> **`ade20k.ts` is generated from the backend's own palette and class table.** The seg
> ControlNet only understands those exact colours, so a hand-transcription slip would
> degrade conditioning **silently** rather than erroring. **Regenerate it; do not edit it.**

### 3c. How furniture gets its semantic class

Every mesh built by `geometry.buildObjectMesh` is stamped:
```ts
mesh.userData.ade = CATEGORY_TO_ADE20K[o.category] ?? ADE20K_TABLE
```
**An unmapped category falls back to the `table` class** — deliberately, because *a hole in
the segmentation map is worse than a near-miss class.*

**Anything that draws but carries no class is hidden for the capture:**
```ts
const draws = o.isMesh || o.isLine || o.isPoints || o.isSprite;
if (draws && o.visible && typeof o.userData.ade !== "number") { o.visible = false; }
```

> This test used to be `instanceof THREE.Mesh` — **which a `Line` is not.** Every found
> object carries a `LineSegments` wireframe that the capture keeps deliberately visible, so
> half-transparent grey-brown edges blended over the palette along every found object's
> silhouette.
>
> **An off-palette colour is not a near-miss class to the seg ControlNet — it is no class
> at all.** The test is now *"does it draw?"* rather than *"is it a mesh?"*.

### 3d. Walls, floor, ceiling in the 3D capture

| Surface | Class | Note |
|---|---|---|
| Walls | `ADE20K_WALL = 0` → `(120,120,120)` | **Forced fully opaque** for capture; `cullWalls()`'s on-screen fade is saved and restored |
| Floor | `ADE20K_FLOOR = 3` | |
| Ceiling | `ADE20K_CEILING = 5` → `(120,120,80)` | **Capture-only** — added then removed |
| Doors | `ADE20K_DOOR = 14` | From `WallOpening` |
| Windows | `ADE20K_WINDOW = 8` | From `WallOpening` |

Verified pixel-exact against the backend palette.

---

## 4. Why both, together

| Failure without it | Depth alone | Segmentation alone |
|---|---|---|
| Model knows *where* volumes are but not *what* they are | A sofa-shaped mass may be rendered as a bed, a bench, or a built-in platform | — |
| Model knows *what* things are but not their 3D relationship | — | Flat regions; the model must guess the perspective, distance and volume — furniture floats or intersects |
| Wall/floor/ceiling extents | Ambiguous where a wall ends and the floor begins in a low-contrast corner | Explicit |
| Object identity for culture-appropriate ornament | Absent | Explicit |

**Together:** depth fixes *where and how big*; segmentation fixes *what*. The LoRA and
prompt then supply *in which culture's idiom*.

This is also exactly why the two weights differ. Depth at **0.7** binds geometry hard;
segmentation at **0.5** binds identity more loosely, leaving the generator room to invent
culturally-appropriate surface and ornament **inside** the silhouette it is given — which
is precisely the "held / not held" boundary in the honesty contract.
→ [11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md) §6.

---

## 5. The two roles of the same seg pass in `/redesign`

One depth+seg pass produces **three** downstream artifacts:

```
                  compute_depth_seg(image, size=384)
                    │
        ┌───────────┼──────────────────────┬─────────────────────┐
        ▼           ▼                      ▼                     ▼
  ControlNet   analyze_room()      project_top_down()    seg_bounding_boxes()
  conditioning   masks, free floor,   → object_map          → seg_regions
  (generation)   scale estimate       (top-down plan)       (on-image boxes)
                    │                      │                     │
                    ▼                      ▼                     ▼
              Build Mode shell        RoomMap2D           CulturalElement-
              + found massing         + deriveRoom          Highlighter
```

**This is why asking for one culture is ~3× faster** while the room understanding is
identical — the depth+seg pass runs once regardless of how many cultures are generated.

**Working resolution is 384×384** (`_PROJECTION_SIZE`) for analysis; the ControlNet
conditioning images are resized to the generation target (1024 long side, or 768 on the
SD1.5 fallback), rounded to multiples of 8 by `fit_size`.

---

## 6. Depth map as a user-facing artifact

`/redesign` also returns `depth_map` — a **grayscale PNG data URL** — which `DepthOrbit`
(`src/components/DepthOrbit.tsx`) uses to displace a three.js plane carrying the styled
image, giving a clamped parallax orbit of the room.

This is the third layer of "The Understood Room":

| Layer | Question | Component |
|---|---|---|
| How it looks | restyled image | `BeforeAfterSlider` |
| How it's laid out | `object_map` | `RoomMap2D` |
| How it feels to be in | `depth_map` | `DepthOrbit` |

---

## 7. LIGHT mode behaviour

`compute_depth_seg` has three paths:

| Condition | Path |
|---|---|
| Not LIGHT | `_model_depth_seg` in-process; `meta["source"] = "model"` + `depth_s`/`seg_s` timings |
| LIGHT **and** `DARDESIGN_REAL_ANALYSIS=1` | `_ANALYSIS_WORKER.run(...)` — a spawned multiprocessing child with a per-image timeout (`DARDESIGN_ANALYSIS_TIMEOUT`, default 180 s) and a load timeout (default 1800 s) |
| LIGHT otherwise | `_synthetic_depth_seg()` — a deterministic hard-coded living room (window 8, door 14, cabinet 10, lamp 36, rug 28, table 15, chair 19, sofa 23) with a linear disparity ramp |

**Fallback reasons are named constants, never silent:** `flag_disabled`,
`missing_dependency`, `load_failed`, `timeout`, `inference_failed`, `worker_died`.

> **The synthetic room has no ADE20K floor**, which is why **floor recolour correctly
> reports "not detected"** in LIGHT mode while wall recolour works. That is the truth gate
> functioning, not a bug.

---

## 8. What must never be claimed

- ❌ **No segmentation accuracy (mIoU) has been measured.** OneFormer is used as published;
  DAR has run no evaluation of it on Arab interiors.
- ❌ **No depth accuracy has been measured.** Depth Anything V2 Small is used as published.
- ❌ "The segmentation is always available." → It degrades to depth-only on load failure,
  and `seg = depth` if OneFormer raises mid-request.
- ❌ "Conditioning guarantees the final piece looks like the model in Build Mode." → Only
  the **silhouette, position, orientation and viewpoint** are bound. Surface and ornament
  are invented inside the silhouette.

---

Related: [04_ROOM_UNDERSTANDING.md](04_ROOM_UNDERSTANDING.md) ·
[11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md) ·
[13_SDXL_CONTROLNET_LORA.md](13_SDXL_CONTROLNET_LORA.md)
