/* ============================================================
   DAR Build Mode — deriving a room from what DAR already understood

   This is the part that makes Build Mode DAR's rather than a generic
   planner. You do not start on an empty grid: you start inside a plan of
   YOUR room, because /redesign already produced

     • room_analysis.free_floor_m2 + free_floor_of_floor → a floor area
     • object_map.objects → top-down footprints of what is already there
     • scale_confidence                → how much of that to believe

   Everything below is a stated derivation from those numbers. Where a
   number is missing we fall back to an explicitly-labelled default room
   and say so in the provenance, rather than inventing a measurement.
   ============================================================ */

import type { ObjectMapObject, RedesignResult } from "@/lib/api";
import { SHELL_MATERIALS } from "./materials";
import {
  SCENE_VERSION,
  type DesignScene,
  type PlacedObject,
  type RoomShell,
  type SceneCulture,
} from "./types";

/** A generous but ordinary majlis / living room, used only when DAR has no
 *  measurement to offer. Labelled "default" in provenance so the UI can say
 *  so instead of implying it measured the user's room. */
const DEFAULT_ROOM = { widthCm: 520, depthCm: 420, heightCm: 300 };

/** Rooms are drawn as rectangles; the projection gives us an area but not an
 *  aspect. 1.25 is the median long:short ratio of ordinary reception rooms
 *  and keeps a derived room from looking like a corridor. */
const DEFAULT_ASPECT = 1.25;

const MIN_SIDE_CM = 260;
const MAX_SIDE_CM = 1100;

/** Heights the projection cannot know. object_map is a floor-plane
 *  projection: it has a footprint but no elevation. These are ordinary
 *  furniture heights used purely so a found object has some volume in the
 *  maquette; every found object is flagged approximate in the inspector. */
const FOUND_HEIGHT_CM: Record<string, number> = {
  sofa: 80,
  couch: 80,
  chair: 95,
  armchair: 88,
  table: 45,
  "coffee table": 42,
  desk: 75,
  cabinet: 160,
  wardrobe: 200,
  bed: 55,
  shelf: 180,
  bookcase: 180,
  plant: 120,
  lamp: 160,
  rug: 2,
  door: 210,
  window: 140,
  painting: 90,
  television: 70,
  tv: 70,
};

function heightForClass(classKey: string): number {
  const k = classKey.toLowerCase();
  if (FOUND_HEIGHT_CM[k] != null) return FOUND_HEIGHT_CM[k];
  for (const [key, v] of Object.entries(FOUND_HEIGHT_CM)) {
    if (k.includes(key)) return v;
  }
  return 75;
}

/** Wall openings are not furniture — they belong to the shell, and dragging
 *  a "door" around a room is nonsense. They are filtered out of the object
 *  list and drawn on the walls instead. */
const OPENING_CLASSES = new Set(["door", "window", "windowpane", "doorway"]);

export function isOpeningClass(classKey: string): boolean {
  return OPENING_CLASSES.has(classKey.toLowerCase());
}

/** Things that hang on a wall. A top-down projection puts them on the floor
 *  plane like everything else, so rendering them as floor massing produces a
 *  painting standing in the middle of the room. They are dropped from the
 *  floor layout; the projection still reported them, it is just not
 *  furniture the user can design around. */
const WALL_MOUNTED_CLASSES = new Set([
  "painting",
  "picture",
  "poster",
  "mirror",
  "clock",
  "television",
  "tv",
  "screen",
  "curtain",
  "chandelier",
  "ceiling",
]);

function isWallMounted(classKey: string): boolean {
  return WALL_MOUNTED_CLASSES.has(classKey.toLowerCase());
}

/** Plausible maximum footprint per class, in cm.
 *
 *  The projection's NORMALISED footprint is real data, but converting it to
 *  centimetres multiplies it by a room size that is itself often a default
 *  guess — so a coarse blob can come out as a 190cm "chair". Capping against
 *  ordinary furniture sizes makes the model more truthful, not less: the
 *  uncertain quantity is the room scale, and an object is already labelled
 *  approximate in the inspector. */
const MAX_FOOTPRINT_CM: Record<string, [number, number]> = {
  chair: [90, 95],
  armchair: [110, 110],
  stool: [60, 60],
  sofa: [280, 110],
  couch: [280, 110],
  table: [220, 130],
  desk: [200, 90],
  cabinet: [240, 70],
  shelf: [220, 55],
  bookcase: [220, 55],
  wardrobe: [250, 75],
  bed: [220, 220],
  plant: [90, 90],
  lamp: [60, 60],
  rug: [400, 320],
};

function capFootprint(classKey: string, w: number, d: number): [number, number] {
  const k = classKey.toLowerCase();
  const cap = MAX_FOOTPRINT_CM[k] ?? Object.entries(MAX_FOOTPRINT_CM).find(([key]) => k.includes(key))?.[1];
  if (!cap) return [w, d];
  // Scale both axes by one factor so the projected proportions survive.
  const f = Math.min(1, cap[0] / Math.max(w, 1), cap[1] / Math.max(d, 1));
  return [w * f, d * f];
}

export interface DerivedRoom {
  shell: RoomShell;
  objects: PlacedObject[];
  openings: WallOpening[];
  shellSource: "measured" | "estimated" | "default";
}

/** A door or window read off the photograph, pinned to whichever wall it
 *  projected nearest to. Drawn into the shell; not draggable. */
export interface WallOpening {
  uid: string;
  kind: "door" | "window";
  wall: "north" | "south" | "east" | "west";
  /** 0..1 along that wall. */
  t: number;
  widthCm: number;
  heightCm: number;
  labelEn: string;
  labelAr: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Total floor area in m², backed out of the free-floor measurement.
 *  free_floor_m2 is the UNOCCUPIED area; free_floor_of_floor is what
 *  fraction of the floor that represents, so total = free / fraction. */
function totalFloorM2(result: RedesignResult): { m2: number | null; confident: boolean } {
  const ra = result.room_analysis;
  if (!ra || ra.placeholder) return { m2: null, confident: false };
  const free = ra.free_floor_m2;
  const frac = ra.free_floor_of_floor;
  if (typeof free !== "number" || !Number.isFinite(free) || free <= 0) {
    return { m2: null, confident: false };
  }
  if (typeof frac !== "number" || !Number.isFinite(frac) || frac <= 0.05) {
    return { m2: null, confident: false };
  }
  const total = free / frac;
  if (!Number.isFinite(total)) return { m2: null, confident: false };

  /* Plausibility band for a domestic living room / majlis.
     A single photograph has no metric scale; room_analysis calibrates against
     furniture of assumed size, and when that calibration is off it is off by a
     lot in BOTH directions. Two real measurements from the same session:
     one photo produced 130 m² (an 11 x 11 m room, furniture lost in a hall),
     another produced 3.6 m² (clamped to the 260 cm minimum, where a planned
     majlis could not fit and pieces were correctly dropped for lack of space).

     Below MIN you cannot seat people around a table and still walk; above MAX
     it is not a domestic room. Outside the band the estimate is not usable, so
     we return null and the caller falls back to DEFAULT_ROOM, labelled
     `shellSource: "default"`. That is the honest outcome: an ordinary room
     DAR does not claim to have measured beats a measurement that is visibly
     wrong. The old 2..200 band let both failures through. */
  const MIN_PLAUSIBLE_M2 = 9;
  const MAX_PLAUSIBLE_M2 = 90;
  if (total < MIN_PLAUSIBLE_M2 || total > MAX_PLAUSIBLE_M2) {
    return { m2: null, confident: false };
  }
  return { m2: total, confident: (ra.scale_confidence ?? 0) >= 0.4 };
}

export function deriveRoom(
  result: RedesignResult | null,
  culture: SceneCulture,
): DerivedRoom {
  const shellMat = SHELL_MATERIALS[culture] ?? SHELL_MATERIALS.all;
  const objects: PlacedObject[] = [];
  const openings: WallOpening[] = [];

  let widthCm = DEFAULT_ROOM.widthCm;
  let depthCm = DEFAULT_ROOM.depthCm;
  let areaM2: number | null = null;
  let scaleConfidence: number | null = null;
  let shellSource: DerivedRoom["shellSource"] = "default";

  if (result) {
    const { m2, confident } = totalFloorM2(result);
    scaleConfidence = result.room_analysis?.scale_confidence ?? null;
    if (m2 != null) {
      areaM2 = m2;
      // area = w * d, with d = w / aspect  →  w = sqrt(area * aspect)
      const wM = Math.sqrt(m2 * DEFAULT_ASPECT);
      widthCm = clamp(Math.round(wM * 100), MIN_SIDE_CM, MAX_SIDE_CM);
      depthCm = clamp(Math.round((m2 * 10000) / widthCm), MIN_SIDE_CM, MAX_SIDE_CM);
      shellSource = confident ? "measured" : "estimated";
    }
  }

  const shell: RoomShell = {
    widthCm,
    depthCm,
    heightCm: DEFAULT_ROOM.heightCm,
    areaM2,
    scaleConfidence,
    floorMaterialKey: shellMat.floor,
    wallMaterialKey: shellMat.wall,
  };

  /* ---- reconstruct what the photograph already contains ---- */
  const map = result?.object_map;
  if (map && !map.placeholder && Array.isArray(map.objects)) {
    for (let i = 0; i < map.objects.length; i++) {
      const o = map.objects[i];
      if (isOpeningClass(o.classKey)) {
        openings.push(openingFrom(o, i, shell));
        continue;
      }
      if (isWallMounted(o.classKey)) continue;
      objects.push(foundObjectFrom(o, i, shell));
    }
  }

  return { shell, objects, openings, shellSource };
}

function foundObjectFrom(o: ObjectMapObject, i: number, shell: RoomShell): PlacedObject {
  // object_map is normalized 0..1 with cy = 0 at the FAR wall. Room space has
  // z = -depth/2 at the far wall, so cy maps straight onto z.
  const x = (clamp(o.cx, 0, 1) - 0.5) * shell.widthCm;
  const z = (clamp(o.cy, 0, 1) - 0.5) * shell.depthCm;
  const rawW = clamp(o.w, 0.02, 1) * shell.widthCm;
  const rawD = clamp(o.h, 0.02, 1) * shell.depthCm;
  const [w, d] = capFootprint(o.classKey, rawW, rawD);
  return {
    uid: `found-${i}-${o.classKey}`,
    origin: "found",
    catalogId: null,
    category: o.classKey,
    labelEn: o.labelEn,
    labelAr: o.labelAr,
    x: Math.round(x),
    z: Math.round(z),
    rotationDeg: 0,
    widthCm: Math.round(clamp(w, 20, shell.widthCm)),
    depthCm: Math.round(clamp(d, 20, shell.depthCm)),
    heightCm: heightForClass(o.classKey),
    materialKey: "found",
    confidence: o.confidence,
    // Found objects describe the room as it is. Moving one turns a
    // measurement into a fiction, so it takes an explicit unlock.
    locked: true,
  };
}

function openingFrom(o: ObjectMapObject, i: number, shell: RoomShell): WallOpening {
  const cx = clamp(o.cx, 0, 1);
  const cy = clamp(o.cy, 0, 1);
  // Nearest wall wins. cy=0 is the far (north) wall.
  const dN = cy;
  const dS = 1 - cy;
  const dW = cx;
  const dE = 1 - cx;
  const min = Math.min(dN, dS, dW, dE);
  let wall: WallOpening["wall"] = "north";
  let t = cx;
  if (min === dS) {
    wall = "south";
    t = cx;
  } else if (min === dW) {
    wall = "west";
    t = cy;
  } else if (min === dE) {
    wall = "east";
    t = cy;
  }
  const kind: WallOpening["kind"] = o.classKey.toLowerCase().includes("door") ? "door" : "window";
  const along = wall === "north" || wall === "south" ? shell.widthCm : shell.depthCm;
  return {
    uid: `open-${i}-${o.classKey}`,
    kind,
    wall,
    t: clamp(t, 0.06, 0.94),
    widthCm: clamp(o.w * along, 60, along * 0.6),
    heightCm: kind === "door" ? 210 : 140,
    labelEn: o.labelEn,
    labelAr: o.labelAr,
  };
}

export function newSceneId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createScene(
  result: RedesignResult | null,
  culture: SceneCulture,
): { scene: DesignScene; openings: WallOpening[] } {
  const derived = deriveRoom(result, culture);
  const now = Date.now();
  return {
    scene: {
      version: SCENE_VERSION,
      id: newSceneId(),
      culture,
      room: derived.shell,
      objects: derived.objects,
      provenance: {
        jobId: result?.job_id ?? null,
        shellSource: derived.shellSource,
        foundCount: derived.objects.length,
        placeholder: !!result?.placeholder,
      },
      createdAt: now,
      updatedAt: now,
    },
    openings: derived.openings,
  };
}
