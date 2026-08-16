# 06 — LLM Design Planner

> **The defense statement, and the code supports it exactly:**
>
> ## The LLM proposes the design. DAR remains the spatial authority.

---

## 1. Component map

### Component: **DAR Design Planner** (dual-provider LLM)

**Implementation:**
- `backend/design_planner.py` (931 lines) — schema, prompt, providers, validation, fallback
- `backend/main.py` — `POST /api/design/plan`, `GET /api/design/planner-status`
- `src/lib/design/planner.ts` (252 lines) — `gatePlan()`, the client trust gate
- `src/components/design/PlanPanel.tsx` (352 lines) — the UI
- `src/lib/api.ts` — `planLayout()`, `fetchPlannerStatus()`
- `ontology/furniture.json` — the closed vocabulary
- `tests/test_design_planner.py` — 25 tests, **no live API calls**

**Input:** natural-language brief + room rectangle + current culture + objects DAR
detected in the photograph + detected wall openings + `shellSource` provenance.

**Output:** a validated `{understood, items[], seatingEstimate, placedCounts, notesEn,
notesAr, source, model, provider, rejected[]}`.

**Deterministic checks:** JSON-Schema enum (provider-enforced) → backend
`validate_items()` + `validate_understood()` → client `gatePlan()` → `evaluatePlacement()`
SAT collision → `blockedOpening()` → `findSpot()` repair.

---

## 2. ⚠ Provider: this is a DUAL-provider planner

This is the single most commonly mis-stated fact about DAR. Both are implemented; the
active one depends on configuration.

| | Anthropic path | Gemini path |
|---|---|---|
| Default model | `claude-sonnet-5` (`DEFAULT_MODEL`) | `gemini-3.5-flash` (`DEFAULT_GEMINI_MODEL`) |
| SDK | `anthropic==0.121.0` | `google-genai==2.17.0` |
| API key env | `ANTHROPIC_API_KEY` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Structured output | `output_config={"format": {"type":"json_schema","schema":…}, "effort":"low"}` | `config={"response_mime_type":"application/json","response_schema": gemini_schema(…)}` |
| Max output tokens | `MAX_OUTPUT_TOKENS = 2000` | `MAX_OUTPUT_TOKENS_GEMINI = 12000` |
| Call function | `_call_anthropic` | `_call_gemini` |

**Selection logic (`provider()`):**
```python
forced = os.environ.get("DARDESIGN_LLM_PROVIDER", "").lower()
if forced == "gemini":    return "gemini"    if _gemini_key()    else None
if forced == "anthropic": return "anthropic" if _anthropic_key() else None
if _anthropic_key(): return "anthropic"   # preferred: the schema was written against it
if _gemini_key():    return "gemini"
return None                                # → rule-based plans
```

### The live, currently-configured provider

Queried from the running backend during this audit — **authoritative, and not a secret**:

```
GET http://localhost:8000/api/design/planner-status
→ {"configured": true, "model": "gemini-3.5-flash", "provider": "gemini"}
```

> **So: the code's default preference is Anthropic, but the system as currently deployed
> on the developer's machine runs on Gemini 3.5 Flash.** Both statements are true and
> both belong in a diagram legend. If the diagram must name one, name **Gemini 3.5 Flash**
> and note that the planner is provider-agnostic.

**Why the `DARDESIGN_LLM_PROVIDER` override exists** (from the docstring): a machine-wide
`ANTHROPIC_API_KEY` silently outranks a project's own `.dardesign-llm`; the planner then
advertises a model it cannot reach, fails on every call, and degrades to rules *while
claiming to be an AI planner*. Naming the provider is the cure.

**Why Gemini's max-output is 6× larger:** Gemini 3.x counts its thinking tokens against
`max_output_tokens`. Measured on a real plan: ~5k thinking tokens before ~1.1k of JSON, so
the 2k that is ample for Anthropic truncated the response mid-object and the plan silently
degraded to rules.

**Why not `gemini-2.5-flash`:** it is still listed by `models.list()` but returns 404
*"no longer available to new users"* on a freshly issued key.

**Configuration file:** `.dardesign-llm` (gitignored; template `.dardesign-llm.example`),
loaded by `scripts/run-local-backend.ps1` exactly like `.dardesign-smtp`.
**No key value was read or is reproduced anywhere in this pack.**

---

## 3. The trace: natural language → a room

```
USER TYPES A BRIEF
  "a majlis for eight people, keep the centre open, warm beige walls"
        │
        ▼  PlanPanel.tsx
POST /api/design/plan          → DATA_API_URL, behind _require_user
        │                        (the key lives on a machine the user controls,
        │                         never on a throwaway Kaggle GPU container)
        ▼  main.py validation
   culture ∈ CORE_STYLES ∪ {"all"};  100 ≤ width,depth ≤ 2000 cm
        │
        ▼  design_planner.plan()
   cache lookup: sha256(room + culture + normalised brief + existing + openings)
        │  hit → return (a repeated demo is free)
        ▼
   ONE model call — build_user_message() + _SYSTEM
        │  room rectangle & coordinate frame
        │  shellSource caveat ("these are DAR's default dimensions — do not
        │                       claim to know the real room")
        │  catalogue_projection("all")  ← all 27 pieces, ids + real cm only
        │  existing found objects
        │  detected openings (or "DAR has not detected any door or window,
        │                     so do not reason about where they are")
        │  the brief
        ▼
   ONE response: { understood, items[], notesEn, notesAr }
        │
        ▼  GATE 3 — backend
   validate_understood(...)   every field forced into a real DAR vocabulary
   validate_items(...)        → (accepted[], rejected[] with reasons)
        │
        ▼  HTTP
   DesignPlan { understood, items, seatingEstimate, placedCounts,
                notes, source: "llm"|"rules", model, provider, rejected }
        │
        ▼  GATE 4 — client, planner.ts
   gatePlan(items, scene, openings)
        │   per item, IN ORDER, against the scene AS IT IS BEING BUILT:
        │     snapPosition → evaluatePlacement (SAT) → blockedOpening
        │     on failure: ONE findSpot() repair, then re-evaluate
        │     still blocking → dropped, with a bilingual reason
        ▼
   {placements[], dropped[]}
        │
        ▼  design/page.tsx
   beginGesture → N × addAt → endGesture      ← NEVER `replace`
        │
        ▼
   FURNITURE APPEARS IN BUILD MODE — one Ctrl+Z removes the whole plan
```

---

## 4. The model also *reads the brief* — the `understood` block

There is deliberately **no separate "interpret, then plan" round trip** — it would double
latency and cost for information the one response already carries.

| Field | Validated against | On an unknown value |
|---|---|---|
| `culture` | `PLAN_CULTURES = (lebanese, khaleeji, moroccan, all)` | falls back to the room's own culture |
| `roomType` | **`prompt_builder.py`'s own `room_ar_map` keys** | `"living room"` |
| `capacity` | integer `1..40` | `null` |
| `intensity` | float clamped `0..1` — **the same clamp `/restyle` applies to `scale`** | `null` |
| `wallMaterialKey` | `materials.ts` `WALL_CHOICES` | `null` |
| `floorMaterialKey` | `materials.ts` `FLOOR_CHOICES` | `null` |
| `requirements` | ≤6 strings, ≤90 chars each | `[]` |
| `requestedFurniture` | `REQUESTABLE_CATEGORIES`, count `1..12`, ≤8 entries | dropped |
| `conceptEn`/`conceptAr` | free text, truncated to 200 | `""` |

> **Every one of these vocabularies is somebody else's existing list, quoted rather than
> invented.** That is what keeps the interpretation grounded: the model may only say
> things the rest of DAR can already act on.
>
> **`null` always means "not said — leave the room alone."** An unknown value becomes
> `null`, never a plausible guess.

---

## 5. The six gates — where a hallucination dies

| # | Gate | Where | Mechanism |
|---|---|---|---|
| **1** | **Closed vocabulary** | `plan_schema()` | `catalogId` is a JSON-Schema **`enum`** of exactly the catalogue's ids. Structured outputs make `"leb-chandelier-009"` **unrepresentable**, not merely unlikely. Enforced by *both* providers — `gemini_schema()` preserves the enum while translating the rest. |
| **2** | **No invented dimensions** | `plan_schema()` | The schema has **no size fields at all**. Width/depth/height come from `ontology/furniture.json` via `catalogItem(id)`. |
| **3** | **Backend validation** | `validate_items()` | Unknown id / non-finite or absurd coordinate / unknown material → **dropped AND reported**, never quietly rounded into something plausible. |
| **4** | **Client re-validation** | `gatePlan()` → `evaluatePlacement()` | The *same* oriented-rect SAT engine that colours a human's drag ghost and refuses a human's drop. **This is the gate that actually protects the scene.** |
| **5** | **Culture coherence** | `validate_items()` | The model sees all 27 pieces (it cannot know the culture before reading the brief), so it can also *mix* them. Any item whose culture ≠ `understood.culture` is dropped **and named**. One room, one culture — unless "all" was asked for. |
| **6** | **Openings** | `gatePlan()` → `blockedOpening()` | A door gets a **90 cm** keep-clear zone, a window **40 cm**, derived exactly as `scene3d.ts` positions the opening. |

**Gate 3 gives different, true reasons rather than one generic one:**
```python
if item is None:                    "not in the catalogue"
elif item.culture != culture:       f"{item.culture} piece in a {culture} room"
elif coords not numbers:            "coordinates were not numbers"
elif not finite:                    "coordinates were not finite"
elif |x| > half_w + 200:            "position is outside the room"
```

**Advisory verdicts still pass (gates 4 and 6).** Standing a sofa where the photograph
found the old one — or near a door — is *judgement*, not physics. It is stated in amber,
never refused. Replacing existing furniture is the most likely act of redesign.

---

## 6. Capacity is DAR's arithmetic, not the model's claim

The ontology has **no seat counts** — this was checked. So DAR derives them:

```python
SEAT_CM = 60.0
def seats_of(item):
    if item.category == "sofa":                        return max(1, int(width // 60))
    if item.category in ("armchair","chair","ottoman"): return 1
    return 0
```

The panel prints *"Seats about 6"* — **labelled as an estimate**. When the plan falls short
of a requested capacity it says so (*"· 6 asked for"*) instead of quietly claiming success.

---

## 7. Unconfigured is a working mode

With **no API key**, a **provider error**, or the **per-process call cap** reached,
`fallback_plan()` returns a deterministic rule-based layout tagged `source: "rules"`, and
the UI badge says **"Planned by DAR's rules"** instead of naming a model.

`fallback_plan` places: an anchor sofa against the far wall → a coffee table 45 cm in
front → an armchair rotated 90° toward it → a side table beside the armchair → an ottoman
opposite → a lamp in a corner → storage on the near wall. Anything it gets slightly wrong
is repaired by the **same** client placement engine that repairs the model's answers.

`_rule_result()` still emits an `understood` block so the UI has **one contract rather than
two** — but it claims only what rules can honestly know: the room's own culture, a living
room, **no capacity, no intensity, no colour change**.

> **This is not theoretical.** The docstring records that it was first exercised against a
> real `400 credit balance too low` — and the user still got a furnished room. **CI and the
> tests run this path, so the feature is never dark.**

---

## 8. Cost and caching

| Fact | Value |
|---|---|
| Catalogue sent | 27 items via `catalogue_projection()` — **not** `furniture.json` wholesale (9.4k tokens) |
| Typical call | ~1k tokens in / ~1.5k out |
| Approx cost (Anthropic path) | ~$0.02 on `claude-sonnet-5` |
| Gemini path | Free tier |
| Response cache | In-process, keyed `sha256(room + culture + normalised brief + existing + openings)` — a repeated demo is free |
| Runaway bound | `MAX_CALLS_PER_PROCESS = 200`, reset on restart |

> **Prompt caching is deliberately unused.** The minimum cacheable prefix is 1024 tokens on
> Sonnet 5 and 4096 on Haiku 4.5, so a prompt this small would silently fail to cache and
> pay the write premium for nothing.

**The cache key includes `existing` and `openings`.** The first version keyed on
room + culture + brief alone, which meant *moving the furniture DAR found in your
photograph did not invalidate the plan*.

---

## 9. Rules that are easy to violate (and why)

| Rule | Reason |
|---|---|
| **`format` and `effort` are siblings inside ONE `output_config`** | Two separate `output_config` kwargs silently overwrite each other. Pinned by `test_format_and_effort_are_siblings_in_one_output_config`. |
| **Apply a plan with `beginGesture` → N × `addAt` → `endGesture`, never `replace`** | `replace` wipes `undo`/`redo`, so an AI plan would be un-undoable. Gestures collapse N adds into **one** history entry — verified: 4 objects + 2 materials → 0 in one undo. |
| **`scene.culture` is never changed by a plan** | Switching it goes through `setCulture`, which dispatches `replace` and would wipe history mid-gesture. The plan expresses culture through the *pieces it places* and the *shell materials it sets* — which is what is actually visible. |
| **Cultural intensity and room type live in page state (`renderIntent`), not `DesignScene`** | A new scene field bumps `SCENE_VERSION`, and `loadScene` silently drops any scene whose version mismatches — i.e. it would throw away every saved room. |
| **Colour intent goes to Build Mode materials, never to Colour Control** | `/api/color/*` repaints a **finished PNG** and needs a `job_id`, a rendered image and cached segmentation. A Build Mode scene that was never rendered has none of those. Two systems, no overlap. |
| **The room rectangle is sent by the client** | `RoomAnalysis.summary()` returns no width/depth/height at all. `deriveRoom()` backs the rectangle out client-side. |

---

## 10. Where `understood` flows onward

```
understood.roomType   → renderIntent.roomType   → /render-scene `room` param
                                                   (was hardcoded "living room")
understood.intensity  → renderIntent.intensity  → /render-scene `scale` param
                                                   → transform.render_scene(lora_scale=…)
understood.wall/floor → setShellMaterial        → the 3D room shell
understood.culture    → validates every item (gate 5); does NOT dispatch setCulture
```

> **Omitted, the render path is byte-for-byte what it was** — the same discipline as
> `control_override`. See [11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md).

---

## 11. What the planner is NOT

- ❌ **Not a renderer.** It emits no pixels. It picks ids and coordinates.
- ❌ **Not a source of facts.** It emits no dimensions, no seat counts, no colours outside
  the swatch list, no room types outside `room_ar_map`.
- ❌ **Not RAG.** Nothing is retrieved. The catalogue is placed in the prompt whole.
  See [07_RAG_ARCHITECTURE.md](07_RAG_ARCHITECTURE.md).
- ❌ **Not required.** The rule-based path is a first-class mode that CI exercises.
- ❌ **Not the spatial authority.** `placement.ts` is.
  See [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md).

---

## 12. Test coverage

`tests/test_design_planner.py` — **25 tests, no live API calls**; a fake client is injected
via `plan(..., client=…)`. Covers: schema shape, the `output_config` sibling trap, enum
construction, culture coherence rejection, coordinate rejection, `understood` clamping,
seat arithmetic, the rule fallback, the call cap, and the cache key.

---

Related: [08_SPATIAL_VALIDATION.md](08_SPATIAL_VALIDATION.md) ·
[10_FURNITURE_AND_ASSETS.md](10_FURNITURE_AND_ASSETS.md) ·
[17_FULL_DATA_FLOW.md](17_FULL_DATA_FLOW.md)
