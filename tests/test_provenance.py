"""transform.provenance() — /redesign's proof of what the host actually did.

Before this existed the response carried no provenance at all, so the client
could not tell a real SDXL+LoRA render from a placeholder except by the
`placeholder` flag, and "Inside DAR" had to label its pipeline chapter
CONCEPTUAL ARCHITECTURE because it had nothing to state. These tests pin the
part that matters: it must never claim more than the host can back up.
"""

import json

import pytest

from backend import transform


def test_light_mode_claims_nothing_but_light_mode(monkeypatch):
    """In LIGHT nothing is rendered, so nothing about rendering may be asserted."""
    monkeypatch.setenv("DARDESIGN_LIGHT", "1")
    p = transform.provenance(["lebanese", "khaleeji", "moroccan"])
    assert p == {"light_mode": True}
    for forbidden in ("model", "lora", "controlnet", "dual_controlnet", "lora_scale"):
        assert forbidden not in p


def test_real_mode_reports_the_config_the_generator_obeys(monkeypatch):
    monkeypatch.setenv("DARDESIGN_LIGHT", "0")
    p = transform.provenance(["lebanese"])
    assert p["light_mode"] is False
    assert p["model"] == transform.CONFIG["base_model"]
    assert p["lora_scale"] == pytest.approx(float(transform.CONFIG["lora_scale"]))
    assert "lebanese" in p["controlnet"]
    depth = p["controlnet"]["lebanese"]["depth"]
    seg = p["controlnet"]["lebanese"]["seg"]
    assert depth > 0 and seg > 0


def test_controlnet_weights_match_sweep_winners_when_present(monkeypatch):
    """The reported weights must be the ones the generator would use, not the
    pipeline.yaml defaults, or the panel would describe an untuned pipeline."""
    monkeypatch.setenv("DARDESIGN_LIGHT", "0")
    if not transform.SWEEP_WINNERS_PATH.exists():
        pytest.skip("no sweep_winners.json in this checkout")
    data = json.loads(transform.SWEEP_WINNERS_PATH.read_text(encoding="utf-8"))
    for style in ("lebanese", "khaleeji", "moroccan"):
        pair = data.get(style) or data.get("default")
        if not pair:
            continue
        reported = transform.provenance([style])["controlnet"][style]
        expected = transform._winner_weights(style)
        assert (reported["depth"], reported["seg"]) == pytest.approx(expected)


def test_a_missing_lora_is_reported_as_null_not_omitted(monkeypatch, tmp_path):
    """`null` means "this culture has no LoRA and ran prompt-only"; a missing key
    would be indistinguishable from "we did not look", and the UI would have to
    guess which."""
    monkeypatch.setenv("DARDESIGN_LIGHT", "0")
    monkeypatch.setattr(transform, "_has_lora", lambda style: False)
    p = transform.provenance(["lebanese"])
    assert "lebanese" in p["lora"]
    assert p["lora"]["lebanese"] is None


def test_only_requested_styles_are_described(monkeypatch):
    """A one-style request must not imply the other two were touched."""
    monkeypatch.setenv("DARDESIGN_LIGHT", "0")
    p = transform.provenance(["moroccan"])
    assert set(p["lora"]) == {"moroccan"}
    assert set(p["controlnet"]) == {"moroccan"}


def test_no_styles_means_no_per_style_claims(monkeypatch):
    monkeypatch.setenv("DARDESIGN_LIGHT", "0")
    p = transform.provenance([])
    assert "lora" not in p and "controlnet" not in p
    # the host-level facts still stand
    assert p["model"] and p["light_mode"] is False


def test_redesign_response_carries_provenance(monkeypatch):
    """The field has to survive the pydantic model, not just the helper."""
    from backend.main import RedesignResponse

    r = RedesignResponse(original="data:image/png;base64,x", provenance={"light_mode": True})
    assert r.provenance == {"light_mode": True}
    assert RedesignResponse(original="data:image/png;base64,x").provenance is None
