"""Push a Kaggle kernel that finishes the remaining LoRA training: Khaleeji +
Moroccan, using the same proven recipe that trained Lebanese (latent + text-embed
caching, then fp32-master UNet + LoRA with autocast/GradScaler -> fits 16 GB T4,
no NaN). Saves each LoRA and attempts a best-effort text-to-image verification
render per culture (the "is it visibly <culture>?" check).

P100 aborts fast (API draws P100; the real run is the user's T4 commit)."""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ["KAGGLE_API_TOKEN"]
SLUG = "yasserhamdanfr/dardesign-train-rest"

KERNEL = r'''
import os, sys, subprocess, glob, json, random, pathlib

def sh(cmd, check=True):
    print("\n>>>", cmd, flush=True)
    r = subprocess.run(cmd, shell=True)
    if check and r.returncode != 0:
        sys.exit(f"FAILED ({r.returncode}): {cmd}")
    return r.returncode

import torch
assert torch.cuda.is_available()
name = torch.cuda.get_device_name(0); cap = torch.cuda.get_device_capability(0)
print(f"GPU: {name} (sm_{cap[0]}{cap[1]})", flush=True)
if cap[0] < 7:
    print(f"INCOMPATIBLE_GPU {name} -- need GPU T4 x2.", flush=True); sys.exit(7)

sh("pip install -q diffusers==0.31.0 transformers==4.46.3 peft==0.13.2 "
   "safetensors==0.4.5 accelerate==1.1.1")

# ---- find dataset ----
def gather(base):
    out = []
    for root, _d, files in os.walk(base):
        for fn in files:
            out.append(os.path.join(root, fn))
    return out
allf = []
for r in sorted(glob.glob("/kaggle/input/*")):
    allf += gather(r)
if not any("khaleeji" in f.replace("\\", "/").lower() for f in allf):
    import kagglehub
    allf = gather(kagglehub.dataset_download("yasserhamdanfr/dardesign-culture-datasets"))

import torch
from PIL import Image
from torchvision import transforms
from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel, StableDiffusionXLPipeline
from transformers import AutoTokenizer, CLIPTextModel, CLIPTextModelWithProjection
from peft import LoraConfig, get_peft_model
from peft.utils import get_peft_model_state_dict
from safetensors.torch import save_file

device = "cuda"
BASE = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"
tform = transforms.Compose([
    transforms.Resize(1024, interpolation=transforms.InterpolationMode.BILINEAR),
    transforms.CenterCrop(1024), transforms.ToTensor(), transforms.Normalize([0.5], [0.5]),
])

def load_pairs(cult, trig):
    img_by, caps = {}, None
    for f in allf:
        parts = [p for p in f.replace("\\", "/").split("/") if p]
        if cult not in parts:
            continue
        b = parts[-1]
        if b == "captions.jsonl":
            caps = f
        elif b.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            img_by[b] = f
    pairs = []
    for line in open(caps, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line); p = img_by.get(rec["file"])
        if not p:
            continue
        cap = rec.get("caption_en") or ""
        if trig not in cap:
            cap = f"{cap.rstrip(' .,;')}, in the {trig}".strip(" ,")
        pairs.append((p, cap))
    return pairs

def train_culture(cult, trig, steps=1500):
    print(f"\n========== TRAIN {cult} ==========", flush=True)
    pairs = load_pairs(cult, trig)
    print(f"{cult}: {len(pairs)} pairs", flush=True)
    assert pairs

    # PHASE 1: cache latents + embeds, free vae/text encoders
    tok1 = AutoTokenizer.from_pretrained(BASE, subfolder="tokenizer")
    tok2 = AutoTokenizer.from_pretrained(BASE, subfolder="tokenizer_2")
    te1 = CLIPTextModel.from_pretrained(BASE, subfolder="text_encoder", torch_dtype=torch.float16).to(device).eval()
    te2 = CLIPTextModelWithProjection.from_pretrained(BASE, subfolder="text_encoder_2", torch_dtype=torch.float16).to(device).eval()
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16).to(device).eval()
    cache = []
    with torch.no_grad():
        for path, cap in pairs:
            img = tform(Image.open(path).convert("RGB")).unsqueeze(0).to(device, torch.float16)
            lat = vae.encode(img).latent_dist.sample() * vae.config.scaling_factor
            embs, pooled = [], None
            for tk, te in ((tok1, te1), (tok2, te2)):
                ids = tk(cap, padding="max_length", truncation=True, max_length=77, return_tensors="pt").input_ids.to(device)
                out = te(ids, output_hidden_states=True)
                embs.append(out.hidden_states[-2])
                if getattr(out, "text_embeds", None) is not None:
                    pooled = out.text_embeds
            cache.append((torch.cat(embs, dim=-1).float().cpu(), lat.float().cpu(), pooled.float().cpu()))
    del te1, te2, vae, tok1, tok2; torch.cuda.empty_cache()
    print(f"{cult}: cached {len(cache)}", flush=True)

    # PHASE 2: train fp32 UNet + LoRA
    unet = UNet2DConditionModel.from_pretrained(BASE, subfolder="unet").to(device)
    unet.requires_grad_(False); unet.enable_gradient_checkpointing()
    unet = get_peft_model(unet, LoraConfig(r=16, lora_alpha=16, target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
    unet.train()
    sched = DDPMScheduler.from_pretrained(BASE, subfolder="scheduler")
    opt = torch.optim.AdamW([p for p in unet.parameters() if p.requires_grad], lr=1e-4)
    scaler = torch.cuda.amp.GradScaler()
    OUT = pathlib.Path(f"/kaggle/working/models/loras/{cult}"); OUT.mkdir(parents=True, exist_ok=True)
    tids = torch.tensor([[1024, 1024, 0, 0, 1024, 1024]], device=device, dtype=torch.float32)
    for step in range(1, steps + 1):
        pe, lat, pooled = random.choice(cache)
        lat = lat.to(device); pe = pe.to(device); pooled = pooled.to(device)
        noise = torch.randn_like(lat)
        t = torch.randint(0, sched.config.num_train_timesteps, (1,), device=device).long()
        noisy = sched.add_noise(lat, noise, t)
        with torch.autocast("cuda", dtype=torch.float16):
            pred = unet(noisy, t, pe, added_cond_kwargs={"text_embeds": pooled, "time_ids": tids}).sample
            loss = torch.nn.functional.mse_loss(pred.float(), noise.float())
        if not torch.isfinite(loss):
            sys.exit(f"NON_FINITE_LOSS {cult} step {step}")
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); opt.zero_grad(set_to_none=True)
        if step % 100 == 0:
            print(f"{cult} step {step}/{steps} loss={loss.item():.4f}", flush=True)
        if step in (500, 1000, steps):
            sd = {k: v.detach().cpu() for k, v in get_peft_model_state_dict(unet).items()}
            save_file(sd, str(OUT / f"dardesign-{cult}-lora-step{step}.safetensors"))
            save_file(sd, str(OUT / f"dardesign-{cult}-lora.safetensors"))
            print(f"{cult}: saved @ {step}", flush=True)
    del unet, opt, cache; torch.cuda.empty_cache()

    # PHASE 3 (best-effort): verify render
    try:
        pipe = StableDiffusionXLPipeline.from_pretrained(
            BASE, torch_dtype=torch.float16,
            vae=AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16))
        pipe.enable_model_cpu_offload()
        pipe.load_lora_weights(str(OUT), weight_name=f"dardesign-{cult}-lora.safetensors")
        pipe.set_progress_bar_config(disable=True)
        g = torch.Generator(device="cuda").manual_seed(42)
        for i, room in enumerate(["living room", "majlis"]):
            img = pipe(f"a {room} in the {trig}, photorealistic, magazine-quality, 8k, intricate detail",
                       num_inference_steps=25, guidance_scale=7.0, width=1024, height=1024, generator=g).images[0]
            img.save(str(OUT / f"verify-{cult}-{i}-{room.replace(' ', '_')}.png"))
            print(f"{cult}: rendered verify {i}", flush=True)
        del pipe; torch.cuda.empty_cache()
    except Exception as e:
        print(f"{cult}: verify render skipped -- {type(e).__name__}: {str(e)[:160]}", flush=True)

for cult, trig in [("khaleeji", "dardesign-khaleeji style"), ("moroccan", "dardesign-moroccan style")]:
    train_culture(cult, trig)

print("\n=== ALL_DONE ===", flush=True)
sh("ls -R /kaggle/working/models/loras", check=False)
'''

body = {
    "id": None, "slug": SLUG, "newTitle": "dardesign-train-rest",
    "text": KERNEL, "language": "python", "kernelType": "script",
    "isPrivate": True, "enableGpu": True, "enableTpu": False, "enableInternet": True,
    "datasetDataSources": ["yasserhamdanfr/dardesign-culture-datasets"],
    "competitionDataSources": [], "kernelDataSources": [], "modelDataSources": [],
    "categoryIds": [],
}
req = urllib.request.Request("https://www.kaggle.com/api/v1/kernels/push",
    data=json.dumps(body).encode("utf-8"),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.loads(resp.read().decode("utf-8"))
        print("HTTP", resp.status, "| version", out.get("versionNumber"), "| error:", out.get("error") or "(none)")
except urllib.error.HTTPError as e:
    print("HTTP", e.code); print(e.read().decode("utf-8")[:1500]); sys.exit(1)
