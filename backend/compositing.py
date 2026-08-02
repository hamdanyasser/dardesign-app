"""Composite a transparent furniture PNG into a generated room photo.

This is Option B from the feature spec — asset compositing rather than masked
inpainting — chosen deliberately:

  * Inpainting cannot honour an exact position. Asking a diffusion model to put a
    chair at (420, 510) produces *a* chair somewhere plausible, which defeats the
    whole point of letting the user confirm a position first.
  * Compositing is deterministic: what the preview showed is exactly what lands.
  * It runs on CPU in milliseconds, so no GPU is needed for insertion.
  * The rest of the room is untouched by construction — we paste into a copy and
    never re-generate, so nothing else in the image can drift.

The realism work is in matching the item to the scene rather than generating it:
scale from depth (done upstream by the placement engine), then brightness and
colour-temperature matching, then a contact shadow so the piece doesn't float.

GPU NOT NEEDED.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

from .placement import Box
from .room_analysis import RoomAnalysis

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = ROOT / "public"

# Contact shadow geometry, as fractions of the item's footprint.
SHADOW_HEIGHT_FRAC = 0.16    # how tall the ellipse is relative to item width
SHADOW_WIDTH_FRAC = 0.92     # slightly narrower than the item
SHADOW_BLUR_FRAC = 0.06      # blur radius relative to item width
SHADOW_MAX_ALPHA = 105       # 0-255; a full-black shadow reads as a hole

# How far the item's own tone is allowed to be pulled toward the room's.
# Full correction makes everything muddy and identical; none leaves the item
# looking pasted. Partial is what reads as "photographed in this room".
TONE_MATCH_STRENGTH = 0.55


class CompositingError(RuntimeError):
    pass


@dataclass
class CompositeResult:
    image: Image.Image
    applied_brightness: float
    applied_warmth: float

    def to_meta(self) -> dict:
        return {
            "brightness_factor": round(self.applied_brightness, 3),
            "warmth_shift": round(self.applied_warmth, 3),
        }


def asset_path(item: dict) -> Path:
    """Resolve a catalogue item's PNG, raising clearly when it hasn't been generated."""
    rel = item.get("asset")
    if not rel:
        raise CompositingError(f"catalogue item {item.get('id')!r} has no asset path")
    path = ASSET_ROOT / rel
    if not path.is_file():
        raise CompositingError(
            f"asset not found: {path}. Run scripts/generate_furniture_assets.py "
            f"then scripts/pick_furniture_variants.py --apply."
        )
    return path


def _region_stats(img: Image.Image, box: Box) -> tuple[float, float]:
    """Mean luminance (0-1) and warmth (R-B, -1..1) of the room around the item.

    Sampled from a band around the item's base rather than the whole image: local
    light is what an object actually picks up, and a bright window on the far side
    of the room shouldn't brighten a piece standing in a dim corner.
    """
    W, H = img.size
    pad = max(box.w * 0.6, 24)
    x0 = int(max(0, box.x - pad))
    x1 = int(min(W, box.x + box.w + pad))
    y0 = int(max(0, box.y + box.h * 0.4))
    y1 = int(min(H, box.y + box.h + pad * 0.5))
    if x1 <= x0 or y1 <= y0:
        return 0.5, 0.0
    arr = np.asarray(img.convert("RGB").crop((x0, y0, x1, y1)), dtype=np.float32) / 255.0
    if arr.size == 0:
        return 0.5, 0.0
    lum = float(arr.mean())
    warmth = float(arr[..., 0].mean() - arr[..., 2].mean())
    return lum, warmth


def _match_tone(item_img: Image.Image, room_lum: float, room_warmth: float) -> tuple[Image.Image, float, float]:
    """Pull the item's brightness and colour temperature toward the room's.

    Only the opaque pixels are measured — averaging in transparent background
    would drag every statistic toward zero and wash the correction out.
    """
    rgba = item_img.convert("RGBA")
    arr = np.asarray(rgba, dtype=np.float32) / 255.0
    alpha = arr[..., 3]
    opaque = alpha > 0.5
    if not opaque.any():
        return rgba, 1.0, 0.0

    item_lum = float(arr[..., :3][opaque].mean())
    item_warmth = float(arr[..., 0][opaque].mean() - arr[..., 2][opaque].mean())

    # Brightness: clamped so a very dark or very bright room can't crush the item
    # to black or blow it out.
    ratio = (room_lum / item_lum) if item_lum > 1e-3 else 1.0
    brightness = 1.0 + (ratio - 1.0) * TONE_MATCH_STRENGTH
    brightness = float(np.clip(brightness, 0.55, 1.6))
    out = ImageEnhance.Brightness(rgba).enhance(brightness)

    # Warmth: shift red and blue in opposite directions, alpha untouched.
    warmth_shift = float(np.clip((room_warmth - item_warmth) * TONE_MATCH_STRENGTH, -0.18, 0.18))
    if abs(warmth_shift) > 0.005:
        a = np.asarray(out, dtype=np.float32)
        a[..., 0] = np.clip(a[..., 0] + warmth_shift * 255.0, 0, 255)
        a[..., 2] = np.clip(a[..., 2] - warmth_shift * 255.0, 0, 255)
        out = Image.fromarray(a.astype(np.uint8), "RGBA")

    return out, brightness, warmth_shift


def _contact_shadow(size: tuple[int, int], box: Box, room_lum: float) -> Image.Image:
    """A soft elliptical shadow under the item's base, as its own RGBA layer.

    Anchored at the bottom edge of the box — where the item meets the floor — and
    centred there, because the shadow starting anywhere else is precisely what
    makes composited furniture look like it is hovering.
    """
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    sw = box.w * SHADOW_WIDTH_FRAC
    sh = max(4.0, box.w * SHADOW_HEIGHT_FRAC)
    cx = box.x + box.w / 2.0
    cy = box.y + box.h

    ellipse = Image.new("L", size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(ellipse).ellipse(
        [cx - sw / 2.0, cy - sh / 2.0, cx + sw / 2.0, cy + sh / 2.0], fill=255
    )
    blur = max(2.0, box.w * SHADOW_BLUR_FRAC)
    ellipse = ellipse.filter(ImageFilter.GaussianBlur(blur))

    # A dim room already swallows shadows; a bright one shows them more.
    alpha_scale = float(np.clip(0.45 + room_lum * 0.75, 0.35, 1.0))
    arr = np.asarray(ellipse, dtype=np.float32) * (SHADOW_MAX_ALPHA / 255.0) * alpha_scale
    layer.putalpha(Image.fromarray(arr.astype(np.uint8), "L"))
    return layer


def composite_item(
    base_image: Image.Image,
    item: dict,
    box: Box,
    *,
    analysis: RoomAnalysis | None = None,
    with_shadow: bool = True,
) -> CompositeResult:
    """Paste `item` into `base_image` at `box`. Returns a new image; input untouched."""
    src = asset_path(item)
    try:
        asset = Image.open(src).convert("RGBA")
    except Exception as e:  # noqa: BLE001
        raise CompositingError(f"could not read asset {src}: {e}") from e

    w = max(1, int(round(box.w)))
    h = max(1, int(round(box.h)))
    asset = asset.resize((w, h), Image.LANCZOS)

    room = base_image.convert("RGBA")
    room_lum, room_warmth = _region_stats(room, box)
    toned, brightness, warmth = _match_tone(asset, room_lum, room_warmth)

    out = room.copy()
    if with_shadow:
        out = Image.alpha_composite(out, _contact_shadow(out.size, box, room_lum))

    layer = Image.new("RGBA", out.size, (0, 0, 0, 0))
    layer.paste(toned, (int(round(box.x)), int(round(box.y))), toned)
    out = Image.alpha_composite(out, layer)

    return CompositeResult(image=out.convert("RGB"), applied_brightness=brightness, applied_warmth=warmth)
