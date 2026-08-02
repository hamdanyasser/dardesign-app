"""Generate the transparent-PNG furniture catalogue assets for DarDesign.

Two stages, deliberately split so you only rent a GPU for the half that needs one:

    generate   GPU REQUIRED       SDXL + the culture's own trained LoRA renders each
                                  catalogue item as a product shot on a plain white
                                  background. Run this on Colab T4.
    cutout     GPU NOT NEEDED     rembg strips the white background to alpha. Runs on
                                  your laptop's CPU in seconds per image.

After `generate` finishes you can SAFE TO DISCONNECT GPU — nothing else in this
feature needs one.

Why self-generated assets: the catalogue images are ours, so there is no third-party
licensing to justify (unlike scraped stock PNGs), and each culture's furniture is
rendered by that culture's own LoRA — the same model that styles the rooms.

Usage
-----
On Colab (GPU), one culture at a time so only one LoRA is resident:

    python scripts/generate_furniture_assets.py generate --culture lebanese --variants 3
    python scripts/generate_furniture_assets.py generate --culture khaleeji --variants 3
    python scripts/generate_furniture_assets.py generate --culture moroccan --variants 3

Locally (CPU) once the raw renders are downloaded:

    pip install rembg onnxruntime
    python scripts/generate_furniture_assets.py cutout

Then look at public/furniture/<culture>/<id>_v*.png, pick the best variant per item,
and rename it to <id>.png (the path the catalogue's "asset" field points at).

Expected output
---------------
    assets/furniture_raw/<culture>/<id>_v<n>.png    white-background renders
    public/furniture/<culture>/<id>_v<n>.png        transparent cut-outs
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "ontology" / "furniture.json"
RAW_DIR = ROOT / "assets" / "furniture_raw"
OUT_DIR = ROOT / "public" / "furniture"
LORA_DIR = ROOT / "models" / "loras"

BASE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
# fp16-safe VAE — the stock SDXL VAE overflows to NaN in fp16 (same fix the
# trainer and backend use).
VAE_PATH = "madebyollin/sdxl-vae-fp16-fix"

# Product-shot framing. The "plain white background" and "no cast shadow" parts
# matter: rembg keys off a clean background, and a shadow baked into the render
# would survive cut-out and fight the contact shadow the compositor draws later.
STYLE_SUFFIX = (
    "isolated product photograph on a seamless pure white studio backdrop, "
    "no wall behind it, no floor beneath it, no room, no background scenery, "
    "single object completely cut out against flat white, three-quarter view, "
    "the entire object visible and centered, soft even studio lighting, "
    "no cast shadow, sharp focus, high detail, e-commerce catalogue photography"
)
# The culture LoRAs were trained exclusively on room interiors, so at high scale they
# drag architecture into every render (stone walls, arches, columns, floor lines).
# These negatives push back on that; --lora-scale is the other half of the fix.
NEGATIVE = (
    "room, interior scene, floor, floorboards, wall, stone wall, brick wall, masonry, "
    "arch, archway, column, pillar, architecture, architectural background, ceiling, "
    "window, curtain, rug, carpet, furniture set, multiple objects, duplicated object, "
    "people, cropped, cut off, out of frame, cast shadow on background, "
    "textured background, patterned background, scenery, "
    # Flat surfaces attract styling props: the first run put a bowl and a plant on
    # mor-table and khal-side. Anything resting on the item composites into the
    # room with it, so forbid it explicitly.
    "objects on top, bowl, vase, plant, books, tray, decoration on top, styled tabletop, "
    "text, watermark, signature, logo, blurry, low quality, distorted perspective"
)
# Low by default, on purpose. At 0.8 (the backend's room-rendering scale) the LoRA
# summons a whole Lebanese/Khaleeji/Moroccan room around the object. The catalogue's
# own generation_prompt already carries the cultural specificity ("carved walnut,
# woven rush seat"), so the LoRA only needs to season it. Pass 0 to disable entirely.
DEFAULT_LORA_SCALE = 0.35


def load_catalogue(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"catalogue not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_trigger(culture: str) -> str:
    """Trigger phrase for the culture's LoRA, read from the ontology so it can't drift."""
    onto = ROOT / "ontology" / "ontology.json"
    try:
        return json.loads(onto.read_text(encoding="utf-8"))["trigger"][culture]["en"]
    except Exception:
        return f"dardesign-{culture} style"


def _lora_file(culture: str) -> Path | None:
    p = LORA_DIR / culture / f"dardesign-{culture}-lora.safetensors"
    return p if p.is_file() else None


def generate(culture: str, variants: int, steps: int, guidance: float, seed: int,
             catalogue_path: Path, raw_dir: Path, lora_scale: float) -> int:
    """GPU REQUIRED. Render every catalogue item for one culture as a white-bg product shot."""
    import torch
    from diffusers import AutoencoderKL, StableDiffusionXLPipeline

    cat = load_catalogue(catalogue_path)
    items = [i for i in cat["items"] if i["culture"] == culture]
    if not items:
        raise SystemExit(f"no items for culture={culture} in {catalogue_path}")

    if not torch.cuda.is_available():
        raise SystemExit(
            "no CUDA device. This stage is GPU REQUIRED — run it on Colab T4.\n"
            "The 'cutout' stage is the one that runs on your laptop."
        )

    trigger = load_trigger(culture)
    lora = _lora_file(culture)

    pipe = StableDiffusionXLPipeline.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        vae=AutoencoderKL.from_pretrained(VAE_PATH, torch_dtype=torch.float16),
    )
    pipe.enable_model_cpu_offload()
    pipe.set_progress_bar_config(disable=True)

    if lora is not None and lora_scale > 0:
        # The trainer saves raw peft keys; the pipeline loader expects 'unet.<path>'.
        # Reuse the backend's remapper so the two can never drift apart.
        from backend.transform import _load_lora_state_dict
        pipe.load_lora_weights(_load_lora_state_dict(lora))
        pipe.fuse_lora(lora_scale=lora_scale)
        logger.info("fused LoRA %s at scale %.2f", lora.name, lora_scale)
    elif lora is not None:
        logger.info("LoRA present but --lora-scale=0 — rendering with base SDXL only")
    else:
        logger.warning(
            "no LoRA at %s — falling back to prompt-only for %s. Assets will be less "
            "culturally specific; copy the .safetensors in and re-run if that matters.",
            LORA_DIR / culture, culture,
        )

    out_root = raw_dir / culture
    out_root.mkdir(parents=True, exist_ok=True)
    written = 0

    for item in items:
        prompt = f"{item['generation_prompt']}, {trigger}, {STYLE_SUFFIX}"
        for v in range(1, variants + 1):
            out = out_root / f"{item['id']}_v{v}.png"
            if out.exists():
                logger.info("skip (exists) %s", out.name)
                continue
            g = torch.Generator(device="cuda").manual_seed(seed + v)
            try:
                img = pipe(
                    prompt=prompt, negative_prompt=NEGATIVE,
                    num_inference_steps=steps, guidance_scale=guidance,
                    width=1024, height=1024, generator=g,
                ).images[0]
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                raise SystemExit(
                    f"CUDA out of memory on {item['id']} v{v}. Re-run with fewer variants, "
                    f"or restart the runtime and process one culture at a time."
                )
            img.save(out)
            written += 1
            logger.info("%s -> %s", item["id"], out.name)

    del pipe
    torch.cuda.empty_cache()
    print(f"\n[generate] wrote {written} renders to {out_root}")
    print("[generate] SAFE TO DISCONNECT GPU — the cutout stage runs on CPU.")
    return written


def trim_to_content(im, pad: int = 2):
    """Crop transparent margins so the canvas equals the visible object.

    rembg keeps the render's full 1024x1024 frame, but the furniture inside fills
    wildly different fractions of it — measured across the catalogue, anywhere
    from 19% (a narrow lamp) to 97% (a round pouf). The placement engine sizes a
    box from the item's real-world centimetres and the compositor draws the PNG
    into that box, so untrimmed padding makes the lamp render at a quarter of its
    true size while the pouf renders at full size. Trimming makes the image
    boundary mean the same thing for every item.

    A couple of pixels of padding are kept so anti-aliased edges aren't clipped.
    """
    from PIL import Image
    import numpy as np

    rgba = im.convert("RGBA")
    alpha = np.asarray(rgba)[..., 3] > 8
    if not alpha.any():
        return rgba  # fully transparent — nothing to trim, leave it alone
    ys, xs = np.where(alpha)
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(rgba.width, int(xs.max()) + 1 + pad)
    y1 = min(rgba.height, int(ys.max()) + 1 + pad)
    return rgba.crop((x0, y0, x1, y1))


def trim_existing(out_dir: Path, culture: str | None) -> int:
    """GPU NOT NEEDED. Trim already-written PNGs in place.

    For assets produced before trimming existed — run once, then the cutout stage
    keeps everything trimmed from here on. Idempotent: an already-tight PNG is
    left as-is.
    """
    from PIL import Image

    cultures = [culture] if culture else [p.name for p in out_dir.iterdir() if p.is_dir()]
    changed = 0
    for c in cultures:
        d = out_dir / c
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.png")):
            try:
                with Image.open(p) as im:
                    before = im.size
                    out = trim_to_content(im)
                if out.size == before:
                    continue
                out.save(p)
                changed += 1
                logger.info("%s  %sx%s -> %sx%s", p.name, *before, *out.size)
            except Exception as e:  # noqa: BLE001
                logger.error("trim failed for %s: %s", p.name, e)
    print(f"\n[trim] trimmed {changed} PNG(s) under {out_dir}")
    return changed


def cutout(raw_dir: Path, out_dir: Path, culture: str | None) -> int:
    """GPU NOT NEEDED. Strip the white background to alpha with rembg."""
    try:
        from rembg import remove
    except ImportError:
        raise SystemExit("rembg not installed. Run:  pip install rembg onnxruntime")
    from PIL import Image

    cultures = [culture] if culture else [p.name for p in raw_dir.iterdir() if p.is_dir()]
    written = 0
    for c in cultures:
        src_dir = raw_dir / c
        if not src_dir.is_dir():
            logger.warning("no raw renders for %s at %s — run the generate stage first", c, src_dir)
            continue
        dst_dir = out_dir / c
        dst_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted(src_dir.glob("*.png")):
            dst = dst_dir / src.name
            try:
                with Image.open(src) as im:
                    result = remove(im.convert("RGBA"))
                # Trim here so the canvas equals the object: the compositor draws
                # each asset into a box sized from its real-world dimensions, and
                # leftover transparent margin would shrink it by an arbitrary,
                # per-item amount.
                result = trim_to_content(result)
                result.save(dst)
            except Exception as e:  # noqa: BLE001
                logger.error("cutout failed for %s: %s", src.name, e)
                continue
            written += 1
            logger.info("%s -> %s", src.name, dst)

    print(f"\n[cutout] wrote {written} transparent PNGs under {out_dir}")
    print("[cutout] next: eyeball the variants, then rename the best of each item")
    print("[cutout]       from <id>_v<n>.png to <id>.png — that's the path the")
    print("[cutout]       catalogue's \"asset\" field points at.")
    return written


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="stage", required=True)

    g = sub.add_parser("generate", help="GPU REQUIRED — render white-background product shots")
    g.add_argument("--culture", required=True, choices=["lebanese", "khaleeji", "moroccan"])
    g.add_argument("--variants", type=int, default=3, help="renders per item to choose from")
    g.add_argument("--steps", type=int, default=30)
    g.add_argument("--guidance", type=float, default=7.0)
    g.add_argument("--seed", type=int, default=42)
    g.add_argument("--lora-scale", type=float, default=DEFAULT_LORA_SCALE,
                   help="0 = base SDXL only. The culture LoRAs were trained on rooms, so "
                        "high scales drag walls/arches into product shots (default: %(default)s)")
    g.add_argument("--catalogue", type=Path, default=CATALOGUE)
    g.add_argument("--raw-dir", type=Path, default=RAW_DIR)

    c = sub.add_parser("cutout", help="GPU NOT NEEDED — rembg white background to alpha")
    c.add_argument("--culture", default=None, help="default: every culture found in raw-dir")
    c.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    c.add_argument("--out-dir", type=Path, default=OUT_DIR)

    tr = sub.add_parser(
        "trim", help="GPU NOT NEEDED — crop transparent margins on existing PNGs in place"
    )
    tr.add_argument("--culture", default=None)
    tr.add_argument("--out-dir", type=Path, default=OUT_DIR)

    a = ap.parse_args()
    if a.stage == "generate":
        generate(a.culture, a.variants, a.steps, a.guidance, a.seed, a.catalogue,
                 a.raw_dir, a.lora_scale)
    elif a.stage == "trim":
        trim_existing(a.out_dir, a.culture)
    else:
        cutout(a.raw_dir, a.out_dir, a.culture)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))  # so `from backend.transform import ...` resolves
    raise SystemExit(main())
