"""Wall / floor recolouring — the colour maths, with no FastAPI in sight.

Deliberately *not* a second generation pass. Re-running the pipeline with a
"blue wall" prompt would redraw the whole room: furniture would drift, the
before/after slider would stop lining up, and it would cost another 1-2 min on
the T4. Recolouring is a masked HSV edit on the render we already have, so:

  * only the pixels of the chosen surface change, by construction;
  * the value (brightness) channel is *kept*, so every shadow, highlight and
    bit of plaster texture survives — that is what makes it read as paint on a
    real wall rather than a flat fill;
  * it runs on CPU in milliseconds, so Preview is instant.

The masks are the ones `analyze_room()` already built from the ADE20K
segmentation during /redesign — nothing new is segmented or trained here.

GPU NOT NEEDED.
"""
from __future__ import annotations

import logging
import re

import numpy as np
from PIL import Image, ImageFilter

from .room_analysis import ID_FLOOR, ID_WALL, RoomAnalysis

logger = logging.getLogger(__name__)

# The only two surfaces this feature will touch. Furniture, doors and windows
# carry their own ADE20K ids, so they are excluded by construction: the mask is
# an exact class match, never a bounding box.
TARGETS: tuple[str, ...] = ("wall", "floor")

TARGET_IDS: dict[str, int] = {"wall": ID_WALL, "floor": ID_FLOOR}

# How much of the recoloured result is mixed over the original. Below 1.0 a
# little of the surface's own colour shows through, which reads as tinted paint
# rather than a sticker. 0.85 was picked to stay clearly visible on a photo.
DEFAULT_STRENGTH = 0.85

# A surface smaller than this fraction of the frame is treated as "not found":
# a 30-pixel sliver of wall recolours into noise and looks like a bug.
MIN_COVERAGE = 0.005

# Soften the mask edge by about a pixel, and nothing more. Eroding the mask
# first — the obvious way to stop the tint touching the sofa next to the wall —
# is measurably worse: it leaves a ring of the *old* colour tracing every object,
# which reads as a glowing outline, while feathering alone leaves the object's
# interior pixel-identical. Verified on a shaded test room at erosion 0/1/2.
FEATHER_RADIUS_PX = 1.2

# Bounds on the lightness shift (see `_recolour_pixels`). Unclamped, a very dark
# colour crushes the surface to black and takes the texture with it.
VALUE_FACTOR_MIN = 0.35
VALUE_FACTOR_MAX = 2.0

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


class RecolorError(RuntimeError):
    """Bilingual failure — the router turns this into the usual typed payload."""

    def __init__(self, message_en: str, message_ar: str) -> None:
        super().__init__(message_en)
        self.message_en = message_en
        self.message_ar = message_ar


def parse_hex_color(value: str) -> tuple[int, int, int]:
    """'#c0392b' or 'c0392b' -> (192, 57, 43). Anything else is rejected."""
    m = _HEX_RE.match((value or "").strip())
    if not m:
        raise RecolorError(
            "Colour must be a hex value like #C0392B.",
            "يجب أن يكون اللون بصيغة ست عشرية مثل ‎#C0392B.",
        )
    h = m.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def normalize_target(value: str) -> str:
    t = (value or "").strip().lower()
    if t not in TARGETS:
        raise RecolorError(
            f"Only {' and '.join(TARGETS)} can be recoloured.",
            "يمكن تغيير لون الجدران أو الأرضية فقط.",
        )
    return t


def target_mask(analysis: RoomAnalysis, target: str) -> np.ndarray:
    """The boolean mask for one surface, in mask space (the analysis resolution).

    Read from the raw ADE20K ids when they were cached with the analysis, so
    "floor" means the floor and not the rug lying on it — `analysis.floor_mask`
    deliberately counts rugs as standing-room for furniture placement, which is
    the right answer there and the wrong one here. Falls back to the placement
    masks for an analysis cached before ids were kept.
    """
    seg = getattr(analysis, "seg_ids", None)
    if seg is not None:
        return np.asarray(seg) == TARGET_IDS[target]
    return analysis.wall_mask if target == "wall" else analysis.floor_mask


def coverage(mask: np.ndarray) -> float:
    """Fraction of the frame this surface occupies, 0..1."""
    total = float(mask.size)
    return float(mask.sum()) / total if total else 0.0


def mask_to_alpha(mask: np.ndarray, size: tuple[int, int]) -> Image.Image:
    """Mask -> feathered 'L' alpha at the render's own size.

    The masks run at a fixed square analysis resolution while renders keep the
    room's aspect ratio, exactly as the furniture placement path already deals
    with. Resizing here (rather than resizing the render) keeps the output
    pixel-identical to the input everywhere the mask is zero.
    """
    m = np.asarray(mask, dtype=bool)
    alpha = Image.fromarray((m * 255).astype(np.uint8), "L").resize(size, Image.BILINEAR)
    return alpha.filter(ImageFilter.GaussianBlur(FEATHER_RADIUS_PX))


def _recolour_pixels(base: Image.Image, rgb: tuple[int, int, int], region: np.ndarray) -> Image.Image:
    """Hue/saturation from `rgb`, brightness from the photo.

    Working in HSV is what preserves the lighting: H and S say "this surface is
    now terracotta", V still says "and this corner of it is in shadow". The one
    concession is an overall lightness factor — picking navy for a white wall
    has to actually darken it, or the picker feels broken — applied as a
    *multiplier* so relative shading and texture survive it, and clamped so a
    near-black choice can't crush the surface into a silhouette.
    """
    hsv = np.asarray(base.convert("HSV"), dtype=np.float32)
    target_hsv = np.asarray(
        Image.new("RGB", (1, 1), rgb).convert("HSV"), dtype=np.float32
    ).reshape(3)
    th, ts, tv = float(target_hsv[0]), float(target_hsv[1]), float(target_hsv[2])

    v = hsv[..., 2]
    mean_v = float(v[region].mean()) if region.any() else float(v.mean())
    factor = float(np.clip(tv / max(mean_v, 1.0), VALUE_FACTOR_MIN, VALUE_FACTOR_MAX))

    out = hsv.copy()
    out[..., 0] = th
    out[..., 1] = ts
    out[..., 2] = np.clip(v * factor, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "HSV").convert("RGB")


def recolor_surface(
    base: Image.Image,
    analysis: RoomAnalysis,
    target: str,
    rgb: tuple[int, int, int],
    *,
    strength: float = DEFAULT_STRENGTH,
) -> tuple[Image.Image, dict]:
    """Recolour one surface of `base`. Returns (new image, metadata).

    `base` is never modified. Raises RecolorError when the surface isn't in the
    room — an empty wall mask is a real answer ("I can't see a wall here"), not
    an excuse to return the image unchanged and let the user think it worked.
    """
    target = normalize_target(target)
    mask = target_mask(analysis, target)
    cov = coverage(mask)
    if cov < MIN_COVERAGE:
        raise RecolorError(
            f"No {target} could be detected in this room — try the other surface "
            f"or a different photo.",
            "تعذّر تحديد "
            + ("الجدران" if target == "wall" else "الأرضية")
            + " في هذه الغرفة — جرّب السطح الآخر أو صورة أخرى.",
        )

    strength = float(np.clip(strength, 0.1, 1.0))
    rgb_base = base.convert("RGB")
    alpha = mask_to_alpha(mask, rgb_base.size)

    a = np.asarray(alpha, dtype=np.float32)[..., None] / 255.0 * strength
    region = a[..., 0] > 0.5

    tinted = _recolour_pixels(rgb_base, rgb, region)
    blended = (
        np.asarray(rgb_base, dtype=np.float32) * (1.0 - a)
        + np.asarray(tinted, dtype=np.float32) * a
    )
    out = Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8), "RGB")

    meta = {
        "target": target,
        "color": "#%02x%02x%02x" % rgb,
        "strength": round(strength, 3),
        "coverage": round(cov, 4),
        "mask_source": "segmentation" if getattr(analysis, "seg_ids", None) is not None else "placement_masks",
    }
    return out, meta
