"""Outgoing email — currently one message: the admin's verdict on an upgrade.

Stdlib `smtplib` and `email.message`, no dependency and no third-party sending
service. The app sends one kind of transactional mail to one recipient at a
time; a queue and an API client would be more machinery than the problem has.

Two guarantees shape everything here:

**A failure to send must never undo a decision.** The admin approved the plan;
the plan is approved. Every exception is caught and logged, `send()` returns a
bool rather than raising, and the call site runs it as a FastAPI background task
*after* the response — so a mail server that is down or slow costs a
notification, never the approval and never the admin's request.

**Unconfigured is a working mode, not an error.** With no SMTP host set, the
message is written to the log in full instead of being sent. The demo, the
tests and a laptop with no mail account all work unchanged, and what would have
been sent is inspectable. Set the env vars below to actually deliver:

    DARDESIGN_SMTP_HOST      e.g. smtp.gmail.com  (unset = log-only mode)
    DARDESIGN_SMTP_PORT      default 587
    DARDESIGN_SMTP_USER      the mailbox to authenticate as
    DARDESIGN_SMTP_PASSWORD  an app password, never the account password
    DARDESIGN_SMTP_FROM      the From: address (defaults to _USER)
    DARDESIGN_SMTP_SSL       1 for implicit TLS (port 465); otherwise STARTTLS
"""
from __future__ import annotations

import logging
import os
import smtplib
import time
from email.message import EmailMessage
from email.utils import formataddr

logger = logging.getLogger("dardesign.mail")

# A hung mail server must not pin a worker thread indefinitely.
SMTP_TIMEOUT_SECONDS = 15

SENDER_NAME = "DarDesign"

# The two sentences the product promises, kept as constants so the tests assert
# the same string the mail carries rather than a copy of it.
ACCEPTED_EN = "Your subscription to the Pro plan has been accepted."
ACCEPTED_AR = "تمت الموافقة على اشتراكك في الخطة الاحترافية."
DECLINED_EN = "Your subscription to the Pro plan has been declined."
DECLINED_AR = "تم رفض اشتراكك في الخطة الاحترافية."


def _config() -> dict | None:
    """SMTP settings from the environment, or None when unconfigured.

    Read per call, not at import: the backend is often started before anyone
    thinks about mail, and this way setting the vars and restarting is enough.
    """
    host = (os.environ.get("DARDESIGN_SMTP_HOST") or "").strip()
    if not host:
        return None
    user = (os.environ.get("DARDESIGN_SMTP_USER") or "").strip()
    return {
        "host": host,
        "port": int(os.environ.get("DARDESIGN_SMTP_PORT") or 587),
        "user": user,
        "password": os.environ.get("DARDESIGN_SMTP_PASSWORD") or "",
        "from": (os.environ.get("DARDESIGN_SMTP_FROM") or user).strip(),
        "ssl": (os.environ.get("DARDESIGN_SMTP_SSL") or "").lower() in ("1", "true", "yes"),
    }


def is_configured() -> bool:
    return _config() is not None


def build_message(to: str, subject: str, body: str, sender: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((SENDER_NAME, sender))
    msg["To"] = to
    msg["Subject"] = subject
    # set_content picks UTF-8 itself, which the Arabic half of every body needs.
    msg.set_content(body)
    return msg


def _deliver(msg: EmailMessage, cfg: dict) -> None:
    """Hand one message to the SMTP server. Raises — `send` is what swallows."""
    if cfg["ssl"]:
        server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=SMTP_TIMEOUT_SECONDS)
    else:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=SMTP_TIMEOUT_SECONDS)
    with server:
        if not cfg["ssl"]:
            server.starttls()
        if cfg["user"]:
            server.login(cfg["user"], cfg["password"])
        server.send_message(msg)


def send(to: str, subject: str, body: str) -> bool:
    """Send one email. Returns whether it left the building; never raises.

    False is not an error the caller has to handle — it means "not delivered",
    which for a notification is information, not a failure of the operation that
    triggered it.
    """
    to = (to or "").strip()
    if not to:
        logger.warning("email not sent: no recipient address on the account")
        return False

    cfg = _config()
    if cfg is None:
        # Log-only mode. The whole message, so an unconfigured deployment can
        # still show exactly what the user would have received.
        logger.info(
            "[email:not-configured] to=%s subject=%s\n%s\n"
            "(set DARDESIGN_SMTP_HOST and friends to deliver this for real)",
            to, subject, body,
        )
        return False

    msg = build_message(to, subject, body, cfg["from"])
    started = time.monotonic()
    try:
        _deliver(msg, cfg)
    except Exception:  # noqa: BLE001 — a mail failure must never reach the caller
        logger.exception("email to %s failed (subject=%s)", to, subject)
        return False
    logger.info("email sent to %s in %.2fs (subject=%s)", to, time.monotonic() - started, subject)
    return True


# ------------------------------------------------- the subscription verdict


def decision_message(
    full_name: str | None,
    approved: bool,
    *,
    expiry: float | None = None,
    duration_days: int | None = None,
    weekly_limit: int | None = None,
) -> tuple[str, str]:
    """Subject and body for an approved or declined upgrade request.

    Bilingual, like every other surface in the app: the required sentence in
    English, then the same thing in Arabic. Plain text on purpose — there is no
    template to render, nothing to lay out, and no image to load.
    """
    # First name only, and a greeting that still reads if the name is missing.
    first = (full_name or "").strip().split(" ")[0]
    hello_en = f"Hi {first}," if first else "Hello,"
    hello_ar = f"مرحباً {first}،" if first else "مرحباً،"

    if approved:
        subject = "DarDesign — your Pro plan is active"
        detail_en = "You now have unlimited designs."
        detail_ar = "أصبح بإمكانك إنشاء تصاميم غير محدودة."
        if duration_days:
            detail_en = f"It runs for {duration_days} days. " + detail_en
            detail_ar = f"تدوم الخطة {duration_days} يوماً. " + detail_ar
        if expiry is not None:
            when = time.strftime("%d %b %Y", time.localtime(expiry))
            detail_en += f" Your plan ends on {when}."
            detail_ar += f" تنتهي خطتك في {when}."
        line_en, line_ar = ACCEPTED_EN, ACCEPTED_AR
    else:
        subject = "DarDesign — about your Pro plan request"
        limit = weekly_limit if weekly_limit is not None else 3
        detail_en = (
            f"You are still on the Basic plan, with {limit} designs a week. "
            "You can request Pro again from the Subscription page whenever you like."
        )
        detail_ar = (
            f"لا تزال على الخطة الأساسية، مع {limit} تصاميم في الأسبوع. "
            "يمكنك طلب الخطة الاحترافية مجدداً من صفحة الاشتراك في أي وقت."
        )
        line_en, line_ar = DECLINED_EN, DECLINED_AR

    body = (
        f"{hello_en}\n\n{line_en}\n\n{detail_en}\n\n"
        "—\n\n"
        f"{hello_ar}\n\n{line_ar}\n\n{detail_ar}\n\n"
        "— DarDesign\n"
    )
    return subject, body


def notify_decision(
    email: str,
    full_name: str | None,
    approved: bool,
    *,
    expiry: float | None = None,
    duration_days: int | None = None,
    weekly_limit: int | None = None,
) -> bool:
    """Tell one user their upgrade request was approved or declined.

    Takes plain values rather than a database row: this runs after the response
    on a background task, and a row read inside the request is not something to
    keep a handle on until then.
    """
    subject, body = decision_message(
        full_name, approved,
        expiry=expiry, duration_days=duration_days, weekly_limit=weekly_limit,
    )
    return send(email, subject, body)
