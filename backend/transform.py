"""DarDesign canonical inference pipeline.

Single source of truth — same module is used:
  - on Kaggle T4 (real SDXL + dual ControlNet + optional LoRA),
  - locally on Windows (`DARDESIGN_LIGHT=1` → placeholder PNG, no GPU required),
  - inside FastAPI (`backend/main.py` calls `transform_room(...)`),
  - inside scripts/ (sweep, finals, ablate all import the same function).

Public surface
--------------
    transform_room(image_path, style, *, strength=0.7, **opts) -> Path
    StyleId       Literal["lebanese", "khaleeji", "moroccan"]
    PipelineError raised on hard failures the caller should surface

Behaviour
---------
* SDXL + dual ControlNet (Depth Anything V2 + OneFormer ADE20K) by default.
* Lazy per-style LoRA load; if `models/loras/<style>/dardesign-<style>-lora.safetensors`
  is missing, logs a warning and falls back to prompt-only generation.
* On torch.cuda OOM, frees the SDXL pipeline and retries with SD 1.5 + the
  ControlNet 1.1 depth/seg pair at 768x768.
* On any other failure, raises `PipelineError` with a bilingual message.
* `DARDESIGN_LIGHT=1` short-circuits everything and returns a placeholder image
  so FastAPI is testable on a laptop. Logged loudly so it's never confused with
  a real run.
"""
from __future__ import annotations

import gc
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

# These imports are guarded so the module is importable without the heavy ML
# stack (e.g. on a Windows dev box without CUDA torch). Heavy imports happen
# inside _load_pipeline().
try:
    import yaml  # type: ignore
except ImportError:  # PyYAML is in requirements but might not be in light envs
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "configs" / "pipeline.yaml"
LORA_DIR = ROOT / "models" / "loras"
DEFAULT_OUT_DIR = ROOT / "backend" / "uploads"

StyleId = Literal["lebanese", "khaleeji", "moroccan", "persian"]
# The three trained cultures — /redesign generates exactly these, keeping its
# demo timing fixed. persian is the prompt-only 4th culture (docs/add_a_culture.md
# minus the LoRA step): reachable via /restyle and /transform, never /redesign.
CORE_STYLES = ("lebanese", "khaleeji", "moroccan")
StylePack = (*CORE_STYLES, "persian")


class PipelineError(RuntimeError):
    """Raised on unrecoverable pipeline failures — the FastAPI layer surfaces this."""

    def __init__(self, message_en: str, message_ar: str) -> None:
        super().__init__(message_en)
        self.message_en = message_en
        self.message_ar = message_ar


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------

_DEFAULT_CONFIG: dict[str, Any] = {
    "base_model": "stabilityai/stable-diffusion-xl-base-1.0",
    "fallback_model": "runwayml/stable-diffusion-v1-5",
    "controlnet": {
        "depth_sdxl": "diffusers/controlnet-depth-sdxl-1.0",
        # NB: "diffusers/controlnet-seg-sdxl-1.0" does not exist on the Hub —
        # SargeZT's is the standard ControlNetModel-loadable SDXL seg checkpoint.
        "seg_sdxl": "SargeZT/sdxl-controlnet-seg",
        "depth_sd15": "lllyasviel/sd-controlnet-depth",
        "seg_sd15": "lllyasviel/sd-controlnet-seg",
    },
    "default_controlnet_weights": {"depth": 0.7, "seg": 0.5},
    "steps": 30,
    "guidance": 7.0,
    "strength": 0.7,
    "output_size": [1024, 1024],
    "sd15_fallback_size": [768, 768],
    "extra_negative_en": "low resolution, jpeg artifacts, color banding",
    "lora_dir": "models/loras",
    "lora_filename_template": "dardesign-{culture}-lora.safetensors",
    "lora_scale": 0.8,
}


def _load_config() -> dict[str, Any]:
    if yaml is None or not CONFIG_PATH.exists():
        return _DEFAULT_CONFIG
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            user = yaml.safe_load(fh) or {}
    except Exception:  # pragma: no cover — corrupt YAML
        logger.exception("failed to read pipeline.yaml; using built-in defaults")
        return _DEFAULT_CONFIG
    merged = dict(_DEFAULT_CONFIG)
    merged.update(user)
    return merged


CONFIG = _load_config()

SWEEP_WINNERS_PATH = ROOT / "configs" / "sweep_winners.json"


def _winner_weights(style: str) -> tuple[float, float] | None:
    """Per-style (depth, seg) ControlNet weights from configs/sweep_winners.json.

    The eyeball-confirmed sweep winners override pipeline.yaml defaults so the
    sweep actually reaches production ("weights tunable without code edits" —
    ARCHITECTURE.md). Falls back to the file's "default" pair, then None.
    """
    try:
        if not SWEEP_WINNERS_PATH.exists():
            return None
        import json as _json

        data = _json.loads(SWEEP_WINNERS_PATH.read_text(encoding="utf-8"))
        pair = data.get(style) or data.get("default")
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            return float(pair[0]), float(pair[1])
    except Exception:
        logger.exception("failed to read %s — using pipeline.yaml defaults", SWEEP_WINNERS_PATH)
    return None


# ----------------------------------------------------------------------------
# Light mode (no GPU)
# ----------------------------------------------------------------------------


def _is_light_mode() -> bool:
    return os.environ.get("DARDESIGN_LIGHT", "").lower() in ("1", "true", "yes")


def fit_size(width: int, height: int, long_side: int = 1024) -> tuple[int, int]:
    """Scale (width, height) so the long side == long_side, keeping aspect,
    rounded to multiples of 8 (UNet requirement).

    Shared by real generation, LIGHT placeholders, and /redesign's original
    re-encode so the before/after compare slider always gets matching geometry
    — squashing everything to a fixed square made the two slider halves crop
    differently under object-fit: cover and read as two different rooms."""
    scale = long_side / max(width, height)
    w = max(8, round(width * scale / 8) * 8)
    h = max(8, round(height * scale / 8) * 8)
    return w, h


def _write_manifest(out_path: Path, manifest: dict) -> None:
    """C2PA-inspired provenance sidecar: write <out>.manifest.json recording the
    model, LoRA, seed, ControlNet weights and a SHA-256 of the output PNG, so any
    render is auditable ('this image was made by DarDesign with these settings').
    Best-effort — a manifest failure never costs the user their render."""
    import hashlib
    import json as _json

    try:
        meta = dict(manifest)
        meta["output_sha256"] = hashlib.sha256(out_path.read_bytes()).hexdigest()
        meta["generated_at"] = int(time.time())
        out_path.with_suffix(".manifest.json").write_text(
            _json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        logger.exception("failed to write provenance manifest for %s", out_path)


def _emit_placeholder(image_path: Path, style: str, out_path: Path) -> Path:
    """Generate a culturally-tinted placeholder so light-mode dev can't be
    confused for a real generation. Each culture gets a strong colour wash
    + ornament overlay + a crop-proof centred PREVIEW notice.

    Keeps the source aspect ratio (long side capped at 1024) so the before/after
    compare slider aligns pixel-for-pixel with the original under object-fit:
    cover — a square placeholder against a wide original reads as two different
    rooms."""
    import math

    from PIL import Image, ImageDraw, ImageEnhance, ImageFont

    # Distinct cultural casts so the user immediately sees A != B.
    CULTURE = {
        "lebanese": {"tint": (168, 50, 50),  "name": "Lebanese", "ar": "لبناني"},
        "khaleeji": {"tint": (217, 154, 31), "name": "Khaleeji", "ar": "خليجي"},
        "moroccan": {"tint": (30, 80, 143),  "name": "Moroccan", "ar": "مغربي"},
        "persian":  {"tint": (32, 140, 141), "name": "Persian",  "ar": "فارسي"},
    }
    palette = CULTURE.get(style, {"tint": (212, 175, 55), "name": style.title(), "ar": ""})
    tint = palette["tint"]

    src = Image.open(image_path).convert("RGB")
    src = src.resize(fit_size(*src.size))
    w, h = src.size

    # 1) desaturate the photo most of the way, then blend a solid culture colour
    desat = ImageEnhance.Color(src).enhance(0.25)
    tint_layer = Image.new("RGB", src.size, tint)
    tinted = Image.blend(desat, tint_layer, 0.42)

    # 2) ornament overlay — eight-point stars in a sparse grid
    overlay = Image.new("RGBA", src.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    spacing = 192
    for cx in range(spacing // 2, w, spacing):
        for cy in range(spacing // 2, h, spacing):
            r1, r2 = 28, 12
            pts = []
            for i in range(16):
                r = r1 if i % 2 == 0 else r2
                a = (i / 16) * 2 * math.pi - math.pi / 2
                pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
            draw.polygon(pts, outline=(243, 220, 146, 90))

    try:
        title_font = ImageFont.truetype("arial.ttf", max(24, h // 24))
        sub_font = ImageFont.truetype("arial.ttf", max(14, h // 44))
    except Exception:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()

    # 3) centred pill — survives ANY object-fit crop (a top band gets cut off
    #    when a wide viewport cover-crops the image).
    pill_w, pill_h = int(w * 0.62), max(84, h // 7)
    px0, py0 = (w - pill_w) // 2, (h - pill_h) // 2
    draw.rounded_rectangle(
        [px0, py0, px0 + pill_w, py0 + pill_h],
        radius=pill_h // 2,
        fill=(12, 10, 8, 215),
        outline=(243, 220, 146, 160),
        width=2,
    )
    # Latin-only text: PIL has no Arabic shaping without libraqm (it draws the
    # letters disconnected and backwards) — the studio's preview banner carries
    # the properly-shaped bilingual notice instead.
    title = f"PREVIEW · {palette['name']}"
    sub = "Placeholder (no GPU) - real renders need the Kaggle T4 backend"
    tb = draw.textbbox((0, 0), title, font=title_font)
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    draw.text(
        ((w - (tb[2] - tb[0])) / 2, py0 + pill_h * 0.18),
        title, fill=(243, 220, 146, 255), font=title_font,
    )
    draw.text(
        ((w - (sb[2] - sb[0])) / 2, py0 + pill_h * 0.60),
        sub, fill=(232, 216, 184, 230), font=sub_font,
    )

    composed = Image.alpha_composite(tinted.convert("RGBA"), overlay).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    composed.save(out_path, format="PNG", optimize=True)
    logger.warning(
        "DARDESIGN_LIGHT placeholder written to %s (style=%s) — NOT a real generation",
        out_path, style,
    )
    _write_manifest(out_path, {"tool": "DarDesign", "style": style, "model": "DARDESIGN_LIGHT placeholder", "light_mode": True})
    return out_path


# ----------------------------------------------------------------------------
# LoRA management
# ----------------------------------------------------------------------------


def _lora_path(style: StyleId) -> Path:
    template = CONFIG.get("lora_filename_template", _DEFAULT_CONFIG["lora_filename_template"])
    filename = template.format(culture=style)
    return LORA_DIR / style / filename


def _peft_key_to_diffusers(key: str) -> str:
    """Map a raw-peft LoRA key to the diffusers pipeline format.

    scripts/train_lora.py saves get_peft_model_state_dict(unet) output —
    'base_model.model.<unet_path>.lora_A.weight' — but pipe.load_lora_weights
    expects 'unet.<unet_path>.lora_A.weight'. Unmapped keys make peft try to
    inject adapters at module paths that don't exist in the pipeline's UNet
    (ValueError: Target modules {...} not found)."""
    prefix = "base_model.model."
    if key.startswith(prefix):
        return "unet." + key[len(prefix):]
    return key


def _load_lora_state_dict(path: Path) -> dict:
    """Load the LoRA safetensors with keys remapped for the pipeline loader."""
    from safetensors.torch import load_file

    return {_peft_key_to_diffusers(k): v for k, v in load_file(str(path)).items()}


def _has_lora(style: StyleId) -> bool:
    return _lora_path(style).is_file()


# ----------------------------------------------------------------------------
# Pipeline cache (per-style)
# ----------------------------------------------------------------------------


@dataclass
class _LoadedPipe:
    pipe: Any
    is_sdxl: bool
    style_loaded: StyleId | None  # which LoRA is currently fused, if any
    scale_loaded: float | None = None  # the scale it was fused at (Style Intensity Slider)
    has_seg: bool = True  # False → seg ControlNet failed to load; depth-only conditioning


_PIPE_CACHE: dict[str, _LoadedPipe] = {}


def _free_pipe(key: str) -> None:
    pipe_obj = _PIPE_CACHE.pop(key, None)
    if pipe_obj is None:
        return
    try:
        del pipe_obj.pipe
    except Exception:
        pass
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _load_pipeline(*, use_sdxl: bool) -> _LoadedPipe:
    """Load SDXL+dual ControlNet (or SD1.5+dual ControlNet on fallback) and cache it.

    Heavy imports live inside this function so the module is importable on
    machines without diffusers/torch.
    """
    key = "sdxl" if use_sdxl else "sd15"
    if key in _PIPE_CACHE:
        return _PIPE_CACHE[key]

    import torch
    from diffusers import (
        ControlNetModel,
        StableDiffusionControlNetPipeline,
        StableDiffusionXLControlNetPipeline,
    )

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device = "cuda" if torch.cuda.is_available() else "cpu"

    cn_cfg = CONFIG["controlnet"]
    seg_key = "seg_sdxl" if use_sdxl else "seg_sd15"
    depth_key = "depth_sdxl" if use_sdxl else "depth_sd15"

    depth_cn = ControlNetModel.from_pretrained(cn_cfg[depth_key], torch_dtype=dtype)
    # Depth is the structure anchor and non-negotiable; a seg checkpoint failure
    # degrades to depth-only (loudly) instead of killing the demo.
    has_seg = True
    try:
        seg_cn = ControlNetModel.from_pretrained(cn_cfg[seg_key], torch_dtype=dtype)
        controlnet: Any = [depth_cn, seg_cn]
    except Exception:
        logger.exception(
            "seg ControlNet %s failed to load — falling back to DEPTH-ONLY conditioning",
            cn_cfg[seg_key],
        )
        controlnet = depth_cn
        has_seg = False

    if use_sdxl:
        pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
            CONFIG["base_model"],
            controlnet=controlnet,
            torch_dtype=dtype,
            variant="fp16" if dtype == torch.float16 else None,
        )
    else:
        pipe = StableDiffusionControlNetPipeline.from_pretrained(
            CONFIG["fallback_model"],
            controlnet=controlnet,
            torch_dtype=dtype,
            safety_checker=None,
        )

    if device == "cuda":
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe = pipe.to(device)
        try:
            pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    else:
        pipe = pipe.to(device)

    pipe.set_progress_bar_config(disable=True)

    loaded = _LoadedPipe(pipe=pipe, is_sdxl=use_sdxl, style_loaded=None, has_seg=has_seg)
    _PIPE_CACHE[key] = loaded
    logger.info("loaded %s pipeline on %s (dtype=%s, dual_controlnet=%s)", key, device, dtype, has_seg)
    return loaded


def _attach_lora(loaded: _LoadedPipe, style: StyleId, lora_scale: float | None = None) -> None:
    """Lazy-load and fuse the LoRA for `style` at `lora_scale` (the Style Intensity
    Slider: 0.0 ≈ generic SDXL, 1.0 ≈ full culture). Hot-swaps if a different style —
    or the same style at a different scale — is currently loaded."""
    scale = float(lora_scale if lora_scale is not None else CONFIG.get("lora_scale", 0.8))
    if loaded.style_loaded == style and loaded.scale_loaded == scale:
        return  # already attached at this scale

    try:
        if loaded.style_loaded is not None:
            try:
                loaded.pipe.unfuse_lora()
                loaded.pipe.unload_lora_weights()
            except Exception:
                logger.exception("failed to unload previous LoRA %s", loaded.style_loaded)

        path = _lora_path(style)
        if not path.is_file():
            loaded.style_loaded = None
            loaded.scale_loaded = None
            logger.warning(
                "LoRA file not found for style=%s at %s — falling back to prompt-only",
                style, path,
            )
            return

        loaded.pipe.load_lora_weights(
            _load_lora_state_dict(path),
            adapter_name=f"dardesign-{style}",
        )
        try:
            loaded.pipe.fuse_lora(lora_scale=scale)
        except Exception:
            # Older diffusers: scale is set at call time via cross_attention_kwargs
            pass
        loaded.style_loaded = style
        loaded.scale_loaded = scale
        logger.info("attached LoRA %s (scale=%.2f)", path.name, scale)
    except Exception:
        logger.exception("LoRA load failed for style=%s — continuing prompt-only", style)
        loaded.style_loaded = None
        loaded.scale_loaded = None


# ----------------------------------------------------------------------------
# Conditioning (depth + seg)
# ----------------------------------------------------------------------------


# Canonical 150-class ADE20K palette (mmsegmentation) — the colour contract the
# seg ControlNet was trained on; OneFormer class ids index straight into it.
_ADE20K_PALETTE: tuple[tuple[int, int, int], ...] = (
    (120, 120, 120), (180, 120, 120), (6, 230, 230), (80, 50, 50), (4, 200, 3), (120, 120, 80),
    (140, 140, 140), (204, 5, 255), (230, 230, 230), (4, 250, 7), (224, 5, 255), (235, 255, 7),
    (150, 5, 61), (120, 120, 70), (8, 255, 51), (255, 6, 82), (143, 255, 140), (204, 255, 4),
    (255, 51, 7), (204, 70, 3), (0, 102, 200), (61, 230, 250), (255, 6, 51), (11, 102, 255),
    (255, 7, 71), (255, 9, 224), (9, 7, 230), (220, 220, 220), (255, 9, 92), (112, 9, 255),
    (8, 255, 214), (7, 255, 224), (255, 184, 6), (10, 255, 71), (255, 41, 10), (7, 255, 255),
    (224, 255, 8), (102, 8, 255), (255, 61, 6), (255, 194, 7), (255, 122, 8), (0, 255, 20),
    (255, 8, 41), (255, 5, 153), (6, 51, 255), (235, 12, 255), (160, 150, 20), (0, 163, 255),
    (140, 140, 140), (250, 10, 15), (20, 255, 0), (31, 255, 0), (255, 31, 0), (255, 224, 0),
    (153, 255, 0), (0, 0, 255), (255, 71, 0), (0, 235, 255), (0, 173, 255), (31, 0, 255),
    (11, 200, 200), (255, 82, 0), (0, 255, 245), (0, 61, 255), (0, 255, 112), (0, 255, 133),
    (255, 0, 0), (255, 163, 0), (255, 102, 0), (194, 255, 0), (0, 143, 255), (51, 255, 0),
    (0, 82, 255), (0, 255, 41), (0, 255, 173), (10, 0, 255), (173, 255, 0), (0, 255, 153),
    (255, 92, 0), (255, 0, 255), (255, 0, 245), (255, 0, 102), (255, 173, 0), (255, 0, 20),
    (255, 184, 184), (0, 31, 255), (0, 255, 61), (0, 71, 255), (255, 0, 204), (0, 255, 194),
    (0, 255, 82), (0, 10, 255), (0, 112, 255), (51, 0, 255), (0, 194, 255), (0, 122, 255),
    (0, 255, 163), (255, 153, 0), (0, 255, 10), (255, 112, 0), (143, 255, 0), (82, 0, 255),
    (163, 255, 0), (255, 235, 0), (8, 184, 170), (133, 0, 255), (0, 255, 92), (184, 0, 255),
    (255, 0, 31), (0, 184, 255), (0, 214, 255), (255, 0, 112), (92, 255, 0), (0, 224, 255),
    (112, 224, 255), (70, 184, 160), (163, 0, 255), (153, 0, 255), (71, 255, 0), (255, 0, 163),
    (255, 204, 0), (255, 0, 143), (0, 255, 235), (133, 255, 0), (255, 0, 235), (245, 0, 255),
    (255, 0, 122), (255, 245, 0), (10, 190, 212), (214, 255, 0), (0, 204, 255), (20, 0, 255),
    (255, 255, 0), (0, 153, 255), (0, 41, 255), (0, 255, 204), (41, 0, 255), (41, 255, 0),
    (173, 0, 255), (0, 245, 255), (71, 0, 255), (122, 0, 255), (0, 255, 184), (0, 92, 255),
    (184, 255, 0), (0, 133, 255), (255, 214, 0), (25, 194, 194), (102, 255, 0), (92, 0, 255),
)

_ANNOTATOR_CACHE: dict[str, Any] = {}


def _depth_control_image(src: Any) -> Any:
    """Depth control image via Depth Anything V2 (transformers), MiDaS fallback.

    The annotator is cached module-wide — /redesign runs three styles per
    request and must not reload it each time.
    """
    if "depth" not in _ANNOTATOR_CACHE:
        try:
            from transformers import pipeline as _hf_pipeline

            _ANNOTATOR_CACHE["depth"] = (
                "dav2",
                _hf_pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf"),
            )
        except Exception:
            logger.exception("Depth Anything V2 unavailable — falling back to MiDaS")
            from controlnet_aux import MidasDetector  # type: ignore

            _ANNOTATOR_CACHE["depth"] = ("midas", MidasDetector.from_pretrained("lllyasviel/Annotators"))
    kind, proc = _ANNOTATOR_CACHE["depth"]
    depth = proc(src)["depth"] if kind == "dav2" else proc(src)
    return depth.convert("RGB").resize(src.size)


def _seg_control_image(src: Any) -> Any:
    """ADE20K-colorised OneFormer semantic map — the seg ControlNet's input.

    Shares the OneFormer weights with compute_depth_seg via _DEPTH_SEG_CACHE,
    so one download serves both the conditioning and the 2D-map projection.
    """
    import numpy as np
    import torch
    from PIL import Image
    from transformers import OneFormerForUniversalSegmentation, OneFormerProcessor

    if "seg" not in _DEPTH_SEG_CACHE:
        ckpt = "shi-labs/oneformer_ade20k_swin_large"
        _DEPTH_SEG_CACHE["seg"] = (
            OneFormerProcessor.from_pretrained(ckpt),
            OneFormerForUniversalSegmentation.from_pretrained(ckpt),
        )
    processor, model = _DEPTH_SEG_CACHE["seg"]
    inputs = processor(images=src, task_inputs=["semantic"], return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    ids = (
        processor.post_process_semantic_segmentation(outputs, target_sizes=[src.size[::-1]])[0]
        .cpu()
        .numpy()
    )
    palette = np.asarray(_ADE20K_PALETTE, dtype=np.uint8)
    return Image.fromarray(palette[np.clip(ids, 0, len(palette) - 1)])


def _prepare_conditioning(image_path: Path, target_size: tuple[int, int]) -> tuple[Any, Any, Any]:
    """Return (resized_input_pil, depth_pil, seg_pil)."""
    from PIL import Image

    src = Image.open(image_path).convert("RGB").resize(target_size)

    depth = _depth_control_image(src)

    try:
        seg = _seg_control_image(src)
    except Exception:
        logger.exception("OneFormer ADE20K unavailable; using depth as both control inputs")
        seg = depth

    return src, depth, seg


# ----------------------------------------------------------------------------
# Depth + raw-id segmentation for the 2D object-map projection
# ----------------------------------------------------------------------------

_PROJECTION_SIZE = 384  # working resolution — the map only needs centroids
_DEPTH_SEG_CACHE: dict[str, Any] = {}


def _synthetic_depth_seg(size: int = _PROJECTION_SIZE) -> tuple[Any, Any]:
    """DARDESIGN_LIGHT stand-in: a deterministic living-room layout so the
    /redesign → projection → RoomMap2D wiring is exercisable without a GPU.
    NOT real detections — same spirit as the PREVIEW placeholder images."""
    import numpy as np

    h = w = size
    seg = np.zeros((h, w), dtype=np.int32)  # 0 = wall; ignored by projection

    def put(class_id: int, y0: float, y1: float, x0: float, x1: float) -> None:
        seg[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = class_id

    put(8, 0.05, 0.30, 0.35, 0.65)    # window on the far wall
    put(14, 0.10, 0.55, 0.86, 0.97)   # door, right
    put(10, 0.30, 0.55, 0.04, 0.18)   # cabinet, left
    put(36, 0.32, 0.50, 0.20, 0.28)   # lamp
    put(28, 0.55, 0.92, 0.22, 0.78)   # rug, centre foreground
    put(15, 0.58, 0.74, 0.38, 0.62)   # table on the rug
    put(19, 0.60, 0.78, 0.68, 0.82)   # chair, right of the table
    put(23, 0.66, 0.95, 0.05, 0.35)   # sofa, near left

    # Disparity-style depth (larger = closer): far wall at top, floor at bottom.
    depth = np.tile(np.linspace(0.25, 0.95, h, dtype=np.float32)[:, None], (1, w))
    return depth, seg


def compute_depth_seg(image_path: str | Path, *, size: int = _PROJECTION_SIZE) -> tuple[Any, Any]:
    """Return (depth_array, seg_class_ids) for backend.projection.

    depth_array   — (H, W) float32, Depth Anything convention (larger = closer)
    seg_class_ids — (H, W) int32 raw ADE20K-150 ids; `_prepare_conditioning`
                    can't be reused here because it returns the *colorized*
                    control images, not the id map the projection needs.

    Runs on CPU on purpose: one-shot per request, must not steal VRAM from the
    SDXL pipeline on the T4.
    """
    if _is_light_mode():
        return _synthetic_depth_seg(size)

    import numpy as np
    from PIL import Image

    src = Image.open(image_path).convert("RGB").resize((size, size))

    # Same cached Depth Anything V2 annotator the ControlNet conditioning uses.
    depth_pil = _depth_control_image(src)
    depth = np.asarray(depth_pil.convert("L").resize((size, size)), dtype=np.float32)

    # Same checkpoint the seg ControlNet input uses, so the weights are already
    # in the HF cache by the time /redesign gets here.
    import torch
    from transformers import OneFormerForUniversalSegmentation, OneFormerProcessor

    if "seg" not in _DEPTH_SEG_CACHE:
        ckpt = "shi-labs/oneformer_ade20k_swin_large"
        _DEPTH_SEG_CACHE["seg"] = (
            OneFormerProcessor.from_pretrained(ckpt),
            OneFormerForUniversalSegmentation.from_pretrained(ckpt),
        )
    processor, model = _DEPTH_SEG_CACHE["seg"]
    inputs = processor(images=src, task_inputs=["semantic"], return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    seg = (
        processor.post_process_semantic_segmentation(outputs, target_sizes=[(size, size)])[0]
        .cpu()
        .numpy()
        .astype(np.int32)
    )
    return depth, seg


# ----------------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------------


def transform_room(
    image_path: str | Path,
    style: StyleId,
    *,
    strength: float = 0.7,
    out_dir: str | Path | None = None,
    seed: int | None = None,
    room: str | None = None,
    use_lora: bool = True,
    use_segmentation: bool = True,
    use_ontology: bool = True,
    controlnet_weights: tuple[float, float] | None = None,
    lora_scale: float | None = None,
) -> Path:
    """Transform a room photo into a culturally-styled redesign.

    Returns the path to the generated PNG.

    Switches:
        use_lora=False        → ablation (--no-lora)
        use_segmentation=False → ablation (--no-segmentation): seg control gets weight 0
        use_ontology=False    → ablation (--no-ontology): plain "<style> interior" prompt
    """
    if style not in StylePack:
        raise PipelineError(
            f"unknown style {style!r}",
            "النمط غير معروف",
        )

    image_path = Path(image_path)
    if not image_path.exists():
        raise PipelineError(
            f"input image not found: {image_path}",
            "ملف الصورة المدخلة غير موجود",
        )

    out_dir = Path(out_dir) if out_dir is not None else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    out_path = out_dir / f"{image_path.stem}_{style}_{stamp}.png"

    if _is_light_mode():
        return _emit_placeholder(image_path, style, out_path)

    # Build prompts (ontology-aware unless ablated)
    if use_ontology:
        from backend.prompt_builder import build_prompts
        prompts = build_prompts(style, room=room, seed=seed)
        positive = prompts.positive_en
        negative = (
            prompts.negative_en
            + ", "
            + CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"])
        )
    else:
        positive = f"a {room or 'interior'} in {style} style, photorealistic, 8k, magazine quality"
        negative = CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"])

    cn_w = controlnet_weights or _winner_weights(style) or (
        CONFIG["default_controlnet_weights"]["depth"],
        CONFIG["default_controlnet_weights"]["seg"],
    )
    if not use_segmentation:
        cn_w = (cn_w[0], 0.0)

    # Render at the input's aspect (long side from config) so outputs align
    # with the original in the compare slider instead of being squashed square.
    from PIL import Image
    with Image.open(image_path) as _im:
        src_w, src_h = _im.size

    # First attempt: SDXL
    try:
        return _generate(
            image_path=image_path,
            out_path=out_path,
            positive=positive,
            negative=negative,
            style=style,
            strength=strength,
            seed=seed,
            controlnet_weights=cn_w,
            use_lora=use_lora,
            lora_scale=lora_scale,
            target_size=fit_size(src_w, src_h, int(CONFIG["output_size"][0])),
            use_sdxl=True,
        )
    except _OutOfMemory:
        logger.warning("SDXL OOM — releasing pipeline and falling back to SD 1.5")
        _free_pipe("sdxl")
        return _generate(
            image_path=image_path,
            out_path=out_path,
            positive=positive,
            negative=negative,
            style=style,
            strength=strength,
            seed=seed,
            controlnet_weights=cn_w,
            use_lora=use_lora,
            lora_scale=lora_scale,
            target_size=fit_size(src_w, src_h, int(CONFIG["sd15_fallback_size"][0])),
            use_sdxl=False,
        )
    except Exception as e:  # pragma: no cover — surfaces to FastAPI
        logger.exception("pipeline error")
        raise PipelineError(
            f"generation failed: {e}",
            "فشلت عملية التوليد",
        ) from e


# ----------------------------------------------------------------------------
# Inner generation
# ----------------------------------------------------------------------------


class _OutOfMemory(Exception):
    pass


def _generate(
    *,
    image_path: Path,
    out_path: Path,
    positive: str,
    negative: str,
    style: StyleId,
    strength: float,
    seed: int | None,
    controlnet_weights: tuple[float, float],
    use_lora: bool,
    target_size: tuple[int, int],
    use_sdxl: bool,
    lora_scale: float | None = None,
) -> Path:
    import torch

    loaded = _load_pipeline(use_sdxl=use_sdxl)
    if use_lora:
        _attach_lora(loaded, style, lora_scale)
    else:
        # Force-unload any LoRA from a previous request (ablation cleanliness)
        if loaded.style_loaded is not None:
            try:
                loaded.pipe.unfuse_lora()
                loaded.pipe.unload_lora_weights()
            except Exception:
                pass
            loaded.style_loaded = None

    src, depth, seg = _prepare_conditioning(image_path, target_size)

    generator = None
    if seed is not None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        generator = torch.Generator(device=device).manual_seed(seed)

    kwargs: dict[str, Any] = dict(
        prompt=positive,
        negative_prompt=negative,
        num_inference_steps=int(CONFIG.get("steps", 30)),
        guidance_scale=float(CONFIG.get("guidance", 7.0)),
        generator=generator,
    )
    if loaded.has_seg:
        kwargs["image"] = [depth, seg]
        kwargs["controlnet_conditioning_scale"] = list(controlnet_weights)
    else:  # seg ControlNet unavailable — depth-only conditioning
        kwargs["image"] = depth
        kwargs["controlnet_conditioning_scale"] = float(controlnet_weights[0])
    # SDXL controlnet uses different size kwargs from SD1.5
    if use_sdxl:
        kwargs["width"] = target_size[0]
        kwargs["height"] = target_size[1]

    try:
        result = loaded.pipe(**kwargs)
    except RuntimeError as e:
        if "out of memory" in str(e).lower() or "CUDA" in str(e):
            raise _OutOfMemory(str(e)) from e
        raise

    image = result.images[0]
    image.save(out_path, format="PNG", optimize=True)
    logger.info(
        "wrote %s (style=%s, sdxl=%s, lora=%s, cn=%s, size=%s, seed=%s)",
        out_path, style, use_sdxl, loaded.style_loaded is not None,
        controlnet_weights, target_size, seed,
    )
    _write_manifest(out_path, {
        "tool": "DarDesign", "style": style,
        "model": "stabilityai/stable-diffusion-xl-base-1.0" if use_sdxl else "runwayml/stable-diffusion-v1-5",
        "lora": _lora_path(style).name if loaded.style_loaded is not None else None,
        "lora_scale": loaded.scale_loaded,
        "seed": seed,
        "controlnet": {
            "depth": controlnet_weights[0],
            "seg": controlnet_weights[1] if loaded.has_seg else None,
        },
        "dual_controlnet": loaded.has_seg,
        "use_lora": use_lora, "use_sdxl": use_sdxl, "light_mode": False,
    })
    return out_path
