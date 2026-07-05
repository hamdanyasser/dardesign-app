"""seg_bounding_boxes() + the /redesign seg_regions/depth_map contract.

Runs in DARDESIGN_LIGHT mode like the rest of the suite — the synthetic
depth+seg stand-in in transform.py exercises the full wiring without a GPU.
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

from backend.main import _reset_for_tests, app  # noqa: E402
from backend.projection import seg_bounding_boxes, to_seg_regions_payload  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (180, 120, 60)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    yield
    _reset_for_tests()


# ---------------------------------------------------------------- unit level


def test_seg_bounding_boxes_synthetic() -> None:
    seg = np.zeros((100, 100), dtype=np.int32)  # 0 = wall, excluded by design
    seg[50:90, 10:50] = 23  # sofa
    seg[10:30, 60:90] = 8   # window
    seg[0:2, 0:2] = 15      # table blob below min_area_frac -> dropped

    regions = seg_bounding_boxes(seg)

    assert [r["classKey"] for r in regions] == ["sofa", "window"]  # area desc
    sofa = regions[0]
    assert sofa["labelAr"] == "أريكة"
    assert sofa["labelEn"] == "sofa"
    assert sofa["bbox"] == [0.1, 0.5, 0.4, 0.4]
    for r in regions:
        assert all(0.0 <= v <= 1.0 for v in r["bbox"])
        assert 0.0 < r["area"] <= 1.0


def test_seg_bounding_boxes_excludes_enveloping_surfaces() -> None:
    # wall (0) / floor (3) would bbox the whole frame — they must not ship.
    seg = np.zeros((64, 64), dtype=np.int32)
    seg[32:, :] = 3
    assert seg_bounding_boxes(seg) == []


def test_seg_regions_payload_envelope() -> None:
    payload = to_seg_regions_payload([], "job-1")
    assert payload == {"jobId": "job-1", "regions": [], "version": "segmap-v1"}


# ----------------------------------------------------------------- API level


def test_redesign_ships_seg_regions_and_depth_map() -> None:
    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
            r = await c.post("/redesign", files={"file": ("room.png", _png(), "image/png")})
            assert r.status_code == 200, r.text
            body = r.json()

            regs = body["seg_regions"]
            assert regs is not None
            assert regs["version"] == "segmap-v1"
            assert regs["placeholder"] is True  # LIGHT mode = synthetic layout
            keys = {x["classKey"] for x in regs["regions"]}
            # From _synthetic_depth_seg's deterministic living room.
            assert {"sofa", "window", "rug", "table"} <= keys
            for reg in regs["regions"]:
                assert all(0.0 <= v <= 1.0 for v in reg["bbox"])

            assert body["depth_map"].startswith("data:image/png;base64,")
            assert body["object_map"]["placeholder"] is True

    asyncio.run(_go())
