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
import { catalogModel } from "./catalog";
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
    color: colorOf(spec.hex),
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
  if (spec.glow) {
    mat.emissive = colorOf(spec.hex);
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
    color: colorOf(spec.hex),
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

type Builder = (w: number, h: number, d: number, mat: THREE.Material, accent: THREE.Material) => THREE.Group;

const buildSofa: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const armW = Math.min(22, w * 0.11);
  const backD = Math.min(16, d * 0.2);
  const seatH = h * 0.46;
  const baseH = seatH * 0.34;

  // plinth
  g.add(place(softBox(w * 0.94, baseH, d * 0.94, accent), 0, baseH / 2, 0));
  // seat cushion
  g.add(place(softBox(w - armW * 2, seatH - baseH, d - backD, mat), 0, baseH + (seatH - baseH) / 2, backD / 2));
  // back
  g.add(place(softBox(w, h - baseH, backD, mat), 0, baseH + (h - baseH) / 2, -d / 2 + backD / 2));
  // arms
  const armH = h * 0.72;
  g.add(place(softBox(armW, armH - baseH, d, mat), -w / 2 + armW / 2, baseH + (armH - baseH) / 2, 0));
  g.add(place(softBox(armW, armH - baseH, d, mat), w / 2 - armW / 2, baseH + (armH - baseH) / 2, 0));
  return g;
};

const buildChair: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const seatH = h * 0.46;
  const t = Math.min(5, w * 0.1);
  legs(g, w, d, seatH, t, accent);
  g.add(place(softBox(w, t * 1.2, d, mat), 0, seatH, 0));
  // back with a slight recline
  const backH = h - seatH;
  const back = softBox(w * 0.92, backH, t * 1.1, mat);
  back.rotation.x = -0.08;
  g.add(place(back, 0, seatH + backH / 2, -d / 2 + t));
  return g;
};

/** Upholstered single seat. Deliberately not an alias of buildChair: a majlis
 *  armchair is a soft, low, generous piece, and a dining chair's thin legs and
 *  flat back read as the wrong object entirely at this scale. */
const buildArmchair: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const armW = Math.min(15, w * 0.17);
  const backD = Math.min(15, d * 0.22);
  const seatH = h * 0.45;
  const baseH = seatH * 0.3;

  g.add(place(softBox(w * 0.9, baseH, d * 0.9, accent), 0, baseH / 2, 0));
  // Seat, then a plumper cushion sitting proud of it — the second volume is
  // what separates an armchair from a box with arms.
  const seatT = (seatH - baseH) * 0.6;
  g.add(place(softBox(w - armW * 2, seatT, d - backD, mat), 0, baseH + seatT / 2, backD / 2));
  g.add(place(softBox((w - armW * 2) * 0.94, seatH - baseH - seatT, (d - backD) * 0.94, mat), 0, baseH + seatT + (seatH - baseH - seatT) / 2, backD / 2));

  const backH = h - baseH;
  const back = softBox(w * 0.96, backH, backD, mat);
  back.rotation.x = -0.05;
  g.add(place(back, 0, baseH + backH / 2, -d / 2 + backD / 2));

  const armH = h * 0.66;
  for (const s of [-1, 1]) {
    g.add(place(softBox(armW, armH - baseH, d * 0.92, mat), s * (w / 2 - armW / 2), baseH + (armH - baseH) / 2, backD / 4));
  }
  return g;
};

/** Tall storage. Plinth, carcass, cornice, a centre reveal between the doors
 *  and two small pulls — the minimum that reads as joinery rather than a slab. */
const buildCabinet: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const plinthH = h * 0.055;
  const cornH = h * 0.045;
  const bodyH = h - plinthH - cornH;

  g.add(place(softBox(w * 0.92, plinthH, d * 0.92, accent), 0, plinthH / 2, 0));
  g.add(place(softBox(w, bodyH, d, mat), 0, plinthH + bodyH / 2, 0));
  g.add(place(softBox(w * 1.04, cornH, d * 1.06, accent), 0, plinthH + bodyH + cornH / 2, 0));

  // Door faces, set slightly proud, with a reveal down the middle.
  const gap = Math.min(1.6, w * 0.02);
  const doorW = (w - gap * 3) / 2;
  const doorH = bodyH * 0.86;
  for (const s of [-1, 1]) {
    g.add(place(softBox(doorW, doorH, d * 0.06, accent), s * (doorW / 2 + gap / 2), plinthH + bodyH / 2, d / 2));
    g.add(place(cyl(Math.min(1.1, w * 0.012), Math.min(1.1, w * 0.012), doorH * 0.16, 10, accent), s * gap * 1.6, plinthH + bodyH / 2, d / 2 + 1.2));
  }
  return g;
};

/** Wall console — a slim top on legs with a lower shelf. Its whole character
 *  is the gap under the top, so the apron is kept shallow. */
const buildConsole: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const topT = Math.min(4.5, h * 0.07);
  const legT = Math.min(5, w * 0.045);

  g.add(place(softBox(w, topT, d, mat), 0, h - topT / 2, 0));
  g.add(place(softBox(w * 0.9, topT * 0.8, d * 0.6, accent), 0, h - topT - topT * 0.4, 0));
  legs(g, w, d, h - topT, legT, accent);
  // Lower shelf, a third up, tying the legs together.
  g.add(place(softBox(w * 0.86, topT * 0.7, d * 0.78, mat), 0, h * 0.3, 0));
  return g;
};

/** Mashrabiya folding screen. Three hinged leaves in a zigzag, each a frame
 *  filled with a turned lattice — the one catalogue piece whose entire value
 *  is its openwork, so it is the one place worth spending geometry. */
const buildScreen: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const leaves = 3;
  const leafW = w / leaves;
  const frameT = Math.min(4, leafW * 0.09);
  const barT = Math.max(0.9, frameT * 0.28);

  for (let i = 0; i < leaves; i++) {
    const leaf = new THREE.Group();
    // frame
    leaf.add(place(softBox(leafW, frameT, frameT, accent), 0, h - frameT / 2, 0));
    leaf.add(place(softBox(leafW, frameT, frameT, accent), 0, frameT / 2, 0));
    for (const s of [-1, 1]) {
      leaf.add(place(softBox(frameT, h, frameT, accent), s * (leafW / 2 - frameT / 2), h / 2, 0));
    }
    // lattice
    const innerW = leafW - frameT * 2;
    const innerH = h - frameT * 2;
    for (let c = 1; c <= 3; c++) {
      leaf.add(place(softBox(barT, innerH, barT, mat), -innerW / 2 + (innerW * c) / 4, h / 2, 0));
    }
    for (let r = 1; r <= 6; r++) {
      leaf.add(place(softBox(innerW, barT, barT, mat), 0, frameT + (innerH * r) / 7, 0));
    }
    // fold the leaves so the screen stands like a screen, not a flat wall
    const angle = (i - 1) * 0.34;
    leaf.position.set(-w / 2 + leafW / 2 + i * leafW, 0, Math.abs(i - 1) * d * 0.3 - d * 0.15);
    leaf.rotation.y = angle;
    g.add(leaf);
  }
  return g;
};

const buildOttoman: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  // Poufs are round; use the smaller plan dimension as the diameter so the
  // piece still sits inside its declared footprint.
  const r = Math.min(w, d) / 2;
  const body = cyl(r * 0.94, r * 0.86, h * 0.82, 28, mat);
  g.add(place(body, 0, h * 0.41, 0));
  g.add(place(cyl(r * 0.9, r * 0.9, h * 0.18, 28, accent), 0, h * 0.91, 0));
  return g;
};

const buildTable: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const topT = Math.min(5, h * 0.14);
  const round = Math.abs(w - d) < w * 0.15;
  if (round) {
    const r = Math.min(w, d) / 2;
    g.add(place(cyl(r, r, topT, 34, mat), 0, h - topT / 2, 0));
    g.add(place(cyl(r * 0.16, r * 0.22, h - topT, 18, accent), 0, (h - topT) / 2, 0));
    g.add(place(cyl(r * 0.5, r * 0.55, topT * 0.5, 24, accent), 0, topT * 0.25, 0));
  } else {
    g.add(place(softBox(w, topT, d, mat), 0, h - topT / 2, 0));
    legs(g, w, d, h - topT, Math.min(5, w * 0.06), accent);
  }
  return g;
};

const buildSideTable: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const topT = Math.min(4, h * 0.1);
  g.add(place(cyl(r, r * 0.96, topT, 28, mat), 0, h - topT / 2, 0));
  g.add(place(cyl(r * 0.14, r * 0.14, h - topT, 14, accent), 0, (h - topT) / 2, 0));
  g.add(place(cyl(r * 0.46, r * 0.5, topT * 0.6, 22, accent), 0, topT * 0.3, 0));
  return g;
};

const buildLamp: Builder = (w, h, d, mat) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const shadeH = h * 0.22;
  const glow = standardMaterial("lamplight");
  g.add(place(cyl(r * 0.62, r * 0.78, h * 0.03, 24, mat), 0, h * 0.015, 0));
  g.add(place(cyl(r * 0.09, r * 0.09, h * 0.78, 14, mat), 0, h * 0.4, 0));
  g.add(place(cyl(r * 0.82, r, shadeH, 26, glow), 0, h - shadeH / 2, 0));
  // A real point light: the maquette should actually be lit by its lamps.
  const light = new THREE.PointLight(0xffcf96, 0.5, 320, 2);
  light.position.set(0, h - shadeH, 0);
  g.add(light);
  return g;
};

const buildLantern: Builder = (w, h, d, mat) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const glow = standardMaterial("lamplight");
  g.add(place(cyl(r * 0.7, r * 0.85, h * 0.06, 8, mat), 0, h * 0.03, 0));
  g.add(place(cyl(r * 0.5, r * 0.5, h * 0.5, 8, mat), 0, h * 0.34, 0));
  // pierced body — the glow reads through the metal frame
  const body = cyl(r * 0.86, r * 0.72, h * 0.42, 8, glow);
  g.add(place(body, 0, h * 0.35, 0));
  g.add(place(cyl(0.6, r * 0.7, h * 0.2, 8, mat), 0, h * 0.68, 0));
  g.add(place(cyl(r * 0.06, r * 0.06, h * 0.12, 8, mat), 0, h * 0.86, 0));
  const light = new THREE.PointLight(0xffb765, 0.42, 260, 2);
  light.position.set(0, h * 0.4, 0);
  g.add(light);
  return g;
};

const buildObject: Builder = (w, h, d, mat, accent) => {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  g.add(place(cyl(r * 0.55, r * 0.8, h * 0.5, 18, accent), 0, h * 0.25, 0));
  g.add(place(cyl(r * 0.8, r * 0.5, h * 0.34, 18, mat), 0, h * 0.67, 0));
  g.add(place(cyl(r * 0.34, r * 0.5, h * 0.16, 18, mat), 0, h * 0.92, 0));
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

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0x8d857a, transparent: true, opacity: 0.5 }),
  );
  g.add(place(edges, 0, h / 2, 0));

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x6d675e, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
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
  const builder = o.origin === "found" ? null : BUILDERS[o.category];
  const g = builder
    ? builder(o.widthCm, o.heightCm, o.depthCm, mat, accent)
    : buildFound(o.widthCm, o.heightCm, o.depthCm, mat);

  g.position.set(o.x, 0, o.z);
  g.rotation.y = (o.rotationDeg * Math.PI) / 180;
  g.userData.uid = o.uid;
  g.userData.origin = o.origin;
  stampObjectIdentity(g, o);
  attachRealModel(g, o, onReady);
  if (o.origin === "found") {
    // Read as present but not authored: the catalogue pieces the user is
    // actually placing must visually dominate what was merely detected.
    // Lines and the footprint plate keep their own opacity (set above).
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
  if (o.origin === "found") return;
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
