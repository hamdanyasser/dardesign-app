"""Feedback on a generated design: submit, update, and everything that must fail.

The security-shaped cases matter most here — a rating form that trusts its own
request body can forge authorship, relabel a design's culture, or rate someone
else's work. Those are asserted explicitly rather than assumed.
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

# A 1x1 PNG — the save endpoint stores whatever data URL it is given.
PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    """Each test gets its own SQLite file — feedback is unique per design, so a
    shared database would make tests depend on each other's rows."""
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c: httpx.AsyncClient, email: str, name: str = "Test User") -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": name, "email": email, "password": "secret123", "phoneNumber": "070000000",
    })
    assert r.status_code == 200, r.text
    return r.json()


async def _save_design(c: httpx.AsyncClient, culture: str = "lebanese", intensity=0.8) -> dict:
    r = await c.post("/api/history", json={
        "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL,
        "culture": culture, "intensity": intensity,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _body(**over) -> dict:
    base = {
        "culturalAccuracy": 4,
        "imageQuality": 5,
        "roomPreservation": 3,
        "furniturePlacement": "valid",
        "comment": "Beautiful arches.",
    }
    base.update(over)
    return base


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------
# the happy paths


def test_valid_feedback_submission():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            r = await c.post("/api/feedback", json=_body(historyId=design["id"]))
            return r

    r = run(go())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["culturalAccuracy"] == 4
    assert body["imageQuality"] == 5
    assert body["roomPreservation"] == 3
    assert body["furniturePlacement"] == "valid"
    assert body["comment"] == "Beautiful arches."
    assert body["updated"] is False
    # Culture came from the design record, not the request.
    assert body["culture"] == "lebanese"
    assert body["intensity"] == 0.8


def test_updating_existing_feedback_edits_it_in_place():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            first = (await c.post("/api/feedback", json=_body(historyId=design["id"]))).json()
            second = (await c.post("/api/feedback", json=_body(
                historyId=design["id"], culturalAccuracy=1, comment="Changed my mind.",
            ))).json()
            listing = (await c.get(f"/api/feedback/{design['id']}")).json()
            return first, second, listing

    first, second, listing = run(go())
    assert second["id"] == first["id"], "a second submission created a new row"
    assert second["updated"] is True
    assert second["culturalAccuracy"] == 1
    assert second["comment"] == "Changed my mind."
    assert second["createdAt"] == first["createdAt"], "original submission time was lost"
    assert second["updatedAt"] >= first["updatedAt"]
    assert listing["culturalAccuracy"] == 1


def test_duplicate_feedback_is_prevented_at_the_database_level():
    """Belt and braces: even bypassing the endpoint, a second row cannot exist."""
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            await c.post("/api/feedback", json=_body(historyId=design["id"]))
            return design["id"]

    history_id = run(go())
    rows = db._query("SELECT COUNT(*) AS n FROM feedback WHERE HistoryId = ?", (history_id,))
    assert rows[0]["n"] == 1


def test_feedback_is_returned_when_the_design_is_reopened():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            before = await c.get(f"/api/feedback/{design['id']}")
            await c.post("/api/feedback", json=_body(historyId=design["id"]))
            after = await c.get(f"/api/feedback/{design['id']}")
            return before, after

    before, after = run(go())
    assert before.status_code == 200 and before.json() is None
    assert after.json()["culturalAccuracy"] == 4


def test_a_design_without_furniture_can_be_rated_not_applicable():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            return await c.post("/api/feedback", json=_body(
                historyId=design["id"], furniturePlacement="not_applicable",
            ))

    r = run(go())
    assert r.status_code == 200, r.text
    assert r.json()["furniturePlacement"] == "not_applicable"


def test_the_comment_is_optional():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            omitted = await c.post("/api/feedback", json={
                "historyId": design["id"], "culturalAccuracy": 3, "imageQuality": 3,
                "roomPreservation": 3, "furniturePlacement": "valid",
            })
            return omitted

    r = run(go())
    assert r.status_code == 200, r.text
    assert r.json()["comment"] is None


@pytest.mark.parametrize("comment", ["", "   ", "\n\t  "])
def test_a_whitespace_only_comment_is_stored_as_null(comment):
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            return await c.post("/api/feedback", json=_body(
                historyId=design["id"], comment=comment,
            ))

    r = run(go())
    assert r.status_code == 200, r.text
    assert r.json()["comment"] is None


# --------------------------------------------------------------------------
# what must be refused


@pytest.mark.parametrize("field", ["culturalAccuracy", "imageQuality", "roomPreservation"])
@pytest.mark.parametrize("value", [0, 6, -1, 100])
def test_ratings_outside_one_to_five_are_rejected(field, value):
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            return await c.post("/api/feedback", json=_body(historyId=design["id"], **{field: value}))

    r = run(go())
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "feedback_invalid"


def test_an_invalid_furniture_placement_value_is_rejected():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            return await c.post("/api/feedback", json=_body(
                historyId=design["id"], furniturePlacement="maybe",
            ))

    assert run(go()).status_code == 400


def test_an_overlong_comment_is_rejected():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
            return await c.post("/api/feedback", json=_body(
                historyId=design["id"], comment="x" * (db.COMMENT_MAX_LEN + 1),
            ))

    r = run(go())
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "feedback_invalid"


def test_unauthenticated_submission_is_rejected():
    async def go():
        # Sign up (creating a design), then drop the cookie by using a new client.
        async with _client() as c:
            await _signup(c, "a@example.com")
            design = await _save_design(c)
        async with _client() as anon:
            return await anon.post("/api/feedback", json=_body(historyId=design["id"]))

    r = run(go())
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "not_authenticated"


def test_a_user_cannot_rate_someone_elses_design():
    """The whole point of reading ownership from the database."""
    async def go():
        async with _client() as owner:
            await _signup(owner, "owner@example.com", "Owner Person")
            design = await _save_design(owner)
        async with _client() as intruder:
            await _signup(intruder, "intruder@example.com", "Other Person")
            post = await intruder.post("/api/feedback", json=_body(historyId=design["id"]))
            get = await intruder.get(f"/api/feedback/{design['id']}")
            return post, get, design["id"]

    post, get, history_id = run(go())
    # 404, not 403: the same answer a nonexistent id gives, so ids can't be probed.
    assert post.status_code == 404
    assert get.status_code == 404
    rows = db._query("SELECT COUNT(*) AS n FROM feedback WHERE HistoryId = ?", (history_id,))
    assert rows[0]["n"] == 0, "feedback was written for another user's design"


def test_feedback_on_a_nonexistent_design_is_rejected():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            return await c.post("/api/feedback", json=_body(historyId=999999))

    assert run(go()).status_code == 404


def test_the_request_cannot_choose_its_own_culture_or_author():
    """Extra fields in the body must be ignored, not absorbed."""
    async def go():
        async with _client() as c:
            me = await _signup(c, "a@example.com")
            design = await _save_design(c, culture="moroccan", intensity=0.4)
            r = await c.post("/api/feedback", json={
                **_body(historyId=design["id"]),
                "culture": "khaleeji",      # lie
                "intensity": 1.0,           # lie
                "userId": me["id"] + 999,   # lie
            })
            return me, r

    me, r = run(go())
    body = r.json()
    assert body["culture"] == "moroccan", "the request body overrode the design's culture"
    assert body["intensity"] == 0.4
    assert body["userId"] == me["id"], "the request body chose its own author"


# --------------------------------------------------------------------------
# admin view


def test_the_admin_feedback_view_requires_an_admin_role():
    """The first account registered is auto-promoted to Admin (main.py bootstrap),
    so the ordinary-user case has to be the *second* account."""
    async def go():
        async with _client() as first:
            await _signup(first, "admin@example.com")
        async with _client() as second:
            await _signup(second, "regular@example.com")
            return await second.get("/api/admin/feedback")

    r = run(go())
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_the_admin_feedback_view_is_rejected_when_signed_out():
    async def go():
        async with _client() as c:
            return await c.get("/api/admin/feedback")

    assert run(go()).status_code == 401


def test_admin_sees_totals_averages_and_placement_counts():
    async def go():
        async with _client() as c:
            user = await _signup(c, "a@example.com")
            d1 = await _save_design(c, culture="lebanese")
            d2 = await _save_design(c, culture="moroccan")
            await c.post("/api/feedback", json=_body(
                historyId=d1["id"], culturalAccuracy=5, imageQuality=5,
                roomPreservation=5, furniturePlacement="valid", comment="Excellent.",
            ))
            await c.post("/api/feedback", json=_body(
                historyId=d2["id"], culturalAccuracy=1, imageQuality=3,
                roomPreservation=3, furniturePlacement="invalid", comment=None,
            ))
            # Promote to admin, then read the panel.
            db._write("UPDATE users SET Role = ? WHERE Id = ?", (db.ROLE_ADMIN, user["id"]))
            everything = (await c.get("/api/admin/feedback")).json()
            filtered = (await c.get("/api/admin/feedback?culture=lebanese")).json()
            return everything, filtered

    everything, filtered = run(go())
    stats = everything["stats"]
    assert stats["total"] == 2
    assert stats["averageCulturalAccuracy"] == 3.0     # (5 + 1) / 2
    assert stats["averageImageQuality"] == 4.0         # (5 + 3) / 2
    assert stats["averageRoomPreservation"] == 4.0
    assert stats["placementValid"] == 1
    assert stats["placementInvalid"] == 1
    assert stats["placementNotApplicable"] == 0
    assert len(everything["recent"]) == 2
    assert everything["recent"][0]["authorName"] == "Test"   # first name only
    assert {c["culture"] for c in everything["byCulture"]} == {"lebanese", "moroccan"}

    # Culture filter narrows both the stats and the listing.
    assert filtered["stats"]["total"] == 1
    assert filtered["stats"]["averageCulturalAccuracy"] == 5.0
    assert all(f["culture"] == "lebanese" for f in filtered["recent"])


def test_admin_date_filters_narrow_the_result():
    import time

    async def go():
        async with _client() as c:
            user = await _signup(c, "a@example.com")
            design = await _save_design(c)
            await c.post("/api/feedback", json=_body(historyId=design["id"]))
            db._write("UPDATE users SET Role = ? WHERE Id = ?", (db.ROLE_ADMIN, user["id"]))
            future = time.time() + 3600
            past = (await c.get("/api/admin/feedback?until=%f" % (time.time() + 60,))).json()
            none = (await c.get("/api/admin/feedback?since=%f" % future)).json()
            return past, none

    past, none = run(go())
    assert past["stats"]["total"] == 1
    assert none["stats"]["total"] == 0
    assert none["recent"] == []
