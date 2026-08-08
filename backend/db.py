"""SQLite storage for accounts and saved designs.

Deliberately small: one file, stdlib `sqlite3`, no ORM and no migration tool.
The schema is two tables and the queries are a dozen lines each — an ORM would
be more machinery than the problem needs.

    users     Id, FullName, PhoneNumber, Email, Password, Role
    history   Id, UserId, OldImageUrl, NewImageUrl, IsSuggested, Culture,
              Intensity, Duration, Ssim

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
    duration: float | None = None,
    ssim: float | None = None,
    is_edited: bool = False,
) -> int:
    """Save one design. `culture`/`intensity` describe how it was generated and
    become the trusted source for anything that rates this image later.
    `duration` is the generation time in seconds, measured by the renderer."""
    return _write(
        "INSERT INTO history (UserId, OldImageUrl, NewImageUrl, IsSuggested, Culture,"
        " Intensity, Duration, Ssim, IsEdited, CreatedAt)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, old_url, new_url, 1 if is_suggested else 0, culture, intensity,
         duration, ssim, 1 if is_edited else 0, time.time()),
    )


def history_generation_stats(since: float | None = None, until: float | None = None) -> dict:
    """Rooms generated and how long they took, over the history table.

    `averageSeconds` divides the sum of durations by the number of rows that
    *have* one, not by the row count: every row saved before Duration existed is
    null, and dividing by all of them would report an average far below any real
    generation. `sampleSize` states how many rows backed the figure.
    """
    where, args = _generation_filters(since, until)
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
        "roomsGenerated": rooms,
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
    than the pipeline.
    """
    rows = _query(
        "SELECT Id, OldImageUrl, NewImageUrl, Culture, Ssim FROM history"
        " WHERE IsEdited = 0 AND (Lpips IS NULL OR ClipScore IS NULL)"
        " ORDER BY Id DESC LIMIT ?",
        (limit,),
    )
    return [
        {"id": r["Id"], "oldImageUrl": r["OldImageUrl"],
         "newImageUrl": r["NewImageUrl"], "culture": r["Culture"], "ssim": r["Ssim"]}
        for r in rows
    ]


def culture_confusion(since: float | None = None, until: float | None = None) -> dict:
    """Intended culture vs CLIP's prediction, over saved designs.

    Reads live from `history`, so a deleted design leaves the matrix in the same
    instant it leaves the gallery — there is no second copy to keep in step.
    """
    where, args = _generation_filters(since, until)
    clause = " AND " if where else " WHERE "
    rows = _query(
        "SELECT Culture AS intended, PredictedCulture AS predicted, COUNT(*) AS n"
        f" FROM history{where}{clause}"
        " Culture IS NOT NULL AND PredictedCulture IS NOT NULL"
        " GROUP BY Culture, PredictedCulture",
        args,
    )
    matrix: dict[str, dict[str, int]] = {}
    total = correct = 0
    for r in rows:
        n = int(r["n"])
        matrix.setdefault(r["intended"], {})[r["predicted"]] = n
        total += n
        if r["intended"] == r["predicted"]:
            correct += n
    return {
        "matrix": matrix,
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


def list_history(user_id: int, limit: int = 100) -> list[dict]:
    """A user's saved designs, newest first. Scoped by UserId at the query —
    history is per-account and must never leak across users."""
    rows = _query(
        # LEFT JOIN so an unrated design still comes back — the caller shows a
        # "not rated" state rather than dropping the row.
        "SELECT h.*, f.CulturalAccuracy AS RatingCultural, f.ImageQuality AS RatingQuality, f.RoomPreservation AS RatingPreservation"
        " FROM history h LEFT JOIN feedback f ON f.HistoryId = h.Id"
        " WHERE h.UserId = ? ORDER BY h.CreatedAt DESC LIMIT ?",
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
            f"SELECT h.*, u.FullName AS AuthorName, f.CulturalAccuracy AS RatingCultural, f.ImageQuality AS RatingQuality, f.RoomPreservation AS RatingPreservation"
            " FROM history h LEFT JOIN users u ON u.Id = h.UserId"
            " LEFT JOIN feedback f ON f.HistoryId = h.Id"
            " WHERE h.IsSuggested = 1 ORDER BY h.CreatedAt DESC LIMIT ?",
            (limit,),
        )
    else:
        rows = _query(
            f"SELECT h.*, u.FullName AS AuthorName, f.CulturalAccuracy AS RatingCultural, f.ImageQuality AS RatingQuality, f.RoomPreservation AS RatingPreservation"
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
    return {
        "culturalAccuracy": cultural,
        "imageQuality": quality,
        "roomPreservation": preservation,
        "overall": round((cultural + quality + preservation) / 3, 2),
    }


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
