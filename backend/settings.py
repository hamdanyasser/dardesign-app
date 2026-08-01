"""Centralized local runtime settings for DarDesign.

This module defines all local directories, environment-based overrides,
hardware detection, and lightweight runtime telemetry helpers.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class AppSettings:
    root_dir: Path
    data_dir: Path
    raw_dir: Path
    processed_dir: Path
    models_dir: Path
    cache_dir: Path
    exports_dir: Path
    temp_dir: Path
    logs_dir: Path
    checkpoints_dir: Path
    upload_dir: Path

    @staticmethod
    def from_env() -> "AppSettings":
        data_dir = Path(os.environ.get("DARDESIGN_DATA_DIR", ROOT / "data"))
        models_dir = Path(os.environ.get("DARDESIGN_MODELS_DIR", data_dir / "models"))
        exports_dir = Path(os.environ.get("DARDESIGN_EXPORTS_DIR", data_dir / "exports"))
        cache_dir = Path(os.environ.get("DARDESIGN_CACHE_DIR", data_dir / "cache"))
        logs_dir = Path(os.environ.get("DARDESIGN_LOGS_DIR", ROOT / "logs"))
        temp_dir = Path(os.environ.get("DARDESIGN_TEMP_DIR", data_dir / "temp"))
        checkpoints_dir = Path(
            os.environ.get("DARDESIGN_CHECKPOINTS_DIR", data_dir / "checkpoints")
        )
        upload_dir = Path(
            os.environ.get("DARDESIGN_UPLOAD_DIR", ROOT / "backend" / "uploads")
        )
        return AppSettings(
            root_dir=ROOT,
            data_dir=data_dir,
            raw_dir=Path(os.environ.get("DARDESIGN_RAW_DIR", data_dir / "raw")),
            processed_dir=Path(
                os.environ.get("DARDESIGN_PROCESSED_DIR", data_dir / "processed")
            ),
            models_dir=models_dir,
            cache_dir=cache_dir,
            exports_dir=exports_dir,
            temp_dir=temp_dir,
            logs_dir=logs_dir,
            checkpoints_dir=checkpoints_dir,
            upload_dir=upload_dir,
        )

    def ensure_dirs(self) -> None:
        for d in (
            self.data_dir,
            self.raw_dir,
            self.processed_dir,
            self.models_dir,
            self.cache_dir,
            self.exports_dir,
            self.temp_dir,
            self.logs_dir,
            self.checkpoints_dir,
            self.upload_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class HardwareProfile:
    device: str
    gpu_name: str | None
    gpu_vram_gb: float | None
    cpu_cores: int
    ram_gb: float | None
    precision: str
    image_size: int
    batch_size: int
    grad_accum_steps: int
    num_workers: int


def detect_hardware_profile() -> HardwareProfile:
    cpu_cores = max(1, os.cpu_count() or 1)
    ram_gb = None
    try:
        import psutil  # type: ignore

        ram_gb = psutil.virtual_memory().total / (1024**3)
    except Exception:
        pass

    gpu_name = None
    vram_gb = None
    cuda_ok = False
    try:
        import torch

        cuda_ok = bool(torch.cuda.is_available())
        if cuda_ok:
            gpu_name = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            vram_gb = props.total_memory / (1024**3)
    except Exception:
        cuda_ok = False

    if cuda_ok and vram_gb is not None and vram_gb <= 8.5:
        return HardwareProfile(
            device="cuda",
            gpu_name=gpu_name,
            gpu_vram_gb=vram_gb,
            cpu_cores=cpu_cores,
            ram_gb=ram_gb,
            precision="fp16",
            image_size=768,
            batch_size=1,
            grad_accum_steps=4,
            num_workers=min(4, cpu_cores),
        )

    if cuda_ok:
        return HardwareProfile(
            device="cuda",
            gpu_name=gpu_name,
            gpu_vram_gb=vram_gb,
            cpu_cores=cpu_cores,
            ram_gb=ram_gb,
            precision="fp16",
            image_size=1024,
            batch_size=1,
            grad_accum_steps=2,
            num_workers=min(8, cpu_cores),
        )

    return HardwareProfile(
        device="cpu",
        gpu_name=None,
        gpu_vram_gb=None,
        cpu_cores=cpu_cores,
        ram_gb=ram_gb,
        precision="fp32",
        image_size=512,
        batch_size=1,
        grad_accum_steps=8,
        num_workers=min(4, cpu_cores),
    )


def collect_runtime_metrics() -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    try:
        import psutil  # type: ignore

        p = psutil.Process(os.getpid())
        metrics["cpu_percent"] = p.cpu_percent(interval=0.0)
        metrics["rss_mb"] = round(p.memory_info().rss / (1024**2), 2)
        metrics["ram_percent"] = psutil.virtual_memory().percent
    except Exception:
        pass

    try:
        import torch

        if torch.cuda.is_available():
            metrics["gpu_alloc_mb"] = round(torch.cuda.memory_allocated() / (1024**2), 2)
            metrics["gpu_reserved_mb"] = round(torch.cuda.memory_reserved() / (1024**2), 2)
            metrics["gpu_peak_alloc_mb"] = round(
                torch.cuda.max_memory_allocated() / (1024**2), 2
            )
    except Exception:
        pass
    return metrics


def configure_file_logging(name: str, logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    root_logger = logging.getLogger()
    target = (logs_dir / f"{name}.log").resolve()
    for h in root_logger.handlers:
        if isinstance(h, logging.FileHandler) and Path(h.baseFilename).resolve() == target:
            return
    file_handler = logging.FileHandler(target, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root_logger.addHandler(file_handler)


SETTINGS = AppSettings.from_env()
SETTINGS.ensure_dirs()