"""LIGHT-mode placeholder contract.

Guards the fixes that stop placeholder mode looking broken:
  - /redesign flags itself with top-level placeholder: true (CLAUDE.md contract),
  - _emit_placeholder preserves the source aspect ratio, so the before/after
    compare slider aligns under object-fit: cover instead of showing two
    different-looking rooms.
"""
from __future__ import annotations

import asyncio
import io
import os
import sys
from pathlib import Path

import httpx
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# MUST be set BEFORE importing transform.py.
os.environ["DARDESIGN_LIGHT"] = "1"

from backend.main import _reset_for_tests, app  # noqa: E402
from backend.transform import _emit_placeholder, fit_size  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (180, 120, 60)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


def test_redesign_flags_placeholder_in_light_mode() -> None:
    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.post(
                "/redesign",
                files={"file": ("room.png", _png(640, 360), "image/png")},
            )
            assert r.status_code == 200
            assert r.json()["placeholder"] is True
    asyncio.run(_go())


def test_fit_size_preserves_aspect_multiple_of_8() -> None:
    assert fit_size(800, 600) == (1024, 768)      # 4:3, upscaled to the long side
    assert fit_size(2048, 1152) == (1024, 576)    # 16:9, downscaled
    assert fit_size(1024, 1024) == (1024, 1024)   # square untouched
    w, h = fit_size(1000, 707)                    # awkward aspect still /8-clean
    assert w % 8 == 0 and h % 8 == 0
    assert abs((w / h) - (1000 / 707)) < 0.02


def test_placeholder_matches_fit_size_geometry(tmp_path: Path) -> None:
    src = tmp_path / "wide.png"
    Image.new("RGB", (2048, 1152), (150, 130, 110)).save(src, format="PNG")
    out = _emit_placeholder(src, "lebanese", tmp_path / "out.png")
    with Image.open(out) as img:
        assert img.size == fit_size(2048, 1152) == (1024, 576)


def test_redesign_original_and_styles_share_geometry() -> None:
    """The compare slider's two halves must be the same shape — a squashed
    square against a wide original reads as two different rooms."""
    import base64

    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.post(
                "/redesign",
                files={"file": ("room.png", _png(1280, 640), "image/png")},
            )
            assert r.status_code == 200
            body = r.json()
            dims = {}
            for key in ("original", "lebanese", "khaleeji", "moroccan"):
                png = base64.b64decode(body[key].split(",", 1)[1])
                with Image.open(io.BytesIO(png)) as img:
                    dims[key] = img.size
            assert len(set(dims.values())) == 1, f"geometry mismatch: {dims}"
            assert dims["original"] == fit_size(1280, 640)
    asyncio.run(_go())
