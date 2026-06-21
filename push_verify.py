"""Push a Kaggle T4 kernel that VERIFIES + EVALUATES the trained LoRAs:
  - renders style proofs per culture WITH the trained LoRA (the qanater test),
  - renders prompt-only baselines (NO LoRA) for the same prompts (the --no-lora
    ablation),
  - builds a CLIP zero-shot 3x3 confusion matrix for BOTH and reports the
    accuracy delta (trained-LoRA distinctiveness vs prompt-only) -- the single
    strongest thesis figure.
Attaches the two training kernels' outputs as inputs to read the LoRAs.
P100 aborts fast; the real run is the user's GPU-T4-x2 commit."""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ["KAGGLE_API_TOKEN"]
SLUG = "yasserhamdanfr/dardesign-verify"

KERNEL = r'''
import os, sys, subprocess, glob, gc
import torch

assert torch.cuda.is_available()
name = torch.cuda.get_device_name(0); cap = torch.cuda.get_device_capability(0)
print(f"GPU: {name} (sm_{cap[0]}{cap[1]})", flush=True)
if cap[0] < 7:
    print(f"INCOMPATIBLE_GPU {name} -- need GPU T4 x2.", flush=True); sys.exit(7)

subprocess.run("pip install -q diffusers==0.31.0 transformers==4.46.3 peft==0.13.2 safetensors==0.4.5", shell=True, check=True)

from PIL import Image
from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, AutoencoderKL
from peft import LoraConfig, get_peft_model
try:
    from peft import set_peft_model_state_dict
except Exception:
    from peft.utils.save_and_load import set_peft_model_state_dict
from safetensors.torch import load_file

BASE = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"
OUT = "/kaggle/working/verify"; os.makedirs(OUT, exist_ok=True)
TRIG = {"lebanese": "dardesign-lebanese style", "khaleeji": "dardesign-khaleeji style", "moroccan": "dardesign-moroccan style"}
ROOMS = ["living room", "majlis", "bedroom", "courtyard"]
NEG = "blurry, lowres, watermark, text, people, deformed"

def free():
    gc.collect(); torch.cuda.empty_cache()

def prompts_for(cult):
    return [f"a {r} in the {TRIG[cult]}, photorealistic, magazine-quality, 8k, intricate architectural detail" for r in ROOMS]

# locate each culture's canonical LoRA from the attached kernel outputs
loras = {}
for f in glob.glob("/kaggle/input/**/*.safetensors", recursive=True):
    nf = f.replace("\\", "/")
    for c in TRIG:
        if f"/{c}/" in nf and nf.endswith(f"dardesign-{c}-lora.safetensors"):
            loras[c] = f
order = [c for c in ["lebanese", "khaleeji", "moroccan"] if c in loras]
print("found LoRAs:", loras, flush=True)
assert loras, "no LoRAs found in /kaggle/input — attach the training kernels' outputs"

def make_grid(imgs, cols, cell=512):
    rows = (len(imgs) + cols - 1) // cols
    g = Image.new("RGB", (cols * cell, rows * cell), (24, 20, 16))
    for i, im in enumerate(imgs):
        g.paste(im.resize((cell, cell)), ((i % cols) * cell, (i // cols) * cell))
    return g

def base_pipe(unet=None):
    kw = dict(torch_dtype=torch.float16, vae=AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16))
    if unet is not None:
        kw["unet"] = unet
    p = StableDiffusionXLPipeline.from_pretrained(BASE, **kw)
    p.enable_model_cpu_offload(); p.set_progress_bar_config(disable=True)
    return p

def render(pipe, cult, tag):
    g = torch.Generator("cuda").manual_seed(42)
    imgs = []
    for r, prompt in zip(ROOMS, prompts_for(cult)):
        img = pipe(prompt, negative_prompt=NEG, num_inference_steps=30, guidance_scale=7.0,
                   width=1024, height=1024, generator=g).images[0]
        img.save(f"{OUT}/{tag}-{cult}-{r.replace(' ', '_')}.png"); imgs.append(img)
    make_grid(imgs, 4).save(f"{OUT}/GRID-{tag}-{cult}.png")
    print(f"{tag} {cult}: rendered {len(imgs)}", flush=True)
    return imgs

# ---- Phase A: prompt-only baselines (NO LoRA) — the --no-lora ablation ----
gen_base = {}
try:
    pipe = base_pipe()
    for c in order:
        gen_base[c] = render(pipe, c, "promptonly")
    del pipe; free()
except Exception as e:
    print(f"prompt-only phase failed -- {type(e).__name__}: {str(e)[:200]}", flush=True)

# ---- Phase B: trained-LoRA renders ----
gen_lora = {}
for c in order:
    try:
        unet = UNet2DConditionModel.from_pretrained(BASE, subfolder="unet", torch_dtype=torch.float16)
        unet = get_peft_model(unet, LoraConfig(r=16, lora_alpha=16, target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
        set_peft_model_state_dict(unet, load_file(loras[c]))
        pipe = base_pipe(unet=unet)
        gen_lora[c] = render(pipe, c, "lora")
        del pipe, unet; free()
    except Exception as e:
        print(f"lora {c}: failed -- {type(e).__name__}: {str(e)[:200]}", flush=True)

# ---- Phase C: CLIP zero-shot confusion matrices (LoRA vs prompt-only) ----
def confusion(gen, clip, proc, order):
    labels = [f"a {c} arabic interior" for c in order]
    mat = {t: {p: 0 for p in order} for t in order}
    with torch.no_grad():
        for true_c in order:
            for img in gen.get(true_c, []):
                inp = proc(text=labels, images=img, return_tensors="pt", padding=True).to("cuda")
                pred = order[int(clip(**inp).logits_per_image.softmax(dim=1)[0].argmax())]
                mat[true_c][pred] += 1
    total = sum(sum(r.values()) for r in mat.values()) or 1
    diag = sum(mat[c][c] for c in order)
    return mat, diag, total

def fmt(title, mat, diag, total, order):
    lines = [title, "          " + "  ".join(f"{c[:5]:>6}" for c in order)]
    for t in order:
        lines.append(f"{t[:8]:>8}  " + "  ".join(f"{mat[t][p]:>6}" for p in order))
    lines.append(f"accuracy: {diag}/{total} = {diag/total:.0%}")
    return "\n".join(lines)

try:
    from transformers import CLIPModel, CLIPProcessor
    clip = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to("cuda").eval()
    proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    report = ["DarDesign cultural-distinctiveness evaluation (CLIP zero-shot, rows=true cols=pred)\n"]
    if gen_lora:
        m, d, tot = confusion(gen_lora, clip, proc, order)
        report.append(fmt("== TRAINED LoRA ==", m, d, tot, order)); la = d / tot
    if gen_base:
        m, d, tot = confusion(gen_base, clip, proc, order)
        report.append(fmt("== PROMPT-ONLY (no LoRA, ablation) ==", m, d, tot, order)); ba = d / tot
    if gen_lora and gen_base:
        report.append(f"\n>>> LoRA {la:.0%} vs prompt-only {ba:.0%}  (delta {la-ba:+.0%}) — "
                      f"{'LoRA is more culturally distinguishable' if la >= ba else 'inconclusive on this sample'}")
    txt = "\n\n".join(report)
    open(f"{OUT}/confusion_matrix.txt", "w").write(txt)
    print("\n" + txt, flush=True)
except Exception as e:
    print(f"CLIP matrix skipped -- {type(e).__name__}: {str(e)[:200]}", flush=True)

print("\n=== ALL_DONE ===", flush=True)
subprocess.run("ls -la " + OUT, shell=True)
'''

body = {
    "id": None, "slug": SLUG, "newTitle": "dardesign-verify",
    "text": KERNEL, "language": "python", "kernelType": "script",
    "isPrivate": True, "enableGpu": True, "enableTpu": False, "enableInternet": True,
    "datasetDataSources": [], "competitionDataSources": [],
    "kernelDataSources": ["yasserhamdanfr/dardesign-train-lebanese", "yasserhamdanfr/dardesign-train-rest"],
    "modelDataSources": [], "categoryIds": [],
}
req = urllib.request.Request("https://www.kaggle.com/api/v1/kernels/push",
    data=json.dumps(body).encode("utf-8"),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.loads(resp.read().decode("utf-8"))
        print("HTTP", resp.status, "| version", out.get("versionNumber"), "| error:", out.get("error") or "(none)",
              "| invalidKernelSources:", out.get("invalidKernelSources"))
except urllib.error.HTTPError as e:
    print("HTTP", e.code); print(e.read().decode("utf-8")[:1500]); sys.exit(1)
