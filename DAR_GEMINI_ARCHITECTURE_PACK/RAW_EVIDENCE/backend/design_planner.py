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
# Gemini's free tier is what makes the model path testable at all while the
# Anthropic account has no balance. Same schema, same validator, same fallback.
# NOT gemini-2.5-flash: it is still listed by models.list() but returns 404
# "no longer available to new users" on a freshly issued key, which is exactly
# the kind of staleness a demo discovers at the worst moment.
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
MAX_OUTPUT_TOKENS = 2000
# Gemini 3.x counts its thinking against max_output_tokens. Measured on a real
# plan: ~5k thinking tokens before ~1.1k of JSON, so the 2k that is ample for
# Anthropic truncates the response mid-object and the plan silently degrades to
# rules. Free tier, so the headroom costs nothing.
MAX_OUTPUT_TOKENS_GEMINI = 12000
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


def _by_id() -> dict[str, dict]:
    return {i["id"]: i for i in catalogue_projection("all")}


def culture_of(catalog_id: str) -> str | None:
    return _by_id().get(catalog_id, {}).get("culture")


# Seats are NOT in the ontology — checked. So DAR derives them rather than
# asking the model to assert them: a bench seat is about 60cm, and everything
# with one seat has one. It is an estimate from real widths, labelled as one,
# and it is DAR's number rather than the model's.
SEAT_CM = 60.0


def seats_of(item: dict) -> int:
    cat = item.get("category")
    if cat == "sofa":
        return max(1, int(float(item["widthCm"]) // SEAT_CM))
    if cat in ("armchair", "chair", "ottoman"):
        return 1
    return 0


def seating_estimate(accepted: list[dict]) -> int:
    by_id = _by_id()
    return sum(seats_of(by_id[a["catalogId"]]) for a in accepted if a["catalogId"] in by_id)


# --------------------------------------------------------------------------
# the vocabularies the brief may be interpreted into
#
# Every one of these is somebody else's existing list, quoted here rather than
# invented. That is what keeps the interpretation grounded: the model may only
# say things the rest of DAR can already act on.
# --------------------------------------------------------------------------

# backend/prompt_builder.py's own room_ar_map keys — so a room type the model
# picks arrives at the real prompt builder with a real Arabic translation.
ROOM_TYPES = (
    "living room", "majlis", "dining room", "bedroom", "kitchen",
    "courtyard", "riad courtyard", "salon marocain", "hammam", "interior",
)

# src/lib/design/materials.ts WALL_CHOICES / FLOOR_CHOICES. Build Mode's shell
# materials are the scene's real colour system; /api/color/* is a different
# thing entirely (it repaints a finished PNG and needs a job id + segmentation),
# so planner colour intent lands here and never there.
WALL_MATERIALS = ("limestone", "gypsum", "tadelakt", "sand")
FLOOR_MATERIALS = (
    "limestone", "encaustic", "tadelakt", "sand", "cedar", "zellige", "marble",
)

PLAN_CULTURES = ("lebanese", "khaleeji", "moroccan", "all")

# Categories the model may ask for by name, from the ontology itself.
REQUESTABLE_CATEGORIES = (
    "sofa", "armchair", "chair", "coffee_table", "side_table", "console",
    "cabinet", "ottoman", "lamp", "lantern", "screen", "cultural_object",
)


# --------------------------------------------------------------------------
# schema + prompt
# --------------------------------------------------------------------------

def plan_schema(culture: str) -> dict:
    """JSON Schema for the plan. The enums are the whole grounding story.

    `understood` is DAR reading the brief; `items` is DAR acting on it. Both
    come back from one call — a separate "interpret, then plan" round trip
    would double latency and cost for information this response already holds.
    """
    return {
        "type": "object",
        "properties": {
            "understood": {
                "type": "object",
                "properties": {
                    "culture": {"type": "string", "enum": list(PLAN_CULTURES)},
                    "roomType": {"type": "string", "enum": list(ROOM_TYPES)},
                    "capacity": {"type": ["integer", "null"]},
                    "intensity": {"type": ["number", "null"]},
                    "wallMaterialKey": {
                        "type": ["string", "null"], "enum": [*WALL_MATERIALS, None],
                    },
                    "floorMaterialKey": {
                        "type": ["string", "null"], "enum": [*FLOOR_MATERIALS, None],
                    },
                    "conceptEn": {"type": "string"},
                    "conceptAr": {"type": "string"},
                    "requirements": {"type": "array", "items": {"type": "string"}},
                    "requestedFurniture": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "category": {
                                    "type": "string",
                                    "enum": list(REQUESTABLE_CATEGORIES),
                                },
                                "count": {"type": "integer"},
                            },
                            "required": ["category", "count"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": [
                    "culture", "roomType", "capacity", "intensity",
                    "wallMaterialKey", "floorMaterialKey",
                    "conceptEn", "conceptAr", "requirements", "requestedFurniture",
                ],
                "additionalProperties": False,
            },
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
        "required": ["understood", "items", "notesEn", "notesAr"],
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
- Every piece must belong to the one culture you chose in `understood.culture`.
  Do not mix cultures in a single room unless the person asked for "all".
- Keep every footprint fully inside the room, and do not overlap two pieces.
- A piece marked mustTouchWall must sit against a wall.
- Leave walking room: at least 60cm of clear floor to move through.
- Seating should face seating. Put a coffee table within reach of the main sofa,
  roughly 40-50cm in front of it.
- Prefer fewer, well-placed pieces over filling the room. 5-9 is usually right.
- Respect what the person asked for. If they asked for a reading corner, the plan
  should have one and you should say where it is.

READING THE BRIEF — fill `understood` from what the person actually said:
- culture: name it only if they implied one; otherwise keep the room's current
  culture. Every chosen piece must then come from that culture.
- roomType: pick the closest from the allowed list.
- capacity: how many people should be able to sit, if they said. Plan seating to
  match it — a 210cm sofa seats about three, an armchair or pouf seats one.
- intensity: how strongly the culture should read, 0 to 1. Respect an explicit
  number ("45% Khaleeji" is 0.45). Otherwise judge it: "very subtle" is low,
  "traditional" is high, "fully" or "as strong as possible" is 1.0. Null if
  they did not say.
- wallMaterialKey / floorMaterialKey: only when they asked about surfaces.
  Choose the closest real material from the allowed lists — "warm beige walls"
  is sand or tadelakt. Null means leave the room as it is.
- requirements: the constraints they stated, one short phrase each, in their
  own terms ("keep the centre open", "don't block the door").
- requestedFurniture: pieces they named with counts ("three chairs" is
  {chair, 3}). Only what they actually asked for.
- conceptEn/conceptAr: one line on the room you are proposing.

If you cannot honour a request — the room is too small, or the catalogue has no
such piece — do NOT invent furniture and do NOT force a bad layout. Place the
best valid alternative and say plainly in notesEn/notesAr what you changed.

For each piece give a short, specific reason in English and Arabic — what it is
doing in the room, not a description of the object.
Write notesEn/notesAr as one or two sentences on the arrangement as a whole."""


def build_user_message(
    room: dict,
    culture: str,
    brief: str,
    existing: list[dict],
    openings: list[dict] | None = None,
    shell_source: str | None = None,
) -> str:
    w, d = int(room["widthCm"]), int(room["depthCm"])
    lines = [
        f"Room: {w}cm wide (x) by {d}cm deep (z), "
        f"{int(room.get('heightCm') or 300)}cm high.",
        f"So x runs {-w // 2} to {w // 2}, z runs {-d // 2} to {d // 2}.",
    ]
    if shell_source == "default":
        lines.append(
            "These are DAR's default room dimensions — no measurement was taken "
            "from a photograph. Design a well-proportioned room; do not claim to "
            "know the real one."
        )
    elif shell_source == "estimated":
        lines.append("These dimensions are estimated from the photograph, not measured precisely.")
    lines += [
        f"The room's current culture is {culture}. Change it only if the brief asks.",
        "",
        "Catalogue (choose only from these):",
        json.dumps(catalogue_projection("all"), ensure_ascii=False),
    ]
    if existing:
        lines += [
            "",
            "Already in the room — DAR detected these in the photograph. Design around "
            "them where sensible; you may plan over one if replacing it is the point.",
            json.dumps(existing, ensure_ascii=False),
        ]
    if openings:
        lines += [
            "",
            "Doors and windows DAR detected. Keep the floor in front of a door clear "
            "so it can open and be walked through; leave a window's light unblocked by "
            "anything tall. Positions are the centre of the opening in room coordinates:",
            json.dumps(openings, ensure_ascii=False),
        ]
    else:
        lines += [
            "",
            "DAR has not detected any door or window in this room, so do not reason "
            "about where they are.",
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
    # Look up across the whole catalogue, then judge culture separately: that
    # way an invented id and a real-but-wrong-culture piece get different, true
    # reasons instead of both reading "not in the catalogue".
    by_id = _by_id()
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
        # Culture coherence. The model is handed all 27 pieces so it can choose
        # the culture from the brief, which means it can also mix them — a
        # Moroccan pouf in a Lebanese room is a quiet way to be wrong. One room,
        # one culture, unless "all" was asked for.
        if culture != "all" and item.get("culture") != culture:
            rejected.append({
                "catalogId": cid,
                "why": f"{item.get('culture')} piece in a {culture} room",
            })
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


def validate_understood(raw: Any, scene_culture: str) -> dict:
    """DAR's reading of the brief, with every field forced into a real vocabulary.

    Nothing here is trusted on the model's word: a culture outside the four we
    have falls back to the room's own, an intensity is clamped to the range
    /restyle already enforces, and a material that is not on the actual swatch
    list becomes null rather than a plausible-sounding guess. `null` means "not
    said" and always leaves the room as it is.
    """
    raw = raw if isinstance(raw, dict) else {}

    culture = raw.get("culture")
    if culture not in PLAN_CULTURES:
        culture = scene_culture if scene_culture in PLAN_CULTURES else "all"

    room_type = raw.get("roomType")
    if room_type not in ROOM_TYPES:
        room_type = "living room"

    capacity = raw.get("capacity")
    try:
        capacity = int(capacity) if capacity is not None else None
        if capacity is not None and not (1 <= capacity <= 40):
            capacity = None
    except (TypeError, ValueError):
        capacity = None

    # Same 0..1 clamp the /restyle endpoint applies to its own `scale`.
    intensity = raw.get("intensity")
    try:
        intensity = float(intensity) if intensity is not None else None
        if intensity is None or not math.isfinite(intensity):
            intensity = None
        else:
            intensity = max(0.0, min(1.0, intensity))
    except (TypeError, ValueError):
        intensity = None

    wall = raw.get("wallMaterialKey")
    floor = raw.get("floorMaterialKey")

    reqs = raw.get("requirements")
    reqs = [str(r)[:90] for r in reqs[:6]] if isinstance(reqs, list) else []

    wanted = []
    if isinstance(raw.get("requestedFurniture"), list):
        for f in raw["requestedFurniture"][:8]:
            if not isinstance(f, dict):
                continue
            cat = f.get("category")
            try:
                n = int(f.get("count"))
            except (TypeError, ValueError):
                continue
            if cat in REQUESTABLE_CATEGORIES and 1 <= n <= 12:
                wanted.append({"category": cat, "count": n})

    return {
        "culture": culture,
        "roomType": room_type,
        "capacity": capacity,
        "intensity": intensity,
        "wallMaterialKey": wall if wall in WALL_MATERIALS else None,
        "floorMaterialKey": floor if floor in FLOOR_MATERIALS else None,
        "conceptEn": str(raw.get("conceptEn") or "")[:200],
        "conceptAr": str(raw.get("conceptAr") or "")[:200],
        "requirements": reqs,
        "requestedFurniture": wanted,
    }


def placed_counts(accepted: list[dict]) -> dict[str, int]:
    """What actually got placed, by category — so requested-vs-placed is DAR's
    arithmetic rather than the model's claim."""
    by_id = _by_id()
    out: dict[str, int] = {}
    for a in accepted:
        item = by_id.get(a["catalogId"])
        if item:
            out[item["category"]] = out.get(item["category"], 0) + 1
    return out


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

def _anthropic_key() -> str:
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def _gemini_key() -> str:
    return (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()


def provider() -> str | None:
    """Which provider a call would use, or None for the rule-based path.

    DARDESIGN_LLM_PROVIDER wins when set. That override exists because a
    machine-wide ANTHROPIC_API_KEY silently outranks a project's own
    .dardesign-llm: the planner then advertises a model it cannot actually
    reach, fails on every call and degrades to rules while claiming to be an
    AI planner. Naming the provider is the cure, and it is the same trap the
    Anthropic CLI documents for shadowed credentials.

    Otherwise Anthropic first when both are present: it is the one whose
    structured outputs this schema was written against. Read per call, so
    setting a key and restarting is enough.
    """
    forced = (os.environ.get("DARDESIGN_LLM_PROVIDER") or "").strip().lower()
    if forced == "gemini":
        return "gemini" if _gemini_key() else None
    if forced == "anthropic":
        return "anthropic" if _anthropic_key() else None

    if _anthropic_key():
        return "anthropic"
    if _gemini_key():
        return "gemini"
    return None


def model_name() -> str:
    override = (os.environ.get("DARDESIGN_LLM_MODEL") or "").strip()
    if override:
        return override
    return DEFAULT_GEMINI_MODEL if provider() == "gemini" else DEFAULT_MODEL


def is_configured() -> bool:
    return provider() is not None


def _client():
    """The provider SDK, or None. Import inside the call — both are optional."""
    which = provider()
    if which == "anthropic":
        try:
            import anthropic  # noqa: PLC0415
        except ImportError:
            logger.info("[planner] anthropic SDK not installed — using rule-based plans")
            return None
        return anthropic.Anthropic(api_key=_anthropic_key())
    if which == "gemini":
        try:
            from google import genai  # noqa: PLC0415
        except ImportError:
            logger.info("[planner] google-genai not installed — using rule-based plans")
            return None
        return genai.Client(api_key=_gemini_key())
    return None


def _call_anthropic(api: Any, model: str, room: dict, culture: str, brief: str,
                    existing: list, openings: list, shell_source: str | None) -> dict:
    resp = api.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=_SYSTEM,
        messages=[{
            "role": "user",
            "content": build_user_message(room, culture, brief, existing, openings, shell_source),
        }],
        # format and effort are siblings inside ONE output_config.
        output_config={
            "format": {"type": "json_schema", "schema": plan_schema("all")},
            "effort": "low",
        },
    )
    _log_cost(model, getattr(resp, "usage", None))
    text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
    return json.loads(text)


def gemini_schema(schema: Any) -> Any:
    """Translate our JSON Schema into the subset Gemini's response_schema accepts.

    Gemini takes an OpenAPI-flavoured subset, not full JSON Schema, and rejects
    the whole request rather than ignoring what it does not know. Three
    differences, each verified against the live API:

      * `additionalProperties` -> 400 "Unknown name additional_properties".
        Dropped. Anthropic still gets it (strict mode needs it), and it costs
        nothing here because validate_items ignores unknown keys anyway.
      * `type: ["string", "null"]` union -> not supported; Gemini spells an
        optional field `nullable: true` with a single type.
      * `null` inside an `enum` list -> not a valid enum member; the nullable
        flag already carries that meaning.

    The enum of catalogue ids survives untouched, so gate 1 — an invented id is
    unrepresentable — holds on this provider exactly as it does on Anthropic.
    """
    if isinstance(schema, list):
        return [gemini_schema(s) for s in schema]
    if not isinstance(schema, dict):
        return schema

    out: dict = {}
    for key, value in schema.items():
        if key == "additionalProperties":
            continue
        if key == "type" and isinstance(value, list):
            non_null = [t for t in value if t != "null"]
            out["type"] = non_null[0] if non_null else "string"
            if len(non_null) < len(value):
                out["nullable"] = True
            continue
        if key == "enum" and isinstance(value, list):
            members = [v for v in value if v is not None]
            out["enum"] = members
            if len(members) < len(value):
                out["nullable"] = True
            continue
        out[key] = gemini_schema(value)
    return out


def _call_gemini(api: Any, model: str, room: dict, culture: str, brief: str,
                 existing: list, openings: list, shell_source: str | None) -> dict:
    """Same schema, same validator, same fallback — only the transport differs.

    Gemini enforces `response_schema` with enums, which is what keeps gate 1
    (an invented catalogue id is unrepresentable) true on this provider too.
    """
    resp = api.models.generate_content(
        model=model,
        contents=build_user_message(room, culture, brief, existing, openings, shell_source),
        config={
            "system_instruction": _SYSTEM,
            "response_mime_type": "application/json",
            "response_schema": gemini_schema(plan_schema("all")),
            "max_output_tokens": MAX_OUTPUT_TOKENS_GEMINI,
        },
    )
    usage = getattr(resp, "usage_metadata", None)
    if usage is not None:
        logger.info(
            "[planner] %s in=%s out=%s (call %d/%d this process)",
            model,
            getattr(usage, "prompt_token_count", "?"),
            getattr(usage, "candidates_token_count", "?"),
            _calls_made, MAX_CALLS_PER_PROCESS,
        )
    return json.loads(resp.text)


def _cache_key(room: dict, culture: str, brief: str,
               existing: list | None = None, openings: list | None = None) -> str:
    """Everything that changes the answer belongs in the key.

    The first version keyed on room+culture+brief alone, which meant moving the
    furniture DAR found in your photograph did not invalidate the plan.
    """
    raw = (
        f"{int(room['widthCm'])}x{int(room['depthCm'])}|{culture}"
        f"|{' '.join(brief.lower().split())}"
        f"|{json.dumps(existing or [], sort_keys=True)}"
        f"|{json.dumps(openings or [], sort_keys=True)}"
    )
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


def _rule_result(room: dict, culture: str, brief: str, note_suffix: str,
                 warning: str | None = None) -> dict:
    """The deterministic plan, dressed in the same shape as a model plan.

    It still carries an `understood` block so the UI has one contract rather
    than two — but it claims only what rules can honestly know: the room's own
    culture, a living room, no capacity, no intensity, no colour change.
    """
    items = fallback_plan(room, culture, brief)
    return {
        "understood": {
            "culture": culture if culture in PLAN_CULTURES else "all",
            "roomType": "living room",
            "capacity": None,
            "intensity": None,
            "wallMaterialKey": None,
            "floorMaterialKey": None,
            "conceptEn": "Seating gathered around a low table, circulation kept open.",
            "conceptAr": "جلوس متجمّع حول طاولة منخفضة مع إبقاء الممرات مفتوحة.",
            "requirements": [],
            "requestedFurniture": [],
        },
        "items": items,
        "seatingEstimate": seating_estimate(items),
        "placedCounts": placed_counts(items),
        "notesEn": f"Planned from DAR's placement rules{note_suffix}",
        "notesAr": "خُطّطت الغرفة بقواعد التوزيع في دار.",
        "source": "rules",
        "model": None,
        "provider": None,
        "rejected": [],
        **({"warning": warning} if warning else {}),
    }


def plan(
    room: dict,
    culture: str,
    brief: str,
    existing: list[dict] | None = None,
    openings: list[dict] | None = None,
    shell_source: str | None = None,
    *,
    client: Any = None,
) -> dict:
    """Plan a room. Never raises — an unusable model answer degrades to rules.

    `client` is injectable so the tests can exercise every path without spending
    a cent or reaching the network.
    """
    global _calls_made
    existing = existing or []
    openings = openings or []
    key = _cache_key(room, culture, brief, existing, openings)
    if key in _cache:
        cached = dict(_cache[key])
        cached["cached"] = True
        return cached

    api = client if client is not None else _client()
    warning: str | None = None

    if api is None:
        result = _rule_result(
            room, culture, brief, " — no design model is configured.",
        )
        _cache[key] = result
        return dict(result)

    which = provider() if client is None else ("anthropic" if hasattr(api, "messages") else "gemini")

    if _calls_made >= MAX_CALLS_PER_PROCESS:
        warning = "planner call cap reached for this process"
        logger.warning("[planner] %s — serving a rule-based plan", warning)
    else:
        model = model_name()
        try:
            _calls_made += 1
            call = _call_gemini if which == "gemini" else _call_anthropic
            data = call(api, model, room, culture, brief, existing, openings, shell_source)

            # The interpretation is validated first, because the culture it
            # settles on is what every item is then judged against.
            understood = validate_understood(data.get("understood"), culture)
            accepted, rejected = validate_items(
                data.get("items"), understood["culture"], room,
            )
            if accepted:
                result = {
                    "understood": understood,
                    "items": accepted,
                    "seatingEstimate": seating_estimate(accepted),
                    "placedCounts": placed_counts(accepted),
                    "notesEn": str(data.get("notesEn") or "")[:600],
                    "notesAr": str(data.get("notesAr") or "")[:600],
                    "source": "llm",
                    "model": model,
                    "provider": which,
                    "rejected": rejected,
                }
                _cache[key] = result
                return dict(result)
            warning = "the model returned no usable placement"
        except Exception as e:  # noqa: BLE001 — a planner failure must not cost the user their room
            logger.exception("[planner] call failed")
            warning = f"{type(e).__name__}"

    return _rule_result(room, culture, brief, ".", warning)


def _reset_for_tests() -> None:
    global _calls_made
    _calls_made = 0
    _cache.clear()
