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


# --------------------------------------------------------------------------
# LPIPS and CLIP.
#
# Unlike SSIM these need model weights (~350 MB total) and a few seconds per
# image, so they are optional: if the packages are absent every function here
# returns None, the value stays null in the database, and the backfill script
# can fill it in later. Nothing in the app fails because a metric is missing.
#
# Model choices and prompts are kept identical to eval/run_metrics.py so a score
# measured here is comparable with one from the offline corpus. Change one and
# you must change the other.
# --------------------------------------------------------------------------

STYLES = ("lebanese", "khaleeji", "moroccan")

CLASS_PROMPTS = {
    "lebanese": "a traditional Lebanese living room interior with qanater arches and cedar wood",
    "khaleeji": "a Khaleeji Gulf Arab majlis interior with floor cushions and gold accents",
    "moroccan": "a Moroccan riad interior with zellige mosaic tiles and brass lanterns",
}

_MODELS: dict[str, object] = {}


def metrics_available() -> bool:
    """True when lpips and open_clip can be imported."""
    from importlib.util import find_spec

    try:
        return find_spec("lpips") is not None and find_spec("open_clip") is not None
    except (ImportError, ValueError):
        return False


def _lpips_model():
    if "lpips" not in _MODELS:
        import lpips as lpips_lib
        import torch

        _MODELS["torch"] = torch
        _MODELS["lpips"] = lpips_lib.LPIPS(net="alex").eval()
    return _MODELS["lpips"], _MODELS["torch"]


def _clip_model():
    if "clip" not in _MODELS:
        import open_clip
        import torch

        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        model.eval()
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        with torch.no_grad():
            text = tokenizer([CLASS_PROMPTS[s] for s in STYLES])
            feat = model.encode_text(text)
            feat /= feat.norm(dim=-1, keepdim=True)
        _MODELS["torch"] = torch
        _MODELS["clip"] = (model, preprocess, feat)
    return (*_MODELS["clip"], _MODELS["torch"])


def lpips_paths(original: str, generated: str) -> float | None:
    """Perceptual distance, lower = more similar. None when unavailable."""
    try:
        net, torch = _lpips_model()

        def prep(path: str):
            with Image.open(path) as im:
                a = np.asarray(im.convert("RGB").resize((256, 256)), dtype=np.float32)
            return torch.from_numpy(a / 127.5 - 1.0).permute(2, 0, 1).unsqueeze(0)

        with torch.no_grad():
            return round(float(net(prep(original), prep(generated)).item()), 4)
    except Exception:  # noqa: BLE001
        logger.exception("LPIPS failed for %s vs %s", original, generated)
        return None


def clip_cultures(generated: str) -> tuple[dict[str, float], str] | None:
    """Per-culture CLIP similarity and the zero-shot 3-way prediction.

    The prediction against the intended culture is what builds the confusion
    matrix: "does this image actually read as the culture it was asked for?"
    """
    try:
        model, preprocess, text_feat, torch = _clip_model()
        with Image.open(generated) as im:
            tensor = preprocess(im.convert("RGB")).unsqueeze(0)
        with torch.no_grad():
            f = model.encode_image(tensor)
            f /= f.norm(dim=-1, keepdim=True)
            sims = (f @ text_feat.T).squeeze(0).float().cpu().numpy()
        scores = {s: round(float(sims[i]), 4) for i, s in enumerate(STYLES)}
        return scores, STYLES[int(np.argmax(sims))]
    except Exception:  # noqa: BLE001
        logger.exception("CLIP failed for %s", generated)
        return None


def evaluate_pair(original: str, generated: str) -> dict:
    """Every metric for one (input, render) pair. Missing ones come back None."""
    scores = clip_cultures(generated)
    return {
        "ssim": ssim_paths(original, generated),
        "lpips": lpips_paths(original, generated),
        "clip_score": scores[0] if scores else None,   # per-culture dict
        "predicted": scores[1] if scores else None,
    }


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
