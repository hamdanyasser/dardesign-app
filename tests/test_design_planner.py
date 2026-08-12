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

def _valid_payload():
    return {
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
    assert len(msg) < 6000, "the catalogue projection must stay small — this is the cost control"
    assert "leb-sofa-001" in msg


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
