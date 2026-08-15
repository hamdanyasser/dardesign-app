# 15 — Accounts, Database, Admin

> **No personal user data is reproduced in this document.** Row counts and schema only.

---

## 1. Authentication — `backend/auth.py`

| Property | Value |
|---|---|
| Password hashing | **PBKDF2-SHA256, 200,000 rounds**, 16-byte salt |
| Stored format | `pbkdf2_sha256$<rounds>$<b64salt>$<b64hash>` — **self-describing**, so parameters can change without invalidating existing accounts |
| Verification | `hmac.compare_digest` (constant-time) |
| Session | **Stateless.** Token = `"{user_id}:{expiry}:{hmac_sha256_hex}"`. **There is no session table** |
| Cookie | `dardesign_session`, httpOnly, TTL **7 days** |
| Cookie flags | Over HTTPS: `samesite=none, secure=true`. Otherwise `samesite=lax, secure=false` — decided from `x-forwarded-proto` |
| Signing secret | `DARDESIGN_SECRET`; **without it a per-process random secret is generated and a warning logged** — every restart logs everyone out |

`scripts/run-local-backend.ps1` persists a stable key in `.dardesign-secret` for exactly
this reason.

**Because the cookie is httpOnly, the client cannot read it** — `AuthContext` calls
`fetchMe()` once on boot, which is the only way the browser learns a session exists.
`fetchMe()` never throws; it returns `null` when signed out.

### Roles
`ROLE_USER = "User"`, `ROLE_ADMIN = "Admin"`.

> **The first account ever created becomes Admin:**
> `role = ROLE_ADMIN if db.user_count() == 0 else ROLE_USER`.

`_require_admin` checks the role **server-side on every `/api/admin/*` endpoint**. Hiding
the admin links from non-admins in the sidebar is a convenience only.

---

## 2. Database — `backend/dardesign.db`

SQLite with `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`.
Path from `DARDESIGN_DB` or the default, read at import time.
`connect()` runs `_SCHEMA` then `_migrate` (idempotent `ALTER TABLE` additions).

### `users`
`Id` · `FullName` · `PhoneNumber` · `Email` **UNIQUE COLLATE NOCASE** · `Password`
(a PBKDF2 hash despite the name) · `Role` · `IsSubscribed` · `PlanStartedAt` ·
`PlanExpiryDate` · `NumberOfUses` · `UsageWindowStart` · `CreatedAt`

> `db.list_users` **names its columns**, so the password hash never leaves the database.

### `history`
`Id` · `UserId` → `users` ON DELETE CASCADE · `OldImageUrl` · `NewImageUrl` ·
`IsSuggested` · `Culture` · `Intensity` · `Duration` · **`Ssim`** · **`Lpips`** ·
**`ClipScore`** · **`PredictedCulture`** · `IsEdited` · `IsLight` · `CreatedAt`
Index: `idx_history_user (UserId, CreatedAt DESC)`

> **Evaluation scores are COLUMNS ON THE HISTORY ROW, not a side table.** That is what
> makes deletion total: remove a design and it leaves every average and the confusion
> matrix in the same instant, with no side table to keep in step.
>
> *(`Culture`, `Intensity` and the metric columns arrive via `_migrate` for pre-existing
> databases; the effective shape includes them.)*

### `feedback`
`Id` · **`HistoryId` UNIQUE** → `history` · `UserId` · `Culture` · `Intensity` ·
`CulturalAccuracy` · `ImageQuality` · `RoomPreservation` · `FurniturePlacement` ·
`Comment` · `CreatedAt` · `UpdatedAt`
CHECKs: all three ratings `BETWEEN 1 AND 5`;
`FurniturePlacement IN ('valid','invalid','not_applicable')`
Index: `idx_feedback_culture (Culture, CreatedAt DESC)`

> **`UNIQUE(HistoryId)` makes "one rating per design" a property of the data**, not a
> convention. Submitting again is an upsert.
>
> `FeedbackRequest` deliberately omits user id, culture and intensity — **culture and
> intensity are read off the history row**, so a client cannot mislabel its own rating.

### `subscription_requests`
`Id` · `UserId` · `Status` CHECK `IN ('pending','approved','declined')` · `CreatedAt` ·
`DecidedAt` · `DecidedBy`
Indexes: **partial unique** `idx_subreq_one_pending (UserId) WHERE Status = 'pending'`,
and `idx_subreq_status (Status, CreatedAt DESC)`

> **The partial unique index is what makes "one open request per user" a data guarantee**
> rather than a race-prone application check.

### `evaluation_results`
`Id` · `RoomId` · `Culture` · `SetName` (`'lora'` / `'baseline'`) · `InputPath` ·
`ImagePath` · `Ssim` · `Lpips` · `ClipScore` · `Predicted` · `Correct` · `CreatedAt`
`UNIQUE (RoomId, Culture, SetName)`

Deliberately **unlinked from users and history** — written only by `eval/run_metrics.py`
via `upsert_evaluation_result`. Nothing here touches user data.

### Current row counts (this machine, 2026-08-14)

| Table | Rows |
|---|---|
| `users` | 3 |
| `history` | 4 |
| `feedback` | 2 |
| `subscription_requests` | 2 |
| **`evaluation_results`** | **0** |

→ [16_EVALUATION.md](16_EVALUATION.md) for what this means for measured results.

---

## 3. Saved designs and history

| Endpoint | Behaviour |
|---|---|
| `POST /api/history` | Saves a design. **Queues a background LPIPS/CLIP evaluation when `not edited and not light`** |
| `GET /api/history` | Own designs only |
| `PATCH /api/history/{id}/suggest` | Publish to the shared gallery (owner-only) |
| `GET /api/history/suggested` | **Others' shared designs — the viewer's own are excluded in SQL** |
| `DELETE /api/history/{id}` | Delete own |

**`IsEdited` and `IsLight` are the two flags that keep statistics honest:**

- `IsEdited = 1` — the design was changed by Colour Control or Furniture Placement. Still a
  real design, but **no longer the pipeline's own output**, so it is never measured.
- `IsLight = 1` — a `DARDESIGN_LIGHT` placeholder. **The client reports `light`**, because
  the renderer and the accounts backend can be different hosts. Still a saved design, never
  a timing or model statistic — a tint returns in milliseconds.

**Uploads are swept after 24 h.** Every render response carries:
> `صورك تُحذف تلقائيًا بعد ٢٤ ساعة ما لم تحفظها. | Your photos are automatically deleted after 24 hours unless you save them.`

**Saving is what makes an image durable.**

---

## 4. Ratings

Three 1–5 dimensions plus one categorical:

| Field | Type |
|---|---|
| `CulturalAccuracy` | 1–5 |
| `ImageQuality` | 1–5 |
| `RoomPreservation` | 1–5 |
| `FurniturePlacement` | `valid` / `invalid` / `not_applicable` |
| `Comment` | ≤ 500 chars |

> **There is no "Overall" column.** "Average overall rating" on the dashboard is the mean
> of the three rated dimensions and **is labelled as derived**.

`RatingBadge` is display-only; `FeedbackForm` writes. `/others` shows ratings on published
designs.

---

## 5. Plans and the weekly allowance

**Two plans, one flag.** `users.IsSubscribed` *is* the plan.

| Plan | Flag | Price | Allowance |
|---|---|---|---|
| **Basic** | `0` | Free | **3 designs / week** |
| **Pro** | `1` | **$20 / 30 days** | Unlimited |

**Policy lives in `backend/subscriptions.py`, not in `db.py`:**
```python
PRO_PRICE_USD         = 20
PRO_DURATION_DAYS     = 30
BASIC_WEEKLY_LIMIT    = 3
USAGE_WINDOW_SECONDS  = 7 * 24 * 3600
EXPIRY_INTERVAL_SECONDS = 24 * 3600
```

> `db.py` imports nothing from `subscriptions.py` — **every number is passed in**, so the
> limit changes in one place and the schema has no opinion about it.
>
> `/api/subscription` ships `terms()` to the client, **so the price on the page cannot
> drift from the price enforced.**

### Nobody subscribes themselves

```
POST /api/subscription/request   → writes a subscription_requests row
                                   returns the user's UNCHANGED plan
POST /api/admin/subscriptions/{id}/decision   (admin only)
                                 → sets IsSubscribed, PlanStartedAt,
                                   PlanExpiryDate = now + 30d,
                                   IN ONE TRANSACTION with the verdict
```
A decided request **409s** rather than granting a second 30 days.

> **Unsubscribing is the user's own and is immediate.** An admin gates who *gains* a paid
> plan, not who gives one up.

### The counter is weekly and resets lazily

`NumberOfUses` counts spent generations inside the window opened at `UsageWindowStart`.
A window older than 7 days is **replaced (counter → 0) on the next generation**, so
"3 per week" holds even on a backend that has been down for a month.

Pro **increments the counter too** but is never blocked by it. Returning to Basic (cancel
*or* expiry) **clears the window** — Pro-era generations must not eat into the free week
the user drops back into (`_BACK_TO_BASIC` zeroes both fields).

### `POST /api/usage/consume` — the gate

```python
# db.consume_generation — read, decide and increment under ONE lock,
# in ONE transaction, so two tabs cannot both spend the third use.
allowed = IsSubscribed or uses < limit
```

Called by `/studio` **immediately before** `/redesign`. It is a separate endpoint rather
than a check inside `/redesign` because **renders and accounts can be different backends**
and the GPU host has no users table and is sent no cookie.

**The studio therefore fails CLOSED on `quota_exceeded` / `not_authenticated` and OPEN on
anything else** — an unreachable accounts backend is not the user's overspend.

**A use is spent when a generation starts. There is deliberately no refund endpoint**,
since any client could call it after every render.

> ⚠ **Consequence and honest limitation:** because the generation endpoints themselves are
> unauthenticated, anyone hitting the render backend directly bypasses the allowance.
> → [20_DEFENSE_FACTS_AND_LIMITATIONS.md](20_DEFENSE_FACTS_AND_LIMITATIONS.md)

### Daily expiry service
`subscriptions.start_expiry_service()` — a daemon thread (same shape as the TTL sweeper)
launched from the FastAPI lifespan. Runs `db.expire_subscriptions()` — one UPDATE returning
every plan past its date to Basic.

> **It sweeps once at startup**, so a backend that was down over an expiry date catches up
> on boot. The 24 h interval only decides how *promptly* an expired plan is noticed, never
> *whether* it is.

---

## 6. Decision emails — `backend/mailer.py`

Approving or declining mails the user the verdict — *"Your subscription to the Pro plan has
been accepted/declined"* plus the Arabic, the expiry date on an approval and the weekly
limit on a decline.

| Property | Value |
|---|---|
| Transport | stdlib `smtplib` — **no dependency** |
| Format | Plain text |
| Dispatch | **A FastAPI background task, after the response** |
| Failure mode | `send()` returns a **bool** instead of raising |

> **The admin approved the plan, so the plan is approved — a mail server that is down costs
> the notification, never the decision.**
>
> Only a decision that actually landed queues a mail, so the 409 on a re-decided request
> cannot send a second one.

**Unconfigured is a working mode:** with no `DARDESIGN_SMTP_HOST` the whole message is
written to the log, so the demo and the tests need no mail account. Config via
`DARDESIGN_SMTP_*` (locally a gitignored `.dardesign-smtp`, template
`.dardesign-smtp.example`).

*This is the same design pattern as the LLM planner's rule-based fallback: a missing
external service degrades to a working, honest mode rather than an error.*

---

## 7. Sharing — `backend/share.py`

| Property | Value |
|---|---|
| Token format | `<hex(job_id)>.<hex(exp_epoch)>.<hmac_sha256_hex>` |
| TTL | 7 days |
| Secret | `DARDESIGN_SHARE_SECRET`, else a per-process random (links do not survive restart) |
| Verification | `hmac.compare_digest`, then expiry, then hex-decode |

`GET /share-token/{job_id}` mints (only for a `done` job); `GET /share/{token}` resolves to
the PNG. **The token is the auth** — no session required.

---

## 8. Community — `/others`

`GET /api/history/suggested` returns designs other users published, **excluding the
viewer's own in SQL**. Rendered by `GalleryShell` / `DesignCard` with `RatingBadge`.

Publishing is opt-in per design via `PATCH /api/history/{id}/suggest`, owner-only.

---

## 9. Admin surfaces

| Page | Endpoint | Shows |
|---|---|---|
| `/admin/users` | `GET /api/admin/users` | Every account, its plan, and when it starts and ends. **Basic accounts print "—" for plan dates, never today's date** |
| `/admin/subscriptions` | `GET /api/admin/subscriptions` + `POST .../{id}/decision` | The approve/decline queue |
| `/admin/analytics` | users + evaluation + subscription queue combined | *Not documented in CLAUDE.md.* Marks figures below `PRELIMINARY_BELOW = 12` as preliminary |
| `/evaluation` | `GET /api/admin/evaluation` | The evaluation dashboard → [16](16_EVALUATION.md) |
| `/audit` | `GET /audit` | The render audit trail. ⚠ **Open unless `DARDESIGN_AUDIT_TOKEN` is set** |
| — | `GET /api/admin/feedback` | Stats + by-culture + recent, backing `AdminFeedbackPanel` |

All `/api/admin/*` endpoints check the role **server-side**; `limit` parameters are clamped
(1–200 for feedback/subscriptions, 1–1000 for users, 1–500 for audit).

---

## 10. Error contract

`errors.ApiError(code, http_status, message_en, message_ar)` — **every `HTTPException`
carries all three**, which is why there is no client-side error-mapping table.

| Code | Status | Note |
|---|---|---|
| `quota_exceeded` | **429** | **Not 403** — the request is permitted and the allowance refills |
| `file_too_large` | 413 | |
| `email_taken`, `subscription_pending`, `already_subscribed`, `request_not_pending` | 409 | Conflicts, not failures |
| `not_authenticated`, `bad_credentials` | 401 | Login gives **one message for both bad email and bad password** |
| `forbidden` | 403 | |

---

## 11. Privacy posture

| Control | Implementation |
|---|---|
| Uploads deleted after 24 h unless saved | `ttl_cleanup.start_background_sweeper` |
| Privacy notice on every render response | `PRIVACY_NOTICE` on `RedesignResponse` / `RestyleResponse` |
| Audit logs **metadata only, never image bytes** | `backend/audit.py` |
| Password hash never leaves the DB | `db.list_users` names its columns |
| Filesystem paths never cross the wire | `Job.public()` strips `input_path`, `output_path`, `style_outputs` |
| Own-data isolation | History, feedback and suggest are owner-checked; `/others` excludes self in SQL |

---

Related: [03_BACKEND_ARCHITECTURE.md](03_BACKEND_ARCHITECTURE.md) ·
[16_EVALUATION.md](16_EVALUATION.md) ·
[18_API_ENDPOINT_MAP.md](18_API_ENDPOINT_MAP.md)
