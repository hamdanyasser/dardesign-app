"""The evaluation_results table, and its isolation from user data.

The isolation tests are the point. Evaluation images are produced by a harness,
not by users, so if a single one of them reached the history table every
user-facing figure on the dashboard would be wrong — and wrong in the flattering
direction, which is the kind of error nobody catches.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db  # noqa: E402
from backend.main import app  # noqa: E402

PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


def _row(room: str, culture: str, **over):
    base = dict(
        room_id=room, culture=culture, set_name="lora",
        input_path=f"/drive/inputs/{room}.jpg",
        image_path=f"/drive/finals/{culture}/{room}_{culture}.png",
        ssim=0.42, lpips=0.31, clip_score=0.28, predicted=culture, correct=True,
    )
    base.update(over)
    return base


def test_records_and_reads_back() -> None:
    db.upsert_evaluation_result(**_row("room_01", "lebanese"))
    rows = db.list_evaluation_results()
    assert len(rows) == 1
    r = rows[0]
    assert r["roomId"] == "room_01" and r["culture"] == "lebanese"
    assert r["ssim"] == 0.42 and r["lpips"] == 0.31 and r["clipScore"] == 0.28
    assert r["correct"] is True
    assert r["imagePath"].endswith("room_01_lebanese.png")


def test_rerunning_the_suite_updates_instead_of_duplicating() -> None:
    """Re-running metrics must not stack rows — averages would drift upward on
    every recomputation, which is a silently wrong result."""
    db.upsert_evaluation_result(**_row("room_01", "lebanese", ssim=0.40))
    db.upsert_evaluation_result(**_row("room_01", "lebanese", ssim=0.55))
    rows = db.list_evaluation_results()
    assert len(rows) == 1
    assert rows[0]["ssim"] == 0.55


def test_lora_and_baseline_coexist_for_the_same_image() -> None:
    """The ablation is a filter on one table, not a second table."""
    db.upsert_evaluation_result(**_row("room_01", "lebanese", set_name="lora", ssim=0.50))
    db.upsert_evaluation_result(**_row("room_01", "lebanese", set_name="baseline", ssim=0.30))
    assert len(db.list_evaluation_results()) == 2
    assert len(db.list_evaluation_results(set_name="lora")) == 1
    assert db.list_evaluation_results(set_name="baseline")[0]["ssim"] == 0.30


def test_summary_averages_per_set_and_culture() -> None:
    db.upsert_evaluation_result(**_row("room_01", "lebanese", ssim=0.40, correct=True))
    db.upsert_evaluation_result(**_row("room_02", "lebanese", ssim=0.60, correct=False))
    db.upsert_evaluation_result(**_row("room_01", "moroccan", ssim=0.20, correct=True))

    by = {(r["set"], r["culture"]): r for r in db.evaluation_summary()}
    leb = by[("lora", "lebanese")]
    assert leb["images"] == 2
    assert leb["ssim"] == 0.5
    assert leb["accuracy"] == 0.5          # one of two classified correctly
    assert by[("lora", "moroccan")]["accuracy"] == 1.0


# ---------- isolation from user-facing data ----------


def test_evaluation_rows_never_reach_the_dashboard_statistics() -> None:
    """Rooms generated counts history. Evaluation rows must not move it."""
    async def _go():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            await c.post("/api/auth/register", json={
                "fullName": "Admin", "email": "iso@example.com",
                "password": "secret123", "phoneNumber": "0700",
            })
            await c.post("/api/history", json={
                "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL,
                "culture": "lebanese", "duration": 120.0,
            })

            before = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert before["roomsGenerated"] == 1

            # A whole evaluation corpus lands in its own table.
            for i in range(15):
                for culture in ("lebanese", "khaleeji", "moroccan"):
                    db.upsert_evaluation_result(**_row(f"room_{i:02d}", culture))
            assert len(db.list_evaluation_results()) == 45

            after = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert after["roomsGenerated"] == 1, "evaluation runs leaked into rooms generated"
            assert after["averageSeconds"] == 120.0, "evaluation runs skewed the average"
    asyncio.run(_go())


def test_evaluation_rows_are_not_designs_or_ratings() -> None:
    """They must not appear in anyone's history, the public gallery, or ratings."""
    async def _go():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            await c.post("/api/auth/register", json={
                "fullName": "Admin", "email": "iso2@example.com",
                "password": "secret123", "phoneNumber": "0700",
            })
            for culture in ("lebanese", "khaleeji", "moroccan"):
                db.upsert_evaluation_result(**_row("room_01", culture))

            assert (await c.get("/api/history")).json() == []
            assert (await c.get("/api/history/suggested")).json() == []
            body = (await c.get("/api/admin/evaluation")).json()
            assert body["stats"]["total"] == 0
            assert body["byCulture"] == []
            assert body["recent"] == []
    asyncio.run(_go())
