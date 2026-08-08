"""Plans, the weekly generation allowance, and the daily expiry service.

Two plans. **Basic** is what every account starts on: three generations per
week, free. **Pro** is $20 for 30 days and removes the limit. `IsSubscribed` on
the user row is the whole distinction — Basic is 0, Pro is 1.

Nobody subscribes themselves. "Subscribe" writes a row to
`subscription_requests`; only an admin's approval sets `IsSubscribed`, which is
why the flag is never touched by any user-facing endpoint here. Unsubscribing
*is* the user's own to do, and takes effect immediately.

This module owns the policy — the price, the 30 days, the three-per-week — and
db.py owns the storage. db.py imports nothing from here: every number is passed
in, so the limit can be changed in one place and the schema has no opinion
about it.
"""
from __future__ import annotations

import logging
import threading
import time

from . import db

logger = logging.getLogger("dardesign.subscriptions")

PRO_PRICE_USD = 20
PRO_DURATION_DAYS = 30

# What Basic gets. The window is a rolling week from a user's first generation,
# not a calendar week, so nobody's allowance depends on which day they signed up.
BASIC_WEEKLY_LIMIT = 3
USAGE_WINDOW_SECONDS = 7 * 24 * 3600

# How often the expiry service wakes. Daily as specified; the sweep is a single
# UPDATE, so the interval only decides how promptly an expired plan is noticed,
# never whether it is.
EXPIRY_INTERVAL_SECONDS = 24 * 3600


def terms() -> dict:
    """The plan terms, for the client to render. Sent rather than hard-coded in
    the page so the price and the limit cannot disagree with what is enforced."""
    return {
        "priceUsd": PRO_PRICE_USD,
        "durationDays": PRO_DURATION_DAYS,
        "basicWeeklyLimit": BASIC_WEEKLY_LIMIT,
    }


def usage(user_id: int) -> dict | None:
    """Plan and remaining allowance, without spending anything."""
    return db.usage_state(
        user_id, limit=BASIC_WEEKLY_LIMIT, window_seconds=USAGE_WINDOW_SECONDS
    )


def consume(user_id: int) -> dict | None:
    """Spend one generation. `allowed` is False when the free allowance is gone."""
    return db.consume_generation(
        user_id, limit=BASIC_WEEKLY_LIMIT, window_seconds=USAGE_WINDOW_SECONDS
    )


def state(user_id: int) -> dict | None:
    """Everything the subscription page needs: plan, allowance, pending request."""
    current = usage(user_id)
    if current is None:
        return None
    pending = db.pending_subscription_request(user_id)
    return {
        **current,
        "pendingRequest": db.public_subscription_request(pending) if pending else None,
        "terms": terms(),
    }


def decide(request_id: int, admin_id: int, approve: bool) -> dict | None:
    """Approve (30 days of Pro from now) or decline one pending request."""
    return db.decide_subscription_request(
        request_id, admin_id, approve, duration_days=PRO_DURATION_DAYS
    )


def expire_due(now: float | None = None) -> int:
    """Return every Pro plan that has run out to Basic. Returns how many."""
    n = db.expire_subscriptions(now)
    if n:
        logger.info("subscription sweep: %d plan(s) expired back to Basic", n)
    return n


def start_expiry_service(interval_seconds: float = EXPIRY_INTERVAL_SECONDS):
    """Start the daily expiry sweep. Returns stop().

    Same shape as the TTL sweeper in ttl_cleanup.py: a daemon thread the
    FastAPI lifespan starts and stops. It sweeps once immediately, so a backend
    that was down over an expiry date catches up on boot instead of leaving
    someone on Pro until the next midnight.

    Every failure is logged and swallowed — this thread going down must never
    take the API with it.
    """
    stop_event = threading.Event()

    def _loop() -> None:
        while not stop_event.is_set():
            try:
                expire_due()
            except Exception:  # noqa: BLE001 — a failed sweep must not kill the thread
                logger.exception("subscription expiry sweep failed")
            stop_event.wait(interval_seconds)

    threading.Thread(target=_loop, name="dardesign-subscriptions", daemon=True).start()
    logger.info("subscription expiry service running every %.0fh", interval_seconds / 3600)
    return stop_event.set


def days_left(expiry: float | None, now: float | None = None) -> int | None:
    """Whole days remaining on a plan, or None when there is no expiry date."""
    if expiry is None:
        return None
    now = time.time() if now is None else now
    return max(0, int((expiry - now) // 86400))
