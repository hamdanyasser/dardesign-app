"""Catalogue integrity + the whole placement workflow, run against the new pieces.

Two halves, and the split matters:

  * The integrity half reads `ontology/furniture.json` and the shipped PNGs
    directly — that an entry has a picture, that the picture is a trimmed
    transparent cut-out, and that the box the engine builds from the two
    describes furniture rather than something 2.7 m tall.

  * The workflow half drives the real pipeline — recommend → candidate position →
    validate → move → resize → composite — for one new item per culture against a
    synthetic room. The room is the only construction: it is built by hand from
    the five masks `analyze_room()` produces, because deriving them for real needs
    the depth and segmentation models, i.e. a GPU. Everything downstream of those
    masks is the shipped code operating on the shipped assets.

GPU NOT NEEDED.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import furniture
from backend.compositing import composite_item
from backend.furniture import CULTURES, CatalogueError, recommend
from backend.placement import (
    Box,
    box_to_image_space,
    box_to_mask_space,
    candidate_positions,
    validate_placement,
)
from backend.room_analysis import ADE_TO_CATEGORY, CandidateSpot, RoomAnalysis

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = json.loads((ROOT / "ontology" / "furniture.json").read_text(encoding="utf-8"))
ITEMS: list[dict] = CATALOGUE["items"]

ID_PREFIX = {"lebanese": "leb-", "khaleeji": "khal-", "moroccan": "mor-"}

# The pieces added in catalogue v0.2. Listed explicitly rather than derived, so
# that "did the expansion survive?" is a question this file answers by itself.
NEW_IDS = {
    "leb-armchair-001", "leb-console-001", "leb-ottoman-001", "leb-screen-001",
    "khal-armchair-001", "khal-console-001", "khal-ottoman-001", "khal-cabinet-001",
    "mor-sofa-001", "mor-armchair-001", "mor-cabinet-001", "mor-console-001",
}
# Everything that shipped in v0.1 — these must keep working untouched.
ORIGINAL_IDS = {i["id"] for i in ITEMS} - NEW_IDS

REQUIRED_KEYS = (
    "id", "culture", "category", "name_en", "name_ar",
    "description_en", "description_ar", "asset", "placement_type", "room_types",
    "real_width_cm", "real_height_cm", "real_depth_cm", "floor_footprint_cm",
    "must_touch_wall", "must_stand_on_floor", "preferred_zones",
    "cultural_tags", "material_tags", "color_tags", "generation_prompt",
)


def _ids(items) -> set[str]:
    return {i["id"] for i in items}


# ===========================================================================
#  Catalogue integrity — every entry, rendered or not
# ===========================================================================

def test_catalogue_has_eight_to_ten_items_per_culture():
    for culture in CULTURES:
        n = len([i for i in ITEMS if i["culture"] == culture])
        assert 8 <= n <= 10, f"{culture} has {n} items, expected 8-10"


def test_item_ids_are_unique():
    ids = [i["id"] for i in ITEMS]
    assert len(ids) == len(set(ids)), "duplicate furniture ids in the catalogue"


def test_original_items_were_not_removed_or_altered():
    """Backward compatibility: v0.1 ids all still resolve, with their assets intact."""
    present = _ids(ITEMS)
    assert ORIGINAL_IDS <= present, f"missing: {sorted(ORIGINAL_IDS - present)}"
    for item_id in sorted(ORIGINAL_IDS):
        item = furniture.get_item(item_id)
        assert (ROOT / "public" / item["asset"]).is_file(), f"{item_id} lost its PNG"


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_item_has_every_required_key(item):
    missing = [k for k in REQUIRED_KEYS if k not in item]
    assert not missing, f"{item['id']} is missing {missing}"


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_id_culture_and_asset_path_agree(item):
    culture = item["culture"]
    assert culture in CULTURES
    assert item["id"].startswith(ID_PREFIX[culture]), (
        f"{item['id']} does not use the {culture} prefix {ID_PREFIX[culture]!r}"
    )
    # The generator, the variant picker and the compositor each rebuild this path
    # from the id and the culture, so a hand-written `asset` that disagrees would
    # only surface as a missing file at insertion time.
    assert item["asset"] == f"furniture/{culture}/{item['id']}.png"


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_placement_metadata_is_valid(item):
    assert item["placement_type"] in CATALOGUE["placement_types"]
    # v1 through v0.2 is floor-standing only; the other placement types are
    # documented but have no geometry behind them yet.
    assert item["placement_type"] == "floor_standing"
    assert item["must_stand_on_floor"] is True
    assert isinstance(item["must_touch_wall"], bool)

    zones = set(item["preferred_zones"])
    assert zones, f"{item['id']} has no preferred zones"
    unknown = zones - set(CATALOGUE["zones"])
    assert not unknown, f"{item['id']} references unknown zones {sorted(unknown)}"

    assert item["room_types"], f"{item['id']} lists no room types"


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_dimensions_are_plausible_and_self_consistent(item):
    w, h, d = item["real_width_cm"], item["real_height_cm"], item["real_depth_cm"]
    for name, v in (("width", w), ("height", h), ("depth", d)):
        assert isinstance(v, (int, float)) and 20 <= v <= 300, (
            f"{item['id']} has an implausible {name}: {v} cm"
        )
    # The footprint is the width x depth rectangle on the floor. The recommender
    # derives area from it and the placement engine derives the box from width and
    # height, so the two must describe the same object.
    assert item["floor_footprint_cm"] == [w, d], (
        f"{item['id']} footprint {item['floor_footprint_cm']} != [width, depth] [{w}, {d}]"
    )


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_bilingual_text_is_present(item):
    for key in ("name_en", "name_ar", "description_en", "description_ar"):
        assert item[key].strip(), f"{item['id']}.{key} is empty"
    for key in ("name_ar", "description_ar"):
        assert any("؀" <= c <= "ۿ" for c in item[key]), (
            f"{item['id']}.{key} contains no Arabic"
        )


def test_no_prompt_is_longer_than_the_ones_already_proven():
    """CLIP truncates at 77 tokens, and every prompt here already exceeds it.

    The asset generator sends `<generation_prompt>, <trigger>, <STYLE_SUFFIX>`,
    which measures 91-99 CLIP tokens for the 15 items that rendered correctly —
    so roughly the last 20 are already being dropped, and what falls off the end
    is the quality boilerplate ("sharp focus, high detail, e-commerce catalogue
    photography"). That is survivable, and proven so.

    What must not happen is a *longer* prompt pushing the framing instructions off
    the end too — "the entire object visible and centered" is what stops SDXL
    cropping the piece, and a cropped asset composites into a room as a cut-off
    object. So the ceiling is the longest prompt that has actually worked, not
    the token limit.

    Measured with the same CLIP BPE tokenizer the pipeline uses. Skipped rather
    than failed when open_clip is absent, since it is an optional dependency.
    """
    open_clip = pytest.importorskip(
        "open_clip", reason="open_clip not installed — prompt length unmeasurable"
    )
    from open_clip.tokenizer import SimpleTokenizer

    tokenizer = SimpleTokenizer()

    def tokens(text: str) -> int:
        return len(tokenizer.encode(text)) + 2  # + <start> and <end>

    # Kept in step with scripts/generate_furniture_assets.py by the assertion
    # below, which fails if the two ever drift apart.
    suffix = (
        "isolated product photograph on a seamless pure white studio backdrop, "
        "no wall behind it, no floor beneath it, no room, no background scenery, "
        "single object completely cut out against flat white, three-quarter view, "
        "the entire object visible and centered, soft even studio lighting, "
        "no cast shadow, sharp focus, high detail, e-commerce catalogue photography"
    )
    generator = (ROOT / "scripts" / "generate_furniture_assets.py").read_text(
        encoding="utf-8"
    )
    assert "e-commerce catalogue photography" in generator, (
        "STYLE_SUFFIX moved — update this test's copy of it"
    )

    CEILING = 99  # the longest prompt among the 15 items that rendered correctly
    over = {
        item["id"]: tokens(
            f'{item["generation_prompt"]}, dardesign-{item["culture"]} style, {suffix}'
        )
        for item in ITEMS
    }
    too_long = {k: v for k, v in over.items() if v > CEILING}
    assert not too_long, (
        f"prompt(s) longer than any that has been proven to render ({CEILING} "
        f"tokens): {too_long}. Shorten the generation_prompt — the extra words "
        f"do not reach the model, they only push the framing instructions off it."
    )


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_generation_prompt_asks_for_one_isolated_object(item):
    prompt = item["generation_prompt"]
    assert prompt.strip()
    # The asset pipeline appends its own product-shot framing and negatives; the
    # per-item prompt's job is the object and its cultural specifics. "a single"
    # is what keeps SDXL from rendering a matching set, which cuts out as one
    # blob and composites three chairs where the user placed one.
    assert prompt.lower().startswith("a single "), (
        f"{item['id']} prompt should start with 'a single ': {prompt!r}"
    )


# Tags the recommender and a design agent read as "this piece belongs to that
# culture". Lebanese pieces are tagged by region rather than by nation state,
# which is how the ontology already describes them.
CULTURE_MARKERS = {
    "lebanese": {"levantine", "damascene", "beiti"},
    "khaleeji": {"khaleeji", "gulf", "majlis", "gulf_luxury"},
    "moroccan": {"moroccan", "andalusian", "marrakech"},
}


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_tags_are_non_empty_and_name_the_culture(item):
    for key in ("cultural_tags", "material_tags", "color_tags"):
        assert item[key], f"{item['id']}.{key} is empty"
    markers = CULTURE_MARKERS[item["culture"]]
    assert markers & set(item["cultural_tags"]), (
        f"{item['id']} carries no {item['culture']} marker "
        f"(one of {sorted(markers)}): {item['cultural_tags']}"
    )


def test_color_tags_are_drawn_from_the_shared_vocabulary():
    """Mood presets key off colour tags, so an invented one is dead weight.

    A tag no preset mentions costs nothing at ranking time, but it also does
    nothing — and the whole point of the vocabulary is that "warm" means the same
    thing across all three cultures. Everything in use is listed here so adding a
    genuinely new colour is a decision rather than a typo.
    """
    KNOWN = {
        "amber", "beige", "blue", "brass_gold", "clear", "cream", "dark_wood",
        "gold", "ivory", "natural", "neutral", "ochre", "pale_stone", "tan",
        "terracotta", "warm_brown", "warm_metal", "white", "white_marble",
    }
    used = {t for i in ITEMS for t in i["color_tags"]}
    assert used <= KNOWN, f"colour tags outside the vocabulary: {sorted(used - KNOWN)}"


def test_no_duplicate_pieces_within_a_culture():
    """Two items of the same culture must not be the same piece twice."""
    seen: dict[tuple[str, str], str] = {}
    for item in ITEMS:
        key = (item["culture"], item["name_en"].lower())
        assert key not in seen, f"{item['id']} duplicates {seen[key]}"
        seen[key] = item["id"]

    # A culture may hold two items of one category (a dining chair and an
    # armchair), but not two with the same category *and* the same materials —
    # that is the same object described twice.
    fingerprints: dict[tuple, str] = {}
    for item in ITEMS:
        key = (item["culture"], item["category"], tuple(sorted(item["material_tags"])))
        assert key not in fingerprints, (
            f"{item['id']} is near-identical to {fingerprints[key]}"
        )
        fingerprints[key] = item["id"]


def test_every_culture_covers_the_core_living_room_categories():
    """The point of the expansion: no culture is missing a way to sit or a table."""
    for culture in CULTURES:
        cats = {i["category"] for i in ITEMS if i["culture"] == culture}
        assert {"sofa", "armchair"} <= cats, f"{culture} lacks seating: {sorted(cats)}"
        assert {"coffee_table", "side_table", "console"} <= cats, (
            f"{culture} lacks table surfaces: {sorted(cats)}"
        )
        assert cats & {"lamp", "lantern"}, f"{culture} has no light source"
        assert cats & {"ottoman"}, f"{culture} has no ottoman/pouf"


def test_catalogue_categories_use_the_room_analyser_s_spelling():
    """A category the analyser cannot name is a category that never de-duplicates.

    `existing_categories` arrives in ADE20K's vocabulary translated through
    ADE_TO_CATEGORY, and the recommender compares it to `category` by string
    equality — so "arm_chair" or "coffee table" would score as though the room
    contained no such thing, forever and silently.

    These five have no ADE class at all, which is a deliberate and harmless state
    the catalogue already relied on before this expansion — `lantern` and
    `cultural_object` were in it from the start. They simply never take the
    duplicate penalty. (ADE does have an armchair class, but it is mapped to
    "sofa"; rather than change that mapping and alter how sofas are ranked in
    every existing room, `armchair` joins the group that does not de-duplicate.)
    Anything *else* falling out of the analyser's vocabulary is a typo, and this
    is where it gets caught.
    """
    NO_ADE_CLASS = {"lantern", "cultural_object", "armchair", "console", "screen"}
    catalogue_cats = {i["category"] for i in ITEMS}
    unnameable = catalogue_cats - set(ADE_TO_CATEGORY.values())
    assert unnameable == NO_ADE_CLASS, (
        "category the room analyser cannot report, so it will never be "
        f"de-duplicated: {sorted(unnameable - NO_ADE_CLASS)}"
    )


# ===========================================================================
#  Assets
# ===========================================================================

@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_every_entry_ships_with_its_png(item):
    """A catalogue entry and its picture land together, or the entry is broken.

    Nothing at runtime hides an entry whose asset is missing: the panel would show
    a broken card and the compositor would fail at insertion. So the invariant is
    enforced here instead, where it costs a failing test rather than a failed demo.
    """
    path = ROOT / "public" / item["asset"]
    assert path.is_file(), (
        f"{item['id']} has no render at {item['asset']}. Generate it with "
        f"scripts/generate_furniture_assets.py, then promote a variant with "
        f"scripts/pick_furniture_variants.py --apply."
    )


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_asset_is_a_usable_transparent_cutout(item):
    """Trimmed to the object, RGBA, and actually transparent at the corners.

    The compositor resizes the PNG into the placement box, so leftover transparent
    margin would shrink the furniture by an arbitrary per-item amount, and an
    opaque background would paste a white rectangle into the room.
    """
    with Image.open(ROOT / "public" / item["asset"]) as im:
        assert im.mode == "RGBA", f"{item['id']} is {im.mode}, not RGBA"
        alpha = np.asarray(im.convert("RGBA"))[..., 3]

    assert alpha.max() > 200, f"{item['id']} is fully transparent"

    # Trimmed: the object must fill its own canvas. trim_to_content keeps a
    # 2 px border so anti-aliased edges survive the crop, so the tolerance is
    # that padding plus a pixel — not zero.
    H, W = alpha.shape
    ys, xs = np.where(alpha > 8)
    margins = {
        "left": int(xs.min()), "top": int(ys.min()),
        "right": W - 1 - int(xs.max()), "bottom": H - 1 - int(ys.max()),
    }
    slack = {k: v for k, v in margins.items() if v > 3}
    assert not slack, (
        f"{item['id']} has untrimmed transparent margin {slack}. The compositor "
        f"fits the PNG into a box sized from real-world centimetres, so padding "
        f"shrinks the furniture by an arbitrary amount. Re-run the cutout stage."
    )

    # ...and it has to actually be a cut-out. A fully opaque image would paste a
    # rectangle of studio backdrop into the room.
    assert float((alpha < 8).mean()) > 0.02, (
        f"{item['id']} is {100 * float((alpha >= 8).mean()):.0f}% opaque — "
        f"the background was not removed"
    )


@pytest.mark.parametrize("item", ITEMS, ids=lambda i: i["id"])
def test_asset_renders_at_a_plausible_physical_size(item):
    """The box the placement engine builds must describe real furniture.

    It preserves the declared footprint *area* while adopting the asset's aspect,
    so a mismatch between the two is shared across width and height rather than
    distorting one. That is tolerant, but not unbounded: leb-screen-001 was
    written at its laid-flat width against a photo of it folded, and came out
    2.7 m tall — above ceiling height, and unplaceable in any real room.
    """
    aspect = furniture.item_aspect(item)
    w, h = item["real_width_cm"], item["real_height_cm"]
    eff_w = math.sqrt(w * h * aspect)
    eff_h = eff_w / aspect
    assert 25 <= eff_w <= 280, f"{item['id']} renders {eff_w:.0f} cm wide"
    assert 25 <= eff_h <= 220, f"{item['id']} renders {eff_h:.0f} cm tall"


def test_normalize_room_type_allowlists_catalogue_vocabulary():
    for room_type in ("living_room", "majlis", "dining_room", "hallway", "bedroom"):
        assert furniture.normalize_room_type(room_type) == room_type
    assert furniture.normalize_room_type("living room") == "living_room"
    assert furniture.normalize_room_type("Dining-Room") == "dining_room"
    assert furniture.normalize_room_type("spaceship") is None


def test_unknown_culture_is_rejected():
    with pytest.raises(CatalogueError):
        furniture.items_for_culture("klingon")
    with pytest.raises(CatalogueError):
        furniture.get_item("leb-nonexistent-999")


def make_room() -> RoomAnalysis:
    """A synthetic 384x384 room: wall above, floor below, one sofa, one doorway.

    Built by hand rather than by running analyze_room(), which needs depth and
    segmentation models — i.e. a GPU. The masks are the analyser's only output the
    placement engine reads, so constructing them directly tests the same code the
    real pipeline runs.
    """
    H = W = 384
    floor = np.zeros((H, W), dtype=bool)
    floor[210:, :] = True

    wall = np.zeros((H, W), dtype=bool)
    wall[:210, :] = True

    occupied = np.zeros((H, W), dtype=bool)
    occupied[250:330, 275:375] = True          # an existing sofa, right of frame

    protected = np.zeros((H, W), dtype=bool)
    protected[120:290, 20:70] = True           # a doorway, left of frame

    # That leaves roughly x=70..275 of clear wall. The widest catalogue piece is
    # a 220 cm sofa, which renders about 175 px here — so it fits, with enough
    # margin to survive the 10% enlarge the UI offers. A tighter room would make
    # these tests assert that the room is small rather than that the engine works.

    free = floor & ~occupied & ~protected

    # 0 = nearest the camera (bottom of frame), 1 = farthest (top).
    depth = np.tile(np.linspace(1.0, 0.0, H, dtype=np.float32)[:, None], (1, W))

    candidates = [
        CandidateSpot(cx=0.42, cy=0.90, clearance_px=70.0, depth=0.06, max_width_cm=240.0),
        CandidateSpot(cx=0.55, cy=0.82, clearance_px=55.0, depth=0.15, max_width_cm=200.0),
        CandidateSpot(cx=0.30, cy=0.78, clearance_px=48.0, depth=0.20, max_width_cm=180.0),
    ]

    return RoomAnalysis(
        floor_mask=floor, wall_mask=wall, occupied_mask=occupied,
        protected_mask=protected, free_floor_mask=free, depth_norm=depth,
        free_floor_ratio=float(free.mean()),
        free_floor_of_floor=float(free.sum() / floor.sum()),
        free_floor_m2=18.0,
        px_per_cm=0.6, reference_depth=0.5, scale_confidence=0.8,
        existing_categories=["sofa"],
        candidates=candidates,
    )


# One newly added piece per culture, chosen to be genuinely different shapes:
# a wide wall-hugging sofa, a tall armchair, a long shallow console.
WORKFLOW_ITEMS = ["mor-sofa-001", "khal-armchair-001", "leb-console-001"]


# ===========================================================================
#  Recommendation → selection
# ===========================================================================

def test_new_items_are_recommended_once_rendered():
    for culture in CULTURES:
        offered = _ids(furniture.items_for_culture(culture))
        expected = {i["id"] for i in ITEMS if i["culture"] == culture}
        assert offered == expected, f"{culture}: {sorted(expected - offered)} not offered"
        assert len(offered) >= 8


def test_recommend_filters_by_culture_and_ranks():
    recs = recommend("moroccan", room_type="living_room", free_floor_m2=18.0)
    assert recs, "no recommendations returned"
    assert all(r.item["culture"] == "moroccan" for r in recs)
    assert all(r.reasons for r in recs), "a recommendation with no stated reason"
    scores = [r.score for r in recs]
    assert scores == sorted(scores, reverse=True), "results are not ranked"


def test_recommend_penalises_a_category_the_room_already_has():
    """The new categories de-duplicate like every other item.

    The caller supplies `existing_categories` — from the room analyser in the app,
    from anywhere in principle — so this is the recommender's own rule, tested
    independently of which ADE classes happen to be detectable.
    """
    without = {r.item["id"]: r.score for r in recommend("khaleeji", room_type="majlis")}
    with_one = {
        r.item["id"]: r.score
        for r in recommend("khaleeji", room_type="majlis", existing_categories=["armchair"])
    }
    assert "khal-armchair-001" in without
    if "khal-armchair-001" in with_one:
        assert with_one["khal-armchair-001"] < without["khal-armchair-001"]
    # Either way it must have lost its place at the top of the list.
    assert max(with_one, key=with_one.get) != "khal-armchair-001" or len(with_one) == 1


def test_a_whole_culture_is_offered_not_a_shortlist_of_it():
    """MAX_RESULTS must keep pace with the catalogue.

    It was 6 when a culture held 5 pieces, so it never bit. At 9 per culture a
    stale cap silently hides a third of every one of them — and a design agent
    reading /recommendations has no way to know it is seeing part of a catalogue.
    """
    assert furniture.MAX_RESULTS >= max(
        len([i for i in ITEMS if i["culture"] == c]) for c in CULTURES
    )
    for culture in CULTURES:
        recs = recommend(culture, room_type="living_room")
        assert len(recs) == len([i for i in ITEMS if i["culture"] == culture])


@pytest.mark.parametrize("culture", CULTURES)
def test_every_reason_is_given_in_both_languages(culture):
    """A justification in one language is a blank space in the other."""
    for r in recommend(culture, room_type="living_room", existing_categories=["sofa"],
                       free_floor_m2=9.0, room_materials=["wood"], mood="warm"):
        assert r.reasons, f"{r.item['id']} has no stated reason"
        assert len(r.reasons) == len(r.reasons_ar), f"{r.item['id']} reasons out of step"
        for en, ar in zip(r.reasons, r.reasons_ar):
            assert en.strip() and ar.strip()
            assert any("؀" <= c <= "ۿ" for c in ar), f"{r.item['id']}: {ar!r} is not Arabic"
        payload = r.to_dict()
        assert payload["reasons"] == r.reasons
        assert payload["reasons_ar"] == r.reasons_ar


def test_the_headline_reason_is_the_distinguishing_one():
    """The card shows reasons[0], so it must not be what every piece shares.

    Room-type fit is true of nearly the whole culture; printing it on all nine
    cards tells the user nothing. A size warning outranks everything, because it
    is the one reason that argues *against* the piece.
    """
    recs = recommend("lebanese", room_type="living_room",
                     existing_categories=["chair", "sofa"], free_floor_m2=9.0)
    headlines = {r.reasons[0] for r in recs}
    assert headlines != {"suits a living room"}, "every card would read the same line"
    for r in recs:
        if len(r.reasons) > 1:
            assert r.reasons[0] != "suits a living room", (
                f"{r.item['id']} leads with the reason its whole culture shares"
            )

    tiny = recommend("moroccan", room_type="living_room", free_floor_m2=0.4)
    oversized = [r for r in tiny if "too large" in " ".join(r.reasons)]
    assert oversized, "nothing was flagged as too large for a 0.4 m2 room"
    for r in oversized:
        assert r.reasons[0] == "may be too large for the free floor area"


# ===========================================================================
#  Candidate positions → validation → move → resize → confirm
# ===========================================================================

@pytest.mark.parametrize("item_id", WORKFLOW_ITEMS)
def test_new_item_runs_the_whole_placement_workflow(item_id):
    room = make_room()
    item = furniture.get_item(item_id)

    # --- candidate positions ---
    spots = candidate_positions(room, item, limit=3)
    assert spots, f"{item_id}: no candidate position found in a room with open floor"
    assert all(s.valid for s in spots), "candidate_positions returned an invalid spot"
    best = spots[0]

    # --- the engine's own proposal must survive the validator ---
    again = validate_placement(room, item, best.box)
    assert again.valid, f"{item_id}: proposed spot rejected on re-validation: {again.reason_en}"

    # --- move: drag along the floor and re-validate ---
    # Both directions are tried and only one has to hold. A 220 cm sofa spans
    # nearly half this room, so nudging it 25 px toward the doorway legitimately
    # blocks the door — the engine is right to refuse, and demanding that every
    # direction stay valid would be testing the room, not the drag.
    verdicts = {
        dx: validate_placement(
            room, item, Box(x=best.box.x + dx, y=best.box.y, w=best.box.w, h=best.box.h)
        )
        for dx in (-25, 25)
    }
    assert any(v.valid for v in verdicts.values()), (
        f"{item_id}: no 25px drag along open floor stayed valid — "
        + "; ".join(f"{dx:+}: {v.reason_en}" for dx, v in verdicts.items())
    )

    # --- resize: the UI's Smaller/Larger buttons, base kept on the floor ---
    for factor in (0.9, 1.1):
        w = best.box.w * factor
        h = best.box.h * factor
        resized = Box(
            x=best.box.x + (best.box.w - w) / 2,
            y=best.box.y + (best.box.h - h),
            w=w, h=h,
        )
        verdict = validate_placement(room, item, resized)
        assert verdict.valid, f"{item_id}: resize x{factor} rejected: {verdict.reason_en}"

    # --- confirm: composite into the room ---
    base = Image.new("RGB", (384, 384), (90, 80, 70))
    result = composite_item(base, item, best.box, analysis=room)
    assert result.image.size == base.size, "compositing changed the room's dimensions"
    assert np.asarray(result.image).tobytes() != np.asarray(base).tobytes(), (
        "compositing produced an unchanged image"
    )
    assert 0.5 < result.applied_brightness < 1.7


@pytest.mark.parametrize("item_id", sorted(ORIGINAL_IDS))
def test_original_items_still_place(item_id):
    """Regression guard: the v0.1 catalogue behaves exactly as before."""
    room = make_room()
    item = furniture.get_item(item_id)
    spots = candidate_positions(room, item, limit=3)
    assert spots, f"{item_id} lost its ability to be placed"
    assert validate_placement(room, item, spots[0].box).valid


@pytest.mark.parametrize("item_id", WORKFLOW_ITEMS)
def test_invalid_positions_are_rejected_with_the_right_reason(item_id):
    room = make_room()
    item = furniture.get_item(item_id)
    base = candidate_positions(room, item, limit=1)[0].box

    # Up the wall — the base is no longer on the floor.
    in_wall = Box(x=base.x, y=20, w=base.w, h=base.h)
    v = validate_placement(room, item, in_wall)
    assert not v.valid and v.reason_en in {
        "Invalid position: the item overlaps a wall.",
        "Invalid position: insufficient visible floor area — the item would float.",
    }, v.reason_en

    # Standing on the existing sofa.
    on_sofa = Box(x=270, y=330 - base.h, w=base.w, h=base.h)
    v = validate_placement(room, item, on_sofa)
    assert not v.valid, "an item standing on the existing sofa was accepted"

    # Blocking the doorway.
    in_door = Box(x=25, y=290 - base.h, w=base.w, h=base.h)
    v = validate_placement(room, item, in_door)
    assert not v.valid, "an item blocking the doorway was accepted"

    # Off the canvas, and absurdly large.
    assert not validate_placement(room, item, Box(x=-40, y=base.y, w=base.w, h=base.h)).valid
    assert not validate_placement(room, item, Box(x=5, y=5, w=380, h=370)).valid

    # Every rejection has to be sayable in both languages.
    assert v.reason_en and v.reason_ar


@pytest.mark.parametrize("item_id", WORKFLOW_ITEMS)
def test_rejections_are_bilingual(item_id):
    room = make_room()
    item = furniture.get_item(item_id)
    v = validate_placement(room, item, Box(x=10, y=10, w=60, h=60))
    assert not v.valid
    assert v.reason_ar and any("؀" <= c <= "ۿ" for c in v.reason_ar)


def test_mask_and_image_space_conversions_are_inverses():
    """The client draws in render pixels, the engine judges in mask pixels."""
    mask_shape = (384, 384)
    target = (1024, 680)
    box = Box(x=120.0, y=200.0, w=90.0, h=140.0)
    there = box_to_image_space(box, mask_shape, target)
    back = box_to_mask_space(there, mask_shape, target)
    for a, b in ((box.x, back.x), (box.y, back.y), (box.w, back.w), (box.h, back.h)):
        assert abs(a - b) < 1e-6, f"round trip drifted: {a} -> {b}"


def test_a_piece_too_big_for_the_room_reports_no_space_rather_than_forcing_it():
    """An honest empty answer, not a chair inside a wall."""
    room = make_room()
    # Leave a single narrow strip of free floor; the widest new pieces cannot fit
    # their walking margin into it.
    room.free_floor_mask[:, :] = False
    room.free_floor_mask[360:370, 180:200] = True
    room.candidates = [
        CandidateSpot(cx=0.49, cy=0.96, clearance_px=8.0, depth=0.02, max_width_cm=20.0)
    ]
    room.floor_mask[:, :] = False
    room.floor_mask[355:375, 175:205] = True

    spots = candidate_positions(room, furniture.get_item("mor-sofa-001"), limit=3)
    assert spots == [], "a 220cm sofa was placed into a 20cm gap"
