/* ============================================================
   DAR Build Mode — procedural furniture

   Every piece is built from primitives at its REAL ontology dimensions.
   Nothing is a photo billboard: a transparent PNG standing among lit
   volumes reads as a sticker the moment the camera moves, which is
   precisely the thing this editor exists not to be.

   The target look is an architect's study model — honest massing in true
   material colours, well proportioned, slightly softened. It should look
   deliberately like a MODEL, because DAR must never imply it has
   photographed or rendered furniture it has not.

   Builders receive the object's own w/d/h in cm and must fill that
   bounding box: the ontology's dimensions are the contract, so a 210cm
   sofa is 210cm on the plan and in the volume.
   ============================================================ */

import * as THREE from "three";
import { CATEGORY_TO_ADE20K } from "./ade20k";
import type { StyleId } from "@/context/ImageContext";
import { isCatalogueBacked } from "./foundFurniture";
import { catalogItem, catalogModel } from "./catalog";
import { getMaterial } from "./materials";
import type { MaterialSpec } from "./materials";
import { instantiateModel, loadModelProto } from "./modelLoader";
import { pattern } from "./patterns";
import { applyMapSet, repeatCm, tiled } from "./textures";
import type { PlacedObject } from "./types";

/** three 0.150's ColorRepresentation does not accept a bare CSS string in its
 *  typings. Parsing to a number rather than going through setStyle: a string
 *  that fails to parse leaves Color at its default WHITE and every surface
 *  silently renders as bright plaster, which is a very confusing bug to look
 *  at. A number either parses or throws here, where it is obvious. */
export function colorOf(hex: string): THREE.Color {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return new THREE.Color(Number.isFinite(n) ? n : 0xff00ff);
}

/** The same colour, decoded from sRGB into the linear space the lighting
 *  actually works in. For LIT surfaces only.
 *
 *  three 0.150 ships with ColorManagement.enabled === false, so a hex handed
 *  to a material is used verbatim as a linear value. #8a1f1f then enters the
 *  shader as (0.54, 0.12, 0.12) instead of its true (0.25, 0.014, 0.014) --
 *  roughly twice as bright and far less saturated before a single light is
 *  added. Under the brighter rig that followed IBL, ACES then pushed those
 *  washed-out values further toward white: the Khaleeji sadu velvet, sourced
 *  from the ontology as deep red, measured on screen at saturation 0.34 and
 *  value 0.90 against a target of 0.78 and 0.54. It rendered pink.
 *
 *  Deliberately NOT applied to `colorOf`, which also feeds unlit things --
 *  the selection cage, snap guides, the accent ring -- where the raw value is
 *  what should reach the screen. And never anywhere near the segmentation
 *  pass, whose ADE20K colours must leave the renderer byte-exact. */
export function albedo(hex: string): THREE.Color {
  return colorOf(hex).convertSRGBToLinear();
}

/* Materials are shared per key so twenty poufs cost one material. */
const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Callback so an async map arriving can wake the idle-gated render loop.
 *  Set by DesignWorld; a no-op elsewhere (tests, SSR). */
let notifyDirty: (() => void) | null = null;
export function setMaterialRepaint(fn: (() => void) | null) {
  notifyDirty = fn;
}

/** Dress a material with whatever `spec` says it is made of.
 *
 *  Two different things, and they are mutually exclusive on purpose:
 *
 *  A PATTERNED surface (encaustic, zellige) is drawn by patterns.ts and the
 *  ornament carries its own colour, so the map goes on at full strength and
 *  material.color is forced to white — leaving the ontology hex multiplied in
 *  would tint the whole tessellation one flat colour and lose the ivory and
 *  the saffron.
 *
 *  A PHOTOGRAPHED surface gets the CC0 set, whose colour map is greyscale, so
 *  material.color KEEPS the ontology hex and the texture only modulates value. */
function dress(mat: THREE.MeshStandardMaterial, spec: MaterialSpec, repeat: number) {
  if (spec.pattern) {
    const tex = pattern(spec.pattern);
    if (tex) {
      mat.map = tiled(tex, repeat);
      mat.color = new THREE.Color(0xffffff);
      mat.needsUpdate = true;
    }
    return;
  }
  applyMapSet(mat, spec.key, repeat, () => notifyDirty?.());
}

export function standardMaterial(key: string): THREE.MeshStandardMaterial {
  const hit = matCache.get(key);
  if (hit) return hit;
  const spec = getMaterial(key);
  const mat = new THREE.MeshStandardMaterial({
    color: albedo(spec.hex),
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
  // Marked at birth rather than by a separate pass over MATERIALS. Every
  // instance in this cache is handed to many objects, so DesignWorld's
  // disposal must never free one; doing it here also means a key added later
  // is protected without anyone remembering to re-run a registration step —
  // and, more usefully, nothing has to be CREATED to be protected. The pass
  // that did this eagerly instantiated all 20 materials at startup, which
  // through dress() fetched all 14 texture sets (~2.2 MB) even for materials
  // the room never uses.
  (mat as THREE.Material & { __shared?: boolean }).__shared = true;
  if (spec.glow) {
    mat.emissive = albedo(spec.hex);
    mat.emissiveIntensity = spec.glow;
  }
  // Furniture is small, so one tile across the piece is about right; the floor
  // and walls compute a real repeat from their own span instead.
  dress(mat, spec, 1);
  matCache.set(key, mat);
  return mat;
}

/** A material for a large architectural surface, tiled at true physical scale.
 *
 *  Not cached: the floor and each wall have different spans, and the repeat
 *  lives on the texture. A 5.2m floor of 20cm encaustic tiles has to show 26
 *  tiles, not one stretched one — getting this wrong is the difference between
 *  a tiled floor and a photograph of a tile. */
export function surfaceMaterial(
  key: string,
  spanCm: number,
  opts: { side?: THREE.Side; transparent?: boolean } = {},
): THREE.MeshStandardMaterial {
  const spec = getMaterial(key);
  const mat = new THREE.MeshStandardMaterial({
    color: albedo(spec.hex),
    roughness: spec.roughness,
    metalness: spec.metalness,
    ...(opts.side ? { side: opts.side } : {}),
    ...(opts.transparent ? { transparent: true, opacity: 1 } : {}),
  });
  dress(mat, spec, Math.max(1, Math.round(spanCm / repeatCm(key))));
  return mat;
}

/** The skirting band: the wall material, one step darker.
 *
 *  Darkening multiplies material.color, which for a PATTERNED surface is white
 *  and carries no colour information — so that case is left alone rather than
 *  turning an ornament grey. Wall materials are never patterned today; the
 *  guard is here so that stays true if one ever is. */
export function skirtingMaterial(
  key: string,
  spanCm: number,
  opts: { transparent?: boolean } = {},
): THREE.MeshStandardMaterial {
  const m = surfaceMaterial(key, spanCm, opts);
  if (!getMaterial(key).pattern) m.color.multiplyScalar(0.72);
  m.roughness = 0.85;
  m.metalness = 0;
  return m;
}

export function disposeMaterialCache(): void {
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}

/** Slightly rounded box. Real furniture has no perfectly sharp arris, and the
 *  highlight along a small chamfer is most of what makes these read as
 *  objects rather than as untextured cubes. */
function softBox(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const r = Math.min(2.2, w * 0.06, h * 0.06, d * 0.06);
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  if (r > 0.4) {
    // Cheap chamfer: pull the corner vertices in along their own normal.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      pos.setXYZ(i, x - Math.sign(x) * r * 0.5, y - Math.sign(y) * r * 0.5, z - Math.sign(z) * r * 0.5);
    }
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, seg: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function place(m: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  m.position.set(x, y, z);
  return m;
}

/** Four legs inset from the corners of a w×d footprint. */
function legs(g: THREE.Group, w: number, d: number, h: number, t: number, mat: THREE.Material) {
  const ix = w / 2 - t;
  const iz = d / 2 - t;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    g.add(place(softBox(t, h, t, mat), sx * ix, h / 2, sz * iz));
  }
}

/* ============================================================
   Culture-specific form

   Until now every builder was keyed on CATEGORY alone, so a Lebanese sofa, a
   Khaleeji majlis bench and a Moroccan sedari banquette were the same five
   boxes in three colours — and culture, the thing this project is about, was
   invisible in the one view that is meant to show a room being designed.

   Each builder now branches on the culture of the catalogue piece itself (not
   of the room, so a Moroccan pouf borrowed into a Lebanese room stays
   Moroccan), and the differences are drawn from DAR's own catalogue art and
   the vocabulary in ontology/sources.md: the qanater triple arch, the Najdi
   pointed arch and carved gypsum, the Moroccan horseshoe arch and zellige,
   mashrabiya openwork, sadu weave, the tufted majlis pouf, the radial-stitched
   Moroccan leather pouf.

   These remain ENHANCED PROCEDURAL, and the inspector says so. They are
   DAR's drawing of the piece — a real silhouette with legs, arms, cushions and
   ornament — not a scan of one.
   ============================================================ */

export interface BuildCtx {
  w: number;
  h: number;
  d: number;
  mat: THREE.Material;
  accent: THREE.Material;
  /** Culture of the CATALOGUE PIECE. Falls back to lebanese for anything
   *  without one, which in practice is only a hand-made test object. */
  culture: StyleId;
}

type Builder = (c: BuildCtx) => THREE.Group;

/** A turned profile revolved about Y — legs, balusters, pedestals, finials.
 *  Turning is the defining operation of this furniture tradition, and it is
 *  the single cheapest way to stop a leg reading as a stick. */
function turned(profile: Array<[number, number]>, mat: THREE.Material, seg = 14): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.01, r), y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A turned leg of height h and thickness t, in the classic bobbin profile. */
function turnedLeg(h: number, t: number, mat: THREE.Material): THREE.Mesh {
  const r = t / 2;
  return turned(
    [
      [r * 0.9, 0], [r, h * 0.05], [r * 0.6, h * 0.14],
      [r * 0.95, h * 0.24], [r * 0.55, h * 0.4],
      [r * 0.8, h * 0.6], [r * 0.5, h * 0.82], [r * 0.75, h],
    ],
    mat,
  );
}

function turnedLegs(g: THREE.Group, w: number, d: number, h: number, t: number, mat: THREE.Material) {
  const ix = w / 2 - t * 0.9;
  const iz = d / 2 - t * 0.9;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.add(place(turnedLeg(h, t, mat), sx * ix, 0, sz * iz));
  }
}

/** The three arch profiles this project actually names, as a closed 2D shape
 *  that ExtrudeGeometry can cut a hole with.
 *
 *  round      Lebanese qanater — the triple-arch of a Beirut central hall
 *  pointed    Najdi, the Khaleeji two-centred arch
 *  horseshoe  Moroccan, which continues PAST the half circle before returning */
function archShape(kind: "round" | "pointed" | "horseshoe", w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const springing = h - hw * (kind === "horseshoe" ? 1.28 : 1);
  s.moveTo(-hw, 0);
  s.lineTo(-hw, Math.max(0, springing));
  if (kind === "pointed") {
    // Two arcs struck from opposite thirds, meeting in a point at the crown.
    s.quadraticCurveTo(-hw, h * 0.86, 0, h);
    s.quadraticCurveTo(hw, h * 0.86, hw, Math.max(0, springing));
  } else if (kind === "horseshoe") {
    // Widens above the springing before closing — the giveaway of the form.
    s.quadraticCurveTo(-hw * 1.18, springing + hw * 0.55, -hw * 0.72, h - hw * 0.12);
    s.quadraticCurveTo(0, h + hw * 0.06, hw * 0.72, h - hw * 0.12);
    s.quadraticCurveTo(hw * 1.18, springing + hw * 0.55, hw, Math.max(0, springing));
  } else {
    s.absarc(0, Math.max(0, springing), hw, Math.PI, 0, true);
  }
  s.lineTo(hw, 0);
  s.closePath();
  return s;
}

/** A solid panel with a row of arches cut through it. The apron under a
 *  console, the doors of a cabinet, the head of a screen. */
function arcadePanel(
  w: number,
  h: number,
  t: number,
  count: number,
  kind: "round" | "pointed" | "horseshoe",
  mat: THREE.Material,
): THREE.Mesh {
  const outer = new THREE.Shape();
  outer.moveTo(-w / 2, 0);
  outer.lineTo(w / 2, 0);
  outer.lineTo(w / 2, h);
  outer.lineTo(-w / 2, h);
  outer.closePath();

  const cell = w / count;
  const aw = cell * 0.62;
  const ah = h * 0.78;
  for (let i = 0; i < count; i++) {
    const cx = -w / 2 + cell * (i + 0.5);
    const hole = archShape(kind, aw, ah);
    // Shape holes are paths in the same space, so translate the points.
    const path = new THREE.Path();
    const pts = hole.getPoints(24);
    path.moveTo(pts[0].x + cx, pts[0].y + h * 0.08);
    for (const p of pts.slice(1)) path.lineTo(p.x + cx, p.y + h * 0.08);
    path.closePath();
    outer.holes.push(path);
  }

  const geo = new THREE.ExtrudeGeometry(outer, { depth: t, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -t / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Mashrabiya openwork as a masked plane.
 *
 *  Real geometry was tried first and cost ~39 boxes per leaf for a grille that
 *  still read as a bar grid. The pattern mask gives true turned-lattice
 *  openwork for two triangles, and alphaTest (rather than transparency) means
 *  it still writes depth and casts a pierced shadow — which is the whole
 *  point of a mashrabiya. */
function latticePanel(w: number, h: number, mat: THREE.MeshStandardMaterial): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

let latticeMat: THREE.MeshStandardMaterial | null = null;
function latticeMaterial(base: THREE.Material): THREE.MeshStandardMaterial {
  if (latticeMat) return latticeMat;
  const src = base as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial({
    color: src.color?.clone() ?? new THREE.Color(0x8a5a33),
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
  const mask = pattern("mashrabiya");
  if (mask) {
    const t = tiled(mask, 2);
    m.alphaMap = t;
    m.map = src.map ?? null;
  }
  (m as THREE.Material & { __shared?: boolean }).__shared = true;
  latticeMat = m;
  return m;
}

/** Divide a seat into individual cushions with a reveal between them. One of
 *  the strongest cues that a volume is upholstered rather than moulded. */
function cushionRun(
  g: THREE.Group,
  count: number,
  w: number,
  hgt: number,
  d: number,
  y: number,
  z: number,
  mat: THREE.Material,
) {
  const gap = Math.min(2.4, w * 0.012);
  const cw = (w - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const cx = -w / 2 + cw / 2 + i * (cw + gap);
    g.add(place(softBox(cw, hgt, d, mat), cx, y, z));
  }
}

/** A bolster: the round end-cushion that defines majlis and sedari seating. */
function bolster(len: number, r: number, mat: THREE.Material): THREE.Mesh {
  const m = cyl(r, r, len, 16, mat);
  m.rotation.z = Math.PI / 2;
  return m;
}

const buildSofa: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();

  if (culture === "khaleeji") {
    // MAJLIS FLOOR SEATING. Low, legless, run along a wall, with a row of
    // back cushions and a bolster at each end. The catalogue piece is 240 x 65
    // -- long and low -- and giving it arms and legs would make it a sofa,
    // which is precisely the wrong object.
    const baseH = h * 0.42;
    g.add(place(softBox(w, baseH, d, accent), 0, baseH / 2, 0));
    cushionRun(g, Math.max(3, Math.round(w / 80)), w * 0.98, h * 0.14, d * 0.9,
      baseH + h * 0.07, 0, mat);
    // back cushions, upright against the wall
    const backH = h - baseH - h * 0.06;
    cushionRun(g, Math.max(3, Math.round(w / 80)), w * 0.98, backH, d * 0.22,
      baseH + h * 0.14 + backH / 2, -d / 2 + d * 0.11, mat);
    for (const s of [-1, 1]) {
      g.add(place(bolster(d * 0.8, h * 0.12, mat), s * (w / 2 - d * 0.42), baseH + h * 0.2, d * 0.16));
    }
    return g;
  }

  if (culture === "moroccan") {
    // SEDARI BANQUETTE. Low, deep, on a carved apron with an arcade of
    // horseshoe arches cut through it, and a bolster at each end.
    const apronH = h * 0.2;
    const seatH = h * 0.52;
    g.add(place(arcadePanel(w * 0.98, apronH, d * 0.9, Math.max(3, Math.round(w / 70)), "horseshoe", accent),
      0, apronH / 2, 0));
    g.add(place(softBox(w * 0.98, seatH - apronH, d, accent), 0, apronH + (seatH - apronH) / 2, 0));
    cushionRun(g, 3, w * 0.95, h * 0.13, d * 0.92, seatH + h * 0.065, 0, mat);
    const backH = h - seatH - h * 0.13;
    cushionRun(g, 3, w * 0.95, backH, d * 0.2, seatH + h * 0.13 + backH / 2, -d / 2 + d * 0.1, mat);
    for (const s of [-1, 1]) {
      g.add(place(bolster(d * 0.78, h * 0.11, mat), s * (w / 2 - d * 0.4), seatH + h * 0.19, d * 0.2));
    }
    return g;
  }

  // LEBANESE. A framed sofa raised on turned walnut legs, with rolled arms
  // and three separate seat cushions -- the Levantine parlour piece.
  const legH = h * 0.16;
  const armW = Math.min(20, w * 0.1);
  const backD = Math.min(15, d * 0.19);
  const seatH = h * 0.5;
  turnedLegs(g, w * 0.9, d * 0.86, legH, Math.min(9, w * 0.045), accent);
  // frame rail
  g.add(place(softBox(w * 0.94, h * 0.09, d * 0.94, accent), 0, legH + h * 0.045, 0));
  const seatTop = legH + h * 0.09;
  cushionRun(g, 3, w - armW * 2, seatH - seatTop, d - backD, seatTop + (seatH - seatTop) / 2, backD / 2, mat);
  // tight back with a capping rail
  g.add(place(softBox(w, h - seatTop - h * 0.06, backD, mat), 0, seatTop + (h - seatTop) / 2 - h * 0.03, -d / 2 + backD / 2));
  g.add(place(softBox(w, h * 0.06, backD * 1.15, accent), 0, h - h * 0.03, -d / 2 + backD / 2));
  // rolled arms: a cylinder reads as a roll where a box reads as a wall
  const armH = h * 0.68;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - armW / 2);
    g.add(place(softBox(armW, armH - seatTop, d * 0.96, mat), x, seatTop + (armH - seatTop) / 2, 0));
    const roll = cyl(armW / 2, armW / 2, d * 0.96, 14, mat);
    roll.rotation.x = Math.PI / 2;
    g.add(place(roll, x, armH, 0));
  }
  return g;
};

const buildChair: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const seatH = h * 0.46;
  const t = Math.min(5, w * 0.1);
  turnedLegs(g, w, d, seatH, t * 1.4, accent);
  g.add(place(softBox(w, t * 1.2, d, mat), 0, seatH, 0));

  const backH = h - seatH;
  // The back is where a chair states its culture: a pierced arch for Morocco,
  // a turned-baluster splat for the Levant.
  const kind = culture === "moroccan" ? "horseshoe" : "round";
  const panel = arcadePanel(w * 0.92, backH * 0.86, t * 1.1, 1, kind, accent);
  panel.rotation.x = -0.08;
  g.add(place(panel, 0, seatH + t * 0.6, -d / 2 + t));
  // crest rail
  g.add(place(softBox(w * 0.96, backH * 0.1, t * 1.3, accent), 0, seatH + backH * 0.92, -d / 2 + t));
  return g;
};

/** Upholstered single seat. Deliberately not an alias of buildChair: a majlis
 *  armchair is a soft, low, generous piece, and a dining chair's thin legs and
 *  flat back read as the wrong object entirely at this scale. */
const buildArmchair: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const armW = Math.min(16, w * 0.18);
  const backD = Math.min(15, d * 0.22);
  const seatH = h * 0.45;
  const baseH = seatH * (culture === "khaleeji" ? 0.42 : 0.28);

  if (culture === "lebanese") {
    // Damascene frame chair: turned legs, an exposed show-wood arm, and a
    // buttoned back. The frame is the point — it is joinery, not a beanbag.
    turnedLegs(g, w * 0.86, d * 0.84, h * 0.17, Math.min(8, w * 0.09), accent);
    g.add(place(softBox(w * 0.9, h * 0.07, d * 0.9, accent), 0, h * 0.205, 0));
  } else {
    g.add(place(softBox(w * 0.9, baseH, d * 0.9, accent), 0, baseH / 2, 0));
  }

  const seatFrom = culture === "lebanese" ? h * 0.24 : baseH;
  // Seat, then a plumper cushion sitting proud of it — the second volume is
  // what separates an armchair from a box with arms.
  const seatT = (seatH - seatFrom) * 0.55;
  g.add(place(softBox(w - armW * 2, seatT, d - backD, mat), 0, seatFrom + seatT / 2, backD / 2));
  g.add(place(softBox((w - armW * 2) * 0.94, seatH - seatFrom - seatT, (d - backD) * 0.94, mat),
    0, seatFrom + seatT + (seatH - seatFrom - seatT) / 2, backD / 2));

  const backH = h - seatFrom;
  if (culture === "moroccan") {
    // A pierced horseshoe crest above the upholstered back.
    g.add(place(softBox(w * 0.96, backH * 0.62, backD, mat), 0, seatFrom + backH * 0.31, -d / 2 + backD / 2));
    g.add(place(arcadePanel(w * 0.96, backH * 0.38, backD * 0.5, 1, "horseshoe", accent),
      0, seatFrom + backH * 0.62, -d / 2 + backD * 0.55));
  } else {
    const back = softBox(w * 0.96, backH, backD, mat);
    back.rotation.x = -0.05;
    g.add(place(back, 0, seatFrom + backH / 2, -d / 2 + backD / 2));
    if (culture === "lebanese") {
      // capping rail in show wood
      g.add(place(softBox(w * 0.99, h * 0.055, backD * 1.15, accent), 0, h - h * 0.027, -d / 2 + backD / 2));
    }
  }

  const armH = h * (culture === "khaleeji" ? 0.6 : 0.66);
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - armW / 2);
    g.add(place(softBox(armW, armH - seatFrom, d * 0.92, mat), x, seatFrom + (armH - seatFrom) / 2, backD / 4));
    if (culture === "khaleeji") {
      // A run of brass studs along the arm — the Khaleeji upholstery signature.
      const studs = 5;
      for (let i = 0; i < studs; i++) {
        const s2 = cyl(armW * 0.09, armW * 0.09, armW * 0.12, 8, accent);
        s2.rotation.z = Math.PI / 2;
        g.add(place(s2, x + s * armW * 0.5, armH - seatFrom * 0.2,
          -d * 0.34 + (d * 0.68 * i) / (studs - 1)));
      }
    } else if (culture === "lebanese") {
      // show-wood arm cap
      g.add(place(softBox(armW * 1.15, h * 0.045, d * 0.94, accent), x, armH, backD / 4));
    }
  }
  return g;
};

/** Tall storage. Plinth, carcass, cornice, a centre reveal between the doors
 *  and two small pulls — the minimum that reads as joinery rather than a slab. */
const buildCabinet: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const plinthH = h * 0.055;
  const cornH = h * 0.045;
  const bodyH = h - plinthH - cornH;

  g.add(place(softBox(w * 0.92, plinthH, d * 0.92, accent), 0, plinthH / 2, 0));
  g.add(place(softBox(w, bodyH, d, mat), 0, plinthH + bodyH / 2, 0));
  // A cornice with a stepped crest rather than a flat slab.
  g.add(place(softBox(w * 1.04, cornH, d * 1.06, accent), 0, plinthH + bodyH + cornH / 2, 0));
  g.add(place(softBox(w * 0.7, cornH * 0.8, d * 0.9, accent), 0, plinthH + bodyH + cornH * 1.4, 0));

  // The doors are the whole character of the piece: Najdi pointed arches for
  // Khaleeji, Moroccan horseshoe. Pierced right through, so the carcass shows
  // behind them the way a real fretted door does.
  const kind = culture === "moroccan" ? "horseshoe" : "pointed";
  const gap = Math.min(1.6, w * 0.02);
  const doorW = (w - gap * 3) / 2;
  const doorH = bodyH * 0.84;
  for (const s of [-1, 1]) {
    const x = s * (doorW / 2 + gap / 2);
    g.add(place(arcadePanel(doorW, doorH, d * 0.07, 1, kind, accent), x, plinthH + bodyH * 0.08, d / 2));
    g.add(place(cyl(Math.min(1.2, w * 0.013), Math.min(1.2, w * 0.013), doorH * 0.14, 10, accent),
      s * gap * 1.6, plinthH + bodyH * 0.5, d / 2 + 1.4));
  }
  return g;
};

/** Wall console — a slim top on legs with a lower shelf. Its whole character
 *  is the gap under the top, so the apron is kept shallow. */
/** The wall console, and the clearest place to say which culture a room is in.
 *
 *  Lebanese gets the qanater — the triple round arch of a Beirut central hall,
 *  cut right through the apron. Khaleeji gets the Najdi pointed arch. Moroccan
 *  gets a horseshoe arcade. Same object, three architectures. */
const buildConsole: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const topT = Math.min(4.5, h * 0.07);
  const legT = Math.min(7, w * 0.05);

  g.add(place(softBox(w, topT, d, mat), 0, h - topT / 2, 0));
  const kind = culture === "moroccan" ? "horseshoe" : culture === "khaleeji" ? "pointed" : "round";
  // Three arches for the qanater, five for the longer arcades.
  const count = culture === "lebanese" ? 3 : 5;
  const apronH = h * 0.3;
  g.add(place(arcadePanel(w * 0.94, apronH, d * 0.5, count, kind, accent),
    0, h - topT - apronH, 0));

  turnedLegs(g, w * 0.94, d * 0.8, h - topT, legT, accent);
  // Lower shelf, a third up, tying the legs together.
  g.add(place(softBox(w * 0.86, topT * 0.7, d * 0.72, mat), 0, h * 0.26, 0));
  return g;
};

/** Mashrabiya folding screen. Three hinged leaves in a zigzag, each a frame
 *  filled with a turned lattice — the one catalogue piece whose entire value
 *  is its openwork, so it is the one place worth spending geometry. */
/** Mashrabiya folding screen. Three hinged leaves in a zigzag, each a frame
 *  filled with true turned-lattice openwork and capped by an arch.
 *
 *  The lattice used to be 13 crossing boxes per leaf, which read as a bar grid
 *  and cost 39 meshes. It is now the mashrabiya mask on a single plane with
 *  alphaTest, so it is genuinely pierced — light passes through it and it
 *  casts a patterned shadow, which is the entire reason the object exists. */
const buildScreen: Builder = ({ w, h, d, mat, accent }) => {
  const g = new THREE.Group();
  const leaves = 3;
  const leafW = w / leaves;
  const frameT = Math.min(4, leafW * 0.09);
  const lattice = latticeMaterial(mat);

  for (let i = 0; i < leaves; i++) {
    const leaf = new THREE.Group();
    const innerW = leafW - frameT * 2;
    const archH = h * 0.18;
    const innerH = h - frameT * 2 - archH;

    // frame
    leaf.add(place(softBox(leafW, frameT, frameT, accent), 0, h - frameT / 2, 0));
    leaf.add(place(softBox(leafW, frameT, frameT, accent), 0, frameT / 2, 0));
    for (const s of [-1, 1]) {
      leaf.add(place(softBox(frameT, h, frameT, accent), s * (leafW / 2 - frameT / 2), h / 2, 0));
    }
    // openwork panel
    leaf.add(place(latticePanel(innerW, innerH, lattice), 0, frameT + innerH / 2, 0));
    // arched head, pierced through
    leaf.add(place(arcadePanel(innerW, archH, frameT * 0.6, 1, "round", accent),
      0, frameT + innerH, 0));

    // fold the leaves so the screen stands like a screen, not a flat wall
    const angle = (i - 1) * 0.34;
    leaf.position.set(-w / 2 + leafW / 2 + i * leafW, 0, Math.abs(i - 1) * d * 0.3 - d * 0.15);
    leaf.rotation.y = angle;
    g.add(leaf);
  }
  return g;
};

const buildOttoman: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  // Poufs are round; use the smaller plan dimension as the diameter so the
  // piece still sits inside its declared footprint.
  const r = Math.min(w, d) / 2;

  if (culture === "moroccan") {
    // The Marrakech leather pouf: a squat drum whose whole character is the
    // radial stitching running from the centre boss out to the rim.
    const body = turned(
      [[0, 0], [r * 0.72, 0], [r * 0.97, h * 0.3], [r * 0.92, h * 0.72],
       [r * 0.55, h * 0.97], [0, h]],
      mat, 26,
    );
    g.add(place(body, 0, 0, 0));
    const seams = 16;
    for (let i = 0; i < seams; i++) {
      const a = (i / seams) * Math.PI * 2;
      const seam = softBox(r * 0.9, h * 0.035, h * 0.035, accent);
      seam.position.set(Math.cos(a) * r * 0.5, h * 0.93, Math.sin(a) * r * 0.5);
      seam.rotation.y = -a;
      g.add(seam);
    }
    g.add(place(cyl(r * 0.13, r * 0.13, h * 0.05, 12, accent), 0, h * 0.97, 0));
    return g;
  }

  if (culture === "khaleeji") {
    // The tufted majlis pouf, standing on a brass plinth.
    g.add(place(cyl(r * 0.82, r * 0.86, h * 0.16, 24, accent), 0, h * 0.08, 0));
    g.add(place(turned(
      [[0, h * 0.16], [r * 0.86, h * 0.16], [r, h * 0.5], [r * 0.88, h * 0.88], [0, h]],
      mat, 26,
    ), 0, 0, 0));
    // buttoning: a ring of dimples reads as tufting at this scale
    for (let ring = 0; ring < 2; ring++) {
      const rr = r * (ring === 0 ? 0.34 : 0.68);
      const n = ring === 0 ? 6 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring;
        g.add(place(cyl(r * 0.05, r * 0.05, h * 0.04, 8, accent),
          Math.cos(a) * rr, h * 0.95, Math.sin(a) * rr));
      }
    }
    return g;
  }

  const body = cyl(r * 0.94, r * 0.86, h * 0.82, 28, mat);
  g.add(place(body, 0, h * 0.41, 0));
  g.add(place(cyl(r * 0.9, r * 0.9, h * 0.18, 28, accent), 0, h * 0.91, 0));
  return g;
};

/** An octagonal top — the Khaleeji and Moroccan tray table, and the shape a
 *  mosaic or mother-of-pearl inlay is actually laid out on. */
function octTop(r: number, t: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t, 8), mat);
  mesh.rotation.y = Math.PI / 8;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const buildTable: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const topT = Math.min(5, h * 0.14);
  const round = Math.abs(w - d) < w * 0.15;

  if (round) {
    const r = Math.min(w, d) / 2;
    // Octagonal for the mosaic traditions, circular for the Levant.
    if (culture === "lebanese") {
      g.add(place(cyl(r, r, topT, 34, mat), 0, h - topT / 2, 0));
    } else {
      g.add(place(octTop(r, topT, mat), 0, h - topT / 2, 0));
      g.add(place(octTop(r * 0.97, topT * 0.35, accent), 0, h - topT * 1.15, 0));
    }
    g.add(place(turned(
      [[r * 0.3, 0], [r * 0.34, h * 0.07], [r * 0.13, h * 0.24],
       [r * 0.2, h * 0.55], [r * 0.11, h * 0.8], [r * 0.2, h - topT]],
      accent, 18,
    ), 0, 0, 0));
    g.add(place(cyl(r * 0.5, r * 0.55, topT * 0.5, 24, accent), 0, topT * 0.25, 0));
    return g;
  }

  g.add(place(softBox(w, topT, d, mat), 0, h - topT / 2, 0));
  // A shallow fretted apron under the top: even a low table is joinery.
  const kind = culture === "moroccan" ? "horseshoe" : culture === "khaleeji" ? "pointed" : "round";
  g.add(place(arcadePanel(w * 0.9, h * 0.26, d * 0.5, 4, kind, accent), 0, h - topT - h * 0.26, 0));
  turnedLegs(g, w, d, h - topT, Math.min(7, w * 0.07), accent);
  return g;
};

const buildSideTable: Builder = ({ w, h, d, mat, accent, culture }) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const topT = Math.min(4, h * 0.1);

  if (culture === "khaleeji" || culture === "moroccan") {
    // Octagonal tray on three splayed legs — the brass/mosaic side table.
    g.add(place(octTop(r, topT, mat), 0, h - topT / 2, 0));
    g.add(place(octTop(r * 0.94, topT * 0.4, accent), 0, h - topT * 1.25, 0));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = cyl(r * 0.07, r * 0.05, h - topT, 10, accent);
      leg.position.set(Math.cos(a) * r * 0.6, (h - topT) / 2, Math.sin(a) * r * 0.6);
      leg.rotation.z = -Math.cos(a) * 0.13;
      leg.rotation.x = Math.sin(a) * 0.13;
      g.add(leg);
    }
    return g;
  }

  // Lebanese: the limestone pedestal table — a turned mushroom stem.
  g.add(place(cyl(r, r * 0.96, topT, 28, mat), 0, h - topT / 2, 0));
  g.add(place(turned(
    [[r * 0.44, 0], [r * 0.48, h * 0.05], [r * 0.19, h * 0.3],
     [r * 0.14, h * 0.62], [r * 0.3, h * 0.88], [r * 0.5, h - topT]],
    accent, 22,
  ), 0, 0, 0));
  return g;
};

const buildLamp: Builder = ({ w, h, d, mat, accent }) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const shadeH = h * 0.22;
  const glow = standardMaterial("lamplight");
  // Turned base and stem rather than a plain rod — a floor lamp is a turned
  // object in all three traditions.
  g.add(place(turned(
    [[r * 0.78, 0], [r * 0.8, h * 0.014], [r * 0.3, h * 0.04],
     [r * 0.16, h * 0.09], [r * 0.1, h * 0.3], [r * 0.13, h * 0.5],
     [r * 0.08, h * 0.72], [r * 0.1, h - shadeH]],
    mat, 18,
  ), 0, 0, 0));
  // Shade: slightly conical, and a real light source.
  g.add(place(cyl(r * 0.82, r, shadeH, 26, glow), 0, h - shadeH / 2, 0));
  g.add(place(cyl(r * 0.84, r * 0.84, shadeH * 0.06, 26, accent), 0, h - shadeH, 0));
  const light = new THREE.PointLight(0xffcf96, 0.5, 320, 2);
  light.position.set(0, h - shadeH, 0);
  g.add(light);
  return g;
};

/** The Moroccan pierced star lantern. Its whole identity is that light comes
 *  out of it in a pattern, so the body is an emissive octagonal drum wearing
 *  the mashrabiya mask — pierced, not painted. */
const buildLantern: Builder = ({ w, h, d, mat, accent }) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const glow = standardMaterial("lamplight");

  g.add(place(turned([[r * 0.5, 0], [r * 0.8, h * 0.02], [r * 0.55, h * 0.06],
                      [r * 0.3, h * 0.1], [r * 0.34, h * 0.16]], mat, 12), 0, 0, 0));
  // stem up to the body
  g.add(place(cyl(r * 0.12, r * 0.12, h * 0.34, 10, mat), 0, h * 0.33, 0));

  // The pierced body: an emissive core inside a masked shell.
  const bodyH = h * 0.34;
  g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.5, bodyH, 8), glow),
    0, h * 0.66, 0));
  const shell = latticeMaterial(mat);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.54, bodyH, 8, 1, true), shell);
  cage.castShadow = true;
  g.add(place(cage, 0, h * 0.66, 0));

  // domed cap and finial
  g.add(place(turned([[r * 0.7, 0], [r * 0.5, h * 0.05], [r * 0.2, h * 0.1],
                      [r * 0.09, h * 0.14], [0, h * 0.17]], mat, 12), 0, h * 0.83, 0));
  const light = new THREE.PointLight(0xffb765, 0.42, 260, 2);
  light.position.set(0, h * 0.66, 0);
  g.add(light);
  return g;
};

/** The Khaleeji mabkhara: a pierced brass incense burner standing on four
 *  splayed feet under a domed, finialled lid. The piercing IS the object —
 *  it is what no CC0 brass pot had, and the reason this is drawn. */
const buildObject: Builder = ({ w, h, d, mat, accent }) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;

  // four splayed feet
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const foot = cyl(r * 0.09, r * 0.13, h * 0.22, 8, accent);
    foot.position.set(Math.cos(a) * r * 0.6, h * 0.11, Math.sin(a) * r * 0.6);
    foot.rotation.z = -Math.cos(a) * 0.22;
    foot.rotation.x = Math.sin(a) * 0.22;
    g.add(foot);
  }
  // bowl, pierced
  const bowlH = h * 0.34;
  g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.62, bowlH, 8), mat),
    0, h * 0.22 + bowlH / 2, 0));
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.93, r * 0.65, bowlH, 8, 1, true),
    latticeMaterial(accent),
  );
  g.add(place(cage, 0, h * 0.22 + bowlH / 2, 0));
  // rim, domed lid, finial
  g.add(place(cyl(r * 0.98, r * 0.98, h * 0.045, 8, accent), 0, h * 0.58, 0));
  g.add(place(turned(
    [[r * 0.95, 0], [r * 0.8, h * 0.07], [r * 0.5, h * 0.15],
     [r * 0.22, h * 0.2], [r * 0.1, h * 0.26], [r * 0.16, h * 0.3], [0, h * 0.38]],
    mat, 14,
  ), 0, h * 0.6, 0));
  return g;
};

/** Objects DAR read off the photograph. Deliberately abstract massing: the
 *  projection knows a footprint and a class, not a form, so pretending to
 *  know the shape of the user's own sofa would be an invention.
 *
 *  Drawn as a survey would draw it — a solid footprint plate on the floor,
 *  a translucent volume above it, and a wireframe edge. The plate is the
 *  part that is actually measured, so it is the part drawn solid; the volume
 *  is a height prior, so it is the part drawn as vapour. */
function buildFound(w: number, h: number, d: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();

  const body = softBox(w, h, d, mat);
  g.add(place(body, 0, h / 2, 0));

  // Edges and footprint plate carry most of what makes massing readable, and
  // both were warm greys tuned against the old warm-charcoal ground. On indigo
  // they vanished. Cool stone, and the edge is opaque enough to survive the
  // 0.3 body opacity applied by buildObjectMesh.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0xc4d0e2, transparent: true, opacity: 0.85 }),
  );
  g.add(place(edges, 0, h / 2, 0));

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x8fa0b8, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  );
  plate.rotation.x = -Math.PI / 2;
  g.add(place(plate, 0, 1.2, 0));

  return g;
}

/** Every category the catalogue actually ships. A missing entry is not a
 *  cosmetic gap: buildObjectMesh falls through to buildFound(), the abstract
 *  massing reserved for things read off a PHOTOGRAPH, so a piece the user
 *  deliberately placed rendered as a translucent survey box. Nine of the 27
 *  catalogue items — every armchair, console, cabinet and screen — looked
 *  like that. A test pins this list against furniture.json. */
const BUILDERS: Record<string, Builder> = {
  sofa: buildSofa,
  chair: buildChair,
  armchair: buildArmchair,
  ottoman: buildOttoman,
  coffee_table: buildTable,
  side_table: buildSideTable,
  cabinet: buildCabinet,
  console: buildConsole,
  screen: buildScreen,
  lamp: buildLamp,
  lantern: buildLantern,
  cultural_object: buildObject,
};

/** The categories BUILDERS covers, for the test that keeps it in step with
 *  the ontology. */
export const BUILT_CATEGORIES: readonly string[] = Object.keys(BUILDERS);

/** Secondary material for legs/frames/plinths — a darker relative of the
 *  primary so pieces read as made of parts without a second colour choice. */
function accentFor(key: string): THREE.MeshStandardMaterial {
  const soft = new Set(["linen", "velvet", "leather", "wool"]);
  if (soft.has(key)) return standardMaterial("walnut");
  if (key === "marble" || key === "zellige" || key === "glass") return standardMaterial("agedBrass");
  if (key === "brass" || key === "agedBrass") return standardMaterial("iron");
  return standardMaterial(key);
}

/** Stamp the identity every downstream pass reads off the scene graph.
 *
 *  Applied to the whole subtree, and applied AGAIN whenever a loaded model
 *  replaces the procedural stand-in, because both consumers walk descendants
 *  rather than groups: `pickObject` resolves a raycast hit by climbing to the
 *  first `uid`, and the segmentation pass paints each mesh by its own `ade`
 *  and hides anything without one. A subtree that missed this would be
 *  unselectable and invisible to the ControlNet conditioning. */
export function stampObjectIdentity(g: THREE.Object3D, o: PlacedObject) {
  // The ADE20K class this piece will be painted as when the scene is
  // rendered into seg-ControlNet conditioning. Unmapped categories fall back
  // to the generic table class rather than going unpainted, because a hole in
  // the segmentation map reads to the model as "no object here" — which is a
  // worse lie than a slightly wrong class.
  const ade = CATEGORY_TO_ADE20K[o.category] ?? CATEGORY_TO_ADE20K.table;
  g.traverse((c) => {
    c.userData.ade = ade;
    c.userData.uid = o.uid;
  });
}

/** Build the visual for one placed object, already positioned and rotated.
 *  The returned group's userData carries the uid so a raycast hit can be
 *  resolved back to scene state without a side table of object3d→uid.
 *
 *  `onReady` fires if a real 3D asset finishes loading and replaces the
 *  procedural stand-in, so the caller can mark the frame dirty. */
export function buildObjectMesh(o: PlacedObject, onReady?: () => void): THREE.Group {
  const mat: THREE.Material = standardMaterial(o.materialKey);
  const accent: THREE.Material = accentFor(o.materialKey);
  // A found object that resolved to a catalogue piece is drawn with that
  // piece's real geometry. Only an UNRESOLVED detection — one with no
  // counterpart in any culture, like a bed or a rug — keeps the abstract
  // massing box, which is the honest drawing when the catalogue has nothing
  // to stand in with. See foundFurniture.ts for what resolves and why.
  //
  // This also fixes the conditioning, not just the picture: Build Mode hands
  // the ControlNet a segmentation pass, and a box labelled `table` tells the
  // generator to make a table where the user's sofa is.
  const massing = o.origin === "found" && !isCatalogueBacked(o);
  const builder = massing ? null : BUILDERS[o.category];
  // The culture of the PIECE, not of the room: a Moroccan pouf carried into a
  // Lebanese room is still a Moroccan pouf, and should still be drawn as one.
  const culture = (o.catalogId ? catalogItem(o.catalogId)?.culture : undefined) ?? "lebanese";
  const g = builder
    ? builder({ w: o.widthCm, h: o.heightCm, d: o.depthCm, mat, accent, culture })
    : buildFound(o.widthCm, o.heightCm, o.depthCm, mat);

  g.position.set(o.x, 0, o.z);
  g.rotation.y = (o.rotationDeg * Math.PI) / 180;
  g.userData.uid = o.uid;
  g.userData.origin = o.origin;
  stampObjectIdentity(g, o);
  attachRealModel(g, o, onReady);
  if (massing) {
    // Read as present but not authored: the catalogue pieces the user is
    // actually placing must visually dominate what was merely detected.
    // Lines and the footprint plate keep their own opacity (set above).
    // Applies to massing ONLY — a catalogue-backed detection is real
    // furniture and rendering it at 0.3 opacity is what made the room look
    // empty.
    g.traverse((c) => {
      if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
        const m = c.material.clone();
        m.transparent = true;
        m.opacity = 0.3;
        m.depthWrite = false;
        c.material = m;
        c.castShadow = false;
      }
    });
  }
  return g;
}

/** If this catalogue piece has a real 3D asset, load it and swap it in.
 *
 *  The procedural build is already in `g` and stays there until the asset is
 *  parsed, so the object is never missing, the drag ghost is never empty, and
 *  a failed fetch degrades to exactly what Build Mode drew before — a piece
 *  with a shape, not a hole. On success the stand-in children are removed and
 *  the fitted model takes their place inside the SAME group, so the uid,
 *  position, rotation and every reference held to it stay valid.
 *
 *  `sharedAsset` on the clone keeps DesignWorld.disposeObject from freeing the
 *  prototype's geometry out from under the other instances. */
function attachRealModel(g: THREE.Group, o: PlacedObject, onReady?: () => void) {
  // Massing has no catalogue id and so no asset; a catalogue-backed detection
  // is entitled to the same real GLB any placed piece would get.
  if (o.origin === "found" && !isCatalogueBacked(o)) return;
  const model = catalogModel(o.catalogId);
  if (!model) return;

  loadModelProto("/" + model.path)
    .then((proto) => {
      // The object may have been removed, or rebuilt for a material change,
      // while the asset was in flight.
      if (g.userData.disposed) return;
      const fitted = instantiateModel(proto, o.widthCm, o.heightCm, o.depthCm);
      for (const c of [...g.children]) {
        g.remove(c);
        c.traverse((n) => {
          const m = n as THREE.Mesh;
          m.geometry?.dispose();
        });
      }
      g.add(fitted);
      g.userData.real = true;
      // Re-stamp: the fitted subtree is brand new and carries none of the
      // identity the picker and the segmentation pass read.
      stampObjectIdentity(g, o);
      onReady?.();
    })
    .catch(() => {
      // Deliberately silent in the UI: the procedural piece is still standing
      // there and is a perfectly good representation of the object.
      if (process.env.NODE_ENV === "development") {
        console.warn(`[dar] model failed to load for ${o.catalogId}, keeping procedural`);
      }
    });
}

/** Bounding-box helper for the selection cage. */
export function objectBounds(o: PlacedObject): { w: number; h: number; d: number } {
  return { w: o.widthCm, h: o.heightCm, d: o.depthCm };
}
