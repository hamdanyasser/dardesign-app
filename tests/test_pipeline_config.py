"""Pipeline-config regression tests (LIGHT-safe — no GPU, no model downloads).

Guards the fixes that make the real T4 path runnable:
  - the seg SDXL ControlNet id must be a real HF repo (the old
    "diffusers/controlnet-seg-sdxl-1.0" never existed),
  - configs/sweep_winners.json must actually reach transform_room,
  - the embedded ADE20K palette must be the full 150-class table.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.transform import (  # noqa: E402
    _ADE20K_PALETTE,
    _winner_weights,
    CONFIG,
    CORE_STYLES,
    SWEEP_WINNERS_PATH,
)


def test_seg_sdxl_checkpoint_is_not_the_phantom_repo() -> None:
    assert CONFIG["controlnet"]["seg_sdxl"] != "diffusers/controlnet-seg-sdxl-1.0"


def test_ade20k_palette_is_complete() -> None:
    assert len(_ADE20K_PALETTE) == 150
    assert all(
        len(rgb) == 3 and all(0 <= v <= 255 for v in rgb) for rgb in _ADE20K_PALETTE
    )
    # First entries of the canonical mmsegmentation table.
    assert _ADE20K_PALETTE[0] == (120, 120, 120)
    assert _ADE20K_PALETTE[2] == (6, 230, 230)


def test_sweep_winners_reach_the_pipeline() -> None:
    assert SWEEP_WINNERS_PATH.exists(), "configs/sweep_winners.json missing"
    for style in CORE_STYLES:
        pair = _winner_weights(style)
        assert pair is not None, f"no sweep winner resolved for {style}"
        depth, seg = pair
        assert 0.0 <= depth <= 2.0 and 0.0 <= seg <= 2.0


def test_winner_weights_unknown_style_falls_back_to_default() -> None:
    pair = _winner_weights("not-a-style")
    assert pair is not None  # "default" key in sweep_winners.json
