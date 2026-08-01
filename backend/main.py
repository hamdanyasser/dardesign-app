"""DarDesign FastAPI surface.

Endpoints
---------
GET  /healthz                       liveness (also reports DARDESIGN_LIGHT)
POST /upload                        multipart image -> {job_id}
POST /transform                     {job_id, style} -> kicks off generation
GET  /status/{job_id}               polling endpoint
GET  /result/{job_id}               returns the generated PNG
POST /retry/{job_id}                re-run a failed/done job, optionally with a new style
GET  /share/{token}                 server-side: resolve a share token to the result PNG
GET  /share-token/{job_id}          mint a token for a finished job
GET  /jobs                          debug listing (last N jobs)

CORS is permissive in dev; tighten via $DARDESIGN_ALLOWED_ORIGINS in prod.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .errors import (
    ERR_BAD_SHARE_TOKEN,
    ERR_JOB_BAD_STATE,
    ERR_JOB_NOT_FOUND,
    ERR_OUTPUT_MISSING,
    ERR_PIPELINE,
    ApiError,
)
from .jobs import JobStatus, jobs
from .settings import SETTINGS, configure_file_logging
from .share import decode as share_decode, encode as share_encode
from .transform import PipelineError, StylePack, transform_room
from .validators import ValidationFailure, validate_upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
configure_file_logging("backend", SETTINGS.logs_dir)
logger = logging.getLogger("dardesign.api")

UPLOAD_DIR = SETTINGS.upload_dir
UPLOAD_DIR.mkdir(exist_ok=True)

_default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]
_origins_env = os.environ.get("DARDESIGN_ALLOWED_ORIGINS")
ALLOWED_ORIGINS = (
    [o.strip() for o in _origins_env.split(",") if o.strip()]
    if _origins_env
    else _default_origins
)

app = FastAPI(title="DarDesign API", version="0.2.0")
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


def _transform_timeout_seconds() -> float:
    raw = os.environ.get("DARDESIGN_TRANSFORM_TIMEOUT_SECONDS", "900")
    try:
        seconds = float(raw)
        return seconds if seconds > 0 else 900.0
    except Exception:
        return 900.0


# ---------- request/response models ----------


class JobIdResponse(BaseModel):
    job_id: str


class TransformRequest(BaseModel):
    job_id: str
    style: str
    seed: int | None = None
    room: str | None = None


class StatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    style: str | None = None
    error_code: str | None = None
    error_message_en: str | None = None
    error_message_ar: str | None = None
    stage_message_en: str | None = None
    stage_message_ar: str | None = None


class ShareTokenResponse(BaseModel):
    token: str
    expires_in_seconds: int


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
    logger.info("upload received filename=%s content_type=%s", file.filename, file.content_type)
    raw = await file.read()
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
    logger.info("upload persisted job_id=%s bytes=%s path=%s", job.id, len(raw), input_path)
    jobs.transition(
        job.id,
        JobStatus.pending,
        stage_en="Image uploaded",
        stage_ar="تم رفع الصورة",
    )
    job = jobs.get(job.id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    job.input_path = str(input_path)
    return JobIdResponse(job_id=job.id)


async def _run_transform(job_id: str, style: str, *, seed: int | None, room: str | None) -> None:
    job = jobs.get(job_id)
    if job is None:
        return
    jobs.update_progress(
        job_id,
        0.05,
        stage_en="Queued for preprocessing",
        stage_ar="في قائمة انتظار المعالجة الأولية",
    )
    logger.info("transform job started job_id=%s style=%s seed=%s room=%s", job_id, style, seed, room)
    timeout_s = _transform_timeout_seconds()

    state_lock = threading.Lock()
    state: dict[str, float] = {
        "progress": 0.05,
        "last_update": time.monotonic(),
    }

    def progress_cb(progress: float, stage_en: str, stage_ar: str) -> None:
        clamped = max(0.05, min(0.98, float(progress)))
        jobs.update_progress(job_id, clamped, stage_en=stage_en, stage_ar=stage_ar)
        logger.info("job %s progress=%.2f stage=%s", job_id, clamped, stage_en)
        with state_lock:
            state["progress"] = clamped
            state["last_update"] = time.monotonic()

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(8)
            with state_lock:
                elapsed = time.monotonic() - state["last_update"]
                current = state["progress"]
            if elapsed < 12 or current >= 0.9:
                continue
            boosted = min(0.9, current + 0.02)
            jobs.update_progress(
                job_id,
                boosted,
                stage_en="Model loading or generation in progress",
                stage_ar="جارٍ تحميل النموذج أو تنفيذ التوليد",
            )
            logger.info("job %s heartbeat progress=%.2f", job_id, boosted)
            with state_lock:
                state["progress"] = boosted
                state["last_update"] = time.monotonic()

    hb_task = asyncio.create_task(heartbeat())
    try:
        out = await asyncio.wait_for(
            asyncio.to_thread(
                transform_room,
                job.input_path,
                style,
                seed=seed,
                room=room,
                progress_cb=progress_cb,
            ),
            timeout=timeout_s,
        )
        jobs.update_progress(job_id, 1.0)
        jobs.transition(
            job_id,
            JobStatus.done,
            output_path=str(out),
            stage_en="Transformation completed",
            stage_ar="اكتملت عملية التحويل",
        )
        logger.info("job %s completed -> %s", job_id, out)
    except asyncio.TimeoutError:
        jobs.transition(
            job_id,
            JobStatus.error,
            error_code=ERR_PIPELINE.code,
            error_en=(
                f"Generation timed out after {int(timeout_s)} seconds. "
                "Please retry or use light mode while models warm up."
            ),
            error_ar="انتهت مهلة التوليد. حاول مرة أخرى أو استخدم الوضع الخفيف أثناء تحميل النماذج.",
            stage_en="Timed out",
            stage_ar="انتهت المهلة",
        )
        logger.exception("job %s timed out after %.1fs", job_id, timeout_s)
    except PipelineError as e:
        jobs.transition(
            job_id, JobStatus.error,
            error_code=ERR_PIPELINE.code,
            error_en=e.message_en,
            error_ar=e.message_ar,
            stage_en="Pipeline failed",
            stage_ar="فشل خط التحويل",
        )
        logger.exception("job %s pipeline error", job_id)
    except Exception as e:  # pragma: no cover — last-resort
        jobs.transition(
            job_id, JobStatus.error,
            error_code=ERR_PIPELINE.code,
            error_en=str(e) or ERR_PIPELINE.message_en,
            error_ar=ERR_PIPELINE.message_ar,
            stage_en="Unexpected server error",
            stage_ar="خطأ غير متوقع في الخادم",
        )
        logger.exception("job %s unexpected error", job_id)
    finally:
        hb_task.cancel()
        await asyncio.gather(hb_task, return_exceptions=True)


@app.post("/transform", response_model=JobIdResponse)
async def transform_image(req: TransformRequest) -> JobIdResponse:
    if req.style not in StylePack:
        from .errors import ERR_BAD_STYLE
        _raise(ERR_BAD_STYLE)

    job = jobs.get(req.job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    if job.status not in (JobStatus.pending, JobStatus.error, JobStatus.done):
        _raise(ERR_JOB_BAD_STATE)

    logger.info("transform requested job_id=%s style=%s seed=%s room=%s", req.job_id, req.style, req.seed, req.room)
    jobs.transition(
        req.job_id,
        JobStatus.queued,
        style=req.style,
        stage_en="Job accepted",
        stage_ar="تم قبول المهمة",
    )
    asyncio.create_task(_run_transform(req.job_id, req.style, seed=req.seed, room=req.room))
    jobs.transition(
        req.job_id,
        JobStatus.running,
        stage_en="Starting transformation",
        stage_ar="بدء التحويل",
    )
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
        stage_message_en=job.stage_message_en,
        stage_message_ar=job.stage_message_ar,
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
    seed = req.seed if req else None
    room = req.room if req else None

    jobs.transition(
        job_id,
        JobStatus.queued,
        style=style,
        error_code=None,
        error_en=None,
        error_ar=None,
        stage_en="Retry queued",
        stage_ar="تمت إعادة وضع المهمة في الانتظار",
    )
    asyncio.create_task(_run_transform(job_id, style, seed=seed, room=room))
    jobs.transition(
        job_id,
        JobStatus.running,
        stage_en="Retry in progress",
        stage_ar="جارٍ إعادة المحاولة",
    )
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
