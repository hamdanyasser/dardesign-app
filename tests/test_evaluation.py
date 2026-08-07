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

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import audit, db  # noqa: E402
from backend.evaluation import (  # noqa: E402
    automatic_metrics,
    generation_stats,
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


@pytest.fixture
def audit_log(tmp_path, monkeypatch):
    """An isolated audit file — these tests must not read the real render log."""
    monkeypatch.setattr(audit, "AUDIT_PATH", tmp_path / "audit.jsonl")
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c, email: str) -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": "Eval Tester", "email": email,
        "password": "secret123", "phoneNumber": "0700",
    })
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


# ---------- generation stats ----------


def test_no_renders_reports_nothing_not_zero(audit_log) -> None:
    s = generation_stats()
    assert s["roomsGenerated"] == 0
    # The averages are the dangerous ones: 0.0 would read as "renders take no time".
    assert s["averageSeconds"] is None
    assert s["successRate"] is None
    assert s["sampleSize"] == 0


def test_placeholder_runs_are_excluded_from_generation_stats(audit_log) -> None:
    """DARDESIGN_LIGHT runs are instant stand-ins, not renders. Counting them
    would inflate the room count and crush the average time."""
    audit.log_event("redesign", ok=True, styles=["lebanese"], duration_s=90.0, light=False)
    audit.log_event("redesign", ok=True, styles=["lebanese"], duration_s=0.2, light=True)
    audit.log_event("redesign", ok=True, styles=["lebanese"], duration_s=110.0, light=False)

    s = generation_stats()
    assert s["roomsGenerated"] == 2
    assert s["averageSeconds"] == 100.0
    assert s["placeholderRunsExcluded"] == 1


def test_rooms_images_failures_and_success_rate(audit_log) -> None:
    audit.log_event("redesign", ok=True, styles=["lebanese", "khaleeji", "moroccan"], duration_s=300.0)
    audit.log_event("redesign", ok=True, styles=["lebanese"], duration_s=100.0)
    audit.log_event("restyle", ok=True, style="persian", duration_s=50.0)
    audit.log_event("redesign", ok=False, error="boom", duration_s=5.0)

    s = generation_stats()
    assert s["roomsGenerated"] == 2          # two /redesign requests
    assert s["imagesGenerated"] == 4         # 3 + 1 cultures
    assert s["restyles"] == 1
    assert s["failures"] == 1
    assert s["successRate"] == 0.75
    assert s["averageSeconds"] == 150.0      # 300, 100, 50 — the failure is excluded
    assert s["fastestSeconds"] == 50.0 and s["slowestSeconds"] == 300.0


def test_other_audit_events_are_ignored(audit_log) -> None:
    """history_save and colour edits are logged too; they are not generations."""
    audit.log_event("history_save", ok=True)
    audit.log_event("color_edit", ok=True, target="wall")
    assert generation_stats()["roomsGenerated"] == 0


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


# ---------- recorded generations ----------


def test_recorded_generations_take_over_from_the_audit_log(audit_log) -> None:
    """Once the studio records renders, the durable table is the source — the
    audit log belongs to whichever box did the rendering and dies with it."""
    async def _go():
        async with _client() as c:
            audit.log_event("redesign", ok=True, styles=["lebanese"], duration_s=999.0, light=False)
            await _signup(c, "gen@example.com")

            before = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert before["source"] == "audit_log"

            r = await c.post("/api/generations", json={
                "jobId": "job-1", "styles": ["lebanese", "khaleeji", "moroccan"],
                "durationSeconds": 300.0, "ok": True, "light": False,
            })
            assert r.status_code == 200
            assert r.json()["recorded"] == 3   # one row per culture

            gen = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert gen["source"] == "database"
            assert gen["roomsGenerated"] == 1        # one job, three cultures
            assert gen["imagesGenerated"] == 3
            # 300s of wall clock covering three sequential renders is 100s each;
            # attributing the full 300 to each would treble the reported time.
            assert gen["averageSeconds"] == 100.0
            assert gen["sampleSize"] == 3
    asyncio.run(_go())


def test_recorded_placeholder_runs_are_excluded(audit_log) -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "gen2@example.com")
            await c.post("/api/generations", json={
                "jobId": "real", "styles": ["lebanese"], "durationSeconds": 120.0, "light": False,
            })
            await c.post("/api/generations", json={
                "jobId": "fake", "styles": ["lebanese"], "durationSeconds": 0.2, "light": True,
            })
            gen = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert gen["roomsGenerated"] == 1
            assert gen["averageSeconds"] == 120.0
            assert gen["placeholderRunsExcluded"] == 1
    asyncio.run(_go())


def test_recording_needs_no_account_and_rejects_junk(audit_log) -> None:
    """A room can be generated signed out, so the record must still be kept —
    but nothing a client sends is trusted onto a dashboard unchecked."""
    async def _go():
        async with _client() as c:
            r = await c.post("/api/generations", json={
                "jobId": "anon", "styles": ["lebanese"], "durationSeconds": 60.0,
            })
            assert r.status_code == 200          # no session required

            # An unknown style is dropped rather than stored as a culture.
            r = await c.post("/api/generations", json={
                "jobId": "bad", "styles": ["atlantean"], "durationSeconds": 60.0,
            })
            assert r.status_code == 200
            assert r.json()["recorded"] == 1     # recorded, culture null

            # An absurd duration is clamped, not averaged in as-is.
            await c.post("/api/generations", json={
                "jobId": "huge", "styles": ["lebanese"], "durationSeconds": 10 ** 9,
            })
            assert db.generation_stats()["slowestSeconds"] == 86_400.0
    asyncio.run(_go())


def test_failed_generations_do_not_skew_the_average(audit_log) -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "gen3@example.com")
            await c.post("/api/generations", json={
                "jobId": "ok", "styles": ["lebanese"], "durationSeconds": 100.0, "ok": True,
            })
            await c.post("/api/generations", json={
                "jobId": "boom", "styles": ["lebanese"], "durationSeconds": 3.0, "ok": False,
            })
            gen = (await c.get("/api/admin/evaluation")).json()["generation"]
            assert gen["roomsGenerated"] == 1
            assert gen["failures"] == 1
            assert gen["successRate"] == 0.5
            assert gen["averageSeconds"] == 100.0
    asyncio.run(_go())


def test_recorded_generations_respect_the_date_filter(audit_log) -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "gen4@example.com")
            await c.post("/api/generations", json={
                "jobId": "now", "styles": ["lebanese"], "durationSeconds": 100.0,
            })
            future = __import__("time").time() + 3600
            gen = (await c.get("/api/admin/evaluation", params={"since": future})).json()["generation"]
            assert gen["filtered"] is True
            assert gen["roomsGenerated"] == 0
            assert gen["averageSeconds"] is None
    asyncio.run(_go())


def test_evaluation_endpoint_requires_admin(audit_log) -> None:
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


def test_evaluation_endpoint_aggregates_real_ratings(audit_log) -> None:
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


def test_evaluation_endpoint_filters_by_culture(audit_log) -> None:
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


def test_evaluation_endpoint_with_no_data_returns_nulls(audit_log) -> None:
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
