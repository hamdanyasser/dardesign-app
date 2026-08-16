"""Plans, the weekly allowance, and the admin approval flow.

The cases that matter here are the ones where money and access meet: that
pressing "Subscribe" grants nothing on its own, that a fourth generation on
Basic is refused, that an approval lasts exactly 30 days and an expiry puts the
account back on Basic, and that no ordinary account can reach the admin views.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db, subscriptions  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    """One SQLite file per test — the first account registered becomes the
    admin, so a shared database would make the tests depend on their order."""
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


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ defaults


def test_new_account_is_basic_with_a_full_allowance():
    async def go():
        async with _client() as c:
            user = await _signup(c, "a@example.com")
            assert user["plan"] == "basic"
            assert user["isSubscribed"] is False
            assert user["numberOfUses"] == 0
            assert user["planExpiryDate"] is None

            state = (await c.get("/api/subscription")).json()
            assert state["remaining"] == subscriptions.BASIC_WEEKLY_LIMIT
            assert state["pendingRequest"] is None
            # The page renders the price and the limit from these, so they must
            # be the same numbers the backend enforces.
            assert state["terms"] == {
                "priceUsd": 20, "durationDays": 30, "basicWeeklyLimit": 3,
            }

    run(go())


def test_subscription_endpoints_require_a_session():
    async def go():
        async with _client() as c:
            for method, path in (
                ("GET", "/api/subscription"),
                ("POST", "/api/subscription/request"),
                ("POST", "/api/subscription/cancel"),
                ("POST", "/api/usage/consume"),
            ):
                r = await c.request(method, path)
                assert r.status_code == 401, f"{method} {path} -> {r.status_code}"

    run(go())


# ------------------------------------------------------------- the allowance


def test_basic_gets_three_designs_then_is_refused():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            for i in range(subscriptions.BASIC_WEEKLY_LIMIT):
                r = await c.post("/api/usage/consume")
                assert r.status_code == 200
                assert r.json()["remaining"] == subscriptions.BASIC_WEEKLY_LIMIT - (i + 1)

            r = await c.post("/api/usage/consume")
            assert r.status_code == 429
            assert r.json()["detail"]["code"] == "quota_exceeded"

            # A refusal costs nothing: the counter stopped at the limit rather
            # than climbing every time the user tried again.
            assert (await c.get("/api/subscription")).json()["numberOfUses"] == 3

    run(go())


def test_the_allowance_refills_after_a_week():
    async def go():
        async with _client() as c:
            user = await _signup(c, "a@example.com")
            for _ in range(3):
                assert (await c.post("/api/usage/consume")).status_code == 200
            assert (await c.post("/api/usage/consume")).status_code == 429

            # Age the window rather than sleep: the reset is time-based, and the
            # test asserts the rule, not the clock.
            db.connect().execute(
                "UPDATE users SET UsageWindowStart = ? WHERE Id = ?",
                (time.time() - subscriptions.USAGE_WINDOW_SECONDS - 1, user["id"]),
            )
            db.connect().commit()

            r = await c.post("/api/usage/consume")
            assert r.status_code == 200
            assert r.json()["numberOfUses"] == 1
            assert r.json()["remaining"] == 2

    run(go())


def test_pro_has_no_limit():
    async def go():
        async with _client() as c:
            admin = await _signup(c, "admin@example.com", "Admin")
            request_id = db.create_subscription_request(admin["id"])
            subscriptions.decide(request_id, admin["id"], True)

            for _ in range(subscriptions.BASIC_WEEKLY_LIMIT + 3):
                r = await c.post("/api/usage/consume")
                assert r.status_code == 200
                # Unlimited is reported as null, never as a large number.
                assert r.json()["limit"] is None
                assert r.json()["remaining"] is None

    run(go())


# ------------------------------------------------------- requesting an upgrade


def test_subscribing_only_queues_a_request():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            state = (await c.post("/api/subscription/request")).json()

            # The whole point: the user asked, and nothing about the plan moved.
            assert state["isSubscribed"] is False
            assert state["plan"] == "basic"
            assert state["pendingRequest"]["status"] == "pending"

            # And it stays that way on a fresh read, not just in the response.
            assert (await c.get("/api/subscription")).json()["isSubscribed"] is False

    run(go())


def test_a_second_request_is_refused_while_one_is_pending():
    async def go():
        async with _client() as c:
            await _signup(c, "a@example.com")
            assert (await c.post("/api/subscription/request")).status_code == 200
            r = await c.post("/api/subscription/request")
            assert r.status_code == 409
            assert r.json()["detail"]["code"] == "subscription_pending"

    run(go())


def test_approval_grants_thirty_days_and_declining_grants_nothing():
    async def go():
        async with _client() as c:
            admin = await _signup(c, "admin@example.com", "Admin")

        # A second account, in its own client so the two sessions don't share a
        # cookie jar.
        async with _client() as u1, _client() as u2:
            user = await _signup(u1, "user@example.com", "Ordinary User")
            await u1.post("/api/subscription/request")
            other = await _signup(u2, "other@example.com", "Other User")
            await u2.post("/api/subscription/request")

            async with _client() as a:
                await a.post("/api/auth/login", json={
                    "email": "admin@example.com", "password": "secret123",
                })
                queue = (await a.get("/api/admin/subscriptions")).json()
                assert queue["pendingCount"] == 2
                by_user = {r["userId"]: r for r in queue["requests"]}
                # The admin sees who is asking — that is the point of the queue.
                assert by_user[user["id"]]["email"] == "user@example.com"

                approved = await a.post(
                    f"/api/admin/subscriptions/{by_user[user['id']]['id']}/decision",
                    json={"approve": True},
                )
                assert approved.status_code == 200
                assert approved.json()["status"] == "approved"

                declined = await a.post(
                    f"/api/admin/subscriptions/{by_user[other['id']]['id']}/decision",
                    json={"approve": False},
                )
                assert declined.json()["status"] == "declined"

                # Deciding the same request twice cannot stack a second plan.
                again = await a.post(
                    f"/api/admin/subscriptions/{by_user[user['id']]['id']}/decision",
                    json={"approve": True},
                )
                assert again.status_code == 409
                assert again.json()["detail"]["code"] == "request_not_pending"

            state = (await u1.get("/api/subscription")).json()
            assert state["isSubscribed"] is True and state["plan"] == "pro"
            # Exactly 30 days, to the day.
            assert round((state["planExpiryDate"] - state["planStartedAt"]) / 86400) == 30
            assert subscriptions.days_left(state["planExpiryDate"]) == 29

            # The declined account is untouched.
            assert (await u2.get("/api/subscription")).json()["isSubscribed"] is False

        assert admin["role"] == "Admin"

    run(go())


def test_a_subscriber_cannot_request_again():
    async def go():
        async with _client() as c:
            admin = await _signup(c, "admin@example.com", "Admin")
            subscriptions.decide(db.create_subscription_request(admin["id"]), admin["id"], True)
            r = await c.post("/api/subscription/request")
            assert r.status_code == 409
            assert r.json()["detail"]["code"] == "already_subscribed"

    run(go())


# ------------------------------------------------------ cancelling and expiry


def test_cancelling_returns_the_account_to_basic_with_a_fresh_week():
    async def go():
        async with _client() as c:
            admin = await _signup(c, "admin@example.com", "Admin")
            subscriptions.decide(db.create_subscription_request(admin["id"]), admin["id"], True)
            for _ in range(5):  # more than a week's worth, allowed while on Pro
                assert (await c.post("/api/usage/consume")).status_code == 200

            state = (await c.post("/api/subscription/cancel")).json()
            assert state["isSubscribed"] is False
            assert state["planExpiryDate"] is None
            # Generations made on Pro were never limited, so they must not eat
            # into the free week the user drops back into.
            assert state["remaining"] == subscriptions.BASIC_WEEKLY_LIMIT

            r = await c.post("/api/subscription/cancel")
            assert r.status_code == 400
            assert r.json()["detail"]["code"] == "not_subscribed"

    run(go())


def test_the_daily_service_expires_plans_that_have_run_out():
    async def go():
        async with _client() as c:
            admin = await _signup(c, "admin@example.com", "Admin")
            subscriptions.decide(db.create_subscription_request(admin["id"]), admin["id"], True)

            # A day before the plan ends, nothing happens...
            assert subscriptions.expire_due(time.time() + 29 * 86400) == 0
            assert (await c.get("/api/subscription")).json()["isSubscribed"] is True

            # ...and a day after it, the account is Basic again.
            assert subscriptions.expire_due(time.time() + 31 * 86400) == 1
            state = (await c.get("/api/subscription")).json()
            assert state["isSubscribed"] is False
            assert state["plan"] == "basic"
            assert state["planExpiryDate"] is None
            # Idempotent: a second sweep finds nothing left to expire.
            assert subscriptions.expire_due(time.time() + 31 * 86400) == 0

    run(go())


# ------------------------------------------------------------- the admin views


def test_admin_views_are_closed_to_ordinary_accounts():
    async def go():
        async with _client() as admin_c:
            await _signup(admin_c, "admin@example.com", "Admin")
        async with _client() as c:
            await _signup(c, "user@example.com")
            for method, path in (
                ("GET", "/api/admin/users"),
                ("GET", "/api/admin/subscriptions"),
                ("POST", "/api/admin/subscriptions/1/decision"),
            ):
                r = await c.request(method, path, json={"approve": True})
                assert r.status_code == 403, f"{method} {path} -> {r.status_code}"

    run(go())


def test_the_users_view_shows_plans_and_never_a_password():
    async def go():
        async with _client() as a:
            admin = await _signup(a, "admin@example.com", "Admin")
            subscriptions.decide(db.create_subscription_request(admin["id"]), admin["id"], True)
        async with _client() as u:
            await _signup(u, "user@example.com", "Ordinary User")

        async with _client() as a:
            await a.post("/api/auth/login", json={
                "email": "admin@example.com", "password": "secret123",
            })
            rows = (await a.get("/api/admin/users")).json()["users"]
            assert len(rows) == 2
            by_email = {r["email"]: r for r in rows}

            pro = by_email["admin@example.com"]
            assert pro["plan"] == "pro"
            assert pro["planStartedAt"] is not None and pro["planExpiryDate"] is not None

            basic = by_email["user@example.com"]
            assert basic["plan"] == "basic"
            # Null, not a date: nobody bought a plan, so there is none to show.
            assert basic["planStartedAt"] is None and basic["planExpiryDate"] is None

            assert not any("Password" in r or "password" in r for r in rows)

    run(go())
