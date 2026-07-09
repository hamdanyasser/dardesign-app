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

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.transform import (  # noqa: E402
    _ADE20K_PALETTE,
    _peft_key_to_diffusers,
    _winner_weights,
    CONFIG,
    CORE_STYLES,
    LORA_DIR,
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


def test_peft_lora_keys_remap_to_diffusers_format() -> None:
    """train_lora.py saves raw-peft keys; unmapped they crash pipe.load_lora_weights."""
    raw = "base_model.model.down_blocks.1.attentions.0.transformer_blocks.0.attn1.to_k.lora_A.weight"
    assert _peft_key_to_diffusers(raw) == (
        "unet.down_blocks.1.attentions.0.transformer_blocks.0.attn1.to_k.lora_A.weight"
    )
    # Already-diffusers keys pass through untouched.
    ok = "unet.mid_block.attentions.0.transformer_blocks.0.attn2.to_v.lora_B.weight"
    assert _peft_key_to_diffusers(ok) == ok


def test_trained_lora_files_remap_cleanly() -> None:
    """Read the real safetensors headers (no torch needed) and check every key
    lands in the pipeline's expected 'unet.' namespace after remapping."""
    import json
    import struct

    files = list(LORA_DIR.glob("*/dardesign-*-lora.safetensors"))
    if not files:
        pytest.skip("trained LoRA files not present in this checkout")
    for f in files:
        with open(f, "rb") as fh:
            n = struct.unpack("<Q", fh.read(8))[0]
            header = json.loads(fh.read(n))
        keys = [k for k in header if k != "__metadata__"]
        assert keys, f"{f} has no tensors"
        remapped = [_peft_key_to_diffusers(k) for k in keys]
        assert all(k.startswith("unet.") for k in remapped), f
        assert not any("base_model." in k for k in remapped), f
