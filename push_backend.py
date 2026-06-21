"""Push a Kaggle T4 kernel that serves the REAL DarDesign backend (SDXL + dual
ControlNet + the 3 trained LoRAs) over a free cloudflared tunnel (no token).

Run it INTERACTIVELY on Kaggle (open the kernel -> GPU T4 x2 -> Run All): it
loads the LoRAs, starts FastAPI, opens a public https://*.trycloudflare.com URL,
and prints it. Paste that URL back and the local Next.js app drives the T4 -> the
studio returns REAL Lebanese/Khaleeji/Moroccan redesigns of an uploaded room.

Attaches the two training kernels' outputs so the LoRAs are present."""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ["KAGGLE_API_TOKEN"]
SLUG = "yasserhamdanfr/dardesign-backend"

KERNEL = r'''
import os, sys, subprocess, glob, shutil, threading, time, pathlib

import torch
assert torch.cuda.is_available()
print("GPU:", torch.cuda.get_device_name(0), flush=True)

REPO = "/kaggle/working/repo"
subprocess.run(f"rm -rf {REPO}; git clone --depth 1 -b feat/cinematic-merge https://github.com/hamdanyasser/dardesign-app.git {REPO}", shell=True, check=True)
os.chdir(REPO)

# deps: T4 ships torch; drop it + bitsandbytes (broken triton). Keep the real stack.
subprocess.run("sed -i '/^torch==/d;/^torchvision==/d;/^bitsandbytes/d' backend/requirements.txt", shell=True, check=True)
subprocess.run("pip install -q -r backend/requirements.txt pyngrok 2>/dev/null; pip install -q -r backend/requirements.txt", shell=True)
subprocess.run("pip uninstall -y bitsandbytes", shell=True)

# pull the 3 trained LoRAs from the attached training-kernel outputs into models/loras/<cult>/
for cult in ("lebanese", "khaleeji", "moroccan"):
    dst = pathlib.Path(f"models/loras/{cult}"); dst.mkdir(parents=True, exist_ok=True)
    hit = None
    for f in glob.glob("/kaggle/input/**/*.safetensors", recursive=True):
        nf = f.replace("\\", "/")
        if f"/{cult}/" in nf and nf.endswith(f"dardesign-{cult}-lora.safetensors"):
            hit = f; break
    if hit:
        shutil.copy(hit, dst / f"dardesign-{cult}-lora.safetensors")
        print(f"LoRA {cult}: {hit}", flush=True)
    else:
        print(f"LoRA {cult}: MISSING (will fall back to prompt-only)", flush=True)

# start the REAL backend (NOT light) in a background thread
os.environ["DARDESIGN_ALLOWED_ORIGINS"] = "*"
os.environ.pop("DARDESIGN_LIGHT", None)
import uvicorn
def _serve():
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, log_level="warning")
threading.Thread(target=_serve, daemon=True).start()
time.sleep(12)
subprocess.run("curl -s http://localhost:8000/healthz", shell=True)
print("\n(backend up; first /redesign downloads SDXL+ControlNet -> slow, ~1-2 min/style on T4)\n", flush=True)

# free public tunnel via cloudflared (no account/token needed)
subprocess.run("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /tmp/cf && chmod +x /tmp/cf", shell=True)
import re
cf = subprocess.Popen(["/tmp/cf", "tunnel", "--url", "http://localhost:8000", "--no-autoupdate"],
                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
_url = None
for line in cf.stdout:           # blocks here -> keeps the kernel + tunnel alive
    print(line, end="", flush=True)
    m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
    if m and not _url:
        _url = m.group(0)
        pathlib.Path("/kaggle/working/TUNNEL_URL.txt").write_text(_url)
        banner = "\n".join(["", "=" * 72,
                            "   BACKEND URL  ->  copy this line and send it:",
                            "        " + _url,
                            "   (also saved to the Output panel as  TUNNEL_URL.txt)",
                            "=" * 72, ""])
        for _ in range(5):
            print(banner, flush=True)
'''

body = {
    "id": None, "slug": SLUG, "newTitle": "dardesign-backend",
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
              "| url: https://www.kaggle.com/code/yasserhamdanfr/dardesign-backend")
except urllib.error.HTTPError as e:
    print("HTTP", e.code); print(e.read().decode("utf-8")[:1500]); sys.exit(1)
