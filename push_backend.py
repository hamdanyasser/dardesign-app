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
sys.path.insert(0, REPO)  # chdir alone doesn't put the repo on script.py's sys.path — uvicorn imports backend.main in-process

# deps: keep Kaggle's preinstalled ABI-coupled stack (torch, numpy 2.x, scipy,
# opencv, pillow, scikit-image) — force-downgrading numpy corrupts the install
# ("No module named numpy.char") because Kaggle's scipy/opencv are built
# against numpy 2. Install only the pure-python/diffusion pins on top.
subprocess.run(
    "sed -i '/^torch==/d;/^torchvision==/d;"
    "/^numpy==/d;/^scipy==/d;/^opencv-python-headless==/d;"
    "/^pillow==/d;/^scikit-image==/d' backend/requirements.txt",
    shell=True, check=True,
)
subprocess.run("pip install -q -r backend/requirements.txt pyngrok 2>/dev/null; pip install -q -r backend/requirements.txt", shell=True)
# The backend does not use bitsandbytes; remove a Kaggle preinstall so it cannot
# introduce an unrelated CUDA/ABI import failure into the serving process.
subprocess.run("pip uninstall -y bitsandbytes", shell=True)
# Fail LOUDLY here rather than as a silent dead healthz later.
subprocess.run('python -c "import numpy, scipy, torch; print(\'sanity:\', numpy.__version__, scipy.__version__, torch.__version__)"', shell=True, check=True)
# In-process, not a subprocess: exactly the import uvicorn will do (a python -c
# check adds its own cwd to sys.path and can pass while the real import fails).
import backend.main  # noqa: F401
print("backend imports OK", flush=True)

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

# start the REAL backend (NOT light) as a SUBPROCESS so the auto-deploy
# watchdog below can restart it after a git pull (python -m puts cwd on
# sys.path, exactly like running uvicorn from the repo root locally)
_ENV = dict(os.environ, DARDESIGN_ALLOWED_ORIGINS="*")
_ENV.pop("DARDESIGN_LIGHT", None)
_server = None
def _start_server():
    global _server
    _server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"],
        cwd=REPO, env=_ENV,
    )
_start_server()
time.sleep(12)
subprocess.run("curl -s http://localhost:8000/healthz", shell=True)

# WARM-UP: pull SDXL + ControlNet + annotators and run one full render NOW, so
# the first demo request over the tunnel is fast instead of eating the downloads.
import io, requests
from PIL import Image as _Img
_buf = io.BytesIO(); _Img.new("RGB", (768, 768), (150, 130, 110)).save(_buf, "JPEG"); _buf.seek(0)
_t0 = time.time()
try:
    _r = requests.post("http://localhost:8000/restyle",
                       files={"file": ("warmup.jpg", _buf, "image/jpeg")},
                       data={"style": "lebanese", "scale": "0.8"}, timeout=1800)
    print("\nwarm-up render %s in %.0fs -- pipeline hot\n"
          % ("OK" if _r.ok else "HTTP %s" % _r.status_code, time.time() - _t0), flush=True)
except Exception as _e:
    print("\nwarm-up render FAILED after %.0fs: %s -- first real request will be slow\n"
          % (time.time() - _t0, _e), flush=True)

# AUTO-DEPLOY watchdog: a git push to the branch redeploys THIS session in
# ~60s behind the SAME tunnel URL — no more stop -> Save & Run All -> new-URL
# cycles for code fixes. (A requirements.txt change still needs a fresh run.)
BRANCH = "feat/cinematic-merge"
def _watchdog():
    while True:
        time.sleep(60)
        try:
            subprocess.run(f"git fetch --depth 1 origin {BRANCH}", shell=True, cwd=REPO,
                           check=True, capture_output=True)
            rev = lambda r: subprocess.run(f"git rev-parse {r}", shell=True, cwd=REPO,
                                           capture_output=True, text=True).stdout.strip()
            local, remote = rev("HEAD"), rev(f"origin/{BRANCH}")
            if local and remote and local != remote:
                print(f"\nAUTO-DEPLOY: {local[:7]} -> {remote[:7]} — pulling + restarting backend", flush=True)
                subprocess.run(f"git reset --hard origin/{BRANCH}", shell=True, cwd=REPO, check=True)
                _server.terminate()
                try:
                    _server.wait(timeout=30)
                except Exception:
                    _server.kill()
                _start_server()
                time.sleep(15)
                subprocess.run("curl -s http://localhost:8000/healthz", shell=True)
                print("\nAUTO-DEPLOY: backend restarted — same tunnel URL still valid\n", flush=True)
        except Exception as e:
            print("watchdog error:", e, flush=True)
threading.Thread(target=_watchdog, daemon=True).start()

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
    # enableGpu False on purpose: an API push always auto-starts a batch run,
    # and API runs get a P100 (can't do SDXL fp16). CPU-only makes that
    # auto-run die in seconds on the cuda assert; the real run is started in
    # the Kaggle UI with GPU T4 x2 selected in Session options.
    "isPrivate": True, "enableGpu": False, "enableTpu": False, "enableInternet": True,
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
