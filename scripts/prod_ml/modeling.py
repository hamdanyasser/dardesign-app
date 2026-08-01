from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import csv
import json
import time
from collections import Counter

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import models, transforms
from PIL import Image

from backend.settings import collect_runtime_metrics
from .config import PipelineConfig


class ImageCsvDataset(Dataset):
    def __init__(self, rows: list[tuple[str, int]], tfm=None):
        self.rows = rows
        self.tfm = tfm

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        path, label = self.rows[idx]
        with Image.open(path) as im:
            img = im.convert("RGB")
        if self.tfm is not None:
            img = self.tfm(img)
        return img, label, path


def _build_backbone(name: str, n_classes: int, pretrained: bool) -> nn.Module:
    weights = "DEFAULT" if pretrained else None
    if name == "efficientnet_v2_s":
        m = models.efficientnet_v2_s(weights=weights)
        in_features = m.classifier[1].in_features
        m.classifier[1] = nn.Linear(in_features, n_classes)
        return m
    if name == "resnet50":
        m = models.resnet50(weights=weights)
        in_features = m.fc.in_features
        m.fc = nn.Linear(in_features, n_classes)
        return m
    if name == "convnext_tiny":
        m = models.convnext_tiny(weights=weights)
        in_features = m.classifier[2].in_features
        m.classifier[2] = nn.Linear(in_features, n_classes)
        return m
    raise ValueError(f"Unsupported backbone: {name}")


class FocalLoss(nn.Module):
    def __init__(self, gamma: float = 2.0, weight=None):
        super().__init__()
        self.gamma = gamma
        self.weight = weight

    def forward(self, logits, targets):
        ce = nn.functional.cross_entropy(logits, targets, weight=self.weight, reduction="none")
        pt = torch.exp(-ce)
        return ((1 - pt) ** self.gamma * ce).mean()


def _build_transforms(cfg: PipelineConfig):
    train_t = transforms.Compose(
        [
            transforms.Resize((cfg.image_size, cfg.image_size)),
            transforms.RandomHorizontalFlip(p=cfg.aug_hflip_prob),
            transforms.RandomRotation(degrees=cfg.aug_rotation_deg),
            transforms.ColorJitter(
                brightness=cfg.aug_brightness,
                contrast=cfg.aug_contrast,
                saturation=cfg.aug_saturation,
                hue=cfg.aug_hue,
            ),
            transforms.RandomApply([transforms.GaussianBlur(kernel_size=3)], p=cfg.aug_blur_prob),
            transforms.ToTensor(),
            transforms.RandomErasing(p=cfg.aug_erasing_prob, scale=(0.01, 0.08)),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    eval_t = transforms.Compose(
        [
            transforms.Resize((cfg.image_size, cfg.image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return train_t, eval_t


def _read_split_csv(split_csv: Path):
    rows = []
    with open(split_csv, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append((row["path"], row["label"], row["split"]))
    return rows


def _make_loaders(cfg: PipelineConfig):
    rows = _read_split_csv(cfg.processed_root / "splits.csv")
    labels = sorted({label for _, label, _ in rows})
    label_to_idx = {l: i for i, l in enumerate(labels)}

    tr = [(p, label_to_idx[l]) for p, l, s in rows if s == "train"]
    va = [(p, label_to_idx[l]) for p, l, s in rows if s == "val"]
    te = [(p, label_to_idx[l]) for p, l, s in rows if s == "test"]

    train_t, eval_t = _build_transforms(cfg)
    tr_ds = ImageCsvDataset(tr, train_t)
    va_ds = ImageCsvDataset(va, eval_t)
    te_ds = ImageCsvDataset(te, eval_t)

    class_counts = Counter([y for _, y in tr])
    sample_weights = [1.0 / class_counts[y] for _, y in tr]
    sampler = None
    if cfg.class_weighting:
        sampler = WeightedRandomSampler(sample_weights, num_samples=len(sample_weights), replacement=True)

    tr_dl = DataLoader(
        tr_ds,
        batch_size=cfg.batch_size,
        shuffle=sampler is None,
        sampler=sampler,
        num_workers=cfg.num_workers,
        pin_memory=torch.cuda.is_available(),
    )
    va_dl = DataLoader(va_ds, batch_size=cfg.batch_size, shuffle=False, num_workers=cfg.num_workers)
    te_dl = DataLoader(te_ds, batch_size=cfg.batch_size, shuffle=False, num_workers=cfg.num_workers)

    return tr_dl, va_dl, te_dl, labels


def _compute_metrics(y_true, y_pred, y_prob, labels):
    n = len(labels)
    cm = np.zeros((n, n), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[int(t), int(p)] += 1

    acc = float(np.trace(cm) / max(1, cm.sum()))

    per_class = {}
    precisions = []
    recalls = []
    f1s = []
    for i, label in enumerate(labels):
        tp = float(cm[i, i])
        fp = float(cm[:, i].sum() - tp)
        fn = float(cm[i, :].sum() - tp)
        support = int(cm[i, :].sum())
        prec = tp / max(1.0, tp + fp)
        rec = tp / max(1.0, tp + fn)
        f1 = 0.0 if (prec + rec) == 0 else 2.0 * prec * rec / (prec + rec)
        precisions.append(prec)
        recalls.append(rec)
        f1s.append(f1)
        per_class[label] = {
            "precision": prec,
            "recall": rec,
            "f1-score": f1,
            "support": support,
        }

    return {
        "accuracy": acc,
        "precision_macro": float(np.mean(precisions) if precisions else 0.0),
        "recall_macro": float(np.mean(recalls) if recalls else 0.0),
        "f1_macro": float(np.mean(f1s) if f1s else 0.0),
        "roc_auc_ovr_macro": None,
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
    }


def train_and_evaluate(cfg: PipelineConfig) -> dict:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tr_dl, va_dl, te_dl, labels = _make_loaders(cfg)

    model = _build_backbone(cfg.backbone, len(labels), cfg.pretrained).to(device)

    class_weights = None
    if cfg.class_weighting:
        train_targets = []
        for _, y, _ in tr_dl.dataset:
            train_targets.append(y)
        counts = np.bincount(np.array(train_targets), minlength=len(labels))
        class_weights = torch.tensor(1.0 / np.maximum(counts, 1), dtype=torch.float32, device=device)

    if cfg.use_focal_loss:
        criterion = FocalLoss(gamma=cfg.focal_gamma, weight=class_weights)
    else:
        criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=cfg.label_smoothing)

    if cfg.optimizer.lower() == "adamw":
        optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    elif cfg.optimizer.lower() == "sgd":
        optimizer = torch.optim.SGD(model.parameters(), lr=cfg.lr, momentum=0.9, weight_decay=cfg.weight_decay)
    else:
        raise ValueError(f"Unsupported optimizer: {cfg.optimizer}")

    if cfg.scheduler.lower() == "cosine":
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=cfg.epochs)
    elif cfg.scheduler.lower() == "onecycle":
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=cfg.lr, epochs=cfg.epochs, steps_per_epoch=max(1, len(tr_dl))
        )
    else:
        scheduler = None

    scaler = torch.cuda.amp.GradScaler(enabled=cfg.use_amp and torch.cuda.is_available())

    ckpt_dir = cfg.model_root / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    best_path = cfg.model_root / "best_model.pt"
    last_path = cfg.model_root / "last_model.pt"

    best_val = -1.0
    patience = 0
    start_epoch = 0

    if last_path.exists():
        state = torch.load(last_path, map_location=device)
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        if scheduler is not None and state.get("scheduler") is not None:
            scheduler.load_state_dict(state["scheduler"])
        scaler.load_state_dict(state.get("scaler", scaler.state_dict()))
        start_epoch = int(state.get("epoch", 0)) + 1
        best_val = float(state.get("best_val_f1", -1.0))

    history = []
    started = time.perf_counter()

    for epoch in range(start_epoch, cfg.epochs):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        tr_loss = 0.0

        for i, (x, y, _) in enumerate(tr_dl):
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)

            with torch.cuda.amp.autocast(enabled=cfg.use_amp and torch.cuda.is_available()):
                logits = model(x)
                loss = criterion(logits, y) / max(1, cfg.grad_accum_steps)

            scaler.scale(loss).backward()

            if (i + 1) % max(1, cfg.grad_accum_steps) == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.gradient_clip_norm)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)

            tr_loss += float(loss.item() * max(1, cfg.grad_accum_steps))

        if scheduler is not None:
            scheduler.step()

        val = _eval_loop(model, va_dl, device, labels)
        val_f1 = val["f1_macro"]

        history.append(
            {
                "epoch": epoch,
                "train_loss": tr_loss / max(1, len(tr_dl)),
                "val_f1_macro": val_f1,
                "val_accuracy": val["accuracy"],
                "metrics": collect_runtime_metrics(),
            }
        )

        torch.save(
            {
                "epoch": epoch,
                "model": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scheduler": scheduler.state_dict() if scheduler is not None else None,
                "scaler": scaler.state_dict(),
                "best_val_f1": best_val,
                "labels": labels,
                "cfg": cfg.__dict__,
            },
            last_path,
        )

        if val_f1 > best_val + cfg.min_delta:
            best_val = val_f1
            patience = 0
            torch.save(
                {
                    "model": model.state_dict(),
                    "labels": labels,
                    "cfg": cfg.__dict__,
                },
                best_path,
            )
        else:
            patience += 1
            if patience >= cfg.early_stopping_patience:
                break

        _cleanup_checkpoints(ckpt_dir, keep_last=cfg.checkpoint_keep_last)

    best = torch.load(best_path, map_location=device)
    model.load_state_dict(best["model"])
    test = _eval_loop(model, te_dl, device, labels, include_paths=True)

    elapsed = time.perf_counter() - started
    report = {
        "device": str(device),
        "labels": labels,
        "history": history,
        "best_val_f1_macro": best_val,
        "test_metrics": {k: v for k, v in test.items() if k != "errors"},
        "error_analysis": _error_analysis(test),
        "elapsed_seconds": elapsed,
    }

    cfg.reports_root.mkdir(parents=True, exist_ok=True)
    (cfg.reports_root / "training_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def _eval_loop(model, dl, device, labels, include_paths: bool = False):
    model.eval()
    y_true, y_pred, y_prob = [], [], []
    errors = []

    with torch.no_grad():
        for x, y, paths in dl:
            x = x.to(device, non_blocking=True)
            logits = model(x)
            probs = torch.softmax(logits, dim=1)
            pred = probs.argmax(dim=1)

            y_true.extend(y.cpu().tolist())
            y_pred.extend(pred.cpu().tolist())
            y_prob.extend(probs.cpu().tolist())

            if include_paths:
                conf = probs.max(dim=1).values.cpu().tolist()
                for p, t, pr, c in zip(paths, y.cpu().tolist(), pred.cpu().tolist(), conf):
                    if t != pr:
                        errors.append(
                            {
                                "path": p,
                                "true_label": labels[t],
                                "pred_label": labels[pr],
                                "confidence": float(c),
                            }
                        )

    out = _compute_metrics(y_true, y_pred, y_prob, labels)
    if include_paths:
        out["errors"] = errors
    return out


def _error_analysis(test_out: dict) -> dict:
    errors = test_out.get("errors", [])
    if not errors:
        return {"frequent_confusions": [], "low_confidence_predictions": [], "notes": []}

    confusion_counter = Counter((e["true_label"], e["pred_label"]) for e in errors)
    low_conf = sorted(errors, key=lambda x: x["confidence"])[:25]

    return {
        "frequent_confusions": [
            {"true": t, "pred": p, "count": c}
            for (t, p), c in confusion_counter.most_common(15)
        ],
        "low_confidence_predictions": low_conf,
        "notes": [
            "Collect more samples for highly confused class pairs.",
            "Review label consistency for repeated low-confidence errors.",
            "Consider stronger domain-specific augmentation for weak classes.",
        ],
    }


def _cleanup_checkpoints(ckpt_dir: Path, keep_last: int) -> None:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    pts = sorted(ckpt_dir.glob("*.pt"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in pts[keep_last:]:
        try:
            p.unlink()
        except OSError:
            pass


def load_model_for_inference(model_path: Path, device: str | None = None):
    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    state = torch.load(model_path, map_location=dev)
    labels = state["labels"]
    cfg_dict = state["cfg"]
    m = _build_backbone(cfg_dict["backbone"], len(labels), cfg_dict["pretrained"]).to(dev)
    m.load_state_dict(state["model"])
    m.eval()
    eval_t = transforms.Compose(
        [
            transforms.Resize((cfg_dict["image_size"], cfg_dict["image_size"])),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return m, labels, eval_t, dev


def predict_single_image(model, labels, tfm, device, image_path: Path):
    with Image.open(image_path) as im:
        img = tfm(im.convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(img)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
    idx = int(np.argmax(probs))
    return {
        "image": str(image_path),
        "pred_label": labels[idx],
        "confidence": float(probs[idx]),
        "topk": [
            {"label": labels[i], "prob": float(probs[i])}
            for i in np.argsort(-probs)[:5]
        ],
    }


def predict_batch(model, labels, tfm, device, image_paths: list[Path]) -> list[dict]:
    outs = []
    for p in image_paths:
        outs.append(predict_single_image(model, labels, tfm, device, p))
    return outs
