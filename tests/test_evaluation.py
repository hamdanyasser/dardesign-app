"""Evaluation dashboard: the numbers, and what happens when there aren't any.

The load-bearing assertions here are the negative ones. A dashboard that prints
0.0 because nothing was measured looks exactly like a dashboard reporting a
real 0.0, and an FYP panel cannot tell them apart — so "no data" must come back
as null with a reason, never as a number.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import time

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["DARDESIGN_LIGHT"] = "1"

from backend import db  # noqa: E402
from backend.evaluation import (  # noqa: E402
    automatic_metrics,
    generation_report,
    overall_rating,
)
from backend.main import app  # noqa: E402

PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _fresh_db(tmp_path, monkeypatch):
    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.connect(tmp_path / "test.db")
    yield
    db.close()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _signup(c, email: str) -> dict:
    r = await c.post("/api/auth/register", json={
        "fullName": "Eval Tester", "email": email,
        "password": "secret123", "phoneNumber": "0700",
    })
    assert r.status_code == 200, r.text
    return r.json()


async def _save(c, *, duration=None, ssim=None) -> dict:
    body = {"oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": "lebanese"}
    if duration is not None:
        body["duration"] = duration
    if ssim is not None:
        body["ssim"] = ssim
    r = await c.post("/api/history", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def _rated_design(c, culture: str, *, cultural: int, quality: int, preservation: int):
    saved = await c.post("/api/history", json={
        "oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": culture,
    })
    assert saved.status_code == 200, saved.text
    r = await c.post("/api/feedback", json={
        "historyId": saved.json()["id"],
        "culturalAccuracy": cultural,
        "imageQuality": quality,
        "roomPreservation": preservation,
        "furniturePlacement": "valid",
        "comment": f"{culture} note",
    })
    assert r.status_code == 200, r.text


# ---------- generation stats (history table) ----------


def test_no_saved_designs_reports_nothing_not_zero() -> None:
    s = generation_report()
    assert s["roomsGenerated"] == 0
    # The average is the dangerous one: 0.0 would read as "generation is instant".
    assert s["averageSeconds"] is None
    assert s["sampleSize"] == 0


def test_rooms_generated_counts_every_history_row() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "rooms@example.com")
            for _ in range(3):
                await _save(c, duration=None)
            assert generation_report()["roomsGenerated"] == 3
    asyncio.run(_go())


def test_average_is_the_sum_of_durations_over_the_rows_that_have_one() -> None:
    """Rows saved before Duration existed are null. Dividing by all rows would
    report an average far below any real generation, so the denominator is the
    number of timed rows -- and sampleSize says what that was."""
    async def _go():
        async with _client() as c:
            await _signup(c, "avg@example.com")
            await _save(c, duration=90.0)
            await _save(c, duration=150.0)
            await _save(c, duration=None)     # saved before durations were recorded

            s = generation_report()
            assert s["roomsGenerated"] == 3          # every row counts as a room
            assert s["totalSeconds"] == 240.0
            assert s["sampleSize"] == 2
            assert s["averageSeconds"] == 120.0      # 240 / 2, not 240 / 3
            assert s["fastestSeconds"] == 90.0
            assert s["slowestSeconds"] == 150.0
    asyncio.run(_go())


def test_duration_is_stored_and_returned_on_the_design() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "store@example.com")
            saved = await _save(c, duration=123.45)
            assert saved["duration"] == 123.45
            rows = (await c.get("/api/history")).json()
            assert rows[0]["duration"] == 123.45
    asyncio.run(_go())


def test_absurd_durations_are_clamped_before_they_reach_an_average() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "clamp@example.com")
            await _save(c, duration=10 ** 9)
            await _save(c, duration=-5)
            s = generation_report()
            assert s["slowestSeconds"] == 86_400.0
            assert s["fastestSeconds"] == 0.0
    asyncio.run(_go())


def test_generation_stats_respect_the_date_filter() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "dates@example.com")
            await _save(c, duration=100.0)
            future = time.time() + 3600
            s = generation_report(since=future)
            assert s["roomsGenerated"] == 0
            assert s["averageSeconds"] is None
    asyncio.run(_go())


def test_average_ssim_over_the_designs_that_carry_one() -> None:
    """Same shape as the duration average: measured rows only, and null rather
    than 0 when nothing has been measured."""
    async def _go():
        async with _client() as c:
            await _signup(c, "ssim@example.com")
            assert generation_report()["averageSsim"] is None

            await _save(c, ssim=0.40)
            await _save(c, ssim=0.60)
            await _save(c)                      # no measurement
            s = generation_report()
            assert s["roomsGenerated"] == 3
            assert s["averageSsim"] == 0.5      # 1.0 / 2, not 1.0 / 3
            assert s["ssimSampleSize"] == 2
    asyncio.run(_go())


def test_ssim_is_stored_and_clamped() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "ssim2@example.com")
            saved = await _save(c, ssim=0.4312)
            assert saved["ssim"] == 0.4312
            assert (await c.get("/api/history")).json()[0]["ssim"] == 0.4312

            # SSIM is bounded 0..1; anything else is a client bug and must not
            # reach an average.
            await _save(c, ssim=7.5)
            assert generation_report()["averageSsim"] == round((0.4312 + 1.0) / 2, 3)
    asyncio.run(_go())


# ---------- derived overall rating ----------


def test_overall_rating_is_the_mean_of_the_three_scores() -> None:
    assert overall_rating({
        "averageCulturalAccuracy": 4.0,
        "averageImageQuality": 5.0,
        "averageRoomPreservation": 3.0,
    }) == 4.0


def test_overall_rating_is_none_without_ratings() -> None:
    assert overall_rating({
        "averageCulturalAccuracy": None,
        "averageImageQuality": None,
        "averageRoomPreservation": None,
    }) is None


# ---------- automatic metrics ----------


def test_automatic_metrics_absent_says_so(tmp_path) -> None:
    m = automatic_metrics(tmp_path / "nope.csv")
    assert m["available"] is False
    assert m["byCulture"] == []
    assert m["reason_en"] and m["reason_ar"]     # bilingual, like every other message


def test_automatic_metrics_read_real_csv(tmp_path) -> None:
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room_id,style,ssim,lpips\n"
        "room_01,lebanese,0.40,0.25\n"
        "room_02,lebanese,0.50,0.35\n"
        "room_01,moroccan,0.60,0.20\n",
        encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["available"] is True
    assert m["metrics"] == ["ssim", "lpips"]
    assert m["images"] == 3
    by = {r["culture"]: r for r in m["byCulture"]}
    assert by["lebanese"]["ssim"] == 0.45
    assert by["lebanese"]["samples"] == 2
    assert by["moroccan"]["ssim"] == 0.6


def test_automatic_metrics_tolerate_a_partial_run(tmp_path) -> None:
    """An SSIM-only run (torchmetrics missing) is a legitimate result."""
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room_id,style,ssim,lpips\nroom_01,khaleeji,0.42,\nroom_02,khaleeji,bad,\n",
        encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["metrics"] == ["ssim"]           # lpips column is empty -> not claimed
    assert m["byCulture"][0]["ssim"] == 0.42  # the unparseable row is skipped


def test_automatic_metrics_survive_a_broken_file(tmp_path) -> None:
    p = tmp_path / "results.csv"
    p.write_bytes(b"\xff\xfe not a csv at all")
    assert automatic_metrics(p)["available"] is False


# ---------- the endpoint ----------


def test_evaluation_endpoint_requires_admin() -> None:
    async def _go():
        async with _client() as c:
            r = await c.get("/api/admin/evaluation")
            assert r.status_code == 401       # signed out

            await _signup(c, "first@example.com")   # first account is Admin
            r = await c.get("/api/admin/evaluation")
            assert r.status_code == 200
        # a second, ordinary account must not see other people's comments
        async with _client() as c2:
            await _signup(c2, "second@example.com")
            r = await c2.get("/api/admin/evaluation")
            assert r.status_code == 403
    asyncio.run(_go())


def test_evaluation_endpoint_aggregates_real_ratings() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "admin@example.com")
            await _rated_design(c, "lebanese", cultural=5, quality=4, preservation=3)
            await _rated_design(c, "lebanese", cultural=3, quality=4, preservation=5)
            await _rated_design(c, "moroccan", cultural=2, quality=2, preservation=2)

            r = await c.get("/api/admin/evaluation")
            body = r.json()

            assert body["stats"]["total"] == 3
            assert body["stats"]["averageCulturalAccuracy"] == round((5 + 3 + 2) / 3, 2)
            assert body["averageOverall"] is not None

            by = {row["culture"]: row for row in body["byCulture"]}
            assert by["lebanese"]["total"] == 2
            assert by["lebanese"]["averageCulturalAccuracy"] == 4.0
            assert by["moroccan"]["averageCulturalAccuracy"] == 2.0

            assert len(body["recent"]) == 3
            assert body["recent"][0]["comment"]
            assert body["cultures"] == ["lebanese", "khaleeji", "moroccan"]
    asyncio.run(_go())


def test_evaluation_endpoint_filters_by_culture() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "admin2@example.com")
            await _rated_design(c, "lebanese", cultural=5, quality=5, preservation=5)
            await _rated_design(c, "moroccan", cultural=1, quality=1, preservation=1)

            r = await c.get("/api/admin/evaluation", params={"culture": "lebanese"})
            body = r.json()
            assert body["stats"]["total"] == 1
            assert body["stats"]["averageCulturalAccuracy"] == 5.0
            assert all(f["culture"] == "lebanese" for f in body["recent"])

            r = await c.get("/api/admin/evaluation", params={"culture": "atlantean"})
            assert r.status_code == 400
    asyncio.run(_go())


def test_evaluation_endpoint_with_no_data_returns_nulls() -> None:
    """A fresh install must not display zeros that look like measurements."""
    async def _go():
        async with _client() as c:
            await _signup(c, "admin3@example.com")
            body = (await c.get("/api/admin/evaluation")).json()
            assert body["stats"]["total"] == 0
            assert body["stats"]["averageCulturalAccuracy"] is None
            assert body["averageOverall"] is None
            assert body["byCulture"] == []
            assert body["recent"] == []
            assert body["generation"]["averageSeconds"] is None
            assert body["coverage"]["total"] == 0
            assert body["confusion"]["accuracy"] is None
    asyncio.run(_go())


# ---------- filter acceptance ----------
#
# The dashboard's whole claim is that every panel is reading one filtered
# population. These tests are that claim, stated as arithmetic: each one picks
# figures from *different* sections -- ratings, timings, model metrics, the
# confusion matrix -- and asserts they agree about which designs exist. Before
# the filters were pushed into SQL, only the rating panels moved when a culture
# was chosen and everything derived from `history` kept showing the global
# number, which is exactly what a single-section test would have missed.

DAY = 86_400.0


async def _design(c, culture: str, **kw) -> int:
    """One saved design. `rating` attaches feedback, `at` backdates the row."""
    rating = kw.pop("rating", None)
    at = kw.pop("at", None)
    body = {"oldImage": PNG_DATA_URL, "newImage": PNG_DATA_URL, "culture": culture, **kw}
    r = await c.post("/api/history", json=body)
    assert r.status_code == 200, r.text
    entry_id = r.json()["id"]
    if at is not None:
        # Backdating in SQL rather than freezing the clock: CreatedAt is what the
        # date filter compares against, so this exercises the real comparison.
        db._write("UPDATE history SET CreatedAt = ? WHERE Id = ?", (at, entry_id))
    if rating is not None:
        fb = await c.post("/api/feedback", json={
            "historyId": entry_id,
            "culturalAccuracy": rating, "imageQuality": rating, "roomPreservation": rating,
            "furniturePlacement": "valid", "comment": f"{culture} {rating}",
        })
        assert fb.status_code == 200, fb.text
        if at is not None:
            db._write("UPDATE feedback SET CreatedAt = ? WHERE HistoryId = ?", (at, entry_id))
    return entry_id


async def _corpus(c) -> dict[str, int]:
    """Three cultures, two of them rated, spread over three days.

    lebanese: 2 designs (one rated 5, one rated 3), both today
    khaleeji: 1 design, unrated, yesterday
    moroccan: 1 design, rated 1, a week ago
    """
    now = time.time()
    ids = {}
    ids["leb_a"] = await _design(c, "lebanese", duration=100.0, ssim=0.8, rating=5)
    ids["leb_b"] = await _design(c, "lebanese", duration=140.0, ssim=0.6, rating=3)
    ids["kha"] = await _design(c, "khaleeji", duration=60.0, ssim=0.5, at=now - DAY)
    ids["mor"] = await _design(c, "moroccan", duration=200.0, ssim=0.4, rating=1, at=now - 7 * DAY)
    db.set_history_evaluation(ids["leb_a"], lpips=0.3, clip_score=0.30, predicted_culture="lebanese")
    db.set_history_evaluation(ids["leb_b"], lpips=0.5, clip_score=0.20, predicted_culture="moroccan")
    db.set_history_evaluation(ids["kha"], lpips=0.4, clip_score=0.25, predicted_culture="khaleeji")
    db.set_history_evaluation(ids["mor"], lpips=0.6, clip_score=0.15, predicted_culture="moroccan")
    return ids


async def _report(c, **params) -> dict:
    r = await c.get("/api/admin/evaluation", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_filter_all_cultures_shows_every_record() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f1@example.com")
            await _corpus(c)
            b = await _report(c)
            assert b["generation"]["roomsGenerated"] == 4
            assert b["generation"]["sampleSize"] == 4
            assert b["generation"]["averageSeconds"] == 125.0     # (100+140+60+200)/4
            assert b["stats"]["total"] == 3                       # khaleeji is unrated
            assert b["confusion"]["total"] == 4
            assert b["coverage"] == {
                "total": 4, "ssim": 4, "lpips": 4, "clip": 4,
                "predicted": 4, "timed": 4, "rated": 3,
            }
    asyncio.run(_go())


def test_filter_by_each_culture_narrows_every_section() -> None:
    """The regression this whole change exists for: choosing a culture used to
    move the ratings and leave timings, SSIM and the matrix showing all four
    designs."""
    async def _go():
        async with _client() as c:
            await _signup(c, "f2@example.com")
            await _corpus(c)

            leb = await _report(c, culture="lebanese")
            assert leb["generation"]["roomsGenerated"] == 2
            assert leb["generation"]["averageSeconds"] == 120.0        # (100+140)/2
            assert leb["generation"]["averageSsim"] == 0.7             # (0.8+0.6)/2
            assert leb["generation"]["averageClipScore"] == 0.25
            assert leb["stats"]["total"] == 2
            assert leb["stats"]["averageCulturalAccuracy"] == 4.0      # (5+3)/2
            assert leb["confusion"]["total"] == 2
            assert leb["confusion"]["correct"] == 1                    # leb_b read as moroccan
            assert set(leb["confusion"]["matrix"]) == {"lebanese"}
            assert leb["coverage"]["total"] == 2 and leb["coverage"]["rated"] == 2
            assert [r["culture"] for r in leb["byCulture"]] == ["lebanese"]

            mor = await _report(c, culture="moroccan")
            assert mor["generation"]["roomsGenerated"] == 1
            assert mor["generation"]["averageSeconds"] == 200.0
            assert mor["generation"]["averageSsim"] == 0.4
            assert mor["stats"]["averageCulturalAccuracy"] == 1.0
            assert mor["confusion"]["total"] == 1 and mor["confusion"]["accuracy"] == 1.0

            kha = await _report(c, culture="khaleeji")
            assert kha["generation"]["roomsGenerated"] == 1
            assert kha["generation"]["averageSeconds"] == 60.0
            assert kha["coverage"]["rated"] == 0
    asyncio.run(_go())


def test_filter_from_date_only() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f3@example.com")
            await _corpus(c)
            # Everything from half a day ago: the two lebanese designs only.
            b = await _report(c, since=time.time() - DAY / 2)
            assert b["generation"]["roomsGenerated"] == 2
            assert b["generation"]["averageSeconds"] == 120.0
            assert b["stats"]["total"] == 2
            assert b["confusion"]["total"] == 2
            assert b["coverage"]["total"] == 2
    asyncio.run(_go())


def test_filter_to_date_only() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f4@example.com")
            await _corpus(c)
            # Everything up to half a day ago: khaleeji and moroccan.
            b = await _report(c, until=time.time() - DAY / 2)
            assert b["generation"]["roomsGenerated"] == 2
            assert b["generation"]["averageSeconds"] == 130.0    # (60+200)/2
            assert b["stats"]["total"] == 1                      # only moroccan is rated
            assert {r["culture"] for r in b["byCulture"]} == {"moroccan"}
    asyncio.run(_go())


def test_filter_full_range_is_inclusive_at_both_ends() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f5@example.com")
            ids = await _corpus(c)
            edge = time.time() - 3 * DAY
            db._write("UPDATE history SET CreatedAt = ? WHERE Id = ?", (edge, ids["kha"]))

            # A range whose ends land exactly on the record must include it --
            # an off-by-one-second boundary silently drops a whole day's work.
            b = await _report(c, since=edge, until=edge)
            assert b["generation"]["roomsGenerated"] == 1
            assert b["generation"]["averageSeconds"] == 60.0

            b = await _report(c, since=time.time() - 3 * DAY - 1, until=time.time() - DAY)
            assert b["generation"]["roomsGenerated"] == 1
    asyncio.run(_go())


def test_filter_culture_and_date_range_together() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f6@example.com")
            await _corpus(c)
            b = await _report(c, culture="lebanese", since=time.time() - DAY / 2)
            assert b["generation"]["roomsGenerated"] == 2
            assert b["stats"]["total"] == 2

            # Lebanese exists, but not in this window: empty, and empty means
            # null, not zero.
            b = await _report(c, culture="lebanese", until=time.time() - 3 * DAY)
            assert b["generation"]["roomsGenerated"] == 0
            assert b["generation"]["averageSeconds"] is None
            assert b["generation"]["averageSsim"] is None
            assert b["stats"]["total"] == 0
            assert b["stats"]["averageCulturalAccuracy"] is None
            assert b["averageOverall"] is None
            assert b["confusion"]["accuracy"] is None
            assert b["byCulture"] == []
    asyncio.run(_go())


def test_switching_culture_repeatedly_gives_the_same_answer_each_time() -> None:
    """No cached global to fall back to: the fourth request for lebanese must
    match the first, whatever was asked for in between."""
    async def _go():
        async with _client() as c:
            await _signup(c, "f7@example.com")
            await _corpus(c)
            seen = []
            for culture in ("lebanese", "moroccan", "khaleeji", None,
                            "lebanese", "khaleeji", "lebanese"):
                b = await _report(c, **({"culture": culture} if culture else {}))
                seen.append((culture, b["generation"]["roomsGenerated"], b["stats"]["total"]))
            assert seen == [
                ("lebanese", 2, 2), ("moroccan", 1, 1), ("khaleeji", 1, 0), (None, 4, 3),
                ("lebanese", 2, 2), ("khaleeji", 1, 0), ("lebanese", 2, 2),
            ]
    asyncio.run(_go())


def test_clearing_the_dates_returns_the_unfiltered_period() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f8@example.com")
            await _corpus(c)
            narrowed = await _report(c, since=time.time() - DAY / 2)
            assert narrowed["generation"]["roomsGenerated"] == 2
            cleared = await _report(c)
            assert cleared["generation"]["roomsGenerated"] == 4
            assert cleared["stats"]["total"] == 3
    asyncio.run(_go())


def test_deleting_a_design_updates_every_aggregate() -> None:
    """Metrics are columns on the history row, so deletion is total -- there is
    no side table left holding the design's contribution to an average."""
    async def _go():
        async with _client() as c:
            await _signup(c, "f9@example.com")
            ids = await _corpus(c)
            assert (await c.delete(f"/api/history/{ids['leb_b']}")).status_code == 200

            b = await _report(c)
            assert b["generation"]["roomsGenerated"] == 3
            assert b["generation"]["averageSeconds"] == 120.0     # (100+60+200)/3
            assert b["stats"]["total"] == 2                       # its rating went with it
            assert b["confusion"]["total"] == 3
            assert b["coverage"]["total"] == 3

            leb = await _report(c, culture="lebanese")
            assert leb["generation"]["roomsGenerated"] == 1
            assert leb["generation"]["averageSsim"] == 0.8
            assert leb["confusion"]["accuracy"] == 1.0            # the misread one is gone
    asyncio.run(_go())


def test_a_culture_with_no_ratings_reports_null_not_zero() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "f10@example.com")
            await _corpus(c)
            b = await _report(c, culture="khaleeji")
            assert b["stats"]["total"] == 0
            assert b["stats"]["averageCulturalAccuracy"] is None
            assert b["stats"]["averageImageQuality"] is None
            assert b["averageOverall"] is None
            assert b["byCulture"] == []
            # ...while its *measured* figures are real and must still show.
            assert b["generation"]["averageSsim"] == 0.5
    asyncio.run(_go())


# ---------- what must never reach a model statistic ----------


def test_light_placeholders_are_saved_but_never_timed_or_measured() -> None:
    """A DARDESIGN_LIGHT tint returns in milliseconds. Averaged in, it reports a
    generation time no real render has ever achieved."""
    async def _go():
        async with _client() as c:
            await _signup(c, "light@example.com")
            await _design(c, "lebanese", duration=120.0, ssim=0.8)
            await _design(c, "lebanese", duration=0.05, ssim=0.99, light=True)

            b = await _report(c)
            assert b["generation"]["roomsGenerated"] == 2      # both are real saved designs
            assert b["generation"]["evaluableDesigns"] == 1
            assert b["generation"]["lightExcluded"] == 1
            assert b["generation"]["averageSeconds"] == 120.0
            assert b["generation"]["averageSsim"] == 0.8
            assert b["coverage"]["total"] == 1
    asyncio.run(_go())


def test_edited_designs_are_kept_out_of_the_model_metrics() -> None:
    async def _go():
        async with _client() as c:
            await _signup(c, "edit@example.com")
            await _design(c, "lebanese", duration=120.0, ssim=0.8)
            await _design(c, "lebanese", duration=130.0, ssim=0.2, edited=True)

            b = await _report(c)
            assert b["generation"]["roomsGenerated"] == 2
            assert b["generation"]["evaluableDesigns"] == 1
            assert b["generation"]["editedExcluded"] == 1
            assert b["generation"]["averageSsim"] == 0.8
            assert b["generation"]["averageSeconds"] == 120.0
    asyncio.run(_go())


# ---------- LoRA vs baseline ablation ----------


def test_ablation_splits_the_two_arms_instead_of_pooling_them(tmp_path) -> None:
    """Pooling was the bug: a LoRA row and its own baseline row landed in the
    same per-culture bucket, so the comparison averaged itself away."""
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room,style,set,ssim,lpips,clip_score,predicted\n"
        "room_01,lebanese,lora,0.80,0.30,0.32,lebanese\n"
        "room_02,lebanese,lora,0.70,0.40,0.30,lebanese\n"
        "room_01,lebanese,baseline,0.60,0.50,0.22,moroccan\n"
        "room_02,lebanese,baseline,0.50,0.60,0.20,lebanese\n",
        encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["available"] is True
    # byCulture is the trained pipeline alone, not the two arms averaged.
    assert m["byCulture"][0]["ssim"] == 0.75
    assert m["images"] == 2

    sets = {s["set"]: s for s in m["sets"]}
    assert sets["lora"]["overall"]["ssim"]["mean"] == 0.75
    assert sets["baseline"]["overall"]["ssim"]["mean"] == 0.55
    assert sets["lora"]["recognition"]["accuracy"] == 1.0
    assert sets["baseline"]["recognition"]["accuracy"] == 0.5

    ab = m["ablation"]
    assert ab["available"] is True and ab["sameCorpus"] is True
    rows = {r["metric"]: r for r in ab["rows"]}
    assert rows["ssim"]["delta"] == 0.2
    assert rows["ssim"]["lora"]["n"] == 2 and rows["ssim"]["baseline"]["n"] == 2
    assert rows["clip_score"]["delta"] == 0.1


def test_ablation_says_so_when_only_one_arm_was_run(tmp_path) -> None:
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room,style,set,ssim\nroom_01,lebanese,lora,0.80\n", encoding="utf-8",
    )
    m = automatic_metrics(csv_path)
    assert m["available"] is True
    assert m["ablation"]["available"] is False
    assert m["ablation"]["rows"] == []
    assert "not generated yet" in m["ablation"]["reason_en"]


def test_automatic_metrics_filter_by_culture(tmp_path) -> None:
    csv_path = tmp_path / "results.csv"
    csv_path.write_text(
        "room,style,ssim\nroom_01,lebanese,0.80\nroom_01,moroccan,0.40\n", encoding="utf-8",
    )
    assert automatic_metrics(csv_path, culture="lebanese")["byCulture"][0]["ssim"] == 0.8
    # A culture the corpus has no rows for is an empty state, not a zero.
    absent = automatic_metrics(csv_path, culture="khaleeji")
    assert absent["available"] is False and absent["byCulture"] == []
