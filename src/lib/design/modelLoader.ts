/* ============================================================
   DAR Build Mode — real 3D assets

   Loads the handful of catalogue pieces that have an actual detailed model
   (see ontology/furniture_models.json) and fits them to the dimensions the
   rest of the system already believes.

   TWO RULES, both load-bearing.

   1. THE VISUAL MAY NEVER OUTGROW THE COLLISION BOX. placement.ts collides an
      oriented rectangle derived from the catalogue's own width/depth, and the
      inspector, the plan minimap and the planner all quote those numbers. So a
      model is scaled UNIFORMLY to sit inside its declared box -- "contain",
      never a per-axis stretch, which would misreport the piece's proportions,
      and never a fit that lets a corner poke through a wall the validator
      says it clears. A beautiful model with a wrong footprint is worse than a
      box with a right one.

   2. NOTHING UNCLASSIFIED MAY REACH THE SEGMENTATION PASS. Loading is async;
      buildObjectMesh is not. If a mesh simply appeared in the group whenever
      the network happened to finish, it would arrive without `userData.ade`,
      and renderConditioning hides every drawable that has no class -- so a
      piece could silently vanish from the ControlNet conditioning, which reads
      to the model as "no object here". The swap therefore re-stamps the whole
      subtree through the same helper buildObjectMesh uses, and a procedural
      stand-in is on screen from the first frame regardless.
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Prototypes, keyed by url. Each asset is fetched and parsed exactly once;
 *  every placement is a clone that shares its geometry and materials. */
const protos = new Map<string, Promise<THREE.Group>>();

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  // Constructed lazily: /design is a client component, but the module graph is
  // still evaluated during the server build, and GLTFLoader touches nothing
  // that exists there.
  if (!loader) loader = new GLTFLoader();
  return loader;
}

/** Marks a whole subtree as belonging to a shared prototype.
 *
 *  Object3D.clone() copies transforms but SHARES geometry and material
 *  references, which is exactly what makes a second ottoman free. It also
 *  means DesignWorld.disposeObject would, on removing one instance, dispose
 *  the geometry every other instance is still drawing with. The flag is how
 *  disposal knows to leave these alone. */
function markShared(root: THREE.Object3D) {
  root.traverse((c) => {
    c.userData.sharedAsset = true;
  });
}

/** Fetch and parse one asset, once. */
export function loadModelProto(url: string): Promise<THREE.Group> {
  const hit = protos.get(url);
  if (hit) return hit;

  const p = new Promise<THREE.Group>((resolve, reject) => {
    gltfLoader().load(
      url,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        markShared(root);
        resolve(root);
      },
      undefined,
      (err) => reject(err),
    );
  });
  protos.set(url, p);
  return p;
}

/** A clone of `proto`, uniformly scaled to sit inside w x h x d (cm) and
 *  seated on the floor with its footprint centred on the group origin — the
 *  same convention every procedural builder uses, so selection cages, ghosts,
 *  rotation and the capture camera's occupancy test all keep working
 *  unchanged.
 *
 *  glTF is metres and Y-up; the fit is derived from the measured bounding box
 *  rather than a unit assumption, so the source's scale never has to be
 *  trusted. */
export function instantiateModel(
  proto: THREE.Group,
  w: number,
  h: number,
  d: number,
): THREE.Group {
  const inst = proto.clone(true);

  const box = new THREE.Box3().setFromObject(inst);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return inst;

  const s = Math.min(w / size.x, h / size.y, d / size.z);
  inst.scale.setScalar(s);

  // Re-measure after scaling rather than scaling the old numbers: a model whose
  // pivot is not at its centre (most scans) needs the real post-scale bounds.
  inst.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(inst);
  const c = scaled.getCenter(new THREE.Vector3());
  inst.position.x -= c.x;
  inst.position.z -= c.z;
  inst.position.y -= scaled.min.y;

  const wrap = new THREE.Group();
  wrap.add(inst);
  markShared(wrap);
  return wrap;
}

/** How much of its declared box the fitted model actually fills, per axis.
 *  Surfaced so the honesty chip can say a piece is drawn smaller than the
 *  footprint it reserves rather than leaving that for someone to notice. */
export function fitReport(
  proto: THREE.Group,
  w: number,
  h: number,
  d: number,
): { fill: number; scale: number } {
  const box = new THREE.Box3().setFromObject(proto);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return { fill: 1, scale: 1 };
  const s = Math.min(w / size.x, h / size.y, d / size.z);
  const filled = (size.x * s * size.z * s) / (w * d);
  return { fill: Math.min(1, filled), scale: s };
}

/** Test seam and teardown. Prototypes outlive a single DesignWorld on purpose
 *  — remounting /design should not re-download — so this is only for tests. */
export function __clearModelCache() {
  protos.clear();
}
