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
from .retrieval import DEFAULT_TOP_K, RetrievalResult, format_for_prompt, retrieve

logger = logging.getLogger("dardesign.planner")

# Cultural retrieval is on unless switched off. It is local, costs nothing and
# adds no latency worth measuring, so the flag exists to prove the fallback in
# tests and to kill the feature in one place if it ever misbehaves in a demo —
# not because it is expected to be off. Read per call, like every other flag here.
RAG_ENV = "DARDESIGN_RAG"


def rag_enabled() -> bool:
    return (os.environ.get(RAG_ENV) or "1").strip().lower() not in ("0", "false", "no")

DEFAULT_MODEL = "claude-sonnet-5"

# One congested model must not cost the user their brief. A free-tier 503
# ("this model is currently experiencing high demand") is the single most likely
# way this feature fails in a demo, and it used to fail *silently*: the
# exception was caught, rules were served, and the layout looked deliberate.
# Retries handle a spike; this chain handles a model being busy for longer.
#
# Every entry was probed against a live key on 2026-08-14 with a structured
# -output request — the only test that means anything here, since models.list()
# happily lists models that then 404. Measured that day: 3.7 answered in 3.3s,
# 3.6 in 2.0s, 3.5-flash-lite in 0.9s, while `gemini-3.5-flash` — the previous
# default — returned 503 on every attempt, and `gemini-2.5-flash` 404s with
# "no longer available to new users". Re-probe rather than guess if this list
# ever needs changing: `models.list()` is not evidence that a model will answer.
GEMINI_MODEL_CHAIN = (
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
)
ANTHROPIC_MODEL_CHAIN = (DEFAULT_MODEL, "claude-haiku-4-5")

# The head of the chain, by construction — the status endpoint advertises this
# name, and a default that disagreed with the model actually tried is exactly
# the shadowed-credential trap `provider()` already documents.
DEFAULT_GEMINI_MODEL = GEMINI_MODEL_CHAIN[0]
# Retry only what retrying can fix: overload and rate limits. A 400 bad schema
# or a 404 dead model is not going to succeed on the second attempt.
RETRY_STATUSES = (429, 500, 502, 503, 504)
MAX_ATTEMPTS_PER_MODEL = 3
RETRY_BASE_DELAY_S = 0.8

MAX_OUTPUT_TOKENS = 2000
# Gemini 3.x counts its thinking against max_output_tokens. Measured on a real
# plan: ~5k thinking tokens before ~1.1k of JSON, so the 2k that is ample for
# Anthropic truncates the response mid-object and the plan silently degrades to
# rules. Free tier, so the headroom costs nothing.
MAX_OUTPUT_TOKENS_GEMINI = 12000
# 12 was a whole-room ceiling and it silently became a *count* ceiling the
# moment briefs could say "add five chairs": five chairs in a room that already
# held seven pieces hit it. The placement engine, not this number, is what
# decides how much furniture a room can hold.
MAX_ITEMS = 24
MAX_OPERATIONS = 36

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

# What the brief is asking DAR to do. This is the difference between "a majlis
# for receiving guests" and "add five chairs", and getting it wrong is what made
# every brief return the same furnished room: an edit answered as a fresh
# furnishing stacks a second room on top of the one you already have.
PLAN_INTENTS = ("furnish", "edit")

# Categories the model may ask for by name, from the ontology itself.
REQUESTABLE_CATEGORIES = (
    "sofa", "armchair", "chair", "coffee_table", "side_table", "console",
    "cabinet", "ottoman", "lamp", "lantern", "screen", "cultural_object",
)

# The catalogue is not square: every culture has nine pieces, but not the same
# nine. Khaleeji has no `chair` at all (its seating is the majlis armchair and
# the ottoman), Lebanese has no `lantern`, Moroccan no `lamp`. So "add five
# chairs" is answerable in a Lebanese room and, taken literally, refusable in a
# Khaleeji one — which is a catalogue accident, not a design judgement.
#
# The table lives in ontology/category_substitutes.json because the CLIENT needs
# it too: culture conversion (src/lib/design/culture.ts) asks the same question
# — "this culture has no lamp, what stands in?" — and a second hand-written copy
# would drift, exactly as ontology.json already does. Read once at import; it is
# small, static data.
#
# Substitutions are always REPORTED (see `substitutions` on the response) and
# never silent: the panel says which piece stood in and for what, so the user is
# never told they got a chair.
_SUBSTITUTES_PATH = (
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "ontology", "category_substitutes.json")
)


def _load_substitutes() -> dict[str, tuple[str, ...]]:
    with open(_SUBSTITUTES_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)["substitutes"]
    return {k: tuple(v) for k, v in raw.items()}


CATEGORY_SUBSTITUTES = _load_substitutes()


def item_for_category(culture: str, category: str) -> tuple[dict | None, str | None]:
    """A catalogue piece for this category in this culture, substituting if need be.

    Returns (item, substituted_from). `substituted_from` is None when the
    culture had the category outright — which is what lets the caller state a
    substitution rather than pass one off as the thing that was asked for.
    """
    items = catalogue_projection(_ALL_FALLBACK_CULTURE if culture == "all" else culture)
    exact = _pick(items, category)
    if exact is not None:
        return exact, None
    for alt in CATEGORY_SUBSTITUTES.get(category, ()):
        found = _pick(items, alt)
        if found is not None:
            return found, category
    return None, None


# --------------------------------------------------------------------------
# schema + prompt
# --------------------------------------------------------------------------

def operation_schema(culture: str, movable_uids: list[str] | None = None) -> dict:
    """One edit to the room: add a piece, move one, or take one away.

    A FLAT object with nullable fields, not a `oneOf` discriminated union.
    Gemini's `response_schema` takes an OpenAPI-flavoured subset that rejects
    the whole request rather than ignoring a keyword it does not know, and a
    union is exactly the sort of thing it does not know. The op-specific fields
    are therefore all nullable and `validate_operations` enforces which ones a
    given `op` actually requires — the same division of labour the rest of this
    module already uses: the schema makes hallucination unrepresentable where
    it cheaply can, and the validator catches the rest.

    `targetUid` is the second closed vocabulary in this file. It is an enum of
    the uids that are actually in the user's scene right now, so "move the sofa
    that isn't there" is unrepresentable in the same way an invented catalogue
    id is. With nothing movable the enum would be empty, so move/remove are
    dropped from the op list entirely rather than offered against nothing.
    """
    uids = [u for u in (movable_uids or []) if isinstance(u, str) and u][:60]
    ops = ["add", "move", "remove"] if uids else ["add"]

    target: dict = {"type": ["string", "null"]}
    if uids:
        target["enum"] = [*uids, None]

    return {
        "type": "object",
        "properties": {
            "op": {"type": "string", "enum": ops},
            # add only
            "catalogId": {
                "type": ["string", "null"], "enum": [*allowed_ids(culture), None],
            },
            # move / remove only — a uid already in the room
            "targetUid": target,
            "xCm": {"type": ["number", "null"]},
            "zCm": {"type": ["number", "null"]},
            "rotationDeg": {"type": ["number", "null"]},
            "materialKey": {"type": ["string", "null"], "enum": [*MATERIAL_KEYS, None]},
            "reasonEn": {"type": "string"},
            "reasonAr": {"type": "string"},
        },
        "required": [
            "op", "catalogId", "targetUid", "xCm", "zCm", "rotationDeg",
            "materialKey", "reasonEn", "reasonAr",
        ],
        "additionalProperties": False,
    }


def plan_schema(culture: str, movable_uids: list[str] | None = None) -> dict:
    """JSON Schema for the plan. The enums are the whole grounding story.

    `understood` is DAR reading the brief; `operations` is DAR acting on it.
    Both come back from one call — a separate "interpret, then plan" round trip
    would double latency and cost for information this response already holds.

    `operations` replaced a plain `items` list once briefs stopped being only
    "furnish this empty room". "Move the armchair" and "remove one chair" are
    the ordinary things a person says to a room that already has furniture in
    it, and an add-only vocabulary could only ever answer them by piling a
    second room on top of the first.
    """
    return {
        "type": "object",
        "properties": {
            "understood": {
                "type": "object",
                "properties": {
                    "culture": {"type": "string", "enum": list(PLAN_CULTURES)},
                    "intent": {"type": "string", "enum": list(PLAN_INTENTS)},
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
                    "culture", "intent", "roomType", "capacity", "intensity",
                    "wallMaterialKey", "floorMaterialKey",
                    "conceptEn", "conceptAr", "requirements", "requestedFurniture",
                ],
                "additionalProperties": False,
            },
            "operations": {
                "type": "array",
                "items": operation_schema(culture, movable_uids),
            },
            "notesEn": {"type": "string"},
            "notesAr": {"type": "string"},
        },
        "required": ["understood", "operations", "notesEn", "notesAr"],
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

YOU ARE EDITING A ROOM, NOT ONLY FILLING ONE. Answer in `operations`:
- {"op":"add"}    — put a new catalogue piece in the room. Needs catalogId,
                    xCm, zCm, rotationDeg.
- {"op":"move"}   — reposition a piece that is ALREADY in the room. Needs
                    targetUid and the new xCm, zCm, rotationDeg.
- {"op":"remove"} — take a piece out of the room. Needs targetUid only.
Emit as many as the brief calls for, in any order, and give each one a reason.

`understood.intent` says which kind of brief this is, and it changes what a good
answer looks like:
- "furnish" — the person is describing a room they want ("a majlis for guests",
  "somewhere to eat and talk"). Design the whole arrangement with `add`.
- "edit" — the person is changing the room in front of them ("add five chairs",
  "move the sofa to the other wall", "remove one chair", "spread these out").
  Touch ONLY what they asked about. Do NOT re-furnish a room that already has
  furniture in it: if they asked for one table, the answer is one `add`.
  "Change the locations of the furniture" is an edit made of `move` operations
  over the pieces already listed as in the room — not a new set of furniture.

RULES:
- Use only catalogue ids given to you. Never invent one.
- Use only the uids listed as already in the room. Never invent one.
- Never emit dimensions; sizes come from the catalogue.
- Every piece must belong to the one culture you chose in `understood.culture`.
  Do not mix cultures in a single room unless the person asked for "all".
- Keep every footprint fully inside the room, and do not overlap two pieces —
  including the pieces already in the room that you are not moving.
- A piece marked mustTouchWall must sit against a wall.
- Leave walking room: at least 60cm of clear floor to move through.
- Seating should face seating. Put a coffee table within reach of the main sofa,
  roughly 40-50cm in front of it.
- COUNTS ARE LITERAL AND OUTRANK TASTE. "Add five chairs" means exactly five
  `add` operations for a chair — not three because five looks crowded, and not
  six. If you genuinely cannot fit them, place as many as fit and say how many
  in notesEn; DAR checks the arithmetic either way. When no count is given,
  prefer fewer well-placed pieces: 5-9 is usually right for a whole room.
- A piece added alongside existing furniture must WORK with it. One table asked
  for in a room of chairs goes within reach of those chairs, not in a free
  corner.
- Respect what the person asked for. If they asked for a reading corner, the plan
  should have one and you should say where it is.

READING THE BRIEF — fill `understood` from what the person actually said:
- intent: "edit" if they are changing the room that already exists, "furnish" if
  they are describing a room to design. A room with nothing in it is "furnish".
- culture: name it only if they implied one; otherwise keep the room's current
  culture. Every chosen piece must then come from that culture. A brief that
  names a culture ("make this a Moroccan room") changes it — pick that culture
  and choose every piece from it.
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


def movable_objects(objects: list[dict] | None) -> list[dict]:
    """The pieces a plan is allowed to move or remove — and only those.

    `found` massing is DAR's reading of the user's photograph and is locked by
    default, because moving one silently turns a measurement into a fiction.
    So the planner is shown it as context (it must not design through a sofa
    that is really there) but is given no uid for it, which makes moving it
    unrepresentable rather than merely discouraged. A piece the user has locked
    by hand is respected for the same reason.
    """
    out: list[dict] = []
    for o in objects or []:
        if not isinstance(o, dict):
            continue
        if o.get("origin") != "catalog" or o.get("locked"):
            continue
        uid = o.get("uid")
        if not isinstance(uid, str) or not uid:
            continue
        out.append(o)
    return out


def build_user_message(
    room: dict,
    culture: str,
    brief: str,
    existing: list[dict],
    openings: list[dict] | None = None,
    shell_source: str | None = None,
    evidence: str = "",
    objects: list[dict] | None = None,
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
            "them where sensible; you may plan over one if replacing it is the point. "
            "They have no uid and cannot be moved or removed.",
            json.dumps(existing, ensure_ascii=False),
        ]
    # The pieces the user placed, WITH their uids. Without this block the model
    # was told nothing about the room it was being asked to change, so every
    # brief — including "move these" — could only be answered by furnishing an
    # imaginary empty room.
    movable = movable_objects(objects)
    if movable:
        lines += [
            "",
            "Placed by the person, and yours to rearrange. Use these uids as "
            "`targetUid` to move or remove one. Anything you do not touch stays "
            "exactly where it is:",
            json.dumps(movable, ensure_ascii=False),
        ]
    else:
        lines += [
            "",
            "The person has placed nothing in this room yet, so there is nothing to "
            "move or remove — every operation will be an `add`.",
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
    # Cultural evidence sits between the room's facts and the person's words:
    # after the catalogue so the model has already seen what it may place, and
    # before the brief so the brief remains the last thing it reads. Empty when
    # retrieval is off or found nothing, and the message is then byte-for-byte
    # what it was before RAG existed — which is what keeps the no-evidence path
    # a genuine fallback rather than a different prompt.
    if evidence:
        lines += ["", evidence]
    lines += ["", "What the person asked for:", brief.strip() or "A comfortable, well-proportioned room."]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# validation — gate 3
# --------------------------------------------------------------------------

def _validate_coords(entry: dict, room: dict) -> tuple[tuple[float, float, float] | None, str | None]:
    """(x, z, rotation) or a reason it is unusable. Shared by add and move."""
    try:
        x = float(entry["xCm"])
        z = float(entry["zCm"])
        rot = float(entry.get("rotationDeg") or 0.0)
    except (KeyError, TypeError, ValueError):
        return None, "coordinates were not numbers"
    if not all(math.isfinite(v) for v in (x, z, rot)):
        return None, "coordinates were not finite"
    # Generous bound: the client re-checks the real footprint against the real
    # walls. This only throws out answers that are nonsense at a glance.
    if abs(x) > float(room["widthCm"]) / 2.0 + 200 or abs(z) > float(room["depthCm"]) / 2.0 + 200:
        return None, "position is outside the room"
    return (x, z, rot), None


def validate_items(raw: Any, culture: str, room: dict) -> tuple[list[dict], list[dict]]:
    """Split a list of proposed additions into (accepted, rejected).

    Rejected entries carry a reason so the UI can say what was discarded instead
    of quietly showing a shorter plan than the model wrote.
    """
    # Look up across the whole catalogue, then judge culture separately: that
    # way an invented id and a real-but-wrong-culture piece get different, true
    # reasons instead of both reading "not in the catalogue".
    by_id = _by_id()

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

        coords, why = _validate_coords(entry, room)
        if coords is None:
            rejected.append({"catalogId": cid, "why": why})
            continue
        x, z, rot = coords

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


def validate_operations(
    raw: Any, culture: str, room: dict, movable_uids: list[str] | None = None,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Split an operation list into (adds, moves, removals, rejected).

    The op-specific fields are nullable in the schema because Gemini cannot take
    a discriminated union, so this is where "a move needs a target" and "an add
    needs a catalogue id" are actually enforced.

    A uid the scene does not hold is rejected by name rather than skipped. The
    schema enum already makes it near-impossible; near is not never, and a plan
    that silently dropped half its moves would look like the editor ignoring the
    user — the failure mode this whole feature exists to remove.
    """
    known = set(movable_uids or [])

    adds_raw: list[dict] = []
    moves: list[dict] = []
    removals: list[dict] = []
    rejected: list[dict] = []
    seen_targets: set[str] = set()

    if not isinstance(raw, list):
        return [], [], [], [{"catalogId": None, "why": "model returned no operation list"}]

    for entry in raw[:MAX_OPERATIONS]:
        if not isinstance(entry, dict):
            rejected.append({"catalogId": None, "why": "not an object"})
            continue

        op = entry.get("op") or "add"
        if op == "add":
            adds_raw.append(entry)
            continue

        if op not in ("move", "remove"):
            rejected.append({"catalogId": None, "why": f"unknown operation {op!r}"})
            continue

        uid = entry.get("targetUid")
        if not isinstance(uid, str) or uid not in known:
            rejected.append({"catalogId": None, "why": f"{op}: no such piece in the room"})
            continue
        # One operation per piece. Two moves for the same uid is the model
        # changing its mind mid-answer, and applying both would leave the piece
        # wherever the later one happened to land — obeying an instruction the
        # user never gave.
        if uid in seen_targets:
            rejected.append({"catalogId": None, "why": f"{op}: piece already had an operation"})
            continue
        seen_targets.add(uid)

        reason_en = str(entry.get("reasonEn") or "")[:240]
        reason_ar = str(entry.get("reasonAr") or "")[:240]

        if op == "remove":
            removals.append({"targetUid": uid, "reasonEn": reason_en, "reasonAr": reason_ar})
            continue

        coords, why = _validate_coords(entry, room)
        if coords is None:
            rejected.append({"catalogId": None, "why": f"move: {why}"})
            continue
        x, z, rot = coords
        moves.append({
            "targetUid": uid,
            "xCm": round(x),
            "zCm": round(z),
            "rotationDeg": round(rot) % 360,
            "reasonEn": reason_en,
            "reasonAr": reason_ar,
        })

    adds, add_rejected = validate_items(adds_raw, culture, room)
    return adds, moves, removals, rejected + add_rejected


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

    intent = raw.get("intent")
    if intent not in PLAN_INTENTS:
        intent = "furnish"

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
        "intent": intent,
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


def enforce_counts(
    adds: list[dict], understood: dict, room: dict,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Make a stated count literally true. Returns (adds, substitutions, rejected).

    "Add five chairs" is arithmetic, and arithmetic is DAR's job, not the
    model's. The prompt asks for exactly five; this is what makes it so whether
    or not the model complied — because a design model asked for five chairs
    will reliably give you four and a paragraph about proportion.

    Two directions, both reported:
      short  — DAR appends the missing pieces itself, flagged `autoPlaced` so
               the client puts them through `findSpot` rather than trusting a
               coordinate nobody chose.
      over   — the surplus is trimmed and named in `rejected`. Six chairs when
               five were asked for is as wrong as four.

    Substitution is the third case: a culture that has no such category gets its
    nearest piece (Khaleeji has no `chair`; its seat is the majlis armchair),
    recorded so the panel can say which piece stood in for what. Never silent —
    the user is not told they got a chair.
    """
    wanted = understood.get("requestedFurniture") or []
    if not wanted:
        return adds, [], []

    culture = understood.get("culture") or "all"
    by_id = _by_id()
    substitutions: list[dict] = []
    rejected: list[dict] = []

    # Bucket the model's adds by the category the person actually asked for, so
    # a Khaleeji armchair standing in for a chair counts toward the chairs.
    for want in wanted:
        category = want["category"]
        target = int(want["count"])
        item, substituted_from = item_for_category(culture, category)
        if item is None:
            rejected.append({
                "catalogId": None,
                "why": f"no {category.replace('_', ' ')} exists in the {culture} catalogue",
            })
            continue
        if substituted_from is not None:
            substitutions.append({
                "requested": substituted_from,
                "catalogId": item["id"],
                "category": item["category"],
                "nameEn": item["nameEn"],
                "culture": item["culture"],
            })

        # Everything that satisfies this request: the exact category, plus the
        # substitute piece if one is standing in for it.
        satisfying = {category, item["category"]}
        matched = [
            a for a in adds
            if (by_id.get(a["catalogId"]) or {}).get("category") in satisfying
        ]

        if len(matched) > target:
            for surplus in matched[target:]:
                adds.remove(surplus)
                rejected.append({
                    "catalogId": surplus["catalogId"],
                    "why": f"{len(matched)} placed but {target} asked for",
                })
        elif len(matched) < target:
            missing = target - len(matched)
            for _ in range(missing):
                adds.append({
                    "catalogId": item["id"],
                    # No coordinate is invented here. `autoPlaced` sends the
                    # piece straight to the client's own auto-placer, which is
                    # the same `findSpot` a click-to-place uses.
                    "xCm": 0,
                    "zCm": 0,
                    "rotationDeg": 0,
                    "materialKey": None,
                    "autoPlaced": True,
                    "reasonEn": f"Added by DAR to make up the {target} you asked for.",
                    "reasonAr": f"أضافتها دار لإكمال العدد المطلوب ({target}).",
                })

    return adds[:MAX_ITEMS], substitutions, rejected


def count_report(adds: list[dict], understood: dict) -> list[dict]:
    """Requested vs placed, per category — DAR's arithmetic, shown either way.

    Computed AFTER the client has gated the plan would be better still, but the
    client can only drop pieces, never add them, so this is the ceiling and the
    panel reports the floor beside it.
    """
    wanted = understood.get("requestedFurniture") or []
    if not wanted:
        return []
    culture = understood.get("culture") or "all"
    by_id = _by_id()
    report: list[dict] = []
    for want in wanted:
        category = want["category"]
        item, _sub = item_for_category(culture, category)
        satisfying = {category} | ({item["category"]} if item else set())
        placed = sum(
            1 for a in adds
            if (by_id.get(a["catalogId"]) or {}).get("category") in satisfying
        )
        report.append({
            "category": category,
            "requested": int(want["count"]),
            "planned": placed,
        })
    return report


# --------------------------------------------------------------------------
# deterministic fallback — the no-key path, and the one CI runs
# --------------------------------------------------------------------------

def _pick(items: list[dict], category: str) -> dict | None:
    for it in items:
        if it["category"] == category:
            return it
    return None


def fallback_plan(
    room: dict, culture: str, brief: str, objects: list[dict] | None = None,
) -> list[dict]:
    """A sane arrangement from placement rules alone. No model involved.

    Deliberately simple: an anchor against the far wall, a table in front of it,
    seating flanking that, lamps to a corner and storage on the opposite wall.
    Anything it gets slightly wrong is repaired by the client's placement engine,
    which is the same engine that repairs the model's answers.

    It cannot read the brief — that is the whole difference between this path
    and the model path, and the panel says which one you got. But it can read
    the ROOM, and it now does: a category the user has already placed is skipped
    rather than duplicated. Without that, a model outage answered "move these
    chairs" by dropping a second complete living room on top of the first, which
    is how a silent fallback stops looking like a fallback and starts looking
    like the editor ignoring you.
    """
    base = _ALL_FALLBACK_CULTURE if culture == "all" else culture
    items = catalogue_projection(base)
    by_id = _by_id()
    already = {
        (by_id.get(o.get("catalogId")) or {}).get("category")
        for o in (objects or [])
        if isinstance(o, dict)
    }
    already.discard(None)
    W = float(room["widthCm"])
    D = float(room["depthCm"])
    out: list[dict] = []

    def add(item: dict | None, x: float, z: float, rot: float, en: str, ar: str) -> None:
        if item is None or item["category"] in already:
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


def _call_anthropic(api: Any, model: str, message: str, schema: dict) -> dict:
    resp = api.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=_SYSTEM,
        messages=[{"role": "user", "content": message}],
        # format and effort are siblings inside ONE output_config.
        output_config={
            "format": {"type": "json_schema", "schema": schema},
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


def _call_gemini(api: Any, model: str, message: str, schema: dict) -> dict:
    """Same schema, same validator, same fallback — only the transport differs.

    Gemini enforces `response_schema` with enums, which is what keeps gate 1
    (an invented catalogue id is unrepresentable) true on this provider too.
    """
    resp = api.models.generate_content(
        model=model,
        contents=message,
        config={
            "system_instruction": _SYSTEM,
            "response_mime_type": "application/json",
            "response_schema": gemini_schema(schema),
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


# --------------------------------------------------------------------------
# retry + model chain
# --------------------------------------------------------------------------

def _status_of(exc: Exception) -> int | None:
    """The HTTP status behind a provider exception, whatever it calls the field.

    Both SDKs raise their own class with their own attribute name, and neither
    is a dependency this module can rely on being installed — so this reads
    duck-typed attributes rather than importing anything to catch.
    """
    for attr in ("status_code", "code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


def is_retryable(exc: Exception) -> bool:
    """Is this worth trying again, or is it going to fail identically?

    Overload and rate limits pass; a 400 bad schema or a 404 dead model does
    not, because a second identical request gets a second identical refusal.
    """
    status = _status_of(exc)
    if status is not None:
        return status in RETRY_STATUSES
    # No status at all is usually a socket or DNS blip on the way out.
    return isinstance(exc, (ConnectionError, TimeoutError))


def model_chain() -> list[str]:
    """The models to try, in order, for whichever provider is configured.

    An explicit DARDESIGN_LLM_MODEL is honoured and is the ONLY model tried —
    someone who named a model wants that model, and quietly answering from a
    different one is exactly the kind of substitution this file refuses to make
    anywhere else.
    """
    override = (os.environ.get("DARDESIGN_LLM_MODEL") or "").strip()
    if override:
        return [override]
    chain = GEMINI_MODEL_CHAIN if provider() == "gemini" else ANTHROPIC_MODEL_CHAIN
    return list(chain)


def _sleep(seconds: float) -> None:
    """Wrapped so tests can make backoff free without patching the stdlib."""
    import time  # noqa: PLC0415

    time.sleep(seconds)


def call_with_retry(
    call: Any, api: Any, models: list[str], message: str, schema: dict,
) -> tuple[dict, str]:
    """Try each model up to MAX_ATTEMPTS_PER_MODEL times. Returns (data, model).

    A free-tier 503 ("this model is currently experiencing high demand") is the
    single likeliest way this feature fails, and it used to fail all the way to
    a rule-based room on the first one — a layout that looks deliberate and
    ignores everything the user typed. Spikes are usually seconds long, so a
    short backoff recovers most of them, and moving down the chain recovers the
    rest without anybody editing a config file mid-demo.

    Raises the last exception if every model is exhausted; the caller degrades
    to rules exactly as before.
    """
    last: Exception | None = None
    for model in models:
        for attempt in range(MAX_ATTEMPTS_PER_MODEL):
            try:
                return call(api, model, message, schema), model
            except Exception as e:  # noqa: BLE001 — classified below, never swallowed
                last = e
                if not is_retryable(e):
                    logger.warning("[planner] %s failed unrecoverably: %s", model, type(e).__name__)
                    break
                if attempt + 1 < MAX_ATTEMPTS_PER_MODEL:
                    delay = RETRY_BASE_DELAY_S * (2 ** attempt)
                    logger.info(
                        "[planner] %s busy (%s) — retrying in %.1fs",
                        model, _status_of(e), delay,
                    )
                    _sleep(delay)
                else:
                    logger.warning("[planner] %s exhausted its retries — next model", model)
    raise last if last is not None else RuntimeError("no model was attempted")


def _cache_key(room: dict, culture: str, brief: str,
               existing: list | None = None, openings: list | None = None,
               objects: list | None = None) -> str:
    """Everything that changes the answer belongs in the key.

    The first version keyed on room+culture+brief alone, which meant moving the
    furniture DAR found in your photograph did not invalidate the plan. The
    same trap reappeared with edits: "add one more chair" typed twice in a row
    is the same brief against a DIFFERENT room, and without `objects` in the key
    the second one is served the first one's answer.
    """
    raw = (
        f"{int(room['widthCm'])}x{int(room['depthCm'])}|{culture}"
        f"|{' '.join(brief.lower().split())}"
        f"|{json.dumps(existing or [], sort_keys=True)}"
        f"|{json.dumps(openings or [], sort_keys=True)}"
        f"|{json.dumps(objects or [], sort_keys=True)}"
        # Evidence changes the prompt, so it changes the answer. Without this a
        # test that toggles the flag would be served the other mode's plan.
        f"|rag={int(rag_enabled())}"
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


def _evidence_payload(result: RetrievalResult | None, injected: bool) -> dict:
    """The cultural-evidence half of a plan response.

    `injected` is the honest field. Retrieval is local and free, so it runs on
    every path — but only the model path actually *designs* with what it found.
    A rule-based plan that displayed the same evidence would be claiming an
    influence it never had, so the flag travels with the data and the panel is
    expected to read it rather than assume.
    """
    if result is None:
        return {
            "evidence": [],
            "evidenceMeta": {
                "injected": False, "available": False, "culture": None,
                "rooms": [], "reason": "retrieval disabled", "count": 0,
            },
        }
    return {
        "evidence": result.to_evidence(),
        "evidenceMeta": {
            "injected": injected and bool(result.chunks),
            "available": result.available,
            "culture": result.culture,
            "rooms": list(result.rooms),
            "reason": result.reason or None,
            "count": len(result.chunks),
        },
    }


def _retrieve_evidence(brief: str, culture: str) -> RetrievalResult | None:
    """Cultural evidence for this brief, or None when RAG is switched off.

    Wrapped rather than called inline because a retrieval failure must be
    indistinguishable, from the planner's point of view, from retrieval being
    disabled: both mean "design without evidence", and neither is an error.
    """
    if not rag_enabled():
        return None
    try:
        return retrieve(brief, culture, top_k=DEFAULT_TOP_K)
    except Exception:  # noqa: BLE001 — evidence is optional; the plan is not
        logger.exception("[planner] retrieval failed — planning without evidence")
        return None


def _rule_result(room: dict, culture: str, brief: str, note_suffix: str,
                 warning: str | None = None,
                 retrieved: RetrievalResult | None = None,
                 objects: list[dict] | None = None,
                 rejected: list[dict] | None = None) -> dict:
    """The deterministic plan, dressed in the same shape as a model plan.

    It still carries an `understood` block so the UI has one contract rather
    than two — but it claims only what rules can honestly know: the room's own
    culture, a living room, no capacity, no intensity, no colour change. It
    never moves or removes anything either, because rules cannot know which
    piece you meant.
    """
    items = fallback_plan(room, culture, brief, objects)
    return {
        "understood": {
            "culture": culture if culture in PLAN_CULTURES else "all",
            "intent": "furnish",
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
        "moves": [],
        "removals": [],
        "substitutions": [],
        "counts": [],
        "seatingEstimate": seating_estimate(items),
        "placedCounts": placed_counts(items),
        "notesEn": f"Planned from DAR's placement rules{note_suffix}",
        "notesAr": "خُطّطت الغرفة بقواعد التوزيع في دار.",
        "source": "rules",
        "model": None,
        "provider": None,
        # Normally empty — rules reject nothing, because they propose only what
        # they computed. It is populated when the MODEL answered and every one
        # of its operations was thrown out: "move the sofa" coming back as a
        # furnished room with no explanation is the exact failure this feature
        # was built to remove, so the reasons survive the fallback.
        "rejected": rejected or [],
        # injected=False: the rules did not read any of this. It is reported so
        # the panel can show what DAR knows without pretending it was used.
        **_evidence_payload(retrieved, injected=False),
        **({"warning": warning} if warning else {}),
    }


def plan(
    room: dict,
    culture: str,
    brief: str,
    existing: list[dict] | None = None,
    openings: list[dict] | None = None,
    shell_source: str | None = None,
    objects: list[dict] | None = None,
    *,
    client: Any = None,
) -> dict:
    """Plan a room. Never raises — an unusable model answer degrades to rules.

    `objects` is the scene as it stands: everything the user has placed, with
    uids. That is what turns this from a room generator into a room editor —
    without it the model is answering "move the sofa" about a room it has never
    been shown.

    `client` is injectable so the tests can exercise every path without spending
    a cent or reaching the network.
    """
    global _calls_made
    existing = existing or []
    openings = openings or []
    objects = objects or []
    # Carried out of the try/except so a plan whose every operation was refused
    # can still say why, instead of arriving as an unexplained rule-based room.
    refused: list[dict] = []
    key = _cache_key(room, culture, brief, existing, openings, objects)
    if key in _cache:
        cached = dict(_cache[key])
        cached["cached"] = True
        return cached

    # Retrieval happens before the provider is even resolved: it is local, it
    # cannot fail the request, and the rule-based path reports what DAR knows
    # even though it does not design with it.
    retrieved = _retrieve_evidence(brief, culture)

    api = client if client is not None else _client()
    warning: str | None = None

    if api is None:
        result = _rule_result(
            room, culture, brief, " — no design model is configured.",
            retrieved=retrieved, objects=objects,
        )
        _cache[key] = result
        return dict(result)

    which = provider() if client is None else ("anthropic" if hasattr(api, "messages") else "gemini")

    if _calls_made >= MAX_CALLS_PER_PROCESS:
        warning = "planner call cap reached for this process"
        logger.warning("[planner] %s — serving a rule-based plan", warning)
    else:
        movable = movable_objects(objects)
        uids = [o["uid"] for o in movable]
        try:
            _calls_made += 1
            call = _call_gemini if which == "gemini" else _call_anthropic
            evidence_block = format_for_prompt(retrieved) if retrieved else ""
            message = build_user_message(
                room, culture, brief, existing, openings, shell_source,
                evidence_block, objects,
            )
            data, model = call_with_retry(
                call, api, model_chain(), message, plan_schema("all", uids),
            )

            # The interpretation is validated first, because the culture it
            # settles on is what every item is then judged against.
            understood = validate_understood(data.get("understood"), culture)
            # `operations` is the current contract; `items` is what the model
            # used to return and what a model ignoring the schema still tends
            # to produce. Reading both costs one `or` and means a well-formed
            # add-only answer is never thrown away over its envelope.
            ops = data.get("operations")
            if not isinstance(ops, list):
                ops = data.get("items")
            accepted, moves, removals, rejected = validate_operations(
                ops, understood["culture"], room, uids,
            )
            accepted, substitutions, count_rejected = enforce_counts(
                accepted, understood, room,
            )
            rejected = rejected + count_rejected
            refused = rejected

            if accepted or moves or removals:
                result = {
                    "understood": understood,
                    "items": accepted,
                    "moves": moves,
                    "removals": removals,
                    "substitutions": substitutions,
                    "counts": count_report(accepted, understood),
                    "seatingEstimate": seating_estimate(accepted),
                    "placedCounts": placed_counts(accepted),
                    "notesEn": str(data.get("notesEn") or "")[:600],
                    "notesAr": str(data.get("notesAr") or "")[:600],
                    "source": "llm",
                    "model": model,
                    "provider": which,
                    "rejected": rejected,
                    # injected=True only if there were chunks to inject; the
                    # payload itself decides, so an empty retrieval cannot
                    # advertise an influence it did not have.
                    **_evidence_payload(retrieved, injected=True),
                }
                _cache[key] = result
                return dict(result)
            warning = "the model returned no usable placement"
        except Exception as e:  # noqa: BLE001 — a planner failure must not cost the user their room
            logger.exception("[planner] call failed")
            # The status is the difference between "the model is busy" and "the
            # model is gone", and the panel shows this string to a human who is
            # deciding whether to press the button again.
            status = _status_of(e)
            warning = f"{type(e).__name__}{f' {status}' if status else ''}"

    return _rule_result(
        room, culture, brief, ".", warning, retrieved=retrieved, objects=objects,
        rejected=refused,
    )


def _reset_for_tests() -> None:
    global _calls_made
    _calls_made = 0
    _cache.clear()
