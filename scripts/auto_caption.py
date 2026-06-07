"""Auto-draft English captions for a culture dataset using BLIP-2.

Week-1 task (Zainab track): run a vision model over ``datasets/<culture>/images/``,
auto-draft a long-form English caption per image (trigger phrase + room type +
visible features), and write a ``captions.jsonl`` that matches the schema in
``datasets/<culture>/README.md``. The Arabic caption is intentionally left blank
for human curation — per the dataset rules the AR text must be a faithful
*cultural* description, not a literal machine translation.

Workflow:
    1. Drop curated images into datasets/<culture>/images/ (see dataset README).
    2. Run this script (GPU recommended; CPU works but is slow).
    3. Open the generated captions.jsonl and curate: tighten the EN text, write
       caption_ar, fill tags / license / source_url, then it's training-ready.

Usage:
    python scripts/auto_caption.py --culture lebanese
    python scripts/auto_caption.py --culture khaleeji --images-dir datasets/khaleeji/images --out datasets/khaleeji/captions.jsonl
    python scripts/auto_caption.py --culture lebanese --model Salesforce/blip2-opt-2.7b --max-new-tokens 40

Notes:
    - Heavy ML deps (torch, transformers, pillow) are imported lazily inside
      ``run()`` so this module stays importable on a vanilla box for CI / lint.
    - Trigger phrases are read from ontology/ontology.json so they never drift
      from the prompt builder / training config.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_MODEL = "Salesforce/blip2-opt-2.7b"


def load_trigger(culture: str) -> str:
    """Return the EN trigger phrase for a culture from the ontology (fallback to convention)."""
    onto = REPO_ROOT / "ontology" / "ontology.json"
    try:
        data = json.loads(onto.read_text(encoding="utf-8"))
        return data["trigger"][culture]["en"]
    except Exception:
        return f"dardesign-{culture} style"


def list_images(images_dir: Path) -> list[Path]:
    if not images_dir.is_dir():
        return []
    return sorted(p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def build_caption(raw: str, trigger: str) -> str:
    """Normalise BLIP-2 output and guarantee the trigger phrase is present."""
    text = " ".join(raw.strip().split())
    text = text[0].lower() + text[1:] if text else text
    if trigger.lower() not in text.lower():
        # Insert the trigger right after the leading article/noun for natural phrasing.
        text = f"a room in the {trigger}, {text}"
    return text


def run(culture: str, images_dir: Path, out_path: Path, model_name: str, max_new_tokens: int) -> int:
    trigger = load_trigger(culture)
    images = list_images(images_dir)
    if not images:
        print(f"[auto_caption] no images in {images_dir} — add curated photos first "
              f"(see datasets/{culture}/README.md). Nothing to do.", file=sys.stderr)
        return 0

    # Lazy heavy imports.
    import torch  # type: ignore
    from PIL import Image  # type: ignore
    from transformers import Blip2Processor, Blip2ForConditionalGeneration  # type: ignore

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"[auto_caption] loading {model_name} on {device} ({dtype})…", file=sys.stderr)
    processor = Blip2Processor.from_pretrained(model_name)
    model = Blip2ForConditionalGeneration.from_pretrained(model_name, torch_dtype=dtype).to(device)
    model.eval()

    prompt = "Question: Describe this interior in detail — room type, materials, colours, and decorative elements. Answer:"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with out_path.open("w", encoding="utf-8") as fh:
        for img_path in images:
            try:
                image = Image.open(img_path).convert("RGB")
            except Exception as e:  # noqa: BLE001
                print(f"[auto_caption] skip {img_path.name}: {e}", file=sys.stderr)
                continue
            inputs = processor(images=image, text=prompt, return_tensors="pt").to(device, dtype)
            with torch.no_grad():
                ids = model.generate(**inputs, max_new_tokens=max_new_tokens)
            raw = processor.batch_decode(ids, skip_special_tokens=True)[0]
            record = {
                "file": img_path.name,
                "caption_en": build_caption(raw, trigger),
                "caption_ar": "",  # TODO(Zainab): write a faithful Arabic description incl. the AR trigger phrase
                "tags": [],
                "license": "TODO",
                "source_url": "TODO",
            }
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1
            print(f"[auto_caption] {img_path.name} -> {record['caption_en'][:70]}…", file=sys.stderr)

    print(f"[auto_caption] wrote {written} draft captions to {out_path}")
    print("[auto_caption] next: curate caption_en, write caption_ar, fill tags/license/source_url.")
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="BLIP-2 auto-caption drafter for a DarDesign culture dataset.")
    ap.add_argument("--culture", required=True, choices=["lebanese", "khaleeji", "moroccan"])
    ap.add_argument("--images-dir", default=None, help="defaults to datasets/<culture>/images")
    ap.add_argument("--out", default=None, help="defaults to datasets/<culture>/captions.jsonl")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-new-tokens", type=int, default=40)
    args = ap.parse_args(argv)

    images_dir = Path(args.images_dir) if args.images_dir else REPO_ROOT / "datasets" / args.culture / "images"
    out_path = Path(args.out) if args.out else REPO_ROOT / "datasets" / args.culture / "captions.jsonl"
    return 0 if run(args.culture, images_dir, out_path, args.model, args.max_new_tokens) >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
