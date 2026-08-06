"""Cookie-based authentication — password hashing and signed sessions.

Minimal on purpose: stdlib only, no JWT library, no session store. The cookie
carries `user_id:expiry:signature`, signed with HMAC-SHA256. Nothing secret
lives in the cookie, and a tampered one fails signature verification, so no
server-side session table is needed.

Passwords are stored as PBKDF2-HMAC-SHA256 with a per-user random salt. The
users table column is named `Password` as specified, but it holds a hash — the
plaintext is never written anywhere, which is the one part of this that isn't
negotiable.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time

logger = logging.getLogger(__name__)

# Cost factor. 200k iterations is a reasonable 2020s default: slow enough to
# blunt offline cracking, fast enough to be unnoticeable on one login.
_PBKDF2_ROUNDS = 200_000
_SALT_BYTES = 16

SESSION_COOKIE = "dardesign_session"
SESSION_TTL_SECONDS = 7 * 24 * 3600


def _secret() -> bytes:
    """Signing key. Set DARDESIGN_SECRET in any real deployment.

    Without it a random key is generated per process, which is safe but logs
    everyone out whenever the backend restarts — acceptable for local/demo work,
    not for anything persistent.
    """
    env = os.environ.get("DARDESIGN_SECRET")
    if env:
        return env.encode("utf-8")
    global _EPHEMERAL
    try:
        return _EPHEMERAL
    except NameError:
        _EPHEMERAL = secrets.token_bytes(32)
        logger.warning(
            "DARDESIGN_SECRET not set — using an ephemeral signing key; "
            "sessions will not survive a backend restart."
        )
        return _EPHEMERAL


# ---------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    """'pbkdf2_sha256$rounds$salt$hash' — self-describing, so the parameters can
    change later without invalidating existing accounts."""
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return "pbkdf2_sha256${}${}${}".format(
        _PBKDF2_ROUNDS, base64.b64encode(salt).decode(), base64.b64encode(dk).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(rounds)
        )
        # Constant-time: a timing difference here leaks how much of the hash matched.
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except Exception:  # noqa: BLE001 — malformed stored value is simply a failure
        return False


# ---------------------------------------------------------------- sessions


def make_session(user_id: int, ttl: int = SESSION_TTL_SECONDS) -> str:
    payload = f"{user_id}:{int(time.time()) + ttl}"
    sig = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def read_session(token: str | None) -> int | None:
    """Return the user id from a valid, unexpired cookie, else None."""
    if not token:
        return None
    try:
        user_id, expiry, sig = token.rsplit(":", 2)
        payload = f"{user_id}:{expiry}"
        expected = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(expiry) < time.time():
            return None
        return int(user_id)
    except Exception:  # noqa: BLE001
        return None


def cookie_params(is_https: bool) -> dict:
    """Cookie flags appropriate to the transport.

    The frontend runs on http://localhost:3000 while the backend is often a
    https tunnel, which makes the cookie cross-site: browsers only send those
    with SameSite=None, and only accept SameSite=None together with Secure.
    Over plain http (fully local dev) Secure cookies are rejected outright, so
    the flags have to differ. Getting this wrong means login silently appears to
    work and then every subsequent request is anonymous.
    """
    if is_https:
        return {"samesite": "none", "secure": True}
    return {"samesite": "lax", "secure": False}
