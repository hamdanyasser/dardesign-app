"""Validators: mime, size, min-dim, corruption."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.errors import (  # noqa: E402
    ERR_CORRUPT_IMAGE,
    ERR_FILE_TOO_LARGE,
    ERR_IMAGE_TOO_SMALL,
    ERR_NOT_AN_IMAGE,
)
from backend.validators import MAX_BYTES, ValidationFailure, validate_upload  # noqa: E402


def _png_bytes(w: int, h: int, color: tuple[int, int, int] = (200, 100, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def test_valid_png_passes() -> None:
    w, h = validate_upload(content_type="image/png", raw_bytes=_png_bytes(512, 512))
    assert (w, h) == (512, 512)


def test_valid_jpeg_passes() -> None:
    buf = io.BytesIO()
    Image.new("RGB", (1024, 768)).save(buf, format="JPEG")
    w, h = validate_upload(content_type="image/jpeg", raw_bytes=buf.getvalue())
    assert (w, h) == (1024, 768)


def test_rejects_non_image_mime() -> None:
    with pytest.raises(ValidationFailure) as e:
        validate_upload(content_type="application/pdf", raw_bytes=b"%PDF-1.4 fake")
    assert e.value.error.code == ERR_NOT_AN_IMAGE.code


def test_rejects_missing_mime() -> None:
    with pytest.raises(ValidationFailure) as e:
        validate_upload(content_type=None, raw_bytes=b"\x89PNG\r\n\x1a\n")
    assert e.value.error.code == ERR_NOT_AN_IMAGE.code


def test_rejects_too_small() -> None:
    with pytest.raises(ValidationFailure) as e:
        validate_upload(content_type="image/png", raw_bytes=_png_bytes(100, 100))
    assert e.value.error.code == ERR_IMAGE_TOO_SMALL.code


def test_rejects_too_large() -> None:
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (MAX_BYTES + 1)
    with pytest.raises(ValidationFailure) as e:
        validate_upload(content_type="image/png", raw_bytes=big)
    assert e.value.error.code == ERR_FILE_TOO_LARGE.code


def test_rejects_corrupt_image() -> None:
    with pytest.raises(ValidationFailure) as e:
        validate_upload(content_type="image/png", raw_bytes=b"not really a png")
    assert e.value.error.code == ERR_CORRUPT_IMAGE.code


def test_accepts_min_size_exactly() -> None:
    # 256x256 should pass (the boundary)
    w, h = validate_upload(content_type="image/png", raw_bytes=_png_bytes(256, 256))
    assert (w, h) == (256, 256)
