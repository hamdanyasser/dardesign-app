"""Reopening a saved design: the scene must come back as itself, to its owner.

A Build Mode design is worth saving only if it can be picked up again, so the
round trip is asserted end to end rather than assumed from the column existing.
The security-shaped cases matter most: a scene is the full layout of someone's
room, and the endpoint that returns it must be scoped by owner in the query,
not filtered afterwards.

NO GPU — DARDESIGN_LIGHT, no model ever loads.
"""
from __future__ import annotations

import asyncio
import json
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
from backend.main import MAX_SCENE_CHARS, app  # noqa: E402

PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# Shaped like a real DesignScene (src/lib/design/types.ts). The backend never
# parses it — that is the point — so the test asserts it comes back byte-equal
# rather than field by field.
SCENE = {
    "version": 3,
    "id": "scene-abc",
    "culture": "moroccan",
    "room": {"widthCm": 620, "depthCm": 650, "heightCm": 300, "areaM2": 40.3,
             "scaleConfidence": None, "floorMaterialKey": "zellige",
             "wallMaterialKey": "tadelakt"},
    "objects": [
        {"uid": "u1", "origin": "catalog", "catalogId": "mor-sofa-001",
         "category": "sofa", "labelEn": "Sedari", "labelAr": "سداري",
         "x": 0, "z": -165, "rotationDeg": 0,
         "widthCm": 220, "depthCm": 85, "heightCm": 75, "materialKey": "velvet"},
    ],
    "provenance": {"jobId": None, "shellSource": "default", "foundCount": 0,
                   "placeholder": False},
    "createdAt": 1, "updatedAt": 2,
}


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


async def _save(c: httpx.AsyncClient, scene=None) -> dict:
    body = {"oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL,
            "culture": "moroccan", "edited": True}
    if scene is not None:
        body["scene"] = json.dumps(scene)
        body["sceneVersion"] = scene["version"]
    r = await c.post("/api/history", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_saved_scene_comes_back_byte_identical():
    """The backend stores the scene verbatim and never interprets it.

    types.ts is the single definition of the shape; parsing it in Python would
    be a second definition to keep in step, and drift there would silently
    corrupt saved rooms.
    """
    async def go():
        async with _client() as c:
            await _signup(c, "scene1@test.com")
            saved = await _save(c, SCENE)
            r = await c.get(f"/api/history/{saved['id']}/scene")
            assert r.status_code == 200, r.text
            body = r.json()
            assert json.loads(body["scene"]) == SCENE
            assert body["sceneVersion"] == 3
    asyncio.run(go())


def test_the_listing_advertises_the_scene_without_carrying_it():
    """hasScene drives the Edit button; the JSON is fetched only when pressed.

    A listing is up to 100 rows and a scene is a few KB, so including scenes
    would cost megabytes on every visit to serve a button most rows never press.
    """
    async def go():
        async with _client() as c:
            await _signup(c, "scene2@test.com")
            await _save(c, SCENE)
            r = await c.get("/api/history")
            row = r.json()[0]
            assert row["hasScene"] is True
            assert row["sceneVersion"] == 3
            assert "scene" not in row and "sceneJson" not in row
    asyncio.run(go())


def test_a_studio_design_has_no_scene_and_says_so():
    """A render of a photograph has no layout behind it. The button must be
    absent rather than present and failing."""
    async def go():
        async with _client() as c:
            await _signup(c, "scene3@test.com")
            saved = await _save(c)  # no scene
            row = (await c.get("/api/history")).json()[0]
            assert row["hasScene"] is False
            assert row["sceneVersion"] is None
            r = await c.get(f"/api/history/{saved['id']}/scene")
            assert r.status_code == 404
            assert r.json()["detail"]["code"] == "no_scene"
    asyncio.run(go())


def test_another_account_cannot_read_your_scene():
    """A scene is the full layout of someone's room.

    Scoped by UserId inside the WHERE clause, so this is a 404 rather than a
    row fetched and then filtered — the same discipline as list_history.
    """
    async def go():
        async with _client() as c:
            await _signup(c, "owner@test.com")
            saved = await _save(c, SCENE)
        async with _client() as other:
            await _signup(other, "intruder@test.com")
            r = await other.get(f"/api/history/{saved['id']}/scene")
            assert r.status_code == 404, "another account must not read this scene"
    asyncio.run(go())


def test_a_signed_out_visitor_cannot_read_a_scene():
    async def go():
        async with _client() as c:
            await _signup(c, "owner2@test.com")
            saved = await _save(c, SCENE)
        async with _client() as anon:
            r = await anon.get(f"/api/history/{saved['id']}/scene")
            assert r.status_code == 401
    asyncio.run(go())


def test_an_absurd_scene_is_refused_not_truncated():
    """Half a scene would parse into a room missing furniture — worse than none.

    Refused with 413 rather than silently trimmed, because a saved design that
    quietly lost pieces is a fiction the user would not notice.
    """
    async def go():
        async with _client() as c:
            await _signup(c, "big@test.com")
            r = await c.post("/api/history", json={
                "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL,
                "scene": "x" * (MAX_SCENE_CHARS + 1), "sceneVersion": 3,
            })
            assert r.status_code == 413
            assert r.json()["detail"]["code"] == "scene_too_large"
            assert (await c.get("/api/history")).json() == [], "nothing may be stored"
    asyncio.run(go())


def test_saving_a_scene_does_not_disturb_the_evaluation_corpus():
    """A Build Mode render is a scene the USER composed.

    Scoring it would measure their layout rather than the model's generation, so
    it is saved with edited=1 and must stay out of the evaluated population that
    the dashboard's averages and confusion matrix are built from.
    """
    async def go():
        async with _client() as c:
            await _signup(c, "corpus@test.com")
            await _save(c, SCENE)
            row = (await c.get("/api/history")).json()[0]
            assert row["isEdited"] is True
            assert row["ssim"] is None, "no photograph to preserve structure against"
    asyncio.run(go())
