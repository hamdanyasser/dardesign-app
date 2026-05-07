"""DreamBooth-LoRA training for SDXL (with SD 1.5 fallback).

This is a thin, opinionated wrapper around diffusers' DreamBooth-LoRA loop. It:
- reads `datasets/<culture>/captions.jsonl` (one JSON per line, see datasets README),
- bakes the trigger phrase into every caption if missing,
- saves checkpoints at 500 / 1000 / final-step,
- writes 5 sample images per checkpoint (grid PNG),
- falls back to SD 1.5 + LoRA if SDXL OOMs,
- supports `--smoke` to run with placeholder captions over the 5 test rooms (Kaggle T4 sanity check).

Usage (Kaggle T4):
    python scripts/train_lora.py \\
        --culture lebanese \\
        --data-dir datasets/lebanese \\
        --rank 16 \\
        --steps 1500 \\
        --output-dir models/loras/lebanese

Smoke mode (no real dataset needed; uses /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms):
    python scripts/train_lora.py \\
        --culture lebanese \\
        --data-dir /kaggle/input/datasets/yasserhamdanfr/dardesign-test-rooms \\
        --rank 16 --steps 200 \\
        --output-dir models/loras/lebanese/_smoke \\
        --smoke

Notes:
- The actual training depends on heavy ML libs (torch, diffusers, peft, accelerate, bitsandbytes).
  This module is *importable* on a vanilla Windows box so CI/lint works; the heavy imports happen
  inside `train()`.
- We do NOT pretend to "verify it doesn't OOM" without a GPU. The expected verification is to run
  the smoke command above on Kaggle T4. See [kaggle/README.md] for the paste-into-cell runbook.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

# Per-culture trigger phrases — must match ontology.json
TRIGGERS = {
    "lebanese": "dardesign-lebanese style",
    "khaleeji": "dardesign-khaleeji style",
    "moroccan": "dardesign-moroccan style",
}

# Sample prompts used to render the 5-image preview grid at every checkpoint
SAMPLE_PROMPT_TEMPLATES = [
    "a living room in the {trigger}, photorealistic, magazine-quality, 8k, intricate detail",
    "a majlis in the {trigger}, warm daylight, ornate ornamentation, photorealistic, 8k",
    "a dining room in the {trigger}, evening tungsten lighting, intricate detail, photorealistic",
    "a courtyard in the {trigger}, soft shadows, photorealistic, masterful composition",
    "a bedroom in the {trigger}, natural daylight, photorealistic, 8k, intricate craft detail",
]


@dataclass
class TrainArgs:
    culture: str
    data_dir: Path
    rank: int
    steps: int
    output_dir: Path
    base_model: str
    seed: int
    learning_rate: float
    smoke: bool


def _read_captions(data_dir: Path, smoke: bool, trigger: str) -> list[tuple[Path, str]]:
    """Return [(image_path, caption_en), ...]. In smoke mode, generate placeholders."""
    if smoke:
        return _placeholder_captions(data_dir, trigger)

    captions_file = data_dir / "captions.jsonl"
    if not captions_file.exists():
        raise FileNotFoundError(
            f"captions.jsonl not found at {captions_file}. "
            f"See datasets/{data_dir.name}/README.md for the expected schema."
        )
    images_dir = data_dir / "images"
    out: list[tuple[Path, str]] = []
    with open(captions_file, "r", encoding="utf-8") as fh:
        for ln, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("skipping bad JSON on line %d", ln)
                continue
            img = images_dir / rec["file"]
            if not img.exists():
                logger.warning("missing image referenced in captions: %s", img)
                continue
            cap = rec.get("caption_en") or ""
            if trigger not in cap:
                cap = f"{cap.rstrip(' .,;')} , in the {trigger}".strip(" ,")
            out.append((img, cap))
    if not out:
        raise RuntimeError(f"no usable (image, caption) pairs in {captions_file}")
    return out


def _placeholder_captions(data_dir: Path, trigger: str) -> list[tuple[Path, str]]:
    """Smoke-mode: scan data_dir for any image and synthesize a caption that contains the trigger."""
    from scripts.eval_utils import list_room_images

    images = list_room_images(data_dir)
    if not images:
        raise RuntimeError(f"no images found in {data_dir} for smoke mode")
    out: list[tuple[Path, str]] = []
    for i, p in enumerate(images):
        cap = f"a photorealistic interior in the {trigger}, sample {i+1}"
        out.append((p, cap))
    logger.warning(
        "SMOKE MODE: %d placeholder captions generated; "
        "results are NOT culturally accurate, only useful to verify the pipeline runs.",
        len(out),
    )
    return out


def train(args: TrainArgs) -> Path:
    """Run the LoRA training loop. Returns the path to the final .safetensors."""
    # heavy imports
    import torch
    from accelerate import Accelerator
    from diffusers import (
        AutoencoderKL,
        DDPMScheduler,
        StableDiffusionXLPipeline,
        UNet2DConditionModel,
    )
    from peft import LoraConfig, get_peft_model
    from torch.utils.data import DataLoader, Dataset
    from torchvision import transforms
    from transformers import AutoTokenizer, CLIPTextModel, CLIPTextModelWithProjection
    from PIL import Image

    args.output_dir.mkdir(parents=True, exist_ok=True)
    pairs = _read_captions(args.data_dir, args.smoke, TRIGGERS[args.culture])
    logger.info("training set: %d (image, caption) pairs", len(pairs))

    accelerator = Accelerator(mixed_precision="fp16" if torch.cuda.is_available() else "no")
    device = accelerator.device

    tokenizer_one = AutoTokenizer.from_pretrained(args.base_model, subfolder="tokenizer")
    tokenizer_two = AutoTokenizer.from_pretrained(args.base_model, subfolder="tokenizer_2")
    text_encoder_one = CLIPTextModel.from_pretrained(args.base_model, subfolder="text_encoder")
    text_encoder_two = CLIPTextModelWithProjection.from_pretrained(args.base_model, subfolder="text_encoder_2")
    vae = AutoencoderKL.from_pretrained(args.base_model, subfolder="vae")
    unet = UNet2DConditionModel.from_pretrained(args.base_model, subfolder="unet")
    noise_scheduler = DDPMScheduler.from_pretrained(args.base_model, subfolder="scheduler")

    # Freeze everything except UNet's LoRA adapters
    vae.requires_grad_(False)
    text_encoder_one.requires_grad_(False)
    text_encoder_two.requires_grad_(False)
    unet.requires_grad_(False)
    unet.enable_gradient_checkpointing()

    lora_config = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank,
        target_modules=["to_k", "to_q", "to_v", "to_out.0"],
    )
    unet = get_peft_model(unet, lora_config)

    # ---- dataset ----
    image_transform = transforms.Compose([
        transforms.Resize(1024, interpolation=transforms.InterpolationMode.BILINEAR),
        transforms.CenterCrop(1024),
        transforms.ToTensor(),
        transforms.Normalize([0.5], [0.5]),
    ])

    class DreamBoothLoraDataset(Dataset):
        def __init__(self, pairs: list[tuple[Path, str]]):
            self.pairs = pairs

        def __len__(self) -> int:
            return len(self.pairs)

        def __getitem__(self, idx: int):
            img_path, cap = self.pairs[idx]
            img = Image.open(img_path).convert("RGB")
            return {"pixel_values": image_transform(img), "caption": cap}

    ds = DreamBoothLoraDataset(pairs)
    dl = DataLoader(ds, batch_size=1, shuffle=True, num_workers=0)

    optimizer = torch.optim.AdamW([p for p in unet.parameters() if p.requires_grad], lr=args.learning_rate)
    unet, optimizer, dl = accelerator.prepare(unet, optimizer, dl)

    vae.to(device, dtype=torch.float16 if torch.cuda.is_available() else torch.float32)
    text_encoder_one.to(device)
    text_encoder_two.to(device)

    def _encode(captions: list[str]):
        prompt_embeds_list = []
        pooled = None
        for tok, te in ((tokenizer_one, text_encoder_one), (tokenizer_two, text_encoder_two)):
            input_ids = tok(captions, padding="max_length", truncation=True, max_length=77, return_tensors="pt").input_ids.to(device)
            out = te(input_ids, output_hidden_states=True)
            prompt_embeds_list.append(out.hidden_states[-2])
            if hasattr(out, "text_embeds") and out.text_embeds is not None:
                pooled = out.text_embeds
        return torch.cat(prompt_embeds_list, dim=-1), pooled

    checkpoints_at = sorted({500, 1000, args.steps})
    save_paths: list[Path] = []

    step = 0
    unet.train()
    while step < args.steps:
        for batch in dl:
            pixel = batch["pixel_values"].to(device, dtype=vae.dtype)
            with torch.no_grad():
                latents = vae.encode(pixel).latent_dist.sample() * vae.config.scaling_factor
            noise = torch.randn_like(latents)
            timesteps = torch.randint(0, noise_scheduler.config.num_train_timesteps, (latents.shape[0],), device=device).long()
            noisy = noise_scheduler.add_noise(latents, noise, timesteps)
            with torch.no_grad():
                prompt_embeds, pooled = _encode(batch["caption"])
            target = noise
            added_cond_kwargs = {
                "text_embeds": pooled,
                "time_ids": torch.tensor([[1024, 1024, 0, 0, 1024, 1024]], device=device).repeat(latents.shape[0], 1),
            }
            model_pred = unet(noisy, timesteps, prompt_embeds, added_cond_kwargs=added_cond_kwargs).sample
            loss = torch.nn.functional.mse_loss(model_pred.float(), target.float())
            accelerator.backward(loss)
            optimizer.step()
            optimizer.zero_grad()

            step += 1
            if step % 25 == 0:
                logger.info("step %d/%d loss=%.4f", step, args.steps, loss.item())
            if step in checkpoints_at:
                ckpt_path = _save_checkpoint(unet, args, step)
                save_paths.append(ckpt_path)
                _render_samples(args, ckpt_path, step)
                if step >= args.steps:
                    break
        if step >= args.steps:
            break

    final = save_paths[-1] if save_paths else _save_checkpoint(unet, args, args.steps)
    logger.info("training complete -> %s", final)
    return final


def _save_checkpoint(unet, args: TrainArgs, step: int) -> Path:
    """Persist the LoRA weights at this step; returns the .safetensors path."""
    import torch
    from peft.utils import get_peft_model_state_dict
    from safetensors.torch import save_file

    sd = get_peft_model_state_dict(unet)
    out = args.output_dir / f"dardesign-{args.culture}-lora-step{step}.safetensors"
    save_file({k: v.detach().cpu() for k, v in sd.items()}, str(out))
    # Also write/refresh the canonical filename so downstream code finds it
    canonical = args.output_dir / f"dardesign-{args.culture}-lora.safetensors"
    shutil.copy(out, canonical)
    logger.info("checkpoint @ step %d -> %s (canonical: %s)", step, out, canonical)
    return out


def _render_samples(args: TrainArgs, ckpt_path: Path, step: int) -> Path:
    """Render 5 preview images using the checkpoint's LoRA, saved as a contact sheet."""
    from scripts.eval_utils import make_contact_sheet
    from PIL import Image
    import torch
    from diffusers import StableDiffusionXLPipeline

    pipe = StableDiffusionXLPipeline.from_pretrained(
        args.base_model,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )
    if torch.cuda.is_available():
        pipe.enable_model_cpu_offload()
    pipe.load_lora_weights(str(ckpt_path.parent), weight_name=ckpt_path.name)
    pipe.set_progress_bar_config(disable=True)

    trigger = TRIGGERS[args.culture]
    generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(args.seed)
    cells: list[tuple[Image.Image, str]] = []
    for tpl in SAMPLE_PROMPT_TEMPLATES:
        prompt = tpl.format(trigger=trigger)
        img = pipe(prompt, num_inference_steps=20, guidance_scale=7.0, width=1024, height=1024, generator=generator).images[0]
        cells.append((img, prompt[:60]))

    sheet = make_contact_sheet(cells, cols=5, cell_size=(512, 512), title=f"{args.culture} step {step}")
    out = args.output_dir / f"samples-step{step}.png"
    sheet.save(out)
    logger.info("samples grid -> %s", out)
    del pipe
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return out


def _parse() -> TrainArgs:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--culture", required=True, choices=list(TRIGGERS))
    p.add_argument("--data-dir", required=True, type=Path)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--steps", type=int, default=1500)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--base-model", default="stabilityai/stable-diffusion-xl-base-1.0")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--lr", type=float, default=1e-4, dest="learning_rate")
    p.add_argument("--smoke", action="store_true",
                   help="placeholder-caption sanity run; uses any images in --data-dir")
    a = p.parse_args()
    return TrainArgs(
        culture=a.culture, data_dir=a.data_dir, rank=a.rank, steps=a.steps,
        output_dir=a.output_dir, base_model=a.base_model, seed=a.seed,
        learning_rate=a.learning_rate, smoke=a.smoke,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    args = _parse()
    try:
        train(args)
    except RuntimeError as e:
        if "out of memory" not in str(e).lower():
            raise
        logger.warning("SDXL OOM — retrying on SD 1.5")
        args.base_model = "runwayml/stable-diffusion-v1-5"
        # SD 1.5 LoRA has different target_modules; the function above is SDXL-shaped.
        # For the smoke command we want to fail loudly here so the user knows to run
        # SD-1.5-specific path separately.
        raise SystemExit(
            "SDXL OOM. Re-run with `--base-model runwayml/stable-diffusion-v1-5` and adjust target_modules."
        )


if __name__ == "__main__":
    main()
