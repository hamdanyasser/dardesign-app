/* ============================================================
   DAR Build Mode — placement rules

   Collision is done as oriented-rectangle overlap on the floor plane
   (separating-axis on two rectangles). Axis-aligned boxes would be
   cheaper, but a sofa rotated 30° into a corner is exactly the case
   where a planner has to be right, and AABB would refuse a placement
   that plainly fits.

   Everything is plan-view: two objects at different heights still
   collide, because you cannot stand a lamp inside a sofa. The one
   deliberate exception is low objects under tall ones — see LOW_PROFILE.
   ============================================================ */

import type { PlacedObject, PlacementIssue, PlacementVerdict, RoomShell } from "./types";

/** How close a wall-hugging item must be to count as against the wall. */
export const WALL_TOLERANCE_CM = 22;

/** Snap strength. Generous enough to feel magnetic, small enough that you
 *  can still place something 10cm off a wall on purpose. */
export const SNAP_WALL_CM = 26;
export const SNAP_ALIGN_CM = 14;
export const SNAP_ROTATION_DEG = 15;

/** Objects lower than this can sit under/over taller ones without colliding —
 *  a rug under a table, a pouf tucked beneath a console. */
const LOW_PROFILE_CM = 40;

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export function rectOf(o: Pick<PlacedObject, "x" | "z" | "widthCm" | "depthCm" | "rotationDeg">): Rect {
  return { x: o.x, z: o.z, w: o.widthCm, d: o.depthCm, rot: o.rotationDeg };
}

/** The four corners of an oriented rectangle, in room space. */
export function corners(r: Rect): Array<[number, number]> {
  const a = (r.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = r.w / 2;
  const hd = r.d / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [r.x + lx * c - lz * s, r.z + lx * s + lz * c] as [number, number]);
}

/** Axis-aligned extent of an oriented rectangle — used for bounds tests and
 *  for the plan-view minimap, where exactness matters less than speed. */
export function aabb(r: Rect): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const pts = corners(r);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function projectionOverlaps(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  // Separating-axis test over both rectangles' edge normals.
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const nx = -(z2 - z1);
      const nz = x2 - x1;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [px, pz] of a) {
        const p = px * nx + pz * nz;
        aMin = Math.min(aMin, p);
        aMax = Math.max(aMax, p);
      }
      for (const [px, pz] of b) {
        const p = px * nx + pz * nz;
        bMin = Math.min(bMin, p);
        bMax = Math.max(bMax, p);
      }
      // A hair of tolerance so two objects placed exactly edge-to-edge read
      // as adjacent rather than overlapping.
      if (aMax <= bMin + 0.5 || bMax <= aMin + 0.5) return false;
    }
  }
  return true;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return projectionOverlaps(corners(a), corners(b));
}

export function insideRoom(r: Rect, shell: RoomShell): boolean {
  const hw = shell.widthCm / 2;
  const hd = shell.depthCm / 2;
  const b = aabb(r);
  return b.minX >= -hw - 0.5 && b.maxX <= hw + 0.5 && b.minZ >= -hd - 0.5 && b.maxZ <= hd + 0.5;
}

export function distanceToNearestWall(r: Rect, shell: RoomShell): number {
  const hw = shell.widthCm / 2;
  const hd = shell.depthCm / 2;
  const b = aabb(r);
  return Math.min(b.minX + hw, hw - b.maxX, b.minZ + hd, hd - b.maxZ);
}

export interface EvaluateOpts {
  mustTouchWall?: boolean;
  heightCm?: number;
}

/** The single source of truth for "may this go here?". The renderer colours
 *  the ghost from this, the inspector explains it from this, and drop is
 *  refused from this — one rule, three surfaces, so they cannot disagree. */
export function evaluatePlacement(
  candidate: Rect,
  others: PlacedObject[],
  shell: RoomShell,
  opts: EvaluateOpts = {},
  ignoreUid?: string,
): PlacementVerdict {
  const blocking: PlacementIssue[] = [];
  const advisory: PlacementIssue[] = [];
  const collidingWith: string[] = [];
  let hitsPlaced = false;
  let hitsFound = false;

  if (!insideRoom(candidate, shell)) blocking.push("out-of-bounds");

  const myHeight = opts.heightCm ?? 100;
  for (const o of others) {
    if (o.uid === ignoreUid) continue;
    // A low object and a tall one may share plan space (pouf under console).
    if (Math.min(myHeight, o.heightCm) <= LOW_PROFILE_CM && Math.max(myHeight, o.heightCm) > LOW_PROFILE_CM) {
      continue;
    }
    if (!overlaps(candidate, rectOf(o))) continue;
    collidingWith.push(o.uid);
    if (o.origin === "found") hitsFound = true;
    else hitsPlaced = true;
  }
  if (hitsPlaced) blocking.push("overlaps");
  // Standing something where the photograph found existing furniture is a
  // normal act of redesign, so it is reported, not refused.
  if (hitsFound && !hitsPlaced) advisory.push("replaces-existing");

  const againstWall = distanceToNearestWall(candidate, shell) <= WALL_TOLERANCE_CM;
  if (opts.mustTouchWall && !againstWall) advisory.push("needs-wall");

  return { ok: blocking.length === 0, blocking, advisory, collidingWith, againstWall };
}

export interface SnapResult {
  x: number;
  z: number;
  /** Guides the renderer should draw, in room space, so the user can see
   *  WHY the object jumped. A snap you cannot see feels like a glitch. */
  guides: Array<{ axis: "x" | "z"; at: number; reason: "wall" | "align" }>;
}

/** Snap a dragged object to walls and to the centre-lines of its neighbours.
 *  Wall snapping wins over alignment: sitting flush to architecture matters
 *  more than lining up with another sofa. */
export function snapPosition(
  x: number,
  z: number,
  size: { widthCm: number; depthCm: number; rotationDeg: number },
  others: PlacedObject[],
  shell: RoomShell,
  ignoreUid?: string,
): SnapResult {
  const guides: SnapResult["guides"] = [];
  const b = aabb({ x, z, w: size.widthCm, d: size.depthCm, rot: size.rotationDeg });
  const halfW = (b.maxX - b.minX) / 2;
  const halfD = (b.maxZ - b.minZ) / 2;
  const hw = shell.widthCm / 2;
  const hd = shell.depthCm / 2;

  let sx = x;
  let sz = z;

  // walls
  if (Math.abs(b.minX + hw) < SNAP_WALL_CM) {
    sx = -hw + halfW;
    guides.push({ axis: "x", at: -hw, reason: "wall" });
  } else if (Math.abs(hw - b.maxX) < SNAP_WALL_CM) {
    sx = hw - halfW;
    guides.push({ axis: "x", at: hw, reason: "wall" });
  }
  if (Math.abs(b.minZ + hd) < SNAP_WALL_CM) {
    sz = -hd + halfD;
    guides.push({ axis: "z", at: -hd, reason: "wall" });
  } else if (Math.abs(hd - b.maxZ) < SNAP_WALL_CM) {
    sz = hd - halfD;
    guides.push({ axis: "z", at: hd, reason: "wall" });
  }

  // neighbour centre-lines, only on axes the walls did not already claim
  const tookX = guides.some((g) => g.axis === "x");
  const tookZ = guides.some((g) => g.axis === "z");
  let bestX: { d: number; at: number } | null = null;
  let bestZ: { d: number; at: number } | null = null;
  for (const o of others) {
    if (o.uid === ignoreUid) continue;
    const dx = Math.abs(o.x - sx);
    if (!tookX && dx < SNAP_ALIGN_CM && (!bestX || dx < bestX.d)) bestX = { d: dx, at: o.x };
    const dz = Math.abs(o.z - sz);
    if (!tookZ && dz < SNAP_ALIGN_CM && (!bestZ || dz < bestZ.d)) bestZ = { d: dz, at: o.z };
  }
  if (bestX) {
    sx = bestX.at;
    guides.push({ axis: "x", at: bestX.at, reason: "align" });
  }
  if (bestZ) {
    sz = bestZ.at;
    guides.push({ axis: "z", at: bestZ.at, reason: "align" });
  }

  return { x: sx, z: sz, guides };
}

/** Find a free spot for a newly added item. Tries the preferred zones the
 *  ontology already declares for that item before falling back to a scan, so
 *  a sofa lands against a wall and a coffee table lands in the open. */
export function findSpot(
  size: { widthCm: number; depthCm: number; heightCm: number },
  mustTouchWall: boolean,
  preferredZones: string[],
  others: PlacedObject[],
  shell: RoomShell,
): { x: number; z: number; rotationDeg: number } | null {
  const hw = shell.widthCm / 2;
  const hd = shell.depthCm / 2;
  const margin = 8;

  const wantsWall = mustTouchWall || preferredZones.includes("against_wall");
  const candidates: Array<{ x: number; z: number; rotationDeg: number }> = [];

  if (wantsWall) {
    // Walk each wall; rotation faces the object into the room.
    const steps = 9;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      candidates.push({ x: -hw + t * shell.widthCm, z: -hd + size.depthCm / 2 + margin, rotationDeg: 0 });
      candidates.push({ x: -hw + t * shell.widthCm, z: hd - size.depthCm / 2 - margin, rotationDeg: 180 });
      candidates.push({ x: -hw + size.depthCm / 2 + margin, z: -hd + t * shell.depthCm, rotationDeg: 90 });
      candidates.push({ x: hw - size.depthCm / 2 - margin, z: -hd + t * shell.depthCm, rotationDeg: 270 });
    }
  }
  // Open floor, spiralling out from the centre.
  for (let ring = 0; ring < 6; ring++) {
    const r = ring * 55;
    const n = ring === 0 ? 1 : ring * 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      candidates.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, rotationDeg: 0 });
    }
  }

  // Two passes. Auto-placement should land somewhere genuinely clear, so the
  // first pass demands no advisories either — it will not drop a new sofa on
  // top of the one already in the photograph just because that is legal. Only
  // if the room offers nothing clear does the second pass accept an advisory.
  for (const strict of [true, false]) {
    for (const c of candidates) {
      const rect: Rect = { x: c.x, z: c.z, w: size.widthCm, d: size.depthCm, rot: c.rotationDeg };
      const v = evaluatePlacement(rect, others, shell, {
        mustTouchWall,
        heightCm: size.heightCm,
      });
      if (!v.ok) continue;
      if (strict && v.advisory.length) continue;
      return c;
    }
  }
  return null;
}
