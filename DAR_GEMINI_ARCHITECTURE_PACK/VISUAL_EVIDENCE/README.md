# Visual Evidence — provenance

**10 images. Every one is a real output of DAR's actual pipeline. Nothing here is
staged, mocked, or reconstructed.**

---

## 1. What these are

Downscaled JPEG copies of two rooms from `public/demo/`, which
`scripts/make_demo_pack.py` builds by copying pre-rendered rooms out of
`outputs/finals/` — i.e. **genuine GPU renders from the SDXL + dual ControlNet +
cultural LoRA pipeline.**

| File | Room | Content |
|---|---|---|
| `pipeline_spacejoy_original.jpg` | Sitting corner | The input photograph |
| `pipeline_spacejoy_lebanese.jpg` | " | Lebanese redesign |
| `pipeline_spacejoy_khaleeji.jpg` | " | Khaleeji redesign |
| `pipeline_spacejoy_moroccan.jpg` | " | Moroccan redesign |
| `pipeline_spacejoy_depth_map.jpg` | " | The Depth Anything V2 depth map |
| `pipeline_sample_original.jpg` | Sample room (bedroom) | The input photograph |
| `pipeline_sample_lebanese.jpg` | " | Lebanese redesign |
| `pipeline_sample_khaleeji.jpg` | " | Khaleeji redesign |
| `pipeline_sample_moroccan.jpg` | " | Moroccan redesign |
| `pipeline_sample_depth_map.jpg` | " | The depth map |

**Together these demonstrate the project's central visual argument — *same bones, three
souls*: one room, one depth+segmentation pass, three culturally distinct renders.**

---

## 2. Why the provenance is checkable

Each source room ships a `meta.json` alongside the images. Read directly from them:

| | `spacejoy-GQQyH0yNqLk-unsplash` | `sample-room` |
|---|---|---|
| **`placeholder`** | **`null`** | **`null`** |
| `object_map.jobId` | `d2429ce9215145c4ad145fd44a4f0eeb` | `c13bb308fd574e1aa7d638d4265669b8` |
| Detected objects | **12** | **11** |
| Segmentation regions | **12** | **10** |
| Detected classes | chair, cushion, lamp, painting, rug, table, window | bed, cabinet, chair, cushion, mirror, pillow, shelf, table, wardrobe |
| `object_map.version` | `projection-v1` | `projection-v1` |
| `seg_regions.version` | `segmap-v1` | `segmap-v1` |

> **`"placeholder": null` is the decisive fact.** A `DARDESIGN_LIGHT` run stamps
> `placeholder: true` through the whole payload, and the frontend truth gates suppress it.
> These carry `null`, a real job id, and real per-object confidence values — so they are
> **real pipeline output from a GPU host**, not the desaturated culture-tinted placeholder
> that LIGHT mode produces.

---

## 3. Transformation applied

Only downscaling and re-encoding, so the pack stays small enough to upload comfortably:

- Longest side capped at **1100 px** (Lanczos)
- Saved as **JPEG, quality 86, optimised**
- Total: **1.3 MB** (the originals are ~9 MB for these two rooms; the full demo pack is 24 MB)

**No cropping, no colour correction, no retouching, no compositing.**

Original dimensions: spacejoy 1024×1024 (unchanged); sample-room 1024×504 (unchanged);
depth maps 384×384 (unchanged — that is `_PROJECTION_SIZE`, the analysis resolution).

---

## 4. Why these rather than live screenshots

Two reasons, both about honesty:

1. **The live backend on the audit machine is in `DARDESIGN_LIGHT` mode**
   (`/healthz` → `light_mode: true`). Screenshotting Studio right now would capture
   **desaturated culture-tinted placeholders**, not renders — and presenting those as
   results would be exactly the kind of claim this pack exists to prevent.
2. The Chrome automation profile was locked by another running instance, and terminating a
   process that might belong to a concurrent session was not worth the disruption.

**These pre-rendered outputs are strictly better evidence than a LIGHT-mode screenshot
would have been.**

---

## 5. ⚠ Not included, and why

| Not here | Why |
|---|---|
| **Build Mode screenshots** | Would require a live browser session. The 3D scene is fully described in `09_BUILD_MODE_THREEJS.md` |
| **Conditioning captures (beauty / depth / seg from a 3D scene)** | These are produced client-side at render time and are not persisted to disk. Their measured properties are documented in `11_RENDER_WITH_DAR.md` §7 (pixel-exact ADE20K palette; ceiling `120,120,80`, wall `120,120,120`) |
| **A Render-with-DAR result** | The 2026-08-13 GPU render (35.61 s, 13-object scene) was not saved into the repository. **The timing and the A/B are recorded; the image is not available.** It is not reconstructed here |
| **Planner result screenshots** | Not persisted |
| **Evaluation dashboard screenshots** | It would show "No data" for LPIPS, CLIP and the confusion matrix — accurately. The state is fully tabulated in `16_EVALUATION.md` |

> **Nothing missing has been faked or substituted.** Where an image does not exist, this
> pack says so.

---

## 6. Photograph licensing

The input photographs come from **Unsplash** — the filenames carry the photographer and
the Unsplash id (`spacejoy-GQQyH0yNqLk-unsplash`, and in the wider demo pack
`alef-morais-…`, `joseph-cortez-…`, `point3d-commercial-imaging-ltd-…`,
`poojan-thanekar-…`). They are inputs used to demonstrate the pipeline, not training data.

Training-data licensing is audited separately in `datasets/LICENSING.csv`.

---

## 7. How to use these in the defense

| Slide | Images | Point |
|---|---|---|
| **"Same bones, three souls"** | `spacejoy_original` + the three cultures side by side | One photograph, one analysis pass, three culturally distinct results |
| **"DAR understands the room"** | `spacejoy_original` + `spacejoy_depth_map` | The depth map is real output, and it feeds both the ControlNet and the room analysis |
| **Cross-room generalisation** | The two rooms together | A sitting corner and a bedroom — different room types, the same pipeline |

**Do not attach any quality metric to these images.** No SSIM, LPIPS or CLIP value has been
computed for them. → `16_EVALUATION.md`
