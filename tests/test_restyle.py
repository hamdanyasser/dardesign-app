"""/restyle (Style Intensity Slider) + provenance manifest, in DARDESIGN_LIGHT.
No GPU: exercises the placeholder branch and the manifest sidecar."""
from __future__ import annotations

import asyncio
import glob
import io
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"  # before importing backend

from backend.main import UPLOAD_DIR, _reset_for_tests, app  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (150, 140, 120)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def test_restyle_returns_one_styled_image() -> None:
    async def _go():
        async with _client() as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "khaleeji", "scale": "0.5"},
            )
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["style"] == "khaleeji"
            assert j["scale"] == 0.5
            assert isinstance(j["image"], str) and j["image"].startswith("data:image")
    asyncio.run(_go())


def test_restyle_rejects_unknown_style() -> None:
    async def _go():
        async with _client() as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "klingon", "scale": "0.5"},
            )
            assert r.status_code >= 400
    asyncio.run(_go())


def test_restyle_clamps_scale_to_unit_interval() -> None:
    async def _go():
        async with _client() as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "moroccan", "scale": "5"},
            )
            assert r.status_code == 200
            assert r.json()["scale"] == 1.0
    asyncio.run(_go())


def test_restyle_writes_provenance_manifest() -> None:
    async def _go():
        async with _client() as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "lebanese", "scale": "0.8"},
            )
            assert r.status_code == 200
        manifests = glob.glob(str(UPLOAD_DIR / "*.manifest.json"))
        assert manifests, "no provenance manifest written next to the render"
        meta = json.loads(Path(manifests[-1]).read_text(encoding="utf-8"))
        assert meta["tool"] == "DarDesign"
        assert len(meta.get("output_sha256", "")) == 64
    asyncio.run(_go())
