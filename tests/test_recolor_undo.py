"""Undo / Reset across *several* colour changes.

tests/test_recolor.py covers one edit and a two-deep stack. This file is the
harder case the feature is actually used in: wall, then floor, then wall again,
stepping all the way back — and the guarantee that stepping back is purely a
view operation. Nothing here may touch the designs the user saved.
"""
from __future__ import annotations

import asyncio
import io
import os
import sys
from pathlib import Path

import httpx
import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db  # noqa: E402
from backend.main import _reset_for_tests, app  # noqa: E402
from backend.room_analysis import (  # noqa: E402
    ID_FLOOR,
    ID_WALL,
    analyze_room,
    cache_analysis,
)

STYLE = "lebanese"


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (180, 120, 60)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _room_with_floor(size: int = 128):
    """A room that has both surfaces, so wall and floor edits can interleave.
    LIGHT's synthetic room has no ADE20K floor, which is right for that mode and
    useless for this test."""
    seg = np.full((size, size), ID_WALL, dtype=np.int32)
    seg[size // 2 :, :] = ID_FLOOR
    seg[size // 2 - 20 : size // 2 + 10, 40:90] = 23  # sofa
    depth = np.tile(np.linspace(0.2, 0.9, size, dtype=np.float32)[:, None], (1, size))
    return depth, seg


async def _new_job(c: httpx.AsyncClient) -> tuple[str, str]:
    """Generate a room, then give it an analysis containing a real floor."""
    r = await c.post(
        "/redesign",
        files={"file": ("room.png", _png(), "image/png")},
        data={"styles": STYLE},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    cache_analysis(body["job_id"], analyze_room(*_room_with_floor()))
    return body["job_id"], body[STYLE]


async def _apply(c, job_id: str, target: str, color: str) -> str:
    r = await c.post("/api/color/apply", json={
        "job_id": job_id, "style": STYLE, "target": target, "color": color,
    })
    assert r.status_code == 200, r.text
    return r.json()["image"]


async def _step(c, path: str) -> dict:
    r = await c.post(f"/api/color/{path}", json={"job_id": job_id_holder[0], "style": STYLE})
    assert r.status_code == 200, r.text
    return r.json()


job_id_holder: list[str] = [""]


def test_undo_walks_back_through_every_change() -> None:
    """Three edits, three undos: each one lands on exactly the image that was on
    screen before the change it is undoing."""
    async def _go():
        async with _client() as c:
            job_id, original = await _new_job(c)
            job_id_holder[0] = job_id

            v1 = await _apply(c, job_id, "wall", "#2E5F8A")
            v2 = await _apply(c, job_id, "floor", "#6B4226")
            v3 = await _apply(c, job_id, "wall", "#8A2E2E")

            # Every stage is a distinct image — otherwise the walk below proves nothing.
            assert len({original, v1, v2, v3}) == 4

            back = await _step(c, "undo")
            assert back["image"] == v2 and back["can_undo"] is True
            back = await _step(c, "undo")
            assert back["image"] == v1 and back["can_undo"] is True
            back = await _step(c, "undo")
            assert back["image"] == original and back["can_undo"] is False

            # Nothing left to step back to.
            r = await c.post("/api/color/undo", json={"job_id": job_id, "style": STYLE})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "nothing_to_undo"

    asyncio.run(_go())


def test_reset_returns_to_the_generated_render_from_any_depth() -> None:
    async def _go():
        async with _client() as c:
            job_id, original = await _new_job(c)
            job_id_holder[0] = job_id

            await _apply(c, job_id, "wall", "#2E5F8A")
            await _apply(c, job_id, "floor", "#6B4226")
            await _apply(c, job_id, "wall", "#4F6F52")

            out = await _step(c, "reset")
            assert out["image"] == original
            assert out["can_undo"] is False

            # Reset is not repeatable — there is nothing left to undo.
            r = await c.post("/api/color/reset", json={"job_id": job_id, "style": STYLE})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "nothing_to_undo"

    asyncio.run(_go())


def test_editing_after_an_undo_rebuilds_the_stack() -> None:
    """Undo then pick a different colour: the new edit stacks on what is on
    screen, and undoing it returns there — not to the abandoned branch."""
    async def _go():
        async with _client() as c:
            job_id, original = await _new_job(c)
            job_id_holder[0] = job_id

            v1 = await _apply(c, job_id, "wall", "#2E5F8A")
            await _apply(c, job_id, "wall", "#8A2E2E")
            back = await _step(c, "undo")
            assert back["image"] == v1

            v3 = await _apply(c, job_id, "floor", "#C4A484")
            assert v3 != v1
            back = await _step(c, "undo")
            assert back["image"] == v1
            back = await _step(c, "undo")
            assert back["image"] == original

    asyncio.run(_go())


def test_undo_and_reset_never_touch_saved_designs(tmp_path, monkeypatch) -> None:
    """The requirement in one test: stepping back is a view operation.

    A design saved from a recoloured render stays saved, byte for byte, however
    many times the studio is undone or reset afterwards.
    """
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    try:
        async def _go():
            async with _client() as c:
                job_id, original = await _new_job(c)
                job_id_holder[0] = job_id

                await c.post("/api/auth/register", json={
                    "fullName": "Undo Tester", "email": "undo@example.com",
                    "password": "secret123", "phoneNumber": "0000",
                })

                v1 = await _apply(c, job_id, "wall", "#2E5F8A")
                saved = await c.post("/api/history", json={
                    "oldImage": original, "newImage": v1, "culture": STYLE,
                })
                assert saved.status_code == 200
                row = saved.json()

                before = await c.get("/api/history")
                assert before.status_code == 200
                count_before = len(before.json())

                await _apply(c, job_id, "floor", "#6B4226")
                await _step(c, "undo")
                await _step(c, "reset")

                after = await c.get("/api/history")
                rows = after.json()
                assert len(rows) == count_before, "undo/reset changed the number of saved designs"
                assert rows[0]["id"] == row["id"]
                assert rows[0]["newImageUrl"] == row["newImageUrl"], "a saved design was rewritten"

        asyncio.run(_go())
    finally:
        db.close()


def test_targets_reports_undo_state_so_a_remount_can_recover_it() -> None:
    """The UI must be able to ask whether stepping back is possible.

    Without this the buttons are driven by client-only state, so switching
    culture and coming back greys out an Undo the server can still perform.
    """
    async def _go():
        async with _client() as c:
            job_id, _ = await _new_job(c)

            r = await c.get("/api/color/targets", params={"job_id": job_id, "style": STYLE})
            assert r.status_code == 200
            assert r.json()["can_undo"] is False

            await _apply(c, job_id, "wall", "#2E5F8A")
            r = await c.get("/api/color/targets", params={"job_id": job_id, "style": STYLE})
            assert r.json()["can_undo"] is True

            job_id_holder[0] = job_id
            await _step(c, "reset")
            r = await c.get("/api/color/targets", params={"job_id": job_id, "style": STYLE})
            assert r.json()["can_undo"] is False

    asyncio.run(_go())
