"""Audit trail — JSONL log module + the /audit endpoint (+ token gate)."""
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

from backend import audit  # noqa: E402
from backend.main import _reset_for_tests, app  # noqa: E402


def _png(w: int = 512, h: int = 512) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (60, 120, 180)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    audit._reset_for_tests()
    yield
    _reset_for_tests()
    audit._reset_for_tests()


def _async_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60)


def test_log_roundtrip_newest_first() -> None:
    audit.log_event("restyle", job_id="a", ok=True)
    audit.log_event("redesign", job_id="b", ok=True)
    events = audit.read_events()
    assert [e["job_id"] for e in events] == ["b", "a"]
    assert all("ts" in e for e in events)
    assert audit.read_events(limit=1) == [events[0]]


def test_read_survives_torn_line() -> None:
    audit.log_event("restyle", job_id="a", ok=True)
    with open(audit.AUDIT_PATH, "a", encoding="utf-8") as fh:
        fh.write('{"broken json\n')
    events = audit.read_events()
    assert [e["job_id"] for e in events] == ["a"]


def test_restyle_is_audited_and_served() -> None:
    async def _go():
        async with _async_client() as c:
            r = await c.post(
                "/restyle",
                files={"file": ("room.png", _png(), "image/png")},
                data={"style": "moroccan", "scale": "0.5"},
            )
            assert r.status_code == 200, r.text

            r = await c.get("/audit")
            assert r.status_code == 200
            events = r.json()
            assert events, "expected at least one audit record"
            top = events[0]
            assert top["event"] == "restyle"
            assert top["style"] == "moroccan"
            assert top["ok"] is True
            assert top["light"] is True
            assert "duration_s" in top

    asyncio.run(_go())


def test_audit_token_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DARDESIGN_AUDIT_TOKEN", "s3cret")
    audit.log_event("restyle", job_id="a", ok=True)

    async def _go():
        async with _async_client() as c:
            r = await c.get("/audit")
            assert r.status_code == 403
            r = await c.get("/audit", params={"token": "wrong"})
            assert r.status_code == 403
            r = await c.get("/audit", params={"token": "s3cret"})
            assert r.status_code == 200
            assert r.json()[0]["job_id"] == "a"

    asyncio.run(_go())
