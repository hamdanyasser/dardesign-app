# 18 — API Endpoint Map

**47 endpoints total** — 42 in `backend/main.py` + 5 in `backend/recolor_api.py`
(mounted at `/api/color`). FastAPI, `title="DarDesign API"`, `version="0.3.0"`.

**Auth column:** `—` none · `USER` = `_require_user` (401) · `ADMIN` = `_require_admin`
(403) · `TOKEN` = a signed token in the path/query.
**Host column:** `API` = `NEXT_PUBLIC_API_URL` (GPU) · `DATA` = `NEXT_PUBLIC_DATA_API_URL`.

---

## 1. Generation

| Method | Path | Purpose | Input | Output | Auth | Host | Impl |
|---|---|---|---|---|---|---|---|
| POST | **`/redesign`** | The main path. Original + requested cultures + full room understanding, from one depth+seg pass | multipart `file`, `styles?` (comma-separated subset of `CORE_STYLES`) | `RedesignResponse` — `{original, lebanese?, khaleeji?, moroccan?, styles[], object_map, seg_regions, depth_map, room_analysis, job_id, duration_s, ssim{}, placeholder?, privacy_notice}` | — | API | `main.py`, `transform.py` |
| POST | **`/restyle`** | One culture at a chosen LoRA scale (the Style Intensity Slider) | multipart `file`, `style`, `scale` (clamped 0–1) | `RestyleResponse` `{image, style, scale, manifest, privacy_notice}` | — | API | `main.py`, `transform.py` |
| POST | **`/render-scene`** | **Build Mode.** Client-supplied depth + ADE20K seg replace the annotator output | multipart `depth`, `seg`, `style`, `room` (default `"living room"`), `scale?` | `{job_id, style, image, duration_s, placeholder}` | — | API | `main.py`, `transform.render_scene` |

> **`/redesign` and `/restyle` stream keepalives** (`b" "` every 10 s). Once the stream
> starts the 200 is already sent, so post-start failures arrive **in-band** — which is why
> the client validates response *shape*.
> **All three take `_GEN_LOCK`.** Any new generating endpoint must too.

---

## 2. Planning

| Method | Path | Purpose | Input | Output | Auth | Host | Impl |
|---|---|---|---|---|---|---|---|
| POST | **`/api/design/plan`** | LLM (or rule-based) furniture plan | `DesignPlanRequest` — room `{widthCm, depthCm, heightCm}`, `culture`, `brief`, `existing[]`, `openings[]`, `shellSource` | `{understood, items[], seatingEstimate, placedCounts, notesEn, notesAr, source: "llm"\|"rules", model, provider, rejected[], cached?, warning?}` | **USER** | **DATA** | `design_planner.py` |
| GET | `/api/design/planner-status` | Which provider a call would use | — | `{configured, model, provider}` | — | DATA | `design_planner.py` |

> **This is the only generation-adjacent endpoint behind `_require_user`**, because every
> call spends real money. It is on the **data** host because the API key belongs on a
> machine the user controls, never on a throwaway Kaggle container.
>
> Validation: `culture ∈ CORE_STYLES ∪ {"all"}` → `ERR_BAD_CULTURE`;
> `100 ≤ width, depth ≤ 2000` cm → `ERR_BAD_ROOM`.
> **`plan()` never raises** — every failure degrades to `source: "rules"`.

---

## 3. Auth

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| POST | `/api/auth/register` | Create + sign in. **The first account ever created becomes Admin** | `RegisterRequest {fullName, phoneNumber?, email, password}` | `AuthUser` + session cookie | — | DATA |
| POST | `/api/auth/login` | Sign in — **one message for both bad email and bad password** | `LoginRequest {email, password}` | `AuthUser` + cookie | — | DATA |
| POST | `/api/auth/logout` | Delete the cookie | — | `{}` | — | DATA |
| GET | `/api/auth/me` | **200 with `null` when signed out**, never 401 | — | `AuthUser \| null` | optional | DATA |

Session: `dardesign_session`, httpOnly, 7-day HMAC token, **no session table**.
Impl: `auth.py`, `db.py`.

---

## 4. History (saved designs)

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| POST | `/api/history` | Save a design; **queues LPIPS/CLIP as a background task when `not edited and not light`** | `SaveHistoryRequest {oldImageUrl, newImageUrl, culture, intensity, duration, ssim, edited, light}` | `HistoryEntry` | USER | DATA |
| GET | `/api/history` | Own saved designs | — | `HistoryEntry[]` | USER | DATA |
| PATCH | `/api/history/{id}/suggest` | Publish to the shared gallery (owner-only) | `SuggestRequest {isSuggested}` | `{}` | USER | DATA |
| GET | `/api/history/suggested` | **Others'** shared designs — the viewer's own excluded **in SQL** | — | `HistoryEntry[]` | USER | DATA |
| DELETE | `/api/history/{id}` | Delete own — **removes it from every average and the confusion matrix in the same instant** | — | `{}` | USER | DATA |

---

## 5. Ratings / feedback

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| POST | `/api/feedback` | Rate own design. **Upsert** — `UNIQUE(HistoryId)` means one rating per design | `FeedbackRequest {historyId, culturalAccuracy 1-5, imageQuality 1-5, roomPreservation 1-5, furniturePlacement, comment ≤500}` | `Feedback` | USER + owner | DATA |
| GET | `/api/feedback/{history_id}` | Own feedback or `null` | — | `Feedback \| null` | USER + owner | DATA |

> `FeedbackRequest` deliberately **omits** user id, culture and intensity — culture and
> intensity are read **off the history row**, so a client cannot mislabel its own rating.

---

## 6. Subscription and usage

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| GET | `/api/subscription` | Plan, allowance, usage, pending request — **and `terms`, so the price on the page cannot drift from the price enforced** | — | `SubscriptionState` | USER | DATA |
| POST | `/api/subscription/request` | Queue an upgrade. **Grants nothing** — returns the user's *unchanged* plan | — | `SubscriptionState` | USER | DATA |
| POST | `/api/subscription/cancel` | Back to Basic **immediately** — the user's own decision | — | `SubscriptionState` | USER | DATA |
| POST | **`/api/usage/consume`** | **The quota gate.** Read + decide + increment under one lock, in one transaction | — | `UsageResult` · **429 `quota_exceeded`** · 401 | USER | DATA |

> **`/api/usage/consume` is separate from `/redesign` because renders and accounts can be
> different backends.** Studio calls it immediately before `/redesign` and fails **closed**
> on `quota_exceeded`/`not_authenticated`, **open** on anything else.
>
> **A use is spent when a generation starts. There is deliberately no refund endpoint.**

---

## 7. Admin

| Method | Path | Purpose | Output | Auth | Host |
|---|---|---|---|---|---|
| GET | `/api/admin/subscriptions` | The upgrade queue (`status?`, `limit` 1–200) | `AdminSubscriptionQueue` | ADMIN | DATA |
| POST | `/api/admin/subscriptions/{id}/decision` | Approve (+30 days) / decline, **in one transaction with the verdict**; queues the email as a background task. A decided request **409s** | `SubscriptionRequest` | ADMIN | DATA |
| GET | `/api/admin/users` | Every account + plan dates (`limit` 1–1000). **`db.list_users` names its columns, so the password hash never leaves the DB** | `{users[], terms}` | ADMIN | DATA |
| GET | `/api/admin/feedback` | Stats + by-culture + recent (`culture`, `since`, `until`, `limit` 1–200) | `AdminFeedbackResult` | ADMIN | DATA |
| GET | **`/api/admin/evaluation`** | The whole evaluation dashboard | `EvaluationReport` | ADMIN | DATA |

`/api/admin/evaluation` composes eight sources — `db.feedback_stats`,
`eval_overall_rating`, `db.feedback_by_culture`, `db.list_feedback`,
`eval_generation_report`, `eval_coverage_report`, `db.culture_confusion`,
`eval_automatic_metrics` — **all through the one `db._history_filters` builder**, so every
panel reads the same population. → [16_EVALUATION.md](16_EVALUATION.md)

---

## 8. Furniture (recommendation + 2D placement)

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| GET | `/api/furniture/catalogue` | **All 27 items, unranked** — the endpoint an agent should read | `culture?` | `{items[], count}` | — | API |
| GET | `/api/furniture/recommendations` | Ranked shortlist (`limit` default `max_results()` = **9**) | `culture` (req), `room_type`, `mood`, `free_floor_m2`, `existing`, `colors`, `materials`, `limit` | `{items[]}` with per-item reasons | — | API |
| GET | `/api/furniture/room-analysis/{job_id}` | The **cached** analysis summary — **404s rather than recomputing** | — | `RoomAnalysisSummary` | — | API |
| POST | `/api/furniture/candidate-positions` | Best spots for one item | `CandidatePositionsRequest` | `CandidatePositionsResult` | — | API |
| POST | `/api/furniture/validate-position` | Is this box valid? **Called on every drag frame** (debounced, stale requests aborted) | `ValidatePositionRequest` | `ValidatePositionResult {valid, reason_en, reason_ar, score}` | — | API |
| POST | `/api/furniture/confirm-placement` | Re-validate + composite + repoint `job.style_outputs[style]` | `ConfirmPlacementRequest` | `ConfirmPlacementResult` | — | API |
| GET | `/api/furniture/item/{item_id}` | One item | — | `FurnitureItem` | — | API |

> **The backend is authoritative on validity** — the client never decides a placement is
> legal. → [10_FURNITURE_AND_ASSETS.md](10_FURNITURE_AND_ASSETS.md)

---

## 9. Colour Control — `backend/recolor_api.py`, prefix `/api/color`

| Method | Path | Purpose | Input | Output | Auth | Host |
|---|---|---|---|---|---|---|
| GET | `/api/color/targets` | Which surfaces are recolourable + `can_undo` | `job_id`, `style?` | `{targets[], canUndo}` | — | API |
| POST | `/api/color/preview` | Recolour and return the image — **writes nothing** | `RecolorRequest {job_id, style, target, color, strength}` | `RecolorResult` | — | API |
| POST | `/api/color/apply` | Write the PNG, push undo, repoint `job.style_outputs[style]` | `RecolorRequest` | `RecolorResult` | — | API |
| POST | `/api/color/undo` | Step back one | `ColorStateRequest` | `RecolorResult` | — | API |
| POST | `/api/color/reset` | Back to the pre-colour render — **furniture placements survive** | `ColorStateRequest` | `RecolorResult` | — | API |

Undo stack: `OrderedDict` keyed `"<job_id>:<style>"`, `_UNDO_MAX_JOBS = 16`,
`_UNDO_MAX_DEPTH = 20`.

> A masked **HSV** edit — hue and saturation from the picked colour, **the value channel
> preserved** (every shadow, highlight and texture). Mask edges are **feathered, never
> eroded** (eroding traces every object in the old colour, which reads as a glow).
> A surface covering **< 0.5 %** of the frame is reported as undetected, bilingually.
> **CPU-only, milliseconds.**

---

## 10. Sharing

| Method | Path | Purpose | Output | Auth | Host |
|---|---|---|---|---|---|
| GET | `/share-token/{job_id}` | Mint a 7-day HMAC token (only for a `done` job) | `ShareTokenResponse {token, expires_in_seconds}` | — | API |
| GET | `/share/{token}` | Resolve to the PNG | `FileResponse` | **TOKEN** | API |

---

## 11. System / health / audit

| Method | Path | Purpose | Output | Auth | Host |
|---|---|---|---|---|---|
| GET | `/healthz` | `{ok, version, light_mode, queue_depth}` — **`dev:tunnel` probes this** | plain dict | — | API |
| GET | `/audit` | Newest-first JSONL render metadata (`limit` 1–500) | `AuditEvent[]` | ⚠ **TOKEN only if `DARDESIGN_AUDIT_TOKEN` is set — OPEN by default** | API |
| GET | `/jobs` | Debug listing (`limit=50`); `Job.public()` strips all filesystem paths | `Job[]` | — | API |

---

## 12. Retired async job flow — still mounted, superseded

Kept so old links do not 404. **The live path is `/redesign`.**

| Method | Path | Purpose |
|---|---|---|
| POST | `/upload` | Store bytes, mint a job → `JobIdResponse` |
| POST | `/transform` | Kick off generation as an asyncio task → `JobIdResponse` |
| GET | `/status/{job_id}` | Poll → `StatusResponse` |
| GET | `/result/{job_id}` | The PNG → `FileResponse` |
| POST | `/retry/{job_id}` | Re-run a failed/finished job, optional new style |

Frontend `/transform` and `/result` are `redirect("/studio")` stubs.
`src/lib/api.ts` still exports `uploadImage` / `startTransform` / `pollStatus`.

---

## 13. Pydantic models

`main.py`: `JobIdResponse`, `TransformRequest`, `StatusResponse`, `ShareTokenResponse`,
`RedesignResponse`, `RestyleResponse`, `CandidatePositionsRequest`,
`ValidatePositionRequest`, `ConfirmPlacementRequest`, `RegisterRequest`, `LoginRequest`,
`SaveHistoryRequest`, `SuggestRequest`, `FeedbackRequest`, `SubscriptionDecisionRequest`,
`DesignPlanRequest`.
`recolor_api.py`: `RecolorRequest`, `ColorStateRequest`.

---

## 14. Cross-cutting contracts

| Contract | Detail |
|---|---|
| **Bilingual errors** | Every `HTTPException` carries `{code, message_en, message_ar}`. **There is no client-side error-mapping table.** |
| **Status choices** | `quota_exceeded` **429** (not 403 — the request is permitted and the allowance refills) · `file_too_large` 413 · conflicts 409 · auth 401/403 |
| **`_GEN_LOCK`** | Serialises `/redesign`, `/restyle`, `/transform`, `/render-scene` |
| **Keepalives** | `/redesign`, `/restyle` only |
| **CORS** | `DARDESIGN_ALLOWED_ORIGINS`, default `localhost:3000` + `127.0.0.1:3000`. `*` switches to `allow_origin_regex` with credentials |
| **Upload validation** | Extension allowlist + **magic bytes** + ≤10 MB + ≥256 px + `img.verify()` |
| **Privacy** | `PRIVACY_NOTICE` on every render response; uploads swept after 24 h |

---

## ⚠ 15. The security limitation to state honestly

> **All generation endpoints are unauthenticated:** `/redesign`, `/restyle`, `/transform`,
> `/render-scene`, every `/api/furniture/*` and every `/api/color/*`.
>
> Quota is enforced **only** by the client voluntarily calling `/api/usage/consume` first.
> **Anyone hitting the render backend directly bypasses the weekly allowance.**
>
> The architectural reason is real — the GPU host has no users table and is sent no session
> cookie — but the consequence is a genuine limitation, not a design win.
>
> **`/audit` is also open unless `DARDESIGN_AUDIT_TOKEN` is set.**

→ [20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)
