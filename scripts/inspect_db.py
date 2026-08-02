"""Look inside the accounts/history database.

    python scripts/inspect_db.py              # summary
    python scripts/inspect_db.py --users      # every account
    python scripts/inspect_db.py --history    # every saved design
    python scripts/inspect_db.py --check EMAIL --password PW
                                              # does this login actually work?

Password hashes are shown truncated and are never printable as plaintext —
they're PBKDF2 digests, so there is nothing to recover from them. `--check`
exists because "wrong password" and "no such account" deliberately return the
same message to the user, which is good for security and unhelpful when you are
the one debugging.

Read-only. GPU NOT NEEDED.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DB_PATH = ROOT / "backend" / "dardesign.db"


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
    ap.add_argument("--check", metavar="EMAIL")
    ap.add_argument("--password", default="")
    a = ap.parse_args()

    conn = _conn(a.db)
    print(f"database: {a.db}\n")

    if a.check:
        check_login(conn, a.check, a.password)
        return 0

    if a.users or not (a.users or a.history):
        show_users(conn)
        print()
    if a.history or not (a.users or a.history):
        show_history(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
