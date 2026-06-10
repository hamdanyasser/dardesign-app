"""One-shot smoke test: POST a generated room PNG to /redesign and report the
response shape (image keys, sizes, object_map contents). Dev helper, no pytest."""
import io
import json
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

BASE = "http://127.0.0.1:8000"


def make_room_png(w: int = 768, h: int = 512) -> bytes:
    """A simple synthetic 'room photo' (floor/wall split + window + sofa block)."""
    img = Image.new("RGB", (w, h), (188, 174, 152))
    d = ImageDraw.Draw(img)
    d.rectangle([0, int(h * 0.62), w, h], fill=(120, 96, 72))         # floor
    d.rectangle([int(w * 0.4), int(h * 0.1), int(w * 0.6), int(h * 0.45)], fill=(225, 235, 245))  # window
    d.rectangle([int(w * 0.08), int(h * 0.55), int(w * 0.38), int(h * 0.85)], fill=(90, 60, 50))  # sofa
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def post_multipart(url: str, field: str, filename: str, data: bytes) -> dict:
    boundary = "----dardesignsmoke"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())


def main() -> int:
    # wait for the server
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"{BASE}/healthz", timeout=2) as r:
                health = json.loads(r.read().decode())
            break
        except Exception:
            time.sleep(0.5)
    else:
        print("FAIL: backend never came up")
        return 1
    print("healthz:", health)

    t0 = time.time()
    resp = post_multipart(f"{BASE}/redesign", "file", "room.png", make_room_png())
    dt = time.time() - t0

    print(f"\n/redesign answered in {dt:.1f}s; keys = {sorted(resp.keys())}")
    ok = True
    for k in ("original", "lebanese", "khaleeji", "moroccan"):
        v = resp.get(k, "")
        good = isinstance(v, str) and v.startswith("data:image/png;base64,") and len(v) > 1000
        print(f"  {k:9s} data URL: {'OK' if good else 'BAD'} ({len(v)} chars)")
        ok &= good

    om = resp.get("object_map")
    if not om:
        print("  object_map: MISSING")
        ok = False
    else:
        objs = om.get("objects", [])
        print(f"  object_map: version={om.get('version')} jobId={om.get('jobId')} "
              f"placeholder={om.get('placeholder')} objects={len(objs)}")
        for o in objs:
            print(f"    - {o['classKey']:8s} {o['labelAr']:14s} "
                  f"cx={o['cx']:.2f} cy={o['cy']:.2f} w={o['w']:.2f} h={o['h']:.2f} "
                  f"area={o['area']:.4f} conf={o['confidence']:.2f}")
        ok &= len(objs) > 0
        ok &= all(0 <= o[k] <= 1 for o in objs for k in ("cx", "cy", "w", "h"))

    print("privacy_notice:", resp.get("privacy_notice", "")[:60], "…")
    print("\nRESULT:", "PASS — object_map present in /redesign response" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
