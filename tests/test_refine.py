"""/refine (Quick AI Refinement), in DARDESIGN_LIGHT.

No GPU here, so what these tests can check is the contract and the parameter
arithmetic — not what the pixels look like. The parameter tests matter most:
each mode is a delta against the configured baseline, and a sign error would be
invisible in a placeholder render while quietly inverting the button's meaning.
"""
from __future__ import annotations

import asyncio
import io
import os
import sys
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"  # before importing backend

from backend.main import _REFINE_MODES, _reset_for_tests, app  # noqa: E402
from backend.transform import CONFIG  # noqa: E402

MODES = ("more_cultural", "preserve_room", "brighter", "warmer")


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


def _post(**data) -> httpx.Response:
    async def _go():
        async with _client() as c:
            return await c.post(
                "/refine", files={"file": ("room.png", _png(), "image/png")}, data=data
            )
    return asyncio.run(_go())


@pytest.mark.parametrize("mode", MODES)
def test_every_mode_returns_an_image_and_its_own_ssim(mode: str) -> None:
    r = _post(style="lebanese", mode=mode)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["mode"] == mode
    assert j["style"] == "lebanese"
    assert isinstance(j["image"], str) and j["image"].startswith("data:image")
    # A refined design is saved and evaluated, so it must carry a score measured
    # against the original — never inherit the parent render's.
    assert isinstance(j["ssim"], float) and 0.0 <= j["ssim"] <= 1.0


def test_refine_keeps_the_requested_culture() -> None:
    """The buttons nudge parameters; switching culture is the tiles' job."""
    r = _post(style="moroccan", mode="warmer")
    assert r.status_code == 200
    assert r.json()["style"] == "moroccan"


def test_unknown_mode_is_refused() -> None:
    r = _post(style="lebanese", mode="make_it_pop")
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "bad_refine_mode"


def test_unknown_style_is_refused() -> None:
    assert _post(style="klingon", mode="brighter").status_code >= 400


def test_base_job_id_reproduces_the_parent_seed() -> None:
    """Same room, one parameter changed — not a re-roll. The seed is derived
    from the parent job id exactly as /redesign derives its own."""
    with patch("backend.main.transform_room", wraps=None) as tr:
        tr.return_value = Path(__file__)  # never read in this assertion path
        _post(style="lebanese", mode="brighter", base_job_id="abcdef12-dead-beef")
        assert tr.call_args.kwargs["seed"] == int("abcdef12", 16)


def test_malformed_base_job_id_falls_back_instead_of_failing() -> None:
    r = _post(style="lebanese", mode="brighter", base_job_id="not-hex-at-all")
    assert r.status_code == 200


def _kwargs_for(mode: str) -> dict:
    with patch("backend.main.transform_room") as tr:
        tr.return_value = Path(__file__)
        _post(style="lebanese", mode=mode)
        return tr.call_args.kwargs


def test_more_cultural_raises_lora_and_leaves_structure_alone() -> None:
    k = _kwargs_for("more_cultural")
    assert k["lora_scale"] > float(CONFIG.get("lora_scale", 0.8))
    assert k["strength"] == float(CONFIG.get("strength", 0.7))
    assert k["controlnet_boost"] == 1.0
    assert "craftsmanship" in k["extra_positive"]


def test_preserve_room_lowers_strength_and_raises_conditioning() -> None:
    k = _kwargs_for("preserve_room")
    assert k["strength"] < float(CONFIG.get("strength", 0.7))
    assert k["controlnet_boost"] > 1.0
    # Preservation must not quietly cost the culture.
    assert k["lora_scale"] == float(CONFIG.get("lora_scale", 0.8))


@pytest.mark.parametrize("mode", ("brighter", "warmer"))
def test_lighting_modes_change_only_the_prompt(mode: str) -> None:
    """'Keep the same culture/settings' — these two are prompt-only."""
    k = _kwargs_for(mode)
    assert k["lora_scale"] == float(CONFIG.get("lora_scale", 0.8))
    assert k["strength"] == float(CONFIG.get("strength", 0.7))
    assert k["controlnet_boost"] == 1.0
    assert k["extra_positive"]


def test_deltas_are_clamped_to_a_usable_range() -> None:
    """Whatever pipeline.yaml says, a refinement must stay renderable: a LoRA
    scale above 1 or a strength near 0 returns the input untouched."""
    for mode in MODES:
        k = _kwargs_for(mode)
        assert 0.0 <= k["lora_scale"] <= 1.0
        assert 0.25 <= k["strength"] <= 0.95


def test_extra_positive_is_appended_not_substituted() -> None:
    """The lighting cue must not displace the ontology terms that carry the
    culture — the built prompt has to survive underneath it."""
    from backend.transform import transform_room

    with patch("backend.transform._generate") as gen:
        gen.return_value = Path(__file__)
        with patch("backend.transform._is_light_mode", return_value=False):
            transform_room(
                _write_temp_png(), "lebanese", extra_positive="warm golden lighting",
            )
        positive = gen.call_args.kwargs["positive"]
    assert positive.endswith("warm golden lighting")
    assert len(positive) > len("warm golden lighting") + 1


def _write_temp_png() -> str:
    import tempfile

    path = Path(tempfile.gettempdir()) / "dardesign_refine_test.png"
    path.write_bytes(_png())
    return str(path)
