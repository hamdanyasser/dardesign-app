"""Room analysis cache: the bounded LRU that keeps depth/segmentation masks
alive between a generation and a later Studio edit (colour control, furniture
placement).

Recomputing an evicted analysis means re-running the depth+seg models on a
GPU, so eviction is a real, user-visible loss ("redesign the room again") —
these tests pin down exactly when it happens: only past CACHE_MAX distinct
jobs, oldest-unused first, and never for an entry that was just read.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import room_analysis  # noqa: E402
from backend.room_analysis import ID_FLOOR, ID_WALL, analyze_room  # noqa: E402


def _tiny_room(size: int = 32):
    seg = np.full((size, size), ID_WALL, dtype=np.int32)
    seg[size // 2 :, :] = ID_FLOOR
    depth = np.tile(np.linspace(0.2, 0.9, size, dtype=np.float32)[:, None], (1, size))
    return analyze_room(depth, seg)


@pytest.fixture(autouse=True)
def _clean_cache():
    room_analysis.clear_cache()
    yield
    room_analysis.clear_cache()


@pytest.fixture
def small_cache(monkeypatch):
    """A cap of 3 keeps the eviction boundary reachable in a few lines."""
    monkeypatch.setattr(room_analysis, "CACHE_MAX", 3)
    yield 3


def test_analyses_survive_until_the_cap_is_exceeded(small_cache) -> None:
    for i in range(small_cache):
        room_analysis.cache_analysis(f"job-{i}", _tiny_room())
    for i in range(small_cache):
        assert room_analysis.get_analysis(f"job-{i}") is not None


def test_the_oldest_unused_job_is_evicted_first(small_cache) -> None:
    for i in range(small_cache):
        room_analysis.cache_analysis(f"job-{i}", _tiny_room())

    # One more than the cap: job-0, never touched since, must be the casualty.
    room_analysis.cache_analysis("job-new", _tiny_room())

    assert room_analysis.get_analysis("job-0") is None
    assert room_analysis.get_analysis("job-1") is not None
    assert room_analysis.get_analysis("job-2") is not None
    assert room_analysis.get_analysis("job-new") is not None


def test_reading_a_job_protects_it_from_the_next_eviction(small_cache) -> None:
    for i in range(small_cache):
        room_analysis.cache_analysis(f"job-{i}", _tiny_room())

    # job-0 is the oldest by insertion order, but reading it marks it
    # recently-used — the next insert should take job-1 instead.
    assert room_analysis.get_analysis("job-0") is not None
    room_analysis.cache_analysis("job-new", _tiny_room())

    assert room_analysis.get_analysis("job-0") is not None
    assert room_analysis.get_analysis("job-1") is None
    assert room_analysis.get_analysis("job-new") is not None


def test_unknown_job_returns_none_rather_than_raising() -> None:
    assert room_analysis.get_analysis("never-existed") is None


def test_default_cap_matches_the_documented_value() -> None:
    """Guards against the constant silently drifting from what CLAUDE.md and
    the module docstring both describe as the current default."""
    import os

    if "DARDESIGN_ROOM_CACHE" not in os.environ:
        assert room_analysis.CACHE_MAX == 32
