"""Room understanding for furniture placement.

Turns the depth map (Depth Anything V2) + semantic segmentation (OneFormer,
ADE20K-150 ids) that /redesign already computes into the masks a placement
engine needs:

    floor / wall / ceiling masks      where furniture may and may not stand
    occupied mask                     existing furniture and objects
    protected mask                    people, doors, windows, image margins
    free-floor mask                   floor minus occupied minus protected
    candidate spots                   open floor positions ranked by clearance

Nothing here runs a model. It consumes arrays the generation pass already
produced, so the whole feature stays CPU-only — GPU NOT NEEDED.

Companion to projection.py: that module answers "what is in this room and where
is it on a top-down plan"; this one answers "where is there *room* for something
new, and how big can it be".

Scale caveat
------------
A single photo has no metric scale. `free_floor_m2` is estimated by calibrating
against detected furniture of known typical size (a sofa is ~210 cm wide), with a
depth-squared correction for perspective. It is a usable estimate, not a
measurement — `scale_confidence` reports how much to trust it, and every consumer
should degrade gracefully when it is low. `free_floor_ratio` is dimensionless and
always reliable; prefer it when a relative answer will do.
"""
from __future__ import annotations

import logging
import os
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# ADE20K-150 ids. Same 0-indexed table projection.py uses (7=bed, 8=window,
# 14=door, 19=chair, 23=sofa …) — keep the two in sync.
# --------------------------------------------------------------------------
ID_WALL = 0
ID_FLOOR = 3
ID_CEILING = 5
ID_WINDOW = 8
ID_PERSON = 12
ID_DOOR = 14
ID_RUG = 28

# Surfaces a floor-standing item may legitimately rest on. A rug lies flat on the
# floor, so standing a lamp on one is fine — excluding rugs would wrongly rule out
# the most usable part of many rooms.
FLOOR_IDS = (ID_FLOOR, ID_RUG)

# Anything solid enough that furniture must not intersect it. Everything in
# projection.py's furniture table counts, minus the flat/decorative classes that
# don't actually block floor space.
_NON_BLOCKING = {ID_RUG, 22, 27, 39, 57, 85}  # rug, painting, mirror, cushion, pillow, chandelier

# Never place over these, and never place over a person.
PROTECTED_IDS = (ID_PERSON, ID_DOOR, ID_WINDOW)

# ADE20K class -> our catalogue category, so `existing_categories` can tell the
# recommender "this room already has a sofa" using the catalogue's vocabulary.
ADE_TO_CATEGORY: dict[int, str] = {
    23: "sofa", 30: "sofa", 69: "sofa",
    19: "chair", 75: "chair",
    64: "coffee_table", 15: "coffee_table",
    33: "side_table",
    36: "lamp", 85: "lamp",
    10: "cabinet", 35: "cabinet", 44: "cabinet", 62: "cabinet",
    97: "ottoman", 110: "ottoman",
    28: "rug", 27: "mirror", 22: "wall_art",
}

# Typical real-world width in cm, used to calibrate pixels->centimetres.
# Only classes with a genuinely stable width are listed; a "table" varies far too
# much to calibrate from, so it is deliberately absent.
REFERENCE_WIDTH_CM: dict[int, float] = {
    14: 85.0,    # door
    23: 200.0,   # sofa
    30: 90.0,    # armchair
    19: 48.0,    # chair
    7: 150.0,    # bed
    64: 110.0,   # coffee table
}

# Placement must not touch the very edge of the frame: a piece half outside the
# image reads as broken however good the scoring is.
BOUNDARY_MARGIN_FRAC = 0.04


@dataclass
class CandidateSpot:
    """An open floor position with room around it, in normalized image coords."""

    cx: float          # 0..1 across the image
    cy: float          # 0..1 down the image
    clearance_px: float  # radius of free floor around this point
    depth: float       # 0 = nearest camera, 1 = farthest
    max_width_cm: float | None  # widest footprint that fits here, if scale is known

    def to_dict(self) -> dict:
        return {
            "cx": round(self.cx, 4),
            "cy": round(self.cy, 4),
            "clearance_px": round(self.clearance_px, 1),
            "depth": round(self.depth, 4),
            "max_width_cm": round(self.max_width_cm, 1) if self.max_width_cm else None,
        }


@dataclass
class RoomAnalysis:
    floor_mask: np.ndarray
    wall_mask: np.ndarray
    occupied_mask: np.ndarray
    protected_mask: np.ndarray
    free_floor_mask: np.ndarray
    depth_norm: np.ndarray

    free_floor_ratio: float          # free floor / total image, dimensionless
    free_floor_of_floor: float       # free floor / all floor — "how open is the floor"
    free_floor_m2: float | None      # metric estimate, None when uncalibrated
    px_per_cm: float | None          # measured at reference_depth, not everywhere
    reference_depth: float           # normalized depth the calibration was taken at
    scale_confidence: float          # 0..1; how much to trust the metric numbers
    existing_categories: list[str]
    candidates: list[CandidateSpot] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        """JSON-safe view. Masks are excluded — they stay server-side."""
        return {
            "free_floor_ratio": round(self.free_floor_ratio, 4),
            "free_floor_of_floor": round(self.free_floor_of_floor, 4),
            "free_floor_m2": round(self.free_floor_m2, 2) if self.free_floor_m2 else None,
            "scale_confidence": round(self.scale_confidence, 2),
            "existing_categories": self.existing_categories,
            "candidates": [c.to_dict() for c in self.candidates],
            "warnings": self.warnings,
        }


# --------------------------------------------------------------------------
# Per-job cache.
#
# The masks are only derivable from depth+seg, which only exist during the
# generation pass. Recomputing them would mean re-running the depth and
# segmentation models — i.e. needing a GPU — and the placement UI validates on
# every drag. So the analysis is computed once when the room is generated and
# looked up thereafter.
#
# Bounded LRU because the masks are big: at 1024x1024 one analysis is roughly
# 9 MB (five bool masks + a float32 depth map). The default of 8 caps this at
# ~72 MB. Mirrors jobs.py in being in-memory and single-process; when the
# database lands this moves there with no change to callers.
# --------------------------------------------------------------------------
CACHE_MAX = int(os.environ.get("DARDESIGN_ROOM_CACHE", "8"))
_CACHE: "OrderedDict[str, RoomAnalysis]" = OrderedDict()


def cache_analysis(job_id: str, analysis: RoomAnalysis) -> None:
    _CACHE[job_id] = analysis
    _CACHE.move_to_end(job_id)
    while len(_CACHE) > max(1, CACHE_MAX):
        evicted, _ = _CACHE.popitem(last=False)
        logger.info("room analysis cache full — evicted job %s", evicted)


def get_analysis(job_id: str) -> RoomAnalysis | None:
    """Most recent analysis for this job, or None if never computed or evicted."""
    a = _CACHE.get(job_id)
    if a is not None:
        _CACHE.move_to_end(job_id)
    return a


def clear_cache() -> None:
    _CACHE.clear()


def mark_occupied(analysis: RoomAnalysis, x: float, y: float, w: float, h: float) -> None:
    """Record a newly placed item so later placements avoid it.

    Without this every item picks the same "best" spot, because the occupied mask
    is built once at generation time and never learns about furniture the user
    has since added — place a chair then a lamp and they stack in the same corner.

    Only the item's base footprint is marked occupied, not its full height: a tall
    lamp blocks the floor it stands on, but the air above it is still free for a
    picture on the wall behind. Candidate spots are then recomputed so the next
    suggestion reflects the new layout.
    """
    H, W = analysis.floor_mask.shape[:2]
    contact_h = max(2.0, h * 0.18)
    y0 = int(np.clip(y + h - contact_h, 0, H))
    y1 = int(np.clip(y + h, 0, H))
    x0 = int(np.clip(x, 0, W))
    x1 = int(np.clip(x + w, 0, W))
    if x1 <= x0 or y1 <= y0:
        return

    analysis.occupied_mask[y0:y1, x0:x1] = True
    analysis.free_floor_mask[y0:y1, x0:x1] = False
    analysis.candidates = _find_candidates(
        analysis.free_floor_mask, analysis.depth_norm,
        analysis.px_per_cm, analysis.reference_depth,
    )

    free_px = float(analysis.free_floor_mask.sum())
    floor_px = float(analysis.floor_mask.sum())
    analysis.free_floor_ratio = free_px / float(H * W)
    analysis.free_floor_of_floor = (free_px / floor_px) if floor_px > 0 else 0.0
    if analysis.px_per_cm:
        corrected = _free_floor_area_px(analysis.free_floor_mask, analysis.depth_norm)
        analysis.free_floor_m2 = corrected / (analysis.px_per_cm ** 2) / 10_000.0


def _normalize_depth(depth: np.ndarray, near_is_large: bool = True) -> np.ndarray:
    """0 = nearest to camera, 1 = farthest. Mirrors projection._normalize_depth."""
    d = depth.astype(np.float32)
    lo, hi = float(np.nanmin(d)), float(np.nanmax(d))
    if hi - lo < 1e-6:
        return np.zeros_like(d, dtype=np.float32)
    d = (d - lo) / (hi - lo)
    return 1.0 - d if near_is_large else d


# How much nearer/farther the two extremes of one photo actually are.
#
# depth_norm is relative *within the image*, so this range decides how much an
# item may grow toward the camera. An earlier 0.35–1.6 span allowed a 4.6x size
# swing across a single frame, which made anything placed near the camera balloon
# — a 120 cm coffee table rendered wider than the whole room.
#
# A room photographed in one shot spans far less than that: near floor to far
# wall is typically well under 2:1 in apparent scale. 0.72–1.32 caps the swing at
# ~1.8x, which still reads as perspective without exploding.
NEAR_DISTANCE = 0.72
FAR_DISTANCE = 1.32


def depth_to_distance(depth: float | np.ndarray):
    """Map normalized depth (0 near … 1 far) to a relative camera distance.

    Shared by the free-area correction and by apparent-size scaling so the two
    can never disagree.
    """
    d = np.clip(np.asarray(depth, dtype=np.float32), 0.0, 1.0)
    return NEAR_DISTANCE + d * (FAR_DISTANCE - NEAR_DISTANCE)


def _estimate_scale(
    seg: np.ndarray, depth_norm: np.ndarray
) -> tuple[float | None, float, float]:
    """Estimate pixels-per-centimetre from furniture of known typical width.

    Returns (px_per_cm, confidence, reference_depth). Takes the median across
    every usable reference so one mis-segmented blob can't dominate, and reports
    low confidence when references disagree — the honest signal that downstream
    metric numbers should be treated loosely.

    `reference_depth` records how far away the calibration objects were. Without
    it, apparent size can't be corrected for perspective: a sofa measured across
    the room implies a very different pixels-per-cm than the same sofa in the
    foreground, and an item placed at a different depth must be scaled relative
    to where the measurement was actually taken.
    """
    estimates: list[float] = []
    depths: list[float] = []
    for cid, real_w_cm in REFERENCE_WIDTH_CM.items():
        mask = seg == cid
        if not mask.any():
            continue
        labeled, n = ndimage.label(mask)
        if n == 0:
            continue
        for blob_idx, sl in enumerate(ndimage.find_objects(labeled), start=1):
            if sl is None:
                continue
            px_w = sl[1].stop - sl[1].start
            # Ignore slivers; a 3-pixel "sofa" is a segmentation artefact.
            if px_w < 12:
                continue
            estimates.append(px_w / real_w_cm)
            blob = labeled[sl] == blob_idx
            depths.append(float(np.median(depth_norm[sl][blob])))

    if not estimates:
        return None, 0.0, 0.5

    px_per_cm = float(np.median(estimates))
    ref_depth = float(np.median(depths)) if depths else 0.5
    if px_per_cm <= 0:
        return None, 0.0, 0.5

    if len(estimates) == 1:
        confidence = 0.4  # plausible, but nothing corroborates it
    else:
        spread = float(np.std(estimates) / px_per_cm)
        confidence = float(np.clip(1.0 - spread, 0.2, 0.95))
    return px_per_cm, confidence, ref_depth


def _free_floor_area_px(free_mask: np.ndarray, depth_norm: np.ndarray) -> float:
    """Perspective-corrected floor area in 'near-plane pixel' units.

    A pixel of far-away floor covers much more real area than a pixel of nearby
    floor. Real area per pixel grows roughly with the square of distance, so each
    free pixel is weighted accordingly before summing. Without this, a room whose
    open space is mostly in the distance would look far smaller than it is.
    """
    if not free_mask.any():
        return 0.0
    rel = depth_to_distance(depth_norm[free_mask])
    return float(np.sum(rel ** 2))


def _find_candidates(
    free_floor_mask: np.ndarray,
    depth_norm: np.ndarray,
    px_per_cm: float | None,
    reference_depth: float,
    *,
    max_candidates: int = 8,
    min_clearance_px: int = 12,
) -> list[CandidateSpot]:
    """Roomiest open-floor points, best first.

    The distance transform gives, for every free pixel, how far it is from the
    nearest blocked pixel. Its local maxima are the roomiest points on the floor,
    and the value there is exactly "how much clearance would an item get here".

    Factored out of analyze_room so it can be re-run after a placement without
    redoing the whole analysis — the free-floor mask changes, the depth map and
    calibration do not.
    """
    H, W = free_floor_mask.shape[:2]
    candidates: list[CandidateSpot] = []
    if not free_floor_mask.any():
        return candidates

    work = ndimage.distance_transform_edt(free_floor_mask)
    yy, xx = np.ogrid[:H, :W]
    for _ in range(max_candidates):
        idx = int(np.argmax(work))
        y, x = np.unravel_index(idx, work.shape)
        clearance = float(work[y, x])
        if clearance < min_clearance_px:
            break
        # Convert clearance to centimetres *at this spot's depth*, not at the
        # depth the calibration happened to be taken at.
        if px_per_cm:
            local = px_per_cm * float(
                depth_to_distance(reference_depth) / depth_to_distance(depth_norm[y, x])
            )
            max_w_cm = 2.0 * clearance / local if local > 0 else None
        else:
            max_w_cm = None
        candidates.append(CandidateSpot(
            cx=float(x) / W,
            cy=float(y) / H,
            clearance_px=clearance,
            depth=float(depth_norm[y, x]),
            max_width_cm=max_w_cm,
        ))
        # Suppress a disc around this pick so the next one is a genuinely
        # different location rather than the pixel next door.
        work[(yy - y) ** 2 + (xx - x) ** 2 <= (clearance * 1.5) ** 2] = 0.0
    return candidates


def analyze_room(
    depth: np.ndarray,
    seg: np.ndarray,
    *,
    near_is_large: bool = True,
    max_candidates: int = 8,
    min_clearance_px: int = 12,
) -> RoomAnalysis:
    """Build placement masks and candidate spots from one depth+seg pair."""
    if depth.shape[:2] != seg.shape[:2]:
        raise ValueError(f"depth {depth.shape[:2]} and seg {seg.shape[:2]} must match")

    H, W = seg.shape[:2]
    total_px = float(H * W)
    depth_norm = _normalize_depth(depth, near_is_large)
    warnings: list[str] = []

    floor_mask = np.isin(seg, FLOOR_IDS)
    wall_mask = seg == ID_WALL

    # Occupied = every solid class present that isn't floor/wall/ceiling and isn't
    # in the non-blocking set. Derived from what's actually in the image rather
    # than a fixed list, so unusual classes still block placement.
    present = set(np.unique(seg).tolist())
    blocking = present - {ID_WALL, ID_FLOOR, ID_CEILING} - _NON_BLOCKING
    occupied_mask = np.isin(seg, list(blocking)) if blocking else np.zeros_like(floor_mask)

    protected_mask = np.isin(seg, PROTECTED_IDS)
    # Grow the protected zone so nothing is placed flush against a doorway or a
    # person — clearance matters as much as non-overlap.
    if protected_mask.any():
        protected_mask = ndimage.binary_dilation(
            protected_mask, iterations=max(2, int(min(H, W) * 0.02))
        )

    # Image-margin exclusion.
    margin = int(min(H, W) * BOUNDARY_MARGIN_FRAC)
    boundary = np.zeros((H, W), dtype=bool)
    if margin > 0:
        boundary[:margin, :] = boundary[-margin:, :] = True
        boundary[:, :margin] = boundary[:, -margin:] = True

    free_floor_mask = floor_mask & ~occupied_mask & ~protected_mask & ~boundary

    floor_px = float(floor_mask.sum())
    free_px = float(free_floor_mask.sum())
    free_floor_ratio = free_px / total_px
    free_floor_of_floor = (free_px / floor_px) if floor_px > 0 else 0.0

    if floor_px / total_px < 0.05:
        warnings.append(
            "very little floor is visible — placement suggestions will be unreliable"
        )

    # --- metric scale ---
    px_per_cm, scale_confidence, reference_depth = _estimate_scale(seg, depth_norm)
    free_floor_m2: float | None = None
    if px_per_cm:
        corrected_px = _free_floor_area_px(free_floor_mask, depth_norm)
        free_floor_m2 = corrected_px / (px_per_cm ** 2) / 10_000.0
    else:
        warnings.append(
            "no reference object of known size found — floor area could not be "
            "estimated in metres; use free_floor_ratio instead"
        )

    # --- existing furniture, in catalogue vocabulary ---
    existing = sorted({
        ADE_TO_CATEGORY[int(cid)] for cid in present if int(cid) in ADE_TO_CATEGORY
    })

    # --- candidate spots ---
    candidates = _find_candidates(
        free_floor_mask, depth_norm, px_per_cm, reference_depth,
        max_candidates=max_candidates, min_clearance_px=min_clearance_px,
    )

    if not candidates:
        warnings.append("no open floor area large enough for furniture was found")

    return RoomAnalysis(
        floor_mask=floor_mask,
        wall_mask=wall_mask,
        occupied_mask=occupied_mask,
        protected_mask=protected_mask,
        free_floor_mask=free_floor_mask,
        depth_norm=depth_norm,
        free_floor_ratio=free_floor_ratio,
        free_floor_of_floor=free_floor_of_floor,
        free_floor_m2=free_floor_m2,
        px_per_cm=px_per_cm,
        reference_depth=reference_depth,
        scale_confidence=scale_confidence,
        existing_categories=existing,
        candidates=candidates,
        warnings=warnings,
    )
