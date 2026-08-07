"""Structural similarity between a room photo and its redesign.

SSIM answers the one question the whole pipeline rests on: *did the room survive
the restyle?* High means the geometry — walls, windows, furniture positions — is
still there and only the styling changed. It is the cheap half of the evaluation
suite, so it runs on every generation rather than only on the offline corpus.

Implemented on numpy + scipy, which the backend already depends on, rather than
pulling in scikit-image: this has to run inside the render request on the GPU box
*and* inside the LIGHT Docker image, and a new dependency in that path is a new
way for generation to fail.

It reproduces `skimage.metrics.structural_similarity` at its defaults — 7x7
uniform window, unbiased covariance, border cropped — so a value measured here is
directly comparable with the ones eval/run_metrics.py computes for the corpus.
Verified against skimage in tests/test_quality.py.

GPU NOT NEEDED. Milliseconds.
"""
from __future__ import annotations

import logging

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

logger = logging.getLogger(__name__)

# Same working size run_metrics.py uses, so the two agree.
_SIZE = 256
_WIN = 7                     # skimage's default window
_K1, _K2 = 0.01, 0.03        # Wang et al. stabilising constants


def _gray(img: Image.Image, size: int = _SIZE) -> np.ndarray:
    return np.asarray(img.convert("L").resize((size, size)), dtype=np.float64) / 255.0


def ssim(a: Image.Image, b: Image.Image, *, data_range: float = 1.0) -> float:
    """Mean SSIM between two images, 0..1. Higher = more structure preserved."""
    x, y = _gray(a), _gray(b)

    # Local means, then local (co)variances from the means of the products.
    filt = {"size": _WIN}
    ux, uy = uniform_filter(x, **filt), uniform_filter(y, **filt)
    uxx = uniform_filter(x * x, **filt)
    uyy = uniform_filter(y * y, **filt)
    uxy = uniform_filter(x * y, **filt)

    # Unbiased estimator, matching skimage: N/(N-1) over the window.
    n = _WIN ** 2
    cov_norm = n / (n - 1)
    vx = cov_norm * (uxx - ux * ux)
    vy = cov_norm * (uyy - uy * uy)
    vxy = cov_norm * (uxy - ux * uy)

    c1 = (_K1 * data_range) ** 2
    c2 = (_K2 * data_range) ** 2
    s = ((2 * ux * uy + c1) * (2 * vxy + c2)) / ((ux**2 + uy**2 + c1) * (vx + vy + c2))

    # Drop the border, where the window ran off the edge and the statistics are
    # padding artefacts rather than image content.
    pad = (_WIN - 1) // 2
    return float(np.mean(s[pad:-pad, pad:-pad]))


def ssim_paths(original: str, generated: str) -> float | None:
    """SSIM for two files. Returns None on any failure.

    Never raises: this runs inside the generation request, and a metric is not
    worth costing someone the render they waited minutes for.
    """
    try:
        with Image.open(original) as a, Image.open(generated) as b:
            return round(ssim(a, b), 4)
    except Exception:  # noqa: BLE001
        logger.exception("SSIM failed for %s vs %s", original, generated)
        return None
