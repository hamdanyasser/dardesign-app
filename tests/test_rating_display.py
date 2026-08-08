"""Ratings shown in History and Others' Work.

Display only: these assert that the listings carry the rating the existing form
already saved, and that nothing about how ratings are given or stored changed.
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


@pytest.fixture(autouse=True)
def _no_background_eval(monkeypatch):
    from backend import main as backend_main
    monkeypatch.setattr(backend_main, "_evaluate_saved_design", lambda *a, **k: None)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c, email: str):
    r = await c.post("/api/auth/register", json={
        "fullName": "Rater One", "email": email, "password": "secret123", "phoneNumber": "07",
    })
    assert r.status_code == 200, r.text


async def _save(c, culture: str = "lebanese") -> int:
    r = await c.post("/api/history", json={
        "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": culture,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _rate(c, history_id: int, *, cultural=5, quality=4, preservation=3, comment=None):
    body = {
        "historyId": history_id, "culturalAccuracy": cultural, "imageQuality": quality,
        "roomPreservation": preservation, "furniturePlacement": "valid",
    }
    if comment:
        body["comment"] = comment
    r = await c.post("/api/feedback", json=body)
    assert r.status_code == 200, r.text


def test_history_carries_an_existing_rating() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "h1@example.com")
            eid = await _save(c)
            await _rate(c, eid, cultural=5, quality=4, preservation=3)

            entry = (await c.get("/api/history")).json()[0]
            assert entry["rating"] == {
                "culturalAccuracy": 5,
                "imageQuality": 4,
                "roomPreservation": 3,
                "overall": 4.0,          # mean of the three
            }
    asyncio.run(_go())


def test_unrated_designs_report_null_not_zero() -> None:
    """"Not rated" and "rated 0" must stay distinguishable — the scale starts
    at 1, so a zero could only be a rendering accident."""
    async def _go():
        async with _client() as c:
            await _signup(c, "h2@example.com")
            await _save(c)
            assert (await c.get("/api/history")).json()[0]["rating"] is None
    asyncio.run(_go())


def test_rating_appears_in_others_work_once_shared() -> None:
    async def _go():
        async with _client() as owner, _client() as viewer:
            await _signup(owner, "owner@example.com")
            eid = await _save(owner, "moroccan")
            await _rate(owner, eid, cultural=4, quality=4, preservation=4)

            await _signup(viewer, "viewer@example.com")
            # Not shared yet: the gallery is empty, rating or no rating.
            assert (await viewer.get("/api/history/suggested")).json() == []

            assert (await owner.patch(
                f"/api/history/{eid}/suggest", json={"isSuggested": True}
            )).status_code == 200

            shared = (await viewer.get("/api/history/suggested")).json()
            assert len(shared) == 1
            assert shared[0]["rating"]["overall"] == 4.0
            assert shared[0]["authorName"] == "Rater"      # first name only, unchanged
    asyncio.run(_go())


def test_shared_but_unrated_design_shows_no_rating() -> None:
    async def _go():
        async with _client() as owner, _client() as viewer:
            await _signup(owner, "o2@example.com")
            eid = await _save(owner)
            await owner.patch(f"/api/history/{eid}/suggest", json={"isSuggested": True})

            await _signup(viewer, "v2@example.com")
            shared = (await viewer.get("/api/history/suggested")).json()
            assert len(shared) == 1 and shared[0]["rating"] is None
    asyncio.run(_go())


def test_the_written_comment_is_not_exposed_to_the_gallery() -> None:
    """Sharing a design shares the design, not what its author wrote about it."""
    async def _go():
        async with _client() as owner, _client() as viewer:
            await _signup(owner, "o3@example.com")
            eid = await _save(owner)
            await _rate(owner, eid, comment="a private note about my own room")
            await owner.patch(f"/api/history/{eid}/suggest", json={"isSuggested": True})

            await _signup(viewer, "v3@example.com")
            shared = (await viewer.get("/api/history/suggested")).json()
            assert "private note" not in str(shared)
            assert set(shared[0]["rating"]) == {
                "culturalAccuracy", "imageQuality", "roomPreservation", "overall",
            }
    asyncio.run(_go())


def test_rating_flow_itself_is_unchanged() -> None:
    """The form still owns writing: submitting twice updates one record, and
    /api/feedback still returns it."""
    async def _go():
        async with _client() as c:
            await _signup(c, "h3@example.com")
            eid = await _save(c)
            await _rate(c, eid, cultural=2, quality=2, preservation=2)
            await _rate(c, eid, cultural=5, quality=5, preservation=5)

            got = (await c.get(f"/api/feedback/{eid}")).json()
            assert got["culturalAccuracy"] == 5
            assert (await c.get("/api/history")).json()[0]["rating"]["overall"] == 5.0
            # Still exactly one feedback record for the design.
            assert db.feedback_stats()["total"] == 1
    asyncio.run(_go())


def test_deleting_a_design_takes_its_rating_with_it() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "h4@example.com")
            eid = await _save(c)
            await _rate(c, eid)
            assert db.feedback_stats()["total"] == 1

            assert (await c.delete(f"/api/history/{eid}")).status_code == 200
            assert (await c.get("/api/history")).json() == []
            assert db.feedback_stats()["total"] == 0
    asyncio.run(_go())
