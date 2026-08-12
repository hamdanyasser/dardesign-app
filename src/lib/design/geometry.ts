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
import { getMaterial } from "./materials";
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
  matCache.set(key, mat);
  return mat;
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

const BUILDERS: Record<string, Builder> = {
  sofa: buildSofa,
  chair: buildChair,
  ottoman: buildOttoman,
  coffee_table: buildTable,
  side_table: buildSideTable,
  lamp: buildLamp,
  lantern: buildLantern,
  cultural_object: buildObject,
};

/** Secondary material for legs/frames/plinths — a darker relative of the
 *  primary so pieces read as made of parts without a second colour choice. */
function accentFor(key: string): THREE.MeshStandardMaterial {
  const soft = new Set(["linen", "velvet", "leather", "wool"]);
  if (soft.has(key)) return standardMaterial("walnut");
  if (key === "marble" || key === "zellige" || key === "glass") return standardMaterial("agedBrass");
  if (key === "brass" || key === "agedBrass") return standardMaterial("iron");
  return standardMaterial(key);
}

/** Build the visual for one placed object, already positioned and rotated.
 *  The returned group's userData carries the uid so a raycast hit can be
 *  resolved back to scene state without a side table of object3d→uid. */
export function buildObjectMesh(o: PlacedObject): THREE.Group {
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
  // The ADE20K class this piece will be painted as when the scene is
  // rendered into seg-ControlNet conditioning. Unmapped categories fall back
  // to the generic table class rather than going unpainted, because a hole in
  // the segmentation map reads to the model as "no object here" — which is a
  // worse lie than a slightly wrong class.
  const ade = CATEGORY_TO_ADE20K[o.category] ?? CATEGORY_TO_ADE20K.table;
  g.traverse((c) => {
    c.userData.ade = ade;
  });
  g.traverse((c) => {
    c.userData.uid = o.uid;
  });
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

/** Bounding-box helper for the selection cage. */
export function objectBounds(o: PlacedObject): { w: number; h: number; d: number } {
  return { w: o.widthCm, h: o.heightCm, d: o.depthCm };
}
