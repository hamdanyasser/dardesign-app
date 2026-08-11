#!/usr/bin/env python3
"""Build a throwaway database for testing the evaluation dashboard by hand.

The filters are only testable against a corpus you already know the answers for:
"Khaleeji should read 2 designs and 2m 03s" is a test, "Khaleeji shows some
numbers" is not. This writes exactly that corpus and prints the figures each
filter must produce, so the page can be checked against arithmetic rather than
against whether it looks plausible.

    python scripts/seed_eval_demo.py --db .tmp/eval-demo.db

It REFUSES to touch backend/dardesign.db, and refuses to write a database that
already exists: the real one holds accounts and ratings that took real people
real time to produce, and a seeding script is exactly the kind of thing that
should be incapable of overwriting them. Pass --force to replace a demo DB you
made earlier.

GPU NOT NEEDED. Nothing here renders — the image columns are one-pixel PNGs.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DAY = 86_400.0

# culture, duration, ssim, lpips, clip, CLIP's guess, rating, days ago, edited, light
#
# Chosen so every acceptance case has a distinct expected answer: three cultures
# with different counts, one culture (Khaleeji) with a single rating, ratings
# spread across days, one design CLIP misreads per culture pair, and one edited
# plus one LIGHT design that must appear in "saved" and in nothing else.
CORPUS = [
    ("lebanese", 118.0, 0.82, 0.31, 0.322, "lebanese", 5, 0, False, False),
    ("lebanese", 132.0, 0.74, 0.38, 0.298, "lebanese", 4, 1, False, False),
    ("lebanese", 141.0, 0.69, 0.44, 0.271, "moroccan", None, 3, False, False),
    ("khaleeji", 126.0, 0.78, 0.35, 0.311, "khaleeji", 4, 2, False, False),
    ("khaleeji", 119.0, 0.71, 0.41, 0.264, "lebanese", None, 5, False, False),
    ("moroccan", 155.0, 0.66, 0.47, 0.289, "moroccan", 3, 4, False, False),
    ("moroccan", 148.0, 0.70, 0.42, 0.276, "moroccan", None, 9, False, False),
    # Saved designs that must never reach a model or timing figure.
    ("lebanese", 121.0, 0.31, None, None, None, 2, 1, True, False),   # colour-edited
    ("khaleeji", 0.06, 0.99, None, None, None, None, 0, False, True),  # LIGHT preview
]

RESULTS_CSV_HEADER = "room,style,set,ssim,lpips,clip_score,predicted,correct\n"

# Nine rooms per arm over the same three rooms x three cultures, so the ablation
# is controlled: same corpus, one variable. The LoRA arm is better on every
# metric and recognised 7/9 against the baseline's 4/9.
RESULTS_CSV_ROWS = [
    ("room_01", "lebanese", "lora", 0.8120, 0.3140, 0.3221, "lebanese"),
    ("room_02", "lebanese", "lora", 0.7740, 0.3620, 0.3082, "lebanese"),
    ("room_03", "lebanese", "lora", 0.7410, 0.3910, 0.2984, "moroccan"),
    ("room_01", "khaleeji", "lora", 0.7930, 0.3350, 0.3155, "khaleeji"),
    ("room_02", "khaleeji", "lora", 0.7620, 0.3780, 0.3011, "khaleeji"),
    ("room_03", "khaleeji", "lora", 0.7280, 0.4020, 0.2872, "khaleeji"),
    ("room_01", "moroccan", "lora", 0.7550, 0.3690, 0.3098, "moroccan"),
    ("room_02", "moroccan", "lora", 0.7210, 0.4130, 0.2940, "moroccan"),
    ("room_03", "moroccan", "lora", 0.6980, 0.4410, 0.2811, "lebanese"),
    ("room_01", "lebanese", "baseline", 0.7010, 0.4520, 0.2412, "moroccan"),
    ("room_02", "lebanese", "baseline", 0.6840, 0.4710, 0.2331, "lebanese"),
    ("room_03", "lebanese", "baseline", 0.6620, 0.4980, 0.2244, "khaleeji"),
    ("room_01", "khaleeji", "baseline", 0.6930, 0.4610, 0.2385, "moroccan"),
    ("room_02", "khaleeji", "baseline", 0.6710, 0.4830, 0.2298, "khaleeji"),
    ("room_03", "khaleeji", "baseline", 0.6480, 0.5020, 0.2201, "lebanese"),
    ("room_01", "moroccan", "baseline", 0.6790, 0.4740, 0.2356, "moroccan"),
    ("room_02", "moroccan", "baseline", 0.6550, 0.4950, 0.2267, "moroccan"),
    ("room_03", "moroccan", "baseline", 0.6310, 0.5180, 0.2174, "khaleeji"),
]


def write_results_csv(path: Path) -> None:
    lines = [RESULTS_CSV_HEADER]
    for room, style, arm, ssim, lpips, clip, predicted in RESULTS_CSV_ROWS:
        lines.append(
            f"{room},{style},{arm},{ssim:.4f},{lpips:.4f},{clip:.4f},"
            f"{predicted},{int(predicted == style)}\n"
        )
    path.write_text("".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, help="path for the throwaway SQLite file")
    ap.add_argument("--csv", default=None,
                    help="also write a two-arm results.csv here (default: beside --db)")
    ap.add_argument("--email", default="admin@dardesign.test",
                    help="email for the seeded admin account")
    ap.add_argument("--force", action="store_true", help="replace an existing demo DB")
    args = ap.parse_args()

    target = Path(args.db).resolve()
    real = (ROOT / "backend" / "dardesign.db").resolve()
    if target == real:
        raise SystemExit(
            f"refusing to seed {target} — that is the real database.\n"
            "Pass a throwaway path, e.g. --db .tmp/eval-demo.db"
        )
    if target.exists() and not args.force:
        raise SystemExit(f"{target} already exists. Pass --force to replace it.")

    # Set before importing backend.db: it reads DARDESIGN_DB at import time.
    os.environ["DARDESIGN_DB"] = str(target)
    from backend import db
    from backend.auth import hash_password

    target.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(target) + suffix)
        if p.exists():
            p.unlink()

    db.connect(target)
    # The first account on a fresh install is Admin, which is what /evaluation
    # needs. The password is a fixture, not a secret: this database is disposable.
    admin = db.create_user(
        "Demo Admin", "0700", args.email, hash_password("demo-password-1234"), db.ROLE_ADMIN,
    )

    now = time.time()
    for culture, dur, ssim, lpips, clip, predicted, rating, days, edited, light in CORPUS:
        entry = db.add_history(
            admin, "images/old/demo.png", "images/new/demo.png",
            culture=culture, duration=dur, ssim=ssim, is_edited=edited, is_light=light,
        )
        at = now - days * DAY
        db._write("UPDATE history SET CreatedAt = ? WHERE Id = ?", (at, entry))
        if lpips is not None:
            db.set_history_evaluation(
                entry, lpips=lpips, clip_score=clip, predicted_culture=predicted,
            )
        if rating is not None:
            db.upsert_feedback(
                history_id=entry, user_id=admin, culture=culture, intensity=None,
                cultural_accuracy=rating,
                image_quality=min(5, rating + 1),
                room_preservation=max(1, rating - 1),
                furniture_placement="valid",
                comment=f"{culture} looked convincing" if rating >= 4 else f"{culture} needs work",
            )
            # The rating is dated with its design, so the date filter has
            # something to separate.
            db._write("UPDATE feedback SET CreatedAt = ? WHERE HistoryId = ?", (at, entry))

    csv_path = Path(args.csv) if args.csv else target.parent / "results.csv"
    write_results_csv(csv_path)

    print(f"database   : {target}")
    print(f"results.csv: {csv_path}")
    print(f"admin      : {args.email}  (password: demo-password-1234)")
    print()
    print("Start the backend against it:")
    print(f'  $env:DARDESIGN_DB="{target}"; $env:DARDESIGN_EVAL_CSV="{csv_path}"; '
          "$env:DARDESIGN_LIGHT=\"1\"; python -m uvicorn backend.main:app --port 8000")
    print()
    print("Expected figures — check the page against these, not against plausibility:")
    print()
    header = f"{'filter':<34}{'evaluable':>10}{'saved':>7}{'avg time':>10}{'ratings':>9}{'SSIM':>8}"
    print(header)
    print("-" * len(header))

    def row(name: str, **kw) -> None:
        g = db.history_generation_stats(**kw)
        s = db.feedback_stats(kw.get("culture"), kw.get("since"), kw.get("until"))
        avg = f"{g['averageSeconds']}s" if g["averageSeconds"] is not None else "no data"
        ssim = g["averageSsim"] if g["averageSsim"] is not None else "no data"
        print(f"{name:<34}{g['evaluableDesigns']:>10}{g['roomsGenerated']:>7}"
              f"{avg:>10}{s['total']:>9}{str(ssim):>8}")

    row("all cultures, all dates")
    for c in ("lebanese", "khaleeji", "moroccan"):
        row(f"culture={c}", culture=c)
    row("since 3.5 days ago", since=now - 3.5 * DAY)
    row("until 3.5 days ago", until=now - 3.5 * DAY)
    row("3.5-1.5 days ago", since=now - 3.5 * DAY, until=now - 1.5 * DAY)
    row("lebanese, since 1.5 days ago", culture="lebanese", since=now - 1.5 * DAY)

    conf = db.culture_confusion()
    print()
    print(f"CLIP recognition (all): {conf['correct']}/{conf['total']} "
          f"({round((conf['accuracy'] or 0) * 100)}%)   rows={conf['rowTotals']}")
    print(f"coverage (all)        : {db.evaluation_coverage()}")
    print()
    print("The two designs excluded everywhere below 'saved' are deliberate: one")
    print("colour-edited design and one DARDESIGN_LIGHT preview.")
    db.close()


if __name__ == "__main__":
    main()
