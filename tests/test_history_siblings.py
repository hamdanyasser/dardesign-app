"""An "all three" generation is saved as all three, and is still ONE design.

Asking for three cultures produces three readings of one room; before this, only
the featured image survived the tab being closed, so the comparison the user
waited three times as long for was thrown away.

The two halves of that are tested together on purpose, because the second is
what makes the first safe: the companions must reach history AND must not turn
one generation into three rows. A history row is the evaluation record — one
Culture, one Ssim, one Duration, one PredictedCulture — so extra rows would
count one room three times in `roomsGenerated` and average a single run's
duration three times in "average generation time".

NO GPU — DARDESIGN_LIGHT, no model ever loads.
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


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c: httpx.AsyncClient, email: str) -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": "Test User", "email": email,
        "password": "secret123", "phoneNumber": "070000000",
    })
    assert r.status_code == 200, r.text
    return r.json()


async def _save_all_three(c: httpx.AsyncClient, **extra) -> dict:
    body = {
        "oldImage": PNG_DATA_URL,
        "newImage": PNG_DATA_URL,
        "culture": "lebanese",
        "duration": 163.94,
        "ssim": 0.82,
        "siblings": [
            {"culture": "khaleeji", "image": PNG_DATA_URL},
            {"culture": "moroccan", "image": PNG_DATA_URL},
        ],
        **extra,
    }
    r = await c.post("/api/history", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_other_cultures_are_saved_and_listed() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "three@example.com")
            saved = await _save_all_three(c)
            assert [s["culture"] for s in saved["siblings"]] == ["khaleeji", "moroccan"]

            listed = (await c.get("/api/history")).json()
            assert len(listed) == 1
            entry = listed[0]
            assert [s["culture"] for s in entry["siblings"]] == ["khaleeji", "moroccan"]
            # Each one is a real stored file, not the data URL echoed back.
            for s in entry["siblings"]:
                assert s["url"].startswith("images/")
                assert (ROOT / s["url"]).exists(), s["url"]
            # Distinct files: the plate would otherwise show one image three times.
            urls = {s["url"] for s in entry["siblings"]} | {entry["newImageUrl"]}
            assert len(urls) == 3
    asyncio.run(_go())


def test_three_cultures_are_still_one_saved_design() -> None:
    """The measurement corpus must not notice that a run produced three images."""
    async def _go():
        async with _client() as c:
            await _signup(c, "one@example.com")
            await _save_all_three(c)

            stats = db.history_generation_stats()
            assert stats["roomsGenerated"] == 1, "one generation became several designs"
            # One run, one duration — not the same 163.94s averaged three times.
            # (The stat rounds to one decimal, hence 163.9 rather than 163.94.)
            assert stats["sampleSize"] == 1
            assert stats["averageSeconds"] == 163.9
            assert db.designs_by_culture() == [{"culture": "lebanese", "total": 1}]
    asyncio.run(_go())


def test_a_single_culture_design_has_no_companions() -> None:
    """No siblings must stay exactly the old shape — an empty list, never null."""
    async def _go():
        async with _client() as c:
            await _signup(c, "solo@example.com")
            r = await c.post("/api/history", json={
                "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": "lebanese",
            })
            assert r.status_code == 200, r.text
            assert r.json()["siblings"] == []
            assert (await c.get("/api/history")).json()[0]["siblings"] == []
    asyncio.run(_go())


def test_an_unknown_or_duplicate_culture_is_dropped_not_stored() -> None:
    """The label is what the rest of the app reads, so it cannot be free text.

    A repeat of the design's own culture is dropped too: the plate would
    otherwise show the featured render twice under two headings.
    """
    async def _go():
        async with _client() as c:
            await _signup(c, "junk@example.com")
            r = await c.post("/api/history", json={
                "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL,
                "culture": "lebanese",
                "siblings": [
                    {"culture": "atlantean", "image": PNG_DATA_URL},
                    {"culture": "lebanese", "image": PNG_DATA_URL},
                    {"culture": "khaleeji", "image": PNG_DATA_URL},
                    {"culture": "khaleeji", "image": PNG_DATA_URL},
                ],
            })
            assert r.status_code == 200, r.text
            assert [s["culture"] for s in r.json()["siblings"]] == ["khaleeji"]
    asyncio.run(_go())


def test_a_row_written_before_the_column_existed_still_lists() -> None:
    """Null, and unparseable JSON, both read as "no companions" rather than 500.

    The listing is the one page a user cannot work around, so a bad value in one
    row must never cost them the whole archive.
    """
    async def _go():
        async with _client() as c:
            user = await _signup(c, "legacy@example.com")
            entry_id = db.add_history(user["id"], "images/a.png", "images/b.png",
                                      culture="lebanese")
            db._write("UPDATE history SET SiblingImages = ? WHERE Id = ?",
                      ("not json at all", entry_id))
            listed = (await c.get("/api/history")).json()
            assert listed[0]["siblings"] == []
    asyncio.run(_go())
