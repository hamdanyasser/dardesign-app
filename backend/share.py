"""Stateless HMAC share-token: encodes job_id + expiry.

Token format: <hex(job_id)>.<hex(exp_epoch)>.<hex(hmac_sha256)>

Secret comes from $DARDESIGN_SHARE_SECRET (auto-generated random bytes if unset
- fine for a demo, NOT fine if you want links to survive a backend restart).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

DEFAULT_TTL_SECONDS = 7 * 24 * 3600


def _secret() -> bytes:
    s = os.environ.get("DARDESIGN_SHARE_SECRET")
    if s:
        return s.encode("utf-8")
    # Lazy-init a per-process random secret. Tokens won't survive restart.
    global _RUNTIME_SECRET
    if _RUNTIME_SECRET is None:
        _RUNTIME_SECRET = secrets.token_bytes(32)
    return _RUNTIME_SECRET


_RUNTIME_SECRET: bytes | None = None


def _sign(payload: str) -> str:
    sig = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return sig


def encode(job_id: str, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    exp = int(time.time()) + int(ttl_seconds)
    payload = f"{job_id.encode('utf-8').hex()}.{format(exp, 'x')}"
    return f"{payload}.{_sign(payload)}"


def decode(token: str) -> str | None:
    """Returns job_id if the token is valid and unexpired; else None."""
    try:
        jid_hex, exp_hex, sig = token.split(".")
    except ValueError:
        return None
    payload = f"{jid_hex}.{exp_hex}"
    expected = _sign(payload)
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        exp = int(exp_hex, 16)
    except ValueError:
        return None
    if exp < int(time.time()):
        return None
    try:
        return bytes.fromhex(jid_hex).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
