/* ============================================================
   The client trust gate for planned layouts.

   A plan arrives as a proposal. This module decides what, if any of it,
   is allowed to become furniture — using `evaluatePlacement`, the same
   oriented-rectangle collision engine that colours the drag ghost and
   refuses a human drop. One rule, both authors: the model gets no more
   latitude than the person does.

   Order matters. Items are validated against the scene *as it is being
   built*, so the second piece is judged against the first. Validating
   them all against the empty room would let a plan overlap itself.

   Repair before rejection: a blocked piece is retried once through
   `findSpot`, the existing auto-placer. A model that proposed a sensible
   sofa 3cm into a wall should be nudged, not discarded — but a piece
   that cannot be placed at all is dropped and named, never squeezed in.

   No React, no THREE — pure, so it can be reasoned about and tested.
   ============================================================ */

import type { PlannedItem } from "@/lib/api";
import { catalogItem } from "./catalog";
import { MATERIALS } from "./materials";
import { evaluatePlacement, findSpot, overlaps, rectOf, snapPosition } from "./placement";
import type { WallOpening } from "./roomModel";
import type { DesignScene, PlacedObject, RoomShell } from "./types";

/* ------------------------------------------------------------------
   Circulation: the floor a door or window needs left alone.

   "Don't block the balcony door" is only meaningful if DAR knows where
   the door is — and it does, but only when a photograph was analysed
   (`openings` is `[]` for the default room, which the panel says out
   loud rather than implying knowledge it lacks).

   The zone is derived the same way scene3d.ts:280-302 positions the
   opening itself, so the rectangle we protect is the one drawn.
   ------------------------------------------------------------------ */

/** How far into the room a door's swing and approach is kept clear. */
const DOOR_CLEAR_CM = 90;
/** A window only needs its sill kept free of tall furniture. */
const WINDOW_CLEAR_CM = 40;

export function openingZone(o: WallOpening, room: RoomShell) {
  const depth = o.kind === "door" ? DOOR_CLEAR_CM : WINDOW_CLEAR_CM;
  const halfW = room.widthCm / 2;
  const halfD = room.depthCm / 2;
  // t runs along the wall; north/south run along x, east/west along z.
  if (o.wall === "north" || o.wall === "south") {
    const x = -halfW + o.t * room.widthCm;
    const z = o.wall === "north" ? -halfD + depth / 2 : halfD - depth / 2;
    return { x, z, w: o.widthCm, d: depth, rot: 0 };
  }
  const z = -halfD + o.t * room.depthCm;
  const x = o.wall === "west" ? -halfW + depth / 2 : halfW - depth / 2;
  return { x, z, w: depth, d: o.widthCm, rot: 0 };
}

/** Would this footprint stand in the way of a door or a window? */
function blockedOpening(
  rect: ReturnType<typeof rectOf>,
  openings: WallOpening[],
  room: RoomShell,
): WallOpening | null {
  for (const o of openings) {
    if (overlaps(rect, openingZone(o, room))) return o;
  }
  return null;
}

export interface AcceptedPlacement {
  catalogId: string;
  x: number;
  z: number;
  rotationDeg: number;
  materialKey: string | null;
  reasonEn: string;
  reasonAr: string;
  /** True when the engine moved it from where the plan asked. */
  repaired: boolean;
  /** Advisory notes that did not block it — e.g. it replaces a found piece. */
  advisory: string[];
  /** Set when the piece still stands in a detected door or window's way. */
  blocksOpening: { kind: "door" | "window"; labelEn: string; labelAr: string } | null;
}

export interface DroppedPlacement {
  catalogId: string;
  reasonEn: string;
  reasonAr: string;
}

export interface GatedPlan {
  placements: AcceptedPlacement[];
  dropped: DroppedPlacement[];
}

/** A lightweight stand-in so a pending item can be judged before it exists. */
function provisional(
  uid: string,
  catalogId: string,
  x: number,
  z: number,
  rotationDeg: number,
): PlacedObject {
  const item = catalogItem(catalogId)!;
  return {
    uid,
    origin: "catalog",
    catalogId,
    category: item.category,
    labelEn: item.nameEn,
    labelAr: item.nameAr,
    x,
    z,
    rotationDeg,
    widthCm: item.widthCm,
    depthCm: item.depthCm,
    heightCm: item.heightCm,
    materialKey: "cedar",
  };
}

/**
 * Run a plan past the placement engine.
 *
 * Never throws and never mutates `scene`. Returns exactly what may be added
 * and exactly what was refused, so the panel can tell the truth about both.
 */
export function gatePlan(
  items: PlannedItem[],
  scene: DesignScene,
  openings: WallOpening[] = [],
): GatedPlan {
  const placements: AcceptedPlacement[] = [];
  const dropped: DroppedPlacement[] = [];

  // The scene grows as we accept, so each piece is judged against the last.
  const working: PlacedObject[] = [...scene.objects];

  for (const [i, planned] of items.entries()) {
    const item = catalogItem(planned.catalogId);
    if (!item) {
      // Gate 1 already made this near-impossible; kept because "near" is not "never".
      dropped.push({
        catalogId: planned.catalogId,
        reasonEn: "Not a piece in DAR's catalogue.",
        reasonAr: "ليست قطعة في كتالوج دار.",
      });
      continue;
    }

    // Culture coherence. One room, one design language, unless the room asked
    // for all three.
    //
    // The backend enforces this too (validate_items), and the schema enum now
    // makes it unrepresentable for a concrete culture — but this gate is the
    // one that is always in force. gatePlan also runs over the RULES fallback
    // when no model is configured, and over anything a future caller hands it,
    // and it is the last thing between a plan and the user's room. A
    // wrong-culture piece must not pass silently; it is dropped and named.
    if (scene.culture !== "all" && item.culture !== scene.culture) {
      dropped.push({
        catalogId: planned.catalogId,
        reasonEn: `A ${item.culture} piece in a ${scene.culture} room.`,
        reasonAr: `قطعة ${item.culture} في غرفة ${scene.culture}.`,
      });
      continue;
    }

    const uid = `__plan_${i}__`;
    const rot = Number.isFinite(planned.rotationDeg) ? planned.rotationDeg : 0;

    const snapped = snapPosition(
      planned.xCm,
      planned.zCm,
      { widthCm: item.widthCm, depthCm: item.depthCm, rotationDeg: rot },
      working,
      scene.room,
      uid,
    );

    let x = snapped.x;
    let z = snapped.z;
    let rotation = rot;
    let repaired = false;

    let verdict = evaluatePlacement(
      rectOf({ x, z, widthCm: item.widthCm, depthCm: item.depthCm, rotationDeg: rotation }),
      working,
      scene.room,
      { mustTouchWall: item.mustTouchWall, heightCm: item.heightCm },
      uid,
    );

    // Standing in a doorway is not a collision, so the SAT engine has nothing
    // to say about it — this is a separate, equally deterministic check.
    let blocking = blockedOpening(
      rectOf({ x, z, widthCm: item.widthCm, depthCm: item.depthCm, rotationDeg: rotation }),
      openings,
      scene.room,
    );

    if (!verdict.ok || blocking) {
      // One repair attempt through the existing auto-placer.
      const spot = findSpot(
        { widthCm: item.widthCm, depthCm: item.depthCm, heightCm: item.heightCm },
        item.mustTouchWall,
        item.preferredZones,
        working,
        scene.room,
      );
      if (spot) {
        x = spot.x;
        z = spot.z;
        rotation = spot.rotationDeg;
        repaired = true;
        verdict = evaluatePlacement(
          rectOf({ x, z, widthCm: item.widthCm, depthCm: item.depthCm, rotationDeg: rotation }),
          working,
          scene.room,
          { mustTouchWall: item.mustTouchWall, heightCm: item.heightCm },
          uid,
        );
        blocking = blockedOpening(
          rectOf({ x, z, widthCm: item.widthCm, depthCm: item.depthCm, rotationDeg: rotation }),
          openings,
          scene.room,
        );
      }
    }

    if (!verdict.ok) {
      dropped.push({
        catalogId: planned.catalogId,
        reasonEn: "There was no room left for it.",
        reasonAr: "لم تتبقَّ مساحة له.",
      });
      continue;
    }

    // A material the model invented degrades to the item's default rather than
    // failing the piece — the wrong wood is a smaller lie than a missing sofa.
    const materialKey =
      planned.materialKey && planned.materialKey in MATERIALS ? planned.materialKey : null;

    placements.push({
      catalogId: planned.catalogId,
      x: Math.round(x),
      z: Math.round(z),
      rotationDeg: Math.round(rotation) % 360,
      materialKey,
      reasonEn: planned.reasonEn,
      reasonAr: planned.reasonAr,
      repaired,
      advisory: verdict.advisory,
      // Reported, not refused: standing near a door is judgement, not physics,
      // and the two-tier rule keeps judgement out of the blocking column.
      blocksOpening: blocking
        ? { kind: blocking.kind, labelEn: blocking.labelEn, labelAr: blocking.labelAr }
        : null,
    });

    working.push(provisional(uid, planned.catalogId, x, z, rotation));
  }

  return { placements, dropped };
}
