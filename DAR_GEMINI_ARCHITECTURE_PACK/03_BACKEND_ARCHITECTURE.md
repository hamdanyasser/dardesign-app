# 03 — Backend Architecture

**One FastAPI application (`backend/main.py`, ~2060 lines, `version="0.3.0"`) that runs in
two very different roles, plus a first-class placeholder mode.**

---

## 1. The two-backend split — the fact that explains the most surprising code

```
                    ┌──────────────────────────────────────┐
   NEXT_PUBLIC_     │  RENDER HOST  ("the GPU host")       │
   API_URL ────────▶│  Kaggle T4, behind a rotating tunnel │
                    │  • no users table                    │
                    │  • sent NO session cookie            │
                    │  • holds no durable state            │
                    │  • wiped between sessions            │
                    │  /redesign /restyle /render-scene    │
                    │  /api/furniture/* /api/color/*       │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
   NEXT_PUBLIC_     │  DATA HOST                           │
   DATA_API_URL ───▶│  the developer's own machine         │
   (falls back to   │  • SQLite backend/dardesign.db + WAL │
    API_URL)        │  • images/ on disk                   │
                    │  • holds the LLM API key             │
                    │  auth, history, feedback,            │
                    │  subscription, usage, admin,         │
                    │  evaluation, /api/design/plan        │
                    └──────────────────────────────────────┘
```

**Consequences that look like bugs but are not:**

- `POST /api/usage/consume` is a **separate endpoint** rather than a check inside
  `/redesign`, because the GPU host has no users table and receives no cookie.
- **All generation endpoints are unauthenticated.** `/redesign`, `/restyle`,
  `/transform`, `/render-scene`, `/api/furniture/*` and `/api/color/*` take no session.
  Quota is enforced only by the client voluntarily calling `/api/usage/consume` first.
  *This is a real limitation — see [20](20_DEFENSE_FACTS_AND_LIMITATIONS.md).*
- `/api/design/plan` sits on the **data** host and is the one generation-adjacent
  endpoint **behind `_require_user`**, because every call spends money.

Unset, `DATA_API_URL` follows `API_URL` and one backend does everything.

---

## 2. `DARDESIGN_LIGHT=1` is a mode, not a mock

`backend/transform.py` is canonical and contains a placeholder branch; **nothing else is
stubbed**. The entire 580-test suite and the local data backend run in this mode.

| In LIGHT mode | Consequence |
|---|---|
| `transform_room` short-circuits to `_emit_placeholder` | A desaturated, culture-tinted image with an 8-point-star grid and a `PREVIEW · <Culture>` pill |
| The synthetic room has no ADE20K floor | **Floor recolour correctly reports "not detected"**; wall recolour works |
| `placeholder: true` propagates | Into `object_map` / `seg_regions` / `room_analysis`, so the frontend truth gates suppress them |
| `metrics_available()` is False | LPIPS and CLIP stay `null` (neither `lpips` nor `open_clip` is in `requirements-light.txt`) |

Manifest records `"model": "DARDESIGN_LIGHT placeholder", "light_mode": true`.

---

## 3. Module map

| Module | Lines | Role |
|---|---|---|
| **`main.py`** | ~2060 | The entire HTTP surface + pydantic models + lifespan + CORS |
| **`transform.py`** | ~1500 | SDXL + dual ControlNet, per-culture LoRA, OOM→SD1.5 fallback, LIGHT branch, `render_scene`, the depth/seg annotators |
| `room_analysis.py` | — | One depth+seg pass → floor / occupied / protected / free-floor masks, scale estimation, candidate spots |
| `projection.py` | — | `project_top_down()` (2D plan) + `seg_bounding_boxes()` (on-image highlighter boxes) |
| `prompt_builder.py` | ~210 | `ontology.json` → bilingual positive/negative prompts; seedable |
| **`design_planner.py`** | 931 | The LLM planner: schema, prompt, dual provider, validation, rule-based fallback |
| `db.py` | ~1300 | All SQLite. **Storage only** — every policy number is passed in |
| `auth.py` | — | PBKDF2 200k rounds, HMAC-signed stateless session cookie |
| `subscriptions.py` | — | Plan policy constants + daily expiry service |
| `mailer.py` | — | Decision emails, stdlib `smtplib`; unconfigured = log the message |
| `evaluation.py` / `quality.py` | — | SSIM/LPIPS/CLIP + the `/api/admin/evaluation` aggregation |
| `furniture.py` / `placement.py` / `compositing.py` | — | Recommendation ranking, candidate positions, validation, asset compositing |
| `recolor.py` / `recolor_api.py` | — | Masked HSV wall/floor recolour (`/api/color` router) |
| `jobs.py` / `ttl_cleanup.py` / `audit.py` / `share.py` | — | In-memory job registry, 24 h TTL sweeper, append-only JSONL audit, HMAC share tokens |
| `validators.py` / `errors.py` / `guardrails.py` | — | Upload validation; bilingual error payloads; prompt-injection and parameter guardrails |

---

## 4. Lifespan, CORS and the request envelope

**Lifespan** (`main.lifespan`): `db.connect()` → `start_background_sweeper([UPLOAD_DIR],
ttl_hours=24, interval_min=60)` → `subscriptions.start_expiry_service()`; both stopped on
shutdown.

**CORS**: `DARDESIGN_ALLOWED_ORIGINS` (comma-split), default
`["http://localhost:3000", "http://127.0.0.1:3000"]`. If the value is exactly `*` it uses
`allow_origin_regex=".*"` with `allow_credentials=True` (a wildcard origin is illegal with
credentials).

> This is why `npm run dev:tunnel` **hard-fails if port 3000 is taken** rather than letting
> Next fall back to :3001 — every `/redesign` call would fail CORS.

**Static mounts**: `/images` → `ROOT/images`. **Routers**: `color_router` at `/api/color`.

### Two invariants that are easy to break

**a) `_GEN_LOCK` serialises every generation.**
```python
_GEN_LOCK = asyncio.Lock()   # main.py
```
The cached diffusers pipeline and its LoRA fuse state are not concurrency-safe; a second
request arriving mid-hot-swap corrupts the accelerate offload hooks (`_hf_hook`
`AttributeError` on the T4). **Any new generating endpoint must take this lock.**
Held by `/redesign`, `/restyle`, `/transform` and `/render-scene`.

**b) Long endpoints stream keepalives.**
```python
_KEEPALIVE_SECS = 10.0   # _stream_keepalive yields b" " until the work completes
```
Free tunnels return 524 on anything that waits ~100 s for its first byte. Leading
whitespace is a valid JSON prefix, so `res.json()` is unchanged. **The catch: once the
stream starts the 200 is already sent**, so post-start failures arrive in-band as an
`ApiError`-shaped `detail` body — which is why the client validates response *shape*, not
just status. Used by `/redesign` and `/restyle` only.

---

## 5. Auth and authorisation

| Helper | Behaviour |
|---|---|
| `_current_user(session)` | `db.get_user(read_session(session))` or `None`; never raises |
| `_require_user(session)` | 401 `ERR_NOT_AUTHENTICATED` |
| `_require_admin(session)` | `_require_user`, then 403 `ERR_FORBIDDEN` unless `Role == "Admin"` |

**Sessions are stateless.** `auth.py` mints `"{user_id}:{expiry}:{hmac_sha256_hex}"`;
there is no session table. Secret from `DARDESIGN_SECRET`; without it a per-process
random secret is generated and a warning logged (every restart logs everyone out — which
is why `scripts/run-local-backend.ps1` persists one in `.dardesign-secret`).

**Passwords**: PBKDF2-SHA256, `200_000` rounds, 16-byte salt, stored as the
self-describing string `pbkdf2_sha256$<rounds>$<b64salt>$<b64hash>`, verified with
`hmac.compare_digest`.

**The first account ever created becomes Admin**
(`role = ROLE_ADMIN if db.user_count() == 0 else ROLE_USER`).

---

## 6. Request/response flow — `/redesign` (the main path)

```
POST /redesign  (multipart: file, styles?)
  │
  ├─ guardrails.validate_upload()      extension allowlist + magic bytes + size
  ├─ validators                        MIME + ≥256px + ≤10 MB, img.verify()
  ├─ jobs.create()                     seed = int(job.id[:8], 16)
  │
  └─ StreamingResponse(_stream_keepalive(coro))     ← whitespace every 10 s
        │
        └─ async with _GEN_LOCK:
              for style in _parse_styles(styles) or CORE_STYLES:
                  transform_room(input, style, out, seed=seed, room=...)
                      ├─ LIGHT?  → _emit_placeholder()
                      └─ else    → build_prompts(style, room, seed)
                                   _prepare_conditioning()  depth + seg
                                   _attach_lora(style, scale)
                                   SDXL dual-ControlNet  → PNG + .manifest.json
                                   on OOM → _free_pipe → SD1.5 @768²
              (best-effort, own try:)  compute_depth_seg → analyze_room
                                       project_top_down  → object_map
                                       seg_bounding_boxes → seg_regions
              (outside the lock)       ssim_paths(original, styled) per culture
              audit.log_event("redesign", …)
        │
        └─ RedesignResponse { original, lebanese?, khaleeji?, moroccan?, styles[],
                              object_map, seg_regions, depth_map, room_analysis,
                              job_id, duration_s, ssim{}, placeholder?, privacy_notice }
```

**The depth/seg block is in its own `try`.** A failure there must never cost the user their
three designs — the room-understanding payloads simply come back `null`.

`_parse_styles` accepts only `CORE_STYLES`; an unknown name is a **400**, not a silent drop.
`cy` is flipped at the API boundary (`1.0 - cy`) so the client's coordinate convention holds.

---

## 7. Jobs and persistence

**`jobs.py` is in-memory and single-process.** `JobStatus ∈ {pending, queued, running,
done, error}`. `Job.public()` strips `input_path`, `output_path` and `style_outputs`, so
no filesystem path ever crosses the wire. A `threading.Lock`-guarded dict; module
singleton `jobs`.

This is why colour edits and furniture placements "stack": both repoint
`job.style_outputs[style]` to a new PNG, and **Save design** stores whatever that currently
points at — no schema change was needed for either feature.

**Uploads are swept after 24 h** (`ttl_cleanup.start_background_sweeper`). The privacy
notice is returned on every render response:

> `صورك تُحذف تلقائيًا بعد ٢٤ ساعة ما لم تحفظها. | Your photos are automatically deleted after 24 hours unless you save them.`

**`backend/audit.jsonl` deliberately lives outside `uploads/`** so the sweeper never eats it.

---

## 8. Database — `backend/dardesign.db` (SQLite, WAL)

`PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`. Path from `DARDESIGN_DB` or
`backend/dardesign.db`, read at import time. `connect()` runs `_SCHEMA` then `_migrate`.

| Table | Key columns |
|---|---|
| `users` | `Id, FullName, PhoneNumber, Email UNIQUE COLLATE NOCASE, Password, Role, IsSubscribed, PlanStartedAt, PlanExpiryDate, NumberOfUses, UsageWindowStart, CreatedAt` |
| `history` | `Id, UserId→users, OldImageUrl, NewImageUrl, IsSuggested, Culture, Intensity, Duration, Ssim, Lpips, ClipScore, PredictedCulture, IsEdited, IsLight, CreatedAt` |
| `feedback` | `Id, HistoryId UNIQUE→history, UserId, Culture, Intensity, CulturalAccuracy, ImageQuality, RoomPreservation, FurniturePlacement, Comment, CreatedAt, UpdatedAt` |
| `subscription_requests` | `Id, UserId, Status CHECK(pending/approved/declined), CreatedAt, DecidedAt, DecidedBy` |
| `evaluation_results` | `Id, RoomId, Culture, SetName, InputPath, ImagePath, Ssim, Lpips, ClipScore, Predicted, Correct, CreatedAt`, `UNIQUE(RoomId, Culture, SetName)` |

**Two schema decisions worth stating:**

- **`UNIQUE(HistoryId)` on `feedback`** makes "one rating per design" a property of the data.
- **A partial unique index** `idx_subreq_one_pending ON subscription_requests(UserId)
  WHERE Status = 'pending'` makes "one open request per user" a property of the data, not
  a race-prone check.
- **Evaluation scores are columns on the `history` row**, not a side table. That is what
  makes deletion total: remove a design and it leaves every average and the confusion
  matrix in the same instant.

Details → [15_ACCOUNTS_DATABASE_ADMIN.md](15_ACCOUNTS_DATABASE_ADMIN.md).

---

## 9. The planner, from the backend's side

`POST /api/design/plan` → `_require_user` → validate (`culture ∈ CORE_STYLES ∪ {"all"}`,
`100 ≤ width/depth ≤ 2000` cm) → `design_planner.plan(...)`.

**`plan()` never raises.** Every failure path — no key, SDK absent, provider error, call
cap reached, unusable answer — returns a deterministic `fallback_plan()` tagged
`source: "rules"`. CI and the tests run that path, so the feature is never dark.

`GET /api/design/planner-status` → `{configured, model, provider}`.

Full treatment → [06_LLM_DESIGN_PLANNER.md](06_LLM_DESIGN_PLANNER.md).

---

## 10. Evaluation, from the backend's side

`GET /api/admin/evaluation` composes eight sources: `db.feedback_stats`,
`eval_overall_rating`, `db.feedback_by_culture`, `db.list_feedback`,
`eval_generation_report`, `eval_coverage_report`, `db.culture_confusion`,
`eval_automatic_metrics`.

**Every section takes the same `culture` + `since`/`until` and applies them in SQL**, via
one shared builder `db._history_filters(...)`. That is what makes "the KPI cards, the
metrics and the matrix are reading the same population" checkable rather than hoped for —
an average cannot be filtered after it has been taken.

Two populations, both named: `roomsGenerated` (everything saved) vs `evaluableDesigns`
(`IsEdited = 0 AND IsLight = 0`, the basis of every average), with `editedExcluded` and
`lightExcluded` returned so the arithmetic closes on screen.

→ [16_EVALUATION.md](16_EVALUATION.md)

---

## 11. Error contract

`errors.ApiError(code, http_status, message_en, message_ar)`. **Every `HTTPException`
carries all three**, which is why there is no client-side error table.

Notable status choices: `quota_exceeded` is **429, not 403** — the request is permitted
and the allowance refills. `file_too_large` 413. `email_taken` /
`subscription_pending` / `already_subscribed` / `request_not_pending` 409.

Domain exceptions: `db.EmailTaken`, `db.PendingRequestExists`, `furniture.CatalogueError`,
`transform.PipelineError`, `compositing.CompositingError`, `recolor.RecolorError`,
`validators.ValidationFailure`, `transform.AnalysisFailure`.

---

## 12. Guardrails

`backend/guardrails.py` — four dependency-free defences:

1. `sanitize_prompt_fragment` — strips Unicode category-C characters (covers the
   RTL-override U+202E attack), allowlists Arabic + Latin + safe punctuation, 480-char cap.
2. `filter_chunk` — drops instruction-shaped lines (14 injection patterns). Applied to
   **ontology entries**, which a non-developer collaborator edits. *(Its docstring calls
   these "RAG chunks" — there is no RAG; see [07](07_RAG_ARCHITECTURE.md).)*
3. `validate_upload` — extension allowlist + **magic-byte check** + size cap.
4. `clamp_params` — server-side bounds: `cn_depth ∈ [0.3, 1.3]`, `cn_seg ∈ [0.2, 1.0]`,
   `steps ∈ [15, 45]`, `guidance ∈ [3.0, 12.0]`.

*Note: `MAX_UPLOAD_MB = 8` in guardrails is effectively dead — every call site passes
`max_mb=10`, matching `validators.MAX_BYTES`.*

---

## 13. Dependencies

**`requirements-light.txt`** (LIGHT Docker image + CI) — fastapi 0.115.6, uvicorn 0.32.1,
python-multipart 0.0.20, **pydantic 2.13.4**, pillow 11.0.0, numpy 1.26.4, scipy 1.15.3,
PyYAML 6.0.2, pytest 8.3.4, httpx 0.28.1, **anthropic 0.121.0**, **google-genai 2.17.0**.

**`requirements.txt`** adds: torch 2.4.0, torchvision 0.19.0, diffusers 0.31.0,
transformers 4.46.3, accelerate 1.1.1, safetensors 0.4.5, peft 0.13.2, controlnet-aux
0.0.9, bitsandbytes 0.44.1 (non-Windows), datasets 3.1.0, scikit-image 0.24.0,
torchmetrics 1.5.2, lpips 0.1.4, opencv-python-headless 4.10.0.84.

> **`scikit-image` is absent from the light file — which is exactly why
> `quality.ssim` is hand-implemented on numpy + scipy** (reproducing
> `skimage.metrics.structural_similarity` at its defaults to 1e-9). It has to run inside
> the render request and inside the LIGHT image.
>
> **`pydantic` is pinned at 2.13.4 because `google-genai` requires ≥2.12.5.** A previous
> pin of 2.10.3 made `pip install -r requirements-light.txt` `ResolutionImpossible` and CI
> failed before running a single test — while every local run passed, because the venv
> already held a newer version. **Trust CI's fresh install over a local environment.**

---

## 14. Ops

- Root `Dockerfile` builds the LIGHT image on `requirements-light.txt`.
- `.github/workflows/ci.yml` runs `pytest` under `DARDESIGN_LIGHT=1` **and**
  `npm run build`. Both must pass.
- `scripts/run-local-backend.ps1` is the day-to-day Windows entry point: generates/reuses
  the session key in `.dardesign-secret`, loads `.dardesign-smtp` and `.dardesign-llm` if
  present, sets `DARDESIGN_LIGHT=1`, serves on :8000. **It never renders.**

---

Related: [12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md) ·
[13_SDXL_CONTROLNET_LORA.md](13_SDXL_CONTROLNET_LORA.md) ·
[18_API_ENDPOINT_MAP.md](18_API_ENDPOINT_MAP.md)
