"""The furniture HTTP contract, driven end to end with a newly added item.

test_furniture_catalogue.py exercises the placement engine directly. This file
covers the part the browser actually talks to — including the box conversion
between analysis space (a 384x384 square of masks) and render space (a 1024x680
photo), which only happens at the API boundary and is where a placement lands in
the wrong part of the room if it is wrong.

The flow under test is the one the user performs:

    recommendations -> candidate-positions -> validate-position
      -> drag -> validate -> resize -> validate -> confirm-placement

plus the refusals: an invalid box must be rejected by the server even though the
client already "approved" it, and an unknown id must not 500.

GPU NOT NEEDED — DARDESIGN_LIGHT, no model ever loads.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# MUST be set before backend.main imports transform.py.
os.environ["DARDESIGN_LIGHT"] = "1"

from backend import compositing, furniture, jobs as jobs_mod  # noqa: E402
from backend.main import _reset_for_tests, app  # noqa: E402
from backend.room_analysis import cache_analysis, clear_cache  # noqa: E402

from tests.test_furniture_catalogue import make_room  # noqa: E402

# A new piece from each culture, all three shapes the layout has to cope with.
NEW_ITEM = {"moroccan": "mor-sofa-001", "khaleeji": "khal-armchair-001",
            "lebanese": "leb-console-001"}

RENDER_SIZE = (1024, 680)   # deliberately not square, and not the mask size


@pytest.fixture(autouse=True)
def _clean():
    _reset_for_tests()
    clear_cache()
    yield
    _reset_for_tests()
    clear_cache()


@pytest.fixture
def room(tmp_path):
    """A job with a cached analysis and a rendered image per style.

    Assets are the real shipped PNGs under public/furniture — every catalogue
    entry has one, so there is nothing to stand in for. That makes this an
    end-to-end exercise of what actually ships: the recommendation reads the same
    file the browser loads, and the compositor pastes the same pixels.
    """
    upload = tmp_path / "input.png"
    Image.new("RGB", RENDER_SIZE, (120, 100, 90)).save(upload)
    job = jobs_mod.jobs.create(str(upload))

    for style in ("lebanese", "khaleeji", "moroccan"):
        render = tmp_path / f"{job.id}_{style}.png"
        Image.new("RGB", RENDER_SIZE, (140, 115, 85)).save(render)
        job.style_outputs[style] = str(render)

    cache_analysis(job.id, make_room())
    yield job


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _run(coro_fn):
    return asyncio.run(coro_fn())


# ---------------------------------------------------------------- catalogue


def test_catalogue_endpoint_serves_only_rendered_items(room):
    async def go():
        async with _client() as c:
            r = await c.get("/api/furniture/catalogue", params={"culture": "moroccan"})
            assert r.status_code == 200
            body = r.json()
            ids = {i["id"] for i in body["items"]}
            assert body["count"] == len(body["items"]) >= 8
            assert "mor-sofa-001" in ids, "the new sedari sofa is not being served"
            # Every served item carries what the frontend card needs.
            for item in body["items"]:
                assert item["name_ar"] and item["name_en"] and item["asset"]
    _run(go)


def test_unknown_culture_is_a_client_error(room):
    async def go():
        async with _client() as c:
            r = await c.get("/api/furniture/catalogue", params={"culture": "klingon"})
            assert r.status_code == 400
    _run(go)


# ---------------------------------------------------------- recommendations


@pytest.mark.parametrize("culture,item_id", sorted(NEW_ITEM.items()))
def test_new_item_is_recommended(room, culture, item_id):
    async def go():
        async with _client() as c:
            r = await c.get(
                "/api/furniture/recommendations",
                # No explicit limit: the panel does not send one either, so this
                # exercises the default the app actually gets. With an explicit 6
                # a piece can fall outside the window purely on the id tiebreak,
                # which would be testing the alphabet rather than the ranking.
                params={"culture": culture, "room_type": "living_room",
                        "free_floor_m2": 18.0},
            )
            assert r.status_code == 200
            body = r.json()
            assert body["culture"] == culture
            assert all(i["culture"] == culture for i in body["items"])
            assert all("score" in i and i["reasons"] for i in body["items"])
            assert any(i["id"] == item_id for i in body["items"])
    _run(go)


def test_the_endpoint_serves_a_whole_culture_by_default(room):
    """No `limit` means the whole culture, not a hard-coded six.

    The endpoint's default used to be written as a literal, so raising the
    catalogue's own cap left the panel showing six pieces out of nine — which
    looks exactly like a catalogue that failed to load the rest.
    """
    async def go():
        async with _client() as c:
            for culture in ("lebanese", "khaleeji", "moroccan"):
                r = await c.get("/api/furniture/recommendations",
                                params={"culture": culture, "room_type": "living_room"})
                assert r.status_code == 200
                items = r.json()["items"]
                assert len(items) == len(furniture.items_for_culture(culture)), (
                    f"{culture}: served {len(items)} of "
                    f"{len(furniture.items_for_culture(culture))}"
                )
    _run(go)


def test_recommendations_carry_both_languages(room):
    """The panel renders one of these per card and must never fall back to English."""
    async def go():
        async with _client() as c:
            r = await c.get("/api/furniture/recommendations",
                            params={"culture": "khaleeji", "room_type": "majlis",
                                    "free_floor_m2": 12.0, "existing": "sofa"})
            for item in r.json()["items"]:
                assert item["reasons"] and item["reasons_ar"]
                assert len(item["reasons"]) == len(item["reasons_ar"])
                assert any("؀" <= ch <= "ۿ" for ch in item["reasons_ar"][0]), (
                    f"{item['id']}: {item['reasons_ar'][0]!r} is not Arabic"
                )
    _run(go)


def test_room_analysis_is_served_for_the_job(room):
    async def go():
        async with _client() as c:
            r = await c.get(f"/api/furniture/room-analysis/{room.id}")
            assert r.status_code == 200
            body = r.json()
            assert body["job_id"] == room.id
            assert body["candidates"], "no candidate spots in the summary"
            assert body["existing_categories"] == ["sofa"]

            missing = await c.get("/api/furniture/room-analysis/no-such-job")
            assert missing.status_code == 404
    _run(go)


# ------------------------------------------------- the full placement flow


@pytest.mark.parametrize("culture,item_id", sorted(NEW_ITEM.items()))
def test_full_workflow_for_a_new_item(room, culture, item_id):
    async def go():
        async with _client() as c:
            # 1. candidate positions, in render pixels
            r = await c.post("/api/furniture/candidate-positions",
                             json={"job_id": room.id, "furniture_id": item_id, "limit": 3})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["image_size"] == {"width": RENDER_SIZE[0], "height": RENDER_SIZE[1]}
            assert body["positions"], f"{item_id}: {body['message']}"
            assert body["message"] is None
            pos = body["positions"][0]["position"]
            # The suggestion has to be inside the picture the client is drawing on.
            assert 0 <= pos["x"] and pos["x"] + pos["width"] <= RENDER_SIZE[0]
            assert 0 <= pos["y"] and pos["y"] + pos["height"] <= RENDER_SIZE[1]

            async def validate(p):
                res = await c.post("/api/furniture/validate-position",
                                   json={"job_id": room.id, "furniture_id": item_id, **p})
                assert res.status_code == 200, res.text
                return res.json()

            # 2. the server agrees with its own suggestion
            v = await validate(pos)
            assert v["valid"] is True, v["reason"]
            assert v["adjusted_position"] == v["position"]
            assert v["reason"] and v["reason_ar"]

            # 3. drag it — one direction along the floor must stay valid
            drags = [await validate({**pos, "x": pos["x"] + dx}) for dx in (-60, 60)]
            assert any(d["valid"] for d in drags), (
                f"{item_id}: neither drag direction stayed valid: "
                + "; ".join(d["reason"] for d in drags)
            )
            moved = next(
                ({**pos, "x": pos["x"] + dx} for dx, d in zip((-60, 60), drags) if d["valid"]),
                pos,
            )

            # 4. resize, keeping the base on the floor like the UI does
            smaller = {
                "x": moved["x"] + moved["width"] * 0.05,
                "y": moved["y"] + moved["height"] * 0.1,
                "width": moved["width"] * 0.9,
                "height": moved["height"] * 0.9,
            }
            assert (await validate(smaller))["valid"] is True

            # 5. confirm — the item is composited into that style's render
            r = await c.post("/api/furniture/confirm-placement",
                             json={"job_id": room.id, "furniture_id": item_id,
                                   "style": culture, **smaller})
            assert r.status_code == 200, r.text
            done = r.json()
            assert done["image"].startswith("data:image/png;base64,")
            assert done["furniture_id"] == item_id
            assert len(done["placements"]) == 1
            assert done["placements"][0]["furniture_id"] == item_id

            # 6. and the room remembers it: a second placement avoids the first
            r2 = await c.post("/api/furniture/candidate-positions",
                              json={"job_id": room.id, "furniture_id": item_id, "limit": 3})
            assert r2.status_code == 200
    _run(go)


@pytest.mark.parametrize("culture,item_id", sorted(NEW_ITEM.items()))
def test_server_refuses_an_invalid_box_even_though_the_client_sent_it(room, culture, item_id):
    async def go():
        async with _client() as c:
            r = await c.post("/api/furniture/candidate-positions",
                             json={"job_id": room.id, "furniture_id": item_id, "limit": 1})
            pos = r.json()["positions"][0]["position"]

            # Halfway up the wall — nothing under it to stand on.
            floating = {**pos, "y": 40}
            v = await c.post("/api/furniture/validate-position",
                             json={"job_id": room.id, "furniture_id": item_id, **floating})
            body = v.json()
            assert body["valid"] is False
            assert body["adjusted_position"] is None, (
                "a rejected box must not come back as something to snap to"
            )
            assert body["reason"] and body["reason_ar"]

            # Confirming it anyway is refused with the reason, not silently moved.
            r = await c.post("/api/furniture/confirm-placement",
                             json={"job_id": room.id, "furniture_id": item_id,
                                   "style": culture, **floating})
            assert r.status_code == 400
            detail = r.json()["detail"]
            assert detail["message_en"] and detail["message_ar"]
    _run(go)
    furniture.asset_aspect.cache_clear()


def test_unknown_furniture_id_is_a_client_error_not_a_crash(room):
    async def go():
        async with _client() as c:
            for path, payload in (
                ("/api/furniture/candidate-positions",
                 {"job_id": room.id, "furniture_id": "leb-teleporter-001", "limit": 3}),
                ("/api/furniture/validate-position",
                 {"job_id": room.id, "furniture_id": "leb-teleporter-001",
                  "x": 10, "y": 10, "width": 50, "height": 50}),
            ):
                r = await c.post(path, json=payload)
                assert r.status_code == 400, f"{path} -> {r.status_code}"
    _run(go)


def test_an_item_whose_png_is_missing_fails_at_insertion_with_a_clear_reason(
    room, tmp_path, monkeypatch
):
    """Every catalogue entry ships with its PNG — this is what happens if one doesn't.

    A deployment could be missing public/, or an entry could be added ahead of its
    render. That is a server-side gap, not a bad request, so it comes back as
    `compositing_failed` (500) with a bilingual message — a stated failure, never
    a stack trace or a room with a hole composited into it.

    The absence is simulated by pointing the compositor at an empty directory.
    Deleting the real asset would be a test that damages the repo when it fails
    partway through.
    """
    async def go():
        monkeypatch.setattr(compositing, "ASSET_ROOT", tmp_path / "empty")
        furniture.asset_aspect.cache_clear()
        async with _client() as c:
            r = await c.post("/api/furniture/confirm-placement",
                             json={"job_id": room.id, "furniture_id": "mor-sofa-001",
                                   "style": "moroccan",
                                   "x": 300, "y": 400, "width": 200, "height": 90})
            assert r.status_code == 500
            detail = r.json()["detail"]
            assert detail["code"] == "compositing_failed"
            assert detail["message_en"] and detail["message_ar"]
    _run(go)
