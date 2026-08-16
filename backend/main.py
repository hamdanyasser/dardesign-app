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
GET  /api/admin/evaluation          evaluation dashboard: rating aggregates +
                                    generation stats + automatic metrics
                                    (admin-only; see backend/evaluation.py)
GET  /api/subscription              the caller's plan + weekly allowance
POST /api/subscription/request      ask an admin for Pro (grants nothing itself)
POST /api/subscription/cancel       back to Basic, immediately
POST /api/usage/consume             spend one generation, or 429 when the free
                                    weekly allowance is gone
GET  /api/admin/subscriptions       the upgrade queue (admin-only)
POST /api/admin/subscriptions/{id}/decision
                                    approve (30 days of Pro) or decline, and
                                    email the user the verdict (backend/mailer.py)
GET  /api/admin/users               every account and its plan (admin-only)
POST /api/color/{preview,apply,undo,reset}
                                    Colour Control — recolour the wall or floor
                                    of a finished render inside its segmentation
                                    mask (see backend/recolor_api.py)
POST /api/design/plan               Design Planner — an LLM picks catalogue
                                    pieces and where they stand, for an empty
                                    room the user describes. Falls back to
                                    placement rules when no model is configured
                                    (see backend/design_planner.py)

CORS is permissive in dev; tighten via $DARDESIGN_ALLOWED_ORIGINS in prod.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    BackgroundTasks,
    Cookie,
    FastAPI,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .audit import log_event, read_events
from .auth import (
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    cookie_params,
    hash_password,
    make_session,
    read_session,
    verify_password,
)
from .compositing import CompositingError, composite_item
from .errors import (
    ERR_ALREADY_SUBSCRIBED,
    ERR_BAD_CREDENTIALS,
    ERR_BAD_CULTURE,
    ERR_BAD_FURNITURE_ID,
    ERR_BAD_IMAGE_DATA,
    ERR_BAD_ROOM,
    ERR_BAD_SHARE_TOKEN,
    ERR_BAD_STYLE,
    ERR_CATALOGUE_UNAVAILABLE,
    ERR_COMPOSITING_FAILED,
    ERR_EMAIL_TAKEN,
    ERR_FEEDBACK_INVALID,
    ERR_FORBIDDEN,
    ERR_HISTORY_NOT_FOUND,
    ERR_INVALID_EMAIL,
    ERR_INVALID_PLACEMENT,
    ERR_MISSING_NAME,
    ERR_NOT_AUTHENTICATED,
    ERR_NOT_SUBSCRIBED,
    ERR_QUOTA_EXCEEDED,
    ERR_REQUEST_NOT_PENDING,
    ERR_SUBSCRIPTION_PENDING,
    ERR_WEAK_PASSWORD,
    ERR_FILE_TOO_LARGE,
    ERR_JOB_BAD_STATE,
    ERR_JOB_NOT_FOUND,
    ERR_NOT_AN_IMAGE,
    ERR_OUTPUT_MISSING,
    ERR_PIPELINE,
    ApiError,
)
from .placement import (
    NO_SPACE_AR,
    NO_SPACE_EN,
    Box as PlacementBox,
    box_to_image_space,
    box_to_mask_space,
    candidate_positions,
    validate_placement,
)
from .room_analysis import (
    analyze_room,
    cache_analysis as cache_room_analysis,
    get_analysis as get_room_analysis,
    mark_occupied as mark_room_occupied,
)
from .furniture import (
    CatalogueError as FurnitureCatalogueError,
    all_items as furniture_all_items,
    get_item as furniture_get_item,
    items_for_culture as furniture_items_for_culture,
    max_results as furniture_max_results,
    recommend as furniture_recommend,
)
from .design_planner import (
    is_configured as planner_is_configured,
    model_name as planner_model_name,
    plan as planner_plan,
    provider as planner_provider,
)
from .guardrails import (
    clamp_params,
    sanitize_prompt_fragment,
    validate_style as guard_validate_style,
    validate_upload as guard_validate_upload,
)
from .jobs import JobStatus, jobs
from .quality import clip_cultures, lpips_paths, metrics_available, ssim_paths
from .projection import (
    project_top_down,
    seg_bounding_boxes,
    to_room_map_payload,
    to_seg_regions_payload,
)
from .recolor_api import clear_undo as clear_color_undo, router as color_router
from .evaluation import (
    automatic_metrics as eval_automatic_metrics,
    coverage_report as eval_coverage_report,
    generation_report as eval_generation_report,
    overall_rating as eval_overall_rating,
)
from . import mailer, subscriptions
from .share import decode as share_decode, encode as share_encode
from .transform import (
    CONFIG,
    CORE_STYLES,
    PipelineError,
    StylePack,
    compute_depth_seg,
    fit_size,
    _depth_only_mode as depth_only_mode,
    provenance as pipeline_provenance,
    render_scene,
    transform_room,
)
from .ttl_cleanup import PRIVACY_NOTICE, start_background_sweeper
from .validators import ValidationFailure, validate_upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("dardesign.api")

ROOT = Path(__file__).resolve().parent.parent
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
    db.connect()
    stop_sweeper = start_background_sweeper([UPLOAD_DIR], ttl_hours=24, interval_min=60)
    logger.info("24h TTL sweeper running on %s — %s", UPLOAD_DIR, PRIVACY_NOTICE)
    # Daily: any Pro plan past its 30 days goes back to Basic. Sweeps once now,
    # so a backend that was down over an expiry date catches up on boot.
    stop_expiry = subscriptions.start_expiry_service()
    try:
        yield
    finally:
        stop_sweeper()
        stop_expiry()


app = FastAPI(title="DarDesign API", version="0.3.0", lifespan=lifespan)
# Browsers refuse to send cookies to a wildcard origin, and the Colab notebook
# sets DARDESIGN_ALLOWED_ORIGINS="*". allow_origin_regex echoes the caller's
# origin instead, which is credential-safe — without this, login appears to
# succeed and then every following request arrives anonymous.
if ALLOWED_ORIGINS == ["*"]:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Saved designs: images/old holds the room as uploaded, images/new the final
# edited render. Served statically so History can show them by URL.
IMAGES_DIR = ROOT / "images"
(IMAGES_DIR / "old").mkdir(parents=True, exist_ok=True)
(IMAGES_DIR / "new").mkdir(parents=True, exist_ok=True)
app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")

# Colour Control (wall/floor recolouring). Self-contained in recolor_api.py —
# this line and that file are the whole feature.
app.include_router(color_router)


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
    # Null when that culture wasn't requested. Optional rather than required
    # because /redesign now accepts a style subset; asking for one style is ~3x
    # faster and returns only that one.
    lebanese: str | None = None
    khaleeji: str | None = None
    moroccan: str | None = None
    # Which styles this response actually carries, so the client renders exactly
    # what exists instead of inferring it from which fields happen to be null.
    styles: list[str] = []
    object_map: dict | None = None
    seg_regions: dict | None = None
    depth_map: str | None = None
    # Furniture placement: the small JSON summary only (free-floor ratio and area,
    # existing categories, candidate spots). The masks themselves stay server-side
    # in the room-analysis cache — they are megabytes of boolean arrays that only
    # the placement engine needs. Null when the depth/seg pass or the analysis fails.
    room_analysis: dict | None = None
    # Needed by the placement endpoints, which look the cached analysis up by job.
    job_id: str | None = None
    # Server-measured generation time. Passed back so the client can record it
    # against the durable database on the machine that owns the data — the
    # rendering box is disposable and its audit log dies with the session.
    duration_s: float | None = None
    # Structure preservation per style (0..1, higher = the room survived the
    # restyle). Same measure and working size as the offline evaluation suite,
    # so a live figure is comparable with the corpus. Absent if it fails.
    ssim: dict[str, float] | None = None
    # True in DARDESIGN_LIGHT: images are tinted stand-ins, not real renders.
    placeholder: bool | None = None
    # What this host actually did: base model, the per-style LoRA (or null when
    # the file is genuinely absent), the fused scale, and the ControlNet weights
    # sweep_winners.json resolved to. Read from the same config the generator
    # obeys — see transform.provenance(). Before this existed the client could
    # not prove any of it, which is why "Inside DAR" had to label its pipeline
    # chapter CONCEPTUAL ARCHITECTURE and RoomReport's footer hardcoded a claim.
    provenance: dict | None = None
    privacy_notice: str = PRIVACY_NOTICE


class CandidatePositionsRequest(BaseModel):
    job_id: str
    furniture_id: str
    limit: int = 3


class ValidatePositionRequest(BaseModel):
    job_id: str
    furniture_id: str
    x: float
    y: float
    width: float
    height: float


class ConfirmPlacementRequest(BaseModel):
    job_id: str
    furniture_id: str
    style: str
    x: float
    y: float
    width: float
    height: float


class RenderSceneResponse(BaseModel):
    """Build Mode's scene, rendered from its own depth + segmentation.

    A pydantic model rather than a raw dict because `_stream_keepalive` calls
    `model_dump_json()` on whatever the build coroutine returns — the same
    contract `/redesign` and `/restyle` already satisfy. The JSON on the wire is
    unchanged from the JSONResponse this replaced.
    """

    job_id: str
    style: str
    image: str
    duration_s: float
    placeholder: bool
    # What this host actually did — same dict /redesign returns. Without it the
    # panel could name no model, no LoRA and no ControlNet weights for a render
    # whose whole claim is that it conditioned on the user's own scene.
    provenance: dict | None = None
    # False when DARDESIGN_DEPTH_ONLY dropped the segmentation ControlNet. That
    # is the documented Colab/Kaggle T4 setting, so it may well be live — and
    # the panel displays the ADE20K map as "Segments · identity" evidence, so
    # without this flag it would be claiming a control image that never
    # reached the model.
    dual_controlnet: bool = True


class RestyleResponse(BaseModel):
    """Style Intensity Slider: one culture re-rendered at a chosen LoRA scale."""

    image: str
    style: str
    scale: float
    manifest: dict | None = None  # provenance sidecar (model, LoRA, seed, sha256)
    privacy_notice: str = PRIVACY_NOTICE


# ---------- endpoints ----------


@app.get("/api/provenance")
async def provenance_endpoint(styles: str | None = None) -> dict:
    """What this host WILL do, answerable before any generation runs.

    The same dict /redesign returns after a render, served on its own so the
    client can know it up front. That matters for one screen in particular:
    "Inside DAR" plays during the ~2 minute wait, and its pipeline chapter had
    to caption itself CONCEPTUAL ARCHITECTURE because nothing about the run was
    knowable yet. But the model, the per-culture LoRA and the ControlNet
    weights are CONFIGURATION, not results — they are decided before the first
    step and can be stated honestly while the user waits.

    Cheap: reads config and the filesystem, touches no GPU and takes no lock.
    """
    requested = [s.strip() for s in (styles or "").split(",") if s.strip()]
    return pipeline_provenance(requested or list(CORE_STYLES))


@app.get("/healthz")
async def healthz() -> dict:
    return {
        "ok": True,
        "version": app.version,
        "light_mode": _light_mode(),
        # False means this process signs sessions with an ephemeral key, so every
        # restart silently logs everyone out (see auth._secret). It is reported
        # here because the symptom appears hours later and nowhere near the
        # cause: the backend answers perfectly, the app looks healthy, and the
        # user is simply signed out again with no error to read. A launcher that
        # only checks `ok` would call such a backend fine and be wrong.
        "stable_sessions": bool(os.environ.get("DARDESIGN_SECRET")),
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


# The cached diffusers pipeline (and its LoRA fuse state) is NOT safe under
# concurrent generations — a second request arriving mid-hot-swap corrupts the
# accelerate offload hooks ('_hf_hook' AttributeError on the T4). One render
# at a time, across /redesign, /restyle, and the legacy /transform flow.
_GEN_LOCK = asyncio.Lock()

_KEEPALIVE_SECS = 10.0


def _stream_keepalive(build_coro) -> StreamingResponse:
    """Run `build_coro` while streaming whitespace heartbeats, then the JSON.

    Cloudflare's free quick tunnel (and most proxies) 524 any request that
    waits >~100s for its first response byte — a real /redesign takes minutes
    on the T4. Leading whitespace is a valid JSON prefix, so `res.json()` on
    the client parses unchanged. Errors raised after streaming starts can't
    change the (already sent) 200 status, so they surface in-band as an
    ApiError-shaped `detail` body; the client's response-shape validation
    turns that into a typed bilingual failure.
    """

    async def gen():
        task = asyncio.ensure_future(build_coro)
        while True:
            done, _ = await asyncio.wait({task}, timeout=_KEEPALIVE_SECS)
            if done:
                break
            yield b" "
        try:
            payload = task.result()
            body = (
                payload.model_dump_json()  # pydantic v2
                if hasattr(payload, "model_dump_json")
                else payload.json()  # pydantic v1
            )
        except HTTPException as e:
            body = json.dumps({"detail": e.detail})
        except Exception:
            logger.exception("streamed endpoint failed")
            body = json.dumps({"detail": ERR_PIPELINE.payload()})
        yield body.encode("utf-8")

    return StreamingResponse(gen(), media_type="application/json")


@app.post("/redesign")
async def redesign(file: UploadFile, styles: str | None = Form(default=None)) -> StreamingResponse:
    """Synchronous one-shot: original + the requested styles + the 2D object map.

    `styles` is an optional comma-separated subset ("lebanese" or
    "lebanese,moroccan"). It defaults to all three, so the shipped contract and
    the demo's "one compute serves all three cultures" story are unchanged unless
    a caller explicitly asks for less.

    Requesting one style is roughly 3x faster, because generation dominates: the
    depth+seg pass and the room analysis run once regardless of how many styles
    follow. That makes the iterate-and-retest loop practical without changing the
    default anyone else relies on.

    Responds as a keepalive stream (see _stream_keepalive) so free tunnels
    don't time the request out; upload validation still 4xxes before the
    stream starts.
    """
    requested = _parse_styles(styles)
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

    async def _build() -> RedesignResponse:
        images: dict[str, str] = {}
        last_out: Path | None = None
        started = time.monotonic()
        try:
            # CORE_STYLES only — persian (prompt-only 4th culture) is /restyle-only
            # so the flagship /redesign keeps its ~1-2 min demo timing.
            # Seed derives from the job id so every render is reproducible and the
            # provenance manifest records a real seed instead of null.
            seed = int(job.id[:8], 16)
            async with _GEN_LOCK:
                for i, style in enumerate(requested):
                    last_out = await asyncio.to_thread(
                        transform_room, str(input_path), style, seed=seed
                    )
                    images[style] = _png_data_url(last_out)
                    # Remember where each style's render lives: furniture
                    # placement edits one specific style's image, and
                    # output_path only survives for the last one rendered.
                    job.style_outputs[style] = str(last_out)
                    jobs.update_progress(job.id, (i + 1) / (len(requested) + 1))
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

        # Structure preservation, per style: did the room survive the restyle?
        # Milliseconds on CPU, computed outside the generation lock, and
        # ssim_paths never raises — a metric must not cost a finished render.
        ssim_scores: dict[str, float] = {}
        for style, path in (job.style_outputs or {}).items():
            value = await asyncio.to_thread(ssim_paths, str(input_path), path)
            if value is not None:
                ssim_scores[style] = value

        # WIRING §1 — depth + raw ADE20K seg → top-down object map, on-image
        # highlighter regions, and the DepthOrbit depth PNG. One compute serves
        # all three. Best-effort: a failure here must never cost the user their
        # three designs.
        object_map: dict | None = None
        seg_regions: dict | None = None
        depth_map: str | None = None
        room_analysis: dict | None = None
        try:
            depth, seg_ids = await asyncio.to_thread(compute_depth_seg, input_path)

            # Furniture placement: derive the floor/occupied/protected masks and
            # candidate spots from this same pass and cache them against the job.
            # They can only be built here — recomputing later would mean re-running
            # the depth+seg models on a GPU, and the placement UI re-validates on
            # every drag. ~0.35 s at 1024x1024, against a 1-2 min generation.
            # Isolated in its own try: this is an enhancement, and it must never
            # cost the user the object map or the depth PNG below it.
            try:
                analysis = analyze_room(depth, seg_ids)
                cache_room_analysis(job.id, analysis)
                room_analysis = analysis.summary()
            except Exception:
                logger.exception("room analysis failed for job %s — placement disabled", job.id)

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
                if room_analysis is not None:
                    room_analysis["placeholder"] = True
        except Exception:
            logger.exception("depth/seg pass failed for job %s — images only", job.id)

        jobs.transition(job.id, JobStatus.done, output_path=str(last_out) if last_out else None)
        jobs.update_progress(job.id, 1.0)
        duration_s = round(time.monotonic() - started, 2)
        log_event(
            "redesign", job_id=job.id, ok=True, styles=list(requested),
            duration_s=duration_s, light=_light_mode(),
            object_map=object_map is not None, seg_regions=seg_regions is not None,
        )
        return RedesignResponse(
            original=original,
            styles=requested,
            object_map=object_map,
            seg_regions=seg_regions,
            depth_map=depth_map,
            room_analysis=room_analysis,
            job_id=job.id,
            duration_s=duration_s,
            ssim=ssim_scores or None,
            placeholder=True if _light_mode() else None,
            provenance=pipeline_provenance(list(requested)),
            **images,
        )

    return _stream_keepalive(_build())


@app.post("/restyle")
async def restyle(
    file: UploadFile,
    style: str = Form(...),
    scale: float = Form(0.8),
) -> StreamingResponse:
    """Style Intensity Slider — re-render ONE culture at a given LoRA `scale`
    (0.0 ≈ generic SDXL, 1.0 ≈ full culture). This is the ablation made live:
    the examiner drags a slider and watches the tradition emerge from the latent
    space. Instant in DARDESIGN_LIGHT (placeholder ignores scale).

    Streams keepalives like /redesign — one T4 render can exceed a free
    tunnel's ~100s first-byte window, especially queued behind a /redesign."""
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

    async def _build() -> RestyleResponse:
        started = time.monotonic()
        try:
            # Job-derived seed: reproducible render + a real seed in the manifest.
            async with _GEN_LOCK:
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
                manifest = json.loads(mpath.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("failed to read provenance manifest for restyle job %s", job.id)

        jobs.transition(job.id, JobStatus.done, output_path=str(out))
        log_event(
            "restyle", job_id=job.id, style=style, scale=scale, ok=True,
            duration_s=round(time.monotonic() - started, 2), light=_light_mode(),
        )
        return RestyleResponse(image=_png_data_url(out), style=style, scale=scale, manifest=manifest)

    return _stream_keepalive(_build())


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
        async with _GEN_LOCK:
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


# ---------- accounts + saved designs ----------


class RegisterRequest(BaseModel):
    fullName: str
    phoneNumber: str | None = None
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


# A Build Mode scene is a few KB — 27 catalogue items and a few dozen
# placements, all plain numbers. 256 KB is two orders of magnitude of headroom
# and still bounds what one row can put into every subsequent listing.
MAX_SCENE_CHARS = 256_000


class SiblingImage(BaseModel):
    """One of the other cultures produced by the same generation."""

    culture: str
    image: str


class SaveHistoryRequest(BaseModel):
    """Both images as data URLs.

    The client sends the pixels rather than a job id on purpose: the design it
    wants saved is whatever is on screen *after* any furniture placements, and
    it holds that already. Referencing server state would also break after a
    backend restart, which is exactly when someone wants to save.
    """

    oldImage: str
    newImage: str
    # How this design was generated. Recorded on the history row so anything that
    # later rates the image reads the culture from the database rather than
    # believing whatever the rating form claims.
    culture: str | None = None
    intensity: float | None = None
    # Seconds the generation took, as measured by the rendering backend between
    # the start and end of the run and returned on the /redesign response. Stored
    # here because history is the durable record: the rendering box is disposable
    # and its own logs die with the session.
    duration: float | None = None
    # Structure preservation for this design (0..1), from the /redesign response.
    ssim: float | None = None
    # True when colour control or furniture placement changed the render before
    # saving. Still a real design; just no longer the pipeline's own output, so
    # it is left out of the evaluation metrics.
    edited: bool = False
    # The Build Mode scene this render was composed from, as a JSON string, so
    # the design can be REOPENED and edited rather than only viewed. Sent as a
    # string rather than a parsed object on purpose: the backend stores it
    # verbatim and never interprets it, so parsing here would only create a
    # second definition of the scene format to keep in step with types.ts.
    # Absent for a Studio design — that is a render of a photograph, not a
    # scene, and there is nothing to reopen.
    scene: str | None = None
    sceneVersion: int | None = None
    # True when /redesign answered `placeholder: true` — a DARDESIGN_LIGHT tint,
    # not a render. Reported by the client rather than read from this process's
    # own env because the renderer and the accounts backend can be different
    # hosts: this one may have no GPU and no idea the other was in LIGHT mode.
    # Same trust model as `duration` and `edited`, and the cost of a wrong value
    # is a dashboard row, never a permission.
    light: bool = False
    # The OTHER cultures rendered in the same run, as {culture, image} data URLs.
    # A three-culture generation makes three images of one room and only the
    # featured one used to be kept; these are the rest, stored so the design can
    # be shown as the comparison it was generated to be.
    #
    # They are companions to this design, not designs: nothing here is measured,
    # rated, or counted as a generation. `culture`/`ssim`/`duration` above still
    # describe `newImage` alone.
    siblings: list[SiblingImage] = Field(default_factory=list)


def _current_user(session: str | None):
    """The logged-in user, or None. Never raises — callers decide if auth is required."""
    uid = read_session(session)
    return db.get_user(uid) if uid is not None else None


def _require_user(session: str | None):
    user = _current_user(session)
    if user is None:
        _raise(ERR_NOT_AUTHENTICATED)
    return user


def _with_session_cookie(response: JSONResponse, request: Request, user_id: int) -> JSONResponse:
    """Attach the session cookie to the response we actually return.

    It must be set on this object, not on an injected `Response` parameter:
    FastAPI only merges that one's headers when the handler returns a plain
    value. Returning a JSONResponse silently discards it, which looks exactly
    like a successful login that leaves the user signed out.

    Behind the Cloudflare tunnel the app sees http internally while the browser
    sees https, so trust the forwarded scheme — otherwise the cookie goes out
    without Secure and the browser drops it on a cross-site request.
    """
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    is_https = (forwarded or request.url.scheme) == "https"
    response.set_cookie(
        SESSION_COOKIE,
        make_session(user_id),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,  # not readable from JS, so XSS can't lift the session
        path="/",
        **cookie_params(is_https),
    )
    return response


def _save_data_url(data_url: str, folder: str) -> str:
    """Write a base64 data URL under images/<folder>/ and return its public path."""
    if not data_url.startswith("data:image"):
        _raise(ERR_BAD_IMAGE_DATA)
    try:
        _, _, b64 = data_url.partition(",")
        raw = base64.b64decode(b64, validate=True)
    except Exception:  # noqa: BLE001
        _raise(ERR_BAD_IMAGE_DATA)
    if not raw:
        _raise(ERR_BAD_IMAGE_DATA)
    name = f"{uuid.uuid4().hex}.png"
    (IMAGES_DIR / folder).mkdir(parents=True, exist_ok=True)
    (IMAGES_DIR / folder / name).write_bytes(raw)
    return f"images/{folder}/{name}"


@app.post("/api/auth/register")
async def auth_register(req: RegisterRequest, request: Request) -> JSONResponse:
    """Create an account and sign in immediately.

    The first account created becomes Admin — otherwise a fresh install has no
    way to reach an admin-only surface. Everyone after that is a User.
    """
    email = (req.email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        _raise(ERR_INVALID_EMAIL)
    if len((req.password or "")) < 6:
        _raise(ERR_WEAK_PASSWORD)
    if not (req.fullName or "").strip():
        _raise(ERR_MISSING_NAME)

    role = db.ROLE_ADMIN if db.user_count() == 0 else db.ROLE_USER
    try:
        uid = db.create_user(req.fullName, req.phoneNumber, email, hash_password(req.password), role)
    except db.EmailTaken:
        _raise(ERR_EMAIL_TAKEN)

    return _with_session_cookie(JSONResponse(db.public_user(db.get_user(uid))), request, uid)


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest, request: Request) -> JSONResponse:
    row = db.get_user_by_email((req.email or "").strip().lower())
    # One message for both "no such email" and "wrong password", so the endpoint
    # can't be used to discover which addresses have accounts.
    if row is None or not verify_password(req.password or "", row["Password"]):
        _raise(ERR_BAD_CREDENTIALS)
    return _with_session_cookie(JSONResponse(db.public_user(row)), request, row["Id"])


@app.post("/api/auth/logout")
async def auth_logout() -> JSONResponse:
    # Same reasoning as above: clear the cookie on the returned response.
    out = JSONResponse({"ok": True})
    out.delete_cookie(SESSION_COOKIE, path="/")
    return out


@app.get("/api/auth/me")
async def auth_me(session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> JSONResponse:
    """Who am I? 200 with null when signed out, so the client can boot without
    treating "not logged in" as an error."""
    user = _current_user(session)
    return JSONResponse(db.public_user(user) if user is not None else None)


def _evaluate_saved_design(entry_id: int, old_url: str, new_url: str) -> None:
    """Measure LPIPS and CLIP for one saved design, in the background.

    Runs after the response so saving stays instant: the two models take a few
    seconds on CPU, and the first call also downloads their weights. Every
    failure is swallowed — the value stays null and the backfill script can pick
    it up later, which is strictly better than a save that fails because a metric
    could not be computed.

    SSIM is not recomputed here: it is measured at generation time against the
    render before any edit, which is the more faithful number.
    """
    if not metrics_available():
        logger.info(
            "[eval] lpips/open_clip not installed — design %s left unmeasured; "
            "run scripts/backfill_evaluation.py after installing them", entry_id,
        )
        return
    try:
        row = db.get_history_entry(entry_id)
        if row is None:      # deleted between saving and measuring
            return
        original, generated = str(ROOT / old_url), str(ROOT / new_url)

        scores = clip_cultures(generated)
        predicted = scores[1] if scores else None
        # The CLIP score is similarity to *this design's own* culture prompt —
        # "does it look Lebanese?" — not to whichever culture scored highest.
        culture = row["Culture"]
        clip_score = scores[0].get(culture) if (scores and culture) else None

        db.set_history_evaluation(
            entry_id,
            lpips=lpips_paths(original, generated),
            clip_score=clip_score,
            predicted_culture=predicted,
        )
        logger.info("[eval] design %s measured (predicted=%s)", entry_id, predicted)
    except Exception:  # noqa: BLE001
        logger.exception("[eval] measuring design %s failed", entry_id)


@app.post("/api/history")
async def history_save(
    req: SaveHistoryRequest,
    background: BackgroundTasks,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Save the current design. Nothing is stored until this is called.

    An unedited design is queued for evaluation on the way out, so every saved
    generation joins the metrics without a separate corpus or any copying.
    """
    user = _require_user(session)
    old_url = _save_data_url(req.oldImage, "old")
    new_url = _save_data_url(req.newImage, "new")
    # An unknown culture is stored as NULL rather than guessed at: a wrong label
    # would quietly poison the per-culture feedback averages.
    culture = req.culture if req.culture in StylePack else None
    intensity = (
        max(0.0, min(1.0, float(req.intensity))) if req.intensity is not None else None
    )
    # Clamped: this figure is averaged onto a dashboard, so a negative or absurd
    # value must not be able to reach it.
    duration = (
        max(0.0, min(float(req.duration), 86_400.0)) if req.duration is not None else None
    )
    ssim = max(0.0, min(float(req.ssim), 1.0)) if req.ssim is not None else None
    # Bounded before it reaches the database. A scene is a few KB in practice
    # (27 catalogue items, a few dozen placements), so a payload orders of
    # magnitude past that is a bug or an attack, not a room — and history rows
    # are read back on every listing. Refused rather than truncated: half a
    # scene would parse into a room missing furniture, which is worse than no
    # scene at all.
    scene_json = req.scene
    if scene_json is not None and len(scene_json) > MAX_SCENE_CHARS:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "scene_too_large",
                "message_en": "That design is too large to save.",
                "message_ar": "هذا التصميم أكبر من أن يُحفظ.",
            },
        )
    # The other cultures from the same run. Bounded by the catalogue itself
    # (StylePack), and each culture kept once: the storage cost is real image
    # files, so a client cannot make one save write an unbounded number of them.
    # An unknown or repeated culture is dropped rather than stored under a label
    # the rest of the app would then have to guess at.
    siblings: list[dict] = []
    seen: set[str] = set()
    for s in req.siblings[: len(StylePack)]:
        if s.culture not in StylePack or s.culture == culture or s.culture in seen:
            continue
        seen.add(s.culture)
        siblings.append({"culture": s.culture, "url": _save_data_url(s.image, "new")})

    entry_id = db.add_history(
        user["Id"], old_url, new_url, culture=culture, intensity=intensity,
        duration=duration, ssim=ssim, is_edited=bool(req.edited),
        is_light=bool(req.light),
        scene_json=scene_json, scene_version=req.sceneVersion,
        sibling_images=json.dumps(siblings) if siblings else None,
    )
    # Only the pipeline's own output is evaluated: a recoloured or furnished
    # render would score the edit, not the generation, and a LIGHT placeholder
    # would have LPIPS and CLIP measured against a tint.
    if not req.edited and not req.light:
        background.add_task(_evaluate_saved_design, entry_id, old_url, new_url)
    log_event("history_save", user_id=user["Id"], entry_id=entry_id, culture=culture, ok=True)
    return JSONResponse({
        "id": entry_id,
        "oldImageUrl": old_url,
        "newImageUrl": new_url,
        "isSuggested": False,
        "culture": culture,
        "intensity": intensity,
        "duration": duration,
        "ssim": ssim,
        "isEdited": bool(req.edited),
        "isLight": bool(req.light),
        "siblings": siblings,
    })


@app.get("/api/history")
async def history_list(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """The signed-in user's saved designs. Scoped by UserId in the query, so one
    account can never see another's."""
    user = _require_user(session)
    return JSONResponse(db.list_history(user["Id"]))


@app.get("/api/history/{entry_id}/scene")
async def history_scene(
    entry_id: int,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """The Build Mode scene behind one saved design, for reopening it.

    Separate from the listing on purpose: a scene is a few KB and a listing is
    up to 100 rows, so folding it in would make every page load carry megabytes
    to serve a button most rows never press.

    Scoped by UserId inside the query (see db.get_history_scene), so this cannot
    return another account's room. A design saved from Studio has no scene and
    answers 404 — the listing already says `hasScene: false`, so the button is
    not offered and this is the belt to that braces.
    """
    user = _require_user(session)
    found = db.get_history_scene(entry_id, user["Id"])
    if not found:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "no_scene",
                "message_en": "This design has no editable scene.",
                "message_ar": "لا يوجد مشهد قابل للتحرير لهذا التصميم.",
            },
        )
    # The JSON is returned as the string it was stored as. The backend never
    # parses a scene — types.ts is the single definition of that shape, and a
    # second one here would be a copy to keep in step.
    return JSONResponse({"scene": found["scene"], "sceneVersion": found["version"]})


class SuggestRequest(BaseModel):
    isSuggested: bool = True


@app.patch("/api/history/{entry_id}/suggest")
async def history_set_suggested(
    entry_id: int,
    req: SuggestRequest,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Share one of your designs to the public gallery, or take it back.

    Owner-only: sharing someone else's work isn't theirs to do. A design that
    isn't yours returns the same 404 as one that doesn't exist.
    """
    user = _require_user(session)
    if not db.set_suggested(entry_id, user["Id"], req.isSuggested):
        _raise(ERR_JOB_NOT_FOUND, detail_en="History entry not found.")
    return JSONResponse({"id": entry_id, "isSuggested": req.isSuggested})


@app.get("/api/history/suggested")
async def history_suggested(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Other people's shared designs.

    Excludes the viewer's own work — the point of the gallery is seeing what
    others made. Only IsSuggested rows are returned, so nothing private surfaces.
    """
    user = _require_user(session)
    return JSONResponse(db.list_suggested(exclude_user_id=user["Id"]))


@app.delete("/api/history/{entry_id}")
async def history_delete(
    entry_id: int,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    user = _require_user(session)
    if not db.delete_history(entry_id, user["Id"]):
        # Same 404 whether it doesn't exist or belongs to someone else — the
        # difference would leak that an id is in use.
        _raise(ERR_JOB_NOT_FOUND, detail_en="History entry not found.")
    return JSONResponse({"ok": True})


# ---------- feedback on a generated design ----------


class FeedbackRequest(BaseModel):
    """What the rating form sends.

    Note what is NOT here: user id, culture, intensity, and any claim of
    ownership. All four are read server-side — the user from the session cookie,
    the rest from the history row — because a form that can name its own author
    or relabel a design's culture is a form that can forge feedback.
    """

    historyId: int
    culturalAccuracy: int
    imageQuality: int
    roomPreservation: int
    furniturePlacement: str
    comment: str | None = None


def _owned_history_or_404(entry_id: int, user_id: int):
    """The user's own design, or 404.

    Someone else's design and a nonexistent id give the identical answer, the
    same way /api/history/{id} already behaves: distinguishing them would let an
    id be probed for existence.
    """
    row = db.get_history_entry(entry_id)
    if row is None or row["UserId"] != user_id:
        _raise(ERR_HISTORY_NOT_FOUND)
    return row


def _clean_feedback(req: FeedbackRequest) -> dict:
    """Validate and normalise. Raises 400 with a specific reason, in both languages."""
    ratings = {
        "culturalAccuracy": req.culturalAccuracy,
        "imageQuality": req.imageQuality,
        "roomPreservation": req.roomPreservation,
    }
    for field, value in ratings.items():
        # bool is an int subclass in Python, and True would sail through a
        # 1..5 range check as 1.
        if isinstance(value, bool) or not isinstance(value, int):
            _raise(ERR_FEEDBACK_INVALID, detail_en=f"{field} must be a whole number from 1 to 5.")
        if not db.RATING_MIN <= value <= db.RATING_MAX:
            _raise(
                ERR_FEEDBACK_INVALID,
                detail_en=f"{field} must be between {db.RATING_MIN} and {db.RATING_MAX}.",
                detail_ar=f"يجب أن تكون قيمة {field} بين {db.RATING_MIN} و {db.RATING_MAX}.",
            )

    if req.furniturePlacement not in db.FURNITURE_PLACEMENT_VALUES:
        _raise(
            ERR_FEEDBACK_INVALID,
            detail_en="furniturePlacement must be one of: "
                      + ", ".join(db.FURNITURE_PLACEMENT_VALUES) + ".",
            detail_ar="قيمة توزيع الأثاث غير صالحة.",
        )

    # A comment of spaces is not a comment. Store NULL so "has a comment" stays a
    # question the data can answer.
    comment = (req.comment or "").strip() or None
    if comment is not None and len(comment) > db.COMMENT_MAX_LEN:
        _raise(
            ERR_FEEDBACK_INVALID,
            detail_en=f"Comment must be {db.COMMENT_MAX_LEN} characters or fewer.",
            detail_ar=f"يجب ألا يتجاوز التعليق {db.COMMENT_MAX_LEN} حرفاً.",
        )

    return {**ratings, "furniturePlacement": req.furniturePlacement, "comment": comment}


@app.post("/api/feedback")
async def feedback_submit(
    req: FeedbackRequest,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Rate one of your own generated designs, or revise your earlier rating.

    One record per design: submitting again edits what is there rather than
    adding a second opinion, so the admin averages count each design once.
    """
    user = _require_user(session)
    entry = _owned_history_or_404(req.historyId, user["Id"])
    clean = _clean_feedback(req)

    existing = db.get_feedback_for_history(req.historyId)
    saved = db.upsert_feedback(
        history_id=req.historyId,
        user_id=user["Id"],
        # Straight off the design record — the request has no say in either.
        culture=entry["Culture"],
        intensity=entry["Intensity"],
        cultural_accuracy=clean["culturalAccuracy"],
        image_quality=clean["imageQuality"],
        room_preservation=clean["roomPreservation"],
        furniture_placement=clean["furniturePlacement"],
        comment=clean["comment"],
    )
    log_event(
        "feedback", user_id=user["Id"], history_id=req.historyId,
        culture=entry["Culture"], updated=existing is not None, ok=True,
    )
    return JSONResponse({**saved, "updated": existing is not None})


@app.get("/api/feedback/{history_id}")
async def feedback_get(
    history_id: int,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """This user's feedback for one design, or null. Powers the "reopen from
    history and see what you said" case, and prefills the form for editing."""
    user = _require_user(session)
    _owned_history_or_404(history_id, user["Id"])
    row = db.get_feedback_for_history(history_id)
    return JSONResponse(db.public_feedback(row) if row is not None else None)


# ---------- plans, the weekly allowance, and upgrade requests ----------
#
# Policy (price, 30 days, 3 free designs a week) lives in backend/subscriptions.py.
# Note what no endpoint below does: set IsSubscribed on behalf of the person
# asking. Subscribing goes through an admin; only cancelling is the user's own.


@app.get("/api/subscription")
async def subscription_state(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """The signed-in user's plan, remaining allowance, and pending request."""
    user = _require_user(session)
    return JSONResponse(subscriptions.state(user["Id"]))


@app.post("/api/subscription/request")
async def subscription_request(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Ask an admin to put this account on Pro.

    Deliberately does not grant anything: it queues a request, and the plan only
    changes when an admin approves it on /admin/subscriptions.
    """
    user = _require_user(session)
    if user["IsSubscribed"]:
        _raise(ERR_ALREADY_SUBSCRIBED)
    try:
        request_id = db.create_subscription_request(user["Id"])
    except db.PendingRequestExists:
        # Lost the race against the user's own second click. The outcome they
        # wanted is already true, so this is a 409, not a failure to record.
        _raise(ERR_SUBSCRIPTION_PENDING)
    log_event("subscription_request", user_id=user["Id"], request_id=request_id, ok=True)
    # The whole state back, not just an ok: the page needs the pending request it
    # must now show, and one response beats a request followed by a refetch.
    return JSONResponse(subscriptions.state(user["Id"]))


@app.post("/api/subscription/cancel")
async def subscription_cancel(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Leave Pro and go back to Basic, immediately.

    No approval needed — an admin gates who *gains* a paid plan, not who gives
    one up. From here the weekly limit of 3 applies again on the next generation.
    """
    user = _require_user(session)
    if not db.end_subscription(user["Id"]):
        _raise(ERR_NOT_SUBSCRIBED)
    log_event("subscription_cancel", user_id=user["Id"], ok=True)
    return JSONResponse(subscriptions.state(user["Id"]))


@app.post("/api/usage/consume")
async def usage_consume(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Count one generation against the account, or refuse it.

    Called by the studio immediately before /redesign. It lives here rather than
    inside /redesign because accounts and renders can be two different backends
    (NEXT_PUBLIC_DATA_API_URL): the GPU host has no users table and is handed no
    session cookie, so a check there would either be unenforceable or would lock
    out every split deployment.

    The counter is the server's: this endpoint decides, increments and answers in
    one transaction, so the client can only ask, never assert.
    """
    user = _require_user(session)
    result = subscriptions.consume(user["Id"])
    if result is None:
        _raise(ERR_NOT_AUTHENTICATED)
    if not result["allowed"]:
        _raise(ERR_QUOTA_EXCEEDED)
    return JSONResponse(result)


def _require_admin(session: str | None):
    user = _require_user(session)
    if user["Role"] != db.ROLE_ADMIN:
        _raise(ERR_FORBIDDEN)
    return user


class SubscriptionDecisionRequest(BaseModel):
    """The admin's verdict. Nothing else is taken from the body — the user and
    the 30-day duration are read from the request row and from policy, so an
    approval cannot be talked into a longer plan or a different account."""

    approve: bool


@app.get("/api/admin/subscriptions")
async def admin_subscriptions(
    status: str | None = None,
    limit: int = 100,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """The upgrade queue — pending first, then whatever was already decided."""
    _require_admin(session)
    if status is not None and status not in db.REQUEST_STATUSES:
        status = None
    limit = max(1, min(200, limit))
    requests = db.list_subscription_requests(status, limit)
    return JSONResponse({
        "requests": requests,
        "pendingCount": sum(1 for r in requests if r["status"] == db.REQUEST_PENDING),
        "terms": subscriptions.terms(),
    })


@app.post("/api/admin/subscriptions/{request_id}/decision")
async def admin_subscription_decision(
    request_id: int,
    req: SubscriptionDecisionRequest,
    background: BackgroundTasks,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Approve or decline one pending request, and email the user the verdict.

    Approving starts Pro now and sets the expiry 30 days out. A request that was
    already decided returns 409 rather than granting a second plan, so a
    double-click cannot hand out 60 days — and, because the mail is queued only
    on a decision that actually landed, cannot send a second email either.

    The email goes out *after* this response, on a background task: the plan is
    already committed, and a slow or unreachable mail server must cost the
    notification rather than the approval. mailer.send never raises.
    """
    admin = _require_admin(session)
    decided = subscriptions.decide(request_id, admin["Id"], req.approve)
    if decided is None:
        _raise(ERR_REQUEST_NOT_PENDING)

    # Read the account after the decision, so an approval mails the expiry date
    # that was actually stored rather than one computed here a second time.
    user = db.get_user(decided["userId"])
    if user is not None:
        background.add_task(
            mailer.notify_decision,
            user["Email"],
            user["FullName"],
            req.approve,
            expiry=user["PlanExpiryDate"],
            duration_days=subscriptions.PRO_DURATION_DAYS,
            weekly_limit=subscriptions.BASIC_WEEKLY_LIMIT,
        )

    log_event(
        "subscription_decision", admin_id=admin["Id"], request_id=request_id,
        approved=req.approve, ok=True, emailed=user is not None,
    )
    return JSONResponse(decided)


@app.get("/api/admin/users")
async def admin_users(
    limit: int = 500,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Every account with its plan and when that plan starts and ends.

    Admin-only, and never carries the password hash — db.list_users names its
    columns rather than selecting *, so the hash cannot leak by accident.
    """
    _require_admin(session)
    return JSONResponse({
        "users": db.list_users(max(1, min(1000, limit))),
        "terms": subscriptions.terms(),
    })


@app.get("/api/admin/feedback")
async def admin_feedback(
    culture: str | None = None,
    since: float | None = None,
    until: float | None = None,
    limit: int = 50,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Aggregated feedback for the admin panel.

    Admin-only by role, not by obscurity: this returns other people's comments,
    so an ordinary signed-in account must not be able to read it.
    `since`/`until` are unix seconds.
    """
    _require_admin(session)
    if culture is not None and culture not in StylePack:
        _raise(ERR_BAD_STYLE)
    limit = max(1, min(200, limit))
    return JSONResponse({
        "stats": db.feedback_stats(culture, since, until),
        # Same culture as the stats beside it: a breakdown that ignored the
        # filter would chart three cultures next to a total for one.
        "byCulture": db.feedback_by_culture(culture, since, until),
        "recent": db.list_feedback(culture, since, until, limit),
        "cultures": list(StylePack),
    })


@app.get("/api/admin/evaluation")
async def admin_evaluation(
    culture: str | None = None,
    since: float | None = None,
    until: float | None = None,
    limit: int = 25,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Everything the evaluation dashboard shows, in one call.

    Deliberately a thin composition of what already exists — db.feedback_stats /
    feedback_by_culture / list_feedback were written for the admin panel and
    answer these questions unchanged. The only new computation is generation
    statistics, which no table holds (see backend/evaluation.py).

    Admin-only for the same reason /api/admin/feedback is: `recent` carries other
    people's comments. `since`/`until` are unix seconds.
    """
    _require_admin(session)
    if culture is not None and culture not in StylePack:
        _raise(ERR_BAD_STYLE)
    limit = max(1, min(200, limit))

    stats = db.feedback_stats(culture, since, until)
    return JSONResponse({
        "filters": {"culture": culture, "since": since, "until": until},
        "cultures": list(CORE_STYLES),
        "stats": stats,
        # Derived, not stored — the form has no "overall" field. Named so on the
        # card, so it can't be read as something a user typed.
        "averageOverall": eval_overall_rating(stats),
        "byCulture": db.feedback_by_culture(culture, since, until),
        "recent": db.list_feedback(culture, since, until, limit),
        # Every section below takes the same three filters, applied in SQL. They
        # used to take only the dates, so choosing a culture narrowed the ratings
        # and left the generation, model and confusion figures global — three
        # different populations printed on one page as though they matched.
        # A saved design is one generated room, and its Culture is the culture it
        # was generated as, so the filter is exact rather than approximate.
        "generation": eval_generation_report(culture, since, until),
        # How many of those designs actually carry each measurement — the
        # denominators behind the averages above.
        "coverage": eval_coverage_report(culture, since, until),
        # Saved designs per intended culture. Separate from `confusion` on
        # purpose: that matrix only counts designs CLIP has classified, so on an
        # install without lpips/open_clip_torch it is empty while real designs
        # exist. This one answers "what did people generate", which is a fact
        # about the rooms rather than about which optional packages are present.
        "designsByCulture": db.designs_by_culture(culture, since, until),
        # Intended culture vs CLIP's prediction, read live from history so a
        # deleted design disappears from it immediately.
        "confusion": db.culture_confusion(culture, since, until),
        # The offline LoRA-vs-baseline corpus. Culture-filterable; it carries no
        # timestamps, so it reports that the date filter cannot apply to it
        # rather than pretending it did.
        "automatic": eval_automatic_metrics(culture=culture),
    })


# ---------- cultural furniture ----------


@app.get("/api/furniture/catalogue")
async def furniture_catalogue(culture: str | None = None) -> JSONResponse:
    """Full catalogue, or one culture's items. Static data — no room context needed,
    so the frontend can render the panel before any room analysis exists."""
    try:
        items = furniture_items_for_culture(culture) if culture else furniture_all_items()
    except FurnitureCatalogueError as e:
        _raise(ERR_BAD_STYLE if culture else ERR_CATALOGUE_UNAVAILABLE, detail_en=str(e))
    return JSONResponse({"items": items, "count": len(items)})


@app.get("/api/furniture/recommendations")
async def furniture_recommendations(
    culture: str,
    room_type: str | None = None,
    mood: str | None = None,
    free_floor_m2: float | None = None,
    existing: str | None = None,   # comma-separated categories already in the room
    colors: str | None = None,     # comma-separated colour tags detected in the room
    materials: str | None = None,  # comma-separated material tags detected in the room
    limit: int = furniture_max_results(),
) -> JSONResponse:
    """Ranked items for this culture and room — the whole culture by default.

    The default is the catalogue's own cap rather than a number written here, so
    the two cannot drift: a hard-coded 6 kept the panel at six pieces after the
    cap moved to nine, which looks exactly like a broken catalogue.

    Only `culture` is required. Every other parameter sharpens the ranking but its
    absence never fails the request — the room-analysis pass that supplies
    free_floor_m2 / existing / colors / materials lands after this endpoint, and the
    furniture panel has to work in the meantime.
    """
    def _split(v: str | None) -> list[str] | None:
        return [s.strip() for s in v.split(",") if s.strip()] if v else None

    try:
        recs = furniture_recommend(
            culture,
            # NOT sanitize_prompt_fragment: that strips underscores, turning the
            # catalogue key "living_room" into "living room" so nothing matched.
            # room_type is a lookup key, never prompt text — normalize_room_type
            # allowlists it against the catalogue instead.
            room_type=room_type,
            existing_categories=_split(existing),
            room_colors=_split(colors),
            room_materials=_split(materials),
            free_floor_m2=free_floor_m2,
            mood=mood,
            limit=limit,
        )
    except FurnitureCatalogueError as e:
        _raise(ERR_BAD_STYLE, detail_en=str(e))
    return JSONResponse({
        "culture": culture,
        "room_type": room_type,
        "items": [r.to_dict() for r in recs],
    })


@app.get("/api/furniture/room-analysis/{job_id}")
async def furniture_room_analysis(job_id: str) -> JSONResponse:
    """Cached placement analysis for a generated room.

    404 rather than recomputing when it's absent: rebuilding it needs the depth and
    segmentation models, which means a GPU. An expired entry is a real state the
    frontend must handle (hide the furniture panel), not something to paper over
    with a slow, silent re-render.
    """
    analysis = get_room_analysis(job_id)
    if analysis is None:
        _raise(
            ERR_JOB_NOT_FOUND,
            detail_en="No room analysis for this job — it expired or was never generated.",
            detail_ar="لا يوجد تحليل لهذه الغرفة — انتهت صلاحيته أو لم يتم إنشاؤه.",
        )
    return JSONResponse({"job_id": job_id, **analysis.summary()})


def _parse_styles(raw: str | None) -> list[str]:
    """Validate the optional `styles` filter, preserving CORE_STYLES order.

    Absent or empty means all three — the shipped default. An unknown name is
    rejected rather than silently dropped, so a typo can't quietly produce a
    partial render the caller then treats as complete.
    """
    if not raw or not raw.strip():
        return list(CORE_STYLES)
    names = [s.strip().lower() for s in raw.split(",") if s.strip()]
    unknown = [n for n in names if n not in CORE_STYLES]
    if unknown:
        _raise(ERR_BAD_STYLE, detail_en=f"Unknown style(s): {', '.join(unknown)}")
    # Dedupe while keeping the canonical order, so callers can't influence
    # generation sequence or ask for the same style twice.
    return [s for s in CORE_STYLES if s in names]


def _analysis_or_404(job_id: str):
    analysis = get_room_analysis(job_id)
    if analysis is None:
        _raise(
            ERR_JOB_NOT_FOUND,
            detail_en="No room analysis for this job — it expired or was never generated.",
            detail_ar="لا يوجد تحليل لهذه الغرفة — انتهت صلاحيته أو لم يتم إنشاؤه.",
        )
    return analysis


def _item_or_400(furniture_id: str) -> dict:
    try:
        return furniture_get_item(furniture_id)
    except FurnitureCatalogueError as e:
        _raise(ERR_BAD_FURNITURE_ID, detail_en=str(e))


def _render_size(job_id: str, style: str | None = None) -> tuple[int, int] | None:
    """(width, height) of a job's rendered image.

    The depth/seg masks run at a fixed square resolution while renders keep the
    room's aspect, so every box crossing the API boundary has to be converted
    between the two. Returns None if nothing has been rendered yet.
    """
    job = jobs.get(job_id)
    outputs = (job.style_outputs if job else None) or {}
    path = outputs.get(style) if style else next(iter(outputs.values()), None)
    if not path or not Path(path).exists():
        return None
    try:
        from PIL import Image as _Image
        with _Image.open(path) as im:
            return im.size
    except Exception:  # noqa: BLE001
        logger.exception("could not read render size for job %s", job_id)
        return None


@app.post("/api/furniture/candidate-positions")
async def furniture_candidate_positions(req: CandidatePositionsRequest) -> JSONResponse:
    """Best few places this item could realistically go in this room.

    An empty `positions` list is a legitimate answer, not an error: some items
    genuinely do not fit some rooms, and forcing an insertion would put a chair
    inside a wall. The message says so in both languages.
    """
    analysis = _analysis_or_404(req.job_id)
    item = _item_or_400(req.furniture_id)
    results = candidate_positions(analysis, item, limit=max(1, min(req.limit, 5)))

    # Convert to rendered-image pixels — that's the space the client draws in.
    target = _render_size(req.job_id)
    mask_shape = analysis.free_floor_mask.shape[:2]
    payload = []
    for r in results:
        d = r.to_dict()
        if target:
            d["position"] = box_to_image_space(r.box, mask_shape, target).to_dict()
        payload.append(d)

    return JSONResponse({
        "job_id": req.job_id,
        "furniture_id": req.furniture_id,
        "image_size": {"width": target[0], "height": target[1]} if target else None,
        "positions": payload,
        "message": None if results else NO_SPACE_EN,
        "message_ar": None if results else NO_SPACE_AR,
    })


@app.post("/api/furniture/validate-position")
async def furniture_validate_position(req: ValidatePositionRequest) -> JSONResponse:
    """Is this exact box valid? Called on every drag, so it must stay cheap.

    The backend is authoritative here. The frontend's green/red outline is a UX
    convenience computed from these same answers — it is never trusted as the
    decision, because a client can send any box it likes.
    """
    analysis = _analysis_or_404(req.job_id)
    item = _item_or_400(req.furniture_id)

    incoming = PlacementBox(x=req.x, y=req.y, w=req.width, h=req.height)
    target = _render_size(req.job_id)
    mask_shape = analysis.free_floor_mask.shape[:2]
    box = box_to_mask_space(incoming, mask_shape, target) if target else incoming

    result = validate_placement(analysis, item, box)
    payload = result.to_dict()
    # Echo the position back in the client's own space.
    payload["position"] = (
        box_to_image_space(result.box, mask_shape, target).to_dict() if target
        else result.box.to_dict()
    )

    # Spec contract: an "adjusted_position" the client can snap to. We only ever
    # offer the box unchanged when valid — silently moving a rejected item would
    # undermine the point of asking the user to confirm a position.
    payload["adjusted_position"] = payload["position"] if result.valid else None
    return JSONResponse(payload)


@app.post("/api/furniture/confirm-placement")
async def furniture_confirm_placement(req: ConfirmPlacementRequest) -> JSONResponse:
    """Insert the item and return the edited room.

    Re-validates server-side before compositing. The client already validated
    while dragging, but that is a convenience — a request can carry any box, and
    the contract is that a successful response never means furniture was placed
    somewhere invalid. A rejected position returns 400 with the reason, not a
    quietly corrected image.
    """
    analysis = _analysis_or_404(req.job_id)
    item = _item_or_400(req.furniture_id)

    style = req.style
    try:
        style = guard_validate_style(style)
    except ValueError:
        _raise(ERR_BAD_STYLE)

    job = jobs.get(req.job_id)
    if job is None:
        _raise(ERR_JOB_NOT_FOUND)
    base_path = (job.style_outputs or {}).get(style)
    if not base_path or not Path(base_path).exists():
        _raise(ERR_OUTPUT_MISSING, detail_en=f"No rendered image for style {style!r}.")

    # The client's box is in rendered-image pixels. Validate in mask space, then
    # composite in image space — the two must not be confused, or the furniture
    # lands somewhere other than where the user confirmed it.
    incoming = PlacementBox(x=req.x, y=req.y, w=req.width, h=req.height)
    target = _render_size(req.job_id, style)
    mask_shape = analysis.free_floor_mask.shape[:2]
    mask_box = box_to_mask_space(incoming, mask_shape, target) if target else incoming
    box = incoming if target else mask_box

    verdict = validate_placement(analysis, item, mask_box)
    if not verdict.valid:
        _raise(
            ERR_INVALID_PLACEMENT,
            detail_en=verdict.reason_en or "Invalid placement.",
            detail_ar=verdict.reason_ar or "موضع غير صالح.",
        )

    try:
        from PIL import Image as _Image
        base = await asyncio.to_thread(_Image.open, base_path)
        result = await asyncio.to_thread(composite_item, base, item, box, analysis=analysis)
        out_path = Path(base_path).with_name(
            f"{req.job_id}_{style}_{req.furniture_id}_{int(time.time())}.png"
        )
        await asyncio.to_thread(result.image.save, out_path, "PNG")
    except CompositingError as e:
        logger.exception("compositing failed for job %s", req.job_id)
        _raise(ERR_COMPOSITING_FAILED, detail_en=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception("unexpected compositing failure for job %s", req.job_id)
        _raise(ERR_COMPOSITING_FAILED, detail_en=str(e))

    # The edited render becomes the job's current image, so a second placement
    # builds on the first instead of silently discarding it.
    job.style_outputs[style] = str(out_path)
    # Teach the cached analysis about the new item, so the next suggestion avoids
    # it rather than proposing the same corner again.
    mark_room_occupied(analysis, mask_box.x, mask_box.y, mask_box.w, mask_box.h)

    # Record the placement on the job: what was put where is part of the design,
    # not a transient UI state, and re-rendering or auditing the room needs it.
    job.placements.append({
        "furniture_id": req.furniture_id,
        "style": style,
        "position": box.to_dict(),   # rendered-image pixels
        "score": round(verdict.score, 3),
        "created_at": time.time(),
    })

    log_event(
        "furniture_placement", job_id=req.job_id, style=style,
        furniture_id=req.furniture_id, score=round(verdict.score, 3), ok=True,
    )
    return JSONResponse({
        "job_id": req.job_id,
        "style": style,
        "furniture_id": req.furniture_id,
        "image": _png_data_url(out_path),
        "position": box.to_dict(),
        "score": round(verdict.score, 3),
        "compositing": result.to_meta(),
        "placements": job.placements,
    })


@app.get("/api/furniture/item/{item_id}")
async def furniture_item(item_id: str) -> JSONResponse:
    try:
        return JSONResponse(furniture_get_item(item_id))
    except FurnitureCatalogueError as e:
        _raise(ERR_BAD_FURNITURE_ID, detail_en=str(e))


class DesignPlanRequest(BaseModel):
    width_cm: float
    depth_cm: float
    height_cm: float | None = None
    culture: str
    brief: str = ""
    # What DAR already found in the photograph, so the planner designs around it
    # instead of on top of it. Optional: an empty room legitimately has none.
    existing: list[dict] = []
    # Doors and windows DAR detected, so "don't block the door" can mean
    # something spatially. Empty is the honest answer for a default room.
    openings: list[dict] = []
    # "measured" | "estimated" | "default" — the planner is told when the
    # dimensions are DAR's own default rather than anything from a photograph.
    shell_source: str | None = None
    # The scene as it stands: every object with its uid, origin and lock state.
    # This is what lets a brief be an EDIT ("move these apart", "remove one
    # chair") rather than only a fresh furnishing — without it the planner is
    # answering about a room it has never been shown. Only `catalog`-origin,
    # unlocked pieces become move/remove targets; see movable_objects().
    objects: list[dict] = []


@app.post("/api/design/plan")
async def design_plan(
    req: DesignPlanRequest,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> JSONResponse:
    """Plan a room's furniture from a written brief.

    Behind a session because every call spends real money at a model provider,
    and this backend already knows who the caller is. The client falls back to
    its own rule-based plan on 401, so signing out costs the AI plan, never the
    feature.

    Never fails for want of a model: with no ANTHROPIC_API_KEY configured the
    planner returns a rule-based layout tagged source="rules". The response is
    advisory in full — the browser re-validates every placement against the same
    collision engine that governs a human drag before anything enters the scene.
    """
    _require_user(session)

    if req.culture != "all" and req.culture not in CORE_STYLES:
        _raise(ERR_BAD_CULTURE, detail_en=f"Unknown culture: {req.culture!r}")
    if not (100 <= req.width_cm <= 2000) or not (100 <= req.depth_cm <= 2000):
        _raise(ERR_BAD_ROOM)

    room = {
        "widthCm": req.width_cm,
        "depthCm": req.depth_cm,
        "heightCm": req.height_cm or 300,
    }
    # to_thread: the SDK call is blocking, and the event loop also serves the
    # keepalive streams that /redesign depends on.
    result = await asyncio.to_thread(
        planner_plan, room, req.culture, req.brief, req.existing,
        req.openings, req.shell_source, req.objects,
    )
    log_event(
        "design_plan", ok=True, culture=req.culture, source=result.get("source"),
        chose=result.get("understood", {}).get("culture"),
        intent=result.get("understood", {}).get("intent"),
        items=len(result.get("items", [])),
        moves=len(result.get("moves", [])),
        removals=len(result.get("removals", [])),
        light=_light_mode(),
    )
    return JSONResponse(result)


@app.get("/api/design/planner-status")
async def design_planner_status() -> JSONResponse:
    """Whether a design model is configured, so the panel can say so up front."""
    return JSONResponse({
        "configured": planner_is_configured(),
        "model": planner_model_name() if planner_is_configured() else None,
        "provider": planner_provider(),
    })


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



# ----------------------------------------------------------------------------
# Build Mode -> render
# ----------------------------------------------------------------------------
@app.post("/render-scene")
async def render_scene_endpoint(
    depth: UploadFile,
    seg: UploadFile,
    style: str = Form(...),
    room: str = Form("living room"),
    scale: float | None = Form(None),
) -> StreamingResponse:
    """Render a Build Mode scene photorealistically.

    The client renders its 3D scene into the two images this pipeline already
    conditions on -- a depth map and an ADE20K-palette segmentation map -- and
    posts them here. They replace the annotator output normally derived from
    the user's photograph, so the layout SDXL is conditioned on is the layout
    the user built: placement, orientation, room geometry and viewpoint come
    across as control signal rather than as a description in a prompt.

    Everything else is the ordinary cultural path (prompt builder, per-culture
    LoRA, sweep-winner ControlNet weights), so this shares the behaviour of
    /redesign rather than forking the generator.
    """
    if style not in StylePack:
        _raise(ERR_BAD_STYLE)

    # Cultural intensity, the same 0..1 LoRA scale /restyle already exposes and
    # clamps. Omitted is the default: `None` reaches render_scene exactly as it
    # did before this parameter existed, so the shipped path is unchanged.
    if scale is not None:
        scale = max(0.0, min(1.0, float(scale)))

    from PIL import Image

    # Same guardrail /redesign applies. This endpoint accepts two uploads and
    # was skipping it entirely — an extension allowlist and a magic-byte sniff
    # before PIL is handed the bytes, plus the 10 MB ceiling.
    depth_raw = await depth.read()
    seg_raw = await seg.read()
    _guard_upload(depth.filename, depth_raw)
    _guard_upload(seg.filename, seg_raw)

    try:
        depth_img = Image.open(io.BytesIO(depth_raw)).convert("RGB")
        seg_img = Image.open(io.BytesIO(seg_raw)).convert("RGB")
    except Exception:
        _raise(ERR_BAD_IMAGE_DATA)

    if depth_img.size != seg_img.size:
        seg_img = seg_img.resize(depth_img.size)

    job = jobs.create(input_path="")
    jobs.transition(job.id, JobStatus.running, style=style)
    out_path = UPLOAD_DIR / f"{job.id}_scene_{style}.png"
    started = time.monotonic()

    async def _build() -> JSONResponse:
        return await _render_scene_body(
            job, style, room, scale, depth_img, seg_img, out_path, started,
        )

    # Streamed like /redesign and /restyle, and for a reason this endpoint hits
    # HARDER than either of them: it waits on _GEN_LOCK before it starts. A
    # second Render with DAR — or one pressed while a Studio generation is
    # running — sits silent for the queued render AND its own, so the first byte
    # can be well over the ~100s at which Cloudflare's free tunnel 524s the
    # connection. The browser then reports a network failure and the panel says
    # "could not reach the renderer", which is why this looked like a dead
    # tunnel while /healthz answered fine.
    #
    # This endpoint was added for Build Mode after the keepalive existed and
    # simply never got it.
    return _stream_keepalive(_build())


async def _render_scene_body(
    job, style: str, room: str, scale: float | None,
    depth_img, seg_img, out_path, started: float,
) -> RenderSceneResponse:
    try:
        async with _GEN_LOCK:
            result = await asyncio.to_thread(
                render_scene,
                depth_image=depth_img,
                seg_image=seg_img,
                style=style,
                out_path=out_path,
                seed=int(job.id[:8], 16),
                room=room,
                lora_scale=scale,
            )
    except PipelineError as e:
        jobs.transition(
            job.id, JobStatus.error,
            error_code=ERR_PIPELINE.code, error_en=e.message_en, error_ar=e.message_ar,
        )
        logger.exception("render-scene job %s pipeline error", job.id)
        log_event(
            "render_scene", job_id=job.id, style=style, ok=False,
            error=e.message_en, duration_s=round(time.monotonic() - started, 2),
            light=_light_mode(),
        )
        _raise(ERR_PIPELINE, detail_en=e.message_en, detail_ar=e.message_ar)

    duration = round(time.monotonic() - started, 2)
    jobs.transition(job.id, JobStatus.done)
    log_event(
        "render_scene", job_id=job.id, style=style, ok=True,
        duration_s=duration, light=_light_mode(),
    )
    return RenderSceneResponse(
        job_id=job.id,
        style=style,
        image=_png_data_url(Path(result)),
        duration_s=duration,
        # The client must be able to say plainly that this is a stand-in.
        placeholder=_light_mode(),
        provenance=pipeline_provenance([style]),
        dual_controlnet=not depth_only_mode(),
    )


# Cleanup helper used by tests; harmless in production.
def _reset_for_tests() -> None:
    from . import jobs as jobs_mod
    jobs_mod.jobs._store.clear()  # type: ignore[attr-defined]
    clear_color_undo()
    for p in UPLOAD_DIR.glob("*"):
        if p.is_file() and p.name != ".gitkeep":
            try:
                p.unlink()
            except Exception:
                pass


# Avoid unused import warnings in some Python versions.
_ = shutil
