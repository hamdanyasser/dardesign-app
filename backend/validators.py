"""Upload validation: mime, size, min dimensions, corruption check."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .errors import (
    ERR_CORRUPT_IMAGE,
    ERR_FILE_TOO_LARGE,
    ERR_IMAGE_TOO_SMALL,
    ERR_NOT_AN_IMAGE,
    ApiError,
)

MAX_BYTES = 10 * 1024 * 1024     # 10 MB
MIN_DIM = 256                     # px on the short edge
ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}


class ValidationFailure(Exception):
    """Raised by validate_upload — caller turns this into HTTPException."""

    def __init__(self, error: ApiError) -> None:
        super().__init__(error.code)
        self.error = error


def validate_upload(*, content_type: str | None, raw_bytes: bytes) -> tuple[int, int]:
    """Validate an uploaded image. Returns (width, height) on success."""
    if not content_type or content_type.lower().split(";")[0].strip() not in ALLOWED_MIMES:
        raise ValidationFailure(ERR_NOT_AN_IMAGE)

    if len(raw_bytes) > MAX_BYTES:
        raise ValidationFailure(ERR_FILE_TOO_LARGE)

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            img.verify()  # checks header but doesn't decode
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise ValidationFailure(ERR_CORRUPT_IMAGE)

    # Re-open for size: verify() leaves the image in an unusable state
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            w, h = img.size
    except Exception:
        raise ValidationFailure(ERR_CORRUPT_IMAGE)

    if min(w, h) < MIN_DIM:
        raise ValidationFailure(ERR_IMAGE_TOO_SMALL)

    return w, h


def validate_path(path: Path) -> tuple[int, int]:
    """File-on-disk variant; useful in scripts/."""
    return validate_upload(
        content_type=_guess_mime(path),
        raw_bytes=path.read_bytes(),
    )


def _guess_mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
