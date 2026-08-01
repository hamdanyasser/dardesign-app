"""DarDesign local inference pipeline.

This module implements a redesign-first image generation flow:
- SDXL ControlNet Img2Img (Depth + Canny) as primary path.
- SD 1.5 ControlNet Img2Img fallback on CUDA OOM.
- Strong redesign prompting with room-caption + structure hints.
- Optional style LoRA hot-swap per culture.
- Multi-candidate generation and CLIP-based ranking.

Public surface:
    transform_room(image_path, style, *, strength=0.78, **opts) -> Path
"""
from __future__ import annotations

import gc
import logging
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from .settings import (
    SETTINGS,
    collect_runtime_metrics,
    configure_file_logging,
    detect_hardware_profile,
)

logger = logging.getLogger(__name__)

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "configs" / "pipeline.yaml"
LORA_DIR = SETTINGS.models_dir / "loras"
DEFAULT_OUT_DIR = SETTINGS.exports_dir / "inference"

configure_file_logging("inference", SETTINGS.logs_dir)
HW = detect_hardware_profile()
logger.info(
    "runtime profile: device=%s gpu=%s vram_gb=%s cpu_cores=%s ram_gb=%s",
    HW.device,
    HW.gpu_name,
    round(HW.gpu_vram_gb, 2) if HW.gpu_vram_gb else None,
    HW.cpu_cores,
    round(HW.ram_gb, 2) if HW.ram_gb else None,
)

StyleId = Literal["lebanese", "khaleeji", "moroccan"]
StylePack = ("lebanese", "khaleeji", "moroccan")
ProgressCallback = Callable[[float, str, str], None]


class PipelineError(RuntimeError):
    """Raised on unrecoverable pipeline failures."""

    def __init__(self, message_en: str, message_ar: str) -> None:
        super().__init__(message_en)
        self.message_en = message_en
        self.message_ar = message_ar


_DEFAULT_CONFIG: dict[str, Any] = {
    "base_model": "stabilityai/stable-diffusion-xl-base-1.0",
    "fallback_model": "runwayml/stable-diffusion-v1-5",
    "controlnet": {
        "depth_sdxl": "diffusers/controlnet-depth-sdxl-1.0",
        "canny_sdxl": "diffusers/controlnet-canny-sdxl-1.0",
        "depth_sd15": "lllyasviel/sd-controlnet-depth",
        "canny_sd15": "lllyasviel/sd-controlnet-canny",
    },
    "default_controlnet_weights": {"depth": 0.55, "canny": 0.35},
    "steps": 32,
    "guidance": 8.0,
    "strength": 0.78,
    "strength_min": 0.65,
    "strength_max": 0.85,
    "output_size": [1024, 1024],
    "sd15_fallback_size": [768, 768],
    "num_candidates": 4,
    "canny_low": 80,
    "canny_high": 180,
    "caption_model": "Salesforce/blip-image-captioning-base",
    "segment_model": "nvidia/segformer-b5-finetuned-ade-640-640",
    "clip_model": "openai/clip-vit-base-patch32",
    "extra_negative_en": (
        "low resolution, jpeg artifacts, color banding, color change only, "
        "same furniture, same bed, same sofa, same decoration, unchanged room, "
        "simple recolor, filter effect, low transformation, western modern furniture, "
        "empty room, artifacts, distorted furniture"
    ),
    "lora_dir": "models/loras",
    "lora_filename_template": "dardesign-{culture}-lora.safetensors",
    "lora_scale": 0.8,
}

_STYLE_BRIEF: dict[StyleId, str] = {
    "khaleeji": (
        "Redesign as luxurious modern Khaleeji interior: replace all furniture with Gulf majlis or premium"
        " bedroom furniture, elegant curved forms, marble accents, carved wood details, statement chandeliers,"
        " Arabic geometric motifs, layered rich textiles, gold and warm neutral palette, ornamental wall treatments."
    ),
    "lebanese": (
        "Redesign as authentic Lebanese interior: replace all furniture using cedar wood, limestone-inspired surfaces,"
        " Mediterranean-Lebanese composition, handcrafted rugs, warm natural materials, arched details, tasteful"
        " traditional decor from old Lebanese houses."
    ),
    "moroccan": (
        "Redesign as authentic Moroccan interior: replace all furniture and decor with zellige tile accents,"
        " carved wood, tadelakt textures, Moroccan lanterns, horseshoe arches, colorful textiles, intricate"
        " Islamic geometric patterns, layered artisanal materials."
    ),
}


def _load_config() -> dict[str, Any]:
    if yaml is None or not CONFIG_PATH.exists():
        return dict(_DEFAULT_CONFIG)

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            user = yaml.safe_load(fh) or {}
    except Exception:
        logger.exception("failed to read pipeline.yaml; using built-in defaults")
        return dict(_DEFAULT_CONFIG)

    merged = dict(_DEFAULT_CONFIG)
    merged.update(user)

    cn_defaults = dict(_DEFAULT_CONFIG["default_controlnet_weights"])
    cn_defaults.update(user.get("default_controlnet_weights", {}))
    merged["default_controlnet_weights"] = cn_defaults

    cn_models = dict(_DEFAULT_CONFIG["controlnet"])
    cn_models.update(user.get("controlnet", {}))
    merged["controlnet"] = cn_models

    if HW.device == "cuda" and HW.gpu_vram_gb is not None and HW.gpu_vram_gb <= 8.5:
        merged["output_size"] = [min(merged["output_size"][0], 896), min(merged["output_size"][1], 896)]
        merged["steps"] = min(int(merged.get("steps", 32)), 26)
        merged["num_candidates"] = min(int(merged.get("num_candidates", 4)), 3)
    if HW.device == "cpu":
        merged["output_size"] = [768, 768]
        merged["steps"] = min(int(merged.get("steps", 32)), 18)
        merged["num_candidates"] = 1

    return merged


CONFIG = _load_config()


def _is_light_mode() -> bool:
    return os.environ.get("DARDESIGN_LIGHT", "").lower() in ("1", "true", "yes")


def _emit_placeholder(image_path: Path, style: str, out_path: Path) -> Path:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFont

    culture_palette = {
        "lebanese": {"tint": (168, 50, 50), "name": "Lebanese", "ar": "Lebnani"},
        "khaleeji": {"tint": (217, 154, 31), "name": "Khaleeji", "ar": "Khaleeji"},
        "moroccan": {"tint": (30, 80, 143), "name": "Moroccan", "ar": "Maghribi"},
    }
    palette = culture_palette.get(style, {"tint": (212, 175, 55), "name": style.title(), "ar": ""})

    src = Image.open(image_path).convert("RGB").resize((1024, 1024))
    desat = ImageEnhance.Color(src).enhance(0.25)
    tint_layer = Image.new("RGB", src.size, palette["tint"])
    composed = Image.blend(desat, tint_layer, 0.42)

    draw = ImageDraw.Draw(composed)
    draw.rectangle([0, 0, 1024, 110], fill=(12, 10, 8))
    try:
        title_font = ImageFont.truetype("arial.ttf", 30)
        sub_font = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()

    draw.text((28, 22), f"PREVIEW · {palette['name']} · {palette['ar']}", fill=(243, 220, 146), font=title_font)
    draw.text(
        (28, 64),
        "Light mode stand-in. Real generation requires local GPU mode with models available.",
        fill=(232, 216, 184),
        font=sub_font,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    composed.save(out_path, format="PNG", optimize=True)
    logger.warning("DARDESIGN_LIGHT placeholder written to %s (style=%s)", out_path, style)
    return out_path


def _report_progress(
    cb: ProgressCallback | None,
    progress: float,
    stage_en: str,
    stage_ar: str,
) -> None:
    if cb is None:
        return
    try:
        cb(progress, stage_en, stage_ar)
    except Exception:
        logger.exception("progress callback failed at stage=%s", stage_en)


def _lora_path(style: StyleId) -> Path:
    template = CONFIG.get("lora_filename_template", _DEFAULT_CONFIG["lora_filename_template"])
    filename = template.format(culture=style)
    return LORA_DIR / style / filename


@dataclass
class _LoadedPipe:
    pipe: Any
    is_sdxl: bool
    style_loaded: StyleId | None


_PIPE_CACHE: dict[str, _LoadedPipe] = {}
_DEPTH_PROCESSOR: Any | None = None
_SEGMENT_PIPE: Any | None = None
_CAPTION_PIPE: Any | None = None
_CLIP_RANKER: Any | None = None


def _free_pipe(key: str) -> None:
    cached = _PIPE_CACHE.pop(key, None)
    if cached is None:
        return
    try:
        del cached.pipe
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
    key = "sdxl" if use_sdxl else "sd15"
    if key in _PIPE_CACHE:
        return _PIPE_CACHE[key]

    import torch
    from diffusers import (
        ControlNetModel,
        StableDiffusionControlNetImg2ImgPipeline,
        StableDiffusionXLControlNetImg2ImgPipeline,
    )

    dtype = torch.float16 if HW.device == "cuda" else torch.float32
    device = "cuda" if torch.cuda.is_available() else "cpu"
    cn_cfg = CONFIG["controlnet"]

    if use_sdxl:
        depth_cn = ControlNetModel.from_pretrained(cn_cfg["depth_sdxl"], torch_dtype=dtype)
        canny_cn = ControlNetModel.from_pretrained(cn_cfg["canny_sdxl"], torch_dtype=dtype)
        pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(
            CONFIG["base_model"],
            controlnet=[depth_cn, canny_cn],
            torch_dtype=dtype,
            variant="fp16" if dtype == torch.float16 else None,
        )
    else:
        depth_cn = ControlNetModel.from_pretrained(cn_cfg["depth_sd15"], torch_dtype=dtype)
        canny_cn = ControlNetModel.from_pretrained(cn_cfg["canny_sd15"], torch_dtype=dtype)
        pipe = StableDiffusionControlNetImg2ImgPipeline.from_pretrained(
            CONFIG["fallback_model"],
            controlnet=[depth_cn, canny_cn],
            torch_dtype=dtype,
            safety_checker=None,
        )

    if device == "cuda":
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe = pipe.to(device)
        try:
            pipe.enable_attention_slicing("max")
        except Exception:
            pass
        try:
            pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    else:
        pipe = pipe.to(device)

    pipe.set_progress_bar_config(disable=True)

    loaded = _LoadedPipe(pipe=pipe, is_sdxl=use_sdxl, style_loaded=None)
    _PIPE_CACHE[key] = loaded
    logger.info("loaded %s img2img pipeline on %s (dtype=%s)", key, device, dtype)
    return loaded


def _attach_lora(loaded: _LoadedPipe, style: StyleId) -> None:
    if loaded.style_loaded == style:
        return

    try:
        if loaded.style_loaded is not None:
            try:
                loaded.pipe.unfuse_lora()
            except Exception:
                pass
            try:
                loaded.pipe.unload_lora_weights()
            except Exception:
                logger.exception("failed to unload previous LoRA %s", loaded.style_loaded)

        path = _lora_path(style)
        if not path.is_file():
            loaded.style_loaded = None
            logger.warning("LoRA missing for style=%s at %s; prompt-only fallback", style, path)
            return

        loaded.pipe.load_lora_weights(str(path.parent), weight_name=path.name, adapter_name=f"dardesign-{style}")
        scale = float(CONFIG.get("lora_scale", 0.8))
        try:
            loaded.pipe.fuse_lora(lora_scale=scale)
        except Exception:
            pass
        loaded.style_loaded = style
        logger.info("attached LoRA %s (scale=%.2f)", path.name, scale)
    except Exception:
        logger.exception("LoRA load failed for style=%s; continuing prompt-only", style)
        loaded.style_loaded = None


def _get_depth_processor() -> Any:
    global _DEPTH_PROCESSOR
    if _DEPTH_PROCESSOR is not None:
        return _DEPTH_PROCESSOR

    from controlnet_aux import MidasDetector  # type: ignore

    try:
        from controlnet_aux import DepthAnythingDetector  # type: ignore

        _DEPTH_PROCESSOR = DepthAnythingDetector.from_pretrained("lllyasviel/Annotators")
    except Exception:
        _DEPTH_PROCESSOR = MidasDetector.from_pretrained("lllyasviel/Annotators")
    return _DEPTH_PROCESSOR


def _caption_room(image: Any) -> str:
    global _CAPTION_PIPE

    try:
        from transformers import pipeline
    except Exception:
        return "interior room"

    if _CAPTION_PIPE is None:
        try:
            _CAPTION_PIPE = pipeline("image-to-text", model=CONFIG.get("caption_model", _DEFAULT_CONFIG["caption_model"]))
        except Exception:
            logger.exception("caption model unavailable; using fallback caption")
            return "interior room"

    try:
        out = _CAPTION_PIPE(image, max_new_tokens=45)
        if out and isinstance(out, list):
            text = (out[0].get("generated_text") or "").strip()
            if text:
                return text
    except Exception:
        logger.exception("captioning failed; using fallback caption")

    return "interior room"


def _segment_room_structure(image: Any) -> dict[str, float]:
    global _SEGMENT_PIPE

    default = {
        "wall": 0.0,
        "floor": 0.0,
        "ceiling": 0.0,
        "window": 0.0,
        "door": 0.0,
        "furniture": 0.0,
    }

    try:
        from transformers import pipeline
    except Exception:
        return default

    if _SEGMENT_PIPE is None:
        try:
            _SEGMENT_PIPE = pipeline("image-segmentation", model=CONFIG.get("segment_model", _DEFAULT_CONFIG["segment_model"]))
        except Exception:
            logger.exception("segmentation model unavailable; skipping segmentation hints")
            return default

    aliases = {
        "wall": "wall",
        "floor": "floor",
        "ceiling": "ceiling",
        "window": "windowpane",
        "door": "door",
    }

    try:
        segments = _SEGMENT_PIPE(image)
        for row in segments:
            label = str(row.get("label", "")).lower()
            score = float(row.get("score", 0.0))
            if label == aliases["wall"]:
                default["wall"] = max(default["wall"], score)
            elif label == aliases["floor"]:
                default["floor"] = max(default["floor"], score)
            elif label == aliases["ceiling"]:
                default["ceiling"] = max(default["ceiling"], score)
            elif label == aliases["window"]:
                default["window"] = max(default["window"], score)
            elif label == aliases["door"]:
                default["door"] = max(default["door"], score)
            elif "bed" in label or "sofa" in label or "chair" in label or "table" in label or "cabinet" in label:
                default["furniture"] = max(default["furniture"], score)
    except Exception:
        logger.exception("segmentation inference failed; skipping segmentation hints")

    return default


def _build_prompt_bundle(
    *,
    style: StyleId,
    room: str | None,
    caption: str,
    structure: dict[str, float],
    use_ontology: bool,
) -> tuple[str, str]:
    base_room = (room or "interior room").strip()

    ontology_text = ""
    ontology_neg = ""
    if use_ontology:
        try:
            from backend.prompt_builder import build_prompts

            prompts = build_prompts(style, room=base_room)
            ontology_text = prompts.positive_en
            ontology_neg = prompts.negative_en
        except Exception:
            logger.exception("ontology prompt build failed; continuing with style brief only")

    structural_parts = []
    if structure.get("window", 0.0) > 0.35:
        structural_parts.append("preserve window placement")
    if structure.get("door", 0.0) > 0.35:
        structural_parts.append("preserve door placement")
    if structure.get("floor", 0.0) > 0.2:
        structural_parts.append("preserve floor geometry")
    if structure.get("ceiling", 0.0) > 0.2:
        structural_parts.append("preserve ceiling direction")
    structural_hint = ", ".join(structural_parts) if structural_parts else "preserve architecture and camera perspective"

    style_brief = _STYLE_BRIEF[style]

    positive = (
        f"Complete interior redesign task for a {base_room}. "
        f"Input scene description: {caption}. "
        f"{style_brief} "
        "Replace all existing furniture, rugs, curtains, lamps, wall decor, textures, and materials with culturally "
        "authentic design elements. Keep only room dimensions, walls, floor structure, windows, doors, and lighting direction. "
        f"{structural_hint}. "
        "Do not keep the original furniture design. Interior designer quality, photorealistic, magazine-grade, highly detailed."
    )
    if ontology_text:
        positive = f"{positive} Cultural style vocabulary: {ontology_text}."

    negative_chunks = [
        CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"]),
        "color change only",
        "same furniture",
        "same bed",
        "same sofa",
        "same decoration",
        "unchanged room",
        "simple recolor",
        "filter effect",
        "low transformation",
        "flat redesign",
        "generic western furniture",
        "distorted architecture",
    ]
    if ontology_neg:
        negative_chunks.append(ontology_neg)

    negative = ", ".join(chunk for chunk in negative_chunks if chunk)
    return positive, negative


def _prepare_conditioning(
    image_path: Path,
    target_size: tuple[int, int],
    *,
    use_segmentation: bool,
) -> tuple[Any, Any, Any, str, dict[str, float]]:
    import numpy as np
    from PIL import Image, ImageFilter

    src = Image.open(image_path).convert("RGB").resize(target_size)

    depth_proc = _get_depth_processor()
    depth = depth_proc(src)

    arr = np.array(src)
    try:
        import cv2  # type: ignore

        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        low = int(CONFIG.get("canny_low", 80))
        high = int(CONFIG.get("canny_high", 180))
        edges = cv2.Canny(gray, low, high)
        canny = Image.fromarray(edges).convert("RGB")
    except Exception:
        # Fallback edge map if OpenCV is not available.
        canny = src.convert("L").filter(ImageFilter.FIND_EDGES).convert("RGB")
        logger.warning("OpenCV unavailable; using PIL edge fallback for canny conditioning")

    caption = _caption_room(src)
    structure = _segment_room_structure(src) if use_segmentation else {
        "wall": 0.0,
        "floor": 0.0,
        "ceiling": 0.0,
        "window": 0.0,
        "door": 0.0,
        "furniture": 0.0,
    }

    return src, depth, canny, caption, structure


class _OutOfMemory(Exception):
    pass


class _ClipRanker:
    def __init__(self, model_name: str) -> None:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = CLIPProcessor.from_pretrained(model_name)
        self.model = CLIPModel.from_pretrained(model_name).to(self.device)
        self.model.eval()

    def score(self, image: Any, text: str) -> float:
        with self.torch.no_grad():
            inputs = self.processor(text=[text], images=[image], return_tensors="pt", padding=True)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            out = self.model(**inputs)
            return float(out.logits_per_image.squeeze().item())


def _get_ranker() -> _ClipRanker | None:
    global _CLIP_RANKER
    if _CLIP_RANKER is not None:
        return _CLIP_RANKER

    try:
        _CLIP_RANKER = _ClipRanker(CONFIG.get("clip_model", _DEFAULT_CONFIG["clip_model"]))
        return _CLIP_RANKER
    except Exception:
        logger.exception("CLIP ranker unavailable; candidate 0 will be used")
        return None


def _pick_best_candidate(candidates: list[Any], style: StyleId) -> tuple[Any, int]:
    if len(candidates) == 1:
        return candidates[0], 0

    ranker = _get_ranker()
    if ranker is None:
        return candidates[0], 0

    style_text = {
        "khaleeji": "luxury khaleeji arabian interior with majlis furniture, chandelier, marble and ornate details",
        "lebanese": "traditional lebanese interior with cedar wood, limestone and mediterranean warm materials",
        "moroccan": "authentic moroccan interior with zellige tiles, lanterns and carved wood",
    }[style]
    redesign_text = "fully redesigned room with new furniture and decoration, not a recolor"

    best_idx = 0
    best_score = float("-inf")
    for idx, image in enumerate(candidates):
        try:
            style_score = ranker.score(image, style_text)
            redesign_score = ranker.score(image, redesign_text)
            total = 0.62 * style_score + 0.38 * redesign_score
            if total > best_score:
                best_score = total
                best_idx = idx
        except Exception:
            logger.exception("candidate ranking failed for idx=%s", idx)

    return candidates[best_idx], best_idx


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
    use_segmentation: bool,
    progress_cb: ProgressCallback | None,
) -> Path:
    import torch

    _report_progress(progress_cb, 0.12, "Loading AI model", "جارٍ تحميل نموذج الذكاء الاصطناعي")
    loaded = _load_pipeline(use_sdxl=use_sdxl)

    if use_lora:
        _report_progress(progress_cb, 0.2, "Applying culture LoRA", "جارٍ تطبيق نموذج الثقافة")
        _attach_lora(loaded, style)
    elif loaded.style_loaded is not None:
        try:
            loaded.pipe.unfuse_lora()
        except Exception:
            pass
        try:
            loaded.pipe.unload_lora_weights()
        except Exception:
            pass
        loaded.style_loaded = None

    src, depth, canny, caption, structure = _prepare_conditioning(
        image_path,
        target_size,
        use_segmentation=use_segmentation,
    )
    _report_progress(progress_cb, 0.32, "Preprocessing image", "جارٍ تجهيز الصورة")
    positive, negative = _build_prompt_bundle(
        style=style,
        room=None,
        caption=caption,
        structure=structure,
        use_ontology=True,
    ) if positive == "__AUTO__" else (positive, negative)

    base_seed = seed if seed is not None else random.randint(1, 2_000_000_000)
    num_candidates = max(1, int(CONFIG.get("num_candidates", 4)))
    candidates: list[Any] = []

    _report_progress(progress_cb, 0.4, "Starting AI generation", "بدء التوليد بالذكاء الاصطناعي")

    for idx in range(num_candidates):
        this_seed = base_seed + idx
        generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(this_seed)

        kwargs: dict[str, Any] = dict(
            prompt=positive,
            negative_prompt=negative,
            image=src,
            control_image=[depth, canny],
            controlnet_conditioning_scale=list(controlnet_weights),
            strength=strength,
            num_inference_steps=int(CONFIG.get("steps", 32)),
            guidance_scale=float(CONFIG.get("guidance", 8.0)),
            generator=generator,
        )
        if use_sdxl:
            kwargs["width"] = target_size[0]
            kwargs["height"] = target_size[1]

        try:
            _report_progress(
                progress_cb,
                0.42 + (0.38 * idx / max(1, num_candidates)),
                f"Generating candidate {idx + 1}/{num_candidates}",
                f"جارٍ توليد النتيجة {idx + 1} من {num_candidates}",
            )
            out = loaded.pipe(**kwargs)
            candidates.append(out.images[0])
        except RuntimeError as e:
            message = str(e).lower()
            if "out of memory" in message or "cuda" in message:
                raise _OutOfMemory(str(e)) from e
            raise

    _report_progress(progress_cb, 0.83, "Ranking generated candidates", "جارٍ تقييم النتائج المولدة")
    chosen, chosen_idx = _pick_best_candidate(candidates, style)
    _report_progress(progress_cb, 0.92, "Finalizing output image", "جارٍ تجهيز الصورة النهائية")
    chosen.save(out_path, format="PNG", optimize=True)

    logger.info(
        "wrote %s (style=%s, sdxl=%s, lora=%s, cn=%s, size=%s, strength=%.2f, seed=%s, candidates=%s, chosen=%s)",
        out_path,
        style,
        use_sdxl,
        loaded.style_loaded is not None,
        controlnet_weights,
        target_size,
        strength,
        base_seed,
        len(candidates),
        chosen_idx,
    )
    return out_path


def transform_room(
    image_path: str | Path,
    style: StyleId,
    *,
    strength: float = 0.78,
    out_dir: str | Path | None = None,
    seed: int | None = None,
    room: str | None = None,
    use_lora: bool = True,
    use_segmentation: bool = True,
    use_ontology: bool = True,
    controlnet_weights: tuple[float, float] | None = None,
    progress_cb: ProgressCallback | None = None,
) -> Path:
    """Transform a room photo into a cultural redesign.

    This function intentionally favors complete redesign over subtle recolor.
    """
    if style not in StylePack:
        raise PipelineError(f"unknown style {style!r}", "Unknown style")

    image_path = Path(image_path)
    if not image_path.exists():
        raise PipelineError(f"input image not found: {image_path}", "Input image not found")

    out_dir = Path(out_dir) if out_dir is not None else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{image_path.stem}_{style}_{int(time.time())}.png"

    if _is_light_mode():
        _report_progress(progress_cb, 0.15, "Light mode placeholder generation", "إنشاء نتيجة مؤقتة للوضع الخفيف")
        return _emit_placeholder(image_path, style, out_path)

    if use_ontology:
        try:
            from backend.prompt_builder import build_prompts

            prompts = build_prompts(style, room=room, seed=seed)
            positive = (
                f"Complete interior redesign of a {room or 'room'}. "
                f"{_STYLE_BRIEF[style]} "
                "Replace existing furniture, carpets, curtains, tables, and wall decor with new culturally authentic pieces. "
                "Keep only architecture, room dimensions, perspective, windows, doors, walls, floor structure, and lighting direction. "
                f"Style vocabulary: {prompts.positive_en}"
            )
            negative = ", ".join(
                [
                    prompts.negative_en,
                    CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"]),
                ]
            )
        except Exception:
            logger.exception("prompt builder failed; using internal auto prompt")
            positive = "__AUTO__"
            negative = CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"])
    else:
        positive = "__AUTO__"
        negative = CONFIG.get("extra_negative_en", _DEFAULT_CONFIG["extra_negative_en"])

    cn_defaults = CONFIG["default_controlnet_weights"]
    cn_w = controlnet_weights or (float(cn_defaults["depth"]), float(cn_defaults["canny"]))

    if not use_segmentation:
        cn_w = (cn_w[0], min(cn_w[1], 0.25))

    strength_min = float(CONFIG.get("strength_min", 0.65))
    strength_max = float(CONFIG.get("strength_max", 0.85))
    effective_strength = max(strength_min, min(strength_max, strength))

    started = time.perf_counter()
    metrics_before = collect_runtime_metrics()
    logger.info("preprocessing start image=%s style=%s", image_path, style)
    _report_progress(progress_cb, 0.08, "Preparing transformation inputs", "جارٍ تجهيز مدخلات التحويل")

    try:
        result = _generate(
            image_path=image_path,
            out_path=out_path,
            positive=positive,
            negative=negative,
            style=style,
            strength=effective_strength,
            seed=seed,
            controlnet_weights=cn_w,
            use_lora=use_lora,
            target_size=tuple(CONFIG["output_size"]),
            use_sdxl=True,
            use_segmentation=use_segmentation,
            progress_cb=progress_cb,
        )
        _report_progress(progress_cb, 1.0, "Transformation finished", "اكتمل التحويل")
        logger.info(
            "inference completed in %.2fs | before=%s | after=%s",
            time.perf_counter() - started,
            metrics_before,
            collect_runtime_metrics(),
        )
        return result
    except _OutOfMemory:
        _report_progress(progress_cb, 0.5, "Switching to fallback model", "التحويل إلى نموذج بديل")
        logger.warning("SDXL OOM - releasing pipeline and falling back to SD 1.5")
        _free_pipe("sdxl")
        result = _generate(
            image_path=image_path,
            out_path=out_path,
            positive=positive,
            negative=negative,
            style=style,
            strength=effective_strength,
            seed=seed,
            controlnet_weights=cn_w,
            use_lora=use_lora,
            target_size=tuple(CONFIG["sd15_fallback_size"]),
            use_sdxl=False,
            use_segmentation=use_segmentation,
            progress_cb=progress_cb,
        )
        _report_progress(progress_cb, 1.0, "Transformation finished", "اكتمل التحويل")
        logger.info(
            "inference completed via fallback in %.2fs | before=%s | after=%s",
            time.perf_counter() - started,
            metrics_before,
            collect_runtime_metrics(),
        )
        return result
    except Exception as e:
        logger.exception("pipeline error")
        _report_progress(progress_cb, 0.99, "Transformation failed", "فشل التحويل")
        raise PipelineError(f"generation failed: {e}", "Generation failed") from e
