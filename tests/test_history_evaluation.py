"""Saved designs as the evaluation dataset.

The two requirements worth testing hardest: a deleted design leaves every metric
immediately (which is why the metrics live on the history row and not in a side
table), and an edited render is never measured as pipeline output.
"""
from __future__ import annotations

import asyncio
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
from backend.main import app  # noqa: E402

PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


@pytest.fixture(autouse=True)
def scheduled(monkeypatch) -> list[int]:
    """Record which designs were queued for measurement, and run nothing.

    The real task loads LPIPS and CLIP. Left alone, these tests would pass or
    fail depending on whether those packages happen to be installed — and would
    measure a 1x1 PNG, which means nothing. Recording the call tests the wiring;
    the values are supplied explicitly by `_measure`.
    """
    from backend import main as backend_main

    calls: list[int] = []
    monkeypatch.setattr(
        backend_main, "_evaluate_saved_design",
        lambda entry_id, old_url, new_url: calls.append(entry_id),
    )
    return calls


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c, email: str):
    r = await c.post("/api/auth/register", json={
        "fullName": "Tester", "email": email, "password": "secret123", "phoneNumber": "07",
    })
    assert r.status_code == 200, r.text


async def _save(c, culture: str, *, edited: bool = False, ssim=0.42, duration=120.0) -> int:
    r = await c.post("/api/history", json={
        "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": culture,
        "duration": duration, "ssim": ssim, "edited": edited,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _measure(entry_id: int, *, lpips: float, clip: float, predicted: str) -> None:
    """Stand in for the background task, which needs model weights."""
    db.set_history_evaluation(
        entry_id, lpips=lpips, clip_score=clip, predicted_culture=predicted
    )


# ---------- metrics live on the design ----------


def test_metrics_attach_to_the_saved_design() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "m@example.com")
            eid = await _save(c, "lebanese")
            _measure(eid, lpips=0.31, clip=0.28, predicted="lebanese")

            row = (await c.get("/api/history")).json()[0]
            assert row["lpips"] == 0.31
            assert row["clipScore"] == 0.28
            assert row["predictedCulture"] == "lebanese"

            s = db.history_generation_stats()
            assert s["averageLpips"] == 0.31 and s["lpipsSampleSize"] == 1
            assert s["averageClipScore"] == 0.28 and s["clipSampleSize"] == 1
    asyncio.run(_go())


def test_averages_use_only_measured_designs() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "m2@example.com")
            a = await _save(c, "lebanese")
            await _save(c, "moroccan")            # left unmeasured on purpose
            _measure(a, lpips=0.20, clip=0.30, predicted="lebanese")

            s = db.history_generation_stats()
            assert s["roomsGenerated"] == 2       # both are designs
            assert s["averageLpips"] == 0.2       # but only one is measured
            assert s["lpipsSampleSize"] == 1
    asyncio.run(_go())


# ---------- deletion ----------


def test_deleting_a_design_removes_it_from_every_metric() -> None:
    """The requirement in one test. Metrics are columns on the row, so deletion
    is total by construction — there is no second copy to keep in step."""
    async def _go():
        async with _client() as c:
            await _signup(c, "d@example.com")
            keep = await _save(c, "lebanese")
            drop = await _save(c, "moroccan")
            _measure(keep, lpips=0.20, clip=0.30, predicted="lebanese")
            _measure(drop, lpips=0.80, clip=0.10, predicted="lebanese")   # a misread

            before = db.history_generation_stats()
            assert before["roomsGenerated"] == 2
            assert before["averageLpips"] == 0.5
            assert db.culture_confusion()["total"] == 2
            assert db.culture_confusion()["accuracy"] == 0.5

            assert (await c.delete(f"/api/history/{drop}")).status_code == 200

            after = db.history_generation_stats()
            assert after["roomsGenerated"] == 1
            assert after["averageLpips"] == 0.2, "a deleted design still affected LPIPS"
            assert after["lpipsSampleSize"] == 1
            conf = db.culture_confusion()
            assert conf["total"] == 1, "a deleted design still sat in the confusion matrix"
            assert conf["accuracy"] == 1.0
            assert "moroccan" not in conf["matrix"]
    asyncio.run(_go())


# ---------- edited designs ----------


def test_edited_designs_are_saved_but_not_queued_for_evaluation() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "e@example.com")
            eid = await _save(c, "lebanese", edited=True)

            rows = (await c.get("/api/history")).json()
            assert len(rows) == 1 and rows[0]["isEdited"] is True
            # Still a room the user generated...
            stats = db.history_generation_stats()
            assert stats["roomsGenerated"] == 1
            # ...but not part of the corpus any model figure is averaged over,
            # and the count of what was held back is reported rather than left
            # for the reader to infer from a gap between two numbers.
            assert stats["evaluableDesigns"] == 0
            assert stats["editedExcluded"] == 1
            # ...and never offered to the measurement pass.
            assert all(r["id"] != eid for r in db.history_needing_evaluation())
    asyncio.run(_go())


def test_unedited_designs_are_queued_for_evaluation() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "e2@example.com")
            eid = await _save(c, "lebanese", edited=False)
            assert any(r["id"] == eid for r in db.history_needing_evaluation())

            _measure(eid, lpips=0.3, clip=0.3, predicted="lebanese")
            assert all(r["id"] != eid for r in db.history_needing_evaluation()), \
                "a measured design was offered for measurement again"
    asyncio.run(_go())


# ---------- confusion matrix ----------


def test_confusion_matrix_counts_intended_against_predicted() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "c@example.com")
            a = await _save(c, "lebanese")
            b = await _save(c, "lebanese")
            d = await _save(c, "moroccan")
            _measure(a, lpips=0.2, clip=0.3, predicted="lebanese")   # correct
            _measure(b, lpips=0.2, clip=0.2, predicted="khaleeji")   # confused
            _measure(d, lpips=0.2, clip=0.3, predicted="moroccan")   # correct

            conf = db.culture_confusion()
            assert conf["matrix"]["lebanese"] == {"lebanese": 1, "khaleeji": 1}
            assert conf["matrix"]["moroccan"] == {"moroccan": 1}
            assert conf["total"] == 3 and conf["correct"] == 2
            assert conf["accuracy"] == round(2 / 3, 3)
    asyncio.run(_go())


def test_confusion_accuracy_is_null_when_nothing_is_classified() -> None:
    conf = db.culture_confusion()
    assert conf["total"] == 0
    assert conf["accuracy"] is None      # never 0, which is a real result
    assert conf["matrix"] == {}


def test_dashboard_exposes_the_confusion_matrix() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "dash@example.com")
            eid = await _save(c, "lebanese")
            _measure(eid, lpips=0.25, clip=0.29, predicted="lebanese")

            body = (await c.get("/api/admin/evaluation")).json()
            assert body["confusion"]["accuracy"] == 1.0
            assert body["generation"]["averageLpips"] == 0.25
            assert body["generation"]["averageClipScore"] == 0.29
    asyncio.run(_go())


def test_all_users_designs_count_not_only_the_viewer() -> None:
    """The dashboard is admin-level: it reports the system, not one account."""
    async def _go():
        # The first account registered is the Admin; the second is an ordinary user.
        async with _client() as admin, _client() as other:
            await _signup(admin, "u1@example.com")
            a = await _save(admin, "lebanese")
            _measure(a, lpips=0.2, clip=0.3, predicted="lebanese")

            await _signup(other, "u2@example.com")
            b = await _save(other, "moroccan")
            _measure(b, lpips=0.4, clip=0.5, predicted="moroccan")

            # Each user sees only their own designs in History...
            assert len((await other.get("/api/history")).json()) == 1
            assert len((await admin.get("/api/history")).json()) == 1
            # ...while the admin dashboard reports the system as a whole.
            body = (await admin.get("/api/admin/evaluation")).json()
            assert body["generation"]["roomsGenerated"] == 2
            assert body["generation"]["averageLpips"] == 0.3
            assert body["confusion"]["total"] == 2
            # And it stays admin-only.
            assert (await other.get("/api/admin/evaluation")).status_code == 403
    asyncio.run(_go())
