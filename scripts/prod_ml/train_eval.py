from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import csv
import json
import math
import shutil
import time

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
    roc_auc_score,
)
from torch.utils.data import DataLoader, Dataset
from torchvision import models
from torchvision.transforms import (
    ColorJitter,
    Compose,
    GaussianBlur,
    Normalize,
    RandomErasing,
    RandomHorizontalFlip,
    RandomResizedCrop,
    Resize,
    ToTensor,
)
from PIL import Image

from .config import PipelineConfig


class ImageCsvDataset(Dataset):
    def __init__(self, rows: list[tuple[str, int]], transform=None):
        self.rows = rows
        self.transform = transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        p, y = self.rows[idx]
        with Image.open(p) as im:
            x = im.convert("RGB")
        if self.transform is not None:
            x = self.transform(x)
        return x, y


class FocalLoss(nn.Module):
    def __init__(self, gamma: float = 2.0, weight: torch.Tensor | None = None):
        super().__init__()
        self.gamma = gamma
        self.weight = weight

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        ce = nn.functional.cross_entropy(logits, target, reduction="none", weight=self.weight)
        pt = torch.exp(-ce)
        return ((1 - pt) ** self.gamma * ce).mean()


@dataclass
class TrainResult:
    best_ckpt: Path
    history_path: Path


def _load_split_rows(split_csv: Path):
    rows = []
    with open(split_csv, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append((row["path"], row["label"], row["split"]))
    return rows


def _build_label_index(rows: list[tuple[str, str, str]]):
    labels = sorted({label for _, label, _ in rows})
    lab2idx = {l: i for i, l in enumerate(labels)}
    return labels, lab2idx


def _make_model(backbone: str, num_classes: int, pretrained: bool) -> nn.Module:
    weights = "DEFAULT" if pretrained else None
    if backbone == "efficientnet_v2_s":
        m = models.efficientnet_v2_s(weights=getattr(models, "EfficientNet_V2_S_Weights").DEFAULT if pretrained else None)
        in_f = m.classifier[-1].in_features
        m.classifier[-1] = nn.Linear(in_f, num_classes)
        return m
    if backbone == "resnet50":
        m = models.resnet50(weights=getattr(models, "ResNet50_Weights").DEFAULT if pretrained else None)
        in_f = m.fc.in_features
        m.fc = nn.Linear(in_f, num_classes)
        return m
    raise ValueError(f"Unsupported backbone: {backbone}")


def _build_transforms(cfg: PipelineConfig):
    train_tf = Compose([
        RandomResizedCrop(cfg.image_size, scale=(0.75, 1.0)),
        RandomHorizontalFlip(p=0.5),
        ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.05),
        GaussianBlur(kernel_size=3, sigma=(0.1, 1.0)),
        ToTensor(),
        Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        RandomErasing(p=0.15, scale=(0.02, 0.08)),
    ])
    eval_tf = Compose([
        Resize((cfg.image_size, cfg.image_size)),
        ToTensor(),
        Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    return train_tf, eval_tf


def _compute_class_weights(train_labels_idx: list[int], num_classes: int) -> torch.Tensor:
    c = Counter(train_labels_idx)
    counts = np.array([c.get(i, 1) for i in range(num_classes)], dtype=np.float32)
    inv = counts.sum() / np.maximum(counts, 1.0)
    w = inv / inv.mean()
    return torch.tensor(w, dtype=torch.float32)


def train_and_evaluate(cfg: PipelineConfig) -> TrainResult:
    split_csv = cfg.processed_root / "splits.csv"
    rows = _load_split_rows(split_csv)
    labels, lab2idx = _build_label_index(rows)

    train_rows = [(p, lab2idx[l]) for p, l, s in rows if s == "train"]
    val_rows = [(p, lab2idx[l]) for p, l, s in rows if s == "val"]
    test_rows = [(p, lab2idx[l]) for p, l, s in rows if s == "test"]

    train_tf, eval_tf = _build_transforms(cfg)
    ds_train = ImageCsvDataset(train_rows, train_tf)
    ds_val = ImageCsvDataset(val_rows, eval_tf)
    ds_test = ImageCsvDataset(test_rows, eval_tf)

    dl_train = DataLoader(ds_train, batch_size=cfg.batch_size, shuffle=True, num_workers=cfg.num_workers, pin_memory=torch.cuda.is_available())
    dl_val = DataLoader(ds_val, batch_size=cfg.batch_size, shuffle=False, num_workers=cfg.num_workers, pin_memory=torch.cuda.is_available())
    dl_test = DataLoader(ds_test, batch_size=cfg.batch_size, shuffle=False, num_workers=cfg.num_workers, pin_memory=torch.cuda.is_available())

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = _make_model(cfg.backbone, len(labels), cfg.pretrained).to(device)

    for n, p in model.named_parameters():
        if "classifier" not in n and "fc" not in n:
            p.requires_grad = True

    if cfg.optimizer.lower() == "adamw":
        optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    else:
        optimizer = torch.optim.SGD(model.parameters(), lr=cfg.lr, momentum=0.9, weight_decay=cfg.weight_decay)

    steps_per_epoch = max(1, math.ceil(len(dl_train) / max(1, cfg.grad_accum_steps)))
    total_steps = max(1, cfg.epochs * steps_per_epoch)
    if cfg.scheduler.lower() == "cosine":
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_steps)
    else:
        scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=cfg.lr, total_steps=total_steps)

    class_weights = _compute_class_weights([y for _, y in train_rows], len(labels)).to(device) if cfg.class_weighting else None
    if cfg.use_focal_loss:
        criterion = FocalLoss(gamma=cfg.focal_gamma, weight=class_weights)
    else:
        criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=cfg.label_smoothing)

    scaler = torch.amp.GradScaler("cuda", enabled=(cfg.use_amp and device.type == "cuda"))

    run_dir = cfg.model_root / f"run_{int(time.time())}"
    ckpt_dir = run_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    cfg.reports_root.mkdir(parents=True, exist_ok=True)

    best_f1 = -1.0
    bad_epochs = 0
    history = []

    def eval_loader(dl):
        model.eval()
        ys, yhat, probs = [], [], []
        with torch.no_grad():
            for x, y in dl:
                x = x.to(device, non_blocking=True)
                y = y.to(device)
                with torch.amp.autocast("cuda", enabled=(cfg.use_amp and device.type == "cuda")):
                    logits = model(x)
                p = torch.softmax(logits, dim=1)
                ys.extend(y.cpu().tolist())
                yhat.extend(torch.argmax(logits, dim=1).cpu().tolist())
                probs.extend(p.cpu().tolist())
        return np.array(ys), np.array(yhat), np.array(probs)

    global_step = 0
    for epoch in range(1, cfg.epochs + 1):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        run_loss = 0.0

        for i, (x, y) in enumerate(dl_train, 1):
            x = x.to(device, non_blocking=True)
            y = y.to(device)
            with torch.amp.autocast("cuda", enabled=(cfg.use_amp and device.type == "cuda")):
                logits = model(x)
                loss = criterion(logits, y) / max(1, cfg.grad_accum_steps)

            scaler.scale(loss).backward()
            run_loss += float(loss.item())

            if i % max(1, cfg.grad_accum_steps) == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.gradient_clip_norm)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                scheduler.step()
                global_step += 1

        yv, yv_hat, yv_prob = eval_loader(dl_val)
        v_acc = accuracy_score(yv, yv_hat)
        v_prec, v_rec, v_f1, _ = precision_recall_fscore_support(yv, yv_hat, average="macro", zero_division=0)

        row = {
            "epoch": epoch,
            "train_loss": run_loss / max(1, len(dl_train)),
            "val_acc": float(v_acc),
            "val_precision": float(v_prec),
            "val_recall": float(v_rec),
            "val_f1": float(v_f1),
            "lr": float(optimizer.param_groups[0]["lr"]),
        }
        history.append(row)

        ckpt = ckpt_dir / f"epoch_{epoch:03d}.pt"
        torch.save(
            {
                "epoch": epoch,
                "model_state": model.state_dict(),
                "optimizer_state": optimizer.state_dict(),
                "scheduler_state": scheduler.state_dict(),
                "labels": labels,
                "cfg": cfg.__dict__,
            },
            ckpt,
        )

        ckpts = sorted(ckpt_dir.glob("epoch_*.pt"))
        if len(ckpts) > cfg.checkpoint_keep_last:
            for old in ckpts[:-cfg.checkpoint_keep_last]:
                old.unlink(missing_ok=True)

        improved = v_f1 > (best_f1 + cfg.min_delta)
        if improved:
            best_f1 = v_f1
            bad_epochs = 0
            best_ckpt = run_dir / "best_model.pt"
            shutil.copy2(ckpt, best_ckpt)
        else:
            bad_epochs += 1

        if bad_epochs >= cfg.early_stopping_patience:
            break

    hist_path = cfg.reports_root / "training_history.json"
    hist_path.write_text(json.dumps(history, indent=2), encoding="utf-8")

    if not (run_dir / "best_model.pt").exists():
        raise RuntimeError("No checkpoint saved as best model")

    checkpoint = torch.load(run_dir / "best_model.pt", map_location=device)
    model.load_state_dict(checkpoint["model_state"])

    yt, yt_hat, yt_prob = eval_loader(dl_test)
    test_acc = accuracy_score(yt, yt_hat)
    p, r, f1, sup = precision_recall_fscore_support(yt, yt_hat, average=None, zero_division=0)
    cm = confusion_matrix(yt, yt_hat).tolist()

    roc_auc = None
    try:
        if len(labels) == 2:
            roc_auc = float(roc_auc_score(yt, yt_prob[:, 1]))
        else:
            roc_auc = float(roc_auc_score(yt, yt_prob, multi_class="ovr"))
    except Exception:
        roc_auc = None

    per_class = []
    for i, lab in enumerate(labels):
        per_class.append(
            {
                "class": lab,
                "precision": float(p[i]),
                "recall": float(r[i]),
                "f1": float(f1[i]),
                "support": int(sup[i]),
            }
        )

    confidence = np.max(yt_prob, axis=1)
    low_conf_idx = np.where(confidence < 0.55)[0].tolist()
    low_conf_samples = [
        {
            "path": test_rows[i][0],
            "true": labels[test_rows[i][1]],
            "pred": labels[int(yt_hat[i])],
            "confidence": float(confidence[i]),
        }
        for i in low_conf_idx[:100]
    ]

    eval_report = {
        "accuracy": float(test_acc),
        "macro_precision": float(precision_recall_fscore_support(yt, yt_hat, average="macro", zero_division=0)[0]),
        "macro_recall": float(precision_recall_fscore_support(yt, yt_hat, average="macro", zero_division=0)[1]),
        "macro_f1": float(precision_recall_fscore_support(yt, yt_hat, average="macro", zero_division=0)[2]),
        "roc_auc": roc_auc,
        "confusion_matrix": cm,
        "per_class": per_class,
        "low_confidence_samples": low_conf_samples,
    }
    (cfg.reports_root / "evaluation_report.json").write_text(json.dumps(eval_report, indent=2), encoding="utf-8")

    mistakes = []
    for i in range(len(yt)):
        if int(yt[i]) != int(yt_hat[i]):
            mistakes.append((labels[int(yt[i])], labels[int(yt_hat[i])]))
    fail_patterns = Counter(mistakes)
    analysis = {
        "top_misclassifications": [
            {"true": t, "pred": p_, "count": c}
            for (t, p_), c in fail_patterns.most_common(20)
        ],
        "recommendations": [
            "Collect more samples for frequently confused classes.",
            "Increase augmentation strength for under-represented classes.",
            "Review potentially noisy labels in confusion hotspots.",
            "Consider backbone upgrade to resnet50 when dataset grows.",
        ],
    }
    (cfg.reports_root / "error_analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")

    return TrainResult(best_ckpt=run_dir / "best_model.pt", history_path=hist_path)
