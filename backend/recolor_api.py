"""Colour Control endpoints — preview / apply / undo / reset.

Kept in its own router rather than in main.py so the whole feature is two lines
of wiring: `include_router(color_router)` there, and `cache_analysis` already
storing what this needs. Deleting this file plus that line removes it cleanly.

Shape mirrors the furniture-placement path, which solved the same problems
first: the client sends a job id, the server loads that job's *current* render,
edits it with PIL, writes a new PNG and points `job.style_outputs[style]` at it.
Colour edits therefore stack on top of furniture insertions instead of throwing
them away, and whatever is on screen is what /api/history saves.

GPU NOT NEEDED.
"""
from __future__ import annotations

import base64
import logging
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .audit import log_event
from .errors import (
    ApiError,
    ERR_BAD_COLOR,
    ERR_BAD_STYLE,
    ERR_COLOR_AREA_NOT_FOUND,
    ERR_JOB_NOT_FOUND,
    ERR_NOTHING_TO_UNDO,
    ERR_OUTPUT_MISSING,
    ERR_RECOLOR_FAILED,
)
from .jobs import jobs
from .recolor import (
    DEFAULT_STRENGTH,
    TARGETS,
    RecolorError,
    coverage,
    normalize_target,
    parse_hex_color,
    recolor_surface,
    target_mask,
)
from .room_analysis import get_analysis

logger = logging.getLogger("dardesign.color")

router = APIRouter(prefix="/api/color", tags=["color"])

# Undo stack, keyed by "<job_id>:<style>": the render paths this style had
# *before* each confirmed colour edit, oldest first. In-memory and
# single-process, exactly like jobs.py and the room-analysis cache — a colour
# edit is a live editing session, not durable state. What the user chooses to
# keep goes to the database through the existing Save button.
_UNDO: "OrderedDict[str, list[str]]" = OrderedDict()
_UNDO_MAX_JOBS = 16
_UNDO_MAX_DEPTH = 20


def _raise(err: ApiError, *, detail_en: str | None = None, detail_ar: str | None = None) -> None:
    raise HTTPException(
        status_code=err.http_status,
        detail=err.payload(detail_en=detail_en, detail_ar=detail_ar),
    )


def _png_data_url(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _key(job_id: str, style: str) -> str:
    return f"{job_id}:{style}"


def _push_undo(job_id: str, style: str, previous_path: str) -> None:
    k = _key(job_id, style)
    stack = _UNDO.setdefault(k, [])
    stack.append(previous_path)
    # Bound the depth, but never the *bottom* entry: that is the pre-colour
    # render Reset has to be able to get back to.
    if len(stack) > _UNDO_MAX_DEPTH:
        del stack[1:2]
    _UNDO.move_to_end(k)
    while len(_UNDO) > _UNDO_MAX_JOBS:
        _UNDO.popitem(last=False)


def clear_undo() -> None:
    """Drop every undo stack. Used by the test reset helper."""
    _UNDO.clear()


# ---------- request models ----------


class RecolorRequest(BaseModel):
    job_id: str
    style: str
    target: str                      # "wall" | "floor"
    color: str                       # "#rrggbb"
    strength: float = DEFAULT_STRENGTH


class ColorStateRequest(BaseModel):
    job_id: str
    style: str


# ---------- shared lookups ----------


def _job_or_404(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    return job


def _current_render(job, style: str) -> Path:
    path = (job.style_outputs or {}).get(style)
    if not path or not Path(path).exists():
        _raise(ERR_OUTPUT_MISSING, detail_en=f"No rendered image for style {style!r}.")
    return Path(path)


def _analysis_or_404(job_id: str):
    """The masks this feature recolours inside.

    They only exist while the job's analysis is cached — recomputing them means
    re-running the depth+segmentation models. Saying so plainly beats a generic
    404, because the fix ("redesign the room again") is something the user can
    actually do.
    """
    analysis = get_analysis(job_id)
    if analysis is None:
        _raise(
            ERR_COLOR_AREA_NOT_FOUND,
            detail_en="This room's segmentation is no longer available — redesign the room to change colours.",
            detail_ar="لم يعد تحليل هذه الغرفة متاحاً — أعد تصميم الغرفة لتغيير الألوان.",
        )
    return analysis


def _validated_style(style: str) -> str:
    s = (style or "").strip().lower()
    if not s:
        _raise(ERR_BAD_STYLE)
    return s


def _build(job, style: str, req: RecolorRequest):
    """Shared by preview and apply — same edit, only the persistence differs."""
    analysis = _analysis_or_404(req.job_id)
    base_path = _current_render(job, style)

    try:
        rgb = parse_hex_color(req.color)
        target = normalize_target(req.target)
    except RecolorError as e:
        _raise(ERR_BAD_COLOR, detail_en=e.message_en, detail_ar=e.message_ar)

    from PIL import Image

    try:
        with Image.open(base_path) as im:
            base = im.convert("RGB")
        return recolor_surface(base, analysis, target, rgb, strength=req.strength), base_path
    except RecolorError as e:
        # The surface genuinely isn't in this room — a clear, actionable answer.
        _raise(ERR_COLOR_AREA_NOT_FOUND, detail_en=e.message_en, detail_ar=e.message_ar)
    except Exception as e:  # noqa: BLE001
        logger.exception("recolour failed for job %s", req.job_id)
        _raise(ERR_RECOLOR_FAILED, detail_en=f"{type(e).__name__}: {e}")


# ---------- endpoints ----------


@router.get("/targets")
async def color_targets(job_id: str) -> JSONResponse:
    """Which surfaces are actually recolourable in this room.

    Lets the UI grey out "Floor" in a room with no visible floor *before* the
    user picks a colour, instead of failing after. Coverage is echoed so the
    panel can explain why.
    """
    analysis = _analysis_or_404(job_id)
    from .recolor import MIN_COVERAGE

    out = []
    for t in TARGETS:
        cov = coverage(target_mask(analysis, t))
        out.append({"target": t, "coverage": round(cov, 4), "available": cov >= MIN_COVERAGE})
    return JSONResponse({"job_id": job_id, "targets": out})


@router.post("/preview")
async def color_preview(req: RecolorRequest) -> JSONResponse:
    """Recolour and return the image without touching the job.

    Nothing is written to disk and no state moves, so a user can try ten colours
    and walk away having changed nothing.
    """
    style = _validated_style(req.style)
    job = _job_or_404(req.job_id)
    (image, meta), _ = _build(job, style, req)

    import io

    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return JSONResponse({"job_id": req.job_id, "style": style, "image": data_url, **meta})


@router.post("/apply")
async def color_apply(req: RecolorRequest) -> JSONResponse:
    """Confirm the colour: write a new PNG and make it the job's current render.

    The previous path goes on the undo stack rather than being deleted, so Undo
    is a pointer change and can never fail to find the image it promised.
    """
    style = _validated_style(req.style)
    job = _job_or_404(req.job_id)
    (image, meta), base_path = _build(job, style, req)

    out_path = base_path.with_name(
        f"{req.job_id}_{style}_color_{meta['target']}_{int(time.time() * 1000)}.png"
    )
    try:
        image.save(out_path, "PNG", optimize=True)
    except Exception as e:  # noqa: BLE001
        logger.exception("could not write recoloured render for job %s", req.job_id)
        _raise(ERR_RECOLOR_FAILED, detail_en=f"{type(e).__name__}: {e}")

    _push_undo(req.job_id, style, str(base_path))
    job.style_outputs[style] = str(out_path)

    log_event(
        "color_edit", job_id=req.job_id, style=style, target=meta["target"],
        color=meta["color"], coverage=meta["coverage"], ok=True,
    )
    return JSONResponse({
        "job_id": req.job_id,
        "style": style,
        "image": _png_data_url(out_path),
        "can_undo": True,
        **meta,
    })


@router.post("/undo")
async def color_undo(req: ColorStateRequest) -> JSONResponse:
    """Step back one confirmed colour change."""
    style = _validated_style(req.style)
    job = _job_or_404(req.job_id)
    stack = _UNDO.get(_key(req.job_id, style)) or []
    if not stack:
        _raise(ERR_NOTHING_TO_UNDO)

    previous = stack.pop()
    if not Path(previous).exists():
        # The 24h sweeper can outlive an editing session. Say so instead of
        # pointing the job at a file that no longer exists.
        stack.clear()
        _raise(
            ERR_OUTPUT_MISSING,
            detail_en="The previous version is no longer available.",
            detail_ar="النسخة السابقة لم تعد متاحة.",
        )
    job.style_outputs[style] = previous
    return JSONResponse({
        "job_id": req.job_id,
        "style": style,
        "image": _png_data_url(Path(previous)),
        "can_undo": bool(stack),
    })


@router.post("/reset")
async def color_reset(req: ColorStateRequest) -> JSONResponse:
    """Drop every colour change on this style.

    Colour edits only: it restores the render as it was before the first recolour,
    which keeps any furniture the user inserted earlier. Resetting those too is
    the job of "New room".
    """
    style = _validated_style(req.style)
    job = _job_or_404(req.job_id)
    stack = _UNDO.get(_key(req.job_id, style)) or []
    if not stack:
        _raise(ERR_NOTHING_TO_UNDO)

    original = stack[0]
    stack.clear()
    if not Path(original).exists():
        _raise(
            ERR_OUTPUT_MISSING,
            detail_en="The original version is no longer available.",
            detail_ar="النسخة الأصلية لم تعد متاحة.",
        )
    job.style_outputs[style] = original
    return JSONResponse({
        "job_id": req.job_id,
        "style": style,
        "image": _png_data_url(Path(original)),
        "can_undo": False,
    })
