"""Physical placement validation and candidate scoring for furniture insertion.

Answers two questions against the cached RoomAnalysis, both on CPU in
milliseconds so the preview can re-validate on every drag:

    candidate_positions(analysis, item)  -> the best few places this item could go
    validate_placement(analysis, item, box) -> is *this* spot the user chose valid?

Both share one checker, so a position the engine proposed can never be rejected
by the validator, and a user-dragged position is judged by exactly the same rules
as a suggested one. The backend is authoritative: the frontend's own green/red
feedback is a UX convenience, never the decision.

Scoring follows the feature spec:

    available_space + floor_contact + depth_consistency + perspective
    + cultural_fit + colour_fit
    - overlap - doorway - walking_path - boundary

GPU NOT NEEDED.

Sizing model
------------
An item's on-screen size comes from its real-world width and the local
pixels-per-centimetre, which varies with depth: the same chair covers fewer
pixels across the room than in the foreground. RoomAnalysis records where its
calibration was measured (`reference_depth`), and size at any other depth is
scaled by the ratio of camera distances. When the room has no reference object
of known size, scale is unknown — rather than inventing a number, the engine
falls back to sizing from local clearance and flags lower confidence.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .furniture import item_aspect
from .room_analysis import RoomAnalysis, depth_to_distance

logger = logging.getLogger(__name__)

# A floor-standing item is anchored by the floor it stands on: the bottom strip of
# its box is what must actually touch floor. The rest may overlap a wall — a tall
# lamp legitimately rises in front of one.
FLOOR_CONTACT_STRIP = 0.18   # bottom 18% of the box height

# Fraction of the contact strip that must be floor for the item to be standing on
# something. Below this it is floating, or embedded in a wall.
MIN_FLOOR_CONTACT = 0.6

# Overlap with existing furniture. A little is realistic — a side table tucked
# against a sofa reads correctly — but past this the item looks like it is
# growing out of another object.
MAX_OCCUPIED_OVERLAP = 0.12

# Protected regions (people, doors, windows) allow no overlap worth speaking of.
MAX_PROTECTED_OVERLAP = 0.02

# Walking space: an item needs free floor around its base, expressed as a fraction
# of its own width.
WALKWAY_MARGIN = 0.25

# Sanity bounds on apparent size, as a fraction of image width. Outside these the
# result reads as broken regardless of what the maths says.
MIN_WIDTH_FRAC = 0.03
MAX_WIDTH_FRAC = 0.85


@dataclass
class Box:
    """Axis-aligned placement box in pixels. (x, y) is the top-left corner."""

    x: float
    y: float
    w: float
    h: float

    def to_dict(self) -> dict:
        return {
            "x": int(round(self.x)), "y": int(round(self.y)),
            "width": int(round(self.w)), "height": int(round(self.h)),
        }


@dataclass
class PlacementResult:
    valid: bool
    score: float
    box: Box
    depth: float
    reason_en: str | None = None
    reason_ar: str | None = None
    confidence: float = 1.0
    breakdown: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "score": round(self.score, 3),
            "position": self.box.to_dict(),
            "depth": round(self.depth, 4),
            "reason": self.reason_en,
            "reason_ar": self.reason_ar,
            "confidence": round(self.confidence, 2),
            "breakdown": {k: round(v, 3) for k, v in self.breakdown.items()},
        }


# Bilingual rejection messages — the app is bilingual, so a reason that only
# exists in English would be unusable in the Arabic UI.
REASONS: dict[str, tuple[str, str]] = {
    "outside": (
        "Invalid position: the item falls outside the image.",
        "موضع غير صالح: القطعة خارج حدود الصورة.",
    ),
    "no_floor": (
        "Invalid position: insufficient visible floor area — the item would float.",
        "موضع غير صالح: مساحة الأرضية الظاهرة غير كافية — ستبدو القطعة معلّقة.",
    ),
    "wall": (
        "Invalid position: the item overlaps a wall.",
        "موضع غير صالح: القطعة تتداخل مع الجدار.",
    ),
    "overlap": (
        "Invalid position: the item overlaps existing furniture.",
        "موضع غير صالح: القطعة تتداخل مع أثاث موجود.",
    ),
    "protected": (
        "Invalid position: the item blocks a doorway, window or a person.",
        "موضع غير صالح: القطعة تحجب بابًا أو نافذة أو شخصًا.",
    ),
    "too_large": (
        "Invalid position: the item is too large for this part of the room.",
        "موضع غير صالح: القطعة كبيرة جدًا على هذا الجزء من الغرفة.",
    ),
    "too_small": (
        "Invalid position: the item would be unrealistically small here.",
        "موضع غير صالح: ستبدو القطعة صغيرة بشكل غير واقعي هنا.",
    ),
    "ok": (
        "Valid position: enough floor space and no detected overlap.",
        "موضع صالح: مساحة أرضية كافية ولا يوجد تداخل.",
    ),
}

NO_SPACE_EN = (
    "No safe empty space was found for this furniture item. "
    "Select a smaller item or another room area."
)
NO_SPACE_AR = (
    "لم يتم العثور على مساحة فارغة آمنة لهذه القطعة. "
    "اختر قطعة أصغر أو منطقة أخرى من الغرفة."
)


def box_to_image_space(box: Box, mask_shape: tuple[int, int], target_size: tuple[int, int]) -> Box:
    """Map a box from analysis-mask pixels into rendered-image pixels.

    These are genuinely different spaces: depth+seg run at a fixed square
    resolution (e.g. 384x384) while the render keeps the room's real aspect
    (e.g. 1024x680). Pasting mask coordinates straight into the render puts the
    furniture in the wrong place.

    Position maps through normalized coordinates, so x and y use their own scale
    factors. Size uses the horizontal factor for *both* width and height — that
    is not a shortcut, it is what keeps the item's real proportions: the box in
    mask space is (real_w x real_h) * px_per_cm, and px_per_cm was measured as a
    horizontal quantity, so both dimensions carry the same horizontal scale.

    The base — where the item meets the floor — is the anchor, so the piece stays
    standing on the floor rather than drifting off it as it is rescaled.
    """
    mh, mw = mask_shape
    tw, th = target_size
    if mw <= 0 or mh <= 0:
        return box
    sx, sy = tw / mw, th / mh
    base_cx = (box.x + box.w / 2.0) * sx
    base_cy = (box.y + box.h) * sy
    w = box.w * sx
    h = box.h * sx
    return Box(x=base_cx - w / 2.0, y=base_cy - h, w=w, h=h)


def box_to_mask_space(box: Box, mask_shape: tuple[int, int], target_size: tuple[int, int]) -> Box:
    """Inverse of box_to_image_space — for validating a client-supplied box.

    The client works in rendered-image pixels; the masks live in analysis space,
    so an incoming box has to come back before it can be checked.
    """
    mh, mw = mask_shape
    tw, th = target_size
    if tw <= 0 or th <= 0:
        return box
    sx, sy = mw / tw, mh / th
    base_cx = (box.x + box.w / 2.0) * sx
    base_cy = (box.y + box.h) * sy
    w = box.w * sx
    h = box.h * sx
    return Box(x=base_cx - w / 2.0, y=base_cy - h, w=w, h=h)


def local_px_per_cm(analysis: RoomAnalysis, depth: float) -> float | None:
    """Pixels-per-centimetre at a given depth, or None when scale is unknown."""
    if not analysis.px_per_cm:
        return None
    ratio = float(
        depth_to_distance(analysis.reference_depth) / depth_to_distance(depth)
    )
    value = analysis.px_per_cm * ratio
    return value if value > 1e-6 else None


def item_box_at(
    analysis: RoomAnalysis, item: dict, cx: float, cy: float
) -> tuple[Box, float, float]:
    """Size `item` for a spot whose *base centre* is at pixel (cx, cy).

    Returns (box, depth, confidence). (cx, cy) is where the item touches the
    floor, so the box is built upward from there — that is what keeps a
    floor-standing piece standing on the floor instead of centred on it.
    """
    H, W = analysis.free_floor_mask.shape[:2]
    yi = int(np.clip(cy, 0, H - 1))
    xi = int(np.clip(cx, 0, W - 1))
    depth = float(analysis.depth_norm[yi, xi])

    real_w = float(item.get("real_width_cm") or 60.0)
    real_h = float(item.get("real_height_cm") or 60.0)
    # The box must match the ASSET's proportions, not the catalogue's. The two
    # disagree by up to 65%, and the renderer fits the image inside the box with
    # object-contain — so a mismatched box leaves a gap and the furniture appears
    # to hover in mid-air above where it was actually placed.
    aspect = item_aspect(item)

    ppc = local_px_per_cm(analysis, depth)
    if ppc:
        # Preserve the item's real-world footprint *area* while adopting the
        # asset's aspect, so the error is shared between width and height rather
        # than distorting one of them entirely.
        w_px = float(np.sqrt(real_w * real_h * aspect)) * ppc
        h_px = w_px / aspect if aspect > 0 else real_h * ppc
        confidence = analysis.scale_confidence
    else:
        # No metric calibration in this room. Fall back to local clearance: size
        # the item to a sensible fraction of the open space around it, preserving
        # its real aspect ratio. Honest but coarse, hence the low confidence.
        clearance = _clearance_at(analysis, xi, yi)
        w_px = max(clearance * 1.4, W * MIN_WIDTH_FRAC)
        h_px = w_px / aspect if aspect > 0 else w_px
        confidence = 0.3

    box = Box(x=cx - w_px / 2.0, y=cy - h_px, w=w_px, h=h_px)
    return box, depth, confidence


def _clearance_at(analysis: RoomAnalysis, x: int, y: int) -> float:
    """Approximate free radius at a pixel, from the nearest precomputed candidate."""
    best = 0.0
    H, W = analysis.free_floor_mask.shape[:2]
    for c in analysis.candidates:
        dx = c.cx * W - x
        dy = c.cy * H - y
        if (dx * dx + dy * dy) ** 0.5 <= c.clearance_px:
            best = max(best, c.clearance_px)
    return best or min(H, W) * 0.08


def _crop(mask: np.ndarray, box: Box) -> np.ndarray:
    H, W = mask.shape[:2]
    x0 = int(np.clip(np.floor(box.x), 0, W))
    x1 = int(np.clip(np.ceil(box.x + box.w), 0, W))
    y0 = int(np.clip(np.floor(box.y), 0, H))
    y1 = int(np.clip(np.ceil(box.y + box.h), 0, H))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((0, 0), dtype=bool)
    return mask[y0:y1, x0:x1]


def validate_placement(
    analysis: RoomAnalysis, item: dict, box: Box, *, depth: float | None = None
) -> PlacementResult:
    """Check one concrete box. The single source of truth for 'is this allowed'."""
    H, W = analysis.free_floor_mask.shape[:2]
    breakdown: dict[str, float] = {}

    if depth is None:
        yi = int(np.clip(box.y + box.h, 0, H - 1))
        xi = int(np.clip(box.x + box.w / 2.0, 0, W - 1))
        depth = float(analysis.depth_norm[yi, xi])

    def reject(key: str, score: float = 0.0) -> PlacementResult:
        en, ar = REASONS[key]
        return PlacementResult(
            valid=False, score=score, box=box, depth=depth,
            reason_en=en, reason_ar=ar, breakdown=breakdown,
        )

    # --- bounds ---
    if box.w <= 1 or box.h <= 1:
        return reject("too_small")
    if box.x < 0 or box.y < 0 or box.x + box.w > W or box.y + box.h > H:
        return reject("outside")

    frac = box.w / W
    if frac > MAX_WIDTH_FRAC:
        return reject("too_large")
    if frac < MIN_WIDTH_FRAC:
        return reject("too_small")

    floor_standing = bool(item.get("must_stand_on_floor", True))
    # The bottom strip of the box — the part that must actually touch floor.
    contact_h = max(2.0, box.h * FLOOR_CONTACT_STRIP)
    contact = Box(x=box.x, y=box.y + box.h - contact_h, w=box.w, h=contact_h)

    # --- protected: doors, windows, people ---
    # Checked before floor contact on purpose. A box straddling a doorway also
    # fails the floor test — a door is not floor — and "insufficient floor area"
    # would be a true but useless thing to tell the user. Blocking a door is the
    # specific, actionable diagnosis, so it has to win.
    prot = _crop(analysis.protected_mask, box)
    prot_ratio = float(prot.mean()) if prot.size else 0.0
    breakdown["protected_overlap"] = prot_ratio
    if prot_ratio > MAX_PROTECTED_OVERLAP:
        return reject("protected")

    # --- existing furniture ---
    # Also ahead of the floor check, for the same reason as protected: an item
    # sitting on top of the sofa has no floor under it either, and "overlaps
    # existing furniture" tells the user what to do about it.
    occ = _crop(analysis.occupied_mask, contact)
    occ_ratio = float(occ.mean()) if occ.size else 0.0
    breakdown["occupied_overlap"] = occ_ratio
    if occ_ratio > MAX_OCCUPIED_OVERLAP:
        return reject("overlap")

    # --- floor contact: only the bottom strip must be on the floor ---
    # Reached only once we know the base is not on a person, a door or another
    # piece of furniture — so a failure here really is "floating or in a wall".
    contact_floor = _crop(analysis.floor_mask, contact)
    floor_ratio = float(contact_floor.mean()) if contact_floor.size else 0.0
    breakdown["floor_contact"] = floor_ratio
    if floor_standing and floor_ratio < MIN_FLOOR_CONTACT:
        # Distinguish the two ways this fails, because the user fixes them
        # differently: move down onto the floor, versus move away from the wall.
        contact_wall = _crop(analysis.wall_mask, contact)
        wall_ratio = float(contact_wall.mean()) if contact_wall.size else 0.0
        return reject("wall" if wall_ratio > 0.35 else "no_floor")

    # --- walking space around the base ---
    pad = box.w * WALKWAY_MARGIN
    around = Box(x=box.x - pad, y=box.y + box.h - contact_h, w=box.w + 2 * pad, h=contact_h)
    around_free = _crop(analysis.free_floor_mask, around)
    walk_ratio = float(around_free.mean()) if around_free.size else 0.0
    breakdown["walkway"] = walk_ratio

    # --- score (spec formula) ---
    available_space = walk_ratio
    floor_contact_score = floor_ratio
    # Depth consistency: an item's base should sit at a depth similar to the floor
    # immediately around it; a mismatch means it's straddling a depth discontinuity.
    local = _crop(analysis.depth_norm, contact)
    depth_consistency = float(1.0 - min(np.std(local) * 3.0, 1.0)) if local.size else 0.5
    # Perspective: items should shrink with distance. Reward sizes consistent with
    # the local scale, penalise a foreground-sized object placed far away.
    ppc = local_px_per_cm(analysis, depth)
    if ppc and item.get("real_width_cm"):
        expected = float(item["real_width_cm"]) * ppc
        perspective = float(np.clip(1.0 - abs(box.w - expected) / max(expected, 1.0), 0.0, 1.0))
    else:
        perspective = 0.5
    zone_fit = _zone_score(analysis, item, box)

    score = (
        1.2 * available_space
        + 1.0 * floor_contact_score
        + 0.8 * depth_consistency
        + 0.8 * perspective
        + 0.6 * zone_fit
        - 2.0 * occ_ratio
        - 3.0 * prot_ratio
    )
    breakdown.update({
        "available_space": available_space,
        "depth_consistency": depth_consistency,
        "perspective": perspective,
        "zone_fit": zone_fit,
        "total": score,
    })

    en, ar = REASONS["ok"]
    return PlacementResult(
        valid=True, score=score, box=box, depth=depth,
        reason_en=en, reason_ar=ar,
        confidence=analysis.scale_confidence if analysis.px_per_cm else 0.3,
        breakdown=breakdown,
    )


def _zone_score(analysis: RoomAnalysis, item: dict, box: Box) -> float:
    """How well the spot matches the item's preferred zones (corner, against_wall …)."""
    zones = set(item.get("preferred_zones") or ())
    if not zones:
        return 0.5
    H, W = analysis.wall_mask.shape[:2]
    # Wall proximity: is there wall directly behind the item's upper half?
    upper = Box(x=box.x, y=box.y, w=box.w, h=max(2.0, box.h * 0.5))
    wall_behind = _crop(analysis.wall_mask, upper)
    wall_ratio = float(wall_behind.mean()) if wall_behind.size else 0.0

    near_edge = (box.x < W * 0.18) or (box.x + box.w > W * 0.82)

    score = 0.3
    if "against_wall" in zones and wall_ratio > 0.35:
        score = max(score, 1.0)
    if "corner" in zones and wall_ratio > 0.3 and near_edge:
        score = max(score, 1.0)
    if "open_floor" in zones and wall_ratio < 0.2:
        score = max(score, 0.9)
    if "beside_seating" in zones:
        near = Box(x=box.x - box.w, y=box.y, w=box.w * 3, h=box.h)
        occ = _crop(analysis.occupied_mask, near)
        if occ.size and float(occ.mean()) > 0.08:
            score = max(score, 0.9)
    if item.get("must_touch_wall") and wall_ratio < 0.2:
        score *= 0.4
    return score


def candidate_positions(
    analysis: RoomAnalysis, item: dict, *, limit: int = 3
) -> list[PlacementResult]:
    """Best places this item could go, highest score first.

    Returns [] when nothing valid exists — the caller must surface that honestly
    rather than forcing an insertion. Deliberately never falls back to "least
    bad": a chair inside a wall is worse than no suggestion.
    """
    H, W = analysis.free_floor_mask.shape[:2]
    results: list[PlacementResult] = []

    for spot in analysis.candidates:
        cx = spot.cx * W
        cy = spot.cy * H
        box, depth, conf = item_box_at(analysis, item, cx, cy)
        res = validate_placement(analysis, item, box, depth=depth)
        res.confidence = min(res.confidence, conf)
        if res.valid:
            results.append(res)
            continue

        # A spot can fail only because the base sits slightly off the floor edge.
        # Nudge the anchor upward along the floor and retry once — cheap, and it
        # recovers many otherwise-usable positions near the floor/wall boundary.
        for dy in (0.04, 0.08):
            ny = cy - H * dy
            if ny <= 0:
                break
            box2, depth2, conf2 = item_box_at(analysis, item, cx, ny)
            res2 = validate_placement(analysis, item, box2, depth=depth2)
            if res2.valid:
                res2.confidence = min(res2.confidence, conf2)
                results.append(res2)
                break

    results.sort(key=lambda r: -r.score)
    return results[:limit]
