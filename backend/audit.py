"""DarDesign audit trail — append-only JSONL of every render request.

Every /redesign and /restyle call logs one line: timestamp, event, style(s),
duration, ok/error. This is the MLOps/accountability story made concrete: the
thesis can say "every generation is logged and inspectable" and point at
GET /audit + this file.

The log lives NEXT TO the code (backend/audit.jsonl), not under uploads/, so
the 24h TTL sweeper never eats it. No image bytes are ever logged — only
metadata — so the privacy notice still holds.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

AUDIT_PATH = Path(__file__).parent / "audit.jsonl"
_LOCK = threading.Lock()

# Guardrail: audit must never take the API down. Log failures are swallowed
# (but printed) — a full disk should cost us the trail, not the demo.


def log_event(event: str, **fields: object) -> None:
    """Append one audit record. Best-effort, thread-safe, never raises."""
    record: dict[str, object] = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": event,
        **fields,
    }
    try:
        line = json.dumps(record, ensure_ascii=False)
        with _LOCK:
            with open(AUDIT_PATH, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
    except Exception as e:  # pragma: no cover — disk full / permissions
        print(f"audit: failed to write event {event!r}: {e}")


def read_events(limit: int = 100) -> list[dict]:
    """Return the newest `limit` records, newest first. [] when no log yet."""
    try:
        with _LOCK:
            if not AUDIT_PATH.exists():
                return []
            lines = AUDIT_PATH.read_text(encoding="utf-8").splitlines()
    except Exception:  # pragma: no cover
        return []
    out: list[dict] = []
    for line in reversed(lines):
        if len(out) >= limit:
            break
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a torn write must not break the endpoint
    return out


def _reset_for_tests() -> None:
    with _LOCK:
        if AUDIT_PATH.exists():
            AUDIT_PATH.unlink()
