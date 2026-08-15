# 10 — Furniture and Assets

**Canonical source: `ontology/furniture.json`, version `0.2.0`, 27 items.**
One file; the backend, the frontend catalogue and the LLM planner all read it. **No copy
of the dimensions exists anywhere else.**

---

## 1. Catalogue at a glance

| Property | Value |
|---|---|
| Items | **27** |
| Cultures | **3** — lebanese 9, khaleeji 9, moroccan 9 (**no Persian**) |
| Categories | **12** |
| Cut-out PNG assets on disk | **27** (`public/furniture/<culture>/<id>.png`) |
| **Real 3D models (GLTF/GLB)** | **1** — `Ottoman_01.glb` for `leb-ottoman-001` (CC0, Poly Haven) |
| **PBR texture sets (CC0, ambientCG)** | **14** sets / 42 files |
| Deferred items | 7 (metadata written, not shipped) |

### Category distribution

| Category | Count | Lebanese | Khaleeji | Moroccan |
|---|---|---|---|---|
| `sofa` | 3 | ✅ | ✅ | ✅ |
| `armchair` | 3 | ✅ | ✅ | ✅ |
| `chair` | 2 | ✅ | — | ✅ |
| `ottoman` | 3 | ✅ | ✅ | ✅ (pouf) |
| `coffee_table` | 3 | ✅ | ✅ | ✅ |
| `side_table` | 3 | ✅ | ✅ | ✅ |
| `console` | 3 | ✅ | ✅ | ✅ |
| `cabinet` | 2 | — | ✅ | ✅ |
| `screen` | 1 | ✅ | — | — |
| `lamp` | 2 | ✅ | ✅ | — |
| `lantern` | 1 | — | — | ✅ |
| `cultural_object` | 1 | — | ✅ (incense) | — |

**v0.2 widened each culture from 5 to 9 pieces**, so a design agent has a real choice of
layout rather than one option per category. From the file's own `_note_v2`:

> *"The two gaps that were closed first were the ones that made a room undesignable —
> Khaleeji had no chair of any kind, and Moroccan had no sofa."*

Every culture now has: a sofa, an armchair, a coffee table, a side table, a light source,
an ottoman and a wall console.

---

## 2. Item schema — every field

```json
{
  "id": "leb-chair-001",
  "culture": "lebanese",
  "category": "chair",
  "name_en": "Carved wooden chair",
  "name_ar": "كرسي خشبي محفور",
  "description_en": "Traditional Levantine chair in carved walnut with a woven rush seat.",
  "description_ar": "كرسي شامي تقليدي من خشب الجوز المحفور بمقعد من القش المضفور.",
  "asset": "furniture/lebanese/leb-chair-001.png",
  "placement_type": "floor_standing",
  "room_types": ["living_room","majlis","dining_room","bedroom","hallway"],
  "real_width_cm": 48,
  "real_height_cm": 95,
  "real_depth_cm": 52,
  "floor_footprint_cm": [48, 52],
  "must_touch_wall": false,
  "must_stand_on_floor": true,
  "preferred_zones": ["open_floor","against_wall","beside_seating"],
  "cultural_tags": ["levantine","carved_wood","ottoman_era"],
  "material_tags": ["walnut","rush","wood"],
  "color_tags": ["warm_brown","natural"],
  "generation_prompt": "a single traditional Lebanese carved walnut chair with woven rush seat, ornate turned legs"
}
```

> **⚠ Field-order trap, documented in the code:** the raw JSON is
> `width, HEIGHT, depth`. `src/lib/design/catalog.ts` exposes `width, depth, height`.
> **Read the keys, never the order.**

### Stable IDs
Format `<culture-prefix>-<category>-<nnn>`: `leb-`, `khal-`, `mor-`.
**These ids are the LLM's entire vocabulary** — they form the JSON-Schema `enum` that makes
an invented piece unrepresentable. → [06](06_LLM_DESIGN_PLANNER.md) gate 1.

### `placement_type` — only one is implemented

| Type | Status |
|---|---|
| `floor_standing` | ✅ **Implemented.** Bottom edge contacts the detected floor plane; scaled by depth at the contact point |
| `floor_flat` | ⏳ **DEFERRED** — needs perspective warp, not just scaling (rugs) |
| `wall_mounted` | ⏳ **DEFERRED** — needs wall-plane estimation (art, mirrors) |
| `on_surface` | ⏳ **DEFERRED** — needs seat/table-surface detection (cushions) |

**All 27 shipped items are `floor_standing`.** The 7 deferred items —
`leb-cushions-001`, `leb-wallart-001`, `khal-cushions-001`, `khal-wallart-001`,
`mor-rug-001`, `mor-mirror-001`, `mor-cushions-001` — have metadata but no assets, *"because
each needs a different geometry solution rather than simple depth-scaled compositing."*

### `preferred_zones`

| Zone | Definition (from the file) |
|---|---|
| `corner` | Where two wall planes meet the floor — favours tall/vertical items |
| `against_wall` | Floor adjacent to a wall plane — favours sofas, cabinets |
| `open_floor` | Unoccupied floor away from walls — favours tables, poufs |
| `beside_seating` | Floor adjacent to a detected sofa/chair — favours side tables, lamps |

These feed `findSpot()`'s candidate generation in Build Mode
([08](08_SPATIAL_VALIDATION.md) §7) and `_zone_score` in `backend/placement.py`.

---

## 3. ⭐ How each piece is drawn — the three honesty tiers

**1 of 27 catalogue pieces is a real scanned model. The other 26 are authored geometry.**
The tier is recorded in `ontology/furniture_models.json` and **surfaced in the product UI**,
so the distinction is visible to the user, not buried in a config file.

| Tier | Count | What is on screen |
|---|---|---|
| **REAL MODEL** | **1** | `leb-ottoman-001` → the CC0 *Ottoman 01* scan, `contain`-fitted inside its declared 55 × 42 × 55 cm box |
| **ENHANCED PROCEDURAL** | **26** | Authored THREE geometry at real ontology centimetres — real silhouette, legs, arms, cushions, ornament |
| **FALLBACK MASSING** | found objects | The abstract translucent volume for furniture read off the user's *photograph* |

### Why only one real model

> *"There is no CC0 library of Lebanese, Khaleeji or Moroccan furniture. Around twenty
> candidate scans were inspected side by side against DAR's catalogue art; **all but one
> were rejected as culturally wrong.** DAR's own LoRA-generated catalogue art is more
> culturally specific than anything available under CC0."*
> — `ontology/furniture_models.json::_why_so_few_real`

**Adding a real model later is one entry in that registry — no code change.**

The registry is a **sidecar** to `furniture.json` rather than new fields inside it, because
that file is the shared frontend/backend source of truth and ~20 pytest cases pin its
schema.

→ [09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) §1, §5b

---

## 4. Assets — provenance and licensing

**From `furniture.json`'s own `_asset_pipeline` note:**

> *"Assets are generated by `scripts/generate_furniture_assets.py` using each culture's own
> trained LoRA, then background-removed to transparent PNG. **Self-generated ⇒ licensing is
> ours, unlike scraped stock imagery.** An item is listed here as soon as its metadata is
> written, which is before its PNG exists: `backend/furniture.py` only offers items whose
> asset file is actually on disk, so a catalogue entry can never outrun its render."*

| Asset class | Count | Origin | Licensing |
|---|---|---|---|
| Furniture cut-out PNGs | 27 | Generated by `generate_furniture_assets.py` with DAR's own LoRAs (SDXL base + custom VAE), background-removed | **Self-generated — the project's own** |
| **3D model** | **1** | **Ottoman 01** by Caspian Fortune, [Poly Haven](https://polyhaven.com/a/Ottoman_01) | **CC0-1.0** |
| **PBR texture sets** | **14** (42 files) | [ambientCG](https://ambientcg.com/) — Travertine009, Plaster001/002, PaintedPlaster017, Marble012, Wood027/092, Fabric030/061 … | **CC0-1.0** |
| Procedural ornament (zellige etc.) | — | **Drawn**, not downloaded — `src/lib/design/patterns.ts` | **No licence attaches** |
| Demo room photos | 6 | Unsplash (filenames carry the photographer + Unsplash id) | Unsplash licence |
| Training images | 45 | `datasets/{lebanese 19, khaleeji 14, moroccan 12}` | Audited in `datasets/LICENSING.csv` |

**Everything third-party is CC0**, and `public/ASSET-LICENSES.md` records attribution anyway
*"because a dissertation should say where its material came from."* It also records the
**rejected candidates** and the reasoning.

### ⭐ The texture colour maps are greyscale on purpose

three computes albedo as `material.color * map`. Every colour in `MATERIALS` comes from
`ontology.json`'s per-culture palette — Moroccan cobalt is `#0040c0` because the Moroccan
profile says *"cobalt Majorelle blue"*. **A full-colour photograph would replace that sourced
palette with whatever the texture was shot under.**

> **A greyscale multiply cannot move hue or saturation, only value: the palette survives and
> the surface gains grain.** The same property `backend/recolor.py` uses when it repaints a
> wall from a picked hue while keeping the value channel.

The roughness map is likewise **re-centred near 1.0**, because the authored scalars
(limestone 0.92, brass 0.32) are deliberate — *"the map says where a surface varies, not how
rough it is."* Both conversions are **baked by `scripts/fetch_design_assets.py`**, so nothing
corrects for them at runtime.

> **If a diagram shows an asset node, it must read "1 CC0 model + 14 CC0 texture sets" —
> never a "3D model library".**

---

## 5. Where the PNGs are used — and where they are forbidden

| Surface | Uses the PNG? |
|---|---|
| `CatalogDock` (Build Mode bottom rail) | ✅ **Yes — the only frontend use** |
| `FurniturePlacement` (Studio, 2D compositing) | ✅ Yes — via `backend/compositing.py` |
| **The Build Mode 3D scene** | ❌ **Never** |

> *"A billboarded photo among lit volumes reads as a sticker the moment the camera moves."*
> Build Mode renders procedural geometry instead — except `leb-ottoman-001`, which loads a
> real CC0 scan. → [09](09_BUILD_MODE_THREEJS.md) §1, §5b.

---

## 6. Two consumers, two very different jobs

```
                        ontology/furniture.json  (27 items)
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
   backend/furniture.py                        src/lib/design/catalog.ts
   items_for_culture()                         CATALOG, catalogItem(id), catalogFor()
              │                                           │
      ┌───────┴────────┐                     ┌────────────┴────────────┐
      ▼                ▼                     ▼                         ▼
 recommend()   catalogue_projection()   CatalogDock rail     geometry.buildObjectMesh()
 (ranking)     (the LLM's vocabulary)   (PNG cards)          (procedural 3D at real cm)
      │                                                              │
      ▼                                                              ▼
 backend/placement.py + compositing.py                    placement.ts SAT collision
 (2D image-space insertion into a render)                 (3D plan-space validation)
```

---

## 7. Recommendation ranking — `backend/furniture.py`

```python
MIN_RESULTS = 3
MAX_RESULTS = 9      # ⚠ CLAUDE.md says 6 — that is STALE
```

> **Correction:** the project's own `CLAUDE.md` states `MAX_RESULTS = 6`. The code reads
> **9**, with the comment that the cap was raised once a culture held 9 pieces *"because
> the cap was hiding a third of every culture."* `max_results()` is a function so the API
> reads it at call time.

**Scoring** (`recommend`), base `1.0`:

| Signal | Δ |
|---|---|
| Room-type match | **+2.0**, else −1.0 |
| Category already present in the room | **−1.5**, else +1.5 |
| Fits the free floor | **+1.0**, else **−3.0** |
| Per colour-tag hit | +0.5 |
| Per material-tag hit | +0.4 |
| Per mood-tag hit | +0.4 |

Sorted `(-score, id)`, then `limit = max(MIN_RESULTS, min(limit, MAX_RESULTS))`.
`_fits` requires `footprint_m² × 1.6 ≤ free_floor_m²` — headroom to walk.

**8 mood presets:** `warm, daylight, evening, luxury, cozy, minimal, traditional, modern`.
An unknown mood contributes nothing rather than erroring.

### ⚠ Categories must use the room analyser's spelling

`existing_categories` arrives in **ADE20K's vocabulary** via `ADE_TO_CATEGORY`, and the
recommender compares it to `category` by **string equality**. So a category the analyser
cannot name silently never de-duplicates.

**Five categories have no ADE class and therefore never take the duplicate penalty:**
`armchair`, `console`, `screen`, `lantern`, `cultural_object`.

*(ADE class 30 **is** an armchair but maps to `sofa`; remapping it would change how sofas
rank in every existing room, which is not worth the nuance.)*
**A test asserts that set is exactly those five**, so a mis-spelled new category is caught
rather than silently never matching.

### `normalize_room_type`
Allowlist against `known_room_types()`; `"living room"` / `"Living-Room"` → `"living_room"`;
unrecognised → `None`, **never passed through**.

> This is why `main.py` does **not** run `sanitize_prompt_fragment` on `room_type` — it
> would strip the underscores.

---

## 8. Asset aspect ratio — a documented discrepancy

```python
item_aspect(item)   # prefers the REAL PNG aspect (asset_aspect, lru_cache 64)
                    # over the catalogue's declared cm
```

> The comment records that the two **disagree by up to 65 %**, and that using the declared
> dimensions made composited furniture *look like it floats*.

**So there are two different notions of an item's size, each correct for its own job:**

| Purpose | Uses |
|---|---|
| 2D compositing into a render | **The PNG's own aspect** |
| 3D Build Mode geometry + collision | **The declared `real_*_cm`** |

---

## 9. Prompt-length ceiling — an enforced, measured limit

`<generation_prompt>, <trigger>, <STYLE_SUFFIX>` measures **91–99 CLIP tokens** for the
items that rendered correctly, so ~20 tokens are already being truncated — the tail is
quality boilerplate, which is survivable.

> **A *longer* prompt would push the framing instruction *"the entire object visible and
> centered"* off the end too — and a cropped asset composites into a room as a cut-off
> object.**

**The ceiling is therefore 99 tokens, enforced by a test.**

---

## 10. Compositing — `backend/compositing.py`

```python
ASSET_ROOT           = ROOT/"public"
SHADOW_HEIGHT_FRAC   = 0.16    SHADOW_WIDTH_FRAC = 0.92
SHADOW_BLUR_FRAC     = 0.06    SHADOW_MAX_ALPHA  = 105
TONE_MATCH_STRENGTH  = 0.55
```

`composite_item(base, item, box, analysis=None, with_shadow=True)`:
1. Resize the RGBA asset with `Image.LANCZOS`.
2. Sample the room's luminance and warmth in the target region (`_region_stats`).
3. Tone-match the asset to it (`_match_tone`, strength 0.55).
4. Alpha-composite a contact-shadow ellipse, then the item.

**The input image is never mutated.** `CompositeResult` carries `applied_brightness`,
`applied_warmth` and a `to_meta()` for provenance.

> **Placement is asset compositing, not inpainting** — so what the user positioned is
> *exactly* what lands. This is the opposite trade-off from Render with DAR, where the
> generator re-imagines surfaces inside a silhouette it is given.

---

## 11. Material assignment

| Path | Mechanism |
|---|---|
| Build Mode default | `defaultMaterialFor(item)` → `materialForTags(item.material_tags)` |
| User override | `Inspector` → `materialChoicesFor(item)` → `setMaterial` action |
| LLM plan | `materialKey` validated against 20 `MATERIAL_KEYS`; unknown → `null` → the item's own default |
| Generation prompt | `material_tags` + `color_tags` feed the recommender's scoring, and `generation_prompt` is the asset's own text |

**`"found"` is deliberately excluded from the planner's `MATERIAL_KEYS`** — it is the grey
reserved for objects DAR detected in the photograph, and a *planned* piece is not one of
those.

---

## 12. Semantic class assignment (for conditioning)

`src/lib/design/ade20k.ts` — **generated** from the backend's palette and class table,
never hand-edited.

```ts
ADE20K_PALETTE       // 150 RGB triples
CATEGORY_TO_ADE20K   // 24 mappings
ADE20K_WALL = 0   ADE20K_FLOOR = 3   ADE20K_CEILING = 5
ADE20K_DOOR = 14  ADE20K_WINDOW = 8
```

Every built mesh stamps `userData.ade`. An unmapped category falls back to the **`table`**
class rather than leaving a hole in the segmentation map.

→ [12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md)

---

## 13. Collision-box relationship

The collision rectangle is `{x, z, widthCm, depthCm, rotationDeg}` — **the footprint, not
the mesh.** `floor_footprint_cm` and `real_width/depth_cm` agree in the catalogue.

`heightCm` participates in collision **only** through the `LOW_PROFILE_CM = 40` exemption
(a pouf may sit under a console). Otherwise collision is strictly plan-view.

**There is no per-mesh collision geometry and no bounding-volume hierarchy.** With ≤ ~30
objects, an O(n) SAT sweep per drag frame is well within budget.

---

## 14. Caching

| Cache | Scope |
|---|---|
| `standardMaterial(key)` | Shared `MeshStandardMaterial` per key, protected from disposal |
| `asset_aspect` (backend) | `lru_cache(maxsize=64)` on PNG aspect ratios |
| `_by_id()` (planner) | Rebuilt per call — the catalogue is 27 items |
| Room analysis | LRU, `DARDESIGN_ROOM_CACHE` or 32 entries |

> **The 3D model cache is `modelLoader.protos`** — each `.glb` is fetched and parsed exactly
> once, and every placement is a `clone(true)` sharing its geometry and materials (marked
> `userData.sharedAsset` so disposal leaves them alone). Procedural geometry is rebuilt only
> when `geoSig` changes (category / origin / material / dimensions) — a move or rotate is a
> matrix write. → [09](09_BUILD_MODE_THREEJS.md) §4.

---

Related: [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md) ·
[08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md) ·
[09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md)
