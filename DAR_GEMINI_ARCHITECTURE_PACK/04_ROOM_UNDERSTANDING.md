# 04 — Room Understanding

*What actually happens to a real photograph, and — critically — which numbers are
**measured**, which are **estimated**, and which are **assumed constants**.*

---

## 1. The pipeline

```
room photograph (JPEG/PNG/WebP, ≤10 MB, ≥256 px)
        │
        ▼  transform.compute_depth_seg(image_path, size=384)
   ┌────────────────────────┬─────────────────────────────┐
   │ Depth Anything V2 Small│ OneFormer ADE20K Swin-Large │
   │ depth-anything/        │ shi-labs/oneformer_ade20k_  │
   │  Depth-Anything-V2-    │  swin_large                 │
   │  Small-hf              │ task_inputs=["semantic"]    │
   └───────────┬────────────┴──────────────┬──────────────┘
        depth (float array)          seg (ADE20K class ids)
               │                            │
               └──────────┬─────────────────┘
                          ▼
              room_analysis.analyze_room(depth, seg)
                          │
        ┌─────────────────┼──────────────────┬────────────────┐
        ▼                 ▼                  ▼                ▼
   masks +           projection.        projection.       depth PNG
   free floor +      project_top_down() seg_bounding_     (grayscale
   scale estimate    → object_map       boxes()           data URL)
        │            (top-down plan)    → seg_regions
        │                                (on-image boxes)
        ▼
   RoomAnalysis.summary()  →  the Build Mode shell source
```

**Working resolution is 384×384** (`_PROJECTION_SIZE = 384`). Both models run **once per
`/redesign`**, regardless of how many cultures are requested — which is why asking for one
culture is ~3× faster while the room understanding is identical.

**Neither `room_analysis.py` nor `projection.py` runs a model.** Both consume the arrays.
Their docstrings say "GPU NOT NEEDED".

---

## 2. Segmentation — what is found

`ADE20K_FURNITURE` in `projection.py` maps **30 ADE20K class ids** to
`(classKey, labelEn, labelAr)` triples — e.g. `23 → ("sofa","sofa","أريكة")`,
`8 → ("window","window","نافذة")`, `14 → door`, `28 → rug`, `36 → lamp`.

`HIGHLIGHTER_CLASSES` = those 30 plus `17 → plant`. **Wall, floor and ceiling are
deliberately excluded** from the highlighter — their bounding boxes span the whole frame
and carry no information.

### The masks `analyze_room` builds

| Mask | Definition |
|---|---|
| `floor_mask` | `np.isin(seg, FLOOR_IDS)` where `FLOOR_IDS = (3 floor, 28 rug)` — **a rug counts as standing room** |
| `wall_mask` | `seg == 0` |
| `occupied_mask` | every class present, minus `{0 wall, 3 floor, 5 ceiling}`, minus `_NON_BLOCKING = {28 rug, 22 painting, 27 mirror, 39 cushion, 57 pillow, 85 chandelier}` |
| `protected_mask` | `np.isin(seg, (12 person, 14 door, 8 window))`, **dilated** by `max(2, 2% of the short side)` |
| `free_floor_mask` | `floor & ~occupied & ~protected & ~boundary`, boundary = 4 % of the short side on all four edges |

> **`floor_mask` counts rugs as standing room on purpose** (you can put furniture on a
> rug). **`recolor.py` therefore does NOT use it** for floor recolouring — it reads
> `RoomAnalysis.seg_ids` so that "floor" means ADE20K floor and *not* the rug on it.

---

## 3. Depth — and the perspective model

`_normalize_depth` **inverts Depth Anything's disparity** so that `0 = nearest,
1 = farthest`.

Distance model (`room_analysis.py`):
```
depth_to_distance(d) = NEAR_DISTANCE + d * (FAR_DISTANCE - NEAR_DISTANCE)
NEAR_DISTANCE = 0.72,  FAR_DISTANCE = 1.32          # ≈ 1.8× swing
```
`_free_floor_area_px` weights each free-floor pixel by `distance²`, so floor further from
the camera contributes more real area per pixel.

> The comment records that this band was **deliberately narrowed** from an earlier
> 0.35–1.6. This is a monocular heuristic, not a calibrated camera model.

---

## 4. Scale estimation — the honest part

**A single photograph has no metric scale.** DAR calibrates against furniture of *assumed*
size (`_estimate_scale`):

```python
REFERENCE_WIDTH_CM = {
    14: 85.0,   # door
    23: 200.0,  # sofa
    30: 90.0,   # armchair
    19: 48.0,   # chair
     7: 150.0,  # bed
    64: 110.0,  # coffee table
}
```

For each connected blob of a reference class, `px_per_cm = blob_pixel_width /
assumed_cm_width`. Blobs narrower than 12 px are discarded as artefacts. **The median** of
all estimates is taken.

**Confidence:**
- exactly one estimate → `0.4`
- otherwise → `clip(1 - std/median, 0.2, 0.95)`
- no estimates → `(None, 0.0, 0.5)` and a warning is emitted

**Warnings the analysis can emit:**
- `"very little floor is visible — placement suggestions will be unreliable"` (floor < 5 %)
- `"no reference object of known size found — floor area could not be estimated in metres; use free_floor_ratio instead"`
- `"no open floor area large enough for furniture was found"`

---

## 5. What `RoomAnalysis.summary()` actually returns

```python
{ "free_floor_ratio", "free_floor_of_floor", "free_floor_m2",
  "scale_confidence", "existing_categories", "candidates", "warnings" }
```

> ### ⚠ There is NO room width, depth or height anywhere in the analysis.
>
> The masks stay server-side by design. The backend never claims to know the room's
> extent — only how much *free floor* it can see and how confident it is about the scale.

---

## 6. From analysis to a 3D room — `src/lib/design/roomModel.ts`

This is where the room rectangle is invented, **client-side**, and it is the single most
important honesty boundary in DAR.

```
total_floor_m2 = free_floor_m2 / free_floor_of_floor
        │
        ├─ plausibility band: 9 m² ≤ total ≤ 90 m²
        │     outside → null → DEFAULT_ROOM, shellSource: "default"
        │
        ▼
   width  = sqrt(area × DEFAULT_ASPECT)        DEFAULT_ASPECT = 1.25  ← ASSUMED
   depth  = area / width
   both clamped to [MIN_SIDE_CM 260, MAX_SIDE_CM 1100]
   height = DEFAULT_ROOM.heightCm = 300                              ← ALWAYS CONSTANT
        │
        ▼
   shellSource = "measured"  if scale_confidence ≥ 0.4
                 "estimated" otherwise
```

### Measured vs estimated vs assumed — the table to put in front of a jury

| Quantity | Status | Source |
|---|---|---|
| Which objects are in the room | **Detected** | OneFormer ADE20K semantic segmentation |
| Relative depth of each object | **Detected** | Depth Anything V2 |
| Free-floor **ratio** | **Measured** (from masks) | `free_floor_mask` pixel count |
| Floor **area in m²** | **Estimated** | Calibrated against assumed furniture widths |
| Scale confidence | **Computed** | Spread of the calibration estimates |
| Room **width × depth** | **Derived from an assumption** | area + a **fixed 1.25 aspect ratio** |
| Room **height** | **Assumed constant** | **Always 300 cm. Never derived, never measured.** |
| Door / window height | **Assumed constant** | door 210 cm, window 140 cm |
| Found-object heights | **Priors** | `FOUND_HEIGHT_CM` per class |

> **`shellSource: "measured"` does NOT mean DAR measured the room.** It means the *area*
> estimate had a scale confidence ≥ 0.4. The rectangle's proportions are still an
> assumption. The UI header chip states which of the three sources is in play, so a
> default room is never presented as a measurement.

### Two real failures the code documents

The plausibility band exists because of two measurements taken in the same session:

| Observed estimate | What it was | Outcome |
|---|---|---|
| **130 m²** | An 11 × 11 m "room" — furniture lost in a hall | Rejected by the band |
| **3.6 m²** | Clamped to the 260 cm minimum; a planned majlis could not fit and pieces were correctly dropped for lack of space | Rejected by the band |

The earlier band was 2–200 m² and let **both** through.

> **The honest outcome is the default room**: *"an ordinary room DAR does not claim to have
> measured beats a measurement that is visibly wrong."*

**One more honesty mechanism:** if the user manually resizes the room in the Inspector,
`store.ts`'s `resizeRoom` action **downgrades `provenance.shellSource` to `"default"`** —
the chip stops claiming DAR measured it.

---

## 7. Found furniture — the room arrives already understood

`deriveRoom` reconstructs `object_map` footprints as **locked `found` massing**, so Build
Mode does not open on an empty grid. Three class sets are filtered out first:

| Filtered set | Why |
|---|---|
| `OPENING_CLASSES` — door, window, windowpane, doorway | Become `WallOpening`s pinned to the nearest wall, not floor objects |
| `WALL_MOUNTED_CLASSES` — painting, mirror, tv, curtain, chandelier, ceiling… | Otherwise "a painting standing in the middle of the room" |
| `ON_FURNITURE_CLASSES` — cushion, pillow | See the bug below |

### The cushion bug — a worked example of why this filter exists

The segmenter finds every cushion along a majlis bench and `project_top_down` merges the
run into **one** footprint. The demo majlis produced a `cushion`
**520 × 142 × 75 cm** — the full width of the room, extruded solid, **33.8 % of the floor**,
sitting on top of the two sofas it belonged to.

Adding `cushion`/`pillow` to `ON_FURNITURE_CLASSES` took found floor coverage from
**69.6 % → 35.8 %** and the seg `table` class share from **23.7 % → 3.3 %**.

Surviving objects additionally get `capFootprint()` per-class size caps (scaled by one
factor so proportions survive), `materialKey: "found"`, and **`locked: true`** — they
describe the room as it is, so moving one silently turns a measurement into a fiction.

---

## 8. The two spatial representations

| Representation | Function | Coordinate space | Consumed by |
|---|---|---|---|
| **`object_map`** — top-down plan | `project_top_down()` | `cx, cy, w, h` normalised; **`cy` is camera-axis depth**, not image Y | `RoomMap2D`, `roomModel.deriveRoom`, the planner's "existing" list |
| **`seg_regions`** — on-image boxes | `seg_bounding_boxes()` | `bbox: [x, y, w, h]` normalised **image space** | `CulturalElementHighlighter` |

**`project_top_down` per blob:**
```
cx = (xs.start + xs.stop) / 2 / W        horizontal centre
cy = median(blob_depth)                  camera-axis position, 0 = near
w  = (xs.stop - xs.start) / W            width
h  = max(q75 - q25, 0.04)                depth extent from the IQR of the blob's depth
confidence = clip(1 - std * 2.5, 0.2, 1.0)
```
Filtered by `min_area_frac = 0.0035`, sorted by area desc, truncated to `max_objects = 14`.

Envelopes: `{"jobId","style","objects","version":"projection-v1"}` and
`{"jobId","regions","version":"segmap-v1"}`.

---

## 9. Candidate placement spots

`_find_candidates` runs `scipy.ndimage.distance_transform_edt` on the free-floor mask and
takes up to `max_candidates = 8` local maxima with `min_clearance_px = 12`, suppressing a
disc of radius `clearance × 1.5` after each pick.

```
max_width_cm = 2 * clearance / local_px_per_cm
where local_px_per_cm = px_per_cm * distance(reference) / distance(here)
```

`mark_occupied(...)` marks only the bottom contact strip
(`max(2.0, height × 0.18)`), clears free floor there, re-runs the candidate search and
recomputes the ratios — so placing one piece correctly shrinks the space for the next.

---

## 10. Provenance and caching

- **Cache**: LRU `OrderedDict`, `CACHE_MAX = DARDESIGN_ROOM_CACHE or 32`, ~9 MB per
  analysis at 1024². `GET /api/furniture/room-analysis/{job_id}` returns the **cached**
  summary and **404s rather than recomputing**.
- **In LIGHT mode** there are three paths: real in-process models (not light);
  a **spawned multiprocessing worker** when `DARDESIGN_REAL_ANALYSIS=1` (with load and
  per-image timeouts); otherwise `_synthetic_depth_seg()` — a deterministic hard-coded
  living room with a linear disparity ramp.
- Fallback reasons are named constants, not silent: `flag_disabled`,
  `missing_dependency`, `load_failed`, `timeout`, `inference_failed`, `worker_died`.

---

## 11. What must never be claimed

- ❌ "DAR measures your room." → It estimates floor **area** and assumes the proportions.
- ❌ "DAR knows the ceiling height." → It is always 300 cm.
- ❌ "The room dimensions are accurate." → The plausibility band exists precisely because
  they were observed to be wrong by an order of magnitude in both directions.
- ❌ "Detection accuracy is X %." → **No detection accuracy has been measured.** OneFormer
  and Depth Anything are used as published; DAR has run no evaluation of them on Arab
  interiors.

Related: [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) ·
[12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md) ·
[20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)
