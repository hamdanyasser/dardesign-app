"""Colour Control: the recolour maths + the /api/color/* contract.

Runs in DARDESIGN_LIGHT like the rest of the suite. The unit tests build their
own seg maps so both a present and an absent surface can be exercised exactly;
the API tests go through a real /redesign so the masks come from the same cache
the feature uses in production.
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

# MUST be set BEFORE importing transform.py.
os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db  # noqa: E402
from backend.main import _reset_for_tests, app  # noqa: E402
from backend.recolor import (  # noqa: E402
    MIN_COVERAGE,
    RecolorError,
    coverage,
    parse_hex_color,
    recolor_surface,
    target_mask,
)
from backend.room_analysis import ID_FLOOR, ID_RUG, ID_WALL, analyze_room  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (180, 120, 60)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


def _async_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# --------------------------------------------------------------------------
# A room we control: top half wall, bottom-left floor, bottom-right rug,
# a sofa in the middle. Lets every mask case be asserted exactly.
# --------------------------------------------------------------------------
def _room(size: int = 128, *, with_floor: bool = True) -> tuple[np.ndarray, np.ndarray]:
    seg = np.full((size, size), ID_WALL, dtype=np.int32)
    half = size // 2
    if with_floor:
        seg[half:, :half] = ID_FLOOR
    seg[half:, half:] = ID_RUG
    seg[half - 20 : half + 10, 40:90] = 23  # sofa
    depth = np.tile(np.linspace(0.2, 0.9, size, dtype=np.float32)[:, None], (1, size))
    return depth, seg


def _photo(size: int = 128) -> Image.Image:
    """A gradient, so "did the texture survive?" is answerable."""
    grad = np.tile(np.linspace(40, 220, size, dtype=np.uint8)[:, None], (1, size))
    return Image.fromarray(np.dstack([grad, grad, grad]), "RGB")


# ---------- colour parsing ----------


def test_parse_hex_color_accepts_both_forms() -> None:
    assert parse_hex_color("#C0392B") == (192, 57, 43)
    assert parse_hex_color("c0392b") == (192, 57, 43)


@pytest.mark.parametrize("bad", ["", "red", "#fff", "#12345g", "rgb(1,2,3)"])
def test_parse_hex_color_rejects_junk(bad: str) -> None:
    with pytest.raises(RecolorError):
        parse_hex_color(bad)


# ---------- masks ----------


def test_floor_mask_excludes_the_rug() -> None:
    """`floor_mask` counts rugs as standing-room for furniture on purpose.
    Recolouring must not inherit that — a rug is not the floor."""
    analysis = analyze_room(*_room())
    floor = target_mask(analysis, "floor")
    rug_region = analysis.seg_ids == ID_RUG
    assert floor.any()
    assert not (floor & rug_region).any()
    assert floor.sum() < analysis.floor_mask.sum()


def test_wall_mask_excludes_furniture() -> None:
    analysis = analyze_room(*_room())
    wall = target_mask(analysis, "wall")
    assert not (wall & (analysis.seg_ids == 23)).any()


def test_missing_floor_is_reported_not_silently_skipped() -> None:
    analysis = analyze_room(*_room(with_floor=False))
    assert coverage(target_mask(analysis, "floor")) < MIN_COVERAGE
    with pytest.raises(RecolorError) as e:
        recolor_surface(_photo(), analysis, "floor", (60, 90, 200))
    assert "floor" in e.value.message_en.lower()
    assert e.value.message_ar  # bilingual, always


def test_unknown_target_rejected() -> None:
    analysis = analyze_room(*_room())
    with pytest.raises(RecolorError):
        recolor_surface(_photo(), analysis, "ceiling", (60, 90, 200))


# ---------- the recolour itself ----------


def test_recolor_changes_only_the_masked_surface() -> None:
    analysis = analyze_room(*_room())
    base = _photo()
    out, meta = recolor_surface(base, analysis, "floor", (60, 90, 200))

    before = np.asarray(base, dtype=np.int16)
    after = np.asarray(out, dtype=np.int16)
    changed = np.abs(after - before).sum(axis=2) > 8

    floor = np.asarray(
        Image.fromarray((target_mask(analysis, "floor") * 255).astype(np.uint8), "L")
        .resize(base.size, Image.NEAREST)
    ) > 127
    rug = np.asarray(
        Image.fromarray(((analysis.seg_ids == ID_RUG) * 255).astype(np.uint8), "L")
        .resize(base.size, Image.NEAREST)
    ) > 127

    # Most of the floor moved...
    assert changed[floor].mean() > 0.8
    # ...and the rug (furniture, doors and windows likewise) did not.
    assert changed[rug].mean() < 0.05
    assert meta["target"] == "floor"
    assert meta["color"] == "#3c5ac8"


def test_recolor_preserves_shading_and_texture() -> None:
    """The point of the HSV edit: the surface takes the new hue but keeps its
    own light. A solid fill would flatten the gradient to zero variance."""
    analysis = analyze_room(*_room())
    base = _photo()
    out, _ = recolor_surface(base, analysis, "wall", (200, 60, 60))

    wall = np.asarray(
        Image.fromarray((target_mask(analysis, "wall") * 255).astype(np.uint8), "L")
        .resize(base.size, Image.NEAREST)
    ) > 127

    before_v = np.asarray(base.convert("L"), dtype=np.float32)[wall]
    after_v = np.asarray(out.convert("L"), dtype=np.float32)[wall]
    assert after_v.std() > before_v.std() * 0.5      # texture survived
    assert np.corrcoef(before_v, after_v)[0, 1] > 0.9  # and so did its shape

    after_rgb = np.asarray(out, dtype=np.float32)
    assert after_rgb[..., 0][wall].mean() > after_rgb[..., 2][wall].mean()  # now warm


def test_no_halo_or_bleed_at_a_furniture_edge() -> None:
    """The mask edge is feathered, not eroded.

    Eroding it first traces every object in the *old* colour, which reads as a
    glow around the furniture; this asserts the wall is painted right up to the
    sofa while the sofa's own pixels stay put.
    """
    analysis = analyze_room(*_room())
    base = _photo()
    out, _ = recolor_surface(base, analysis, "wall", (200, 60, 60))

    before = np.asarray(base, dtype=np.int16)
    after = np.asarray(out, dtype=np.int16)
    delta = np.abs(after - before).sum(axis=2)

    # Sofa spans rows 44..74, cols 40..90 in the 128px test room.
    assert delta[50:68, 46:84].max() == 0            # inside the sofa: untouched
    assert (delta[30:41, 40:90] > 8).mean() > 0.95   # wall right above it: painted


def test_recolor_leaves_the_input_untouched() -> None:
    analysis = analyze_room(*_room())
    base = _photo()
    snapshot = np.asarray(base).copy()
    recolor_surface(base, analysis, "wall", (10, 10, 10))
    assert np.array_equal(np.asarray(base), snapshot)


# ---------- API ----------


async def _redesign(c: httpx.AsyncClient) -> dict:
    r = await c.post(
        "/redesign",
        files={"file": ("room.png", _png(), "image/png")},
        data={"styles": "lebanese"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_api_preview_apply_undo_reset() -> None:
    async def _go():
        async with _async_client() as c:
            body = await _redesign(c)
            job_id = body["job_id"]
            base_image = body["lebanese"]
            req = {
                "job_id": job_id, "style": "lebanese",
                "target": "wall", "color": "#2E5F8A",
            }

            # Preview must not move any state.
            r = await c.post("/api/color/preview", json=req)
            assert r.status_code == 200, r.text
            preview = r.json()
            assert preview["image"].startswith("data:image/png;base64,")
            assert preview["image"] != base_image
            assert preview["target"] == "wall"

            r = await c.post("/api/color/undo", json={"job_id": job_id, "style": "lebanese"})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "nothing_to_undo"

            # Confirm.
            r = await c.post("/api/color/apply", json=req)
            assert r.status_code == 200, r.text
            applied = r.json()
            assert applied["can_undo"] is True
            assert applied["image"] != base_image

            # A second colour on top of the first.
            r = await c.post("/api/color/apply", json={**req, "color": "#8A2E2E"})
            assert r.status_code == 200
            second = r.json()["image"]
            assert second != applied["image"]

            # Undo steps back exactly one.
            r = await c.post("/api/color/undo", json={"job_id": job_id, "style": "lebanese"})
            assert r.status_code == 200
            assert r.json()["image"] == applied["image"]
            assert r.json()["can_undo"] is True

            # Reset returns the render as generated.
            r = await c.post("/api/color/reset", json={"job_id": job_id, "style": "lebanese"})
            assert r.status_code == 200
            assert r.json()["image"] == base_image
            assert r.json()["can_undo"] is False

    asyncio.run(_go())


def test_api_rejects_bad_colour_and_target() -> None:
    async def _go():
        async with _async_client() as c:
            job_id = (await _redesign(c))["job_id"]
            base = {"job_id": job_id, "style": "lebanese"}

            r = await c.post("/api/color/preview", json={**base, "target": "wall", "color": "blue"})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "bad_color"
            assert r.json()["detail"]["message_ar"]

            r = await c.post("/api/color/preview", json={**base, "target": "ceiling", "color": "#123456"})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "bad_color"

    asyncio.run(_go())


def test_api_missing_area_gives_a_clear_error() -> None:
    """LIGHT mode's synthetic room has no ADE20K floor — the honest answer is
    "I can't see a floor here", in both languages, not a silent no-op."""
    async def _go():
        async with _async_client() as c:
            job_id = (await _redesign(c))["job_id"]
            r = await c.post("/api/color/preview", json={
                "job_id": job_id, "style": "lebanese", "target": "floor", "color": "#3c5ac8",
            })
            assert r.status_code == 404
            detail = r.json()["detail"]
            assert detail["code"] == "color_area_not_found"
            assert "floor" in detail["message_en"].lower()
            assert detail["message_ar"]

    asyncio.run(_go())


def test_api_targets_reports_availability() -> None:
    async def _go():
        async with _async_client() as c:
            job_id = (await _redesign(c))["job_id"]
            r = await c.get("/api/color/targets", params={"job_id": job_id})
            assert r.status_code == 200
            by_target = {t["target"]: t for t in r.json()["targets"]}
            assert by_target["wall"]["available"] is True
            assert by_target["floor"]["available"] is False

    asyncio.run(_go())


def test_api_unknown_job_and_style() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post("/api/color/preview", json={
                "job_id": "nope", "style": "lebanese", "target": "wall", "color": "#123456",
            })
            assert r.status_code == 404
            assert r.json()["detail"]["code"] == "job_not_found"

            job_id = (await _redesign(c))["job_id"]
            r = await c.post("/api/color/preview", json={
                "job_id": job_id, "style": "moroccan", "target": "wall", "color": "#123456",
            })
            assert r.status_code == 500
            assert r.json()["detail"]["code"] == "output_missing"

    asyncio.run(_go())


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """A throwaway SQLite file, same as tests/test_feedback.py — a test that
    registers an account must not write to the development database."""
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


def test_recolour_survives_the_history_save_path(fresh_db) -> None:
    """What Confirm leaves on screen is what the existing Save button stores:
    the applied image is a data URL /api/history accepts."""
    async def _go():
        async with _async_client() as c:
            job_id = (await _redesign(c))["job_id"]
            r = await c.post("/api/color/apply", json={
                "job_id": job_id, "style": "lebanese", "target": "wall", "color": "#2E5F8A",
            })
            image = r.json()["image"]
            assert image.startswith("data:image/png;base64,")

            await c.post("/api/auth/register", json={
                "fullName": "Colour Tester", "email": "colour@example.com",
                "password": "secret123", "phoneNumber": "0000",
            })
            r = await c.post("/api/history", json={
                "oldImage": image, "newImage": image, "culture": "lebanese",
            })
            assert r.status_code == 200, r.text
            assert r.json()["id"] > 0

    asyncio.run(_go())
