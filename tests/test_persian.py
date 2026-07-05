"""persian — the prompt-only 4th culture (docs/add_a_culture.md minus the LoRA).

Contract under test:
- the ontology + prompt builder know persian (trigger phrase injected),
- /restyle serves it (LIGHT mode),
- /redesign does NOT grow a 4th generation — demo timing stays fixed.
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
from backend.prompt_builder import CULTURES, build_prompts  # noqa: E402
from backend.transform import CORE_STYLES, StylePack  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 160, 60)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


def test_persian_in_style_tables() -> None:
    assert "persian" in CULTURES
    assert "persian" in StylePack
    assert CORE_STYLES == ("lebanese", "khaleeji", "moroccan")  # /redesign set
    assert "persian" not in CORE_STYLES


def test_persian_prompts_build_with_trigger() -> None:
    p = build_prompts("persian", room="living room", seed=7)
    assert p.trigger_en == "dardesign-persian style"
    assert p.trigger_en in p.positive_en
    assert p.trigger_ar in p.positive_ar
    assert p.negative_en  # universal + persian negative_specific merged


def test_restyle_serves_persian() -> None:
    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "persian", "scale": "0.8"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["style"] == "persian"
            assert body["image"].startswith("data:image/png;base64,")

    asyncio.run(_go())


def test_redesign_stays_three_styles() -> None:
    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
            r = await c.post("/redesign", files={"file": ("room.png", _png(), "image/png")})
            assert r.status_code == 200, r.text
            body = r.json()
            assert {"original", "lebanese", "khaleeji", "moroccan"} <= set(body)
            assert "persian" not in body

    asyncio.run(_go())
