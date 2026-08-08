"""The email sent when an admin decides an upgrade request.

Two things are worth asserting and one is worth asserting hard: that the two
promised sentences are exactly what goes out, and that a mail server which is
down, slow or misconfigured cannot cost a user the plan they were just granted.
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

from backend import db, mailer, subscriptions  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


@pytest.fixture(autouse=True)
def _no_real_smtp(monkeypatch):
    """No test may talk to a mail server, whatever the developer's env holds."""
    for var in (
        "DARDESIGN_SMTP_HOST", "DARDESIGN_SMTP_PORT", "DARDESIGN_SMTP_USER",
        "DARDESIGN_SMTP_PASSWORD", "DARDESIGN_SMTP_FROM", "DARDESIGN_SMTP_SSL",
    ):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def outbox(monkeypatch):
    """Capture what would be delivered, with SMTP configured but not real."""
    monkeypatch.setenv("DARDESIGN_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("DARDESIGN_SMTP_USER", "dardesign@example.com")
    monkeypatch.setenv("DARDESIGN_SMTP_PASSWORD", "app-password")
    sent: list = []
    monkeypatch.setattr(mailer, "_deliver", lambda msg, cfg: sent.append(msg))
    return sent


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c: httpx.AsyncClient, email: str, name: str) -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": name, "email": email, "password": "secret123",
    })
    assert r.status_code == 200, r.text
    return r.json()


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------- the wording


def test_the_approved_email_says_exactly_what_was_promised():
    subject, body = mailer.decision_message("Zainab Darwech", True, duration_days=30)
    assert "Your subscription to the Pro plan has been accepted." in body
    assert "تمت الموافقة على اشتراكك في الخطة الاحترافية." in body
    # First name only — the mail greets a person, it does not read out a record.
    assert "Hi Zainab," in body and "Darwech" not in body
    assert "30 days" in body
    assert "Pro plan is active" in subject


def test_the_declined_email_says_exactly_what_was_promised():
    subject, body = mailer.decision_message("Zainab", False, weekly_limit=3)
    assert "Your subscription to the Pro plan has been declined." in body
    assert "تم رفض اشتراكك في الخطة الاحترافية." in body
    # A decline is not a dead end: it says what the user still has and can do.
    assert "3 designs a week" in body
    assert "Subscription page" in body
    assert "declined" not in subject.lower()  # the subject is not an accusation


def test_a_missing_name_still_produces_a_sensible_greeting():
    _, body = mailer.decision_message(None, True)
    assert body.startswith("Hello,")
    assert mailer.ACCEPTED_EN in body


def test_the_expiry_date_in_the_mail_is_the_one_that_was_stored():
    import time

    expiry = time.time() + 30 * 86400
    _, body = mailer.decision_message("A", True, expiry=expiry, duration_days=30)
    assert time.strftime("%d %b %Y", time.localtime(expiry)) in body


# ----------------------------------------------------------- the wiring


def test_approving_and_declining_each_send_one_email(outbox):
    async def go():
        async with _client() as a:
            await _signup(a, "admin@example.com", "The Admin")
        async with _client() as u1, _client() as u2:
            yes = await _signup(u1, "yes@example.com", "Yes Person")
            await u1.post("/api/subscription/request")
            no = await _signup(u2, "no@example.com", "No Person")
            await u2.post("/api/subscription/request")

            async with _client() as a:
                await a.post("/api/auth/login", json={
                    "email": "admin@example.com", "password": "secret123",
                })
                queue = (await a.get("/api/admin/subscriptions")).json()["requests"]
                by_user = {r["userId"]: r["id"] for r in queue}

                await a.post(f"/api/admin/subscriptions/{by_user[yes['id']]}/decision",
                             json={"approve": True})
                await a.post(f"/api/admin/subscriptions/{by_user[no['id']]}/decision",
                             json={"approve": False})

    run(go())

    assert len(outbox) == 2
    approved, declined = outbox
    # Each verdict reached the right inbox — not the admin's, not each other's.
    assert approved["To"] == "yes@example.com"
    assert mailer.ACCEPTED_EN in approved.get_content()
    assert declined["To"] == "no@example.com"
    assert mailer.DECLINED_EN in declined.get_content()


def test_a_broken_mail_server_cannot_cost_the_user_their_plan(monkeypatch):
    """The point of the whole background-task arrangement."""
    monkeypatch.setenv("DARDESIGN_SMTP_HOST", "smtp.example.com")

    def explode(msg, cfg):
        raise OSError("connection refused")

    monkeypatch.setattr(mailer, "_deliver", explode)

    async def go():
        async with _client() as a:
            admin = await _signup(a, "admin@example.com", "The Admin")
        async with _client() as u:
            user = await _signup(u, "user@example.com", "A User")
            await u.post("/api/subscription/request")
            request_id = db.pending_subscription_request(user["id"])["Id"]

            async with _client() as a:
                await a.post("/api/auth/login", json={
                    "email": "admin@example.com", "password": "secret123",
                })
                r = await a.post(f"/api/admin/subscriptions/{request_id}/decision",
                                 json={"approve": True})
                # The admin's request succeeded even though the mail did not.
                assert r.status_code == 200
                assert r.json()["status"] == "approved"

            # And the plan is real: granted, stored, and visible to the user.
            state = (await u.get("/api/subscription")).json()
            assert state["isSubscribed"] is True
            assert state["planExpiryDate"] is not None
        assert admin["role"] == "Admin"

    run(go())


def test_send_reports_failure_instead_of_raising(monkeypatch):
    monkeypatch.setenv("DARDESIGN_SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(mailer, "_deliver", lambda msg, cfg: (_ for _ in ()).throw(OSError()))
    assert mailer.send("someone@example.com", "s", "b") is False


def test_unconfigured_smtp_is_a_working_mode_not_a_crash(caplog):
    """No mail account on this machine: the message is logged, nothing raises."""
    assert mailer.is_configured() is False
    with caplog.at_level("INFO", logger="dardesign.mail"):
        assert mailer.notify_decision("someone@example.com", "Sam", True) is False
    logged = caplog.text
    assert "not-configured" in logged
    # What would have been sent is inspectable, so an unconfigured deployment
    # can still show the user exactly what they would have received.
    assert mailer.ACCEPTED_EN in logged


def test_no_recipient_is_refused_before_any_connection(monkeypatch):
    monkeypatch.setenv("DARDESIGN_SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(mailer, "_deliver", lambda msg, cfg: pytest.fail("must not connect"))
    assert mailer.send("", "subject", "body") is False


def test_the_message_is_utf8_and_addressed_from_dardesign(outbox):
    mailer.notify_decision("someone@example.com", "Sam", False)
    assert len(outbox) == 1
    msg = outbox[0]
    assert msg["From"] == "DarDesign <dardesign@example.com>"
    # The Arabic half has to survive the encoding, or half the message is noise.
    assert mailer.DECLINED_AR in msg.get_content()


def test_policy_numbers_in_the_mail_come_from_the_policy_module():
    """The mail must not carry a second, hand-written copy of the plan terms."""
    _, approved = mailer.decision_message(
        "A", True, duration_days=subscriptions.PRO_DURATION_DAYS
    )
    assert f"{subscriptions.PRO_DURATION_DAYS} days" in approved
    _, declined = mailer.decision_message(
        "A", False, weekly_limit=subscriptions.BASIC_WEEKLY_LIMIT
    )
    assert f"{subscriptions.BASIC_WEEKLY_LIMIT} designs a week" in declined
