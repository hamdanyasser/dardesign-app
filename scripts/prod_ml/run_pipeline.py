from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import build_default_config, save_config
from .data_ops import build_dataset_report, clean_dataset, build_stratified_group_splits


def _parse_args():
    p = argparse.ArgumentParser(description="Production-grade local image classification pipeline")
    p.add_argument("--data-root", type=Path, default=None)
    p.add_argument("--backbone", type=str, default=None, choices=["efficientnet_v2_s", "resnet50", "convnext_tiny"])
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--batch-size", type=int, default=None)
    p.add_argument("--image-size", type=int, default=None)
    p.add_argument("--lr", type=float, default=None)
    p.add_argument("--run-training", action="store_true")
    p.add_argument("--single-image", type=Path, default=None)
    p.add_argument("--batch-dir", type=Path, default=None)
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    cfg = build_default_config()

    if args.data_root is not None:
        cfg.data_root = args.data_root
    if args.backbone is not None:
        cfg.backbone = args.backbone
    if args.epochs is not None:
        cfg.epochs = args.epochs
    if args.batch_size is not None:
        cfg.batch_size = args.batch_size
    if args.image_size is not None:
        cfg.image_size = args.image_size
    if args.lr is not None:
        cfg.lr = args.lr

    cfg.reports_root.mkdir(parents=True, exist_ok=True)
    save_config(cfg, cfg.reports_root / "pipeline_config.json")

    report = build_dataset_report(cfg, cfg.reports_root / "dataset_quality_report.json")
    clean_summary = clean_dataset(cfg)
    split_summary = None
    split_error = None
    try:
        split_summary = build_stratified_group_splits(cfg)
    except RuntimeError as e:
        split_error = str(e)

    output = {
        "dataset_report": report,
        "data_cleaning_summary": clean_summary,
        "split_summary": split_summary,
        "split_error": split_error,
    }

    if args.run_training and split_summary is not None:
        from .modeling import train_and_evaluate

        training_report = train_and_evaluate(cfg)
        output["training_report"] = training_report

    model_path = cfg.model_root / "best_model.pt"
    if model_path.exists() and (args.single_image is not None or args.batch_dir is not None):
        from .modeling import load_model_for_inference, predict_single_image, predict_batch

        model, labels, tfm, dev = load_model_for_inference(model_path)

        if args.single_image is not None and args.single_image.exists():
            output["single_inference"] = predict_single_image(model, labels, tfm, dev, args.single_image)

        if args.batch_dir is not None and args.batch_dir.exists():
            imgs = [
                p
                for p in sorted(args.batch_dir.rglob("*"))
                if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
            ]
            output["batch_inference"] = predict_batch(model, labels, tfm, dev, imgs)

    out_path = cfg.reports_root / "pipeline_summary.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "summary": str(out_path)}, indent=2))


if __name__ == "__main__":
    main()
