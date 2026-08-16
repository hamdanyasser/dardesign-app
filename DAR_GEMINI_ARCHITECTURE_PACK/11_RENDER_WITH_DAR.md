# 11 — Render with DAR

> **The idea, in one sentence:**
> Because DAR already renders the room in 3D, it can produce the **exact two control
> images** the generation pipeline already consumed from photographs — so the user's edits
> reach the renderer as a **control signal**, not as a description.

---

## 1. Where the strategy came from

It was **read out of the pipeline, not invented**. `backend/transform.py` already ran SDXL
with a **dual ControlNet — Depth Anything depth + ADE20K-palette OneFormer segmentation**,
normally derived from the photograph. Those two images *are* the layout signal.

So Build Mode renders depth and segmentation **from the 3D scene** and substitutes them.

**The cost of adding this to the backend was one optional parameter:**

```python
def _generate(..., control_override: tuple[Any, Any] | None = None, _fresh: bool = False):
    ...
    if control_override is not None:
        depth, seg = (im.convert("RGB").resize(target_size) for im in control_override)
    else:
        _, depth, seg = _prepare_conditioning(image_path, target_size)
```

> **`control_override=None` behaves exactly as before, so the `/redesign` path is
> byte-for-byte unchanged.** No model, notebook or Colab change was needed or made.

---

## 2. The full trace

```
EDITABLE BUILD MODE SCENE  (DesignScene — plain JSON, centimetres)
        │
        ▼  HandoffPanel.tsx  →  capture(1024, 768)
   DesignWorld.renderConditioning(w, h)
        │   builds its OWN interior camera (not the orbit camera)
        │   forces every wall opaque, adds a capture-only ceiling
        │   three offscreen passes:
        ├─────────────► BEAUTY   sRGB-encoded, for the evidence strip
        ├─────────────► DEPTH    NoToneMapping + LinearEncoding
        └─────────────► SEG      NoToneMapping + LinearEncoding, exact ADE20K palette
        │
        │   ⚠ capture happens BEFORE the request, so the evidence
        │     survives a dead backend
        ▼
   renderScene(depthDataUrl, segDataUrl, style, { room, scale })
        │   src/lib/api.ts → API_URL (the GPU host)
        │   culture "all" collapses to "lebanese" — a generator takes one culture
        ▼
POST /render-scene      multipart: depth, seg, style, room, scale?
        │
        ▼  backend/main.py
   async with _GEN_LOCK:                      ← the same lock /redesign takes
        transform.render_scene(
            depth_image=…, seg_image=…, style=…, out_path=…,
            seed=…, room=room, use_lora=True,
            controlnet_weights=_winner_weights(style), lora_scale=scale)
        │
        ▼  backend/transform.py
   build_prompts(style, room=room, seed=seed)   ← the ORDINARY cultural prompt
   _attach_lora(style, scale)                   ← the ORDINARY per-culture LoRA
   target = fit_size(*depth_image.size, 1024)
   _generate(..., control_override=(depth_image, seg_image))
        │
        │   ⚠ _prepare_conditioning is NOT called — no photo-derived annotator runs
        ▼
   SDXL + [depth ControlNet, seg ControlNet] at sweep-winner weights (0.7, 0.5)
        │   on OOM → _free_pipe → SD 1.5 + ControlNet 1.1 @ 768²
        ▼
   PNG + <out>.manifest.json
        ▼
   JSONResponse { job_id, style, image, duration_s, placeholder }
        │
        ▼  HandoffPanel
   THE RENDER  +  the evidence strip (beauty / depth / seg)
                 +  the honesty contract (§6)
```

---

## 3. The capture camera — the root cause of the first failure

> This is the best "we measured it and were wrong" story in the project.

The capture originally **cloned the on-screen orbit camera**: outside the room, ~30° above
horizontal, 38° FOV. But SDXL and both ControlNets were trained on **interior photographs
made from inside rooms at eye height with a wide lens**. Every capture handed them a
viewpoint **no camera could occupy**.

The first real GPU render of a 13-object Khaleeji majlis came back reading as
**a wooden-screen storage room**.

`renderConditioning` now builds its own camera:

```ts
CAPTURE_EYE_Y          = 155   // cm — eye height, inside the room
CAPTURE_FOV_DEG        = 54    // ≈ a 24 mm interior lens
CAPTURE_WALL_CLEARANCE = 45    // cm — stand-off from the back wall
CAPTURE_BODY_CM        = 55    // clearance from any object's world bounds
```

It keeps **only the user's azimuth** — which way they were facing. The editor camera is
untouched.

**Two consequences of being inside:**

1. **All four walls stay.** The exterior camera had to hide the walls it looked *through*,
   so the generator received a room with holes where its corners belonged. From inside, the
   near wall is simply behind the lens and the frame closes itself.
2. **A capture-only ceiling** in the real `ADE20K_CEILING` class, because an open top reads
   as *sky* from inside. Verified pixel-exact: ceiling `120,120,80`, wall `120,120,120`.

**And the camera walks in.** A fixed stand-off works in an empty room and fails in a
furnished one — with a planned majlis the seating runs along the very wall the lens backs
onto, and one slatted screen filled the whole frame. The capture now walks forward and
stops at the first position clear of every object by `CAPTURE_BODY_CM`, falling back to the
old position if the room is too full.

**Framing:** the original maquette framing left **~42 %** of the frame empty — 42 % of
pixels SDXL would invent. Now **~16 %**.

---

## 4. The three passes

| Pass | Colour pipeline | Why |
|---|---|---|
| **Beauty** | ACES + sRGB (via a 256-entry LUT implementing the real piecewise transfer, not a 1/2.2 approximation) | It sits next to the on-screen view; a gamma mismatch is exactly what the eye catches in a side-by-side |
| **Depth** | `NoToneMapping` + `LinearEncoding` | **Conditioning is DATA, not a picture** |
| **Segmentation** | `NoToneMapping` + `LinearEncoding` | The seg ControlNet only understands the exact ADE20K palette colours |

> **Why the beauty pass is transfer-encoded in software:** three r150 forces
> `outputEncoding` to Linear for any non-XR render target, so a captured colour pass comes
> back linear no matter what the renderer is set to — visibly darker than the same scene on
> screen. Depth and seg *want* those raw linear bytes, so only the beauty pass is encoded.

**Three bugs found by measuring captured pixels, not by looking at them:**
ACES shifted the palette (wall `120 → 129`, lamp `(224,255,8) → (187,189,40)`); the
camera-facing walls rendered opaque; and the `cullWalls()` fade was never undone, handing
the generator two walls at `opacity 0.045` with their skirtings switched off.
→ [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) §7 for the full list.

---

## 5. What crosses the wire

**`buildRenderPayload(scene)` → schema `"dar.scene/v3"`** (`HandoffPanel.tsx`).

`POST /render-scene` multipart:

| Field | Type | Notes |
|---|---|---|
| `depth` | file | PNG data URL → file |
| `seg` | file | PNG data URL → file |
| `style` | form str | `lebanese` / `khaleeji` / `moroccan` (`"all"` collapsed client-side) |
| `room` | form str, default `"living room"` | **from `renderIntent.roomType`** — was hardcoded before the planner |
| `scale` | form float, optional | **from `renderIntent.intensity`** — a pass-through to `lora_scale` |

> **Omitted, the render path is byte-for-byte what it was** — the same discipline as
> `control_override`. `renderIntent` lives in page state rather than `DesignScene`
> precisely so adding it did not bump `SCENE_VERSION` and discard every saved room.

Response: `{ job_id, style, image, duration_s, placeholder }`.

---

## 6. ⭐ The honesty contract — load-bearing

The panel shows the **actual conditioning images as evidence** and states the limit
explicitly:

| | |
|---|---|
| **HELD** | placement · orientation · geometry · viewpoint — **because they are the control signal** |
| **NOT HELD** | the appearance of any individual piece — the model invents surface and ornament *inside* the silhouette; materials reach it through the **prompt**, so they **steer rather than bind** |

`transform.render_scene`'s own docstring says it plainly:

> *"layout, silhouette and viewpoint are strongly preserved because they are literally the
> control signal. The appearance of any one piece is not."*

**A LIGHT backend returns `placeholder: true` and the UI says
"That last image is not a real render."**

> **There is no fake render button.** If the GPU is not reachable, DAR says so.

---

## 7. Verification status — precisely

### ✅ Verified without a GPU (instrumented, not assumed)
- `control_override` is passed through to the pipeline
- Depth and seg arrive at full size with correct ADE20K classes
- `use_lora=True` with the selected culture
- **`_prepare_conditioning` is called 0 times** — no silent fallback to photo-derived
  annotators
- Segmentation output is **pixel-exact** against the backend palette

### ✅ Verified end-to-end on a real GPU (2026-08-13)
Against a live render host (`/healthz` → `light_mode: false`), a Build Mode scene —
**10 `found` objects from a real `object_map` plus 3 user-placed Khaleeji pieces** —
captured its conditioning and came back as a genuine render in **35.61 s**.

That first render read as a wooden-screen storage room, which confirmed the doll's-house
diagnosis. **The capture camera was then rebuilt and the same 13-object scene (restored
from `localStorage`) re-rendered as a believable room** — an A/B on identical scene data.

### ⚠ Verified in the conditioning only — NOT re-rendered
The **cushion filter** and the **camera-occupancy walk-in** fixes were verified by measured
class shares and an inspected beauty pass (a proper corner view with clear centre floor),
**because the render tunnel expired before they could be re-rendered.**

> **ACTION ITEM: re-run one Render with DAR when a GPU host is next up.**

### ❌ NOT claimed
**Layout-preservation *quality* is unmeasured.** There is no side-by-side study, and a
handful of renders is an observation, not a result.

---

## 8. Two defects found by measuring the conditioning

**1. A cushion the width of the room.**
The segmenter finds every cushion along a bench and `project_top_down` merges the run into
**one** footprint. The demo majlis produced a `cushion` **520 × 142 × 75 cm** — the full
room width, extruded solid, **33.8 % of the floor**, sitting on top of the two sofas it
belonged to.

`roomModel.ts` already dropped wall-mounted classes for exactly this reason ("a painting
standing in the middle of the room"); `ON_FURNITURE_CLASSES` now does the same for
`cushion` / `pillow`.

| Metric | Before | After |
|---|---|---|
| Found floor coverage | 69.6 % | **35.8 %** |
| Seg `table` class share | 23.7 % | **3.3 %** |

**2. The camera stood inside the sofa.** — see §3.

---

## 9. Relationship to the other two editing systems

DAR has **three** ways to change a design. They must not be conflated.

| System | Operates on | Mechanism | Reversible |
|---|---|---|---|
| **Colour Control** (`/api/color/*`) | A **finished PNG** | Masked HSV edit; hue/saturation from the picked colour, **value channel preserved** (every shadow and texture) | Undo stack, depth 20 |
| **Furniture Placement** (`/api/furniture/*`) | A **finished PNG** | **Asset compositing**, not inpainting — what the user positioned is exactly what lands | Repoints `job.style_outputs[style]` |
| **Render with DAR** (`/render-scene`) | A **3D scene** | **Full re-generation** conditioned on scene depth + seg | New image |

> **Colour Control and Build Mode materials are two separate systems with no overlap.**
> `/api/color/*` needs a `job_id`, a rendered image and cached segmentation from a
> `/redesign` pass; a Build Mode scene that was never rendered has none of those. The
> scene's real colour system is `RoomShell.wallMaterialKey` / `floorMaterialKey` via
> `setShellMaterial`. **Do not wire them together.**

---

## 10. Known implementation risk

`_generate`'s offload-hook recovery path (`except AttributeError` where `"_hf_hook" in
str(e)` → `_free_pipe` → one recursive retry with `_fresh=True`) **does not forward
`control_override`**.

> If a Build Mode render hit that path, it would silently fall back to deriving
> conditioning from `image_path` — which for `render_scene` is `out_path`.
> **No test covers this path.** Flagged as a plausible latent bug, not an observed failure.

---

Related: [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) ·
[12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md) ·
[13_SDXL_CONTROLNET_LORA.md](13_SDXL_CONTROLNET_LORA.md) ·
[17_FULL_DATA_FLOW.md](17_FULL_DATA_FLOW.md) Flow C
