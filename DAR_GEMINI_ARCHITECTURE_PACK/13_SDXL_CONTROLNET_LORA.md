# 13 — SDXL + Dual ControlNet + Cultural LoRA

**Implementation: `backend/transform.py` (~1500 lines) + `configs/pipeline.yaml` +
`configs/sweep_winners.json` + `scripts/train_lora.py`.**

---

## 1. The pipeline

```
                  ontology.json ──▶ prompt_builder.build_prompts(culture, room, seed)
                                          │
                                    positive_en / negative_en
                                    + trigger phrase ("dardesign-<culture> style")
                                          │
  photo ──┬──▶ Depth Anything V2 Small ──▶ depth  ──▶ ControlNet depth  (w 0.7) ─┐
          │                                                                      │
          └──▶ OneFormer ADE20K Swin-L ──▶ seg    ──▶ ControlNet seg    (w 0.5) ─┤
                                                                                 ▼
  (Render with DAR substitutes BOTH control images from the 3D scene)   SDXL base 1.0
                                                                          fp16
   models/loras/<culture>/dardesign-<culture>-lora.safetensors ──fuse──▶   │
                                                        lora_scale 0.8     │
                                                                           ▼
                                                       30 steps · guidance 7.0 · 1024²
                                                                           │
                                                            OOM? ──────────┤
                                                                           ▼
                                              SD 1.5 + ControlNet 1.1 @ 768²
                                                                           │
                                                                           ▼
                                                     output.png + .manifest.json
```

---

## 2. Exact model identifiers

From `_DEFAULT_CONFIG` in `transform.py`, overridable by `configs/pipeline.yaml`:

| Key | Exact string |
|---|---|
| `base_model` | `stabilityai/stable-diffusion-xl-base-1.0` |
| `fallback_model` | `runwayml/stable-diffusion-v1-5` |
| `controlnet.depth_sdxl` | `diffusers/controlnet-depth-sdxl-1.0` |
| `controlnet.seg_sdxl` | **`SargeZT/sdxl-controlnet-seg`** |
| `controlnet.depth_sd15` | `lllyasviel/sd-controlnet-depth` |
| `controlnet.seg_sd15` | `lllyasviel/sd-controlnet-seg` |
| depth annotator | `depth-anything/Depth-Anything-V2-Small-hf` |
| depth annotator fallback | `lllyasviel/Annotators` (MidasDetector) |
| segmentation annotator | `shi-labs/oneformer_ade20k_swin_large` |

> **Note the seg checkpoint.** The source comment states:
> *"`diffusers/controlnet-seg-sdxl-1.0` does not exist on the Hub — SargeZT's is the
> standard `ControlNetModel`-loadable SDXL seg checkpoint."*
> If a diagram names an SDXL seg ControlNet, it must be **SargeZT/sdxl-controlnet-seg**.

---

## 3. Sampling parameters

```yaml
default_controlnet_weights: { depth: 0.7, seg: 0.5 }
steps: 30
guidance: 7.0
strength: 0.7                 # img2img-style; SDXL controlnet ignores this for txt2img
output_size: [1024, 1024]
sd15_fallback_size: [768, 768]
extra_negative_en: "low resolution, jpeg artifacts, color banding"
lora_dir: "models/loras"
lora_filename_template: "dardesign-{culture}-lora.safetensors"
lora_scale: 0.8
```

**Weight precedence in `transform_room`:**
`controlnet_weights` argument → `_winner_weights(style)` from
`configs/sweep_winners.json` → the config default.

`sweep_winners.json` currently holds `[0.7, 0.5]` for `default`, `lebanese`, `khaleeji`
and `moroccan` — i.e. **the sweep did not differentiate the cultures.** Its own `_note`
says the values are *"hand-picked… Update these by eye when sweep contact sheets are
reviewed."*

> **ControlNet weights are tuned in config, not in code** — that is the point of
> `configs/`.

Server-side bounds (`guardrails.clamp_params`): `cn_depth ∈ [0.3, 1.3]`,
`cn_seg ∈ [0.2, 1.0]`, `steps ∈ [15, 45]`, `guidance ∈ [3.0, 12.0]`.

---

## 4. Pipeline loading and device strategy

`_load_pipeline` caches into `_PIPE_CACHE` keyed `"sdxl"` / `"sd15"`.
`dtype = float16` on CUDA, `float32` otherwise.

```
ControlNetModel.from_pretrained(depth_key)
   │
   ├─ DARDESIGN_DEPTH_ONLY=1 → controlnet = depth_cn, has_seg = False  (~2.5 GB saved)
   ├─ try seg                → controlnet = [depth_cn, seg_cn]
   └─ seg load raises        → log + degrade to depth-only
   │
   ▼
StableDiffusionXLControlNetPipeline.from_pretrained(base_model, controlnet=…,
                                                    variant="fp16" if fp16)
   or StableDiffusionControlNetPipeline.from_pretrained(fallback_model, …,
                                                        safety_checker=None)
```

**Device strategy on CUDA:**

| Env | Behaviour |
|---|---|
| `DARDESIGN_GPU_RESIDENT=1` | `pipe.to("cuda")` + `enable_vae_slicing()` |
| default | `pipe.enable_model_cpu_offload()`, falling back to `.to(device)` |
| `DARDESIGN_SAFE_ATTENTION=1` | Attention slicing — **only on request.** The comment records it cost **4 min → 10+ min** on a T4 |
| always attempted | `enable_xformers_memory_efficient_attention()` (swallowed on failure) |

State object: `_LoadedPipe(pipe, is_sdxl, style_loaded, scale_loaded, has_seg)`.

---

## 5. LoRA — attachment and status

```python
_lora_path(style) = models/loras/<style>/dardesign-<style>-lora.safetensors
```

`_attach_lora(style, scale)`:
1. Early-return if `style_loaded == style and scale_loaded == scale`.
2. Otherwise **unfuse + unload** the previous adapter.
3. File missing → `style_loaded = None`, log a warning, **prompt-only fallback**
   (the trigger phrase still goes in).
4. File present → `pipe.load_lora_weights(state_dict, adapter_name=f"dardesign-{style}")`
   then `pipe.fuse_lora(lora_scale=scale)`.

Key remap `_peft_key_to_diffusers`: `base_model.model.<path>` → `unet.<path>`.

> **This hot-swap is exactly why `_GEN_LOCK` exists.** A second request arriving
> mid-swap corrupts the accelerate offload hooks (`_hf_hook` `AttributeError` on the T4).

### ⚠ Correction: all three LoRAs are trained and on disk

| Culture | File | Size | Modified |
|---|---|---|---|
| lebanese | `models/loras/lebanese/dardesign-lebanese-lora.safetensors` | 93,076,472 B | 2026-06-20 |
| khaleeji | `models/loras/khaleeji/dardesign-khaleeji-lora.safetensors` | 93,076,472 B | 2026-06-20 |
| moroccan | `models/loras/moroccan/dardesign-moroccan-lora.safetensors` | 93,076,472 B | 2026-06-20 |
| persian | — | — | **none** |

> **`CLAUDE.md` states *"Lebanese is trained; Khaleeji/Moroccan are prompt-only-acceptable
> per the cut order."* That is STALE.** All three files are present and identical in size
> (expected — same rank and architecture). `README.md`'s *"All three cultural LoRAs
> trained"* matches the filesystem.
>
> Weights are gitignored, so they exist on the developer's machine and must be shipped to
> the render host alongside the backend.

**Deployed Lebanese checkpoint is step1500**, verified by hash (2026-08-02).
`_save_checkpoint` copies *every* checkpoint over the canonical filename, so the last one
written (step1500) is what the file contains — the step1000 pick described in
`kaggle/TRAIN_NOW.md` §3 was never applied. Kept deliberately: step1500 generalises across
different input rooms in practice.
**No side-by-side step1000-vs-1500 comparison has been run — do not claim one.**

---

## 6. Training recipe — `scripts/train_lora.py`

**The problem:** a 16 GB T4 cannot hold SDXL for training. Loading the frozen base in
**fp32 OOMs**; in **fp16 it NaNs** (SDXL fp16 overflow).

**The recipe that works:**
```
Phase 1  cache image latents + text embeddings ONCE (fp16 VAE + both text encoders)
         → then FREE the VAE and text encoders
Phase 2  train only the fp32-master UNet + LoRA
         with autocast(fp16) + GradScaler
```

> The caching is what makes it **both fit and stay stable**. The frozen base's only job is
> encoding — once that is cached, it is dead weight.

| Parameter | Value |
|---|---|
| Rank | 16 |
| Steps | 1500 (checkpoints at 500 / 1000 / 1500) |
| Hardware | **Kaggle T4 x2, selected in the UI** |
| Dataset | `datasets/<culture>/{images, captions.jsonl}` |

> **The Kaggle *API* grants a P100 (sm_60), which cannot run SDXL fp16.** You must select
> **GPU T4 x2** in the Kaggle UI and use "Save & Run All (Commit)".
> `push_kernel.py` pushes a self-contained training kernel via the Kaggle REST API
> (KGAT bearer token — the old `kaggle` CLI cannot read it).

**Training data actually present:**

| Culture | Images |
|---|---|
| lebanese | **19** |
| khaleeji | **14** |
| moroccan | **12** |

Licensing audit: `datasets/LICENSING.csv`.

---

## 7. `_generate()` — the one function every path rides

```python
_generate(..., control_override: tuple|None = None, _fresh: bool = False)
```

| Concern | Behaviour |
|---|---|
| **LoRA** | `use_lora=True` → `_attach_lora`; `use_lora=False` → force unfuse/unload (ablation cleanliness) |
| **Conditioning** | `control_override` present → the caller's `(depth, seg)`, converted to RGB and resized. Otherwise `_prepare_conditioning(image_path, target)` |
| **Seed** | `torch.Generator(device).manual_seed(seed)` — **only when `seed is not None`** |
| **Dual vs single** | `has_seg` → `image=[depth, seg]`, `controlnet_conditioning_scale=list(weights)`; else `image=depth`, scalar scale |
| **SDXL extras** | `width` / `height` passed |
| **OOM detection** | `except RuntimeError` where `"out of memory" in str(e).lower() or "CUDA" in str(e)` → `raise _OutOfMemory` |
| **Offload-hook recovery** | `except AttributeError` where `"_hf_hook" in str(e)` and not `_fresh` → `_free_pipe` + one recursive retry with `_fresh=True` |

> ⚠ **Known latent risk:** the `_hf_hook` retry **does not forward `control_override`**.
> A Build Mode render hitting that path would silently re-derive conditioning from
> `image_path`. **No test covers it.**

### Seeds and job ids
`/redesign` derives the seed from the job id: `seed = int(job.id[:8], 16)`.
The **same seed** is passed to `build_prompts(...)`, so **prompt term sampling and the
diffusion generator share one seed** — same job, same prompt, same image.

---

## 8. OOM → SD 1.5 fallback

```python
try:
    _generate(use_sdxl=True,  size=fit_size(w, h, 1024))
except _OutOfMemory:
    _free_pipe("sdxl")
    _generate(use_sdxl=False, size=fit_size(w, h, 768))
```

`fit_size` rounds to multiples of 8 with a floor of 8.
`render_scene` has the identical two-arm structure. Any other exception in
`transform_room` becomes a bilingual `PipelineError("generation failed…", "فشلت عملية التوليد")`.

---

## 9. Provenance — the manifest

Every render writes `<out>.manifest.json`:

```json
{ "tool": …, "style": …, "model": "stabilityai/stable-diffusion-xl-base-1.0",
  "lora": "dardesign-lebanese-lora.safetensors" | null,
  "lora_scale": 0.8, "seed": 123456,
  "controlnet": { "depth": 0.7, "seg": 0.5 },
  "dual_controlnet": true, "use_lora": true, "use_sdxl": true,
  "light_mode": false,
  "output_sha256": …, "generated_at": … }
```

> **This is what makes provenance claims checkable rather than asserted.** The frontend's
> `storyGenerationMetadataFromManifest` distinguishes "absent" from "explicitly null"
> (`hasOwnProperty("lora")` preserves `null`), and
> `generationPipelineCapabilitiesFromMetadata` only claims `controlNet: true` when a depth
> or seg weight is `> 0`. → [14_EXPLAINABILITY.md](14_EXPLAINABILITY.md).

In LIGHT mode the manifest records `"model": "DARDESIGN_LIGHT placeholder",
"light_mode": true`.

---

## 10. The endpoints that ride this pipeline

| Endpoint | Conditioning source | LoRA | Cultures |
|---|---|---|---|
| `POST /redesign` | `_prepare_conditioning` from the photo | ✅ per culture, scale 0.8 | `CORE_STYLES` (3) |
| `POST /restyle` | `_prepare_conditioning` from the photo | ✅ **`scale` from the client**, clamped 0–1 | `StylePack` (4, incl. Persian) |
| `POST /render-scene` | **`control_override` from the 3D scene** | ✅ + optional `scale` | 3 (`"all"` → lebanese) |
| `POST /transform` | `_prepare_conditioning` | ✅ | 4 — **retired** async flow |

**`/restyle` is the LoRA-scale ablation made live** — the Style Intensity Slider maps
directly onto `lora_scale`. At `scale = 0` you are looking at prompt-only SDXL; at
`scale = 1` at the full cultural adapter. That is the ablation a jury would ask for,
exposed as a product feature.

---

## 11. GPU hosting architecture

```
Kaggle notebook (T4 x2, free tier, 15 GB usable)
   │  pip install -r backend/requirements.txt
   │  uvicorn backend.main:app
   │  cloudflared / ngrok  →  a NEW tunnel URL every session
   ▼
npm run dev:tunnel <url>     writes .env.local, probes /healthz, runs next dev on :3000
   │                          (refuses to fall back to :3001 — CORS allowlist is :3000)
   ▼
Browser  ──renders──▶ NEXT_PUBLIC_API_URL      (the tunnel)
         ──accounts─▶ NEXT_PUBLIC_DATA_API_URL (the local machine)
```

**Constraints this imposes, and which the architecture is shaped by:**

| Constraint | Architectural consequence |
|---|---|
| Free T4 only, 15 GB | fp16, model CPU offload, `DARDESIGN_DEPTH_ONLY` escape hatch, SD1.5 OOM fallback |
| Tunnel URL rotates each session | `dev:tunnel` one-command re-point; `NEXT_PUBLIC_API_URL` must stay swappable |
| Free tunnels 524 on slow first byte | `_stream_keepalive` every 10 s |
| GPU host is ephemeral and has no users table | The **two-backend split**; `/api/usage/consume` as a separate endpoint |
| No paid inference APIs | Everything self-hosted; the LLM planner is the one external call, and it has a rule-based fallback |

---

## 12. What must never be claimed

- ❌ **No FID / IS / KID has been computed.**
- ❌ **No LoRA-vs-baseline ablation results exist** — `eval/results.csv` **does not exist**
  and `evaluation_results` holds **0 rows**. The code path is implemented and the panel is
  deliberately removed from the page rather than shown empty.
  → [16_EVALUATION.md](16_EVALUATION.md)
- ❌ **No step1000-vs-step1500 comparison has been run.**
- ❌ **No per-culture ControlNet tuning was actually differentiated** — all four
  `sweep_winners.json` entries are `[0.7, 0.5]`.
- ❌ "Cultural accuracy of the LoRA has been validated." → 2 feedback rows exist.

---

Related: [05_CULTURAL_ONTOLOGY.md](05_CULTURAL_ONTOLOGY.md) ·
[11_RENDER_WITH_DAR.md](11_RENDER_WITH_DAR.md) ·
[12_DEPTH_AND_SEGMENTATION.md](12_DEPTH_AND_SEGMENTATION.md) ·
[16_EVALUATION.md](16_EVALUATION.md)
