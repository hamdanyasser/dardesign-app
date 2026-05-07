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

StyleId = Literal["lebanese", "khaleeji", "moroccan"]
StylePack = ("lebanese", "khaleeji", "moroccan")


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
        "seg_sdxl": "diffusers/controlnet-seg-sdxl-1.0",
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


# ----------------------------------------------------------------------------
# Light mode (no GPU)
# ----------------------------------------------------------------------------


def _is_light_mode() -> bool:
    return os.environ.get("DARDESIGN_LIGHT", "").lower() in ("1", "true", "yes")


def _emit_placeholder(image_path: Path, style: str, out_path: Path) -> Path:
    """Generate a labelled placeholder so frontend/backend can be tested without a GPU."""
    from PIL import Image, ImageDraw, ImageFont  # local import — pillow is light

    src = Image.open(image_path).convert("RGB")
    src = src.resize((1024, 1024))
    overlay = Image.new("RGBA", src.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    band_h = 96
    draw.rectangle([0, src.size[1] - band_h, src.size[0], src.size[1]], fill=(20, 17, 10, 220))
    label = f"DARDESIGN_LIGHT placeholder — style={style}"
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    draw.text((24, src.size[1] - band_h + 32), label, fill=(212, 175, 55, 255), font=font)

    composed = Image.alpha_composite(src.convert("RGBA"), overlay).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    composed.save(out_path, format="PNG", optimize=True)
    logger.warning("DARDESIGN_LIGHT placeholder written to %s — NOT a real generation", out_path)
    return out_path


# ----------------------------------------------------------------------------
# LoRA management
# ----------------------------------------------------------------------------


def _lora_path(style: StyleId) -> Path:
    template = CONFIG.get("lora_filename_template", _DEFAULT_CONFIG["lora_filename_template"])
    filename = template.format(culture=style)
    return LORA_DIR / style / filename


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
    if use_sdxl:
        depth_cn = ControlNetModel.from_pretrained(cn_cfg["depth_sdxl"], torch_dtype=dtype)
        seg_cn = ControlNetModel.from_pretrained(cn_cfg["seg_sdxl"], torch_dtype=dtype)
        pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
            CONFIG["base_model"],
            controlnet=[depth_cn, seg_cn],
            torch_dtype=dtype,
            variant="fp16" if dtype == torch.float16 else None,
        )
    else:
        depth_cn = ControlNetModel.from_pretrained(cn_cfg["depth_sd15"], torch_dtype=dtype)
        seg_cn = ControlNetModel.from_pretrained(cn_cfg["seg_sd15"], torch_dtype=dtype)
        pipe = StableDiffusionControlNetPipeline.from_pretrained(
            CONFIG["fallback_model"],
            controlnet=[depth_cn, seg_cn],
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

    loaded = _LoadedPipe(pipe=pipe, is_sdxl=use_sdxl, style_loaded=None)
    _PIPE_CACHE[key] = loaded
    logger.info("loaded %s pipeline on %s (dtype=%s)", key, device, dtype)
    return loaded


def _attach_lora(loaded: _LoadedPipe, style: StyleId) -> None:
    """Lazy-load and fuse the LoRA for `style`. Hot-swaps if a different style is loaded."""
    if loaded.style_loaded == style:
        return  # already attached

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
            logger.warning(
                "LoRA file not found for style=%s at %s — falling back to prompt-only",
                style, path,
            )
            return

        loaded.pipe.load_lora_weights(
            str(path.parent),
            weight_name=path.name,
            adapter_name=f"dardesign-{style}",
        )
        scale = float(CONFIG.get("lora_scale", 0.8))
        try:
            loaded.pipe.fuse_lora(lora_scale=scale)
        except Exception:
            # Older diffusers: scale is set at call time via cross_attention_kwargs
            pass
        loaded.style_loaded = style
        logger.info("attached LoRA %s (scale=%.2f)", path.name, scale)
    except Exception:
        logger.exception("LoRA load failed for style=%s — continuing prompt-only", style)
        loaded.style_loaded = None


# ----------------------------------------------------------------------------
# Conditioning (depth + seg)
# ----------------------------------------------------------------------------


def _prepare_conditioning(image_path: Path, target_size: tuple[int, int]) -> tuple[Any, Any, Any]:
    """Return (resized_input_pil, depth_pil, seg_pil)."""
    from PIL import Image
    from controlnet_aux import OneFormerSegmentor  # type: ignore
    try:
        from controlnet_aux import DepthAnythingDetector  # type: ignore
    except ImportError:  # older controlnet_aux
        from controlnet_aux import MidasDetector as DepthAnythingDetector  # type: ignore

    src = Image.open(image_path).convert("RGB").resize(target_size)

    depth_proc = DepthAnythingDetector.from_pretrained("lllyasviel/Annotators")
    depth = depth_proc(src)

    try:
        seg_proc = OneFormerSegmentor.from_pretrained(
            "shi-labs/oneformer_ade20k_swin_large"
        )
        seg = seg_proc(src)
    except Exception:
        logger.exception("OneFormer ADE20K unavailable; using depth as both control inputs")
        seg = depth

    return src, depth, seg


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

    cn_w = controlnet_weights or (
        CONFIG["default_controlnet_weights"]["depth"],
        CONFIG["default_controlnet_weights"]["seg"],
    )
    if not use_segmentation:
        cn_w = (cn_w[0], 0.0)

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
            target_size=tuple(CONFIG["output_size"]),
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
            target_size=tuple(CONFIG["sd15_fallback_size"]),
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
) -> Path:
    import torch

    loaded = _load_pipeline(use_sdxl=use_sdxl)
    if use_lora:
        _attach_lora(loaded, style)
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
        image=[depth, seg],
        controlnet_conditioning_scale=list(controlnet_weights),
        num_inference_steps=int(CONFIG.get("steps", 30)),
        guidance_scale=float(CONFIG.get("guidance", 7.0)),
        generator=generator,
    )
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
    return out_path
