from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import csv
import hashlib
import json
import random
import shutil
from statistics import mean, pstdev

from PIL import Image, ImageFilter, ImageStat, UnidentifiedImageError

from .config import PipelineConfig

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass
class ImageRecord:
    path: Path
    label: str
    width: int
    height: int
    mode: str
    mean_rgb: tuple[float, float, float]
    lap_var: float
    phash: str
    sha1: str


def _iter_label_images(data_root: Path) -> list[tuple[Path, str]]:
    rows: list[tuple[Path, str]] = []
    for label_dir in sorted(p for p in data_root.iterdir() if p.is_dir()):
        label = label_dir.name
        for p in label_dir.rglob("*"):
            if p.is_file() and p.suffix.lower() in VALID_EXTS:
                rows.append((p, label))
    return rows


def _sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _edge_variance(im: Image.Image) -> float:
    # Approximate blur using edge-energy variance from FIND_EDGES output.
    gray = im.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    st = ImageStat.Stat(edges)
    return float(st.var[0])


def _phash_from_image(im: Image.Image) -> str:
    # Lightweight average-hash variant (dependency-free).
    gray = im.convert("L").resize((16, 16))
    px = list(gray.getdata())
    avg = sum(px) / max(1, len(px))
    return "".join("1" if p > avg else "0" for p in px)


def build_dataset_report(cfg: PipelineConfig, out_path: Path) -> dict:
    pairs = _iter_label_images(cfg.data_root)
    classes = sorted({label for _, label in pairs})

    bad_files: list[str] = []
    records: list[ImageRecord] = []
    dims: list[tuple[int, int]] = []
    aspect_ratios: list[float] = []
    color_means: list[tuple[float, float, float]] = []
    phash_counter: Counter[str] = Counter()
    sha_counter: Counter[str] = Counter()

    for path, label in pairs:
        try:
            with Image.open(path) as im:
                im.verify()
            with Image.open(path) as im:
                rgb_im = im.convert("RGB")
                w, h = rgb_im.size
                dims.append((w, h))
                aspect_ratios.append(w / max(h, 1))
                st = ImageStat.Stat(rgb_im)
                mean_rgb = tuple(float(x) for x in st.mean[:3])
                color_means.append(mean_rgb)
                lap = _edge_variance(rgb_im)
                ph = _phash_from_image(rgb_im)
                digest = _sha1(path)
                phash_counter[ph] += 1
                sha_counter[digest] += 1
                records.append(
                    ImageRecord(
                        path=path,
                        label=label,
                        width=w,
                        height=h,
                        mode=rgb_im.mode,
                        mean_rgb=mean_rgb,
                        lap_var=lap,
                        phash=ph,
                        sha1=digest,
                    )
                )
        except (UnidentifiedImageError, OSError, ValueError):
            bad_files.append(str(path))

    class_counts = Counter(r.label for r in records)
    empty_folders = [
        p.name for p in sorted(cfg.data_root.iterdir()) if p.is_dir() and p.name not in class_counts
    ]

    duplicates_by_sha = sum(v - 1 for v in sha_counter.values() if v > 1)
    duplicates_by_phash = sum(v - 1 for v in phash_counter.values() if v > 1)
    blurry = sum(1 for r in records if r.lap_var < cfg.blur_laplacian_threshold)
    very_small = sum(1 for r in records if min(r.width, r.height) < cfg.min_size)

    report = {
        "data_root": str(cfg.data_root),
        "num_classes": len(classes),
        "class_names": classes,
        "images_per_class": dict(class_counts),
        "total_images": len(records),
        "class_imbalance_ratio": (
            max(class_counts.values()) / max(1, min(class_counts.values())) if class_counts else None
        ),
        "duplicates": {
            "exact_sha1_duplicates": duplicates_by_sha,
            "perceptual_duplicates_same_hash": duplicates_by_phash,
        },
        "corrupted_images": len(bad_files),
        "blurry_images": blurry,
        "very_small_images": very_small,
        "empty_folders": empty_folders,
        "dimensions": {
            "min_width": min((w for w, _ in dims), default=None),
            "max_width": max((w for w, _ in dims), default=None),
            "min_height": min((h for _, h in dims), default=None),
            "max_height": max((h for _, h in dims), default=None),
        },
        "aspect_ratio": {
            "min": min(aspect_ratios) if aspect_ratios else None,
            "max": max(aspect_ratios) if aspect_ratios else None,
            "mean": float(mean(aspect_ratios)) if aspect_ratios else None,
            "std": float(pstdev(aspect_ratios)) if len(aspect_ratios) > 1 else 0.0,
        },
        "color_distribution": {
            "mean_r": float(mean([m[0] for m in color_means])) if color_means else None,
            "mean_g": float(mean([m[1] for m in color_means])) if color_means else None,
            "mean_b": float(mean([m[2] for m in color_means])) if color_means else None,
        },
        "likely_incorrect_labels": [],
        "corrupted_file_paths": bad_files,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def clean_dataset(cfg: PipelineConfig) -> dict:
    cleaned_root = cfg.processed_root / "cleaned"
    quarantine = cfg.quarantine_root
    cleaned_root.mkdir(parents=True, exist_ok=True)
    quarantine.mkdir(parents=True, exist_ok=True)

    pairs = _iter_label_images(cfg.data_root)
    rng = random.Random(cfg.seed)
    rng.shuffle(pairs)

    seen_sha: set[str] = set()
    kept: list[ImageRecord] = []
    dropped: list[tuple[str, str, str]] = []

    for src, label in pairs:
        reason = None
        try:
            with Image.open(src) as im:
                im.verify()
            with Image.open(src) as im:
                rgb_im = im.convert("RGB")
                w, h = rgb_im.size
                digest = _sha1(src)
                if digest in seen_sha:
                    reason = "duplicate_sha1"
                elif min(w, h) < cfg.min_size:
                    reason = "too_small"
                elif max(w / max(h, 1), h / max(w, 1)) > cfg.max_aspect_ratio:
                    reason = "extreme_aspect_ratio"
                elif _edge_variance(rgb_im) < cfg.blur_laplacian_threshold:
                    reason = "blurry"
                if reason is None:
                    ph = _phash_from_image(rgb_im)
                    out_dir = cleaned_root / label
                    out_dir.mkdir(parents=True, exist_ok=True)
                    out_name = f"{src.stem}_{digest[:8]}.jpg"
                    out_path = out_dir / out_name
                    rgb_im.save(out_path, format="JPEG", quality=95)
                    seen_sha.add(digest)
                    kept.append(
                        ImageRecord(
                            path=out_path,
                            label=label,
                            width=w,
                            height=h,
                            mode="RGB",
                            mean_rgb=tuple(float(x) for x in ImageStat.Stat(rgb_im).mean[:3]),
                            lap_var=_edge_variance(rgb_im),
                            phash=ph,
                            sha1=digest,
                        )
                    )
        except (UnidentifiedImageError, OSError, ValueError):
            reason = "corrupted"

        if reason is not None:
            qdir = quarantine / reason / label
            qdir.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(src, qdir / src.name)
            except OSError:
                pass
            dropped.append((str(src), label, reason))

    drop_log = cfg.reports_root / "data_cleaning_removed.csv"
    drop_log.parent.mkdir(parents=True, exist_ok=True)
    with open(drop_log, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "reason"])
        for row in dropped:
            w.writerow(row)

    summary = {
        "kept": len(kept),
        "removed": len(dropped),
        "removed_by_reason": dict(Counter(r for _, _, r in dropped)),
        "cleaned_root": str(cleaned_root),
        "quarantine_root": str(quarantine),
        "removed_log": str(drop_log),
    }
    (cfg.reports_root / "data_cleaning_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary


def build_stratified_group_splits(cfg: PipelineConfig) -> dict:
    cleaned_root = cfg.processed_root / "cleaned"
    pairs = _iter_label_images(cleaned_root)
    if not pairs:
        raise RuntimeError(f"No images found in {cleaned_root}")

    paths: list[str] = []
    y: list[str] = []
    groups: list[str] = []

    for path, label in pairs:
        with Image.open(path) as im:
            ph = _phash_from_image(im)
        paths.append(str(path))
        y.append(label)
        groups.append(ph)

    # Manual stratified grouped split: keep same perceptual group in one split.
    label_group_to_indices: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for i, (label, group) in enumerate(zip(y, groups)):
        label_group_to_indices[label][group].append(i)

    rng = random.Random(cfg.seed)
    train_idx: list[int] = []
    val_idx: list[int] = []
    test_idx: list[int] = []

    for label, gmap in label_group_to_indices.items():
        groups_list = list(gmap.keys())
        rng.shuffle(groups_list)
        total_items = sum(len(gmap[g]) for g in groups_list)
        target_test = int(round(total_items * cfg.test_ratio))
        target_val = int(round(total_items * cfg.val_ratio))

        c_test = 0
        c_val = 0
        for g in groups_list:
            idxs = gmap[g]
            if c_test < target_test:
                test_idx.extend(idxs)
                c_test += len(idxs)
            elif c_val < target_val:
                val_idx.extend(idxs)
                c_val += len(idxs)
            else:
                train_idx.extend(idxs)

    split_rows: list[tuple[str, str, str]] = []
    for i in train_idx:
        split_rows.append((paths[i], y[i], "train"))
    for i in val_idx:
        split_rows.append((paths[i], y[i], "val"))
    for i in test_idx:
        split_rows.append((paths[i], y[i], "test"))

    split_csv = cfg.processed_root / "splits.csv"
    split_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(split_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "split"])
        for row in split_rows:
            w.writerow(row)

    stats = {
        "total": len(split_rows),
        "train": int(sum(1 for _, _, s in split_rows if s == "train")),
        "val": int(sum(1 for _, _, s in split_rows if s == "val")),
        "test": int(sum(1 for _, _, s in split_rows if s == "test")),
        "split_csv": str(split_csv),
    }
    (cfg.reports_root / "split_summary.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    return stats
