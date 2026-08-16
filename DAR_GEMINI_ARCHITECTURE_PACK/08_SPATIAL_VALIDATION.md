# 08 — Spatial Validation (DAR's Deterministic Authority)

> **This document describes the part of DAR that contains NO AI.**
> Every rule here is ordinary geometry in TypeScript and Python. It is what makes the
> claim *"the LLM proposes, DAR decides"* true rather than rhetorical.

**Primary implementation:** `src/lib/design/placement.ts` (284 lines) — client, Build Mode.
**Secondary implementation:** `backend/placement.py` — server, image-space furniture
compositing (a different problem; see §9).

---

## 1. Coordinate system and units

| Property | Value |
|---|---|
| **Units** | **Centimetres, everywhere.** `1 THREE.js unit = 1 cm` |
| Origin | Centre of the floor |
| X | left (−) → right (+), from `−width/2` to `+width/2` |
| Z | far (−) → near (+), from `−depth/2` to `+depth/2`. **The far wall is `z = −depth/2`** |
| Y | up |
| `x`, `z` on an object | The **centre** of its footprint |
| `rotationDeg` | Turns the footprint clockwise seen from above. `0` leaves width along X |

**`DesignScene` is plain serializable JSON** — no class instances, no `THREE.*`, no
functions. That single constraint is what makes persistence, undo/redo and the render
hand-off the same problem.

---

## 2. Object dimensions come from the catalogue, never from a model

```
ontology/furniture.json          real_width_cm / real_height_cm / real_depth_cm
        │                        floor_footprint_cm: [w, d]
        ▼
src/lib/design/catalog.ts        catalogItem(id) → CatalogItem
        │                        (reads the JSON directly — no duplicated numbers)
        ▼
PlacedObject { widthCm, depthCm, heightCm, x, z, rotationDeg, materialKey,
               origin: "catalog" | "found", locked, uid }
```

> **Field-order trap documented in the code:** the raw JSON is `width, HEIGHT, depth`;
> `catalog.ts` exposes `width, depth, height`. **Read the keys, never the order.**

---

## 3. Collision — oriented rectangles, separating-axis test

**Not AABB.** The comment states why:

> *"Axis-aligned boxes would be cheaper, but a sofa rotated 30° into a corner is exactly
> the case where a planner has to be right, and AABB would refuse a placement that plainly
> fits."*

### `corners(r)` — the four corners in room space
```ts
a = rot * π/180
[(-hw,-hd), (hw,-hd), (hw,hd), (-hw,hd)]
  .map(([lx,lz]) => [ r.x + lx*cos(a) - lz*sin(a),
                      r.z + lx*sin(a) + lz*cos(a) ])
```

### `projectionOverlaps(a, b)` — SAT
For **both** polygons, for each edge:
1. Edge normal `(nx, nz) = ( -(z2 - z1), x2 - x1 )` — *not normalised; only sign and
   ordering matter.*
2. Project all 8 points of both rectangles onto it.
3. If `aMax ≤ bMin + 0.5` or `bMax ≤ aMin + 0.5` → **a separating axis exists → no overlap.**

Returns `true` only if **no** separating axis exists.

> **The `+0.5 cm` slack is deliberate**, so two pieces placed exactly edge-to-edge read as
> *adjacent* rather than *overlapping*.

### Everything is plan-view — with one exception
Two objects at different heights still collide, because you cannot stand a lamp inside a
sofa. The exception:

```ts
const LOW_PROFILE_CM = 40;
// if min(h1,h2) ≤ 40 && max(h1,h2) > 40  → skip the pair entirely
```
A rug under a table, a pouf tucked beneath a console.

---

## 4. Room bounds

```ts
insideRoom(r, shell)              // AABB of the oriented rect vs ±half extents, ±0.5 tol
distanceToNearestWall(r, shell)   // min(minX+hw, hw-maxX, minZ+hd, hd-maxZ)
WALL_TOLERANCE_CM = 22            // how close counts as "against the wall"
```

Bounds and wall distance use the cheaper `aabb()` — for these tests exactness matters less
than speed, and the AABB is conservative in the safe direction.

---

## 5. ⭐ The two-tier verdict — the central design decision

> **Conflating these two made the editor feel broken.**

```ts
evaluatePlacement(candidate, others, shell, opts, ignoreUid) → PlacementVerdict
```

| Tier | Meaning | Issues | Effect |
|---|---|---|---|
| **BLOCKING** | Physics the user cannot mean | `out-of-bounds` — outside the room<br>`overlaps` — inside a piece **the user placed** | **Refuses the drop.** `ok = false` |
| **ADVISORY** | Judgement, not physics | `replaces-existing` — over furniture the **photograph found**<br>`needs-wall` — a `must_touch_wall` piece standing free | **Stated in amber. Never refuses.** |

```ts
if (hitsPlaced)              blocking.push("overlaps");
if (hitsFound && !hitsPlaced) advisory.push("replaces-existing");
if (opts.mustTouchWall && !againstWall) advisory.push("needs-wall");
return { ok: blocking.length === 0, blocking, advisory, collidingWith, againstWall };
```

**Why `replaces-existing` is only advisory:** *replacing existing furniture is the most
likely act of redesign.* Refusing it would make DAR refuse the very thing the user came to
do.

> **One rule, three surfaces.** The renderer colours the drag ghost from this verdict, the
> Inspector explains it from this verdict, and the drop is refused from this verdict — so
> they cannot disagree.

---

## 6. Snapping — and why guides are drawn

```ts
SNAP_WALL_CM     = 26    // magnetic to walls
SNAP_ALIGN_CM    = 14    // to neighbours' centre-lines
SNAP_ROTATION_DEG = 15   // keyboard rotate step
```

**Wall snapping wins over alignment** — sitting flush to architecture matters more than
lining up with another sofa. Alignment only applies on axes the wall snap did not claim.

`snapPosition` returns `guides: Array<{axis, at, reason: "wall" | "align"}>` so the
renderer can show **why** the object jumped. *A snap you cannot see feels like a glitch.*

---

## 7. `findSpot` — deterministic auto-placement

Used when adding a catalogue item and as the **single repair attempt** for a rejected LLM
placement.

**Candidate generation:**
- If `mustTouchWall || preferredZones.includes("against_wall")`: walk all four walls,
  8 positions each, **rotation faces the piece into the room**.
- Always: 6 concentric rings spiralling out from the centre (radius `ring × 55` cm,
  `ring × 6` points).

**Two passes, in order:**
1. Demand `v.ok && v.advisory.length === 0` — a clean spot.
2. Only then accept advisories.

> This is why auto-placement will not drop a new sofa onto the photographed one *merely
> because it is legal*.

Returns `null` rather than a "least bad" answer.

---

## 8. Doors and windows — enforced, not requested

`WallOpening` already existed but only `DesignCanvas` ever saw it. It is now **threaded to
the planner as prompt facts *and* checked deterministically**:

```ts
DOOR_CLEAR_CM   = 90
WINDOW_CLEAR_CM = 40

openingZone(o, room)   // a keep-clear rectangle, derived exactly as
                       // scene3d.ts positions the opening on its wall
blockedOpening(rect, openings, room)  // → the opening it blocks, or null
```

> **Standing in a doorway is not a collision**, so the SAT engine has nothing to say about
> it. This is a separate, equally deterministic check.
>
> **It is advisory, not blocking** — standing near a door is judgement. A blocked opening
> gets a `findSpot` repair attempt, then is kept with a visible advisory.

With no handoff, `openings` is `[]` and the panel says *"No door or window detected"*
rather than implying knowledge. **Opening heights are constant priors (door 210 cm, window
140 cm) and are never presented as measured.**

---

## 9. `gatePlan` — where the LLM meets the wall

```ts
gatePlan(items, scene, openings) → { placements[], dropped[] }
```

**The critical detail: items are validated IN ORDER against a growing `working` array.**

```ts
const working: PlacedObject[] = [...scene.objects];
for (const [i, planned] of items.entries()) { … working.push(provisional(...)); }
```

> Validating all items against the empty room would let a plan overlap **itself**. The
> second piece is judged against the first.

**Per item:**
```
catalogItem(id)  →  missing? → dropped "Not a piece in DAR's catalogue."
snapPosition(...)
evaluatePlacement(...)        ← the SAME SAT engine a human drag uses
blockedOpening(...)
   │
   ├─ failed? → ONE findSpot() repair → re-evaluate both
   │
   ├─ still !verdict.ok → dropped "There was no room left for it."
   │
   └─ accepted → { x, z, rotationDeg, materialKey, reasons,
                   repaired, advisory[], blocksOpening }
```

**An unknown `materialKey` degrades to `null`** (the item's ontology default) rather than
failing the piece — *"the wrong wood is a smaller lie than a missing sofa."*

`gatePlan` is a **pure module**: no React, no THREE.

---

## 10. Catalogue and culture validation (backend, `validate_items`)

Deterministic, before anything reaches the client:

| Check | Rejection reason |
|---|---|
| `catalogId` not in the 27-item catalogue | `"not in the catalogue"` |
| `item.culture ≠ understood.culture` (and culture ≠ `"all"`) | `"{culture} piece in a {culture} room"` |
| `xCm`/`zCm`/`rotationDeg` not floats | `"coordinates were not numbers"` |
| not `math.isfinite` | `"coordinates were not finite"` |
| `|x| > half_w + 200` or `|z| > half_d + 200` | `"position is outside the room"` |
| `materialKey ∉ MATERIAL_KEYS` | silently → `None` (client uses the item's default) |
| more than `MAX_ITEMS = 12` | truncated |

The bound is deliberately **generous** (`+200 cm`) because *"the client re-checks the real
footprint against the real walls. This only throws out answers that are nonsense at a
glance."*

---

## 11. Circulation

Circulation is handled at **two different strengths**:

| Where | Mechanism | Strength |
|---|---|---|
| LLM system prompt | *"Leave walking room: at least 60 cm of clear floor to move through."* | **Soft** — an instruction, not enforced |
| `findSpot` ring spacing | 55 cm ring radius steps, 8 cm wall margin | Structural |
| Door keep-clear | 90 cm zone | **Deterministic, advisory** |
| Backend image-space placement | `WALKWAY_MARGIN = 0.25` | **Deterministic, blocking** (different subsystem — §12) |

> **Honest limitation:** there is **no global circulation-graph or path-finding check** in
> Build Mode. A layout that leaves no walkable route between two clusters would pass. The
> 60 cm rule is a prompt instruction only.

---

## 12. The *other* placement engine — `backend/placement.py`

Do not confuse these. They solve different problems.

| | `src/lib/design/placement.ts` | `backend/placement.py` |
|---|---|---|
| Space | **Room plan, centimetres** | **Image pixels**, 384² mask space ↔ render space |
| Purpose | Build Mode 3D editing | Compositing a cut-out PNG into a finished render |
| Test | Oriented-rect SAT | Mask overlap ratios + floor contact |
| Verdict | blocking / advisory | reason code + a score |

**`backend/placement.py` constants:**
```python
FLOOR_CONTACT_STRIP   = 0.18   MIN_FLOOR_CONTACT     = 0.6
MAX_OCCUPIED_OVERLAP  = 0.12   MAX_PROTECTED_OVERLAP = 0.02
WALKWAY_MARGIN        = 0.25   MIN_WIDTH_FRAC = 0.03  MAX_WIDTH_FRAC = 0.85
```

**Rejection order is deliberate and documented:** bounds → width fraction → **protected**
(person/door/window) → **occupied** → floor contact (`wall` if wall_ratio > 0.35, else
`no_floor`) → walkway.

**Score:**
```
1.2·available_space + 1.0·floor_contact + 0.8·depth_consistency
+ 0.8·perspective + 0.6·zone_fit − 2.0·occupied_ratio − 3.0·protected_ratio
```

**Size uses the horizontal scale factor for both width and height** — deliberately,
because `px_per_cm` is a horizontal measurement. The item's **base** (`box.y + box.h`) is
the anchor, because a floor-standing item is defined by where it touches the floor.

`candidate_positions` retries once with the anchor nudged up by 4 % then 8 % of the image
height, and returns `[]` rather than a "least bad" answer.

Bilingual `REASONS`: `outside, no_floor, wall, overlap, protected, too_large, too_small, ok`.

---

## 13. Undo/redo — why a 200-frame drag is one entry

`src/lib/design/store.ts`:

- **Snapshot-based**, not inverse commands. `withHistory` pushes the *pre-mutation* scene.
- **`beginGesture` / `endGesture`** — while a gesture is open, nothing is pushed. `beginGesture`
  is re-entrant-safe; `endGesture` skips the entry if the scene is referentially unchanged.
- `HISTORY_LIMIT = 60`.
- **Locked objects reject `move` and `rotate`** at the reducer level.
- **`duplicate` always produces `origin: "catalog", locked: false, confidence: undefined`** —
  a copy of a measurement is a design decision, not a measurement.
- **`resizeRoom` downgrades `provenance.shellSource` to `"default"`** — the chip stops
  claiming DAR measured it.
- **`replace` wipes undo/redo**, which is why an AI plan must never use it.
- `loadScene` **drops** any scene whose `version !== SCENE_VERSION (3)` rather than migrating.

---

## 14. What is deterministic vs what is AI — the summary table

| Concern | Deterministic | AI |
|---|---|---|
| Which objects are in the photo | | ✅ OneFormer |
| Their relative depth | | ✅ Depth Anything |
| Floor area estimate | ✅ mask arithmetic + assumed reference widths | |
| Room rectangle | ✅ `deriveRoom` (assumed aspect) | |
| Which pieces suit the brief | | ✅ LLM |
| Where a piece is *proposed* | | ✅ LLM |
| **Whether a piece MAY stand there** | ✅ **`evaluatePlacement` SAT** | |
| Whether it blocks a door | ✅ `blockedOpening` | |
| Repair of a bad placement | ✅ `findSpot` | |
| Piece dimensions | ✅ `furniture.json` | |
| Seat capacity | ✅ `seats_of` | |
| Collision, snapping, bounds, undo | ✅ | |
| The final photograph | | ✅ SDXL + ControlNet + LoRA |

---

Related: [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md) ·
[09_BUILD_MODE_THREEJS.md](09_BUILD_MODE_THREEJS.md) ·
[10_FURNITURE_AND_ASSETS.md](10_FURNITURE_AND_ASSETS.md)
