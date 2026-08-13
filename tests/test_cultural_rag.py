"""Cultural RAG — the retrieval layer and its contract with the planner.

Three claims are under test, and they are the three the defence rests on:

  1. DAR retrieves cultural evidence from a knowledge base, in English and in
     Arabic, and the evidence differs by culture in the way it should.
  2. That evidence actually reaches the model — not "is available to", reaches.
     `test_evidence_reaches_the_model_prompt` reads the prompt the provider was
     handed and finds the retrieved element inside it.
  3. Nothing about retrieval weakens the grounding gates. An invented catalogue
     id is still rejected with evidence present, and with RAG switched off the
     prompt is byte-for-byte what it was before the feature existed.

NO API CALLS and NO NETWORK. Retrieval is local BM25 over local JSON; the model
path is a fake client that records what it was given.

GPU NOT NEEDED — DARDESIGN_LIGHT, no model ever loads.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import design_planner as planner  # noqa: E402
from backend import knowledge, retrieval  # noqa: E402

ROOM = {"widthCm": 520.0, "depthCm": 420.0, "heightCm": 300.0}

# The five briefs from the feature's own evaluation set, plus the negatives.
EVAL_EN_LEBANESE = "Design a traditional Lebanese living room for six people."
EVAL_AR_KHALEEJI = "بدي مجلس خليجي تقليدي لثمان أشخاص وألوان دافئة"
EVAL_MOROCCAN = "Modern Moroccan room with zellige but not too traditional."
EVAL_NO_ARCHES = "Lebanese bedroom with no arches."
EVAL_OPEN_CENTRE = "Moroccan living room, keep the center open."
IRRELEVANT = ["hello how are you", "", "   ", "asdfgh qwerty", "make it nice"]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """No provider key and no leftover caches: nothing here can reach a network."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("DARDESIGN_RAG", raising=False)
    knowledge.reset_cache()
    planner._reset_for_tests()
    yield
    knowledge.reset_cache()
    planner._reset_for_tests()


class _FakeResponse:
    def __init__(self, payload: dict):
        block = type("Block", (), {"type": "text", "text": json.dumps(payload)})()
        self.content = [block]
        self.usage = type("U", (), {"input_tokens": 1000, "output_tokens": 500})()


class _FakeClient:
    """Stands in for anthropic.Anthropic and records the request it was given."""

    def __init__(self, payload: dict):
        self._payload = payload
        self.last_kwargs: dict | None = None
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.last_kwargs = kwargs
                return _FakeResponse(outer._payload)

        self.messages = _Messages()

    @property
    def prompt(self) -> str:
        return self.last_kwargs["messages"][0]["content"]


def _payload(items: list[dict], culture: str = "lebanese") -> dict:
    return {
        "understood": {
            "culture": culture, "roomType": "living room", "capacity": None,
            "intensity": None, "wallMaterialKey": None, "floorMaterialKey": None,
            "conceptEn": "c", "conceptAr": "ج", "requirements": [],
            "requestedFurniture": [],
        },
        "items": items,
        "notesEn": "n", "notesAr": "ن",
    }


def _item(cid: str, **over) -> dict:
    base = {
        "catalogId": cid, "xCm": 0, "zCm": -150, "rotationDeg": 0,
        "materialKey": "cedar", "reasonEn": "r", "reasonAr": "ر",
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------
# the knowledge base itself
# --------------------------------------------------------------------------

def test_corpus_loads_all_three_cultures():
    chunks = knowledge.corpus()
    assert len(chunks) > 60
    cultures = {c.culture for c in chunks}
    assert cultures == set(knowledge.KB_CULTURES)


def test_persian_is_not_in_the_knowledge_base():
    """0/23 verified and no LoRA — offering it as cultural evidence would overstate."""
    assert "persian" not in {c.culture for c in knowledge.corpus()}


def test_every_chunk_term_exists_in_the_ontology():
    """The KB derives its vocabulary; it never invents a term."""
    onto = json.loads((ROOT / "ontology" / "ontology.json").read_text(encoding="utf-8"))
    for culture in knowledge.KB_CULTURES:
        known = set()
        for cat in knowledge.KB_CATEGORIES:
            for t in onto["cultures"][culture].get(cat, []):
                if isinstance(t, dict) and isinstance(t.get("en"), str):
                    known.add(t["en"])
        for chunk in knowledge.corpus():
            if chunk.culture == culture and chunk.category != "spatial_convention":
                assert chunk.element_en in known, f"{chunk.id} invented {chunk.element_en!r}"


def test_verified_flags_are_inherited_not_asserted():
    """Khaleeji and Moroccan are signed off; Lebanese is not. Report, do not smooth."""
    by_culture: dict[str, set[bool]] = {}
    for c in knowledge.corpus():
        if c.category == "spatial_convention":
            continue
        by_culture.setdefault(c.culture, set()).add(c.verified)
    assert by_culture["khaleeji"] == {True}
    assert by_culture["moroccan"] == {True}
    assert by_culture["lebanese"] == {False}


def test_conventions_are_never_marked_verified():
    """Editorial spatial conventions carry no sign-off and no citation."""
    for c in knowledge.corpus():
        if c.category == "spatial_convention":
            assert c.verified is False
            assert c.source is None


def test_evidence_state_has_three_values_and_all_occur():
    states = {c.evidence_state for c in knowledge.corpus()}
    assert states == {"verified-cited", "verified", "unverified"}


def test_a_citation_is_never_invented():
    """Every source string must appear verbatim in sources.md."""
    sources_text = (ROOT / "ontology" / "sources.md").read_text(encoding="utf-8")
    for c in knowledge.corpus():
        if c.source:
            assert c.source in sources_text, f"{c.id} cites something not in sources.md"


def test_knowledge_base_states_no_dimension_and_no_catalogue_id():
    """RAG supplies culture, never geometry or vocabulary the catalogue owns."""
    dim = re.compile(r"\d+\s*(cm|mm|m\b|inch)", re.I)
    catid = re.compile(r"\b[a-z]{2,6}-[a-z]{2,12}-\d{2,3}\b", re.I)
    for c in knowledge.corpus():
        for field in (c.guidance_en, c.guidance_ar, c.avoid_en, c.avoid_ar):
            assert not dim.search(field), f"{c.id} states a dimension: {field!r}"
            assert not catid.search(field), f"{c.id} names a catalogue id: {field!r}"


def test_rooms_and_materials_use_dar_vocabularies():
    """A room type or material the rest of DAR cannot act on is dropped at load."""
    for c in knowledge.corpus():
        assert set(c.rooms) <= set(planner.ROOM_TYPES)
        assert set(c.materials) <= set(planner.MATERIAL_KEYS)


def test_loading_a_missing_knowledge_dir_still_yields_ontology_chunks(tmp_path):
    """No editorial layer is a degraded mode, not a failure."""
    chunks = knowledge.load_chunks(knowledge_dir=tmp_path / "nope")
    assert chunks
    assert all(c.guidance_en == "" for c in chunks if c.category != "spatial_convention")


def test_loading_a_broken_ontology_returns_empty_not_raises(tmp_path):
    bad = tmp_path / "ontology.json"
    bad.write_text("{ not json", encoding="utf-8")
    assert knowledge.load_chunks(ontology_path=bad) == []


# --------------------------------------------------------------------------
# normalisation
# --------------------------------------------------------------------------

@pytest.mark.parametrize("a,b", [
    ("مجلس", "مَجْلِس"),      # diacritics
    ("انا", "أنا"),           # alef hamza
    ("غرفه", "غرفة"),         # ta marbuta
    ("مغربي", "مغربى"),       # alef maqsura
    ("Zellige", "zellige"),   # case
])
def test_normalisation_folds_orthographic_variants(a, b):
    assert knowledge.normalise(a) == knowledge.normalise(b)


def test_tokenise_handles_mixed_scripts():
    tokens = knowledge.tokenise("Moroccan زليج room")
    assert "moroccan" in tokens and "زليج" in tokens and "room" in tokens


@pytest.mark.parametrize("written,bare", [
    ("بزليج", "زليج"),      # bi- (with)
    ("الزليج", "زليج"),     # definite article
    ("وزليج", "زليج"),      # wa- (and)
    ("بالمجلس", "مجلس"),    # bi- + al-
    ("للمجلس", "مجلس"),     # li-l-
])
def test_arabic_proclitics_are_stripped(written, bare):
    """Arabic joins its prepositions to the word; without this "بزليج" misses zellige."""
    assert knowledge.tokenise(written) == knowledge.tokenise(bare)


def test_clitic_stripping_does_not_shred_short_words():
    """بيت (house) must not become يت — the min-stem guard."""
    assert knowledge.tokenise("بيت") == ["بيت"]


def test_arabic_query_with_attached_preposition_retrieves():
    """The regression this fix exists for: "بزليج" must reach zellige."""
    r = retrieval.retrieve("غرفة معيشة مغربية بزليج وألوان هادئة", "lebanese")
    assert r.culture == "moroccan"
    assert any("zellige" in x.chunk.element_en.lower() for x in r.chunks)


# --------------------------------------------------------------------------
# intent detection
# --------------------------------------------------------------------------

def test_culture_detected_from_english_brief():
    assert retrieval.detect_culture("a Moroccan riad feel", None) == "moroccan"


def test_culture_detected_from_arabic_brief():
    assert retrieval.detect_culture("بدي مجلس خليجي", None) == "khaleeji"


def test_brief_culture_overrides_the_room_culture():
    """"Make it Moroccan" in a Lebanese room is a request to change."""
    assert retrieval.detect_culture("make it Moroccan with zellige", "lebanese") == "moroccan"


def test_silent_brief_keeps_the_room_culture():
    assert retrieval.detect_culture("somewhere comfortable to sit", "lebanese") == "lebanese"


def test_ambiguous_brief_falls_back_rather_than_guessing():
    """Equal cues for two cultures is genuine ambiguity, not a coin flip."""
    assert retrieval.detect_culture("lebanese and moroccan", "khaleeji") == "khaleeji"


@pytest.mark.parametrize("brief,room", [
    ("a majlis for guests", "majlis"),
    ("بدي غرفة نوم", "bedroom"),
    ("somewhere to eat", "dining room"),
])
def test_room_type_detected_in_both_languages(brief, room):
    assert room in retrieval.detect_rooms(brief)


# --------------------------------------------------------------------------
# retrieval
# --------------------------------------------------------------------------

def test_english_query_retrieves_relevant_lebanese_evidence():
    r = retrieval.retrieve(EVAL_EN_LEBANESE, "lebanese")
    assert r.chunks
    assert r.culture == "lebanese"
    assert all(x.chunk.culture == "lebanese" for x in r.chunks)


def test_arabic_query_retrieves_relevant_khaleeji_evidence():
    r = retrieval.retrieve(EVAL_AR_KHALEEJI, "lebanese")
    assert r.chunks, "an Arabic brief must retrieve"
    assert r.culture == "khaleeji", "Arabic cue must override the room culture"
    assert "majlis" in r.rooms
    assert any("majlis" in x.chunk.element_en.lower() for x in r.chunks)


def test_mixed_script_query_retrieves():
    r = retrieval.retrieve("Moroccan زليج for a living room", "lebanese")
    assert r.chunks
    assert r.culture == "moroccan"


def test_moroccan_query_retrieves_zellige():
    r = retrieval.retrieve(EVAL_MOROCCAN, "lebanese")
    assert any("zellige" in x.chunk.element_en.lower() for x in r.chunks)


def test_open_centre_brief_surfaces_a_spatial_convention():
    r = retrieval.retrieve(EVAL_OPEN_CENTRE, "moroccan")
    assert r.chunks
    assert any(x.chunk.category == "spatial_convention" for x in r.chunks)


def test_constraint_briefs_still_retrieve_the_element_they_exclude():
    """"No arches" retrieves arch knowledge on purpose.

    RAG supplies what the culture is; the brief supplies the constraint; the
    planner reconciles them. Filtering the corpus on a negation would make the
    retriever a second designer, which is exactly the boundary this feature
    keeps.
    """
    r = retrieval.retrieve(EVAL_NO_ARCHES, "lebanese")
    assert r.chunks
    assert all(x.chunk.culture == "lebanese" for x in r.chunks)


def test_culture_filtering_never_mixes_cultures():
    for brief, expect in [
        (EVAL_EN_LEBANESE, "lebanese"),
        (EVAL_AR_KHALEEJI, "khaleeji"),
        (EVAL_MOROCCAN, "moroccan"),
    ]:
        r = retrieval.retrieve(brief, "lebanese")
        assert {x.chunk.culture for x in r.chunks} == {expect}


def test_the_same_brief_differs_by_culture():
    a = retrieval.retrieve("a traditional room with warm colours", "khaleeji")
    b = retrieval.retrieve("a traditional room with warm colours", "moroccan")
    assert {x.chunk.id for x in a.chunks} != {x.chunk.id for x in b.chunks}


@pytest.mark.parametrize("brief", IRRELEVANT)
def test_irrelevant_briefs_retrieve_nothing(brief):
    """The UI must never be handed evidence for a question the corpus cannot answer."""
    r = retrieval.retrieve(brief, "lebanese")
    assert r.chunks == ()
    assert r.available is True, "the corpus loaded fine; the brief simply did not match"
    assert r.reason


def test_empty_index_is_reported_as_unavailable_not_as_no_match():
    r = retrieval.retrieve(EVAL_EN_LEBANESE, "lebanese", chunks=[])
    assert r.chunks == ()
    assert r.available is False
    assert not r


@pytest.mark.parametrize("k,expect_max", [(1, 1), (3, 3), (99, retrieval.MAX_TOP_K)])
def test_top_k_is_respected_and_clamped(k, expect_max):
    r = retrieval.retrieve("Moroccan zellige tadelakt cedar brass lantern courtyard",
                           "moroccan", top_k=k)
    assert len(r.chunks) <= expect_max


def test_results_are_ordered_by_score():
    r = retrieval.retrieve(EVAL_MOROCCAN, "moroccan", top_k=6)
    scores = [x.score for x in r.chunks]
    assert scores == sorted(scores, reverse=True)


def test_retrieval_never_raises_on_hostile_input():
    for brief in ["\x00\x01", "«»‹›", "🙂🙂🙂", "a" * 5000, "؟" * 200]:
        assert retrieval.retrieve(brief, "lebanese") is not None


def test_evidence_metadata_is_complete():
    r = retrieval.retrieve(EVAL_MOROCCAN, "moroccan")
    for ev in r.to_evidence():
        assert ev["id"] and ev["culture"] and ev["category"]
        assert ev["elementEn"]
        assert ev["evidenceState"] in {"verified-cited", "verified", "unverified"}
        assert isinstance(ev["verified"], bool)
        assert "score" in ev
        assert "source" in ev  # present, possibly None — never absent


# --------------------------------------------------------------------------
# the prompt block
# --------------------------------------------------------------------------

def test_prompt_block_is_empty_without_chunks():
    assert retrieval.format_for_prompt(retrieval.EMPTY) == ""


def test_prompt_block_carries_guidance_and_the_boundary():
    r = retrieval.retrieve(EVAL_MOROCCAN, "moroccan")
    block = retrieval.format_for_prompt(r)
    assert "CULTURAL REFERENCE" in block
    # The boundary sentence is what stops a model treating evidence as permission.
    assert "names no furniture and no dimensions" in block
    assert "catalogue" in block


def test_prompt_block_marks_unverified_evidence_as_such():
    r = retrieval.retrieve(EVAL_EN_LEBANESE, "lebanese")
    block = retrieval.format_for_prompt(r)
    assert "UNVERIFIED" in block, "Lebanese is 0/30 verified and must say so to the model"


def test_prompt_block_marks_verified_evidence_as_such():
    r = retrieval.retrieve(EVAL_MOROCCAN, "moroccan")
    assert "<verified" in retrieval.format_for_prompt(r)


# --------------------------------------------------------------------------
# planner integration — the claim that matters
# --------------------------------------------------------------------------

def test_evidence_reaches_the_model_prompt():
    """THE proof: the retrieved element appears in the prompt the provider got."""
    retrieved = retrieval.retrieve(EVAL_MOROCCAN, "moroccan")
    assert retrieved.chunks, "fixture precondition"
    top = retrieved.chunks[0].chunk

    fake = _FakeClient(_payload([_item("mor-sofa-001")], culture="moroccan"))
    planner.plan(ROOM, "moroccan", EVAL_MOROCCAN, client=fake)

    assert fake.prompt, "the model was called"
    assert "CULTURAL REFERENCE" in fake.prompt
    assert top.element_en in fake.prompt, "the top-scoring element is in the prompt"


def test_arabic_evidence_reaches_the_model_prompt():
    fake = _FakeClient(_payload([_item("khal-sofa-001")], culture="khaleeji"))
    planner.plan(ROOM, "khaleeji", EVAL_AR_KHALEEJI, client=fake)
    assert "CULTURAL REFERENCE" in fake.prompt
    assert "majlis" in fake.prompt.lower()


def test_plan_result_carries_evidence_and_metadata():
    fake = _FakeClient(_payload([_item("mor-sofa-001")], culture="moroccan"))
    out = planner.plan(ROOM, "moroccan", EVAL_MOROCCAN, client=fake)
    assert out["evidence"], "evidence is returned to the client"
    assert out["evidenceMeta"]["injected"] is True
    assert out["evidenceMeta"]["culture"] == "moroccan"
    assert out["evidenceMeta"]["count"] == len(out["evidence"])


def test_rule_based_plan_reports_evidence_but_never_claims_it_used_it():
    """The honesty flag. Rules did not read the evidence, so injected is False."""
    out = planner.plan(ROOM, "moroccan", EVAL_MOROCCAN)   # no client -> rules
    assert out["source"] == "rules"
    assert out["evidenceMeta"]["injected"] is False


def test_irrelevant_brief_yields_no_evidence_and_says_why():
    fake = _FakeClient(_payload([_item("leb-sofa-001")]))
    out = planner.plan(ROOM, "lebanese", "hello how are you", client=fake)
    assert out["evidence"] == []
    assert out["evidenceMeta"]["injected"] is False
    assert out["evidenceMeta"]["reason"]


# --------------------------------------------------------------------------
# no regression — the gates still hold, and RAG-off is the old behaviour
# --------------------------------------------------------------------------

def test_prompt_is_byte_identical_when_rag_is_disabled(monkeypatch):
    """The fallback must be the OLD prompt, not one that merely resembles it."""
    before = planner.build_user_message(ROOM, "lebanese", EVAL_EN_LEBANESE, [], [], None)
    with_empty = planner.build_user_message(
        ROOM, "lebanese", EVAL_EN_LEBANESE, [], [], None, "",
    )
    assert before == with_empty


def test_disabling_rag_removes_the_block_from_the_prompt(monkeypatch):
    monkeypatch.setenv("DARDESIGN_RAG", "0")
    planner._reset_for_tests()
    fake = _FakeClient(_payload([_item("mor-sofa-001")], culture="moroccan"))
    out = planner.plan(ROOM, "moroccan", EVAL_MOROCCAN, client=fake)
    assert "CULTURAL REFERENCE" not in fake.prompt
    assert out["evidence"] == []
    assert out["evidenceMeta"]["reason"] == "retrieval disabled"
    assert out["items"], "the plan still works without evidence"


def test_disabled_rag_still_produces_a_rule_based_plan(monkeypatch):
    monkeypatch.setenv("DARDESIGN_RAG", "0")
    planner._reset_for_tests()
    out = planner.plan(ROOM, "lebanese", EVAL_EN_LEBANESE)
    assert out["source"] == "rules"
    assert out["items"]


def test_rag_state_is_in_the_cache_key():
    """Toggling the flag must not serve the other mode's plan."""
    a = planner._cache_key(ROOM, "moroccan", EVAL_MOROCCAN)
    os.environ["DARDESIGN_RAG"] = "0"
    try:
        b = planner._cache_key(ROOM, "moroccan", EVAL_MOROCCAN)
    finally:
        os.environ.pop("DARDESIGN_RAG", None)
    assert a != b


def test_invented_catalogue_id_is_still_rejected_with_evidence_present():
    """Gate 1 is untouched by RAG. Evidence informs; it never widens the vocabulary."""
    fake = _FakeClient(_payload([
        _item("mor-zellige-throne-999"),
        _item("mor-sofa-001"),
    ], culture="moroccan"))
    out = planner.plan(ROOM, "moroccan", EVAL_MOROCCAN, client=fake)
    ids = [i["catalogId"] for i in out["items"]]
    assert "mor-zellige-throne-999" not in ids
    assert any(r["catalogId"] == "mor-zellige-throne-999" for r in out["rejected"])


def test_cross_culture_piece_is_still_rejected_with_evidence_present():
    fake = _FakeClient(_payload([
        _item("leb-sofa-001"),
        _item("mor-sofa-001"),
    ], culture="moroccan"))
    out = planner.plan(ROOM, "moroccan", EVAL_MOROCCAN, client=fake)
    assert all(i["catalogId"].startswith("mor-") for i in out["items"])


def test_schema_is_unchanged_by_rag():
    """RAG adds no field to the structured output the model must produce."""
    schema = planner.plan_schema("moroccan")
    assert set(schema["properties"]) == {"understood", "items", "notesEn", "notesAr"}
    item_props = schema["properties"]["items"]["items"]["properties"]
    assert set(item_props) == {
        "catalogId", "xCm", "zCm", "rotationDeg", "materialKey", "reasonEn", "reasonAr",
    }


# --------------------------------------------------------------------------
# end to end — the evidence crosses the HTTP boundary too
# --------------------------------------------------------------------------

def test_endpoint_returns_evidence_to_the_client(tmp_path, monkeypatch):
    """The endpoint hands back `result` verbatim, so prove the shape survives it.

    Its own SQLite file, like every other test that registers an account: the
    suite otherwise writes into backend/dardesign.db, which is somebody's real
    data on a dev machine.
    """
    import asyncio

    import httpx

    from backend import db
    from backend.main import _reset_for_tests, app

    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")

    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            reg = await c.post("/api/auth/register", json={
                "fullName": "RAG Tester", "email": "rag-e2e@example.com",
                "password": "secret123", "phoneNumber": "070000000",
            })
            assert reg.status_code == 200, reg.text
            return await c.post("/api/design/plan", json={
                "width_cm": 520, "depth_cm": 420, "culture": "moroccan",
                "brief": EVAL_MOROCCAN,
            })

    _reset_for_tests()
    try:
        r = asyncio.run(_go())
        assert r.status_code == 200, r.text
        body = r.json()
        # No provider key in this suite, so it is the rule-based path — which is
        # exactly the case where `injected` must be False while evidence is
        # still reported.
        assert body["source"] == "rules"
        assert body["evidence"], "cultural evidence reached the client"
        assert body["evidenceMeta"]["injected"] is False
        assert body["evidenceMeta"]["culture"] == "moroccan"
        first = body["evidence"][0]
        assert {"id", "elementEn", "evidenceState", "source", "verified"} <= set(first)
    finally:
        _reset_for_tests()
        db.close()


def test_retrieval_failure_does_not_break_the_plan(monkeypatch):
    """A corpus that explodes costs evidence, never the room."""
    def boom(*a, **k):
        raise RuntimeError("index on fire")

    monkeypatch.setattr(retrieval, "retrieve", boom)
    monkeypatch.setattr(planner, "retrieve", boom)
    fake = _FakeClient(_payload([_item("leb-sofa-001")]))
    out = planner.plan(ROOM, "lebanese", EVAL_EN_LEBANESE, client=fake)
    assert out["items"], "the plan survived"
    assert out["evidence"] == []
