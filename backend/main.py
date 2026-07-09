"""DarDesign FastAPI surface.

Endpoints
---------
GET  /healthz                       liveness (also reports DARDESIGN_LIGHT)
POST /redesign                      multipart image -> original + all 3 styles
                                    as base64 PNG data URLs + 2D object_map
                                    + on-image seg_regions + depth_map PNG
                                    (synchronous, ~1-2 min on the T4)
POST /upload                        multipart image -> {job_id}
POST /transform                     {job_id, style} -> kicks off generation
GET  /status/{job_id}               polling endpoint
GET  /result/{job_id}               returns the generated PNG
POST /retry/{job_id}                re-run a failed/done job, optionally with a new style
GET  /share/{token}                 server-side: resolve a share token to the result PNG
GET  /share-token/{job_id}          mint a token for a finished job
GET  /jobs                          debug listing (last N jobs)
GET  /audit                         render audit trail (JSONL-backed; metadata
                                    only — $DARDESIGN_AUDIT_TOKEN gates it)

CORS is permissive in dev; tighten via $DARDESIGN_ALLOWED_ORIGINS in prod.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .audit import log_event, read_events
from .errors import (
    ERR_BAD_SHARE_TOKEN,
    ERR_BAD_STYLE,
    ERR_FILE_TOO_LARGE,
    ERR_JOB_BAD_STATE,
    ERR_JOB_NOT_FOUND,
    ERR_NOT_AN_IMAGE,
    ERR_OUTPUT_MISSING,
    ERR_PIPELINE,
    ApiError,
)
from .guardrails import (
    clamp_params,
    sanitize_prompt_fragment,
    validate_style as guard_validate_style,
    validate_upload as guard_validate_upload,
)
from .jobs import JobStatus, jobs
from .projection import (
    project_top_down,
    seg_bounding_boxes,
    to_room_map_payload,
    to_seg_regions_payload,
)
from .share import decode as share_decode, encode as share_encode
from .transform import (
    CONFIG,
    CORE_STYLES,
    PipelineError,
    StylePack,
    compute_depth_seg,
    fit_size,
    transform_room,
)
from .ttl_cleanup import PRIVACY_NOTICE, start_background_sweeper
from .validators import ValidationFailure, validate_upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("dardesign.api")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

_default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_origins_env = os.environ.get("DARDESIGN_ALLOWED_ORIGINS")
ALLOWED_ORIGINS = (
    [o.strip() for o in _origins_env.split(",") if o.strip()]
    if _origins_env
    else _default_origins
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Privacy: uploads AND generated PNGs both land in backend/uploads
    # (DEFAULT_OUT_DIR == UPLOAD_DIR), so one root covers them. saved/ and
    # *.keep siblings survive the sweep; everything else dies after 24h.
    stop_sweeper = start_background_sweeper([UPLOAD_DIR], ttl_hours=24, interval_min=60)
    logger.info("24h TTL sweeper running on %s — %s", UPLOAD_DIR, PRIVACY_NOTICE)
    try:
        yield
    finally:
        stop_sweeper()


app = FastAPI(title="DarDesign API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- helpers ----------


def _raise(err: ApiError, *, detail_en: str | None = None, detail_ar: str | None = None) -> None:
    raise HTTPException(status_code=err.http_status, detail=err.payload(detail_en=detail_en, detail_ar=detail_ar))


def _light_mode() -> bool:
    return os.environ.get("DARDESIGN_LIGHT", "").lower() in ("1", "true", "yes")


def _guard_upload(filename: str | None, raw: bytes) -> None:
    """Kit guardrail: extension allowlist + magic-byte sniff before the PIL
    checks in validators.py touch the bytes. max_mb=10 keeps the existing
    contract (frontend also validates 10 MB)."""
    ok, reason = guard_validate_upload(filename or "", raw, max_mb=10)
    if ok:
        return
    detail_en, _, detail_ar = reason.partition(" | ")
    err = ERR_FILE_TOO_LARGE if "larger" in detail_en.lower() else ERR_NOT_AN_IMAGE
    _raise(err, detail_en=detail_en.strip(), detail_ar=detail_ar.strip() or None)


def _clamped_cn_weights(cn_depth: float | None, cn_seg: float | None) -> tuple[float, float] | None:
    """Server-side bounds for caller-supplied ControlNet weights (guardrails kit).
    Returns None when the caller didn't ask, so pipeline defaults apply."""
    if cn_depth is None and cn_seg is None:
        return None
    defaults = CONFIG["default_controlnet_weights"]
    p = clamp_params(
        cn_depth=defaults["depth"] if cn_depth is None else cn_depth,
        cn_seg=defaults["seg"] if cn_seg is None else cn_seg,
    )
    return (p["cn_depth"], p["cn_seg"])


def _png_data_url(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _original_png_data_url(raw: bytes) -> str:
    """Re-encode the upload at the pipeline's output geometry (same fit_size
    the renders and placeholders use) so the before/after compare slider's two
    halves always align."""
    from PIL import Image

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img = img.resize(fit_size(*img.size, int(CONFIG["output_size"][0])))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _depth_png_data_url(depth) -> str:
    """Grayscale PNG of the depth map (Depth Anything convention: brighter =
    closer) so DepthOrbit can displace its plane geometry client-side."""
    import numpy as np
    from PIL import Image

    d = np.asarray(depth, dtype=np.float32)
    lo, hi = float(np.nanmin(d)), float(np.nanmax(d))
    if hi - lo < 1e-6:
        arr = np.zeros_like(d, dtype=np.uint8)
    else:
        arr = ((d - lo) / (hi - lo) * 255.0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- request/response models ----------


class JobIdResponse(BaseModel):
    job_id: str


class TransformRequest(BaseModel):
    job_id: str
    style: str
    seed: int | None = None
    room: str | None = None
    # Optional ControlNet weight overrides — clamped server-side (guardrails).
    cn_depth: float | None = None
    cn_seg: float | None = None


class StatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    style: str | None = None
    error_code: str | None = None
    error_message_en: str | None = None
    error_message_ar: str | None = None


class ShareTokenResponse(BaseModel):
    token: str
    expires_in_seconds: int


class RedesignResponse(BaseModel):
    """Contract of redesignRoom() in src/lib/api.ts: every image is a base64
    PNG data URL; object_map is the to_room_map_payload() envelope,
    seg_regions the to_seg_regions_payload() envelope, and depth_map a
    grayscale depth PNG data URL for DepthOrbit. All three are null when the
    depth+seg pass fails — images still ship."""

    original: str
    lebanese: str
    khaleeji: str
    moroccan: str
    object_map: dict | None = None
    seg_regions: dict | None = None
    depth_map: str | None = None
    # True in DARDESIGN_LIGHT: images are tinted stand-ins, not real renders.
    placeholder: bool | None = None
    privacy_notice: str = PRIVACY_NOTICE


class RestyleResponse(BaseModel):
    """Style Intensity Slider: one culture re-rendered at a chosen LoRA scale."""

    image: str
    style: str
    scale: float
    manifest: dict | None = None  # provenance sidecar (model, LoRA, seed, sha256)
    privacy_notice: str = PRIVACY_NOTICE


# ---------- endpoints ----------


@app.get("/healthz")
async def healthz() -> dict:
    return {
        "ok": True,
        "version": app.version,
        "light_mode": _light_mode(),
        "queue_depth": sum(
            1 for j in jobs.list() if j.status in (JobStatus.queued, JobStatus.running)
        ),
    }


@app.post("/upload", response_model=JobIdResponse)
async def upload_image(file: UploadFile) -> JobIdResponse:
    raw = await file.read()
    _guard_upload(file.filename, raw)
    try:
        validate_upload(content_type=file.content_type, raw_bytes=raw)
    except ValidationFailure as v:
        _raise(v.error)

    # Persist the bytes
    suffix = Path(file.filename or "image.jpg").suffix.lower() or ".jpg"
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"
    job = jobs.create(input_path="")  # path filled below
    input_path = UPLOAD_DIR / f"{job.id}_input{suffix}"
    input_path.write_bytes(raw)
    jobs.transition(job.id, JobStatus.pending)
    job = jobs.get(job.id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    job.input_path = str(input_path)
    return JobIdResponse(job_id=job.id)


@app.post("/redesign", response_model=RedesignResponse)
async def redesign(file: UploadFile) -> RedesignResponse:
    """Synchronous one-shot: original + all three styles + the 2D object map.

    Runs the three generations sequentially (~1-2 min on the T4; instant in
    DARDESIGN_LIGHT). The projection (WIRING §1) reuses the depth + raw-id seg
    of the *input* room, so one compute serves all three style maps.
    """
    raw = await file.read()
    _guard_upload(file.filename, raw)
    try:
        validate_upload(content_type=file.content_type, raw_bytes=raw)
    except ValidationFailure as v:
        _raise(v.error)

    suffix = Path(file.filename or "image.jpg").suffix.lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"
    job = jobs.create(input_path="")
    input_path = UPLOAD_DIR / f"{job.id}_input{suffix}"
    input_path.write_bytes(raw)
    job.input_path = str(input_path)
    jobs.transition(job.id, JobStatus.running, style="all")

    images: dict[str, str] = {}
    last_out: Path | None = None
    started = time.monotonic()
    try:
        # CORE_STYLES only — persian (prompt-only 4th culture) is /restyle-only
        # so the flagship /redesign keeps its ~1-2 min demo timing.
        # Seed derives from the job id so every render is reproducible and the
        # provenance manifest records a real seed instead of null.
        seed = int(job.id[:8], 16)
        for i, style in enumerate(CORE_STYLES):
            last_out = await asyncio.to_thread(transform_room, str(input_path), style, seed=seed)
            images[style] = _png_data_url(last_out)
            jobs.update_progress(job.id, (i + 1) / (len(CORE_STYLES) + 1))
    except PipelineError as e:
        jobs.transition(
            job.id, JobStatus.error,
            error_code=ERR_PIPELINE.code, error_en=e.message_en, error_ar=e.message_ar,
        )
        logger.exception("redesign job %s pipeline error", job.id)
        log_event(
            "redesign", job_id=job.id, ok=False, error=e.message_en,
            duration_s=round(time.monotonic() - started, 2), light=_light_mode(),
        )
        _raise(ERR_PIPELINE, detail_en=e.message_en, detail_ar=e.message_ar)

    original = await asyncio.to_thread(_original_png_data_url, raw)

    # WIRING §1 — depth + raw ADE20K seg → top-down object map, on-image
    # highlighter regions, and the DepthOrbit depth PNG. One compute serves
    # all three. Best-effort: a failure here must never cost the user their
    # three designs.
    object_map: dict | None = None
    seg_regions: dict | None = None
    depth_map: str | None = None
    try:
        depth, seg_ids = await asyncio.to_thread(compute_depth_seg, input_path)
        objects = project_top_down(depth, seg_ids)
        for o in objects:
            # projection.py cy: 0 = nearest the camera. RoomMap2D draws cy=0 at
            # the TOP of the plan and documents it as the far wall — flip at
            # the API boundary so the shipped frontend renders it correctly.
            o["cy"] = round(1.0 - o["cy"], 4)
        object_map = to_room_map_payload(objects, "all", job.id)
        seg_regions = to_seg_regions_payload(seg_bounding_boxes(seg_ids), job.id)
        depth_map = _depth_png_data_url(depth)
        if _light_mode():
            object_map["placeholder"] = True  # synthetic layout, not detections
            seg_regions["placeholder"] = True
    except Exception:
        logger.exception("depth/seg pass failed for job %s — images only", job.id)

    jobs.transition(job.id, JobStatus.done, output_path=str(last_out) if last_out else None)
    jobs.update_progress(job.id, 1.0)
    log_event(
        "redesign", job_id=job.id, ok=True, styles=list(CORE_STYLES),
        duration_s=round(time.monotonic() - started, 2), light=_light_mode(),
        object_map=object_map is not None, seg_regions=seg_regions is not None,
    )
    return RedesignResponse(
        original=original,
        object_map=object_map,
        seg_regions=seg_regions,
        depth_map=depth_map,
        placeholder=True if _light_mode() else None,
        **images,
    )


@app.post("/restyle", response_model=RestyleResponse)
async def restyle(
    file: UploadFile,
    style: str = Form(...),
    scale: float = Form(0.8),
) -> RestyleResponse:
    """Style Intensity Slider — re-render ONE culture at a given LoRA `scale`
    (0.0 ≈ generic SDXL, 1.0 ≈ full culture). This is the ablation made live:
    the examiner drags a slider and watches the tradition emerge from the latent
    space. Instant in DARDESIGN_LIGHT (placeholder ignores scale)."""
    if style not in StylePack:
        _raise(ERR_BAD_STYLE)
    scale = max(0.0, min(1.0, float(scale)))

    raw = await file.read()
    _guard_upload(file.filename, raw)
    try:
        validate_upload(content_type=file.content_type, raw_bytes=raw)
    except ValidationFailure as v:
        _raise(v.error)

    suffix = Path(file.filename or "image.jpg").suffix.lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"
    job = jobs.create(input_path="")
    input_path = UPLOAD_DIR / f"{job.id}_input{suffix}"
    input_path.write_bytes(raw)
    job.input_path = str(input_path)
    jobs.transition(job.id, JobStatus.running, style=style)

    started = time.monotonic()
    try:
        # Job-derived seed: reproducible render + a real seed in the manifest.
        out = await asyncio.to_thread(
            transform_room, str(input_path), style,
            lora_scale=scale, seed=int(job.id[:8], 16),
        )
    except PipelineError as e:
        jobs.transition(
            job.id, JobStatus.error,
            error_code=ERR_PIPELINE.code, error_en=e.message_en, error_ar=e.message_ar,
        )
        logger.exception("restyle job %s pipeline error", job.id)
        log_event(
            "restyle", job_id=job.id, style=style, scale=scale, ok=False,
            error=e.message_en, duration_s=round(time.monotonic() - started, 2),
            light=_light_mode(),
        )
        _raise(ERR_PIPELINE, detail_en=e.message_en, detail_ar=e.message_ar)

    manifest: dict | None = None
    try:
        mpath = out.with_suffix(".manifest.json")
        if mpath.exists():
            import json as _json
            manifest = _json.loads(mpath.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("failed to read provenance manifest for restyle job %s", job.id)

    jobs.transition(job.id, JobStatus.done, output_path=str(out))
    log_event(
        "restyle", job_id=job.id, style=style, scale=scale, ok=True,
        duration_s=round(time.monotonic() - started, 2), light=_light_mode(),
    )
    return RestyleResponse(image=_png_data_url(out), style=style, scale=scale, manifest=manifest)


async def _run_transform(
    job_id: str,
    style: str,
    *,
    seed: int | None,
    room: str | None,
    controlnet_weights: tuple[float, float] | None = None,
) -> None:
    job = jobs.get(job_id)
    if job is None:
        return
    jobs.update_progress(job_id, 0.05)
    try:
        out = await asyncio.to_thread(
            transform_room,
            job.input_path,
            style,
            seed=seed,
            room=room,
            controlnet_weights=controlnet_weights,
        )
        jobs.update_progress(job_id, 1.0)
        jobs.transition(job_id, JobStatus.done, output_path=str(out))
        logger.info("job %s completed -> %s", job_id, out)
    except PipelineError as e:
        jobs.transition(
            job_id, JobStatus.error,
            error_code=ERR_PIPELINE.code,
            error_en=e.message_en,
            error_ar=e.message_ar,
        )
        logger.exception("job %s pipeline error", job_id)
    except Exception as e:  # pragma: no cover — last-resort
        jobs.transition(
            job_id, JobStatus.error,
            error_code=ERR_PIPELINE.code,
            error_en=str(e) or ERR_PIPELINE.message_en,
            error_ar=ERR_PIPELINE.message_ar,
        )
        logger.exception("job %s unexpected error", job_id)


@app.post("/transform", response_model=JobIdResponse)
async def transform_image(req: TransformRequest) -> JobIdResponse:
    try:
        style = guard_validate_style(req.style)
    except ValueError:
        _raise(ERR_BAD_STYLE)
    if style not in StylePack:  # includes persian, the prompt-only 4th culture
        _raise(ERR_BAD_STYLE)

    job = jobs.get(req.job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    if job.status not in (JobStatus.pending, JobStatus.error, JobStatus.done):
        _raise(ERR_JOB_BAD_STATE)

    room = sanitize_prompt_fragment(req.room) or None if req.room else None
    weights = _clamped_cn_weights(req.cn_depth, req.cn_seg)

    jobs.transition(req.job_id, JobStatus.queued, style=style)
    asyncio.create_task(
        _run_transform(req.job_id, style, seed=req.seed, room=room, controlnet_weights=weights)
    )
    jobs.transition(req.job_id, JobStatus.running)
    return JobIdResponse(job_id=req.job_id)


@app.get("/status/{job_id}", response_model=StatusResponse)
async def get_status(job_id: str) -> StatusResponse:
    job = jobs.get(job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    return StatusResponse(
        job_id=job.id,
        status=job.status.value,
        progress=job.progress,
        style=job.style,
        error_code=job.error_code,
        error_message_en=job.error_message_en,
        error_message_ar=job.error_message_ar,
    )


@app.get("/result/{job_id}")
async def get_result(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    if job.status != JobStatus.done:
        _raise(ERR_JOB_BAD_STATE, detail_en=f"Job is {job.status.value}, not done")
    if not job.output_path or not Path(job.output_path).exists():
        _raise(ERR_OUTPUT_MISSING)
    return FileResponse(job.output_path, media_type="image/png", filename=f"dardesign-{job.id}.png")


@app.post("/retry/{job_id}", response_model=JobIdResponse)
async def retry_job(job_id: str, req: TransformRequest | None = None) -> JobIdResponse:
    """Re-run a failed or finished job. Same input image; optional new style."""
    job = jobs.get(job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    style = (req.style if req else None) or job.style or "lebanese"
    try:
        style = guard_validate_style(style)
    except ValueError:
        _raise(ERR_BAD_STYLE)
    if style not in StylePack:
        _raise(ERR_BAD_STYLE)
    seed = req.seed if req else None
    room = sanitize_prompt_fragment(req.room) or None if req and req.room else None
    weights = _clamped_cn_weights(req.cn_depth, req.cn_seg) if req else None

    jobs.transition(job_id, JobStatus.queued, style=style,
                    error_code=None, error_en=None, error_ar=None)
    asyncio.create_task(
        _run_transform(job_id, style, seed=seed, room=room, controlnet_weights=weights)
    )
    jobs.transition(job_id, JobStatus.running)
    return JobIdResponse(job_id=job_id)


@app.get("/share-token/{job_id}", response_model=ShareTokenResponse)
async def mint_share_token(job_id: str) -> ShareTokenResponse:
    job = jobs.get(job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    if job.status != JobStatus.done:
        _raise(ERR_JOB_BAD_STATE)
    token = share_encode(job.id)
    return ShareTokenResponse(token=token, expires_in_seconds=7 * 24 * 3600)


@app.get("/share/{token}")
async def resolve_share(token: str):
    job_id = share_decode(token)
    if job_id is None:
        _raise(ERR_BAD_SHARE_TOKEN)
    job = jobs.get(job_id)
    if job is None or job.status != JobStatus.done or not job.output_path:
        _raise(ERR_BAD_SHARE_TOKEN)
    return FileResponse(job.output_path, media_type="image/png", filename=f"dardesign-{job_id}.png")


@app.get("/jobs")
async def list_jobs(limit: int = 50) -> JSONResponse:
    items = sorted(jobs.list(), key=lambda j: j.created_at, reverse=True)[:limit]
    return JSONResponse([j.public() for j in items])


@app.get("/audit")
async def audit_trail(limit: int = 50, token: str | None = None) -> JSONResponse:
    """Render audit trail, newest first — metadata only, never image bytes.

    Open in dev; set $DARDESIGN_AUDIT_TOKEN to require ?token=… (the demo
    deploy sets it so the panel can be shown the trail without exposing it)."""
    required = os.environ.get("DARDESIGN_AUDIT_TOKEN")
    if required and token != required:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "forbidden",
                "message_en": "Audit trail requires a valid token",
                "message_ar": "سجل التدقيق يتطلب رمزاً صالحاً",
            },
        )
    return JSONResponse(read_events(max(1, min(500, limit))))


# Cleanup helper used by tests; harmless in production.
def _reset_for_tests() -> None:
    from . import jobs as jobs_mod
    jobs_mod.jobs._store.clear()  # type: ignore[attr-defined]
    for p in UPLOAD_DIR.glob("*"):
        if p.is_file() and p.name != ".gitkeep":
            try:
                p.unlink()
            except Exception:
                pass


# Avoid unused import warnings in some Python versions.
_ = shutil
