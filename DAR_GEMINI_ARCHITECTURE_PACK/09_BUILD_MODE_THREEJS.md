# 09 — Build Mode (three.js)

> ## ⚠ This document was corrected mid-audit
>
> Real CC0 3D assets and a GLTF loader **landed in commits `a4cec54` and `ab8d9b4` on
> 2026-08-14, while this pack was being written.** An earlier draft stated DAR contained
> zero 3D models. **That is no longer true**, and every affected document in this pack has
> been corrected.
>
> **The accurate statement is: 1 of 27 catalogue pieces is a real scanned model; the other
> 26 are procedural.** All three honesty tiers now genuinely exist — see §1.

**Route:** `/design` · **Entry:** `src/app/design/page.tsx` (609 lines) ·
**Renderer:** `src/lib/design/scene3d.ts` (`class DesignWorld`) ·
**Model loading:** `src/lib/design/modelLoader.ts` (145 lines) ·
**Registry:** `ontology/furniture_models.json` ·
**three.js:** `^0.150.0`, used directly (no react-three-fiber), with
`GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`.

---

## 1. ⭐ Honesty tiers — how a thing on screen is allowed to look

**All three tiers are implemented, and the tier is surfaced in the product UI**, not just in
a config file. The vocabulary is defined in `ontology/furniture_models.json::_tiers`.

| Tier | Count | What it means | Definition (quoted from the registry) |
|---|---|---|---|
| **REAL MODEL** | **1 / 27** | The object on screen **is** the scanned asset named in `assetName`, normalised to the catalogue dimensions | *"Never claimed to be the exact catalogue piece — the inspector names the asset itself."* |
| **ENHANCED PROCEDURAL** | **26 / 27** | Authored geometry: real silhouette, legs, arms, cushions and ornament | *"generated — not a scan of a real object"* |
| **FALLBACK MASSING** | found objects | The abstract translucent volume for furniture read off the user's **photograph** | *"DAR knows a footprint and a class but not a form. Deliberately not detailed: inventing the shape of the user's own sofa would be a fabrication."* |

### The one real model

| | |
|---|---|
| Catalogue id | `leb-ottoman-001` |
| Asset | **Ottoman 01** — `public/models/Ottoman_01.glb`, 651 KB |
| Author / source | Caspian Fortune · [Poly Haven](https://polyhaven.com/a/Ottoman_01) |
| Licence | **CC0-1.0** |
| Fit | `contain` — uniformly scaled inside the catalogue's 55 × 42 × 55 cm box |
| Honesty note | DAR's catalogue art for this piece shows **turned wooden legs where the scan has block feet**, *"which is why the inspector names the asset rather than implying it is the catalogue piece"* |

### ⭐ Why only one — the defensible answer

Quoted from `furniture_models.json::_why_so_few_real`:

> *"There is no CC0 library of Lebanese, Khaleeji or Moroccan furniture. Around twenty
> candidate scans were inspected side by side against DAR's catalogue art; **all but one
> were rejected as culturally wrong.** DAR's own LoRA-generated catalogue art is more
> culturally specific than anything available under CC0, so culturally-specific pieces are
> authored geometry instead. Adding a real model later is one entry in `models` below — no
> code change."*

And from `public/ASSET-LICENSES.md`:

> *"Rather than dress a Western or Chinese scan up as an Arab piece, only objects that
> honestly are what they represent are used here."*

> **This is a stronger position than either extreme.** It is not "we could not find models";
> it is *"we looked at twenty, and nineteen would have been a cultural misrepresentation."*

### The registry is a sidecar, deliberately

`ontology/furniture_models.json` is keyed by catalogue id and sits **beside**
`furniture.json` rather than adding fields to it, because that file *"is the shared
frontend/backend source of truth and ~20 pytest cases pin its schema, so extending it to
carry a frontend rendering concern would couple two things that have no reason to move
together."*

> **The distinction is load-bearing.** `buildObjectMesh` falls through to `buildFound()` for
> an unknown category — so a piece the *user chose* would render as a *survey volume*,
> which looks like a bug **and weakens the segmentation the renderer is conditioned on**.
>
> This shipped broken for **9 of 27 items** (every `armchair`, `console`, `cabinet` and
> `screen`) until 2026-08-14. The test
> `test_every_catalogue_category_has_a_shape_builder` parses the `BUILDERS` map out of the
> TypeScript source and compares it to `furniture.json`, so adding a category without a
> builder now fails CI.

---

## 2. The room arrives already understood

Build Mode **does not open on an empty grid** — that is the whole point.

```
Studio result  ──sessionStorage["dar-build-handoff"]──▶  /design
        │
        ▼  roomModel.deriveRoom(result, culture)
   RoomShell   { widthCm, depthCm, heightCm: 300, areaM2, scaleConfidence,
                 floorMaterialKey, wallMaterialKey }
   objects[]   found massing from object_map — LOCKED
   openings[]  doors/windows pinned to the nearest wall
   shellSource "measured" | "estimated" | "default"   ← the header chip says which
```

**A saved scene wins for objects — but openings are ALWAYS re-derived**, because *"they
belong to the photograph, not to the user's edits."*

**Found objects are locked by default.** They describe the room as it is, so moving one
silently turns a measurement into a fiction. The `N found` chip is also the layer toggle —
**hiding never changes collision.**

→ [04_ROOM_UNDERSTANDING.md](04_ROOM_UNDERSTANDING.md)

---

## 3. `DesignWorld` — the renderer

**Public API** (`scene3d.ts`):
```ts
buildShell(scene, openings)         syncObjects(objects)      setFoundVisible(bool)
setGhost(o, tone: "ok"|"advisory"|"blocked")                  setGuides(guides)
pickObject(x, y)                    pickFloor(x, y)
orbit(dx, dy)  zoom(d)  pan(dx, dy) setView(preset)  frameRoom()  focusOn(uid)
resize(w, h)
renderConditioning(width, height) → { depth, seg, beauty, meta{width,height,near,far,fov} }
```

`protectSharedMaterials(keys)` marks the shared material-cache instances so
`disposeObject` leaves them alone.

### Scene graph
```
scene
├── shellGroup     plinth, floor, grid, 4 walls, 4 skirtings, openings, (capture ceiling)
├── objectGroup    one THREE.Group per PlacedObject, keyed by uid
├── helperGroup    selection cage + selection ring
└── guideGroup     snap guides
```

### Camera
- **Editor camera:** `PerspectiveCamera(fov 38, near 10, far 8000)` — an orbit rig outside
  the room, ~30° above horizontal.
- **Capture camera:** **built fresh, deliberately NOT the editor camera.** See §7.

### Wall culling
`cullWalls()` fades the near walls **in place, every frame, on the material itself**, so the
user can see into the room. This is precisely why the capture pass has to force them back
to opaque — see §7.

---

## 4. Rendering loop and performance architecture

`DesignCanvas` owns the `DesignWorld` and translates gestures into store actions. The 3D
world **decides nothing**.

### Two performance mechanisms that matter architecturally

**a) Shell rebuild is keyed on the fields `buildShell` actually reads.**
```ts
useEffect(() => { worldRef.current?.buildShell(scene, openings); },
  [ scene.room.widthCm, scene.room.depthCm, scene.room.heightCm,
    scene.room.floorMaterialKey, scene.room.wallMaterialKey,
    scene.culture, openings ]);
```
`scene` itself used to be in that dependency list, and **the reducer returns a fresh scene
object for every action** — so the plinth, floor, grid, four walls, four skirtings and
every opening were torn down and rebuilt on **each dispatch**, i.e. once per `pointermove`
for the whole of a drag.

**b) `syncObjects` splits geometry identity from transform.**
```ts
geoSig   = `${category}|${origin}|${materialKey}|${w}|${d}|${h}`   // rebuild
xformSig = `${x}|${z}|${rotationDeg}|${locked}`                    // matrix write only
```
Moving a sofa one centimetre used to dispose and rebuild every box it is made of, once per
`pointermove`. Position and rotation are now a matrix write.

**c) Disposal covers Lines and Points, not only Meshes.** The grid, the selection cage,
the snap guides and every found-object wireframe own geometry and materials exactly as
meshes do. `disposeUnshared` also releases any texture maps a material owns, which a bare
`dispose()` does not.

*Note: mechanisms (a), (b) and (c) are present as **uncommitted working-tree changes** at
the time of this audit. See [25_IMPLEMENTED_VS_PLANNED.md](25_IMPLEMENTED_VS_PLANNED.md) §4.*

---

## 5. Procedural furniture geometry — `src/lib/design/geometry.ts`

*This covers 26 of the 27 catalogue pieces. For the one real model, see §5b.*

**`BUILDERS` — 12 keys, exactly the 12 categories `furniture.json` ships:**

| Builder | Categories |
|---|---|
| `buildSofa` · `buildChair` · `buildArmchair` · `buildOttoman` | seating |
| `buildTable` · `buildSideTable` | tables |
| `buildCabinet` · `buildConsole` · `buildScreen` | storage / partition |
| `buildLamp` · `buildLantern` | lighting |
| `buildObject` | `cultural_object` |
| *`buildFound`* | **not in the map** — the fallback for unknown categories and found massing |

`BUILT_CATEGORIES = Object.keys(BUILDERS)`, pinned against `furniture.json` by a test.

**Construction:** all shapes are THREE primitives sized from the object's real cm,
assembled with `softBox()` — a cheap chamfer that pulls corner vertices in along their own
normal. `standardMaterial(key)` is a **keyed shared cache**, so twenty objects using
`linen` share one `MeshStandardMaterial`.

**Every mesh is stamped:**
```ts
mesh.userData.ade = CATEGORY_TO_ADE20K[category] ?? ADE20K_TABLE   // segmentation class
mesh.userData.uid = o.uid                                          // picking
```
The fallback to the `table` class is deliberate — *a hole in the segmentation map is worse
than a near-miss class.*

**Found objects** get their materials **cloned** (not shared) and set to
`opacity: 0.3, depthWrite: false, castShadow: false`.

### Why 26 of 27 are procedural rather than scanned

1. **No CC0 library of Arab furniture exists.** ~20 candidate scans were inspected against
   DAR's catalogue art; **all but one were rejected as culturally wrong.** Dressing a
   Western or Chinese scan up as an Arab piece would be a cultural misrepresentation.
2. **DAR's own LoRA-generated catalogue art is more culturally specific than anything
   available under CC0**, so culturally-specific pieces are authored geometry instead.
3. **Cut-out PNGs would be stickers.** A billboarded photo among lit volumes reads as a
   sticker the moment the camera moves. The 27 catalogue PNGs appear in `CatalogDock` and
   **nowhere else in 3D**.
4. **Conditioning fidelity.** What the renderer needs from the scene is *silhouette,
   position, orientation and semantic class* — all of which a correctly-sized procedural
   volume supplies as well as a detailed mesh would.
5. **DAR never implies it rendered something it did not.** The final photorealism comes
   from SDXL, not from the editor.

> **Adding a real model later is one entry in `furniture_models.json` — no code change.**

---

## 5b. ⭐ Real-model loading — `src/lib/design/modelLoader.ts`

**Two rules, both described in the source as load-bearing.**

### Rule 1 — the visual may never outgrow the collision box

`placement.ts` collides an oriented rectangle derived from the **catalogue's own
width/depth**, and the inspector, the plan minimap and the planner all quote those numbers.
So a model is scaled **uniformly** to sit inside its declared box — `contain`, never a
per-axis stretch.

```ts
const s = Math.min(w / size.x, h / size.y, d / size.z);   // uniform "contain"
```

> *"A beautiful model with a wrong footprint is worse than a box with a right one."*

A per-axis stretch would misreport the piece's proportions, and a looser fit would let a
corner poke through a wall **the validator says it clears**.

**glTF is metres and Y-up.** The fit is derived from the **measured bounding box**, not a
unit assumption, so the source's scale never has to be trusted. The model is then
re-measured *after* scaling — a model whose pivot is not at its centre (most scans) needs
the real post-scale bounds — and seated with its footprint centred on the group origin,
**the same convention every procedural builder uses**, so selection cages, ghosts, rotation
and the capture camera's occupancy test all keep working unchanged.

### Rule 2 — nothing unclassified may reach the segmentation pass

Loading is **async**; `buildObjectMesh` is **not**. If a mesh simply appeared in the group
whenever the network finished, it would arrive **without `userData.ade`** — and
`renderConditioning` hides every drawable that has no class.

> **A piece could silently vanish from the ControlNet conditioning, which reads to the
> generator as "no object here".**

So the swap **re-stamps the whole subtree** through the same helper `buildObjectMesh` uses,
and **a procedural stand-in is on screen from the first frame regardless.**

### Sharing and disposal

Prototypes are cached by URL (`protos: Map<string, Promise<THREE.Group>>`) and fetched and
parsed **exactly once**; every placement is a `clone(true)` that **shares geometry and
materials** — which is what makes a second ottoman free.

That sharing is also a disposal hazard: `disposeObject` would, on removing one instance,
free the geometry every other instance is still drawing with. `markShared()` stamps
`userData.sharedAsset = true` across the subtree so disposal leaves them alone.

The `GLTFLoader` is constructed **lazily** — `/design` is a client component, but the module
graph is still evaluated during the server build.

### The honesty chip has a number behind it

```ts
fitReport(proto, w, h, d) → { fill, scale }
```

`fill` is how much of its declared footprint the fitted model actually occupies, *"surfaced
so the honesty chip can say a piece is drawn smaller than the footprint it reserves rather
than leaving that for someone to notice."*

---

## 5c. PBR textures and procedural ornament

**14 CC0 texture sets (42 files) from [ambientCG](https://ambientcg.com/)**, downsampled to
512 px JPEG: `limestone · tadelakt · gypsum · sand · marble · cedar · walnut · linen ·
velvet · leather · wool · brass · agedBrass · iron`.

### ⭐ The colour map is greyscale on purpose

Every colour in `MATERIALS` comes from `ontology/ontology.json`'s per-culture palette —
Moroccan cobalt is `#0040c0` because the Moroccan profile says *"cobalt Majorelle blue"*.
three computes albedo as `material.color * map`, so **a full-colour photograph would replace
that sourced palette with whatever the texture was shot under.**

> **A greyscale multiply cannot move hue or saturation, only value: the palette survives and
> the surface gains grain.**
>
> *This is the same property `backend/recolor.py` uses when it repaints a wall from a picked
> hue while keeping the value channel.*

The **roughness map is re-centred near 1.0** for the same reason: three computes roughness
as `material.roughness * roughnessMap.g`, and the authored scalars (limestone 0.92, brass
0.32) are deliberate. *"The map says where a surface varies, not how rough it is."*
Both conversions are **baked by the fetch script**, so nothing corrects for them at runtime.

### Patterns are drawn, not downloaded

`src/lib/design/patterns.ts` generates the cultures' geometric ornament procedurally:

> *"The patterned surfaces of these three cultures are geometric constructions, not
> photographs, so they are DRAWN rather than downloaded. That is not a compromise: zellige
> really is a compass-and-straightedge tessellation, and generating it means the cobalt is
> the ontology's own cobalt, the tile size is a real tile size, and there is no licence
> attached to any of it."*

The precedent is the landing page, which draws its act materials as inline-SVG tessellations
after a `repeating-linear-gradient` rug read as a barcode and a 46 px `conic-gradient` read
as harlequin argyle. **Same lesson: a pattern has to be constructed the way the craft
constructs it, or it reads as wallpaper.**

*`textures.ts` and `patterns.ts` were committed in `2380fa8` during this audit.*

---

## 6. Materials, lighting, culture switching

**22 material keys** in `materials.ts`, every hex sourced from `ontology.json`'s own
`color_palette`, each carrying a `source` string surfaced in the Inspector.

**Culture switching** changes the shell defaults (`SHELL_MATERIALS`) and the accent
(`CULTURE_ACCENT`), and re-filters the catalogue rail. It dispatches `setCulture` →
`replace`, which **wipes undo history** — which is exactly why an AI plan must never
change the culture (see [06](06_LLM_DESIGN_PLANNER.md) §9).

**Lighting** is set up by `setupLights()` — a fixed studio rig.

> **There is no time-of-day system and no sun position control in Build Mode.** A
> day/night module exists at `src/components/dar/UnderstoodRoom/daynight.ts`, but that is
> the separate `/v2` "Understood Room" experience, **not** Build Mode.
> Do not diagram time-of-day as a Build Mode feature.

---

## 7. ⭐ `renderConditioning` — the capture that feeds the generator

Three offscreen passes at a caller-chosen size (`HandoffPanel` uses 1024 × 768):

| Pass | Purpose | Colour handling |
|---|---|---|
| **beauty** | Shown to the user as evidence | sRGB-encoded via a 256-entry LUT (the real piecewise transfer, not a 1/2.2 approximation) |
| **depth** | ControlNet depth conditioning | `NoToneMapping` + `LinearEncoding` — raw linear bytes |
| **seg** | ControlNet segmentation conditioning | `NoToneMapping` + `LinearEncoding` — exact ADE20K palette colours |

### The capture camera is rebuilt, not cloned — and this was the root cause of a real failure

The capture used to clone the on-screen orbit camera: **outside the room, ~30° above
horizontal, 38° FOV**. SDXL and both ControlNets were trained on **interior photographs
made from inside rooms at eye height with a wide lens**, so every capture handed them a
viewpoint no camera could occupy. The first real GPU render of a Khaleeji majlis came back
reading as *a wooden-screen storage room*.

```ts
CAPTURE_EYE_Y          = 155   // cm — eye height
CAPTURE_FOV_DEG        = 54    // ≈ a 24 mm interior lens
CAPTURE_WALL_CLEARANCE = 45    // cm — stand-off from the back wall
CAPTURE_BODY_CM        = 55    // clearance the lens needs from any object
```

It keeps **only the user's azimuth** — the part that carries which way they were facing.
The editor camera is untouched.

**Two consequences followed from being inside:**

1. **All four walls stay.** The exterior camera had to hide the walls it looked through, so
   the generator got a room with holes where its corners belonged. From inside, the near
   wall is simply behind the lens and the frame closes itself.
2. **A capture-only ceiling** is added in the real `ADE20K_CEILING` class, because an open
   top reads as *sky* from inside.

**And the camera walks in.** A fixed stand-off works in an empty room and fails in a
furnished one — with a planned majlis the seating runs along the very wall the lens backs
onto, and one slatted screen filled the whole frame. The capture now walks in from the wall
and stops at the first position clear of every object's world bounds by `CAPTURE_BODY_CM`,
falling back to the old position if the room is too full.

### Four capture-state bugs, all found by *measuring the pixels*

| Bug | Symptom | Fix |
|---|---|---|
| ACES tone mapping shifted the palette | wall `120 → 129`, lamp `(224,255,8) → (187,189,40)` | force `NoToneMapping` + `LinearEncoding` for both data passes |
| Camera-facing walls, faded on screen, rendered **opaque** in capture | walled off the room | *(that was the exterior camera; now solved by being inside)* |
| `cullWalls()` fade was never undone for the capture | two walls at `opacity 0.045`, skirtings and reveals **switched off entirely** | force every wall solid for the capture, restore afterwards |
| `unclassified` test used `instanceof THREE.Mesh` | every found object's `LineSegments` wireframe blended half-transparent grey-brown over the palette along its silhouette — **an off-palette colour is not a near-miss class to the seg ControlNet, it is no class at all** | test `isMesh \|\| isLine \|\| isPoints \|\| isSprite` — *"does it draw?"* rather than *"is it a mesh?"* |
| Seg pass left the clear colour at opaque black | after one render the canvas — created with `alpha: true` so the CSS backdrop shows through — cleared to solid black for the rest of the session | save and restore `getClearColor` / `getClearAlpha` |

`this.scene.background = null` is set explicitly during capture: nothing sets a background
today, but a future sky must never reach conditioning.

**Maquette framing was also fixed:** the original framing left **~42 %** of the frame empty
— i.e. 42 % of pixels SDXL would invent. Now **~16 %**.

---

## 8. Interaction model

| Gesture | Action |
|---|---|
| Drag empty space | Orbit |
| Drag an object | Move on the floor plane (with live ghost + snap guides) |
| Wheel | Zoom |
| Middle-drag / Space-drag / Shift-drag | Pan |
| Click | Select (`pickObject` raycast) |
| **`Ctrl/Cmd+Z`** / `+Shift` / `Ctrl+Y` | Undo / redo |
| `Ctrl+D` | Duplicate |
| `Del` / `Backspace` | Remove |
| `R` / `Shift+R` | Rotate ± `SNAP_ROTATION_DEG` (15°) |
| `F` | Focus on selection |
| Arrows | Nudge 10 cm (1 cm with Shift) |
| `Esc` | Deselect |

**The drag ghost is coloured directly from `evaluatePlacement`** — `ok` / `advisory` /
`blocked` — so the collision engine, the Inspector's explanation and the drop refusal
cannot disagree. → [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md)

---

## 9. Persistence

```
localStorage["dar-scene-v3:<jobId ?? 'sandbox'>"]   debounced 600 ms
SCENE_VERSION = 3        loadScene DROPS a mismatched version rather than migrating
HISTORY_LIMIT = 60       snapshot undo/redo with gesture coalescing
```

---

## 10. What must never be claimed about Build Mode

- ❌ "Build Mode uses real 3D furniture models." → **Exactly one of 27 catalogue pieces is a
  real scanned model** (`leb-ottoman-001`). The other 26 are authored procedural geometry.
- ❌ "Build Mode has no 3D models at all." → **Also wrong since 2026-08-14.** State the
  ratio: **1 real, 26 procedural, plus fallback massing for photographed objects.**
- ❌ "The ottoman on screen is DAR's catalogue ottoman." → It is the **Ottoman 01** scan
  from Poly Haven, fitted to the catalogue box. **DAR's own art shows turned wooden legs
  where the scan has block feet** — which is why the inspector names the asset.
- ❌ "Build Mode has realistic rendering." → One scanned piece and 26 procedural ones is a
  deliberately abstract maquette. The photorealism comes from SDXL afterwards.
- ❌ "Build Mode has time-of-day / sun simulation." → That is `/v2` (`UnderstoodRoom`), a
  different feature.
- ❌ "DAR measured the room you are editing." → Only if the chip says `measured`, and even
  then only the *area* was estimated. See [04](04_ROOM_UNDERSTANDING.md).
- ❌ "Found objects are accurate furniture." → They are abstract massing from a
  photograph, with prior heights and capped footprints, and are labelled
  *"From your photo · approximate"* in the Inspector.

---

Related: [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md) ·
[10_FURNITURE_AND_ASSETS.md](10_FURNITURE_AND_ASSETS.md) ·
[11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md) ·
[12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md)
