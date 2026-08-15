"""Stage saved designs for the defence, without corrupting the evaluation.

The presentation needs "My designs" and the community page to look like a tool
someone has actually used, rather than an empty table. This copies the real
demo-pack renders — genuine /redesign outputs from a real GPU run, the same
ones public/demo serves — into images/ and writes history rows for them.

THE PART THAT MATTERS. Saved designs are also the evaluation dataset: CLAUDE.md
records that every unedited, non-light row is measured and feeds the averages,
the coverage denominators and the CLIP confusion matrix on /evaluation. Seeding
rows that were never generated in a measured run would put fabricated research
results in front of a jury.

So every row written here:

  * sets IsEdited = 1, which is exactly the flag the dashboard uses to exclude
    "a real design that is no longer the pipeline's own output" — which is what
    a staged row is;
  * leaves Duration, Ssim, Lpips, ClipScore and PredictedCulture NULL. No
    invented timings, no invented similarity, nothing that could be averaged.

The result: the designs show up everywhere a user would expect, and
/evaluation's numbers are untouched. Verify with --check after seeding.

    python scripts/seed_demo_history.py            # seed
    python scripts/seed_demo_history.py --check    # show the split
    python scripts/seed_demo_history.py --undo     # remove only these rows
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "backend" / "dardesign.db"
DEMO = ROOT / "public" / "demo"
IMAGES = ROOT / "images"
CULTURES = ("lebanese", "khaleeji", "moroccan")

# Seeded rows are marked by a FILENAME prefix, not by a column value. The first
# attempt stamped IsSuggested = 7, which broke two things at once: /others
# filters `IsSuggested = 1` so the designs never reached Community, while the
# card badge does a truthy check and so displayed "SHARED" for rows that were
# not. A marker must never be a field something else reads.
SEED_PREFIX = "seed-"


def rooms() -> list[Path]:
    return sorted(p for p in DEMO.iterdir() if p.is_dir() and (p / "original.png").is_file())


def copy_into(folder: str, src: Path) -> str:
    dest_dir = IMAGES / folder
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = f"{SEED_PREFIX}{uuid.uuid4().hex}.png"
    shutil.copyfile(src, dest_dir / name)
    return f"images/{folder}/{name}"


def seed(conn: sqlite3.Connection, user_id: int) -> int:
    """Spread the designs across accounts.

    "Others' Work" deliberately queries `UserId != you`, so seeding everything
    onto one account fills My designs and leaves Community empty — which is the
    page working, not failing. The rooms are dealt round-robin across the real
    accounts so both pages have something to show, with the requested user
    getting the first (newest) room.
    """
    others = [r[0] for r in conn.execute(
        "SELECT Id FROM users WHERE Id != ? ORDER BY Id", (user_id,)
    ).fetchall()]
    owners = [user_id] + others if others else [user_id]
    now = time.time()
    written = 0
    # Spread CreatedAt backwards so the list reads like real use rather than one
    # burst, and the newest sits at the top where the demo starts.
    step = 3 * 3600
    for room_index, room in enumerate(rooms()):
        owner = owners[room_index % len(owners)]
        old = copy_into("old", room / "original.png")
        for culture in CULTURES:
            render = room / f"{culture}.png"
            if not render.is_file():
                continue
            new = copy_into("new", render)
            conn.execute(
                """INSERT INTO history
                   (UserId, OldImageUrl, NewImageUrl, IsSuggested, CreatedAt,
                    Culture, Intensity, Duration, Ssim, Lpips, ClipScore,
                    PredictedCulture, IsEdited, IsLight)
                   VALUES (?,?,?,1,?,?,?,NULL,NULL,NULL,NULL,NULL,1,0)""",
                (owner, old, new, now - written * step, culture, 0.8),
            )
            written += 1
    conn.commit()
    return written


def undo(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        "SELECT Id, OldImageUrl, NewImageUrl FROM history WHERE OldImageUrl LIKE ?",
        (f"%/{SEED_PREFIX}%",),
    ).fetchall()
    for _id, old, new in rows:
        for rel in (old, new):
            f = ROOT / rel
            if f.is_file():
                try:
                    f.unlink()
                except OSError:
                    pass
    conn.execute("DELETE FROM history WHERE OldImageUrl LIKE ?", (f"%/{SEED_PREFIX}%",))
    conn.commit()
    return len(rows)


def check(conn: sqlite3.Connection) -> None:
    total = conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]
    seeded = conn.execute(
        "SELECT COUNT(*) FROM history WHERE OldImageUrl LIKE ?", (f"%/{SEED_PREFIX}%",)
    ).fetchone()[0]
    # The population every /evaluation average is taken over.
    evaluable = conn.execute(
        "SELECT COUNT(*) FROM history WHERE IsEdited = 0 AND IsLight = 0"
    ).fetchone()[0]
    seeded_evaluable = conn.execute(
        "SELECT COUNT(*) FROM history WHERE OldImageUrl LIKE ? AND IsEdited = 0 AND IsLight = 0",
        (f"%/{SEED_PREFIX}%",),
    ).fetchone()[0]
    print(f"history rows      : {total}")
    print(f"  seeded by this  : {seeded}")
    print(f"evaluable corpus  : {evaluable}   (IsEdited=0 AND IsLight=0)")
    print(f"  seeded in it    : {seeded_evaluable}   <-- MUST be 0")
    by = conn.execute(
        "SELECT Culture, COUNT(*) FROM history WHERE OldImageUrl LIKE ? GROUP BY Culture",
        (f"%/{SEED_PREFIX}%",),
    ).fetchall()
    if by:
        print("seeded by culture :", dict(by))
    owners = conn.execute(
        "SELECT UserId, COUNT(*) FROM history WHERE OldImageUrl LIKE ? GROUP BY UserId",
        (f"%/{SEED_PREFIX}%",),
    ).fetchall()
    if owners:
        print("seeded by owner   :", dict(owners), "(Community needs UserId != viewer)")
    if seeded_evaluable:
        print("\n*** SEEDED ROWS ARE INSIDE THE EVALUATION CORPUS — the dashboard")
        print("*** would report averages over designs that were never measured.")
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", type=int, default=1, help="owner UserId (default 1)")
    ap.add_argument("--undo", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not DB.is_file():
        sys.exit(f"no database at {DB}")
    conn = sqlite3.connect(DB)
    try:
        if args.check:
            check(conn)
        elif args.undo:
            print(f"removed {undo(conn)} seeded rows")
            check(conn)
        else:
            n = seed(conn, args.user)
            print(f"seeded {n} designs for user {args.user}\n")
            check(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
