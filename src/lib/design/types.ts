/* ============================================================
   DAR Build Mode — scene model

   UNITS: centimetres, everywhere, with no exceptions. The furniture
   ontology already states real_width_cm / floor_footprint_cm, and
   /redesign already reports free_floor_m2, so the whole editor can be
   metric rather than working in arbitrary "units" that would have to be
   reconciled later. Three.js consumes cm directly (1 unit = 1 cm) and
   the camera is set up for that scale.

   AXES: X to the right, Z toward the viewer, Y up. The room's floor is
   centred on the origin, so x spans [-width/2, +width/2] and z spans
   [-depth/2, +depth/2]. That keeps rotation about an object's own centre
   trivial and makes the plan symmetric under RTL mirroring.

   The whole scene is a plain serializable object: no class instances, no
   THREE.* types, no functions. It survives JSON.stringify untouched,
   which is what makes persistence, undo/redo and a future
   "Render with DAR" hand-off all the same problem.
   ============================================================ */

import type { StyleId } from "@/context/ImageContext";

export const SCENE_VERSION = 3 as const;

/** Cultures a scene can be themed by. `all` reads as DAR's shared palette. */
export type SceneCulture = StyleId | "all";

/** Where an object in the scene came from. This distinction is load-bearing:
 *  `found` objects are DAR's reading of the user's own photograph and must
 *  never be presented as things DAR designed or as catalogue products. */
export type ObjectOrigin = "catalog" | "found";

export interface PlacedObject {
  /** Stable within a scene; regenerated on duplicate. */
  uid: string;
  origin: ObjectOrigin;
  /** Catalogue item id, or null for a `found` object read off the photo. */
  catalogId: string | null;
  category: string;
  labelEn: string;
  labelAr: string;
  /** Centre position on the floor plane, in cm, room-space. */
  x: number;
  z: number;
  /** Y rotation in degrees, clockwise seen from above. */
  rotationDeg: number;
  /** Footprint and height in cm. Catalogue objects inherit these from the
   *  ontology; found objects get them from the projected map plus a
   *  category height prior, which is why they are marked approximate. */
  widthCm: number;
  depthCm: number;
  heightCm: number;
  /** Key into MATERIALS. Drives colour, roughness and metalness. */
  materialKey: string;
  /** Found objects carry the projection's own confidence, 0..1. Catalogue
   *  objects have none — they are placed, not inferred. */
  confidence?: number;
  /** Found objects start locked: they describe what is already in the room,
   *  so moving one silently would turn a measurement into a fiction. The
   *  user can unlock explicitly, which reclassifies it as a design decision. */
  locked?: boolean;
}

export interface RoomShell {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  /** Measured floor area from /redesign's room analysis. Null when the
   *  backend could not estimate it — rendered as an em dash, never a guess. */
  areaM2: number | null;
  /** 0..1 from the backend. Below ~0.4 the shell is shown as approximate. */
  scaleConfidence: number | null;
  floorMaterialKey: string;
  wallMaterialKey: string;
}

export interface SceneProvenance {
  /** Which /redesign job this room was derived from, when it was. */
  jobId: string | null;
  /** How the shell dimensions were arrived at. Drives the honesty chip in
   *  the header: a measured room says so, a default one says that too. */
  shellSource: "measured" | "estimated" | "default";
  /** How many objects were reconstructed from the photograph. */
  foundCount: number;
  /** True when the source result was a LIGHT-mode / demo stand-in. */
  placeholder: boolean;
}

export interface DesignScene {
  version: typeof SCENE_VERSION;
  id: string;
  culture: SceneCulture;
  room: RoomShell;
  objects: PlacedObject[];
  provenance: SceneProvenance;
  createdAt: number;
  updatedAt: number;
}

/* ---------- catalogue ---------- */

/** How a piece is represented in 3D, in descending order of how much DAR
 *  actually knows about its form. Surfaced in the inspector, because the
 *  difference between "this is a scanned object" and "this is our drawing of
 *  the object" and "this is a box where the photo found something" is a claim
 *  about evidence, and the product should not blur it.
 *
 *  Defined in ontology/furniture_models.json, which carries the prose. */
export type ModelTier = "real" | "procedural" | "massing";

/** A real 3D asset backing one catalogue item. Absent for most of them --
 *  see furniture_models.json for why. */
export interface CatalogModel {
  tier: "real";
  /** Relative to /public, so "models/x/x.gltf" serves at "/models/x/x.gltf". */
  path: string;
  /** The asset's own name. The inspector shows THIS, not the catalogue name,
   *  so a stand-in is never presented as the catalogue piece. */
  assetName: string;
  author: string;
  source: string;
  license: string;
  /** "contain": scale uniformly to sit inside the catalogue box. */
  fit: "contain";
  note?: string;
}

/** One item of the furniture ontology, narrowed to what the editor needs. */
export interface CatalogItem {
  id: string;
  culture: StyleId;
  category: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  mustTouchWall: boolean;
  preferredZones: string[];
  materialTags: string[];
  colorTags: string[];
  culturalTags: string[];
  /** Rooms this piece belongs in, from the ontology's own `room_types`. */
  roomTypes: string[];
  /** `floor_standing` for all 27 today; the ontology defers the rest. */
  placementType: string;
  /** [width, depth] in cm — the ontology's own footprint, kept alongside the
   *  dimensions so nothing has to re-derive it. */
  floorFootprintCm: [number, number];
  mustStandOnFloor: boolean;
  /** Transparent PNG cut-out. Used in the catalogue card, never in the 3D
   *  scene — a billboarded photo among real volumes reads as a sticker. */
  assetUrl: string;
  /** Present only for the handful of items with a real 3D asset. */
  model?: CatalogModel;
}

/* ---------- placement validity ---------- */

export type PlacementIssue =
  | "out-of-bounds"
  | "overlaps"
  | "replaces-existing"
  | "needs-wall";

/** Placement has two tiers, and conflating them made the editor feel broken.
 *
 *  BLOCKING is physics the user cannot mean: a piece outside the room, or
 *  inside another piece they themselves placed.
 *
 *  ADVISORY is judgement. Standing a new sofa where the photograph found the
 *  old one is the single most likely thing someone redesigning a room wants
 *  to do, and the ontology's `must_touch_wall` is a design convention, not a
 *  law. Both are said out loud and neither is prevented. */
export interface PlacementVerdict {
  /** False only for blocking issues. Advisories never refuse a drop. */
  ok: boolean;
  blocking: PlacementIssue[];
  advisory: PlacementIssue[];
  /** uids of objects this placement currently intersects. */
  collidingWith: string[];
  /** True when the object is close enough to a wall to satisfy must_touch_wall. */
  againstWall: boolean;
}

/* ---------- history ---------- */

/** Undo/redo stores whole-scene snapshots rather than inverse commands.
 *  A scene is a few dozen small plain objects, so a snapshot costs
 *  microseconds, and it cannot drift out of sync with the live state the
 *  way a hand-written inverse for every operation eventually does. */
export interface HistoryEntry {
  scene: DesignScene;
  /** Shown in the undo tooltip: "Undo move sofa". Bilingual at the edge. */
  labelEn: string;
  labelAr: string;
}
