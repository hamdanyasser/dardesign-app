"""Build (positive, negative) Stable Diffusion prompts in EN and AR from the ontology.

Public surface:
    build_prompts(culture, room=None, *, ontology_path=None, seed=None,
                  per_category=2, strict=False) -> Prompts

The pipeline calls `build_prompts(...)` for every transform request; the LoRA
trigger phrase is always injected, regardless of whether the LoRA file is on
disk yet (prompt-only fallback uses the same prompt).
"""
from __future__ import annotations

import argparse
import json
import logging
import random
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Literal

logger = logging.getLogger(__name__)

CultureId = Literal["lebanese", "khaleeji", "moroccan"]
CULTURES: tuple[CultureId, ...] = ("lebanese", "khaleeji", "moroccan")

CATEGORIES: tuple[str, ...] = (
    "architectural",
    "materials",
    "color_palette",
    "lighting",
    "furniture",
    "textiles",
    "ornamentation",
)

DEFAULT_ONTOLOGY_PATH = Path(__file__).resolve().parent.parent / "ontology" / "ontology.json"


@dataclass
class Prompts:
    positive_en: str
    positive_ar: str
    negative_en: str
    negative_ar: str
    trigger_en: str
    trigger_ar: str
    culture: CultureId

    def to_dict(self) -> dict:
        return asdict(self)


def _load_ontology(path: Path | None) -> dict:
    p = path or DEFAULT_ONTOLOGY_PATH
    with open(p, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _weighted_sample(
    items: list[dict],
    k: int,
    rng: random.Random,
    strict: bool,
) -> list[dict]:
    """Sample up to k items, biased by 'weight'. Skips unverified entries when strict."""
    pool = [it for it in items if (not strict or it.get("verified"))]
    if not pool:
        if strict:
            logger.warning("strict mode: no verified entries in category, falling back to all")
        pool = items
    if len(pool) <= k:
        return list(pool)
    weights = [max(0.1, float(it.get("weight", 1.0))) for it in pool]
    # random.choices with replacement, then dedup preserving order
    picked: list[dict] = []
    seen: set[int] = set()
    attempts = 0
    while len(picked) < k and attempts < k * 8:
        choice = rng.choices(pool, weights=weights, k=1)[0]
        idx = id(choice)
        if idx not in seen:
            seen.add(idx)
            picked.append(choice)
        attempts += 1
    return picked


def _join(items: Iterable[str]) -> str:
    return ", ".join(s for s in items if s)


def build_prompts(
    culture: str,
    room: str | None = None,
    *,
    ontology_path: Path | None = None,
    seed: int | None = None,
    per_category: int = 2,
    strict: bool = False,
) -> Prompts:
    """Return a `Prompts` bundle for the given culture and optional room context.

    `room` is a free-text label like "living room", "majlis", "riad courtyard".
    `seed` makes sampling deterministic — set it in tests and ablation runs.
    `per_category` controls how many terms from each ontology category make it
    into the positive prompt; 2 is the demo default.
    `strict=True` skips unverified ontology entries (use after Zainab signs off).
    """
    if culture not in CULTURES:
        raise ValueError(f"unknown culture {culture!r}; expected one of {CULTURES}")

    ontology = _load_ontology(ontology_path)
    rng = random.Random(seed)

    trigger = ontology["trigger"][culture]
    culture_block = ontology["cultures"][culture]

    en_terms: list[str] = []
    ar_terms: list[str] = []

    for cat in CATEGORIES:
        items = culture_block.get(cat, [])
        if not items:
            continue
        picked = _weighted_sample(items, per_category, rng, strict)
        en_terms.extend(p["en"] for p in picked)
        ar_terms.extend(p["ar"] for p in picked)

    room_en = (room or "interior").strip()
    room_ar_map = {
        "living room": "غرفة جلوس",
        "majlis": "مجلس",
        "dining room": "غرفة طعام",
        "bedroom": "غرفة نوم",
        "kitchen": "مطبخ",
        "courtyard": "فناء",
        "riad courtyard": "فناء رياض",
        "salon marocain": "صالون مغربي",
        "hammam": "حمّام",
        "interior": "تصميم داخلي",
    }
    room_ar = room_ar_map.get(room_en.lower(), room_en)

    positive_en = (
        f"a {room_en} in the {trigger['en']}, photorealistic interior photography, "
        f"natural daylight, magazine-quality, 8k, intricate detail, "
        f"{_join(en_terms)}"
    )
    positive_ar = (
        f"{room_ar} {trigger['ar']}، تصوير داخلي واقعي، إضاءة نهارية طبيعية، "
        f"جودة مجلات، تفاصيل دقيقة، {_join(ar_terms)}"
    )

    neg_universal = ontology.get("negative_universal", [])
    neg_specific = culture_block.get("negative_specific", [])
    negative_en = _join(list(neg_universal) + list(neg_specific))
    # AR negatives: short, transliterated where helpful
    neg_ar_terms = [
        "جودة منخفضة", "ضبابي", "علامة مائية", "نص على الصورة", "توقيع",
        "منظور مشوّه", "هندسة مشوّهة", "جدران ملتوية", "مزدحم", "ألوان مبالغ بها",
        "مظهر بلاستيكي", "نباتات صناعية", "إضاءة نيون", "غرفة فندقية عامة",
        "صورة أرشيفية", "جودة هواة",
    ]
    negative_ar = _join(neg_ar_terms)

    return Prompts(
        positive_en=positive_en,
        positive_ar=positive_ar,
        negative_en=negative_en,
        negative_ar=negative_ar,
        trigger_en=trigger["en"],
        trigger_ar=trigger["ar"],
        culture=culture,  # type: ignore[arg-type]
    )


def _cli() -> None:
    p = argparse.ArgumentParser(description="Build SD prompts for a culture/room.")
    p.add_argument("--culture", required=True, choices=list(CULTURES))
    p.add_argument("--room", default="living room")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--per-category", type=int, default=2)
    p.add_argument("--strict", action="store_true", help="only use verified ontology entries")
    p.add_argument("--ontology", type=Path, default=None)
    args = p.parse_args()
    out = build_prompts(
        args.culture,
        args.room,
        ontology_path=args.ontology,
        seed=args.seed,
        per_category=args.per_category,
        strict=args.strict,
    )
    print(json.dumps(out.to_dict(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _cli()
