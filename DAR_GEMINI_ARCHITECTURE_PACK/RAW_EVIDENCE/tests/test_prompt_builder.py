"""Unit tests for backend.prompt_builder."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.prompt_builder import (  # noqa: E402
    CULTURES,
    build_prompts,
)


def test_all_cultures_load() -> None:
    for c in CULTURES:
        out = build_prompts(c, "living room", seed=0)
        assert out.culture == c
        assert out.positive_en
        assert out.positive_ar
        assert out.negative_en
        assert out.negative_ar


def test_trigger_phrase_in_positive() -> None:
    out = build_prompts("lebanese", "majlis", seed=42)
    assert "dardesign-lebanese style" in out.positive_en
    assert "نمط دار-ديزاين-لبناني" in out.positive_ar


def test_room_context_in_positive() -> None:
    out = build_prompts("moroccan", "riad courtyard", seed=1)
    assert "riad courtyard" in out.positive_en
    # Arabic mapped form
    assert "فناء رياض" in out.positive_ar


def test_seed_is_deterministic() -> None:
    a = build_prompts("khaleeji", "majlis", seed=7)
    b = build_prompts("khaleeji", "majlis", seed=7)
    assert a.to_dict() == b.to_dict()


def test_different_seeds_differ() -> None:
    a = build_prompts("khaleeji", "majlis", seed=1)
    b = build_prompts("khaleeji", "majlis", seed=999)
    # very high probability they differ; if both happen to pick identical
    # samples it's a real bug worth investigating
    assert a.positive_en != b.positive_en


def test_unknown_culture_raises() -> None:
    with pytest.raises(ValueError):
        build_prompts("turkish", "living room")  # type: ignore[arg-type]


def test_negative_includes_universal_and_specific() -> None:
    out = build_prompts("moroccan", "salon marocain", seed=0)
    assert "low quality" in out.negative_en
    assert "Spanish hacienda" in out.negative_en


def test_strict_mode_falls_back_when_nothing_verified() -> None:
    # Every seed entry has verified=false; strict should still emit a prompt
    # (with a logged warning) rather than crash.
    out = build_prompts("lebanese", "living room", seed=0, strict=True)
    assert out.positive_en
