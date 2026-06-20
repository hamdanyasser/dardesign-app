"""Push a Kaggle T4 kernel that VERIFIES + EVALUATES the trained LoRAs:
  - loads each culture LoRA (peft round-trip) onto SDXL and renders style proofs
    (the qanater test: "is it visibly Lebanese / Khaleeji / Moroccan?"),
  - builds a CLIP zero-shot 3x3 confusion matrix (the headline thesis figure).
Attaches the two training kernels' outputs as inputs so it reads the LoRAs
directly. P100 aborts fast; the real run is the user's GPU-T4-x2 commit."""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ["KAGGLE_API_TOKEN"]
SLUG = "yasserhamdanfr/dardesign-verify"

KERNEL = r'''
import os, sys, subprocess, glob
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

# locate each culture's canonical LoRA from the attached kernel outputs
loras = {}
for f in glob.glob("/kaggle/input/**/*.safetensors", recursive=True):
    nf = f.replace("\\", "/")
    for c in TRIG:
        if f"/{c}/" in nf and nf.endswith(f"dardesign-{c}-lora.safetensors"):
            loras[c] = f
print("found LoRAs:", loras, flush=True)
assert loras, "no LoRAs found in /kaggle/input — attach the training kernels' outputs"

def make_grid(imgs, cols, cell=512):
    rows = (len(imgs) + cols - 1) // cols
    g = Image.new("RGB", (cols * cell, rows * cell), (24, 20, 16))
    for i, im in enumerate(imgs):
        g.paste(im.resize((cell, cell)), ((i % cols) * cell, (i // cols) * cell))
    return g

def render(cult, lora_path):
    unet = UNet2DConditionModel.from_pretrained(BASE, subfolder="unet", torch_dtype=torch.float16)
    unet = get_peft_model(unet, LoraConfig(r=16, lora_alpha=16, target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
    sd = load_file(lora_path)
    res = set_peft_model_state_dict(unet, sd)
    print(f"{cult}: loaded LoRA ({res})", flush=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        BASE, unet=unet, vae=AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16), torch_dtype=torch.float16)
    pipe.enable_model_cpu_offload(); pipe.set_progress_bar_config(disable=True)
    g = torch.Generator("cuda").manual_seed(42)
    imgs = []
    for room in ROOMS:
        prompt = f"a {room} in the {TRIG[cult]}, photorealistic, magazine-quality, 8k, intricate architectural detail"
        img = pipe(prompt, negative_prompt="blurry, lowres, watermark, text, people, deformed",
                   num_inference_steps=30, guidance_scale=7.0, width=1024, height=1024, generator=g).images[0]
        img.save(f"{OUT}/{cult}-{room.replace(' ', '_')}.png"); imgs.append(img)
        print(f"{cult}: rendered {room}", flush=True)
    make_grid(imgs, 4).save(f"{OUT}/GRID-{cult}.png")
    del pipe, unet; torch.cuda.empty_cache()
    return imgs

gen = {}
for c, p in loras.items():
    try:
        gen[c] = render(c, p)
    except Exception as e:
        print(f"{c}: RENDER FAILED -- {type(e).__name__}: {str(e)[:200]}", flush=True)

# ---- CLIP zero-shot confusion matrix (headline eval figure) ----
try:
    from transformers import CLIPModel, CLIPProcessor
    clip = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to("cuda").eval()
    proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    order = [c for c in ["lebanese", "khaleeji", "moroccan"] if c in gen]
    labels = [f"a {c} arabic interior" for c in order]
    mat = {t: {p: 0 for p in order} for t in order}
    with torch.no_grad():
        for true_c in order:
            for img in gen[true_c]:
                inp = proc(text=labels, images=img, return_tensors="pt", padding=True).to("cuda")
                probs = clip(**inp).logits_per_image.softmax(dim=1)[0]
                pred = order[int(probs.argmax())]
                mat[true_c][pred] += 1
    total = sum(sum(r.values()) for r in mat.values())
    diag = sum(mat[c][c] for c in order)
    lines = ["CLIP zero-shot confusion matrix (rows=true, cols=predicted)",
             "          " + "  ".join(f"{c[:5]:>6}" for c in order)]
    for t in order:
        lines.append(f"{t[:8]:>8}  " + "  ".join(f"{mat[t][p]:>6}" for p in order))
    lines.append(f"\nAccuracy: {diag}/{total} = {diag/total:.0%}  (near-diagonal => distinct traditions)")
    txt = "\n".join(lines)
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
