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
    enum = schema["properties"]["items"]["items"]["properties"]["catalogId"]["enum"]
    assert len(enum) == 9
    assert set(enum) == set(planner.allowed_ids(culture))
    prefix = {"lebanese": "leb-", "khaleeji": "khal-", "moroccan": "mor-"}[culture]
    assert all(i.startswith(prefix) for i in enum)


def test_all_offers_every_culture():
    assert len(planner.allowed_ids("all")) == 27


def test_schema_forbids_extra_properties():
    item = planner.plan_schema("lebanese")["properties"]["items"]["items"]
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
    return {
        "understood": _understood(),
        "items": [
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
    payload["items"].append({
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
    payload["understood"] = _understood(culture="moroccan")
    payload["items"] = [
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
    enum = schema["properties"]["items"]["items"]["properties"]["catalogId"]["enum"]
    assert len(enum) == 27, "gate 1 must hold on this provider too"
    assert fake.last_config["response_mime_type"] == "application/json"


def test_gemini_answer_is_validated_exactly_like_anthropic():
    payload = _valid_payload()
    payload["items"].append({
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
    enum = g["properties"]["items"]["items"]["properties"]["catalogId"]["enum"]
    assert len(enum) == 27 and "leb-sofa-001" in enum
    assert g["properties"]["items"]["items"]["required"], "required must survive"


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
