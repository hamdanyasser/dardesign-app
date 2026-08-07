"""Evaluation dashboard: the numbers, and what happens when there aren't any.

The load-bearing assertions here are the negative ones. A dashboard that prints
0.0 because nothing was measured looks exactly like a dashboard reporting a
real 0.0, and an FYP panel cannot tell them apart — so "no data" must come back
as null with a reason, never as a number.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import time

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db  # noqa: E402
from backend.evaluation import (  # noqa: E402
    automatic_metrics,
    generation_report,
    overall_rating,
)
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


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c, email: str) -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": "Eval Tester", "email": email,
        "password": "secret123", "phoneNumber": "0700",
    })
    assert r.status_code == 200, r.text
    return r.json()


async def _save(c, *, duration=None, ssim=None) -> dict:
    body = {"oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": "lebanese"}
    if duration is not None:
        body["duration"] = duration
    if ssim is not None:
        body["ssim"] = ssim
    r = await c.post("/api/history", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def _rated_design(c, culture: str, *, cultural: int, quality: int, preservation: int):
    saved = await c.post("/api/history", json={
        "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": culture,
    })
    assert saved.status_code == 200, saved.text
    r = await c.post("/api/feedback", json={
        "historyId": saved.json()["id"],
        "culturalAccuracy": cultural,
        "imageQuality": quality,
        "roomPreservation": preservation,
        "furniturePlacement": "valid",
        "comment": f"{culture} note",
    })
    assert r.status_code == 200, r.text


# ---------- generation stats (history table) ----------


def test_no_saved_designs_reports_nothing_not_zero() -> None:
    s = generation_report()
    assert s["roomsGenerated"] == 0
    # The average is the dangerous one: 0.0 would read as "generation is instant".
    assert s["averageSeconds"] is None
    assert s["sampleSize"] == 0


def test_rooms_generated_counts_every_history_row() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "rooms@example.com")
            for _ in range(3):
                await _save(c, duration=None)
            assert generation_report()["roomsGenerated"] == 3
    asyncio.run(_go())


def test_average_is_the_sum_of_durations_over_the_rows_that_have_one() -> None:
    """Rows saved before Duration existed are null. Dividing by all rows would
    report an average far below any real generation, so the denominator is the
    number of timed rows -- and sampleSize says what that was."""
    async def _go():
        async with _client() as c:
            await _signup(c, "avg@example.com")
            await _save(c, duration=90.0)
            await _save(c, duration=150.0)
            await _save(c, duration=None)     # saved before durations were recorded

            s = generation_report()
            assert s["roomsGenerated"] == 3          # every row counts as a room
            assert s["totalSeconds"] == 240.0
            assert s["sampleSize"] == 2
            assert s["averageSeconds"] == 120.0      # 240 / 2, not 240 / 3
            assert s["fastestSeconds"] == 90.0
            assert s["slowestSeconds"] == 150.0
    asyncio.run(_go())


def test_duration_is_stored_and_returned_on_the_design() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "store@example.com")
            saved = await _save(c, duration=123.45)
            assert saved["duration"] == 123.45
            rows = (await c.get("/api/history")).json()
            assert rows[0]["duration"] == 123.45
    asyncio.run(_go())


def test_absurd_durations_are_clamped_before_they_reach_an_average() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "clamp@example.com")
            await _save(c, duration=10 ** 9)
            await _save(c, duration=-5)
            s = generation_report()
            assert s["slowestSeconds"] == 86_400.0
            assert s["fastestSeconds"] == 0.0
    asyncio.run(_go())


def test_generation_stats_respect_the_date_filter() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "dates@example.com")
            await _save(c, duration=100.0)
            future = time.time() + 3600
            s = generation_report(since=future)
            assert s["roomsGenerated"] == 0
            assert s["averageSeconds"] is None
    asyncio.run(_go())


def test_average_ssim_over_the_designs_that_carry_one() -> None:
    """Same shape as the duration average: measured rows only, and null rather
    than 0 when nothing has been measured."""
    async def _go():
        async with _client() as c:
            await _signup(c, "ssim@example.com")
            assert generation_report()["averageSsim"] is None

            await _save(c, ssim=0.40)
            await _save(c, ssim=0.60)
            await _save(c)                      # no measurement
            s = generation_report()
            assert s["roomsGenerated"] == 3
            assert s["averageSsim"] == 0.5      # 1.0 / 2, not 1.0 / 3
            assert s["ssimSampleSize"] == 2
    asyncio.run(_go())


def test_ssim_is_stored_and_clamped() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "ssim2@example.com")
            saved = await _save(c, ssim=0.4312)
            assert saved["ssim"] == 0.4312
            assert (await c.get("/api/history")).json()[0]["ssim"] == 0.4312

            # SSIM is bounded 0..1; anything else is a client bug and must not
            # reach an average.
            await _save(c, ssim=7.5)
            assert generation_report()["averageSsim"] == round((0.4312 + 1.0) / 2, 3)
    asyncio.run(_go())


# ---------- derived overall rating ----------


def test_overall_rating_is_the_mean_of_the_three_scores() -> None:
    assert overall_rating({
        "averageCulturalAccuracy": 4.0,
        "averageImageQuality": 5.0,
        "averageRoomPreservation": 3.0,
    }) == 4.0


def test_overall_rating_is_none_without_ratings() -> None:
    assert overall_rating({
        "averageCulturalAccuracy": None,
        "averageImageQuality": None,
        "averageRoomPreservation": None,
    }) is None


# ---------- automatic metrics ----------


def test_automatic_metrics_absent_says_so(tmp_path) -> None:
    m = automatic_metrics(tmp_path / "nope.csv")
    assert m["available"] is False
    assert m["byCulture"] == []
    assert m["reason_en"] and m["reason_ar"]     # bilingual, like every other message


def test_automatic_metrics_read_real_csv(tmp_path) -> None:
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room_id,style,ssim,lpips\n"
        "room_01,lebanese,0.40,0.25\n"
        "room_02,lebanese,0.50,0.35\n"
        "room_01,moroccan,0.60,0.20\n",
        encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["available"] is True
    assert m["metrics"] == ["ssim", "lpips"]
    assert m["images"] == 3
    by = {r["culture"]: r for r in m["byCulture"]}
    assert by["lebanese"]["ssim"] == 0.45
    assert by["lebanese"]["samples"] == 2
    assert by["moroccan"]["ssim"] == 0.6


def test_automatic_metrics_tolerate_a_partial_run(tmp_path) -> None:
    """An SSIM-only run (torchmetrics missing) is a legitimate result."""
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room_id,style,ssim,lpips\nroom_01,khaleeji,0.42,\nroom_02,khaleeji,bad,\n",
        encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["metrics"] == ["ssim"]           # lpips column is empty -> not claimed
    assert m["byCulture"][0]["ssim"] == 0.42  # the unparseable row is skipped


def test_automatic_metrics_survive_a_broken_file(tmp_path) -> None:
    p = tmp_path / "results.csv"
    p.write_bytes(b"\xff\xfe not a csv at all")
    assert automatic_metrics(p)["available"] is False


# ---------- the endpoint ----------


def test_evaluation_endpoint_requires_admin() -> None:
    async def _go():
        async with _client() as c:
            r = await c.get("/api/admin/evaluation")
            assert r.status_code == 401       # signed out

            await _signup(c, "first@example.com")   # first account is Admin
            r = await c.get("/api/admin/evaluation")
            assert r.status_code == 200
        # a second, ordinary account must not see other people's comments
        async with _client() as c2:
            await _signup(c2, "second@example.com")
            r = await c2.get("/api/admin/evaluation")
            assert r.status_code == 403
    asyncio.run(_go())


def test_evaluation_endpoint_aggregates_real_ratings() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "admin@example.com")
            await _rated_design(c, "lebanese", cultural=5, quality=4, preservation=3)
            await _rated_design(c, "lebanese", cultural=3, quality=4, preservation=5)
            await _rated_design(c, "moroccan", cultural=2, quality=2, preservation=2)

            r = await c.get("/api/admin/evaluation")
            body = r.json()

            assert body["stats"]["total"] == 3
            assert body["stats"]["averageCulturalAccuracy"] == round((5 + 3 + 2) / 3, 2)
            assert body["averageOverall"] is not None

            by = {row["culture"]: row for row in body["byCulture"]}
            assert by["lebanese"]["total"] == 2
            assert by["lebanese"]["averageCulturalAccuracy"] == 4.0
            assert by["moroccan"]["averageCulturalAccuracy"] == 2.0

            assert len(body["recent"]) == 3
            assert body["recent"][0]["comment"]
            assert body["cultures"] == ["lebanese", "khaleeji", "moroccan"]
    asyncio.run(_go())


def test_evaluation_endpoint_filters_by_culture() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "admin2@example.com")
            await _rated_design(c, "lebanese", cultural=5, quality=5, preservation=5)
            await _rated_design(c, "moroccan", cultural=1, quality=1, preservation=1)

            r = await c.get("/api/admin/evaluation", params={"culture": "lebanese"})
            body = r.json()
            assert body["stats"]["total"] == 1
            assert body["stats"]["averageCulturalAccuracy"] == 5.0
            assert all(f["culture"] == "lebanese" for f in body["recent"])

            r = await c.get("/api/admin/evaluation", params={"culture": "atlantean"})
            assert r.status_code == 400
    asyncio.run(_go())


def test_evaluation_endpoint_with_no_data_returns_nulls() -> None:
    """A fresh install must not display zeros that look like measurements."""
    async def _go():
        async with _client() as c:
            await _signup(c, "admin3@example.com")
            body = (await c.get("/api/admin/evaluation")).json()
            assert body["stats"]["total"] == 0
            assert body["stats"]["averageCulturalAccuracy"] is None
            assert body["averageOverall"] is None
            assert body["byCulture"] == []
            assert body["recent"] == []
            assert body["generation"]["averageSeconds"] is None
    asyncio.run(_go())
