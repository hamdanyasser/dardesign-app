"""Build Mode's render must stay conditioned on the user's own scene.

`/render-scene` differs from `/redesign` in exactly one intended way: the depth
and segmentation images come from the 3D scene the user composed rather than
from an annotator reading a photograph. Everything else — model, LoRA, prompt,
ControlNet weights, steps, guidance — is shared code.

That one difference is carried by a single argument, `control_override`. These
tests pin the places where it could be silently lost, because losing it does not
raise anything the user would see: the render simply stops being their room
while every other signal still reports success.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend import transform


class _FakeImage:
    """Just enough PIL surface for _generate's control path."""

    def __init__(self, tag: str) -> None:
        self.tag = tag

    def convert(self, _mode: str) -> "_FakeImage":
        return self

    def resize(self, _size) -> "_FakeImage":
        return self


class _Result:
    def __init__(self, image) -> None:
        self.images = [image]


class _SavedImage:
    def save(self, path, **_kw) -> None:
        Path(path).write_bytes(b"\x89PNG\r\n\x1a\n")


class _FlakyPipe:
    """Raises the accelerate-hook AttributeError once, then succeeds.

    This reproduces the real T4 failure: "'CLIPTextModelWithProjection' object
    has no attribute '_hf_hook'" after a LoRA hot-swap raced.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise AttributeError(
                "'CLIPTextModelWithProjection' object has no attribute '_hf_hook'"
            )
        return _Result(_SavedImage())


@pytest.fixture
def flaky(monkeypatch):
    pipe = _FlakyPipe()
    loaded = transform._LoadedPipe(pipe=pipe, is_sdxl=True, style_loaded=None)
    monkeypatch.setattr(transform, "_load_pipeline", lambda **_k: loaded)
    monkeypatch.setattr(transform, "_attach_lora", lambda *_a, **_k: None)
    monkeypatch.setattr(transform, "_free_pipe", lambda *_a, **_k: None)
    monkeypatch.setattr(transform, "_write_manifest", lambda *_a, **_k: None)

    called = {"prepare": 0}

    def _boom(*_a, **_k):
        called["prepare"] += 1
        raise AssertionError(
            "_prepare_conditioning was called on a Build Mode render — the "
            "scene's own depth/seg were dropped and the photo-derived "
            "annotators ran instead."
        )

    monkeypatch.setattr(transform, "_prepare_conditioning", _boom)
    return pipe, called


def _run(tmp_path: Path, **over):
    kwargs = dict(
        image_path=tmp_path / "in.png",
        out_path=tmp_path / "out.png",
        positive="p",
        negative="n",
        style="lebanese",
        strength=0.7,
        seed=1,
        controlnet_weights=(0.7, 0.5),
        use_lora=True,
        target_size=(1024, 768),
        use_sdxl=True,
        control_override=(_FakeImage("depth"), _FakeImage("seg")),
    )
    kwargs.update(over)
    return transform._generate(**kwargs)


def test_control_override_survives_the_hf_hook_retry(tmp_path, flaky):
    """The regression this file exists for.

    The retry used to re-call _generate WITHOUT control_override, so it fell
    through to _prepare_conditioning(image_path=out_path, ...) — and for
    /render-scene `out_path` is the output PNG that has not been written yet.
    Best case that raises; if a same-named file survived an earlier render it
    silently conditioned on the wrong image.
    """
    pipe, called = flaky
    _run(tmp_path)

    assert len(pipe.calls) == 2, "expected exactly one retry"
    assert called["prepare"] == 0, "the scene conditioning was dropped on retry"

    # Both attempts must carry control images, not just the first.
    for i, call in enumerate(pipe.calls):
        assert "image" in call, f"attempt {i + 1} had no control images"


def test_a_normal_render_never_touches_the_photo_annotators(tmp_path, monkeypatch):
    """With control_override supplied, _prepare_conditioning must not run at
    all — no silent fallback to the depth/seg models the photo path uses."""
    pipe = _FlakyPipe()
    pipe.calls.append({})  # skip the failure, first real call succeeds
    loaded = transform._LoadedPipe(pipe=pipe, is_sdxl=True, style_loaded=None)
    monkeypatch.setattr(transform, "_load_pipeline", lambda **_k: loaded)
    monkeypatch.setattr(transform, "_attach_lora", lambda *_a, **_k: None)
    monkeypatch.setattr(transform, "_write_manifest", lambda *_a, **_k: None)
    monkeypatch.setattr(
        transform, "_prepare_conditioning",
        lambda *_a, **_k: pytest.fail("_prepare_conditioning ran on a scene render"),
    )
    _run(tmp_path)


def test_non_hook_attribute_errors_still_propagate(tmp_path, monkeypatch):
    """The retry is narrow on purpose — it must not swallow unrelated bugs."""

    class _Always(_FlakyPipe):
        def __call__(self, **kwargs):
            raise AttributeError("something else entirely")

    loaded = transform._LoadedPipe(pipe=_Always(), is_sdxl=True, style_loaded=None)
    monkeypatch.setattr(transform, "_load_pipeline", lambda **_k: loaded)
    monkeypatch.setattr(transform, "_attach_lora", lambda *_a, **_k: None)
    monkeypatch.setattr(transform, "_write_manifest", lambda *_a, **_k: None)
    with pytest.raises(AttributeError, match="something else entirely"):
        _run(tmp_path)


def test_render_scene_response_reports_what_ran():
    """The panel shows the ADE20K map as evidence. If DARDESIGN_DEPTH_ONLY
    dropped the segmentation ControlNet, the response has to say so or the UI
    is presenting a control image that never reached the model."""
    from backend.main import RenderSceneResponse

    r = RenderSceneResponse(
        job_id="j", style="lebanese", image="data:image/png;base64,x",
        duration_s=1.0, placeholder=False,
        provenance={"light_mode": False, "model": "m"}, dual_controlnet=False,
    )
    assert r.dual_controlnet is False
    assert r.provenance["model"] == "m"

    # Older backends omit both; the defaults must not accuse a working host.
    d = RenderSceneResponse(
        job_id="j", style="lebanese", image="x", duration_s=1.0, placeholder=False,
    )
    assert d.dual_controlnet is True
    assert d.provenance is None
