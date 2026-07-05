"""
DarDesign — 2D object map projection module.

Turns the depth map (Depth Anything V2) + semantic segmentation (OneFormer,
ADE20K-150 ids) that the /redesign pipeline already computes into a
top-down "understood room" plan.

Output contract (matches the shipped RoomMap2D frontend, commit 7820831):
    [{"classKey": "sofa", "cx": 0.42, "cy": 0.61, "w": 0.30, "h": 0.12,
      "labelAr": "أريكة", "labelEn": "sofa", "area": 0.08}, ...]

Coordinate system (all normalized 0..1):
    cx — horizontal position across the room (image x)
    cy — distance from the camera: 0 = near wall (bottom of plan),
         1 = far wall (top of plan)
    w  — object width as a fraction of room width
    h  — object depth-extent along the camera axis

Zero extra VRAM: pure NumPy/SciPy on arrays the pipeline already has.

Usage inside FastAPI /redesign (one line after depth+seg are computed):
    object_map = project_top_down(depth, seg)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage

# --------------------------------------------------------------------------
# ADE20K-150 furniture/decor classes we want on the plan.
# id -> (classKey, labelEn, labelAr)
# --------------------------------------------------------------------------
ADE20K_FURNITURE: dict[int, tuple[str, str, str]] = {
    7:   ("bed",            "bed",             "سرير"),
    10:  ("cabinet",        "cabinet",         "خزانة"),
    14:  ("door",           "door",            "باب"),
    15:  ("table",          "table",           "طاولة"),
    18:  ("curtain",        "curtain",         "ستارة"),
    19:  ("chair",          "chair",           "كرسي"),
    22:  ("painting",       "painting",        "لوحة"),
    23:  ("sofa",           "sofa",            "أريكة"),
    24:  ("shelf",          "shelf",           "رف"),
    27:  ("mirror",         "mirror",          "مرآة"),
    28:  ("rug",            "rug",             "سجادة"),
    30:  ("armchair",       "armchair",        "كرسي بذراعين"),
    33:  ("desk",           "desk",            "مكتب"),
    35:  ("wardrobe",       "wardrobe",        "دولاب"),
    36:  ("lamp",           "lamp",            "مصباح"),
    39:  ("cushion",        "cushion",         "وسادة"),
    44:  ("chest",          "chest of drawers","صوان"),
    49:  ("fireplace",      "fireplace",       "موقد"),
    57:  ("pillow",         "pillow",          "مخدة"),
    62:  ("bookcase",       "bookcase",        "مكتبة"),
    64:  ("coffee_table",   "coffee table",    "طاولة قهوة"),
    69:  ("bench",          "bench",           "مقعد"),
    75:  ("swivel_chair",   "swivel chair",    "كرسي دوار"),
    85:  ("chandelier",     "chandelier",      "ثريا"),
    89:  ("television",     "television",      "تلفاز"),
    97:  ("ottoman",        "ottoman",         "مقعد عثماني"),
    110: ("stool",          "stool",           "كرسي مرتفع"),
    135: ("vase",           "vase",            "مزهرية"),
    146: ("radiator",       "radiator",        "مدفأة"),
}

# Window gets a special key so the frontend can draw it on the wall line.
ADE20K_FURNITURE[8] = ("window", "window", "نافذة")


@dataclass
class MappedObject:
    classKey: str
    labelEn: str
    labelAr: str
    cx: float
    cy: float
    w: float
    h: float
    area: float       # fraction of image pixels
    confidence: float # 0..1, area+coherence heuristic


def _normalize_depth(depth: np.ndarray, near_is_large: bool) -> np.ndarray:
    """Return depth scaled to 0..1 where 0 = nearest to camera, 1 = farthest."""
    d = depth.astype(np.float32)
    d_min, d_max = float(np.nanmin(d)), float(np.nanmax(d))
    if d_max - d_min < 1e-6:
        return np.zeros_like(d, dtype=np.float32)
    d = (d - d_min) / (d_max - d_min)
    # Depth Anything V2 outputs disparity-like maps: larger = closer.
    return 1.0 - d if near_is_large else d


def project_top_down(
    depth: np.ndarray,
    seg: np.ndarray,
    *,
    near_is_large: bool = True,
    min_area_frac: float = 0.0035,
    max_objects: int = 14,
    class_table: dict[int, tuple[str, str, str]] | None = None,
) -> list[dict]:
    """
    Project furniture from (depth, seg) into normalized top-down plan coords.

    Parameters
    ----------
    depth : (H, W) float/uint array from Depth Anything V2 (any scale).
    seg   : (H, W) int array of ADE20K-150 class ids from OneFormer.
    near_is_large : True for Depth Anything (disparity-style) output.
    min_area_frac : drop blobs smaller than this fraction of the image.
    max_objects   : cap returned objects (largest first).
    """
    if depth.shape[:2] != seg.shape[:2]:
        raise ValueError(
            f"depth {depth.shape[:2]} and seg {seg.shape[:2]} must match"
        )
    table = class_table or ADE20K_FURNITURE
    H, W = seg.shape[:2]
    total_px = float(H * W)
    depth_n = _normalize_depth(depth, near_is_large)

    objects: list[MappedObject] = []
    present_ids = np.intersect1d(np.unique(seg), np.fromiter(table, dtype=np.int64))

    for cid in present_ids:
        class_key, label_en, label_ar = table[int(cid)]
        mask = seg == cid
        labeled, n_blobs = ndimage.label(mask)
        if n_blobs == 0:
            continue
        slices = ndimage.find_objects(labeled)
        for blob_idx, sl in enumerate(slices, start=1):
            if sl is None:
                continue
            blob = labeled[sl] == blob_idx
            area_frac = float(blob.sum()) / total_px
            if area_frac < min_area_frac:
                continue

            ys, xs = sl[0], sl[1]
            blob_depth = depth_n[sl][blob]

            cx = (xs.start + xs.stop) / 2.0 / W
            cy = float(np.median(blob_depth))            # camera-axis position
            w = (xs.stop - xs.start) / W
            # Depth-extent: inter-quartile spread along camera axis.
            q25, q75 = np.percentile(blob_depth, [25, 75])
            h = float(max(q75 - q25, 0.04))

            # Coherence: tight depth spread => one solid object => confident.
            spread = float(np.std(blob_depth))
            confidence = float(np.clip(1.0 - spread * 2.5, 0.2, 1.0))

            objects.append(MappedObject(
                classKey=class_key, labelEn=label_en, labelAr=label_ar,
                cx=round(float(np.clip(cx, 0, 1)), 4),
                cy=round(float(np.clip(cy, 0, 1)), 4),
                w=round(float(np.clip(w, 0.02, 1)), 4),
                h=round(float(np.clip(h, 0.04, 1)), 4),
                area=round(area_frac, 5),
                confidence=round(confidence, 3),
            ))

    objects.sort(key=lambda o: o.area, reverse=True)
    return [asdict(o) for o in objects[:max_objects]]


def to_room_map_payload(objects: list[dict], style: str, job_id: str) -> dict:
    """Wrap objects in the envelope fetchObjectMap(jobId) expects."""
    return {
        "jobId": job_id,
        "style": style,
        "objects": objects,
        "version": "projection-v1",
    }


# --------------------------------------------------------------------------
# Image-space regions for the CulturalElementHighlighter
# --------------------------------------------------------------------------

# Furniture/decor plus potted plant (ADE20K 17). Enveloping surfaces
# (wall/floor/ceiling) are deliberately excluded: their bounding boxes span
# the whole frame and would bury every clickable element under one giant box.
HIGHLIGHTER_CLASSES: dict[int, tuple[str, str, str]] = {
    **ADE20K_FURNITURE,
    17: ("plant", "plant", "نبتة"),
}


def seg_bounding_boxes(
    seg: np.ndarray,
    *,
    min_area_frac: float = 0.004,
    max_regions: int = 12,
    class_table: dict[int, tuple[str, str, str]] | None = None,
) -> list[dict]:
    """
    Per-blob bounding boxes in *image* coordinates (unlike project_top_down,
    which projects into plan coordinates). Feeds the on-image
    CulturalElementHighlighter: [{"classKey", "labelEn", "labelAr",
    "bbox": [x, y, w, h], "area"}], everything normalized 0..1.
    """
    table = class_table or HIGHLIGHTER_CLASSES
    H, W = seg.shape[:2]
    total_px = float(H * W)
    regions: list[dict] = []
    present_ids = np.intersect1d(np.unique(seg), np.fromiter(table, dtype=np.int64))

    for cid in present_ids:
        class_key, label_en, label_ar = table[int(cid)]
        labeled, n_blobs = ndimage.label(seg == cid)
        if n_blobs == 0:
            continue
        for blob_idx, sl in enumerate(ndimage.find_objects(labeled), start=1):
            if sl is None:
                continue
            area_frac = float((labeled[sl] == blob_idx).sum()) / total_px
            if area_frac < min_area_frac:
                continue
            ys, xs = sl[0], sl[1]
            regions.append({
                "classKey": class_key,
                "labelEn": label_en,
                "labelAr": label_ar,
                "bbox": [
                    round(xs.start / W, 4),
                    round(ys.start / H, 4),
                    round((xs.stop - xs.start) / W, 4),
                    round((ys.stop - ys.start) / H, 4),
                ],
                "area": round(area_frac, 5),
            })

    # Largest first so the frontend stacks small items on top, still clickable.
    regions.sort(key=lambda r: r["area"], reverse=True)
    return regions[:max_regions]


def to_seg_regions_payload(regions: list[dict], job_id: str) -> dict:
    """Wrap regions in the envelope the CulturalElementHighlighter consumes."""
    return {
        "jobId": job_id,
        "regions": regions,
        "version": "segmap-v1",
    }
