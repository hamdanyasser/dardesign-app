"""Cultural furniture catalogue + recommendation ranking.

Reads `ontology/furniture.json` (the same shared-data pattern as ontology.json:
backend ranks with it, frontend renders cards from it) and ranks items for a
specific room.

Recommendations are never random — the ranking uses, in rough order of weight:
  culture (a hard filter, not a score), room type, whether that category is
  already in the room, whether the piece physically fits the free floor area,
  colour/material harmony with what's there, and the user's mood preset.

Every signal except culture is optional. With only a culture you still get a
sensible list ordered by room-type fit; each extra signal sharpens it. That
matters because the room-analysis pass that supplies free-space and existing-
furniture data is built after this module, and the frontend panel needs to work
before then.

GPU NOT NEEDED — pure data ranking, no model inference.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_PATH = ROOT / "ontology" / "furniture.json"

CULTURES = ("lebanese", "khaleeji", "moroccan")

MIN_RESULTS = 3
MAX_RESULTS = 6

# Mood presets -> the tags they favour. Used only when the caller passes a mood;
# an unknown mood contributes nothing rather than erroring, so the frontend can
# add presets without a backend deploy.
MOOD_AFFINITY: dict[str, set[str]] = {
    "warm": {"warm_brown", "gold", "amber", "brass_gold", "terracotta", "ochre", "tan"},
    "daylight": {"cream", "ivory", "natural", "pale_stone", "white_marble", "neutral"},
    "evening": {"gold", "amber", "dark_wood", "brass_gold", "warm_metal"},
    "luxury": {"gold", "white_marble", "brass_gold", "ivory"},
    "cozy": {"warm_brown", "tan", "ochre", "natural", "cream"},
    "minimal": {"neutral", "pale_stone", "cream", "natural"},
    "traditional": {"dark_wood", "warm_brown", "brass_gold", "terracotta"},
    "modern": {"white_marble", "clear", "neutral", "gold"},
}


class CatalogueError(RuntimeError):
    """Raised when the catalogue is missing or an id/culture is unknown."""


@dataclass
class Recommendation:
    item: dict[str, Any]
    score: float
    # Human-readable, bilingual-ready justifications. The panel can surface these
    # so a recommendation never looks arbitrary to the user (or to an examiner).
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {**self.item, "score": round(self.score, 3), "reasons": self.reasons}


@lru_cache(maxsize=1)
def _load(path_str: str) -> dict:
    path = Path(path_str)
    if not path.exists():
        raise CatalogueError(f"furniture catalogue not found at {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise CatalogueError(f"furniture catalogue is not valid JSON: {e}") from e


def load_catalogue(path: Path | None = None) -> dict:
    return _load(str(path or CATALOGUE_PATH))


def all_items(path: Path | None = None) -> list[dict]:
    return list(load_catalogue(path).get("items", []))


def get_item(item_id: str, path: Path | None = None) -> dict:
    for item in all_items(path):
        if item.get("id") == item_id:
            return item
    raise CatalogueError(f"unknown furniture id: {item_id!r}")


def items_for_culture(culture: str, path: Path | None = None) -> list[dict]:
    if culture not in CULTURES:
        raise CatalogueError(f"unknown culture: {culture!r} (expected one of {CULTURES})")
    return [i for i in all_items(path) if i.get("culture") == culture]


def known_room_types(path: Path | None = None) -> set[str]:
    """Every room_type mentioned by any catalogue item."""
    out: set[str] = set()
    for item in all_items(path):
        out.update(item.get("room_types") or [])
    return out


def normalize_room_type(value: str | None, path: Path | None = None) -> str | None:
    """Map free-text room labels onto catalogue keys, or None if unrecognised.

    Accepts "living room", "Living-Room", "living_room" — all become "living_room".
    Returns None for anything not in the catalogue rather than passing it through,
    because an unrecognised room type would otherwise make *every* item take the
    wrong-room penalty, which is a worse answer than having no room signal at all.

    This is an allowlist, so it is also the input validation: the value only ever
    gets compared against catalogue strings and never reaches a prompt.
    """
    if not value or not isinstance(value, str):
        return None
    key = value.strip().lower().replace(" ", "_").replace("-", "_")
    return key if key in known_room_types(path) else None


def _overlap(a: Iterable[str] | None, b: Iterable[str] | None) -> int:
    if not a or not b:
        return 0
    return len(set(a) & set(b))


def _fits(item: dict, free_floor_m2: float | None) -> bool | None:
    """True/False if we can judge, None if the caller gave us no space data."""
    if free_floor_m2 is None:
        return None
    w_cm, d_cm = item.get("floor_footprint_cm", [0, 0])
    footprint_m2 = (w_cm / 100.0) * (d_cm / 100.0)
    # Require headroom around the piece — a sofa that exactly fills the free floor
    # leaves nowhere to walk, which the placement engine would reject anyway.
    return footprint_m2 * 1.6 <= free_floor_m2


def recommend(
    culture: str,
    *,
    room_type: str | None = None,
    existing_categories: Iterable[str] | None = None,
    room_colors: Iterable[str] | None = None,
    room_materials: Iterable[str] | None = None,
    free_floor_m2: float | None = None,
    mood: str | None = None,
    limit: int = MAX_RESULTS,
    catalogue_path: Path | None = None,
) -> list[Recommendation]:
    """Rank this culture's catalogue items for the given room. Culture is a hard filter."""
    candidates = items_for_culture(culture, catalogue_path)
    existing = set(existing_categories or ())
    mood_tags = MOOD_AFFINITY.get((mood or "").strip().lower(), set())
    # Normalise here too, so callers that skip the endpoint (tests, the placement
    # engine) can pass "living room" and get the same ranking as "living_room".
    room_type = normalize_room_type(room_type, catalogue_path)

    scored: list[Recommendation] = []
    for item in candidates:
        score = 1.0
        reasons: list[str] = []

        # --- room type ---
        if room_type:
            if room_type in (item.get("room_types") or []):
                score += 2.0
                reasons.append(f"suits a {room_type.replace('_', ' ')}")
            else:
                # Not disqualifying: a chair in a kitchen is odd, not impossible.
                score -= 1.0

        # --- don't pile up duplicates of what's already there ---
        category = item.get("category")
        if existing:
            if category in existing:
                score -= 1.5
                reasons.append("similar piece already in the room")
            else:
                score += 1.5
                reasons.append("adds a piece the room is missing")

        # --- physical fit ---
        fits = _fits(item, free_floor_m2)
        if fits is True:
            score += 1.0
            reasons.append("fits the available floor space")
        elif fits is False:
            # Heavily penalised rather than removed, so a small room still returns
            # something and the placement engine gets the final say.
            score -= 3.0
            reasons.append("may be too large for the free floor area")

        # --- harmony with what the room already looks like ---
        color_hits = _overlap(item.get("color_tags"), room_colors)
        if color_hits:
            score += 0.5 * color_hits
            reasons.append("matches the room's colour palette")
        material_hits = _overlap(item.get("material_tags"), room_materials)
        if material_hits:
            score += 0.4 * material_hits
            reasons.append("matches the room's materials")

        # --- mood preset ---
        mood_hits = _overlap(item.get("color_tags"), mood_tags)
        if mood_hits:
            score += 0.4 * mood_hits
            reasons.append(f"fits a {mood} mood")

        scored.append(Recommendation(item=item, score=score, reasons=reasons))

    scored.sort(key=lambda r: (-r.score, r.item["id"]))

    # Always return at least MIN_RESULTS if the culture has that many, even when
    # everything scored badly — an empty panel is a worse answer than a weak one,
    # and the placement engine still validates whatever the user picks.
    limit = max(MIN_RESULTS, min(limit, MAX_RESULTS))
    return scored[:limit]
