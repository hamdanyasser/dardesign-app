#!/usr/bin/env python3
"""Fetch the CC0 3D models and PBR textures Build Mode renders with.

Everything here is CC0-1.0 from two sources, and every file that lands is
recorded in public/ASSET-LICENSES.md with its author and origin URL. Nothing
is downloaded that cannot be redistributed inside this repository.

Run it from the repo root:

    python scripts/fetch_design_assets.py            # fetch what is missing
    python scripts/fetch_design_assets.py --force    # re-fetch everything
    python scripts/fetch_design_assets.py --list     # print the plan, fetch nothing

It is idempotent: a file already on disk is left alone unless --force.

------------------------------------------------------------------------------
WHY SO FEW MODELS
------------------------------------------------------------------------------
Poly Haven has 153 CC0 furniture and prop scans and ambientCG has hundreds of
CC0 materials, but between them there is not one Lebanese, Khaleeji or Moroccan
piece of furniture. The nearest are Chinese and Western. Standing a mid-century
lounge chair in for a majlis armchair would be a cultural claim DAR cannot
support, so MODELS holds only assets that honestly ARE the object they
represent -- brass vessels and an upholstered footstool. Everything culturally
specific is authored geometry in src/lib/design/geometry.ts instead, and the
inspector labels which is which.

------------------------------------------------------------------------------
WHY THE COLOUR MAPS ARE GREYSCALE
------------------------------------------------------------------------------
materials.ts takes every colour from ontology.json's own per-culture palette --
Moroccan cobalt is #0040c0 because the Moroccan profile says "cobalt Majorelle
blue". A full-colour albedo photograph would throw that away and replace the
sourced palette with whatever the texture happened to be shot under.

So the colour map is converted to greyscale DETAIL and multiplied against the
ontology colour by three (material.color * map). A greyscale multiply cannot
shift hue or saturation -- only value -- which is exactly the property
backend/recolor.py relies on when it repaints a wall. The palette survives the
renderer, and the surface gains real grain, weave and veining.

Normal and roughness maps carry no colour, so they are kept at full fidelity.
"""

from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

try:
    from PIL import Image, ImageStat
except ImportError:  # pragma: no cover - dependency is in backend/requirements
    print("Pillow is required: pip install Pillow", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "models"
TEX_DIR = ROOT / "public" / "textures"
MANIFEST = ROOT / "public" / "ASSET-LICENSES.md"

# A plain browser UA. api.polyhaven.com answers 403 to urllib's default.
UA = {"User-Agent": "Mozilla/5.0 (compatible; DarDesign asset fetcher)"}

TEXTURE_PX = 512   # plenty at the size furniture occupies on screen
JPEG_Q = 82

# --------------------------------------------------------------------------
# What we fetch
# --------------------------------------------------------------------------

# Poly Haven ids. Only objects that honestly are what they stand in for.
MODELS: dict[str, str] = {
    "Ottoman_01": "leb-ottoman-001, the upholstered footstool. A real scanned "
                  "leather footstool, named as itself in the inspector.",
}

# ambientCG material id -> (DAR material key, which maps to keep)
# The DAR key is the one in src/lib/design/materials.ts.
TEXTURES: dict[str, str] = {
    "limestone": "Travertine009",
    "tadelakt": "Plaster001",
    "gypsum": "PaintedPlaster017",
    "sand": "Plaster002",
    "marble": "Marble012",
    "cedar": "Wood092",
    "walnut": "Wood027",
    "linen": "Fabric061",
    "velvet": "Fabric030",
    "leather": "Leather037",
    "wool": "Carpet016",
    "brass": "Metal009",
    "agedBrass": "Metal009",
    "iron": "Metal012",
}

# ambientCG map-name fragments -> our filename. Only these are kept.
#
# No ambient-occlusion map: three's aoMap samples the SECOND uv set, and the
# procedural geometry here is built from BoxGeometry/CylinderGeometry, which
# ship only `uv`. An aoMap would silently do nothing. Image-based lighting
# (Phase 5) covers the same ground properly.
MAP_KINDS = {
    "_Color": "detail",        # -> greyscale modulation, see module docstring
    "_NormalGL": "normal",     # carries no colour, kept as-is
    "_Roughness": "rough",     # -> modulation around 1.0, see normalise()
}


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

def fetch_model(asset_id: str, force: bool) -> dict | None:
    """Download the 1k glTF set into public/models/<id>/.

    Kept as a .gltf directory rather than converted to a single .glb: GLTFLoader
    resolves the relative .bin and textures itself, so there is no build step
    and no extra dependency to justify in an FYP.
    """
    dest = MODEL_DIR / asset_id
    gltf_name = f"{asset_id}_1k.gltf"
    if dest.exists() and (dest / gltf_name).exists() and not force:
        print(f"  = {asset_id} (already present)")
        return read_model_record(asset_id)

    try:
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset_id}"))
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset_id}"))
    except urllib.error.URLError as e:
        print(f"  ! {asset_id}: {e}", file=sys.stderr)
        return None

    entry = files.get("gltf", {}).get("1k", {}).get("gltf")
    if not entry:
        print(f"  ! {asset_id}: no 1k gltf variant", file=sys.stderr)
        return None

    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    (dest / gltf_name).write_bytes(fetch(entry["url"]))
    total += entry.get("size", 0)
    for rel, meta in entry.get("include", {}).items():
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(fetch(meta["url"]))
        total += meta.get("size", 0)

    authors = ", ".join(info.get("authors", {}).keys()) or "Poly Haven"
    print(f"  + {asset_id}  ({total/1024:.0f} KB)  by {authors}")
    return {
        "assetId": asset_id,
        "name": info.get("name", asset_id),
        "authors": authors,
        "path": f"models/{asset_id}/{gltf_name}",
        "source": f"https://polyhaven.com/a/{asset_id}",
        "license": "CC0-1.0",
        "bytes": total,
    }


def read_model_record(asset_id: str) -> dict:
    """Rebuild the manifest row for an asset already on disk."""
    d = MODEL_DIR / asset_id
    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
    return {
        "assetId": asset_id,
        "name": asset_id.replace("_", " "),
        "authors": "see polyhaven.com",
        "path": f"models/{asset_id}/{asset_id}_1k.gltf",
        "source": f"https://polyhaven.com/a/{asset_id}",
        "license": "CC0-1.0",
        "bytes": total,
    }


# --------------------------------------------------------------------------
# Textures
# --------------------------------------------------------------------------

def normalise(img: Image.Image, mean_target: float, std_target: float,
              floor: float, max_gain: float = 6.0) -> Image.Image:
    """Photograph -> greyscale MODULATION map with a predictable mean and spread.

    Both maps we keep are multiplied by something the project already decided:
    the colour map multiplies the culture's palette colour, and the roughness
    map multiplies the roughness scalar authored in materials.ts. So neither
    may carry its own absolute level -- what is wanted from the photograph is
    its *variation*, re-centred on a known mean.

    Contrast is normalised by standard deviation rather than scaled by a fixed
    factor. A fixed factor was tried first and flattened half the set to bare
    grey, because these sources start with wildly different variance: polished
    marble has veins, a plain fabric weave has almost nothing. Targeting the
    output spread instead gives every material comparable, visible grain.
    """
    g = img.convert("L")
    stat = ImageStat.Stat(g)
    mean = (stat.mean[0] / 255.0) or 0.5
    std = (stat.stddev[0] / 255.0) or 0.0
    gain = min(max_gain, std_target / std) if std > 1e-4 else 1.0
    lut = []
    for i in range(256):
        v = (i / 255.0 - mean) * gain + mean_target
        lut.append(int(round(255 * max(floor, min(1.0, v)))))
    return g.point(lut)


def to_detail(img: Image.Image) -> Image.Image:
    """Colour photograph -> greyscale detail that multiplies the ontology colour.

    Hue and saturation are untouched by construction: a greyscale multiply can
    only move value, which is the same property backend/recolor.py relies on.
    """
    return normalise(img, mean_target=0.86, std_target=0.11, floor=0.40)


def to_roughness(img: Image.Image) -> Image.Image:
    """Roughness photograph -> modulation around ~1.0.

    Passed through raw this breaks the material vocabulary outright: three
    computes roughness = material.roughness * roughnessMap.g, and Travertine009
    ships a near-black roughness map, so limestone -- authored at 0.92, i.e.
    almost matte -- would render as polished stone. Re-centred near 1.0 the
    authored scalar still decides how rough the surface is, and the photograph
    only says where it varies.
    """
    return normalise(img, mean_target=0.95, std_target=0.09, floor=0.55)


def fetch_texture(key: str, acg_id: str, force: bool) -> dict | None:
    dest = TEX_DIR / key
    if dest.exists() and (dest / "detail.jpg").exists() and not force:
        print(f"  = {key} <- {acg_id} (already present)")
        return {"key": key, "assetId": acg_id, "source": f"https://ambientcg.com/view?id={acg_id}",
                "license": "CC0-1.0", "maps": sorted(p.stem for p in dest.glob("*.jpg")),
                "bytes": sum(f.stat().st_size for f in dest.glob("*.jpg"))}

    url = f"https://ambientcg.com/get?file={acg_id}_1K-JPG.zip"
    try:
        blob = fetch(url, timeout=300)
    except urllib.error.URLError as e:
        print(f"  ! {key} <- {acg_id}: {e}", file=sys.stderr)
        return None

    dest.mkdir(parents=True, exist_ok=True)
    written, total = [], 0
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():
            for frag, out_name in MAP_KINDS.items():
                if frag not in name or not name.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                with z.open(name) as fh:
                    img = Image.open(io.BytesIO(fh.read()))
                    img.load()
                img = img.resize((TEXTURE_PX, TEXTURE_PX), Image.LANCZOS)
                if out_name == "detail":
                    img = to_detail(img)
                elif out_name == "rough":
                    img = to_roughness(img)
                else:
                    img = img.convert("RGB")
                out = dest / f"{out_name}.jpg"
                img.save(out, "JPEG", quality=JPEG_Q, optimize=True)
                written.append(out_name)
                total += out.stat().st_size
                break

    if "detail" not in written:
        print(f"  ! {key} <- {acg_id}: no colour map in archive", file=sys.stderr)
        shutil.rmtree(dest, ignore_errors=True)
        return None

    print(f"  + {key:12s} <- {acg_id:20s} {','.join(sorted(written)):28s} {total/1024:.0f} KB")
    return {"key": key, "assetId": acg_id, "source": f"https://ambientcg.com/view?id={acg_id}",
            "license": "CC0-1.0", "maps": sorted(written), "bytes": total}


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------

def write_manifest(models: list[dict], textures: list[dict]) -> None:
    mb = sum(m["bytes"] for m in models) / 1e6
    tb = sum(t["bytes"] for t in textures) / 1e6
    lines = [
        "# Third-party assets in DAR Build Mode",
        "",
        f"Generated by `scripts/fetch_design_assets.py` on {date.today().isoformat()}.",
        "",
        "Every asset below is **CC0 1.0 Universal** (public domain dedication): free to",
        "use, modify and redistribute, commercially or not, with no attribution",
        "required. Attribution is recorded here anyway, because a dissertation should",
        "say where its material came from.",
        "",
        "## 3D models",
        "",
        "Source: [Poly Haven](https://polyhaven.com/) — CC0.",
        "",
        "There is no CC0 library of Lebanese, Khaleeji or Moroccan furniture. Rather",
        "than dress a Western or Chinese scan up as an Arab piece, only objects that",
        "honestly are what they represent are used here; everything culturally",
        "specific is geometry authored from DAR's own ontology. Build Mode labels each",
        "piece REAL MODEL / ENHANCED PROCEDURAL / FALLBACK MASSING so the distinction",
        "is visible in the product, not just in this file.",
        "",
        "| Asset | Author(s) | Used for | Size | Source |",
        "|---|---|---|---|---|",
    ]
    for m in models:
        lines.append(
            f"| {m['name']} | {m['authors']} | {MODELS.get(m['assetId'], '').split('.')[0]} "
            f"| {m['bytes']/1024:.0f} KB | [{m['assetId']}]({m['source']}) |"
        )
    lines += [
        "",
        "## PBR textures",
        "",
        "Source: [ambientCG](https://ambientcg.com/) — CC0.",
        "",
        "Downsampled to "
        f"{TEXTURE_PX}px JPEG. The colour map of each set is converted to a **greyscale",
        "detail map**: it multiplies the culture's own palette colour from",
        "`ontology/ontology.json` rather than replacing it, so a Moroccan cobalt",
        "surface stays cobalt and only gains grain. A greyscale multiply cannot shift",
        "hue or saturation. Normal and roughness maps carry no colour and are kept as-is.",
        "",
        "| DAR material | ambientCG asset | Maps | Size | Source |",
        "|---|---|---|---|---|",
    ]
    for t in textures:
        lines.append(
            f"| `{t['key']}` | {t['assetId']} | {', '.join(t['maps'])} "
            f"| {t['bytes']/1024:.0f} KB | [{t['assetId']}]({t['source']}) |"
        )
    lines += [
        "",
        f"**Total:** {len(models)} model{'' if len(models) == 1 else 's'} ({mb:.1f} MB) "
        f"+ {len(textures)} texture set{'' if len(textures) == 1 else 's'} ({tb:.1f} MB).",
        "",
        "## Not used, and why",
        "",
        "Roughly twenty CC0 scans were downloaded and inspected side by side against",
        "DAR's own catalogue art before this list was cut to one.",
        "",
        "`chinese_armchair`, `chinese_cabinet`, `chinese_sofa`,",
        "`mid_century_lounge_chair` and `Sofa_01` are fine scans and none of them is",
        "Lebanese, Khaleeji or Moroccan. Using them would have made the cultural claim",
        "false in exactly the place this project argues it is true.",
        "",
        "The closer calls were rejected for the same reason, and they are the",
        "interesting ones:",
        "",
        "- `Lantern_01`, `wooden_lantern_01`, `brass_diya_lantern` — Western storm",
        "  lanterns and an Indian diya stand. `mor-lantern-001` is a pierced brass star",
        "  lantern; the piercing *is* the cultural signal, and none of these have it.",
        "- `brass_pot_01`, `brass_vase_01` — real, handsome brass vessels, but plain.",
        "  `khal-incense-001` is a pierced mabkhara with a domed finial on four splayed",
        "  feet. A plain pot is the right material and the wrong object.",
        "- `Ottoman_01` for `khal-ottoman-001` or `mor-pouf-001` — it is a square dark",
        "  leather footstool. The Khaleeji piece is a tufted round pouf on a brass",
        "  plinth and the Moroccan one is a tan leather pouf with radial stitching.",
        "",
        "The conclusion worth recording: DAR's catalogue art, generated by its own",
        "per-culture LoRAs, is **more** culturally specific than anything available",
        "under CC0. So Build Mode authors its culturally-specific geometry to match",
        "that art instead, and the model loader exists so a commissioned or purchased",
        "asset can be dropped in later as a one-line edit to",
        "`ontology/furniture_models.json`.",
        "",
    ]
    MANIFEST.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nmanifest -> {MANIFEST.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-fetch assets already on disk")
    ap.add_argument("--list", action="store_true", help="print the plan and exit")
    args = ap.parse_args()

    if args.list:
        print("models:")
        for k, why in MODELS.items():
            print(f"  {k:18s} {why}")
        print("textures:")
        for k, v in TEXTURES.items():
            print(f"  {k:12s} <- {v}")
        return 0

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    TEX_DIR.mkdir(parents=True, exist_ok=True)

    print("models (Poly Haven, CC0):")
    models = [m for m in (fetch_model(a, args.force) for a in MODELS) if m]
    print("\ntextures (ambientCG, CC0):")
    textures = [t for t in (fetch_texture(k, v, args.force) for k, v in TEXTURES.items()) if t]

    write_manifest(models, textures)
    failed = (len(MODELS) - len(models)) + (len(TEXTURES) - len(textures))
    if failed:
        print(f"\n{failed} asset(s) failed. Build Mode degrades to procedural geometry "
              f"and flat colours for those, so this is survivable -- but re-run to fix.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
