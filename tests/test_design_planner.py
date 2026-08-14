"""Design planner — the grounding gates, proved.

The planner's whole claim is that a hallucination cannot reach the 3D scene.
These tests are that claim, written down: an invented catalogue id, a coordinate
in the next postcode, and a material that does not exist are each fed in
deliberately and must come back rejected and named.

NO API CALLS. Every test either runs the rule-based path or injects a fake
client, so the suite costs nothing and works with no key on CI.

GPU NOT NEEDED — DARDESIGN_LIGHT, no model ever loads.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# MUST be set BEFORE importing transform.py (via backend.main).
os.environ["DARDESIGN_LIGHT"] = "1"

from backend import design_planner as planner  # noqa: E402
from backend.main import _reset_for_tests, app  # noqa: E402

ROOM = {"widthCm": 520.0, "depthCm": 420.0, "heightCm": 300.0}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    # No key in the environment: every test that wants the model path injects a
    # fake client explicitly, so nothing here can ever reach the network.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    planner._reset_for_tests()
    _reset_for_tests()
    yield
    planner._reset_for_tests()
    _reset_for_tests()


class _FakeResponse:
    def __init__(self, payload: dict):
        block = type("Block", (), {"type": "text", "text": json.dumps(payload)})()
        self.content = [block]
        self.usage = type("U", (), {"input_tokens": 1000, "output_tokens": 500})()


class _FakeClient:
    """Stands in for anthropic.Anthropic. Records the request it was given."""

    def __init__(self, payload: dict):
        self._payload = payload
        self.last_kwargs: dict | None = None
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.last_kwargs = kwargs
                return _FakeResponse(outer._payload)

        self.messages = _Messages()


# --------------------------------------------------------------------------
# gate 1 — closed vocabulary
# --------------------------------------------------------------------------

@pytest.mark.parametrize("culture", ["lebanese", "khaleeji", "moroccan"])
def test_schema_enum_is_exactly_that_culture(culture):
    schema = planner.plan_schema(culture)
    enum = schema["properties"]["operations"]["items"]["properties"]["catalogId"]["enum"]
    # null is a member because an operation object is flat: a move or a remove
    # carries no catalogId. Gate 1 is about the members that are NOT null —
    # every one of them must be a real id of exactly this culture.
    ids = [i for i in enum if i is not None]
    assert None in enum, "move/remove ops must be able to omit a catalogue id"
    assert len(ids) == 9
    assert set(ids) == set(planner.allowed_ids(culture))
    prefix = {"lebanese": "leb-", "khaleeji": "khal-", "moroccan": "mor-"}[culture]
    assert all(i.startswith(prefix) for i in ids)


def test_all_offers_every_culture():
    assert len(planner.allowed_ids("all")) == 27


def test_schema_forbids_extra_properties():
    item = planner.plan_schema("lebanese")["properties"]["operations"]["items"]
    assert item["additionalProperties"] is False
    assert "widthCm" not in item["properties"], "the model must never emit dimensions"


# --------------------------------------------------------------------------
# gate 3 — backend validation
# --------------------------------------------------------------------------

def test_hallucinated_catalog_id_is_rejected_and_named():
    accepted, rejected = planner.validate_items(
        [{"catalogId": "leb-chandelier-009", "xCm": 0, "zCm": 0, "rotationDeg": 0,
          "materialKey": "brass", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert accepted == []
    assert rejected[0]["catalogId"] == "leb-chandelier-009"
    assert "catalogue" in rejected[0]["why"]


def test_id_from_another_culture_is_rejected():
    accepted, rejected = planner.validate_items(
        [{"catalogId": "mor-pouf-001", "xCm": 0, "zCm": 0, "rotationDeg": 0,
          "materialKey": "wool", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert accepted == [] and len(rejected) == 1


def test_absurd_coordinates_are_rejected():
    accepted, rejected = planner.validate_items(
        [{"catalogId": "leb-sofa-001", "xCm": 99999, "zCm": 0, "rotationDeg": 0,
          "materialKey": "linen", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert accepted == []
    assert "outside the room" in rejected[0]["why"]


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_non_finite_coordinates_are_rejected(bad):
    accepted, _ = planner.validate_items(
        [{"catalogId": "leb-sofa-001", "xCm": bad, "zCm": 0, "rotationDeg": 0,
          "materialKey": "linen", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert accepted == []


def test_unknown_material_degrades_to_the_items_default():
    accepted, _ = planner.validate_items(
        [{"catalogId": "leb-sofa-001", "xCm": 0, "zCm": 0, "rotationDeg": 0,
          "materialKey": "unobtanium", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert len(accepted) == 1
    assert accepted[0]["materialKey"] is None


def test_found_material_is_not_selectable():
    """'found' is the grey reserved for what DAR detected, not a design choice."""
    assert "found" not in planner.MATERIAL_KEYS


def test_rotation_is_normalised():
    accepted, _ = planner.validate_items(
        [{"catalogId": "leb-sofa-001", "xCm": 0, "zCm": 0, "rotationDeg": 450,
          "materialKey": "linen", "reasonEn": "", "reasonAr": ""}],
        "lebanese", ROOM,
    )
    assert accepted[0]["rotationDeg"] == 90


def test_garbage_response_yields_nothing_and_does_not_raise():
    accepted, rejected = planner.validate_items("not a list", "lebanese", ROOM)
    assert accepted == [] and len(rejected) == 1


# --------------------------------------------------------------------------
# the no-key path — what CI and the offline demo run
# --------------------------------------------------------------------------

def test_no_key_gives_a_usable_rule_based_plan():
    result = planner.plan(ROOM, "lebanese", "a room for guests")
    assert result["source"] == "rules"
    assert result["model"] is None
    assert len(result["items"]) >= 5, "the offline demo must still furnish a room"
    assert not planner.is_configured()


def test_rule_based_plan_stays_inside_the_room():
    for culture in ("lebanese", "khaleeji", "moroccan", "all"):
        for item in planner.fallback_plan(ROOM, culture, ""):
            assert abs(item["xCm"]) <= ROOM["widthCm"] / 2
            assert abs(item["zCm"]) <= ROOM["depthCm"] / 2


def test_rule_based_ids_are_real_catalogue_ids():
    ids = set(planner.allowed_ids("all"))
    for item in planner.fallback_plan(ROOM, "khaleeji", ""):
        assert item["catalogId"] in ids


# --------------------------------------------------------------------------
# the model path, with an injected client
# --------------------------------------------------------------------------

def _understood(**over):
    base = {
        "culture": "lebanese",
        "roomType": "living room",
        "capacity": 6,
        "intensity": 0.9,
        "wallMaterialKey": "sand",
        "floorMaterialKey": "encaustic",
        "conceptEn": "Seating around a low table.",
        "conceptAr": "جلوس حول طاولة منخفضة.",
        "requirements": ["keep the centre open"],
        "requestedFurniture": [{"category": "chair", "count": 3}],
    }
    base.update(over)
    return base


def _valid_payload():
    # requestedFurniture is deliberately empty here: with a stated count, DAR
    # tops the plan up to it (see the count tests below), so a fixture that
    # asked for three chairs would silently change the length of every plan
    # these tests measure.
    return {
        "understood": _understood(requestedFurniture=[]),
        "operations": [
            {"catalogId": "leb-sofa-001", "xCm": 0, "zCm": -150, "rotationDeg": 0,
             "materialKey": "linen", "reasonEn": "Anchors the room.", "reasonAr": "يثبّت الغرفة."},
            {"catalogId": "leb-coffee-001", "xCm": 0, "zCm": -40, "rotationDeg": 0,
             "materialKey": "cedar", "reasonEn": "Within reach.", "reasonAr": "في المتناول."},
        ],
        "notesEn": "A calm arrangement.",
        "notesAr": "توزيع هادئ.",
    }


def test_model_path_returns_its_plan():
    fake = _FakeClient(_valid_payload())
    result = planner.plan(ROOM, "lebanese", "calm room", client=fake)
    assert result["source"] == "llm"
    assert len(result["items"]) == 2
    assert result["items"][0]["reasonAr"] == "يثبّت الغرفة."


def test_format_and_effort_are_siblings_in_one_output_config():
    """Two output_config kwargs would silently overwrite each other."""
    fake = _FakeClient(_valid_payload())
    planner.plan(ROOM, "lebanese", "calm room", client=fake)
    oc = fake.last_kwargs["output_config"]
    assert oc["format"]["type"] == "json_schema"
    assert oc["effort"] == "low"


def test_model_answer_still_goes_through_validation():
    payload = _valid_payload()
    payload["operations"].append({
        "catalogId": "totally-made-up", "xCm": 0, "zCm": 0, "rotationDeg": 0,
        "materialKey": "brass", "reasonEn": "", "reasonAr": "",
    })
    result = planner.plan(ROOM, "lebanese", "x", client=_FakeClient(payload))
    assert len(result["items"]) == 2
    assert result["rejected"][0]["catalogId"] == "totally-made-up"


def test_a_broken_model_degrades_to_rules_instead_of_failing():
    class _Boom:
        class messages:
            @staticmethod
            def create(**kwargs):
                raise RuntimeError("provider is down")

    result = planner.plan(ROOM, "lebanese", "x", client=_Boom())
    assert result["source"] == "rules"
    assert result["items"], "a provider outage must not cost the user their room"
    assert result["warning"]


def test_identical_briefs_are_served_from_cache():
    fake = _FakeClient(_valid_payload())
    planner.plan(ROOM, "lebanese", "A Calm  Room", client=fake)
    fake.last_kwargs = None
    again = planner.plan(ROOM, "lebanese", "a calm room", client=fake)
    assert again["cached"] is True
    assert fake.last_kwargs is None, "a repeated demo must not pay twice"


def test_prompt_does_not_carry_the_whole_ontology():
    msg = planner.build_user_message(ROOM, "lebanese", "a majlis", [])
    assert len(msg) < 14000, "the catalogue projection must stay small — this is the cost control"
    assert "leb-sofa-001" in msg


# --------------------------------------------------------------------------
# the interpretation — DAR reading the brief
# --------------------------------------------------------------------------

def test_understood_is_forced_into_real_vocabularies():
    u = planner.validate_understood({
        "culture": "atlantean",
        "roomType": "spaceship",
        "capacity": 900,
        "intensity": 7.5,
        "wallMaterialKey": "unobtanium",
        "floorMaterialKey": "lava",
        "requirements": ["x"],
        "requestedFurniture": [{"category": "hovercraft", "count": 2}],
    }, "moroccan")
    assert u["culture"] == "moroccan", "an unknown culture falls back to the room's own"
    assert u["roomType"] in planner.ROOM_TYPES
    assert u["capacity"] is None, "an absurd capacity is dropped, not clamped to something plausible"
    assert u["intensity"] == 1.0, "intensity is clamped to the range /restyle enforces"
    assert u["wallMaterialKey"] is None and u["floorMaterialKey"] is None
    assert u["requestedFurniture"] == [], "a category outside the ontology is dropped"


def test_understood_keeps_real_values():
    u = planner.validate_understood(_understood(intensity=0.45), "all")
    assert u["culture"] == "lebanese" and u["intensity"] == 0.45
    assert u["wallMaterialKey"] == "sand"
    assert u["requestedFurniture"] == [{"category": "chair", "count": 3}]


def test_material_enums_are_the_real_swatch_lists():
    """Colour intent must land on Build Mode materials, never invent a palette."""
    assert set(planner.WALL_MATERIALS) == {"limestone", "gypsum", "tadelakt", "sand"}
    assert "zellige" in planner.FLOOR_MATERIALS and "velvet" not in planner.FLOOR_MATERIALS


def test_a_missing_understood_block_does_not_crash():
    u = planner.validate_understood(None, "khaleeji")
    assert u["culture"] == "khaleeji" and u["intensity"] is None


# --------------------------------------------------------------------------
# culture coherence — the gate that stops a mixed-culture room
# --------------------------------------------------------------------------

def test_a_piece_from_another_culture_is_dropped_and_named():
    accepted, rejected = planner.validate_items(
        [
            {"catalogId": "mor-pouf-001", "xCm": 0, "zCm": 0, "rotationDeg": 0,
             "materialKey": "wool", "reasonEn": "", "reasonAr": ""},
            {"catalogId": "leb-sofa-001", "xCm": 0, "zCm": -150, "rotationDeg": 0,
             "materialKey": "linen", "reasonEn": "", "reasonAr": ""},
        ],
        "lebanese", ROOM,
    )
    assert [a["catalogId"] for a in accepted] == ["leb-sofa-001"]
    assert rejected[0]["catalogId"] == "mor-pouf-001"
    assert "lebanese room" in rejected[0]["why"]


def test_all_permits_every_culture():
    accepted, rejected = planner.validate_items(
        [{"catalogId": "mor-pouf-001", "xCm": 0, "zCm": 0, "rotationDeg": 0,
          "materialKey": "wool", "reasonEn": "", "reasonAr": ""}],
        "all", ROOM,
    )
    assert len(accepted) == 1 and rejected == []


def test_the_chosen_culture_judges_the_items_not_the_room():
    """Ask for Moroccan in a Lebanese room and you get a Moroccan room."""
    payload = _valid_payload()
    payload["understood"] = _understood(culture="moroccan", requestedFurniture=[])
    payload["operations"] = [
        {"catalogId": "mor-sofa-001", "xCm": 0, "zCm": -150, "rotationDeg": 0,
         "materialKey": "wool", "reasonEn": "", "reasonAr": ""},
    ]
    r = planner.plan(ROOM, "lebanese", "make it Moroccan", client=_FakeClient(payload))
    assert r["understood"]["culture"] == "moroccan"
    assert [i["catalogId"] for i in r["items"]] == ["mor-sofa-001"]


# --------------------------------------------------------------------------
# capacity — DAR's arithmetic, not the model's claim
# --------------------------------------------------------------------------

def test_seat_estimate_comes_from_real_widths():
    assert planner.seats_of({"category": "sofa", "widthCm": 210}) == 3
    assert planner.seats_of({"category": "sofa", "widthCm": 240}) == 4
    assert planner.seats_of({"category": "armchair", "widthCm": 78}) == 1
    assert planner.seats_of({"category": "ottoman", "widthCm": 55}) == 1
    assert planner.seats_of({"category": "coffee_table", "widthCm": 110}) == 0
    assert planner.seats_of({"category": "lamp", "widthCm": 38}) == 0


def test_seating_estimate_sums_the_placed_pieces():
    # 240cm majlis (4) + armchair (1) + ottoman (1) = 6
    accepted = [{"catalogId": i} for i in
                ("khal-majlis-001", "khal-armchair-001", "khal-ottoman-001")]
    assert planner.seating_estimate(accepted) == 6


def test_placed_counts_are_by_category():
    counts = planner.placed_counts([{"catalogId": "leb-chair-001"},
                                    {"catalogId": "leb-chair-001"},
                                    {"catalogId": "leb-sofa-001"}])
    assert counts == {"chair": 2, "sofa": 1}


def test_rule_plan_reports_its_own_seating():
    r = planner.plan(ROOM, "khaleeji", "")
    assert r["seatingEstimate"] == planner.seating_estimate(r["items"])
    assert r["understood"]["capacity"] is None, "rules must not claim to have read a capacity"


# --------------------------------------------------------------------------
# openings
# --------------------------------------------------------------------------

def test_openings_reach_the_prompt():
    msg = planner.build_user_message(
        ROOM, "lebanese", "keep the door clear", [],
        [{"kind": "door", "wall": "south", "t": 0.5, "widthCm": 90}],
    )
    assert "door" in msg.lower()


def test_no_openings_says_so_rather_than_implying_knowledge():
    msg = planner.build_user_message(ROOM, "lebanese", "x", [], [])
    assert "has not detected any door or window" in msg


def test_default_room_is_never_presented_as_measured():
    msg = planner.build_user_message(ROOM, "lebanese", "x", [], [], "default")
    assert "default room dimensions" in msg
    assert "do not claim to know the real one" in msg


# --------------------------------------------------------------------------
# provider boundary
# --------------------------------------------------------------------------

class _FakeGeminiClient:
    """Shape-compatible with google-genai's client.models.generate_content."""

    def __init__(self, payload: dict):
        self.last_config: dict | None = None
        outer = self

        class _Models:
            def generate_content(self, *, model, contents, config):
                outer.last_config = config
                return type("R", (), {"text": json.dumps(payload), "usage_metadata": None})()

        self.models = _Models()


def test_gemini_path_uses_the_same_schema_and_validator():
    fake = _FakeGeminiClient(_valid_payload())
    r = planner.plan(ROOM, "lebanese", "calm room", client=fake)
    assert r["source"] == "llm" and r["provider"] == "gemini"
    assert len(r["items"]) == 2
    schema = fake.last_config["response_schema"]
    enum = schema["properties"]["operations"]["items"]["properties"]["catalogId"]["enum"]
    assert len(enum) == 27, "gate 1 must hold on this provider too"
    assert fake.last_config["response_mime_type"] == "application/json"


def test_gemini_answer_is_validated_exactly_like_anthropic():
    payload = _valid_payload()
    payload["operations"].append({
        "catalogId": "invented-001", "xCm": 0, "zCm": 0, "rotationDeg": 0,
        "materialKey": "brass", "reasonEn": "", "reasonAr": "",
    })
    r = planner.plan(ROOM, "lebanese", "x", client=_FakeGeminiClient(payload))
    assert len(r["items"]) == 2
    assert r["rejected"][0]["catalogId"] == "invented-001"


def test_gemini_schema_drops_what_gemini_rejects():
    """Each of these was a real 400 from the live API, not a precaution.

    Gemini takes an OpenAPI subset and rejects the whole request rather than
    ignoring unknown keys, so an untranslated schema meant every Gemini call
    failed and silently degraded to rules.
    """
    g = planner.gemini_schema(planner.plan_schema("all"))
    flat = json.dumps(g)
    assert "additionalProperties" not in flat, "400 Unknown name additional_properties"
    assert '"type": ["' not in flat, "union types are not supported; use nullable"

    und = g["properties"]["understood"]["properties"]
    assert und["capacity"] == {"type": "integer", "nullable": True}
    # null must leave the enum and become the nullable flag instead
    assert None not in und["wallMaterialKey"]["enum"]
    assert und["wallMaterialKey"]["nullable"] is True


def test_gemini_schema_keeps_gate_one_intact():
    """Translation must not weaken the closed vocabulary."""
    g = planner.gemini_schema(planner.plan_schema("all"))
    enum = g["properties"]["operations"]["items"]["properties"]["catalogId"]["enum"]
    assert len(enum) == 27 and "leb-sofa-001" in enum
    assert g["properties"]["operations"]["items"]["required"], "required must survive"


def test_gemini_gets_a_bigger_token_budget_than_anthropic():
    """Gemini 3.x counts thinking against max_output_tokens — measured ~5k
    thinking before ~1.1k of JSON, so Anthropic's 2k truncates it mid-object."""
    assert planner.MAX_OUTPUT_TOKENS_GEMINI >= 8000
    assert planner.MAX_OUTPUT_TOKENS_GEMINI > planner.MAX_OUTPUT_TOKENS


def test_default_gemini_model_is_not_the_retired_one():
    """gemini-2.5-flash still appears in models.list() but 404s for new keys."""
    assert planner.DEFAULT_GEMINI_MODEL != "gemini-2.5-flash"


def test_provider_is_none_without_a_key():
    assert planner.provider() is None and not planner.is_configured()


def test_cache_key_notices_the_room_changing():
    a = planner._cache_key(ROOM, "lebanese", "x", [{"label": "sofa"}], [])
    b = planner._cache_key(ROOM, "lebanese", "x", [], [])
    assert a != b, "moving what DAR found in the photo must invalidate the plan"


# --------------------------------------------------------------------------
# the endpoint
# --------------------------------------------------------------------------

def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _run(coro_fn):
    return asyncio.run(coro_fn())


def test_endpoint_requires_a_session():
    async def _go():
        async with _client() as c:
            return await c.post("/api/design/plan", json={
                "width_cm": 520, "depth_cm": 420, "culture": "lebanese", "brief": "x",
            })

    r = _run(_go)
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "not_authenticated"


def test_planner_status_is_public_and_honest():
    async def _go():
        async with _client() as c:
            return await c.get("/api/design/planner-status")

    r = _run(_go)
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is False and body["model"] is None


# --------------------------------------------------------------------------
# editing a room that already has furniture in it
#
# Everything below exists because the planner used to be add-only. Whatever you
# typed — "move these apart", "remove one chair" — it answered by furnishing an
# imaginary empty room, because it had never been shown the room it was editing
# and had no vocabulary for changing one.
# --------------------------------------------------------------------------

SCENE = [
    {"uid": "u-chair", "origin": "catalog", "catalogId": "leb-chair-001",
     "category": "chair", "label": "Chair", "xCm": -100, "zCm": 0,
     "rotationDeg": 0, "locked": False},
    {"uid": "u-sofa", "origin": "catalog", "catalogId": "leb-sofa-001",
     "category": "sofa", "label": "Sofa", "xCm": 0, "zCm": -150,
     "rotationDeg": 0, "locked": False},
    {"uid": "u-locked", "origin": "catalog", "catalogId": "leb-lamp-001",
     "category": "lamp", "label": "Lamp", "xCm": 200, "zCm": -150,
     "rotationDeg": 0, "locked": True},
    {"uid": "f-found", "origin": "found", "catalogId": None, "category": "table",
     "label": "Table", "xCm": 60, "zCm": 60, "rotationDeg": 0, "locked": True},
]


def _op(op, **over):
    base = {
        "op": op, "catalogId": None, "targetUid": None,
        "xCm": None, "zCm": None, "rotationDeg": None, "materialKey": None,
        "reasonEn": "because", "reasonAr": "لأن",
    }
    base.update(over)
    return base


def _ops_payload(ops, **understood_over):
    understood_over.setdefault("requestedFurniture", [])
    return {
        "understood": _understood(**understood_over),
        "operations": ops,
        "notesEn": "n", "notesAr": "ن",
    }


def test_only_pieces_the_user_placed_are_movable():
    """Found massing and locked pieces describe the real room, so they are not
    offered as targets at all — unrepresentable, not merely discouraged."""
    uids = [o["uid"] for o in planner.movable_objects(SCENE)]
    assert uids == ["u-chair", "u-sofa"]
    assert "f-found" not in uids, "a photographed piece is a measurement, not furniture DAR placed"
    assert "u-locked" not in uids


def test_target_uid_enum_is_the_scene_the_client_sent():
    schema = planner.plan_schema("all", ["u-chair", "u-sofa"])
    props = schema["properties"]["operations"]["items"]["properties"]
    assert set(props["targetUid"]["enum"]) == {"u-chair", "u-sofa", None}
    assert props["op"]["enum"] == ["add", "move", "remove"]


def test_an_empty_room_is_not_offered_move_or_remove():
    """With nothing placed there is nothing to target, and an empty enum is not
    a valid schema — so the operations themselves are withdrawn."""
    props = planner.plan_schema("all", [])["properties"]["operations"]["items"]["properties"]
    assert props["op"]["enum"] == ["add"]
    assert "enum" not in props["targetUid"]


def test_move_and_remove_reach_the_client():
    payload = _ops_payload([
        _op("move", targetUid="u-chair", xCm=180, zCm=90, rotationDeg=90),
        _op("remove", targetUid="u-sofa"),
    ])
    r = planner.plan(ROOM, "lebanese", "move the chair and take the sofa out",
                     objects=SCENE, client=_FakeClient(payload))
    assert r["source"] == "llm"
    assert r["moves"] == [{
        "targetUid": "u-chair", "xCm": 180, "zCm": 90, "rotationDeg": 90,
        "reasonEn": "because", "reasonAr": "لأن",
    }]
    assert [x["targetUid"] for x in r["removals"]] == ["u-sofa"]


def test_an_invented_uid_is_rejected_and_named():
    payload = _ops_payload([_op("move", targetUid="u-ghost", xCm=0, zCm=0, rotationDeg=0)])
    r = planner.plan(ROOM, "lebanese", "move the ghost", objects=SCENE,
                     client=_FakeClient(payload))
    assert r["moves"] == []
    assert any("no such piece" in x["why"] for x in r["rejected"])


def test_a_locked_or_found_piece_cannot_be_targeted():
    payload = _ops_payload([
        _op("remove", targetUid="f-found"),
        _op("move", targetUid="u-locked", xCm=0, zCm=0, rotationDeg=0),
    ])
    r = planner.plan(ROOM, "lebanese", "clear the room", objects=SCENE,
                     client=_FakeClient(payload))
    assert r["moves"] == [] and r["removals"] == []
    assert len(r["rejected"]) == 2


def test_two_operations_on_one_piece_keep_only_the_first():
    """Applying both would leave it wherever the later one landed — obeying an
    instruction nobody gave."""
    payload = _ops_payload([
        _op("move", targetUid="u-chair", xCm=100, zCm=0, rotationDeg=0),
        _op("move", targetUid="u-chair", xCm=-200, zCm=80, rotationDeg=0),
    ])
    r = planner.plan(ROOM, "lebanese", "move it", objects=SCENE,
                     client=_FakeClient(payload))
    assert len(r["moves"]) == 1 and r["moves"][0]["xCm"] == 100


def test_a_plan_of_moves_alone_is_a_plan():
    """No additions at all used to mean "no usable placement" and fall to rules,
    which is how "rearrange these" turned into seven brand new pieces."""
    payload = _ops_payload([_op("move", targetUid="u-chair", xCm=150, zCm=50, rotationDeg=0)])
    r = planner.plan(ROOM, "lebanese", "spread them out", objects=SCENE,
                     client=_FakeClient(payload))
    assert r["source"] == "llm"
    assert r["items"] == [] and len(r["moves"]) == 1


def test_the_prompt_shows_the_model_the_room_it_is_editing():
    msg = planner.build_user_message(ROOM, "lebanese", "move these", [], [], None, "", SCENE)
    assert "u-chair" in msg and "u-sofa" in msg
    assert "f-found" not in msg, "a found piece has no uid to hand out"
    assert "u-locked" not in msg


def test_the_scene_is_part_of_the_cache_key():
    """"Add one more chair" typed twice is the same brief against a different
    room; without the scene in the key the second is served the first's answer."""
    a = planner._cache_key(ROOM, "lebanese", "x", [], [], SCENE)
    b = planner._cache_key(ROOM, "lebanese", "x", [], [], [])
    assert a != b


# --------------------------------------------------------------------------
# counts — "add 5 chairs" means five
# --------------------------------------------------------------------------

def test_a_short_plan_is_topped_up_to_the_number_asked_for():
    payload = _ops_payload(
        [_op("add", catalogId="leb-chair-001", xCm=x, zCm=60, rotationDeg=0)
         for x in (-60, 0)],
        requestedFurniture=[{"category": "chair", "count": 5}],
    )
    r = planner.plan(ROOM, "lebanese", "add 5 chairs", client=_FakeClient(payload))
    assert len(r["items"]) == 5
    assert all(i["catalogId"] == "leb-chair-001" for i in r["items"])
    # The three DAR added carry no invented coordinate — the client's own
    # auto-placer decides where they stand.
    assert sum(1 for i in r["items"] if i.get("autoPlaced")) == 3
    assert r["counts"] == [{"category": "chair", "requested": 5, "planned": 5}]


def test_a_long_plan_is_trimmed_to_the_number_asked_for():
    payload = _ops_payload(
        [_op("add", catalogId="leb-chair-001", xCm=x, zCm=60, rotationDeg=0)
         for x in (-120, -60, 0, 60, 120)],
        requestedFurniture=[{"category": "chair", "count": 2}],
    )
    r = planner.plan(ROOM, "lebanese", "add 2 chairs", client=_FakeClient(payload))
    assert len(r["items"]) == 2
    assert len(r["rejected"]) == 3
    assert "5 placed but 2 asked for" in r["rejected"][0]["why"]


def test_a_count_of_one_places_one():
    payload = _ops_payload(
        [_op("add", catalogId="leb-coffee-001", xCm=0, zCm=0, rotationDeg=0)],
        requestedFurniture=[{"category": "coffee_table", "count": 1}],
    )
    r = planner.plan(ROOM, "lebanese", "add one table", client=_FakeClient(payload))
    assert len(r["items"]) == 1


def test_counts_are_reported_even_when_the_model_complied():
    payload = _ops_payload(
        [_op("add", catalogId="leb-chair-001", xCm=x, zCm=60, rotationDeg=0)
         for x in (-60, 0, 60)],
        requestedFurniture=[{"category": "chair", "count": 3}],
    )
    r = planner.plan(ROOM, "lebanese", "add 3 chairs", client=_FakeClient(payload))
    assert r["counts"] == [{"category": "chair", "requested": 3, "planned": 3}]


def test_no_stated_count_leaves_the_plan_exactly_as_the_model_wrote_it():
    r = planner.plan(ROOM, "lebanese", "a calm room", client=_FakeClient(_valid_payload()))
    assert len(r["items"]) == 2 and r["counts"] == []


# --------------------------------------------------------------------------
# the catalogue is nine pieces per culture, but not the same nine
# --------------------------------------------------------------------------

def test_khaleeji_has_no_chair_so_its_nearest_seat_stands_in():
    assert not any(
        i["category"] == "chair" for i in planner.catalogue_projection("khaleeji")
    ), "if Khaleeji ever gains a chair this substitution stops being needed"

    payload = _ops_payload(
        [], culture="khaleeji", requestedFurniture=[{"category": "chair", "count": 5}],
    )
    r = planner.plan(ROOM, "khaleeji", "add 5 chairs", client=_FakeClient(payload))
    assert len(r["items"]) == 5
    assert all(i["catalogId"] == "khal-armchair-001" for i in r["items"])
    # Reported, never silent: the user is not told they got a chair.
    assert r["substitutions"] == [{
        "requested": "chair", "catalogId": "khal-armchair-001", "category": "armchair",
        "nameEn": "Majlis armchair", "culture": "khaleeji",
    }]


def test_a_culture_that_has_the_category_substitutes_nothing():
    payload = _ops_payload([], requestedFurniture=[{"category": "chair", "count": 2}])
    r = planner.plan(ROOM, "lebanese", "add 2 chairs", client=_FakeClient(payload))
    assert r["substitutions"] == []
    assert all(i["catalogId"] == "leb-chair-001" for i in r["items"])


@pytest.mark.parametrize("culture", ["lebanese", "khaleeji", "moroccan"])
@pytest.mark.parametrize("category", planner.REQUESTABLE_CATEGORIES)
def test_every_requestable_category_resolves_in_every_culture(culture, category):
    """A brief may name any of these; none of them may come back empty-handed."""
    item, _sub = planner.item_for_category(culture, category)
    assert item is not None, f"{culture} can answer for no {category}"
    assert item["culture"] == culture


# --------------------------------------------------------------------------
# the room's culture follows the brief
# --------------------------------------------------------------------------

@pytest.mark.parametrize("target", ["lebanese", "khaleeji", "moroccan"])
def test_any_culture_can_be_asked_for_from_any_room(target):
    prefix = {"lebanese": "leb-", "khaleeji": "khal-", "moroccan": "mor-"}[target]
    item = planner.catalogue_projection(target)[0]
    payload = _ops_payload(
        [_op("add", catalogId=item["id"], xCm=0, zCm=0, rotationDeg=0)],
        culture=target,
    )
    # Asked from a room whose culture is something else entirely.
    r = planner.plan(ROOM, "lebanese", f"make this a {target} room",
                     client=_FakeClient(payload))
    assert r["understood"]["culture"] == target
    assert all(i["catalogId"].startswith(prefix) for i in r["items"])


def test_intent_is_read_and_validated():
    assert planner.validate_understood({"intent": "edit"}, "lebanese")["intent"] == "edit"
    # Anything the vocabulary does not hold is a fresh furnishing, the safer read.
    assert planner.validate_understood({"intent": "vibes"}, "lebanese")["intent"] == "furnish"
    assert planner.validate_understood({}, "lebanese")["intent"] == "furnish"


# --------------------------------------------------------------------------
# a busy model is not a design decision
# --------------------------------------------------------------------------

class _Overloaded(Exception):
    """Shaped like the 503 Gemini's free tier returns under load."""
    status_code = 503


class _BadRequest(Exception):
    status_code = 400


def test_a_transient_overload_is_retried_not_surrendered_to(monkeypatch):
    monkeypatch.setattr(planner, "_sleep", lambda s: None)
    attempts = []

    def flaky(api, model, message, schema):
        attempts.append(model)
        if len(attempts) < 3:
            raise _Overloaded("high demand")
        return {"understood": _understood(), "operations": [], "notesEn": "", "notesAr": ""}

    _data, model = planner.call_with_retry(flaky, None, ["m1", "m2"], "msg", {})
    assert attempts == ["m1", "m1", "m1"], "retries stay on the model that was asked for"
    assert model == "m1"


def test_a_model_that_stays_busy_hands_over_to_the_next(monkeypatch):
    monkeypatch.setattr(planner, "_sleep", lambda s: None)

    def busy_first(api, model, message, schema):
        if model == "m1":
            raise _Overloaded("high demand")
        return {"understood": _understood(), "operations": [], "notesEn": "", "notesAr": ""}

    _data, model = planner.call_with_retry(busy_first, None, ["m1", "m2"], "msg", {})
    assert model == "m2"


def test_a_bad_request_is_not_retried(monkeypatch):
    monkeypatch.setattr(planner, "_sleep", lambda s: None)
    attempts = []

    def bad(api, model, message, schema):
        attempts.append(model)
        raise _BadRequest("schema")

    with pytest.raises(_BadRequest):
        planner.call_with_retry(bad, None, ["m1", "m2"], "msg", {})
    assert attempts == ["m1", "m2"], "one shot each — a 400 fails identically on retry"


def test_only_overload_and_rate_limits_are_retryable():
    assert planner.is_retryable(_Overloaded())
    assert not planner.is_retryable(_BadRequest())
    assert planner.is_retryable(ConnectionError())


def test_an_explicit_model_override_is_the_only_model_tried(monkeypatch):
    """Naming a model means that model — quietly answering from another one is
    the substitution this file refuses to make anywhere else."""
    monkeypatch.setenv("DARDESIGN_LLM_MODEL", "some-pinned-model")
    assert planner.model_chain() == ["some-pinned-model"]


def test_the_fallback_reason_reaches_the_client():
    """The panel shows this string. A silent fallback is indistinguishable from
    a deliberate layout, which is how a 503 came to look like a design decision."""
    class _Boom:
        class messages:
            @staticmethod
            def create(**kwargs):
                raise _Overloaded("high demand")

    r = planner.plan(ROOM, "lebanese", "x", client=_Boom())
    assert r["source"] == "rules"
    assert "503" in r["warning"] and "_Overloaded" in r["warning"]


def test_rules_do_not_duplicate_what_is_already_in_the_room():
    """The rule path cannot read a brief — that is the honest difference. It can
    read the room, and dropping a second sofa beside the first is what made an
    outage look like the editor ignoring you."""
    bare = {i["catalogId"] for i in planner.fallback_plan(ROOM, "lebanese", "", [])}
    furnished = {i["catalogId"] for i in planner.fallback_plan(ROOM, "lebanese", "", SCENE)}
    assert "leb-sofa-001" in bare
    assert "leb-sofa-001" not in furnished
    assert "leb-chair-001" not in furnished
    assert furnished, "it still contributes the pieces the room is missing"


def test_rules_never_move_or_remove_anything():
    """Rules cannot know which piece you meant, so they touch nothing."""
    r = planner.plan(ROOM, "lebanese", "move the sofa", objects=SCENE)
    assert r["source"] == "rules"
    assert r["moves"] == [] and r["removals"] == []


# --------------------------------------------------------------------------
# the substitution table is shared data, not two hand-written copies
#
# backend/design_planner.py and src/lib/design/culture.ts both need to answer
# "this culture has no lamp — what stands in?". CLAUDE.md already records the
# cost of ontology.json existing in two places; this table does not repeat it.
# --------------------------------------------------------------------------

SUBSTITUTES_JSON = ROOT / "ontology" / "category_substitutes.json"


def test_the_substitution_table_is_loaded_from_shared_data():
    assert SUBSTITUTES_JSON.exists(), "the client reads this file too"
    raw = json.loads(SUBSTITUTES_JSON.read_text(encoding="utf-8"))["substitutes"]
    assert planner.CATEGORY_SUBSTITUTES == {k: tuple(v) for k, v in raw.items()}


def test_the_table_only_names_real_categories():
    """A typo would silently mean 'no substitute' rather than erroring."""
    real = {i["category"] for i in planner.catalogue_projection("all")}
    for category, chain in planner.CATEGORY_SUBSTITUTES.items():
        assert category in real, f"{category} is not a category any culture has"
        for alt in chain:
            assert alt in real, f"{category} -> {alt} is not a real category"


def test_no_category_substitutes_to_itself():
    for category, chain in planner.CATEGORY_SUBSTITUTES.items():
        assert category not in chain


def test_every_piece_can_be_converted_into_every_other_culture():
    """Culture conversion is all-or-nothing: a room that can only be half
    converted is exactly the mixed-identity state the feature exists to end.
    The client enforces the same property in src/lib/design/culture.test.ts."""
    for src in planner.CULTURES:
        for dst in planner.CULTURES:
            if src == dst:
                continue
            for item in planner.catalogue_projection(src):
                found, _sub = planner.item_for_category(dst, item["category"])
                assert found is not None, f"{src}.{item['category']} cannot become {dst}"
                assert found["culture"] == dst


# --------------------------------------------------------------------------
# gate 1 on the CALL PATH, not just in plan_schema()
#
# The enum the model actually receives is the one that matters, and
# test_schema_enum_is_exactly_that_culture exercises plan_schema directly, so
# it cannot see what plan() passes.
# --------------------------------------------------------------------------

def test_the_call_path_offers_every_id_so_a_brief_can_change_the_culture():
    """Narrowing the enum to the room's own nine ids is stronger grounding and
    is deliberately NOT done: `plan()` runs before anyone knows what culture the
    brief asks for, and "make this a Moroccan room" is a supported brief. In a
    narrowed Lebanese room, changing the culture would be unrepresentable —
    trading a working feature for a tighter gate on a failure validate_items
    already catches by name."""
    client = _FakeClient(_ops_payload([], culture="moroccan"))
    planner.plan(ROOM, "lebanese", "make this a Moroccan room", client=client)

    schema = client.last_kwargs["output_config"]["format"]["schema"]
    enum = schema["properties"]["operations"]["items"]["properties"]["catalogId"]["enum"]
    ids = [i for i in enum if i is not None]
    assert len(ids) == 27, "a Lebanese room must still be able to be told to become Moroccan"
    assert any(i.startswith("mor-") for i in ids)


def test_one_room_still_gets_one_culture_despite_the_wide_enum():
    """The wide enum is safe because validate_items judges every piece against
    understood.culture — the mixing gate moved, it did not disappear."""
    payload = _ops_payload(
        [
            _op("add", catalogId="mor-sofa-001", xCm=0, zCm=-150, rotationDeg=0),
            _op("add", catalogId="leb-sofa-001", xCm=0, zCm=100, rotationDeg=0),
        ],
        culture="moroccan",
    )
    r = planner.plan(ROOM, "lebanese", "make this a Moroccan room",
                     client=_FakeClient(payload))
    assert [i["catalogId"] for i in r["items"]] == ["mor-sofa-001"]
    assert any("lebanese piece in a moroccan room" in x["why"] for x in r["rejected"])


# --------------------------------------------------------------------------
# a per-day quota is not a transient rate limit
# --------------------------------------------------------------------------


class _DailyQuota(Exception):
    """Shaped like the 429 Gemini returns when the FREE-TIER DAY is spent.

    Copied from a real refusal, because the distinction lives in the body:
    quotaId names PerDay, and retryDelay is tens of seconds rather than one.
    """
    status_code = 429

    def __init__(self):
        super().__init__(
            "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded "
            "your current quota', 'details': [{'@type': 'type.googleapis.com/"
            "google.rpc.QuotaFailure', 'violations': [{'quotaId': "
            "'GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'quotaValue': '20'}]}, "
            "{'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '52s'}]}}"
        )


class _PerMinuteLimit(Exception):
    """The OTHER 429 — a per-minute window that a short backoff really does clear."""
    status_code = 429

    def __init__(self):
        super().__init__(
            "429 RESOURCE_EXHAUSTED. {'error': {'details': [{'@type': "
            "'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': "
            "'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]}, {'@type': "
            "'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '1s'}]}}"
        )


def test_a_daily_quota_is_not_retried():
    """Retrying a spent day cannot succeed, and it is not free to try.

    Measured on a real key: with 429 blanket-retryable, ONE click of "Design for
    me" spent 4 models x 3 attempts = 12 requests against a 20/day/model cap,
    turning a single exhausted model into four. The whole day's budget went in
    one click.
    """
    assert not planner.is_retryable(_DailyQuota())
    assert planner.is_daily_quota(_DailyQuota())


def test_a_per_minute_limit_is_still_retried():
    """The distinction has to cut the right way, or a recoverable blip is
    treated as a spent day and the feature degrades for no reason."""
    assert planner.is_retryable(_PerMinuteLimit())
    assert not planner.is_daily_quota(_PerMinuteLimit())


def test_a_spent_day_costs_one_request_per_model_not_three(monkeypatch):
    """Fail fast on this model, but still ASK the next one.

    The quota is per model, so the next model in the chain may genuinely have
    budget left -- skipping the rest of the chain would be as wrong as
    hammering it."""
    monkeypatch.setattr(planner, "_sleep", lambda s: None)
    attempts = []

    def spent(api, model, message, schema):
        attempts.append(model)
        raise _DailyQuota()

    with pytest.raises(_DailyQuota):
        planner.call_with_retry(spent, None, ["m1", "m2", "m3", "m4"], "msg", {})
    assert attempts == ["m1", "m2", "m3", "m4"], (
        "one request per model: 4 instead of 12"
    )
