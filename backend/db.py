"""SQLite storage for accounts and saved designs.

Deliberately small: one file, stdlib `sqlite3`, no ORM and no migration tool.
The schema is two tables and the queries are a dozen lines each — an ORM would
be more machinery than the problem needs.

    users     Id, FullName, PhoneNumber, Email, Password, Role
    history   Id, UserId, OldImageUrl, NewImageUrl, IsSuggested

`Password` stores a PBKDF2 hash, never the password itself — see auth.py.

Threading: FastAPI serves requests from a thread pool, so the connection is
opened with check_same_thread=False and every write goes through one lock.
SQLite handles this fine at demo concurrency; the lock exists to keep writes
serialised rather than to make reads fast.
"""
from __future__ import annotations

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

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    FullName     TEXT    NOT NULL,
    PhoneNumber  TEXT,
    -- NOCASE so Ali@x.com and ali@x.com cannot both register.
    Email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    Password     TEXT    NOT NULL,
    Role         TEXT    NOT NULL DEFAULT 'User',
    CreatedAt    REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId       INTEGER NOT NULL,
    OldImageUrl  TEXT    NOT NULL,
    NewImageUrl  TEXT    NOT NULL,
    IsSuggested  INTEGER NOT NULL DEFAULT 0,
    CreatedAt    REAL    NOT NULL,
    FOREIGN KEY (UserId) REFERENCES users(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_user ON history(UserId, CreatedAt DESC);

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

CREATE TABLE IF NOT EXISTS generations (
    Id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Null when the room was generated signed out. Generation does not require
    -- an account, so requiring one here would simply lose the record.
    UserId          INTEGER,
    -- The render job. Not unique: one /redesign can produce three cultures, and
    -- each is recorded so per-culture counts are possible.
    JobId           TEXT,
    Culture         TEXT,
    -- Measured by the backend that did the rendering and passed through, so this
    -- is generation time, not the round trip including the tunnel.
    DurationSeconds REAL,
    Ok              INTEGER NOT NULL DEFAULT 1,
    -- DARDESIGN_LIGHT placeholder runs. Recorded rather than dropped so the flag
    -- can be audited, but excluded from every statistic by default.
    Light           INTEGER NOT NULL DEFAULT 0,
    CreatedAt       REAL    NOT NULL,
    FOREIGN KEY (UserId) REFERENCES users(Id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(CreatedAt DESC);
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
    ):
        if column not in existing:
            conn.execute(ddl)
            logger.info("migrated: history.%s added", column)


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


def public_user(row: sqlite3.Row) -> dict:
    """User fields safe to send to the client — never the password hash."""
    return {
        "id": row["Id"],
        "fullName": row["FullName"],
        "phoneNumber": row["PhoneNumber"],
        "email": row["Email"],
        "role": row["Role"],
    }


# ---------------------------------------------------------------- history


def add_history(
    user_id: int,
    old_url: str,
    new_url: str,
    is_suggested: bool = False,
    culture: str | None = None,
    intensity: float | None = None,
) -> int:
    """Save one design. `culture`/`intensity` describe how it was generated and
    become the trusted source for anything that rates this image later."""
    return _write(
        "INSERT INTO history (UserId, OldImageUrl, NewImageUrl, IsSuggested, Culture,"
        " Intensity, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, old_url, new_url, 1 if is_suggested else 0, culture, intensity, time.time()),
    )


def list_history(user_id: int, limit: int = 100) -> list[dict]:
    """A user's saved designs, newest first. Scoped by UserId at the query —
    history is per-account and must never leak across users."""
    rows = _query(
        "SELECT * FROM history WHERE UserId = ? ORDER BY CreatedAt DESC LIMIT ?",
        (user_id, limit),
    )
    return [_history_row(r) for r in rows]


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

    `exclude_user_id` leaves the viewer's own work out — this gallery is for
    seeing what others made. Only IsSuggested rows are ever returned, so nothing
    a user kept private can appear here.
    """
    if exclude_user_id is None:
        rows = _query(
            "SELECT h.*, u.FullName AS AuthorName FROM history h"
            " LEFT JOIN users u ON u.Id = h.UserId"
            " WHERE h.IsSuggested = 1 ORDER BY h.CreatedAt DESC LIMIT ?",
            (limit,),
        )
    else:
        rows = _query(
            "SELECT h.*, u.FullName AS AuthorName FROM history h"
            " LEFT JOIN users u ON u.Id = h.UserId"
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


# ------------------------------------------------------------- generations
#
# Renders happen on whichever backend has the GPU, and that box is disposable —
# on Colab the checkout and its audit log are wiped every session. Recording a
# row here, on the machine that owns the database, is what makes "how many rooms
# has this system generated, and how long do they take?" answerable next week
# rather than only until the tunnel drops.


def add_generation(
    *,
    user_id: int | None,
    job_id: str | None,
    culture: str | None,
    duration_seconds: float | None,
    ok: bool = True,
    light: bool = False,
) -> int:
    return _write(
        "INSERT INTO generations (UserId, JobId, Culture, DurationSeconds, Ok, Light, CreatedAt)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, job_id, culture, duration_seconds, 1 if ok else 0, 1 if light else 0, time.time()),
    )


def _generation_filters(since: float | None, until: float | None) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    args: list[Any] = []
    if since is not None:
        clauses.append("CreatedAt >= ?")
        args.append(since)
    if until is not None:
        clauses.append("CreatedAt <= ?")
        args.append(until)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), args


def generation_stats(since: float | None = None, until: float | None = None) -> dict:
    """Counts and timings over recorded generations.

    Placeholder (light) runs are excluded from every figure and reported
    separately: they are instant stand-ins, so counting them would inflate the
    total and crush the average. Averages are None rather than 0 when nothing
    qualifies — a 0.0s average would read as a measurement.
    """
    where, args = _generation_filters(since, until)
    row = _query(
        "SELECT"
        " SUM(CASE WHEN Light = 0 AND Ok = 1 THEN 1 ELSE 0 END) AS images,"
        " COUNT(DISTINCT CASE WHEN Light = 0 AND Ok = 1 THEN JobId END) AS rooms,"
        " SUM(CASE WHEN Light = 0 AND Ok = 0 THEN 1 ELSE 0 END) AS failures,"
        " SUM(CASE WHEN Light = 1 THEN 1 ELSE 0 END) AS light,"
        " AVG(CASE WHEN Light = 0 AND Ok = 1 THEN DurationSeconds END) AS avgSeconds,"
        " MIN(CASE WHEN Light = 0 AND Ok = 1 THEN DurationSeconds END) AS minSeconds,"
        " MAX(CASE WHEN Light = 0 AND Ok = 1 THEN DurationSeconds END) AS maxSeconds,"
        " COUNT(CASE WHEN Light = 0 AND Ok = 1 AND DurationSeconds IS NOT NULL THEN 1 END) AS timed"
        f" FROM generations{where}",
        args,
    )[0]

    def num(key: str, digits: int = 1) -> float | None:
        v = row[key]
        return round(float(v), digits) if v is not None else None

    ok_count = int(row["images"] or 0)
    failures = int(row["failures"] or 0)
    total = ok_count + failures
    return {
        "roomsGenerated": int(row["rooms"] or 0),
        "imagesGenerated": ok_count,
        "failures": failures,
        "successRate": round(ok_count / total, 3) if total else None,
        "averageSeconds": num("avgSeconds"),
        "fastestSeconds": num("minSeconds"),
        "slowestSeconds": num("maxSeconds"),
        "sampleSize": int(row["timed"] or 0),
        "placeholderRunsExcluded": int(row["light"] or 0),
    }


def generation_count() -> int:
    """Any rows at all — used to decide whether the database has taken over from
    the legacy audit-log source."""
    return int(_query("SELECT COUNT(*) AS n FROM generations")[0]["n"])


def feedback_by_culture(
    since: float | None = None, until: float | None = None
) -> list[dict]:
    """Per-culture breakdown, so the admin view can show where a culture is weak."""
    where, args = _feedback_filters(None, since, until)
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
