from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
import json

from backend.settings import SETTINGS, detect_hardware_profile


@dataclass
class PipelineConfig:
    data_root: Path = SETTINGS.root_dir / "datasets"
    processed_root: Path = SETTINGS.processed_dir / "classification"
    reports_root: Path = SETTINGS.exports_dir / "reports"
    model_root: Path = SETTINGS.models_dir / "classification"
    cache_root: Path = SETTINGS.cache_dir / "classification"
    quarantine_root: Path = SETTINGS.temp_dir / "quarantine"

    seed: int = 42
    image_size: int = 384
    min_size: int = 256
    max_aspect_ratio: float = 2.5
    blur_laplacian_threshold: float = 60.0
    duplicate_hamming_threshold: int = 4

    val_ratio: float = 0.15
    test_ratio: float = 0.15

    backbone: str = "efficientnet_v2_s"
    pretrained: bool = True
    epochs: int = 40
    batch_size: int = 8
    grad_accum_steps: int = 2
    lr: float = 3e-4
    weight_decay: float = 1e-4
    optimizer: str = "adamw"
    scheduler: str = "cosine"
    label_smoothing: float = 0.05
    use_focal_loss: bool = True
    focal_gamma: float = 2.0
    class_weighting: bool = True

    # Conservative augmentation defaults for architecture-sensitive interiors.
    aug_hflip_prob: float = 0.0
    aug_rotation_deg: float = 4.0
    aug_brightness: float = 0.08
    aug_contrast: float = 0.08
    aug_saturation: float = 0.06
    aug_hue: float = 0.01
    aug_blur_prob: float = 0.08
    aug_erasing_prob: float = 0.0

    early_stopping_patience: int = 8
    min_delta: float = 1e-4
    gradient_clip_norm: float = 1.0
    checkpoint_keep_last: int = 3

    num_workers: int = 4
    use_amp: bool = True


def build_default_config() -> PipelineConfig:
    cfg = PipelineConfig()
    hw = detect_hardware_profile()

    if hw.device == "cpu":
        cfg.image_size = 256
        cfg.batch_size = 4
        cfg.grad_accum_steps = 4
        cfg.epochs = 30
        cfg.use_amp = False
        cfg.num_workers = min(4, hw.cpu_cores)
        return cfg

    if hw.gpu_vram_gb is not None and hw.gpu_vram_gb <= 8.5:
        cfg.image_size = 320
        cfg.batch_size = 6
        cfg.grad_accum_steps = 3
        cfg.num_workers = min(4, hw.cpu_cores)
        cfg.use_amp = True
    else:
        cfg.image_size = 384
        cfg.batch_size = 10
        cfg.grad_accum_steps = 2
        cfg.num_workers = min(8, hw.cpu_cores)
    return cfg


def save_config(cfg: PipelineConfig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(cfg)
    for k, v in payload.items():
        if isinstance(v, Path):
            payload[k] = str(v)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
