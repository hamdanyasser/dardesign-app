"""Look inside the accounts/history database.

    python scripts/inspect_db.py              # summary
    python scripts/inspect_db.py --users      # every account
    python scripts/inspect_db.py --history    # every saved design
    python scripts/inspect_db.py --feedback   # every rating + per-culture averages
    python scripts/inspect_db.py --check EMAIL --password PW
                                              # does this login actually work?

Reads $DARDESIGN_DB when set, else backend/dardesign.db — the same order the
backend uses. Pass --db to point at any other file (a Drive snapshot, say).

Password hashes are shown truncated and are never printable as plaintext —
they're PBKDF2 digests, so there is nothing to recover from them. `--check`
exists because "wrong password" and "no such account" deliberately return the
same message to the user, which is good for security and unhelpful when you are
the one debugging.

Read-only. GPU NOT NEEDED.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Same resolution order as backend/db.py, so this always reads the file the
# backend actually wrote — otherwise moving the DB out of the checkout leaves
# this script cheerfully reporting on a stale copy.
DB_PATH = Path(os.environ.get("DARDESIGN_DB") or ROOT / "backend" / "dardesign.db")


def _conn(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise SystemExit(
            f"No database at {path}.\n"
            "It is created the first time the backend starts — run the backend once, "
            "then register an account."
        )
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def show_users(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT * FROM users ORDER BY Id").fetchall()
    if not rows:
        print("users: (none registered)")
        return
    print(f"users ({len(rows)}):")
    print(f"  {'Id':<4} {'Role':<6} {'Email':<32} {'FullName':<22} {'Phone':<16} Password")
    for r in rows:
        print(
            f"  {r['Id']:<4} {r['Role']:<6} {r['Email']:<32} {r['FullName']:<22} "
            f"{(r['PhoneNumber'] or '-'):<16} {r['Password'][:28]}…"
        )


def show_history(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT h.*, u.Email FROM history h LEFT JOIN users u ON u.Id = h.UserId"
        " ORDER BY h.CreatedAt DESC"
    ).fetchall()
    if not rows:
        print("history: (nothing saved yet)")
        return
    print(f"history ({len(rows)}):")
    for r in rows:
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["CreatedAt"]))
        print(
            f"  #{r['Id']:<4} {when}  user={r['Email'] or r['UserId']}  "
            f"suggested={bool(r['IsSuggested'])}"
        )
        print(f"        old: {r['OldImageUrl']}")
        print(f"        new: {r['NewImageUrl']}")


def show_feedback(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT f.*, u.Email FROM feedback f LEFT JOIN users u ON u.Id = f.UserId"
        " ORDER BY f.CreatedAt DESC"
    ).fetchall()
    if not rows:
        print("feedback: (nothing rated yet)")
        return
    print(f"feedback ({len(rows)}):")
    print(f"  {'Id':<4} {'design':<7} {'culture':<10} {'acc':<4} {'qual':<5} {'room':<5} {'placement':<15} comment")
    for r in rows:
        print(
            f"  {r['Id']:<4} #{r['HistoryId']:<6} {(r['Culture'] or '-'):<10} "
            f"{r['CulturalAccuracy']:<4} {r['ImageQuality']:<5} {r['RoomPreservation']:<5} "
            f"{r['FurniturePlacement']:<15} {(r['Comment'] or '')[:40]}"
        )
    # The per-culture averages are what the ratings exist to produce; computing
    # them here saves reaching for the admin endpoint just to sanity-check data.
    print("\n  averages by culture (accuracy / quality / preservation, n):")
    for r in conn.execute(
        "SELECT COALESCE(Culture,'(none)') AS c, COUNT(*) n,"
        " ROUND(AVG(CulturalAccuracy),2) a, ROUND(AVG(ImageQuality),2) q,"
        " ROUND(AVG(RoomPreservation),2) p FROM feedback GROUP BY c ORDER BY c"
    ):
        print(f"    {r['c']:<10} {r['a']:<5} {r['q']:<5} {r['p']:<5} n={r['n']}")


def check_login(conn: sqlite3.Connection, email: str, password: str) -> None:
    """Reproduce exactly what the login endpoint does, but say which step failed."""
    from backend.auth import verify_password

    row = conn.execute(
        "SELECT * FROM users WHERE Email = ?", (email.strip().lower(),)
    ).fetchone()
    if row is None:
        print(f"No account with email {email.strip().lower()!r}.")
        existing = [r["Email"] for r in conn.execute("SELECT Email FROM users")]
        print(f"Registered emails: {existing or '(none)'}")
        print(
            "\nIf you expected one here, you probably registered against a different\n"
            "backend — the Colab machine has its own database, separate from this one."
        )
        return
    print(f"Found account: id={row['Id']} role={row['Role']} name={row['FullName']!r}")
    print("Password:", "MATCHES" if verify_password(password, row["Password"]) else "does NOT match")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=DB_PATH)
    ap.add_argument("--users", action="store_true")
    ap.add_argument("--history", action="store_true")
    ap.add_argument("--feedback", action="store_true")
    ap.add_argument("--check", metavar="EMAIL")
    ap.add_argument("--password", default="")
    a = ap.parse_args()

    conn = _conn(a.db)
    print(f"database: {a.db}\n")

    if a.check:
        check_login(conn, a.check, a.password)
        return 0

    selected = a.users or a.history or a.feedback
    if a.users or not selected:
        show_users(conn)
        print()
    if a.history or not selected:
        show_history(conn)
        print()
    if a.feedback or not selected:
        show_feedback(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
