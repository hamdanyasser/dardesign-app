# 17 — Full Data Flow

*Five end-to-end traces. Every step names the file that owns it.*

Legend: **[AI/ML]** · **[DET]** deterministic · **[3D]** · **[CULT]** cultural knowledge ·
**[USER]** · **[DATA]** · **[GEN]** generative.

---

## FLOW A — Real room photo → DAR redesign

```
INPUT   a JPEG/PNG/WebP room photograph                                        [USER]
   │
   ▼ FRONTEND  src/app/studio/page.tsx
   acceptFile()      image/* · <10 MB · ≥256×256 (dimensions decoded, not trusted)
   ImageContext.setImage(file)
   scope pick: "lebanese" | "khaleeji" | "moroccan" | "all"
   │
   ▼ API  src/lib/api.ts → consumeGeneration()
   POST /api/usage/consume                        → DATA_API_URL                [DATA]
   db.consume_generation()  read+decide+increment, ONE lock, ONE transaction
   fails CLOSED on quota_exceeded / not_authenticated; OPEN on anything else
   │
   ▼ API  src/lib/api.ts → redesignRoom(file, {timeoutMs: 420_000, styles})
   POST /redesign  (multipart)                    → API_URL (GPU host)
   │
   ▼ BACKEND  backend/main.py
   guardrails.validate_upload()   ext allowlist + MAGIC BYTES + size            [DET]
   validators                     MIME + img.verify() + ≥256 px
   jobs.create()                  seed = int(job.id[:8], 16)
   StreamingResponse(_stream_keepalive(...))   b" " every 10 s — free tunnels
                                               524 on a slow first byte
   │
   ▼ async with _GEN_LOCK:            ← the diffusers LoRA fuse state is not
   │                                    concurrency-safe
   │  ┌─ for each requested culture ────────────────────────────────────────┐
   │  │ backend/prompt_builder.py  build_prompts(culture, room, seed)  [CULT]│
   │  │    ontology/ontology.json → weighted sample, 2 per category × 7      │
   │  │    → sanitize_prompt_fragment(filter_chunk(term))                    │
   │  │    → positive_en/ar, negative_en/ar, trigger phrase                  │
   │  │                                                                      │
   │  │ backend/transform.py  transform_room(...)                            │
   │  │    LIGHT? → _emit_placeholder()  (culture tint + PREVIEW pill)        │
   │  │    else:                                                             │
   │  │      _prepare_conditioning(image, target)                     [AI/ML]│
   │  │         Depth Anything V2 Small  → depth control image               │
   │  │         OneFormer ADE20K Swin-L  → seg control image (150-class)     │
   │  │      _attach_lora(culture, 0.8)   models/loras/<c>/*.safetensors     │
   │  │      SDXL base 1.0 + [depth CN 0.7, seg CN 0.5]               [GEN]  │
   │  │         30 steps · guidance 7.0 · 1024² · seeded generator           │
   │  │      OOM → _free_pipe → SD 1.5 + ControlNet 1.1 @ 768²               │
   │  │      → PNG + <out>.manifest.json  (model, lora, seed, cn weights)    │
   │  └──────────────────────────────────────────────────────────────────────┘
   │
   │  ── best-effort, in its OWN try (must never cost the user their designs) ──
   │  transform.compute_depth_seg(image, 384)                          [AI/ML]
   │  room_analysis.analyze_room(depth, seg)                             [DET]
   │     floor / wall / occupied / protected / free-floor masks
   │     _estimate_scale() → px_per_cm from ASSUMED reference widths
   │     _find_candidates() → distance-transform local maxima
   │  projection.project_top_down()   → object_map   (cy = camera-axis depth)
   │  projection.seg_bounding_boxes() → seg_regions  (image-space boxes)
   │
   ▼ (outside the lock)
   backend/quality.py  ssim_paths(original, styled) per culture           [DET]
   backend/audit.py    log_event("redesign", …)   metadata only
   │
   ▼ RESPONSE  RedesignResponse
   { original, lebanese?, khaleeji?, moroccan?, styles[],
     object_map, seg_regions, depth_map, room_analysis,
     job_id, duration_s, ssim{}, placeholder?, privacy_notice }
   │
   ▼ FRONTEND  studio/page.tsx  — response SHAPE validated, not just status
   │            (the 200 was already sent when the stream started)
   ├── BeforeAfterSlider over the featured culture
   ├── tile grid: original + each culture
   ├── CulturalElementHighlighter  ← seg_regions   ("live" vs "preview")
   ├── RoomMap2D                   ← object_map
   ├── DepthOrbit                  ← depth_map                            [3D]
   ├── ColorControl / FurniturePlacement  (gated on job_id + room_analysis)
   ├── narrative tabs → adapters.createDesignStoryData()  ← THE TRUTH GATE
   └── EnterBuildMode →  FLOW B
   │
OUTPUT  3 culturally-styled renders + a structured understanding of the room
```

---

## FLOW B — Empty/derived room + natural-language brief → planner → Build Mode

```
INPUT   a Studio result (or nothing) + a brief in Arabic or English         [USER]
   │
   ▼ FRONTEND  components/design/EnterBuildMode.tsx
   sessionStorage["dar-build-handoff"] = {result, culture}    ← lib/design/handoff.ts
   router.push("/design")
   │
   ▼ src/app/design/page.tsx  — bootstrap
   readHandoff()
   roomModel.deriveRoom(result, culture)                                    [DET]
      total_m2 = free_floor_m2 / free_floor_of_floor
      plausibility band 9–90 m²  → outside ⇒ DEFAULT_ROOM, shellSource "default"
      width = sqrt(area × 1.25)  ← ASSUMED ASPECT;  height = 300 ← CONSTANT
      shellSource = "measured" if scale_confidence ≥ 0.4 else "estimated"
      object_map → LOCKED "found" massing
         drops OPENING_CLASSES → WallOpening[]
         drops WALL_MOUNTED_CLASSES (a painting must not stand on the floor)
         drops ON_FURNITURE_CLASSES (the 520 cm merged-cushion bug)
   loadScene(jobId)   a saved scene wins for objects;
                      OPENINGS ARE ALWAYS RE-DERIVED (they belong to the photo)
   useReducer(designReducer)                              ← lib/design/store.ts
   │
   ▼ USER TYPES A BRIEF   components/design/PlanPanel.tsx
   "a majlis for eight people, keep the centre open, warm beige walls"
   │
   ▼ API  planLayout(input)  → DATA_API_URL  (NOT the GPU host — the key lives
   POST /api/design/plan       on a machine the user controls)
   _require_user                ← the only generation-adjacent authed endpoint
   validate: culture ∈ CORE_STYLES ∪ {"all"};  100 ≤ w,d ≤ 2000 cm
   │
   ▼ BACKEND  backend/design_planner.py  plan()
   cache: sha256(room + culture + normalised brief + existing + openings)
   provider(): DARDESIGN_LLM_PROVIDER > ANTHROPIC_API_KEY > GEMINI_API_KEY
               → currently "gemini" / gemini-3.5-flash                   [AI/ML]
   │
   ├─ NO PROVIDER / error / cap → fallback_plan()  source:"rules"          [DET]
   │                              UI badge: "Planned by DAR's rules"
   │
   └─ ONE model call
      build_user_message()  room frame + shellSource caveat +
                            catalogue_projection("all") (27 ids + real cm) +
                            existing found objects + detected openings + brief
      plan_schema()   catalogId is a JSON-Schema ENUM   ← GATE 1: an invented
                      id is UNREPRESENTABLE, not merely unlikely
                      NO size fields at all             ← GATE 2
      → { understood, items[], notesEn, notesAr }
   │
   ▼ GATE 3  backend validation                                            [DET]
   validate_understood()  every field forced into a DAR-owned vocabulary
        roomType ∈ prompt_builder.room_ar_map keys
        intensity clamped 0..1 (the same clamp /restyle applies)
        wall/floor ∈ materials.ts WALL_CHOICES / FLOOR_CHOICES
        unknown ⇒ null, NEVER a plausible guess
   validate_items()       → (accepted[], rejected[] WITH DISTINCT REASONS)
        GATE 5: culture ≠ understood.culture ⇒ dropped and named
   seats_of() → seatingEstimate    ← DAR's arithmetic, not the model's claim
   │
   ▼ FRONTEND GATE 4  src/lib/design/planner.ts  gatePlan()                [DET]
   per item, IN ORDER, against the scene AS IT IS BEING BUILT:
        snapPosition()      walls beat alignment; guides emitted
        evaluatePlacement() ← THE SAME oriented-rect SAT a human drag uses
                              BLOCKING: out-of-bounds, overlaps a placed piece
                              ADVISORY: replaces-existing, needs-wall
        blockedOpening()    ← GATE 6: door 90 cm / window 40 cm keep-clear
        failed? → ONE findSpot() repair → re-evaluate
        still blocking → dropped with a bilingual reason
   │
   ▼ APPLY  design/page.tsx
   beginGesture → N × addAt → endGesture      ← NEVER `replace` (it wipes undo)
   ⇒ ONE Ctrl+Z removes the whole plan, materials included
   setShellMaterial(wall/floor) from understood
   renderIntent = {roomType, intensity}   ← page state, NOT DesignScene
                                            (a scene field would bump
                                             SCENE_VERSION and discard saves)
   │
OUTPUT  a furnished, editable, collision-valid 3D room + a panel that states
        what DAR understood, what it placed, and WHAT IT REFUSED
```

---

## FLOW C — User edits the scene → Render with DAR → final image

```
INPUT   an edited DesignScene                                              [USER]
   │
   ▼ EDIT  components/design/DesignCanvas.tsx                          [3D][DET]
   drag/rotate/add/delete/material  → store actions
   live ghost coloured DIRECTLY from evaluatePlacement (ok/advisory/blocked)
   snap guides drawn so the user can see WHY an object jumped
   undo/redo: snapshot + gesture coalescing (a 200-frame drag = 1 entry)
   persisted: localStorage["dar-scene-v3:<jobId>"], debounced 600 ms
   │
   ▼ CAPTURE  components/design/HandoffPanel.tsx → capture(1024, 768)
   lib/design/scene3d.ts  DesignWorld.renderConditioning(w, h)             [3D]
      builds its OWN interior camera — NOT the orbit camera:
         CAPTURE_EYE_Y 155 cm · FOV 54° (≈24 mm) · wall clearance 45 cm
         walks in until clear of every object by CAPTURE_BODY_CM 55
         keeps ONLY the user's azimuth
      forces every wall opaque (undoes cullWalls' per-frame fade)
      adds a capture-only ceiling in ADE20K_CEILING (an open top reads as sky)
      hides anything that DRAWS but carries no ADE class
         (isMesh || isLine || isPoints || isSprite — a Line is not a Mesh)
      ┌── BEAUTY  ACES + sRGB via a 256-entry LUT   → the evidence strip
      ├── DEPTH   NoToneMapping + LinearEncoding    → conditioning is DATA
      └── SEG     NoToneMapping + LinearEncoding    → exact ADE20K palette
   ⚠ capture happens BEFORE the request, so evidence survives a dead backend
   │
   ▼ API  renderScene(depth, seg, style, {room, scale})   → API_URL
   POST /render-scene   multipart: depth, seg, style,
                        room  ← renderIntent.roomType   (was hardcoded)
                        scale ← renderIntent.intensity  (→ lora_scale)
   "all" collapses to "lebanese" — a generator takes one culture
   │
   ▼ BACKEND  main.py → async with _GEN_LOCK → transform.render_scene()
   build_prompts(style, room, seed)          ← the ORDINARY cultural prompt [CULT]
   _attach_lora(style, scale)                ← the ORDINARY per-culture LoRA
   _generate(..., control_override=(depth, seg))                        [GEN]
        ⚠ _prepare_conditioning is NOT called — 0 photo-derived annotators run
   SDXL + [depth CN 0.7, seg CN 0.5] → PNG + manifest
   OOM → SD 1.5 @ 768²
   audit.log_event("render_scene", …)
   │
   ▼ RESPONSE  { job_id, style, image, duration_s, placeholder }
   │
   ▼ FRONTEND  HandoffPanel
   the render + the evidence strip (beauty | depth | seg)
   THE HONESTY CONTRACT:
      HELD     placement · orientation · geometry · viewpoint
               (they ARE the control signal)
      NOT HELD the appearance of any individual piece — the model invents
               surface and ornament INSIDE the silhouette; materials reach it
               through the prompt, so they STEER rather than BIND
   placeholder:true → "That last image is not a real render."
   │
OUTPUT  a photoreal render whose LAYOUT is the user's own
```

---

## FLOW D — Culture switching and cultural design

DAR has **three distinct culture-switching mechanisms**. They are not the same feature.

```
D1 — MULTI-CULTURE GENERATION  (Studio)
   POST /redesign  loops CORE_STYLES = (lebanese, khaleeji, moroccan)
   ONE depth+seg pass, N generations
   → "same bones, three souls" — the page's whole argument
   files: main.py, transform.py, prompt_builder.py

D2 — CULTURAL INTENSITY        (Studio → StyleIntensitySlider)
   POST /restyle  {file, style, scale}       scale clamped 0..1
   → transform.transform_room(lora_scale=scale)
   scale 0.0 = prompt-only SDXL   ·   scale 1.0 = full cultural adapter
   ⭐ THIS IS THE LoRA ABLATION, MADE INTERACTIVE
   StylePack = (lebanese, khaleeji, moroccan, PERSIAN)   ← the only Persian path
   files: main.py, transform.py, StyleIntensitySlider.tsx

D3 — BUILD MODE CULTURE        (Build Mode → CatalogDock)
   setCulture(c) → dispatch `replace`  ⚠ WIPES UNDO HISTORY
   changes: SHELL_MATERIALS defaults, CULTURE_ACCENT, the catalogue rail filter
   ⚠ an LLM plan NEVER changes scene.culture — it would wipe history
     mid-gesture. The plan expresses culture through the PIECES it places
     and the SHELL MATERIALS it sets, which is what is actually visible.
   files: store.ts, materials.ts, catalog.ts, CatalogDock.tsx
```

**The cultural knowledge itself flows one way:**

```
ontology/ontology.json ──┬─▶ prompt_builder  ─▶ SDXL prompt + trigger phrase
      [CULT]             ├─▶ materials.ts    ─▶ 3D material hex values
                         ├─▶ cultureData.ts  ─▶ Culture DNA panel
                         └─▶ src/data/ontology.json (⚠ SECOND COPY)
                                              ─▶ Highlighter + RoomReport

ontology/furniture.json ─┬─▶ backend/furniture.py ─▶ recommendation ranking
      [CULT]             │                        ─▶ catalogue_projection
                         │                            ⇒ the LLM's JSON-Schema ENUM
                         └─▶ src/lib/design/catalog.ts ─▶ CatalogDock rail
                                                        ─▶ geometry.ts procedural 3D
```

---

## FLOW E — Save → history → report → evaluation

```
INPUT   a finished render the user wants to keep                          [USER]
   │
   ▼ FRONTEND  components/SaveDesignButton.tsx
   saveToHistory(oldImage, newImage,
                 {culture, intensity, duration, ssim, edited, light})
   ⚠ the CLIENT reports `light`, because the renderer and the accounts
     backend can be DIFFERENT HOSTS
   │
   ▼ POST /api/history   → DATA_API_URL, _require_user                   [DATA]
   db.save_history(...)  → a history row with Ssim already populated
   │
   ├─ if (not edited and not light):
   │     BackgroundTasks.add_task(evaluate_pair)          ← AFTER the response
   │        quality.lpips_paths()   lpips.LPIPS(net="alex")        [AI/ML]
   │        quality.clip_cultures() open_clip ViT-B-32 laion2b     [AI/ML]
   │           → per-culture similarity + a zero-shot 3-way prediction
   │     → UPDATE history SET Lpips, ClipScore, PredictedCulture
   │     ⚠ CURRENTLY A NO-OP: neither package is installed ⇒ values stay null
   │
   ▼ audit.log_event("history_save", …)
   │
   ├─▶ /history       own designs; FeedbackForm → POST /api/feedback
   │                     3 × 1–5 ratings + furniture verdict + comment
   │                     UNIQUE(HistoryId) ⇒ one rating per design (upsert)
   │                     culture/intensity read OFF THE HISTORY ROW, not the client
   │
   ├─▶ PATCH /api/history/{id}/suggest → /others  (viewer's own excluded IN SQL)
   │
   ├─▶ RoomReport.tsx  client-side canvas → branded PNG
   │      ⚠ its footer HARDCODES "SDXL + dual ControlNet + cultural LoRA",
   │        which is not true for every path — deliberately NOT auto-wired
   │        into DesignStory until it takes real capability props
   │
   └─▶ /evaluation  GET /api/admin/evaluation  (_require_admin)
          ONE filter builder: db._history_filters(culture, since, until,
                                                  pipeline_only=True)
          ⇒ every panel reads the SAME population
          roomsGenerated (all)  vs  evaluableDesigns (IsEdited=0 AND IsLight=0)
          editedExcluded / lightExcluded returned so the arithmetic CLOSES
          db.evaluation_coverage()  n/total per metric — the DENOMINATORS
          db.culture_confusion()    Culture vs PredictedCulture (CLIP zero-shot,
                                    NEVER labelled human accuracy)
          evaluation.automatic_metrics() ← reads eval/results.csv
                                    ⚠ FILE DOES NOT EXIST ⇒ ablation unavailable
                                      (panel removed from the page rather than
                                       shown permanently empty)
   │
OUTPUT  a durable design, a rating, a shareable report, and an evaluation
        dashboard that renders "—" for every figure it does not have
```

> **Deleting a design removes it from every average and from the confusion matrix in the
> same instant** — because the scores are columns on the row, not a side table.

---

## Cross-flow: the two backends

```
                    ┌──────────────────────────────────────┐
  NEXT_PUBLIC_      │ RENDER HOST — Kaggle T4, ephemeral,   │
  API_URL ─────────▶│ rotating tunnel, NO users table,      │
                    │ sent NO session cookie                │
                    │ A: /redesign  C: /render-scene        │
                    │ D2: /restyle  /api/furniture /api/color│
                    └──────────────────────────────────────┘
                    ┌──────────────────────────────────────┐
  NEXT_PUBLIC_      │ DATA HOST — the developer's machine,  │
  DATA_API_URL ────▶│ SQLite + images/, holds the LLM key   │
  (→ API_URL if     │ A: /api/usage/consume  B: /api/design/plan
   unset)           │ E: /api/history /api/feedback /admin  │
                    └──────────────────────────────────────┘
```

**This split is why** `/api/usage/consume` exists as a separate endpoint, why the planner
is the one authenticated generation-adjacent endpoint, and why the client reports `light`
rather than the server inferring it.

---

Related: [22_DIAGRAM_ARCHITECTURE_SPEC.md](22_DIAGRAM_ARCHITECTURE_SPEC.md) ·
`architecture.json` · [18_API_ENDPOINT_MAP.md](18_API_ENDPOINT_MAP.md)
