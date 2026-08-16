"""SQLite storage for accounts and saved designs.

Deliberately small: one file, stdlib `sqlite3`, no ORM and no migration tool.
The schema is two tables and the queries are a dozen lines each — an ORM would
be more machinery than the problem needs.

    users     Id, FullName, PhoneNumber, Email, Password, Role,
              IsSubscribed, NumberOfUses, PlanStartedAt, PlanExpiryDate
    history   Id, UserId, OldImageUrl, NewImageUrl, IsSuggested, Culture,
              Intensity, Duration, Ssim
    subscription_requests
              Id, UserId, Status, CreatedAt, DecidedAt, DecidedBy

`Password` stores a PBKDF2 hash, never the password itself — see auth.py.

Threading: FastAPI serves requests from a thread pool, so the connection is
opened with check_same_thread=False and every write goes through one lock.
SQLite handles this fine at demo concurrency; the lock exists to keep writes
serialised rather than to make reads fast.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
# Default: beside this module, inside the checkout. On Colab the checkout is
# deleted and re-cloned every session, which takes every account and rating with
# it — set $DARDESIGN_DB there to a path outside the repo so the data outlives
# the session. Read at import time, so it must be set before backend.main is
# imported (i.e. before uvicorn starts).
DB_PATH = Path(os.environ.get("DARDESIGN_DB") or Path(__file__).resolve().parent / "dardesign.db")

ROLE_USER = "User"
ROLE_ADMIN = "Admin"
ROLES = (ROLE_USER, ROLE_ADMIN)

# Plan vocabulary. Only the names live here — how much Pro costs, how long it
# lasts and how many free generations Basic gets are policy, and belong to
# backend/subscriptions.py, which passes them in.
PLAN_BASIC = "basic"
PLAN_PRO = "pro"

REQUEST_PENDING = "pending"
REQUEST_APPROVED = "approved"
REQUEST_DECLINED = "declined"
REQUEST_STATUSES = (REQUEST_PENDING, REQUEST_APPROVED, REQUEST_DECLINED)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    FullName     TEXT    NOT NULL,
    PhoneNumber  TEXT,
    -- NOCASE so Ali@x.com and ali@x.com cannot both register.
    Email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    Password     TEXT    NOT NULL,
    Role         TEXT    NOT NULL DEFAULT 'User',
    -- Plan. Basic is the default and is simply IsSubscribed = 0; Pro is 1 and
    -- runs until PlanExpiryDate, after which the daily service in
    -- backend/subscriptions.py puts the account back on Basic. Both dates are
    -- unix seconds, like every other timestamp in this file.
    IsSubscribed    INTEGER NOT NULL DEFAULT 0,
    PlanStartedAt   REAL,
    PlanExpiryDate  REAL,
    -- Generations spent inside the current weekly window, and when that window
    -- opened. The counter resets lazily on the first generation after the window
    -- closes, so "3 per week" holds even if the daily service never runs.
    NumberOfUses     INTEGER NOT NULL DEFAULT 0,
    UsageWindowStart REAL,
    CreatedAt    REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId       INTEGER NOT NULL,
    OldImageUrl  TEXT    NOT NULL,
    NewImageUrl  TEXT    NOT NULL,
    IsSuggested  INTEGER NOT NULL DEFAULT 0,
    -- Seconds the generation took, measured by the rendering backend between
    -- the start and end of the run. Null on rows saved before it was recorded.
    Duration     REAL,
    -- Structure preservation vs the input room, 0..1 (backend/quality.py).
    -- Same measure as the offline evaluation suite, so the two are comparable.
    Ssim         REAL,
    -- Perceptual distance to the input, lower = closer. Null until measured:
    -- LPIPS needs model weights that may not be installed.
    Lpips        REAL,
    -- CLIP similarity to this culture's prompt, and CLIP's own 3-way guess at
    -- the culture. Culture vs PredictedCulture is the confusion matrix.
    ClipScore    REAL,
    PredictedCulture TEXT,
    -- 1 when colour control or furniture placement changed the render before it
    -- was saved. Such a design is a real design, but it is no longer the
    -- pipeline's own output, so it is excluded from the evaluation metrics.
    IsEdited     INTEGER NOT NULL DEFAULT 0,
    -- 1 when the render came back from a DARDESIGN_LIGHT backend: a tinted
    -- placeholder produced in milliseconds without a model. Saving one is
    -- legitimate (the demo runs that way), but averaging its duration would
    -- report a generation time two orders of magnitude below any real render,
    -- and its SSIM measures a tint rather than a redesign.
    IsLight      INTEGER NOT NULL DEFAULT 0,
    CreatedAt    REAL    NOT NULL,
    FOREIGN KEY (UserId) REFERENCES users(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_user ON history(UserId, CreatedAt DESC);

-- Upgrade requests awaiting an admin. Subscribing is never something the user
-- does to themselves: clicking "Subscribe" writes a row here, and only an
-- admin's approval touches users.IsSubscribed.
CREATE TABLE IF NOT EXISTS subscription_requests (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId     INTEGER NOT NULL,
    Status     TEXT    NOT NULL DEFAULT 'pending',
    CreatedAt  REAL    NOT NULL,
    DecidedAt  REAL,
    DecidedBy  INTEGER,                -- the admin who approved or declined
    FOREIGN KEY (UserId) REFERENCES users(Id) ON DELETE CASCADE,
    CHECK (Status IN ('pending', 'approved', 'declined'))
);

-- One open request per user, enforced by the data rather than by whoever
-- remembers to check first: two rapid clicks would otherwise queue the same
-- person twice and the admin would decide the same request repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subreq_one_pending
    ON subscription_requests(UserId) WHERE Status = 'pending';

CREATE INDEX IF NOT EXISTS idx_subreq_status ON subscription_requests(Status, CreatedAt DESC);

CREATE TABLE IF NOT EXISTS feedback (
    Id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The generated image being rated IS the history row: that is the only
    -- persisted record of a generation, so feedback hangs off it rather than
    -- introducing a second notion of "image".
    HistoryId          INTEGER NOT NULL UNIQUE,
    UserId             INTEGER NOT NULL,
    -- Copied from the history row at submit time, never from the request body.
    Culture            TEXT,
    Intensity          REAL,
    CulturalAccuracy   INTEGER NOT NULL,
    ImageQuality       INTEGER NOT NULL,
    RoomPreservation   INTEGER NOT NULL,
    FurniturePlacement TEXT    NOT NULL,
    Comment            TEXT,
    CreatedAt          REAL    NOT NULL,
    UpdatedAt          REAL    NOT NULL,
    FOREIGN KEY (HistoryId) REFERENCES history(Id) ON DELETE CASCADE,
    FOREIGN KEY (UserId)    REFERENCES users(Id)   ON DELETE CASCADE,
    -- Enforced here as well as in the API. The API is the only caller today, but
    -- a rating of 7 or a typo'd placement value is the kind of thing that should
    -- be impossible to store, not merely rejected by whoever remembers to check.
    CHECK (CulturalAccuracy  BETWEEN 1 AND 5),
    CHECK (ImageQuality      BETWEEN 1 AND 5),
    CHECK (RoomPreservation  BETWEEN 1 AND 5),
    CHECK (FurniturePlacement IN ('valid', 'invalid', 'not_applicable'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_culture ON feedback(Culture, CreatedAt DESC);

-- Offline evaluation runs. Deliberately its own table, with no link to users or
-- history: an evaluation image is not a design anyone made, and letting these
-- rows anywhere near `history` would silently inflate every user-facing
-- statistic on the dashboard. Nothing outside eval/ reads or writes this.
CREATE TABLE IF NOT EXISTS evaluation_results (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    RoomId     TEXT    NOT NULL,          -- input room identifier, e.g. "room_03"
    Culture    TEXT    NOT NULL,
    -- "lora" = the trained pipeline, "baseline" = prompt-only, so the ablation
    -- is a filter rather than a second table.
    SetName    TEXT    NOT NULL DEFAULT 'lora',
    InputPath  TEXT,
    ImagePath  TEXT,
    Ssim       REAL,
    Lpips      REAL,
    ClipScore  REAL,
    Predicted  TEXT,                      -- CLIP zero-shot 3-way prediction
    Correct    INTEGER,                   -- 1 when Predicted == Culture
    CreatedAt  REAL    NOT NULL,
    -- Re-running the suite updates a row instead of stacking duplicates, so the
    -- averages can't drift upward every time the metrics are recomputed.
    UNIQUE (RoomId, Culture, SetName)
);
"""

# UNIQUE(HistoryId) is what makes "one feedback per generated image" a property of
# the data rather than a race between two in-flight requests.

FURNITURE_PLACEMENT_VALUES = ("valid", "invalid", "not_applicable")
RATING_MIN = 1
RATING_MAX = 5
COMMENT_MAX_LEN = 500

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open (once) and return the shared connection, creating the schema."""
    global _conn
    with _lock:
        if _conn is not None:
            return _conn
        p = Path(path or DB_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(p), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # Enforce the history -> users foreign key; off by default in SQLite.
        conn.execute("PRAGMA foreign_keys = ON")
        # WAL lets reads proceed during a write, which matters because saving a
        # design writes while the history page may be reading.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(_SCHEMA)
        _migrate(conn)
        conn.commit()
        _conn = conn
        logger.info("sqlite ready at %s", p)
        return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive column migrations for tables that already exist in the wild.

    CREATE TABLE IF NOT EXISTS never alters an existing table, so a database
    created before these columns existed would silently keep the old shape.
    Adding them here is idempotent and runs on every connect — cheap, and it
    means no migration command has to be remembered before a demo.

    Culture/Intensity live on `history` rather than on `feedback` because they
    describe the generated image, not the opinion of it: the feedback endpoint
    reads them from the image record so the client cannot claim a design was
    Moroccan when it was Lebanese.
    """
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(history)")}
    for column, ddl in (
        ("Culture", "ALTER TABLE history ADD COLUMN Culture TEXT"),
        ("Intensity", "ALTER TABLE history ADD COLUMN Intensity REAL"),
        ("Duration", "ALTER TABLE history ADD COLUMN Duration REAL"),
        ("Ssim", "ALTER TABLE history ADD COLUMN Ssim REAL"),
        ("Lpips", "ALTER TABLE history ADD COLUMN Lpips REAL"),
        ("ClipScore", "ALTER TABLE history ADD COLUMN ClipScore REAL"),
        ("PredictedCulture", "ALTER TABLE history ADD COLUMN PredictedCulture TEXT"),
        ("IsEdited", "ALTER TABLE history ADD COLUMN IsEdited INTEGER NOT NULL DEFAULT 0"),
        ("IsLight", "ALTER TABLE history ADD COLUMN IsLight INTEGER NOT NULL DEFAULT 0"),
        # The Build Mode scene this render was composed from, verbatim, so a
        # saved design can be REOPENED and kept working on rather than only
        # looked at. A DesignScene is a plain serializable object by design
        # (no class instances, no THREE.* types), which is what makes storing
        # it a column rather than a schema.
        #
        # SceneVersion is stored beside it and is not decoration: loadScene
        # drops any scene whose SCENE_VERSION does not match, so without the
        # version recorded, a future bump would silently orphan every saved
        # scene. Kept separate from the JSON so the check costs no parse.
        #
        # Null for every row saved from Studio, and for every row saved before
        # this column existed — those are renders of a photograph, not scenes,
        # and there is nothing to reopen.
        ("SceneJson", "ALTER TABLE history ADD COLUMN SceneJson TEXT"),
        ("SceneVersion", "ALTER TABLE history ADD COLUMN SceneVersion INTEGER"),
        # The OTHER cultures rendered in the same /redesign run, as JSON:
        # [{"culture": "khaleeji", "url": "/images/…png"}, …]. A three-culture
        # generation produces three images of one room, and saving only the
        # featured one threw the other two away the moment the tab was closed.
        #
        # Deliberately a column on the design rather than extra history rows.
        # A history row IS the evaluation record — one Culture, one Ssim, one
        # PredictedCulture, one Duration — so three rows per run would triple
        # the same generation's duration inside "average generation time" and
        # count one room as three in roomsGenerated. These are companions to
        # the design, kept so the user can see what else the room could be;
        # they are not separately measured and must never be treated as such.
        ("SiblingImages", "ALTER TABLE history ADD COLUMN SiblingImages TEXT"),
    ):
        if column not in existing:
            conn.execute(ddl)
            logger.info("migrated: history.%s added", column)

    # Plan columns on accounts that predate subscriptions. The defaults put every
    # existing user on Basic with a fresh allowance, which is what they had.
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    for column, ddl in (
        ("IsSubscribed", "ALTER TABLE users ADD COLUMN IsSubscribed INTEGER NOT NULL DEFAULT 0"),
        ("PlanStartedAt", "ALTER TABLE users ADD COLUMN PlanStartedAt REAL"),
        ("PlanExpiryDate", "ALTER TABLE users ADD COLUMN PlanExpiryDate REAL"),
        ("NumberOfUses", "ALTER TABLE users ADD COLUMN NumberOfUses INTEGER NOT NULL DEFAULT 0"),
        ("UsageWindowStart", "ALTER TABLE users ADD COLUMN UsageWindowStart REAL"),
    ):
        if column not in existing:
            conn.execute(ddl)
            logger.info("migrated: users.%s added", column)


def close() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def _query(sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, tuple(args)).fetchall()


def _write(sql: str, args: Iterable[Any] = ()) -> int:
    conn = connect()
    with _lock:
        cur = conn.execute(sql, tuple(args))
        conn.commit()
        return cur.lastrowid


# ---------------------------------------------------------------- users


class EmailTaken(Exception):
    """Raised instead of surfacing a raw UNIQUE-constraint error."""


def create_user(
    full_name: str, phone: str | None, email: str, password_hash: str, role: str = ROLE_USER
) -> int:
    if role not in ROLES:
        role = ROLE_USER
    try:
        return _write(
            "INSERT INTO users (FullName, PhoneNumber, Email, Password, Role, CreatedAt)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (full_name.strip(), (phone or "").strip() or None, email.strip(), password_hash,
             role, time.time()),
        )
    except sqlite3.IntegrityError as e:
        if "UNIQUE" in str(e).upper():
            raise EmailTaken(email) from e
        raise


def get_user_by_email(email: str) -> sqlite3.Row | None:
    rows = _query("SELECT * FROM users WHERE Email = ?", (email.strip(),))
    return rows[0] if rows else None


def get_user(user_id: int) -> sqlite3.Row | None:
    rows = _query("SELECT * FROM users WHERE Id = ?", (user_id,))
    return rows[0] if rows else None


def user_count() -> int:
    return int(_query("SELECT COUNT(*) AS n FROM users")[0]["n"])


def plan_name(row: sqlite3.Row) -> str:
    """Which plan a user row is on. IsSubscribed is the whole distinction."""
    return PLAN_PRO if row["IsSubscribed"] else PLAN_BASIC


def public_user(row: sqlite3.Row) -> dict:
    """User fields safe to send to the client — never the password hash."""
    return {
        "id": row["Id"],
        "fullName": row["FullName"],
        "phoneNumber": row["PhoneNumber"],
        "email": row["Email"],
        "role": row["Role"],
        # Plan, so the navbar and the studio can reflect it without a second
        # call. The authoritative allowance still comes from /api/subscription.
        "plan": plan_name(row),
        "isSubscribed": bool(row["IsSubscribed"]),
        "numberOfUses": int(row["NumberOfUses"] or 0),
        "planExpiryDate": row["PlanExpiryDate"],
    }


# --------------------------------------------------------- plans and usage


def _usage_window(row: sqlite3.Row, window_seconds: float, now: float) -> tuple[int, float]:
    """The user's spent generations and window start, after any rollover.

    Pure and lazy: a window older than `window_seconds` is simply replaced by a
    new one starting now, with the counter back at zero. Doing it on read means
    the weekly allowance is correct even on a backend that has been down for a
    month, instead of depending on a scheduled job having fired.
    """
    start = row["UsageWindowStart"]
    if start is None or now - float(start) >= window_seconds:
        return 0, now
    return int(row["NumberOfUses"] or 0), float(start)


def _usage_payload(
    row: sqlite3.Row, uses: int, window_start: float, *, limit: int, window_seconds: float
) -> dict:
    """The plan and allowance as the client sees it.

    Pro reports `limit`/`remaining` as null rather than a large number: the plan
    is unlimited, and a number would invite the UI to render a countdown for
    something that never counts down.
    """
    subscribed = bool(row["IsSubscribed"])
    return {
        "plan": plan_name(row),
        "isSubscribed": subscribed,
        "planStartedAt": row["PlanStartedAt"],
        "planExpiryDate": row["PlanExpiryDate"],
        "numberOfUses": uses,
        "limit": None if subscribed else limit,
        "remaining": None if subscribed else max(0, limit - uses),
        "windowStart": window_start,
        # When the free allowance refills. Meaningless for Pro, hence null.
        "windowEnds": None if subscribed else window_start + window_seconds,
    }


def usage_state(
    user_id: int, *, limit: int, window_seconds: float, now: float | None = None
) -> dict | None:
    """Read-only view of a user's plan and remaining allowance.

    Never writes, so merely looking at the subscription page cannot roll the
    window forward — the reset is persisted by the next actual generation.
    """
    now = time.time() if now is None else now
    row = get_user(user_id)
    if row is None:
        return None
    uses, window_start = _usage_window(row, window_seconds, now)
    return _usage_payload(row, uses, window_start, limit=limit, window_seconds=window_seconds)


def consume_generation(
    user_id: int, *, limit: int, window_seconds: float, now: float | None = None
) -> dict | None:
    """Spend one generation against the weekly allowance.

    The returned payload carries `allowed`: False means the free allowance is
    gone and nothing was counted. Read, decide and increment happen inside one
    lock and one transaction, so two tabs cannot both spend the third use of the
    week — the check and the write cannot be separated.

    A use is spent when a generation *starts*, not when it succeeds. Refunding a
    failed render would mean an endpoint that decrements the counter, and any
    client could call it after every generation.
    """
    now = time.time() if now is None else now
    conn = connect()
    with _lock:
        row = conn.execute("SELECT * FROM users WHERE Id = ?", (user_id,)).fetchone()
        if row is None:
            return None
        uses, window_start = _usage_window(row, window_seconds, now)
        allowed = bool(row["IsSubscribed"]) or uses < limit
        if allowed:
            uses += 1
            conn.execute(
                "UPDATE users SET NumberOfUses = ?, UsageWindowStart = ? WHERE Id = ?",
                (uses, window_start, user_id),
            )
            conn.commit()
        payload = _usage_payload(
            row, uses, window_start, limit=limit, window_seconds=window_seconds
        )
    payload["allowed"] = allowed
    return payload


# Going back to Basic also clears the usage window. Generations made on Pro are
# counted (NumberOfUses increments on every plan), so without this a user leaving
# Pro would land on Basic with the week's three already spent by usage the limit
# never applied to.
_BACK_TO_BASIC = (
    "UPDATE users SET IsSubscribed = 0, PlanStartedAt = NULL, PlanExpiryDate = NULL,"
    " NumberOfUses = 0, UsageWindowStart = NULL"
)


def end_subscription(user_id: int) -> bool:
    """Return one account to Basic. False when it was already Basic."""
    conn = connect()
    with _lock:
        cur = conn.execute(f"{_BACK_TO_BASIC} WHERE Id = ? AND IsSubscribed = 1", (user_id,))
        conn.commit()
        return cur.rowcount > 0


def expire_subscriptions(now: float | None = None) -> int:
    """Return every Pro account whose plan has run out to Basic. Returns how many.

    One UPDATE over the whole table rather than a row-by-row scan: whether this
    runs every day or once a fortnight, the result is the same.
    """
    now = time.time() if now is None else now
    conn = connect()
    with _lock:
        cur = conn.execute(
            f"{_BACK_TO_BASIC}"
            " WHERE IsSubscribed = 1 AND PlanExpiryDate IS NOT NULL AND PlanExpiryDate <= ?",
            (now,),
        )
        conn.commit()
        return cur.rowcount


# ------------------------------------------------------ subscription requests


class PendingRequestExists(Exception):
    """Raised instead of surfacing the partial-unique-index violation."""


def create_subscription_request(user_id: int) -> int:
    try:
        return _write(
            "INSERT INTO subscription_requests (UserId, Status, CreatedAt) VALUES (?, ?, ?)",
            (user_id, REQUEST_PENDING, time.time()),
        )
    except sqlite3.IntegrityError as e:
        if "UNIQUE" in str(e).upper():
            raise PendingRequestExists(user_id) from e
        raise


def pending_subscription_request(user_id: int) -> sqlite3.Row | None:
    rows = _query(
        "SELECT * FROM subscription_requests WHERE UserId = ? AND Status = ?",
        (user_id, REQUEST_PENDING),
    )
    return rows[0] if rows else None


def public_subscription_request(r: sqlite3.Row) -> dict:
    keys = r.keys()
    out = {
        "id": r["Id"],
        "userId": r["UserId"],
        "status": r["Status"],
        "createdAt": r["CreatedAt"],
        "decidedAt": r["DecidedAt"],
    }
    # Present only on the admin listing, which joins the account in — the user's
    # own view of their request has no need for their name back.
    if "FullName" in keys:
        out.update({
            "fullName": r["FullName"],
            "email": r["Email"],
            "phoneNumber": r["PhoneNumber"],
            "plan": plan_name(r),
            "planExpiryDate": r["PlanExpiryDate"],
        })
    return out


def list_subscription_requests(status: str | None = None, limit: int = 100) -> list[dict]:
    """Requests for the admin queue — pending first, then newest.

    Decided requests stay in the list so the admin can see what was already
    actioned rather than having a row vanish on approval.
    """
    where, args = ("", [])
    if status:
        where, args = (" WHERE r.Status = ?", [status])
    rows = _query(
        "SELECT r.*, u.FullName, u.Email, u.PhoneNumber, u.IsSubscribed, u.PlanExpiryDate"
        " FROM subscription_requests r JOIN users u ON u.Id = r.UserId"
        f"{where}"
        " ORDER BY (r.Status = 'pending') DESC, r.CreatedAt DESC LIMIT ?",
        [*args, limit],
    )
    return [public_subscription_request(r) for r in rows]


def decide_subscription_request(
    request_id: int, admin_id: int, approve: bool, *, duration_days: int
) -> dict | None:
    """Approve or decline one pending request.

    Returns None when the request does not exist or was already decided, which is
    what stops a double-click from granting two consecutive 30-day plans. The
    decision and the plan change are one transaction: an approval that recorded
    the verdict but not the subscription would leave a user who was told yes on
    the Basic plan.
    """
    now = time.time()
    conn = connect()
    with _lock:
        cur = conn.execute(
            "UPDATE subscription_requests SET Status = ?, DecidedAt = ?, DecidedBy = ?"
            " WHERE Id = ? AND Status = ?",
            (REQUEST_APPROVED if approve else REQUEST_DECLINED, now, admin_id,
             request_id, REQUEST_PENDING),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return None
        row = conn.execute(
            "SELECT * FROM subscription_requests WHERE Id = ?", (request_id,)
        ).fetchone()
        if approve:
            # Pro starts now and runs for exactly `duration_days`. Stored rather
            # than derived, so the admin's Users view reads the dates back
            # instead of recomputing them from a policy that may have changed.
            conn.execute(
                "UPDATE users SET IsSubscribed = 1, PlanStartedAt = ?, PlanExpiryDate = ?"
                " WHERE Id = ?",
                (now, now + duration_days * 86400, row["UserId"]),
            )
        conn.commit()
    return public_subscription_request(row)


def list_users(limit: int = 500) -> list[dict]:
    """Every account with its plan, for the admin Users view.

    No password hash, by omission in the SELECT rather than by filtering after
    the fact. `numberOfUses` is the raw stored counter: a window that has since
    rolled over reads as spent until the user's next generation resets it, so
    the caller is given `usageWindowStart` to say so.
    """
    rows = _query(
        "SELECT u.Id, u.FullName, u.PhoneNumber, u.Email, u.Role, u.IsSubscribed,"
        " u.PlanStartedAt, u.PlanExpiryDate, u.NumberOfUses, u.UsageWindowStart, u.CreatedAt,"
        " (SELECT COUNT(*) FROM history h WHERE h.UserId = u.Id) AS Designs"
        " FROM users u ORDER BY u.IsSubscribed DESC, u.Id LIMIT ?",
        (limit,),
    )
    return [
        {
            "id": r["Id"],
            "fullName": r["FullName"],
            "phoneNumber": r["PhoneNumber"],
            "email": r["Email"],
            "role": r["Role"],
            "plan": plan_name(r),
            "isSubscribed": bool(r["IsSubscribed"]),
            "planStartedAt": r["PlanStartedAt"],
            "planExpiryDate": r["PlanExpiryDate"],
            "numberOfUses": int(r["NumberOfUses"] or 0),
            "usageWindowStart": r["UsageWindowStart"],
            "designsSaved": int(r["Designs"] or 0),
            "createdAt": r["CreatedAt"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------- history


def add_history(
    user_id: int,
    old_url: str,
    new_url: str,
    is_suggested: bool = False,
    culture: str | None = None,
    intensity: float | None = None,
    duration: float | None = None,
    ssim: float | None = None,
    is_edited: bool = False,
    is_light: bool = False,
    scene_json: str | None = None,
    scene_version: int | None = None,
    sibling_images: str | None = None,
) -> int:
    """Save one design. `culture`/`intensity` describe how it was generated and
    become the trusted source for anything that rates this image later.
    `duration` is the generation time in seconds, measured by the renderer.
    `is_light` marks a DARDESIGN_LIGHT placeholder — kept as a design, kept out
    of every model and timing statistic.

    `scene_json` is the Build Mode scene this render was composed from, stored
    verbatim so the design can be reopened and edited. `scene_version` is kept
    alongside it because loadScene refuses a scene whose version it does not
    recognise — storing it lets the client say so instead of failing silently.
    Both are null for a Studio design, which is a render of a photograph and
    has no scene behind it.

    `sibling_images` is the JSON list of the other cultures rendered in the same
    run. They belong to this design as companions, not as designs of their own:
    `culture`, `ssim` and `duration` continue to describe THIS image alone, so
    nothing measured here changes when a run produced three."""
    return _write(
        "INSERT INTO history (UserId, OldImageUrl, NewImageUrl, IsSuggested, Culture,"
        " Intensity, Duration, Ssim, IsEdited, IsLight, SceneJson, SceneVersion,"
        " SiblingImages, CreatedAt)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, old_url, new_url, 1 if is_suggested else 0, culture, intensity,
         duration, ssim, 1 if is_edited else 0, 1 if is_light else 0,
         scene_json, scene_version, sibling_images, time.time()),
    )


def history_generation_stats(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """Rooms generated, how long they took, and what they measured.

    Two populations, deliberately, and the response names both so the dashboard
    never has to guess which denominator a figure used:

      * `roomsGenerated` — every design saved inside the filters. This is "what
        did people make", so an edited or preview design still counts.
      * everything else — the pipeline's own unedited, non-placeholder output.
        A colour-corrected render measures the edit, and a DARDESIGN_LIGHT tint
        returns in milliseconds; averaging either into generation time or SSIM
        reports something the model never did.

    Each average divides by the rows that *have* the value, not by the row
    count, and ships its own sample size: rows saved before a column existed are
    null, and counting them in a denominator drags every figure toward zero.
    """
    where_all, args_all = _history_filters(culture, since, until)
    totals = _query(
        "SELECT COUNT(*) AS saved,"
        " SUM(CASE WHEN IsEdited = 1 THEN 1 ELSE 0 END) AS edited,"
        " SUM(CASE WHEN IsLight = 1 AND IsEdited = 0 THEN 1 ELSE 0 END) AS light"
        f" FROM history{where_all}",
        args_all,
    )[0]

    where, args = _history_filters(culture, since, until, pipeline_only=True)
    row = _query(
        "SELECT COUNT(*) AS rooms, SUM(Duration) AS totalSeconds,"
        " COUNT(Duration) AS timed, MIN(Duration) AS minSeconds, MAX(Duration) AS maxSeconds,"
        " AVG(Ssim) AS avgSsim, COUNT(Ssim) AS measured,"
        " AVG(Lpips) AS avgLpips, COUNT(Lpips) AS lpipsMeasured,"
        " AVG(ClipScore) AS avgClip, COUNT(ClipScore) AS clipMeasured"
        f" FROM history{where}",
        args,
    )[0]
    rooms = int(row["rooms"] or 0)
    timed = int(row["timed"] or 0)
    total = float(row["totalSeconds"]) if row["totalSeconds"] is not None else None

    def num(key: str) -> float | None:
        v = row[key]
        return round(float(v), 1) if v is not None else None

    return {
        # Every design saved inside the filters, edits and placeholders included:
        # a recoloured render is still a room somebody generated.
        "roomsGenerated": int(totals["saved"] or 0),
        # The corpus every figure below is drawn from, so a card printing an
        # average can print the population it came from beside it.
        "evaluableDesigns": rooms,
        "editedExcluded": int(totals["edited"] or 0),
        "lightExcluded": int(totals["light"] or 0),
        "averageSeconds": round(total / timed, 1) if timed else None,
        "totalSeconds": round(total, 1) if total is not None else None,
        "fastestSeconds": num("minSeconds"),
        "slowestSeconds": num("maxSeconds"),
        "sampleSize": timed,
        # Structure preservation over the designs that carry a measurement.
        "averageSsim": round(float(row["avgSsim"]), 3) if row["avgSsim"] is not None else None,
        "ssimSampleSize": int(row["measured"] or 0),
        "averageLpips": round(float(row["avgLpips"]), 3) if row["avgLpips"] is not None else None,
        "lpipsSampleSize": int(row["lpipsMeasured"] or 0),
        "averageClipScore": round(float(row["avgClip"]), 3) if row["avgClip"] is not None else None,
        "clipSampleSize": int(row["clipMeasured"] or 0),
    }


def evaluation_coverage(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """How complete the evaluation data is, over the same filtered corpus.

    The honest companion to the averages: "SSIM 6/6, ratings 4/6" says at a
    glance that the cultural score rests on four opinions while the structural
    one rests on six. Without it two figures printed side by side look equally
    well supported.

    Counted from the rows themselves — a design deleted from history leaves both
    the numerator and the denominator in the same instant.
    """
    where, args = _history_filters(culture, since, until, pipeline_only=True, alias="h")
    row = _query(
        "SELECT COUNT(*) AS total, COUNT(h.Ssim) AS ssim, COUNT(h.Lpips) AS lpips,"
        " COUNT(h.ClipScore) AS clip, COUNT(h.PredictedCulture) AS predicted,"
        " COUNT(h.Duration) AS timed, COUNT(f.Id) AS rated"
        " FROM history h LEFT JOIN feedback f ON f.HistoryId = h.Id"
        f"{where}",
        args,
    )[0]
    total = int(row["total"] or 0)
    return {
        "total": total,
        "ssim": int(row["ssim"] or 0),
        "lpips": int(row["lpips"] or 0),
        "clip": int(row["clip"] or 0),
        "predicted": int(row["predicted"] or 0),
        "timed": int(row["timed"] or 0),
        "rated": int(row["rated"] or 0),
    }


def set_history_evaluation(
    entry_id: int,
    *,
    lpips: float | None,
    clip_score: float | None,
    predicted_culture: str | None,
    ssim: float | None = None,
) -> None:
    """Attach measured metrics to a saved design.

    Stored on the row itself rather than in a side table, which is what makes
    deletion automatic: remove the design and every metric, and its contribution
    to the confusion matrix, goes with it. `ssim` is only written when supplied,
    so a backfill cannot erase a value recorded at generation time.
    """
    sets = ["Lpips = ?", "ClipScore = ?", "PredictedCulture = ?"]
    args: list[Any] = [lpips, clip_score, predicted_culture]
    if ssim is not None:
        sets.append("Ssim = ?")
        args.append(ssim)
    args.append(entry_id)
    _write(f"UPDATE history SET {', '.join(sets)} WHERE Id = ?", args)


def history_needing_evaluation(limit: int = 500) -> list[dict]:
    """Saved designs with no perceptual metrics yet.

    Edited designs are skipped: colour control and furniture placement change
    the image after generation, so measuring one would score the edit rather
    than the pipeline. LIGHT placeholders are skipped for the same reason —
    measuring a tint against its input is a number about the tint.
    """
    rows = _query(
        "SELECT Id, OldImageUrl, NewImageUrl, Culture, Ssim FROM history"
        " WHERE IsEdited = 0 AND IsLight = 0 AND (Lpips IS NULL OR ClipScore IS NULL)"
        " ORDER BY Id DESC LIMIT ?",
        (limit,),
    )
    return [
        {"id": r["Id"], "oldImageUrl": r["OldImageUrl"],
         "newImageUrl": r["NewImageUrl"], "culture": r["Culture"], "ssim": r["Ssim"]}
        for r in rows
    ]


def designs_by_culture(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> list[dict]:
    """How many designs were saved for each intended culture.

    Deliberately NOT `culture_confusion().rowTotals`, which the analytics pie
    used to read. That matrix requires `PredictedCulture IS NOT NULL`, so it
    counts only designs CLIP has already classified — and CLIP scoring needs
    `lpips` + `open_clip_torch`, which a machine running the demo need not have.
    A room the user generated and saved is a fact about the room; whether a
    classifier has since looked at it is a fact about the install.

    Counted over every saved design in the filters, not `pipeline_only`, so this
    sums to `history_generation_stats()['roomsGenerated']` — the pie and the
    "saved designs" card sit on the same page and must agree.
    """
    where, args = _history_filters(culture, since, until)
    # `_history_filters` returns "" when nothing is filtered, so the keyword has
    # to be chosen rather than assumed. (culture_confusion can append a bare
    # " AND ..." only because it always passes pipeline_only=True, which
    # guarantees a clause; this query has no such guarantee.)
    joiner = " AND " if where else " WHERE "
    rows = _query(
        "SELECT Culture AS culture, COUNT(*) AS total"
        f" FROM history{where}{joiner}Culture IS NOT NULL"
        " GROUP BY Culture ORDER BY total DESC",
        args,
    )
    return [{"culture": r["culture"], "total": int(r["total"])} for r in rows]


def culture_confusion(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """Intended culture vs CLIP's zero-shot prediction, over saved designs.

    This is a *model* recognition result, not a human judgement, so it is drawn
    from the same pipeline-only corpus as SSIM/LPIPS/CLIP — a recoloured render
    that CLIP no longer recognises would otherwise be charged to the generator.

    Reads live from `history`, so a deleted design leaves the matrix in the same
    instant it leaves the gallery — there is no second copy to keep in step.
    Selecting a culture keeps that culture's row: the question becomes "what is
    Lebanese mistaken for", which is exactly the per-culture read.

    `rowTotals` is returned rather than left to the caller so the count and the
    percentage in each cell are divided by the same number the backend used.
    """
    where, args = _history_filters(culture, since, until, pipeline_only=True)
    rows = _query(
        "SELECT Culture AS intended, PredictedCulture AS predicted, COUNT(*) AS n"
        f" FROM history{where}"
        " AND Culture IS NOT NULL AND PredictedCulture IS NOT NULL"
        " GROUP BY Culture, PredictedCulture",
        args,
    )
    matrix: dict[str, dict[str, int]] = {}
    row_totals: dict[str, int] = {}
    total = correct = 0
    for r in rows:
        n = int(r["n"])
        matrix.setdefault(r["intended"], {})[r["predicted"]] = n
        row_totals[r["intended"]] = row_totals.get(r["intended"], 0) + n
        total += n
        if r["intended"] == r["predicted"]:
            correct += n
    return {
        "matrix": matrix,
        "rowTotals": row_totals,
        "total": total,
        "correct": correct,
        # None rather than 0 when nothing is classified: an accuracy of zero is a
        # result, and "not measured" is not.
        "accuracy": round(correct / total, 3) if total else None,
    }


# ------------------------------------------------------- evaluation results
#
# Written only by eval/run_metrics.py. Kept out of every user-facing statistic
# on purpose: these images were generated by the evaluation harness, not by a
# user, so counting them as rooms generated or as a most-used culture would
# misreport the product's actual use.


def upsert_evaluation_result(
    *,
    room_id: str,
    culture: str,
    set_name: str = "lora",
    input_path: str | None = None,
    image_path: str | None = None,
    ssim: float | None = None,
    lpips: float | None = None,
    clip_score: float | None = None,
    predicted: str | None = None,
    correct: bool | None = None,
) -> int:
    """Record one evaluated image, or update it in place on a re-run."""
    return _write(
        "INSERT INTO evaluation_results (RoomId, Culture, SetName, InputPath, ImagePath,"
        " Ssim, Lpips, ClipScore, Predicted, Correct, CreatedAt)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(RoomId, Culture, SetName) DO UPDATE SET"
        "   InputPath = excluded.InputPath, ImagePath = excluded.ImagePath,"
        "   Ssim = excluded.Ssim, Lpips = excluded.Lpips, ClipScore = excluded.ClipScore,"
        "   Predicted = excluded.Predicted, Correct = excluded.Correct,"
        "   CreatedAt = excluded.CreatedAt",
        (room_id, culture, set_name, input_path, image_path, ssim, lpips, clip_score,
         predicted, None if correct is None else (1 if correct else 0), time.time()),
    )


def list_evaluation_results(set_name: str | None = None, limit: int = 500) -> list[dict]:
    where, args = ("", [])
    if set_name:
        where, args = (" WHERE SetName = ?", [set_name])
    rows = _query(
        f"SELECT * FROM evaluation_results{where} ORDER BY RoomId, Culture LIMIT ?",
        [*args, limit],
    )
    return [
        {
            "id": r["Id"], "roomId": r["RoomId"], "culture": r["Culture"],
            "set": r["SetName"], "inputPath": r["InputPath"], "imagePath": r["ImagePath"],
            "ssim": r["Ssim"], "lpips": r["Lpips"], "clipScore": r["ClipScore"],
            "predicted": r["Predicted"],
            "correct": None if r["Correct"] is None else bool(r["Correct"]),
            "createdAt": r["CreatedAt"],
        }
        for r in rows
    ]


def evaluation_summary() -> list[dict]:
    """Per set and culture: mean metrics and 3-way cultural accuracy."""
    rows = _query(
        "SELECT SetName AS setName, Culture AS culture, COUNT(*) AS images,"
        " AVG(Ssim) AS ssim, AVG(Lpips) AS lpips, AVG(ClipScore) AS clipScore,"
        " AVG(Correct) AS accuracy"
        " FROM evaluation_results GROUP BY SetName, Culture ORDER BY SetName, Culture"
    )

    def r3(v) -> float | None:
        return round(float(v), 3) if v is not None else None

    return [
        {
            "set": r["setName"], "culture": r["culture"], "images": int(r["images"]),
            "ssim": r3(r["ssim"]), "lpips": r3(r["lpips"]), "clipScore": r3(r["clipScore"]),
            "accuracy": r3(r["accuracy"]),
        }
        for r in rows
    ]


def _history_filters(
    culture: str | None = None,
    since: float | None = None,
    until: float | None = None,
    *,
    pipeline_only: bool = False,
    alias: str = "",
) -> tuple[str, list[Any]]:
    """The one WHERE clause every dashboard query over `history` is built from.

    One helper rather than a clause per query is what makes the evaluation
    dashboard's filters trustworthy: the KPI cards, the model metrics, the
    coverage counts and the confusion matrix are then reading provably the same
    population, because they are reading the same SQL. The previous version
    took only dates, which is why selecting a culture moved the rating panels
    and left every history-derived figure showing the global number.

    `pipeline_only` narrows to designs that are the pipeline's own output: no
    colour or furniture edit, and not a DARDESIGN_LIGHT placeholder. Anything
    describing model quality or generation speed sets it; a count of what users
    actually saved does not.

    `alias` qualifies the columns for queries that join another table — without
    it `Culture` and `CreatedAt` are ambiguous against `feedback`.
    """
    p = f"{alias}." if alias else ""
    clauses: list[str] = []
    args: list[Any] = []
    if culture:
        clauses.append(f"{p}Culture = ?")
        args.append(culture)
    if since is not None:
        clauses.append(f"{p}CreatedAt >= ?")
        args.append(since)
    if until is not None:
        clauses.append(f"{p}CreatedAt <= ?")
        args.append(until)
    if pipeline_only:
        clauses.append(f"{p}IsEdited = 0")
        clauses.append(f"{p}IsLight = 0")
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), args


def list_history(user_id: int, limit: int = 100) -> list[dict]:
    """A user's saved designs, newest first. Scoped by UserId at the query —
    history is per-account and must never leak across users."""
    rows = _query(
        # LEFT JOIN so an unrated design still comes back — the caller shows a
        # "not rated" state rather than dropping the row.
        "SELECT h.*,"
        " f.CulturalAccuracy AS RatingCultural,"
        " f.ImageQuality AS RatingQuality,"
        " f.RoomPreservation AS RatingPreservation,"
        # The owner's own listing carries the whole record. The shared gallery
        # selects the three scores alone, which is what keeps a written comment
        # out of it — an omission in the SQL, not a filter in the UI.
        " f.FurniturePlacement AS RatingPlacement,"
        " f.Comment AS RatingComment,"
        " f.UpdatedAt AS RatingUpdatedAt"
        " FROM history h LEFT JOIN feedback f ON f.HistoryId = h.Id"
        " WHERE h.UserId = ? ORDER BY h.CreatedAt DESC LIMIT ?",
        (user_id, limit),
    )
    return [_history_row(r) for r in rows]


def get_history_scene(entry_id: int, user_id: int) -> dict | None:
    """The stored Build Mode scene for one design, or None.

    Scoped by UserId in the WHERE clause, not filtered after the fetch: a scene
    is the full layout of someone's room and must never come back for another
    account's row. Same discipline as list_history.

    Returns the version alongside the JSON so the caller can refuse a format it
    does not understand instead of handing the client a scene loadScene will
    silently drop.
    """
    rows = _query(
        "SELECT SceneJson, SceneVersion FROM history WHERE Id = ? AND UserId = ?",
        (entry_id, user_id),
    )
    if not rows or not rows[0]["SceneJson"]:
        return None
    return {"scene": rows[0]["SceneJson"], "version": rows[0]["SceneVersion"]}


def get_history_entry(entry_id: int) -> sqlite3.Row | None:
    rows = _query("SELECT * FROM history WHERE Id = ?", (entry_id,))
    return rows[0] if rows else None


def delete_history(entry_id: int, user_id: int) -> bool:
    """Delete one entry, scoped to its owner. Returns False if it wasn't theirs."""
    conn = connect()
    with _lock:
        cur = conn.execute(
            "DELETE FROM history WHERE Id = ? AND UserId = ?", (entry_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def set_suggested(entry_id: int, user_id: int, value: bool) -> bool:
    """Publish (or unpublish) one entry to the shared gallery.

    Scoped to the owner: only the person who saved a design may choose to share
    it. Returns False when the entry isn't theirs, which the caller surfaces as a
    404 so ids can't be probed.
    """
    conn = connect()
    with _lock:
        cur = conn.execute(
            "UPDATE history SET IsSuggested = ? WHERE Id = ? AND UserId = ?",
            (1 if value else 0, entry_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0


def list_suggested(exclude_user_id: int | None = None, limit: int = 100) -> list[dict]:
    """Designs other people chose to share, newest first.

    Carries the design's rating, including the author's written comment: sharing
    is opt-in per design, and the note is shown as part of what was shared.

    `exclude_user_id` leaves the viewer's own work out — this gallery is for
    seeing what others made. Only IsSuggested rows are ever returned, so nothing
    a user kept private can appear here.
    """
    if exclude_user_id is None:
        rows = _query(
            "SELECT h.*, u.FullName AS AuthorName,"
            " f.CulturalAccuracy AS RatingCultural,"
            " f.ImageQuality AS RatingQuality,"
            " f.RoomPreservation AS RatingPreservation,"
            " f.Comment AS RatingComment"
            " FROM history h LEFT JOIN users u ON u.Id = h.UserId"
            " LEFT JOIN feedback f ON f.HistoryId = h.Id"
            " WHERE h.IsSuggested = 1 ORDER BY h.CreatedAt DESC LIMIT ?",
            (limit,),
        )
    else:
        rows = _query(
            "SELECT h.*, u.FullName AS AuthorName,"
            " f.CulturalAccuracy AS RatingCultural,"
            " f.ImageQuality AS RatingQuality,"
            " f.RoomPreservation AS RatingPreservation,"
            " f.Comment AS RatingComment"
            " FROM history h LEFT JOIN users u ON u.Id = h.UserId"
            " LEFT JOIN feedback f ON f.HistoryId = h.Id"
            " WHERE h.IsSuggested = 1 AND h.UserId != ? ORDER BY h.CreatedAt DESC LIMIT ?",
            (exclude_user_id, limit),
        )
    out = []
    for r in rows:
        d = _history_row(r)
        # First name only: the gallery is public to signed-in users, so it
        # shouldn't hand out everyone's full name.
        author = (r["AuthorName"] or "").strip()
        d["authorName"] = author.split(" ")[0] if author else None
        out.append(d)
    return out


def _rating_from_row(r: sqlite3.Row) -> dict | None:
    """The design's existing rating, from a joined feedback row.

    Reads the same three columns the rating form already writes — no second
    record, no separate scoring. `overall` is their mean, the same derivation the
    evaluation dashboard uses, because the form never asked for an overall score.
    """
    keys = r.keys()
    if "RatingCultural" not in keys or r["RatingCultural"] is None:
        return None
    cultural = int(r["RatingCultural"])
    quality = int(r["RatingQuality"])
    preservation = int(r["RatingPreservation"])
    out = {
        "culturalAccuracy": cultural,
        "imageQuality": quality,
        "roomPreservation": preservation,
        "overall": round((cultural + quality + preservation) / 3, 2),
    }
    # Each caller decides how much of the record it selects, so what a listing
    # exposes is visible in its SQL rather than hidden in a UI condition.
    # The gallery selects the comment (published deliberately: a shared design
    # carries its author's note) but not the placement verdict or timestamps,
    # which stay on the owner's own History.
    if "RatingComment" in keys:
        out["comment"] = r["RatingComment"]
    if "RatingPlacement" in keys:
        out["furniturePlacement"] = r["RatingPlacement"]
        out["updatedAt"] = r["RatingUpdatedAt"]
    return out


def _siblings_from_row(r: sqlite3.Row, keys: Iterable[str]) -> list[dict]:
    """The other cultures of this run, or [] — never a partial or raw value.

    Stored as JSON, so it is parsed defensively: a row written before the column
    existed, a null, or anything that does not read back as a list of
    {culture, url} objects yields [] rather than reaching the client as
    something the card would try to render. A saved design must never fail to
    list because a companion image could not be parsed.
    """
    if "SiblingImages" not in keys or not r["SiblingImages"]:
        return []
    try:
        parsed = json.loads(r["SiblingImages"])
    except (ValueError, TypeError):
        logger.warning("history row %s has unparseable SiblingImages", r["Id"])
        return []
    if not isinstance(parsed, list):
        return []
    return [
        {"culture": str(s["culture"]), "url": str(s["url"])}
        for s in parsed
        if isinstance(s, dict) and s.get("culture") and s.get("url")
    ]


def _history_row(r: sqlite3.Row) -> dict:
    keys = r.keys()
    return {
        "id": r["Id"],
        "userId": r["UserId"],
        "oldImageUrl": r["OldImageUrl"],
        "newImageUrl": r["NewImageUrl"],
        "isSuggested": bool(r["IsSuggested"]),
        # Null on rows saved before the columns existed — the UI treats that as
        # "unknown culture" rather than pretending it was Lebanese.
        "culture": r["Culture"] if "Culture" in keys else None,
        "intensity": r["Intensity"] if "Intensity" in keys else None,
        "duration": r["Duration"] if "Duration" in keys else None,
        "ssim": r["Ssim"] if "Ssim" in keys else None,
        "lpips": r["Lpips"] if "Lpips" in keys else None,
        "clipScore": r["ClipScore"] if "ClipScore" in keys else None,
        "predictedCulture": r["PredictedCulture"] if "PredictedCulture" in keys else None,
        "isEdited": bool(r["IsEdited"]) if "IsEdited" in keys else False,
        "isLight": bool(r["IsLight"]) if "IsLight" in keys else False,
        # Whether this design can be reopened in Build Mode, and in which scene
        # format. The JSON ITSELF is deliberately not in the listing: a scene is
        # a few KB and a listing is up to 100 rows, so including it would make
        # every page load carry megabytes nobody has asked for. The Edit action
        # fetches one scene by id instead.
        #
        # sceneVersion travels with the flag so the button can be disabled with
        # an honest reason ("made with an older scene format") rather than
        # opening a room the client will silently refuse to load.
        "hasScene": bool(r["SceneJson"]) if "SceneJson" in keys else False,
        "sceneVersion": r["SceneVersion"] if "SceneVersion" in keys else None,
        # The other cultures from the same generation. Unlike SceneJson these
        # ARE included in the listing: they are a handful of URL strings, not
        # kilobytes of scene, and the card needs them to draw itself.
        "siblings": _siblings_from_row(r, keys),
        # The rating this design already has, when the caller joined it in.
        # Null means nobody has rated it — displayed as "not rated", never as 0.
        "rating": _rating_from_row(r),
        "createdAt": r["CreatedAt"],
    }


# ---------------------------------------------------------------- feedback


def get_feedback_for_history(history_id: int) -> sqlite3.Row | None:
    rows = _query("SELECT * FROM feedback WHERE HistoryId = ?", (history_id,))
    return rows[0] if rows else None


def upsert_feedback(
    *,
    history_id: int,
    user_id: int,
    culture: str | None,
    intensity: float | None,
    cultural_accuracy: int,
    image_quality: int,
    room_preservation: int,
    furniture_placement: str,
    comment: str | None,
) -> dict:
    """Create this user's feedback for a generated image, or update it in place.

    One row per image, enforced by UNIQUE(HistoryId): submitting twice edits the
    first rather than stacking duplicates, which is what "a user may update their
    feedback" means in practice. CreatedAt is preserved across updates so the
    original submission time survives.

    Ownership is *not* checked here — the caller has already loaded the history
    row to read `culture` off it, so it is the one place that can compare owners
    without a second query.
    """
    now = time.time()
    conn = connect()
    with _lock:
        conn.execute(
            "INSERT INTO feedback (HistoryId, UserId, Culture, Intensity,"
            " CulturalAccuracy, ImageQuality, RoomPreservation, FurniturePlacement,"
            " Comment, CreatedAt, UpdatedAt)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(HistoryId) DO UPDATE SET"
            "   Culture = excluded.Culture,"
            "   Intensity = excluded.Intensity,"
            "   CulturalAccuracy = excluded.CulturalAccuracy,"
            "   ImageQuality = excluded.ImageQuality,"
            "   RoomPreservation = excluded.RoomPreservation,"
            "   FurniturePlacement = excluded.FurniturePlacement,"
            "   Comment = excluded.Comment,"
            "   UpdatedAt = excluded.UpdatedAt",
            (history_id, user_id, culture, intensity, cultural_accuracy, image_quality,
             room_preservation, furniture_placement, comment, now, now),
        )
        conn.commit()
    row = get_feedback_for_history(history_id)
    return public_feedback(row) if row is not None else {}


def public_feedback(r: sqlite3.Row) -> dict:
    return {
        "id": r["Id"],
        "historyId": r["HistoryId"],
        "userId": r["UserId"],
        "culture": r["Culture"],
        "intensity": r["Intensity"],
        "culturalAccuracy": r["CulturalAccuracy"],
        "imageQuality": r["ImageQuality"],
        "roomPreservation": r["RoomPreservation"],
        "furniturePlacement": r["FurniturePlacement"],
        "comment": r["Comment"],
        "createdAt": r["CreatedAt"],
        "updatedAt": r["UpdatedAt"],
    }


def _feedback_filters(
    culture: str | None, since: float | None, until: float | None
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    args: list[Any] = []
    if culture:
        clauses.append("f.Culture = ?")
        args.append(culture)
    if since is not None:
        clauses.append("f.CreatedAt >= ?")
        args.append(since)
    if until is not None:
        clauses.append("f.CreatedAt <= ?")
        args.append(until)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), args


def feedback_stats(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> dict:
    """Aggregates for the admin panel, over the same filters as the listing."""
    where, args = _feedback_filters(culture, since, until)
    row = _query(
        "SELECT COUNT(*) AS total,"
        " AVG(f.CulturalAccuracy) AS avgCultural,"
        " AVG(f.ImageQuality) AS avgQuality,"
        " AVG(f.RoomPreservation) AS avgPreservation,"
        " SUM(CASE WHEN f.FurniturePlacement = 'valid' THEN 1 ELSE 0 END) AS placementValid,"
        " SUM(CASE WHEN f.FurniturePlacement = 'invalid' THEN 1 ELSE 0 END) AS placementInvalid,"
        " SUM(CASE WHEN f.FurniturePlacement = 'not_applicable' THEN 1 ELSE 0 END)"
        "   AS placementNotApplicable"
        f" FROM feedback f{where}",
        args,
    )[0]

    def avg(key: str) -> float | None:
        v = row[key]
        return round(float(v), 2) if v is not None else None

    return {
        "total": int(row["total"] or 0),
        "averageCulturalAccuracy": avg("avgCultural"),
        "averageImageQuality": avg("avgQuality"),
        "averageRoomPreservation": avg("avgPreservation"),
        "placementValid": int(row["placementValid"] or 0),
        "placementInvalid": int(row["placementInvalid"] or 0),
        "placementNotApplicable": int(row["placementNotApplicable"] or 0),
    }


def list_feedback(
    culture: str | None = None,
    since: float | None = None,
    until: float | None = None,
    limit: int = 50,
) -> list[dict]:
    """Recent feedback with its author's first name, newest first."""
    where, args = _feedback_filters(culture, since, until)
    rows = _query(
        "SELECT f.*, u.FullName AS AuthorName FROM feedback f"
        " LEFT JOIN users u ON u.Id = f.UserId"
        f"{where} ORDER BY f.CreatedAt DESC LIMIT ?",
        [*args, limit],
    )
    out = []
    for r in rows:
        d = public_feedback(r)
        # First name only — the admin panel needs to tell submissions apart, not
        # to publish everyone's identity.
        author = (r["AuthorName"] or "").strip()
        d["authorName"] = author.split(" ")[0] if author else None
        out.append(d)
    return out


def feedback_by_culture(
    culture: str | None = None, since: float | None = None, until: float | None = None
) -> list[dict]:
    """Per-culture breakdown, so the admin view can show where a culture is weak.

    Takes the same `culture` as every other aggregate: with one selected the
    comparison narrows to that row instead of continuing to chart all three
    beside a KPI strip that has already narrowed.
    """
    where, args = _feedback_filters(culture, since, until)
    rows = _query(
        "SELECT f.Culture AS culture, COUNT(*) AS total,"
        " AVG(f.CulturalAccuracy) AS avgCultural,"
        " AVG(f.ImageQuality) AS avgQuality,"
        " AVG(f.RoomPreservation) AS avgPreservation"
        f" FROM feedback f{where} GROUP BY f.Culture ORDER BY total DESC",
        args,
    )
    return [
        {
            "culture": r["culture"],
            "total": int(r["total"]),
            "averageCulturalAccuracy": round(float(r["avgCultural"]), 2) if r["avgCultural"] is not None else None,
            "averageImageQuality": round(float(r["avgQuality"]), 2) if r["avgQuality"] is not None else None,
            "averageRoomPreservation": round(float(r["avgPreservation"]), 2) if r["avgPreservation"] is not None else None,
        }
        for r in rows
    ]
