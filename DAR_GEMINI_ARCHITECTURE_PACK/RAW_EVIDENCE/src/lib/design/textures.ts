/* ============================================================
   DAR Build Mode — PBR maps

   Loads the CC0 texture sets fetched by scripts/fetch_design_assets.py and
   attaches them to the shared materials, without touching the decisions
   materials.ts already made.

   THE COLOUR MAP IS GREYSCALE ON PURPOSE. Every colour in MATERIALS comes from
   `ontology/ontology.json`'s per-culture palette -- Moroccan cobalt is #0040c0
   because the Moroccan profile says "cobalt Majorelle blue". three computes
   albedo as `material.color * map`, so a full-colour photograph would replace
   that sourced palette with whatever the texture was shot under. A greyscale
   multiply cannot move hue or saturation, only value: the palette survives and
   the surface gains grain. It is the same property backend/recolor.py uses when
   it repaints a wall from a picked hue while keeping the value channel.

   THE ROUGHNESS MAP IS RE-CENTRED NEAR 1.0, for the same reason: three computes
   roughness as `material.roughness * roughnessMap.g`, and the authored scalars
   (limestone 0.92, brass 0.32) are deliberate. The map says where a surface
   varies, not how rough it is.

   Both conversions are baked by the fetch script, so nothing here has to
   correct for them at runtime.
   ============================================================ */

import * as THREE from "three";

/** Which materials have a texture set on disk. Keys match MATERIALS in
 *  materials.ts and the directory names under public/textures. */
export const TEXTURED = new Set([
  "limestone", "tadelakt", "gypsum", "sand", "marble",
  "cedar", "walnut",
  "linen", "velvet", "leather", "wool",
  "brass", "agedBrass", "iron",
]);

type MapSet = { detail: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture };

const loader = new THREE.TextureLoader();
const sets = new Map<string, Promise<MapSet | null>>();

function load(url: string, srgb: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        // three 0.150 predates Texture.colorSpace. The detail map is a
        // greyscale MULTIPLIER, not colour, so it stays linear -- decoding it
        // as sRGB would bend the very modulation curve the fetch script
        // normalised. Normal and roughness are data and are linear anyway.
        if (srgb) t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** All three maps for one material key, fetched once and shared. */
export function loadMapSet(key: string): Promise<MapSet | null> {
  const hit = sets.get(key);
  if (hit) return hit;

  const p = (async () => {
    const [detail, normal, rough] = await Promise.all([
      load(`/textures/${key}/detail.jpg`, false),
      load(`/textures/${key}/normal.jpg`, false),
      load(`/textures/${key}/rough.jpg`, false),
    ]);
    if (!detail) return null;
    return { detail, normal: normal ?? detail, rough: rough ?? detail } as MapSet;
  })();

  sets.set(key, p);
  return p;
}

/** How many centimetres one tile of each material covers.
 *
 *  Real sizes, so a surface reads at the right scale rather than at whatever
 *  the photograph happened to be shot at: an oak board is ~120cm long, a
 *  cement floor tile is 20cm, a linen weave repeats every few centimetres. Get
 *  this wrong and a sofa looks like it is upholstered in tarpaulin. */
export const REPEAT_CM: Record<string, number> = {
  limestone: 90,
  tadelakt: 120,
  gypsum: 110,
  sand: 100,
  marble: 120,
  cedar: 80,
  walnut: 70,
  linen: 28,
  velvet: 26,
  leather: 45,
  wool: 55,
  brass: 40,
  agedBrass: 40,
  iron: 40,
  // patterned surfaces, drawn rather than photographed
  encaustic: 40,   // 2x2 tiles per texture -> 20cm tiles, the standard Beirut size
  // 4x4 stars per texture -> 20cm pieces. Larger than authentic zellige, which
  // cuts at nearer 10cm, and deliberately so: at true size the tessellation
  // averages to a flat blue haze from the default camera and the whole motif is
  // lost. Read at 20cm the khatam star is legible as a star, which is the point
  // of putting it there.
  zellige: 80,
  sadu: 60,
  gypsumFret: 70,
};

export function repeatCm(key: string): number {
  return REPEAT_CM[key] ?? 60;
}

/** Tiled views, keyed by source texture and repeat.
 *
 *  Texture.repeat lives on the texture, not the material, so two surfaces that
 *  want the same image at different tiling need two Texture objects. three
 *  keys its GPU upload cache by texture uuid, and clone() mints a new uuid --
 *  so cloning per material would upload the same 512x512 image once per
 *  material, tens of times over a furnished room. Sharing by (source, repeat)
 *  means each distinct tiling is uploaded exactly once. */
const views = new Map<string, THREE.Texture>();

function tiledView(t: THREE.Texture, repeat: number): THREE.Texture {
  if (repeat === 1) return t;                    // the common case: no clone at all
  const id = `${t.uuid}@${repeat}`;
  const hit = views.get(id);
  if (hit) return hit;
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = THREE.RepeatWrapping;
  c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(repeat, repeat);
  views.set(id, c);
  return c;
}

/** Shared by the pattern path in geometry.ts, which has the same problem. */
export function tiled(t: THREE.Texture, repeat: number): THREE.Texture {
  return tiledView(t, repeat);
}

/** Attach the maps for `key` to `mat` when they arrive.
 *
 *  Deliberately fire-and-forget: the material is already usable as a flat
 *  ontology colour, so the scene is correct from the first frame and a missing
 *  or failed texture degrades to exactly what Build Mode looked like before.
 *  `onReady` marks the frame dirty -- the render loop is idle-gated, so
 *  without it a texture could arrive and never be drawn. */
export function applyMapSet(
  mat: THREE.MeshStandardMaterial,
  key: string,
  repeat: number,
  onReady?: () => void,
) {
  if (!TEXTURED.has(key)) return;
  loadMapSet(key).then((set) => {
    if (!set) return;
    mat.map = tiledView(set.detail, repeat);
    mat.normalMap = tiledView(set.normal, repeat);
    mat.roughnessMap = tiledView(set.rough, repeat);
    mat.normalScale = new THREE.Vector2(0.6, 0.6);
    mat.needsUpdate = true;
    onReady?.();
  });
}

export function disposeTextureCache() {
  sets.forEach((p) => p.then((s) => {
    if (!s) return;
    s.detail.dispose();
    s.normal.dispose();
    s.rough.dispose();
  }));
  sets.clear();
}
