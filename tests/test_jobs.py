"""Jobs registry: state transitions, progress, share token."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.jobs import Jobs, JobStatus  # noqa: E402
from backend.share import decode, encode  # noqa: E402


def test_create_returns_unique_ids() -> None:
    j = Jobs()
    a = j.create("/tmp/a.jpg")
    b = j.create("/tmp/b.jpg")
    assert a.id != b.id
    assert a.status == JobStatus.pending


def test_transitions() -> None:
    j = Jobs()
    a = j.create("/tmp/a.jpg")
    j.transition(a.id, JobStatus.queued, style="lebanese")
    j.transition(a.id, JobStatus.running)
    j.transition(a.id, JobStatus.done, output_path="/tmp/a_out.png")
    got = j.get(a.id)
    assert got is not None
    assert got.status == JobStatus.done
    assert got.style == "lebanese"
    assert got.output_path == "/tmp/a_out.png"


def test_progress_clamped() -> None:
    j = Jobs()
    a = j.create("/tmp/a.jpg")
    j.update_progress(a.id, 1.5)
    assert j.get(a.id).progress == 1.0  # type: ignore[union-attr]
    j.update_progress(a.id, -0.5)
    assert j.get(a.id).progress == 0.0  # type: ignore[union-attr]


def test_error_recorded() -> None:
    j = Jobs()
    a = j.create("/tmp/a.jpg")
    j.transition(
        a.id, JobStatus.error,
        error_code="pipeline_failed",
        error_en="boom", error_ar="انفجر",
    )
    got = j.get(a.id)
    assert got.error_code == "pipeline_failed"  # type: ignore[union-attr]
    assert got.error_message_ar == "انفجر"  # type: ignore[union-attr]


def test_public_redacts_paths() -> None:
    j = Jobs()
    a = j.create("/tmp/secret-path.jpg")
    pub = a.public()
    assert "input_path" not in pub
    assert "output_path" not in pub
    assert pub["id"] == a.id


def test_share_roundtrip() -> None:
    token = encode("abc123def")
    assert decode(token) == "abc123def"


def test_share_tampered_returns_none() -> None:
    token = encode("abc123def")
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
    assert decode(tampered) is None


def test_share_expired() -> None:
    token = encode("abc", ttl_seconds=-10)
    assert decode(token) is None


def test_share_garbage() -> None:
    assert decode("not-a-token") is None
    assert decode("a.b") is None
