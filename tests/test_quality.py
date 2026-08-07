"""backend/quality.py — SSIM on numpy+scipy.

The load-bearing test is the agreement with scikit-image: a live SSIM that
disagreed with the one eval/run_metrics.py computes for the corpus would put two
incomparable numbers side by side in the same thesis.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.quality import _gray, ssim, ssim_paths  # noqa: E402


def _room(seed: int = 0) -> Image.Image:
    """A structured image — flat noise has no structure for SSIM to preserve."""
    rng = np.random.default_rng(seed)
    a = np.zeros((320, 320, 3), dtype=np.float32)
    a[:170] = 220.0                                   # wall
    a[170:] = 120.0                                   # floor
    a[140:210, 60:180] = 70.0                         # sofa
    a += rng.normal(0, 4, a.shape)                    # texture
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def test_identical_images_score_one() -> None:
    img = _room()
    assert ssim(img, img) == pytest.approx(1.0, abs=1e-9)


def test_restyled_room_scores_higher_than_an_unrelated_one() -> None:
    """The property the pipeline is judged on: a recoloured version of the same
    room keeps its structure; a different room does not."""
    room = _room(1)
    arr = np.asarray(room, dtype=np.float32)
    restyled = Image.fromarray(
        np.clip(arr * np.array([1.15, 0.85, 0.7]), 0, 255).astype(np.uint8), "RGB"
    )
    other = _room(99).rotate(90)

    assert ssim(room, restyled) > 0.9
    assert ssim(room, other) < ssim(room, restyled)


def test_matches_scikit_image() -> None:
    skimage = pytest.importorskip("skimage.metrics")
    a, b = _room(3), _room(4)
    mine = ssim(a, b)
    theirs = float(skimage.structural_similarity(_gray(a), _gray(b), data_range=1.0))
    assert mine == pytest.approx(theirs, abs=1e-9)


def test_ssim_paths_returns_none_instead_of_raising(tmp_path) -> None:
    """It runs inside the generation request; a metric must never cost a render."""
    good = tmp_path / "a.png"
    _room().save(good)
    assert ssim_paths(str(good), str(good)) == pytest.approx(1.0, abs=1e-4)
    assert ssim_paths(str(good), str(tmp_path / "missing.png")) is None
    broken = tmp_path / "broken.png"
    broken.write_bytes(b"not an image")
    assert ssim_paths(str(good), str(broken)) is None
