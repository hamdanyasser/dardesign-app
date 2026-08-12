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
import { evaluatePlacement, findSpot, rectOf, snapPosition } from "./placement";
import type { DesignScene, PlacedObject } from "./types";

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
export function gatePlan(items: PlannedItem[], scene: DesignScene): GatedPlan {
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

    if (!verdict.ok) {
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
    });

    working.push(provisional(uid, planned.catalogId, x, z, rotation));
  }

  return { placements, dropped };
}
