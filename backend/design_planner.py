"""Design planner — an LLM chooses what goes where; the placement engine decides if it may.

The model is a *design planner*, never a renderer and never a source of facts.
It picks pieces from the cultural catalogue and proposes where they stand. It
does not invent furniture, dimensions, or geometry, and nothing it returns
reaches the 3D scene until the same oriented-rectangle collision engine that
governs a human drag has accepted it.

Five gates, each one a place a hallucination dies:

  1. Closed vocabulary. `catalogId` is a JSON-Schema enum of exactly the ids in
     the requested culture, so structured outputs make an invented
     "leb-chandelier-009" unrepresentable rather than merely unlikely.
  2. No invented dimensions. The model emits no sizes at all; width, depth and
     height come from ontology/furniture.json via the catalogue.
  3. Backend validation (validate_items below): unknown id, non-finite or
     out-of-room coordinate, or unknown material -> dropped and REPORTED, never
     quietly rounded into something plausible.
  4. Client re-validation through evaluatePlacement() — see
     src/lib/design/planner.ts. That is the gate that actually protects the scene.
  5. Advisory verdicts still pass. Standing a sofa where the photograph found the
     old one is the most likely act of redesign, so it is stated, not refused.

**Unconfigured is a working mode, not an error.** With no ANTHROPIC_API_KEY the
planner returns a deterministic rule-based layout tagged `source: "rules"`, the
same way mailer.py logs a message it cannot send. The demo, the tests and CI all
run this path, so the feature is never dark.

Cost: the catalogue is 9 items per culture, so a plan is ~1k tokens in and ~1.5k
out — fractions of a cent. Do not send furniture.json wholesale (9.4k tokens);
`catalogue_projection` is the compact view. Prompt caching is deliberately NOT
used: the minimum cacheable prefix is 1024 tokens on Sonnet 5 and 4096 on Haiku,
so a prompt this small would silently fail to cache and pay the write premium
for nothing. The response cache below is what makes a repeated demo free.

GPU NOT NEEDED — one HTTPS call, or none at all.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
from typing import Any

from .furniture import CULTURES, items_for_culture

logger = logging.getLogger("dardesign.planner")

DEFAULT_MODEL = "claude-sonnet-5"
MAX_OUTPUT_TOKENS = 2000
MAX_ITEMS = 12

# A paid endpoint deserves a ceiling that does not depend on anyone remembering.
# Per process, reset on restart; the point is to bound a runaway loop, not to bill.
MAX_CALLS_PER_PROCESS = 200
_calls_made = 0

# Approximate list prices ($/1M tokens) purely so the log can state what a call
# cost. Wrong numbers here change nothing but the log line.
_PRICES = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-opus-5": (5.0, 25.0),
}

# Must stay in step with MATERIALS in src/lib/design/materials.ts. "found" is
# deliberately excluded: it is the grey reserved for objects DAR detected in the
# photograph, and a planned piece is not one of those.
MATERIAL_KEYS = (
    "limestone", "tadelakt", "gypsum", "sand", "marble", "encaustic",
    "cedar", "walnut", "boneInlay", "brass", "agedBrass", "iron",
    "linen", "velvet", "leather", "wool", "zellige", "saffron",
    "glass", "lamplight",
)

# "all" is not a fourth culture. The renderer collapses it to Lebanese because a
# generator takes one culture; the planner follows the same rule so what you plan
# is what you render.
_ALL_FALLBACK_CULTURE = "lebanese"

_cache: dict[str, dict] = {}


# --------------------------------------------------------------------------
# catalogue view
# --------------------------------------------------------------------------

def _cultures_for(culture: str) -> list[str]:
    if culture == "all":
        return list(CULTURES)
    if culture not in CULTURES:
        raise ValueError(f"unknown culture: {culture!r}")
    return [culture]


def catalogue_projection(culture: str) -> list[dict]:
    """The catalogue as the model sees it — ids, sizes and placement rules only.

    Built on furniture.items_for_culture so the planner and the placement
    endpoints can never disagree about what exists.

    Field-order trap: the raw JSON is width, HEIGHT, depth. catalog.ts exposes
    width, depth, height. Read the keys, never the order.
    """
    out: list[dict] = []
    for c in _cultures_for(culture):
        for it in items_for_culture(c):
            out.append({
                "id": it["id"],
                "culture": it["culture"],
                "category": it["category"],
                "nameEn": it.get("name_en", it["id"]),
                "widthCm": it["real_width_cm"],
                "depthCm": it["real_depth_cm"],
                "heightCm": it["real_height_cm"],
                "mustTouchWall": bool(it.get("must_touch_wall")),
                "zones": it.get("preferred_zones", []),
            })
    return out


def allowed_ids(culture: str) -> list[str]:
    return [i["id"] for i in catalogue_projection(culture)]


# --------------------------------------------------------------------------
# schema + prompt
# --------------------------------------------------------------------------

def plan_schema(culture: str) -> dict:
    """JSON Schema for the plan. The enum is the whole grounding story."""
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "catalogId": {"type": "string", "enum": allowed_ids(culture)},
                        "xCm": {"type": "number"},
                        "zCm": {"type": "number"},
                        "rotationDeg": {"type": "number"},
                        "materialKey": {"type": "string", "enum": list(MATERIAL_KEYS)},
                        "reasonEn": {"type": "string"},
                        "reasonAr": {"type": "string"},
                    },
                    "required": [
                        "catalogId", "xCm", "zCm", "rotationDeg",
                        "materialKey", "reasonEn", "reasonAr",
                    ],
                    "additionalProperties": False,
                },
            },
            "notesEn": {"type": "string"},
            "notesAr": {"type": "string"},
        },
        "required": ["items", "notesEn", "notesAr"],
        "additionalProperties": False,
    }


_SYSTEM = """You are DAR's interior design planner for Arab domestic interiors.

You choose which pieces from a fixed catalogue belong in a room and where each
one stands. You are planning a real, buildable arrangement that a person will
then edit by hand, so it must be habitable, not decorative on paper.

COORDINATE FRAME — read carefully, everything is centimetres:
- The floor is a rectangle centred on the origin.
- x runs left(-) to right(+), from -width/2 to +width/2.
- z runs far(-) to near(+), from -depth/2 to +depth/2. The far wall is z = -depth/2.
- x and z give the CENTRE of a piece's footprint.
- rotationDeg turns the footprint clockwise seen from above. 0 leaves the piece's
  width along x. Use 90 or 270 for pieces standing against a left or right wall.

RULES:
- Use only catalogue ids given to you. Never invent one.
- Never emit dimensions; sizes come from the catalogue.
- Keep every footprint fully inside the room, and do not overlap two pieces.
- A piece marked mustTouchWall must sit against a wall.
- Leave walking room: at least 60cm of clear floor to move through.
- Seating should face seating. Put a coffee table within reach of the main sofa,
  roughly 40-50cm in front of it.
- Prefer fewer, well-placed pieces over filling the room. 5-9 is usually right.
- Respect what the person asked for. If they asked for a reading corner, the plan
  should have one and you should say where it is.

For each piece give a short, specific reason in English and Arabic — what it is
doing in the room, not a description of the object.
Write notesEn/notesAr as one or two sentences on the arrangement as a whole."""


def build_user_message(room: dict, culture: str, brief: str, existing: list[dict]) -> str:
    lines = [
        f"Room: {int(room['widthCm'])}cm wide (x) by {int(room['depthCm'])}cm deep (z), "
        f"{int(room.get('heightCm') or 300)}cm high.",
        f"So x runs {-int(room['widthCm']) // 2} to {int(room['widthCm']) // 2}, "
        f"z runs {-int(room['depthCm']) // 2} to {int(room['depthCm']) // 2}.",
        f"Culture: {culture}",
        "",
        "Catalogue (choose only from these):",
        json.dumps(catalogue_projection(culture), ensure_ascii=False),
    ]
    if existing:
        lines += [
            "",
            "Already in the room — DAR detected these in the photograph. Design around "
            "them where sensible; you may plan over one if replacing it is the point.",
            json.dumps(existing, ensure_ascii=False),
        ]
    lines += ["", "What the person asked for:", brief.strip() or "A comfortable, well-proportioned room."]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# validation — gate 3
# --------------------------------------------------------------------------

def validate_items(raw: Any, culture: str, room: dict) -> tuple[list[dict], list[dict]]:
    """Split a model response into (accepted, rejected).

    Rejected entries carry a reason so the UI can say what was discarded instead
    of quietly showing a shorter plan than the model wrote.
    """
    by_id = {i["id"]: i for i in catalogue_projection(culture)}
    half_w = float(room["widthCm"]) / 2.0
    half_d = float(room["depthCm"]) / 2.0

    accepted: list[dict] = []
    rejected: list[dict] = []

    if not isinstance(raw, list):
        return [], [{"catalogId": None, "why": "model returned no item list"}]

    for entry in raw[:MAX_ITEMS]:
        if not isinstance(entry, dict):
            rejected.append({"catalogId": None, "why": "not an object"})
            continue
        cid = entry.get("catalogId")
        item = by_id.get(cid) if isinstance(cid, str) else None
        if item is None:
            rejected.append({"catalogId": cid, "why": "not in the catalogue"})
            continue

        try:
            x = float(entry["xCm"])
            z = float(entry["zCm"])
            rot = float(entry.get("rotationDeg") or 0.0)
        except (KeyError, TypeError, ValueError):
            rejected.append({"catalogId": cid, "why": "coordinates were not numbers"})
            continue
        if not all(math.isfinite(v) for v in (x, z, rot)):
            rejected.append({"catalogId": cid, "why": "coordinates were not finite"})
            continue
        # Generous bound: the client re-checks the real footprint against the real
        # walls. This only throws out answers that are nonsense at a glance.
        if abs(x) > half_w + 200 or abs(z) > half_d + 200:
            rejected.append({"catalogId": cid, "why": "position is outside the room"})
            continue

        material = entry.get("materialKey")
        if material not in MATERIAL_KEYS:
            material = None  # the client falls back to the item's own default

        accepted.append({
            "catalogId": cid,
            "xCm": round(x),
            "zCm": round(z),
            "rotationDeg": round(rot) % 360,
            "materialKey": material,
            "reasonEn": str(entry.get("reasonEn") or "")[:240],
            "reasonAr": str(entry.get("reasonAr") or "")[:240],
        })

    return accepted, rejected


# --------------------------------------------------------------------------
# deterministic fallback — the no-key path, and the one CI runs
# --------------------------------------------------------------------------

def _pick(items: list[dict], category: str) -> dict | None:
    for it in items:
        if it["category"] == category:
            return it
    return None


def fallback_plan(room: dict, culture: str, brief: str) -> list[dict]:
    """A sane arrangement from placement rules alone. No model involved.

    Deliberately simple: an anchor against the far wall, a table in front of it,
    seating flanking that, lamps to a corner and storage on the opposite wall.
    Anything it gets slightly wrong is repaired by the client's placement engine,
    which is the same engine that repairs the model's answers.
    """
    base = _ALL_FALLBACK_CULTURE if culture == "all" else culture
    items = catalogue_projection(base)
    W = float(room["widthCm"])
    D = float(room["depthCm"])
    out: list[dict] = []

    def add(item: dict | None, x: float, z: float, rot: float, en: str, ar: str) -> None:
        if item is None:
            return
        out.append({
            "catalogId": item["id"],
            "xCm": round(max(-W / 2 + 20, min(W / 2 - 20, x))),
            "zCm": round(max(-D / 2 + 20, min(D / 2 - 20, z))),
            "rotationDeg": rot % 360,
            "materialKey": None,
            "reasonEn": en,
            "reasonAr": ar,
        })

    sofa = _pick(items, "sofa")
    sofa_z = -D / 2 + (sofa["depthCm"] / 2 if sofa else 45) + 10
    add(sofa, 0, sofa_z, 0,
        "The main seat, set against the far wall so the room opens in front of it.",
        "المقعد الرئيسي، مسنود إلى الجدار البعيد لتنفتح الغرفة أمامه.")

    table = _pick(items, "coffee_table")
    table_z = sofa_z + (sofa["depthCm"] / 2 if sofa else 45) + 45 + (table["depthCm"] / 2 if table else 30)
    add(table, 0, table_z, 0,
        "Within easy reach of the sofa, leaving room to walk around it.",
        "في متناول الأريكة مع ترك مساحة للمرور حولها.")

    add(_pick(items, "armchair"), -W / 4, table_z, 90,
        "Turned toward the sofa so the seating faces itself.",
        "موجّه نحو الأريكة ليواجه الجلوس بعضه بعضاً.")

    add(_pick(items, "side_table"), -W / 4 + 70, table_z + 60, 0,
        "Beside the armchair, for a cup and a book.",
        "بجانب الكرسي، لفنجان وكتاب.")

    add(_pick(items, "ottoman"), W / 4, table_z, 0,
        "Extra seating that moves, opposite the armchair.",
        "مقعد إضافي يسهل تحريكه، مقابل الكرسي.")

    lamp = _pick(items, "lamp") or _pick(items, "lantern")
    add(lamp, -W / 2 + 45, -D / 2 + 45, 0,
        "Light in the corner, away from the centre of the room.",
        "إضاءة في الزاوية بعيداً عن وسط الغرفة.")

    storage = _pick(items, "console") or _pick(items, "cabinet")
    add(storage, 0, D / 2 - (storage["depthCm"] / 2 if storage else 20) - 10, 180,
        "Storage on the near wall, closing the room without crowding it.",
        "تخزين على الجدار القريب يُغلق الغرفة دون ازدحام.")

    return out


# --------------------------------------------------------------------------
# the model call
# --------------------------------------------------------------------------

def model_name() -> str:
    return (os.environ.get("DARDESIGN_LLM_MODEL") or "").strip() or DEFAULT_MODEL


def is_configured() -> bool:
    """Read per call, not at import — setting the key and restarting is enough."""
    return bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip())


def _client():
    try:
        import anthropic  # noqa: PLC0415 — optional dependency, imported on use
    except ImportError:
        logger.info("[planner] anthropic SDK not installed — using rule-based plans")
        return None
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return None
    return anthropic.Anthropic(api_key=key)


def _cache_key(room: dict, culture: str, brief: str) -> str:
    raw = f"{int(room['widthCm'])}x{int(room['depthCm'])}|{culture}|{' '.join(brief.lower().split())}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _log_cost(model: str, usage: Any) -> None:
    try:
        cin, cout = _PRICES.get(model, (0.0, 0.0))
        cost = (usage.input_tokens / 1e6) * cin + (usage.output_tokens / 1e6) * cout
        logger.info(
            "[planner] %s in=%d out=%d ~$%.4f (call %d/%d this process)",
            model, usage.input_tokens, usage.output_tokens, cost,
            _calls_made, MAX_CALLS_PER_PROCESS,
        )
    except Exception:  # noqa: BLE001 — a log line must never cost a plan
        pass


def plan(
    room: dict,
    culture: str,
    brief: str,
    existing: list[dict] | None = None,
    *,
    client: Any = None,
) -> dict:
    """Plan a room. Never raises — an unusable model answer degrades to rules.

    `client` is injectable so the tests can exercise every path without spending
    a cent or reaching the network.
    """
    global _calls_made
    existing = existing or []
    key = _cache_key(room, culture, brief)
    if key in _cache:
        cached = dict(_cache[key])
        cached["cached"] = True
        return cached

    api = client if client is not None else _client()
    warning: str | None = None

    if api is None:
        result = {
            "items": fallback_plan(room, culture, brief),
            "notesEn": "Planned from DAR's placement rules — no design model is configured.",
            "notesAr": "خُطّطت الغرفة بقواعد التوزيع في دار — لم يُضبط نموذج تصميم.",
            "source": "rules",
            "model": None,
            "rejected": [],
        }
        _cache[key] = result
        return dict(result)

    if _calls_made >= MAX_CALLS_PER_PROCESS:
        warning = "planner call cap reached for this process"
        logger.warning("[planner] %s — serving a rule-based plan", warning)
    else:
        model = model_name()
        try:
            _calls_made += 1
            resp = api.messages.create(
                model=model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=_SYSTEM,
                messages=[{
                    "role": "user",
                    "content": build_user_message(room, culture, brief, existing),
                }],
                # format and effort are siblings inside ONE output_config.
                output_config={
                    "format": {"type": "json_schema", "schema": plan_schema(culture)},
                    "effort": "low",
                },
            )
            _log_cost(model, getattr(resp, "usage", None))
            text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
            data = json.loads(text)
            accepted, rejected = validate_items(data.get("items"), culture, room)
            if accepted:
                result = {
                    "items": accepted,
                    "notesEn": str(data.get("notesEn") or "")[:600],
                    "notesAr": str(data.get("notesAr") or "")[:600],
                    "source": "llm",
                    "model": model,
                    "rejected": rejected,
                }
                _cache[key] = result
                return dict(result)
            warning = "the model returned no usable placement"
        except Exception as e:  # noqa: BLE001 — a planner failure must not cost the user their room
            logger.exception("[planner] call failed")
            warning = f"{type(e).__name__}"

    result = {
        "items": fallback_plan(room, culture, brief),
        "notesEn": "Planned from DAR's placement rules.",
        "notesAr": "خُطّطت الغرفة بقواعد التوزيع في دار.",
        "source": "rules",
        "model": None,
        "rejected": [],
        "warning": warning,
    }
    return result


def _reset_for_tests() -> None:
    global _calls_made
    _calls_made = 0
    _cache.clear()
