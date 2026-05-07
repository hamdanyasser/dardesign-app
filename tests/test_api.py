"""Full /upload -> /transform -> /status -> /result roundtrip in DARDESIGN_LIGHT mode.
Doesn't need a GPU; relies on the placeholder branch in transform.py.

Uses httpx.AsyncClient + ASGITransport so the event loop stays alive across
polling requests (TestClient tears the loop down per request, which would
strand the asyncio.create_task that drives generation)."""
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


def test_healthz() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.get("/healthz")
            assert r.status_code == 200
            body = r.json()
            assert body["ok"] is True
            assert body["light_mode"] is True
    asyncio.run(_go())


def test_full_roundtrip() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post("/upload", files={"file": ("room.png", _png(), "image/png")})
            assert r.status_code == 200, r.text
            job_id = r.json()["job_id"]

            r = await c.post("/transform", json={"job_id": job_id, "style": "lebanese", "seed": 1})
            assert r.status_code == 200, r.text

            for _ in range(60):
                r = await c.get(f"/status/{job_id}")
                body = r.json()
                if body["status"] == "done":
                    break
                if body["status"] == "error":
                    pytest.fail(f"job errored: {body}")
                await asyncio.sleep(0.1)
            else:
                pytest.fail("job did not finish within 6s")

            r = await c.get(f"/result/{job_id}")
            assert r.status_code == 200
            assert r.headers["content-type"] == "image/png"
            assert len(r.content) > 1000

            r = await c.get(f"/share-token/{job_id}")
            assert r.status_code == 200
            token = r.json()["token"]

            r = await c.get(f"/share/{token}")
            assert r.status_code == 200
            assert r.headers["content-type"] == "image/png"

    asyncio.run(_go())


def test_rejects_non_image() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post("/upload", files={"file": ("doc.pdf", b"%PDF-fake", "application/pdf")})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "not_an_image"
    asyncio.run(_go())


def test_rejects_too_small() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post("/upload", files={"file": ("tiny.png", _png(64, 64), "image/png")})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "image_too_small"
    asyncio.run(_go())


def test_rejects_unknown_style() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post("/upload", files={"file": ("room.png", _png(), "image/png")})
            job_id = r.json()["job_id"]
            r = await c.post("/transform", json={"job_id": job_id, "style": "ottoman"})
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "bad_style"
    asyncio.run(_go())


def test_404_unknown_job() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.get("/status/nope")
            assert r.status_code == 404
            assert r.json()["detail"]["code"] == "job_not_found"
    asyncio.run(_go())
