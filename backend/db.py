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
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(__file__).resolve().parent / "dardesign.db"

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
"""

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
        conn.commit()
        _conn = conn
        logger.info("sqlite ready at %s", p)
        return _conn


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


def add_history(user_id: int, old_url: str, new_url: str, is_suggested: bool = False) -> int:
    return _write(
        "INSERT INTO history (UserId, OldImageUrl, NewImageUrl, IsSuggested, CreatedAt)"
        " VALUES (?, ?, ?, ?, ?)",
        (user_id, old_url, new_url, 1 if is_suggested else 0, time.time()),
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
    return {
        "id": r["Id"],
        "userId": r["UserId"],
        "oldImageUrl": r["OldImageUrl"],
        "newImageUrl": r["NewImageUrl"],
        "isSuggested": bool(r["IsSuggested"]),
        "createdAt": r["CreatedAt"],
    }
