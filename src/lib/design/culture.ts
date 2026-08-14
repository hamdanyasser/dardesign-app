/* ============================================================
   Changing a room's culture — including the furniture standing in it.

   Setting `scene.culture` used to change the label, the accent, the
   catalogue rail and the shell materials, and nothing else. The pieces
   already in the room kept their old culture, so a "Moroccan room"
   stayed full of Lebanese furniture — and the cultural identity of a
   room lives in its pieces, not its label. Render with DAR made it
   worse rather than better: it prompted Moroccan while conditioning on
   Lebanese geometry, so the render came back a hybrid of both.

   Conversion is deterministic and preserves the arrangement: every
   piece becomes its counterpart in the target culture AT THE SAME
   position and rotation. That is the point — you customised this room,
   so changing its culture must change the vocabulary, not the layout.

   Two callers, one implementation:
     · PlanPanel, when a brief changes the culture ("make this Moroccan")
     · the catalogue rail's own culture switcher

   Nothing here places anything. It returns a proposal; `gatePlan` and
   the placement engine decide what may actually enter the scene.
   ============================================================ */

import substituteData from "../../../ontology/category_substitutes.json";
import { CATALOG, catalogItem, defaultMaterialFor } from "./catalog";
import type { CatalogItem, PlacedObject, SceneCulture } from "./types";

/** Shared with backend/design_planner.py — one file, so the two cannot drift. */
const SUBSTITUTES = (substituteData as { substitutes: Record<string, string[]> }).substitutes;

export interface CultureConversion {
  uid: string;
  fromCatalogId: string;
  toCatalogId: string;
  fromNameEn: string;
  fromNameAr: string;
  toNameEn: string;
  toNameAr: string;
  /** True when the target culture had no piece of this category and one stood in. */
  substituted: boolean;
  x: number;
  z: number;
  rotationDeg: number;
}

export interface CultureConversionPlan {
  conversions: CultureConversion[];
  /** Pieces with no counterpart at all — left exactly as they are, never dropped. */
  kept: PlacedObject[];
}

/**
 * The piece that plays this category's role in this culture.
 *
 * Exact match first; otherwise the substitution chain, which is the same
 * table the backend's count enforcement reads.
 */
export function counterpartFor(
  category: string,
  culture: SceneCulture,
): { item: CatalogItem; substituted: boolean } | null {
  if (culture === "all") return null;
  const inCulture = CATALOG.filter((c) => c.culture === culture);

  const exact = inCulture.find((c) => c.category === category);
  if (exact) return { item: exact, substituted: false };

  for (const alt of SUBSTITUTES[category] ?? []) {
    const found = inCulture.find((c) => c.category === alt);
    if (found) return { item: found, substituted: true };
  }
  return null;
}

/**
 * What it would take to make every piece in this room belong to `target`.
 *
 * Never mutates. Returns only what changes: a piece already in the target
 * culture produces no conversion, and neither does one that must not be
 * touched.
 *
 * `found` massing and locked pieces are deliberately excluded. Found objects
 * are DAR's reading of the user's photograph — converting one would claim the
 * photographed room contained a piece it did not — and a locked piece is an
 * explicit instruction to leave it alone. This is the same rule the planner's
 * `movable_objects()` applies server-side.
 */
export function planCultureConversion(
  objects: PlacedObject[],
  target: SceneCulture,
  opts: { skipUids?: Set<string> } = {},
): CultureConversionPlan {
  const conversions: CultureConversion[] = [];
  const kept: PlacedObject[] = [];
  if (target === "all") return { conversions, kept };

  for (const o of objects) {
    if (o.origin !== "catalog" || o.locked || !o.catalogId) continue;
    if (opts.skipUids?.has(o.uid)) continue;

    const from = catalogItem(o.catalogId);
    if (!from || from.culture === target) continue;

    const counterpart = counterpartFor(from.category, target);
    if (!counterpart) {
      // No piece in the target culture can play this role. Leaving it is the
      // honest answer — silently deleting the user's furniture to make a
      // cultural claim tidy would be the worst option on the table.
      kept.push(o);
      continue;
    }

    conversions.push({
      uid: o.uid,
      fromCatalogId: from.id,
      toCatalogId: counterpart.item.id,
      fromNameEn: from.nameEn,
      fromNameAr: from.nameAr,
      toNameEn: counterpart.item.nameEn,
      toNameAr: counterpart.item.nameAr,
      substituted: counterpart.substituted,
      x: Math.round(o.x),
      z: Math.round(o.z),
      rotationDeg: Math.round(o.rotationDeg),
    });
  }

  return { conversions, kept };
}

/**
 * A scene's pieces restyled to another culture IN PLACE — same uids, same
 * positions, swapped identity and footprint.
 *
 * This is the rule `restyleTo` applies, lifted out of the reducer so exactly
 * one implementation exists. The panel needs it too: a redesign gates the
 * model's `move` operations, and it has to gate them against the footprints
 * the room will HAVE, not the ones it has now. A Moroccan sedari is not the
 * size of the Lebanese sofa it replaces, so a move validated before the swap
 * can collide after it. Two copies of this logic would put the preview and the
 * applied result quietly out of step.
 *
 * Keeping the uid is what makes a redesign possible at all: the model plans
 * moves against the pieces it was shown, and they must still be there — as
 * their counterparts — when those moves land.
 *
 * Exact category match only, no substitution chain: `unmatched` is reported so
 * the UI can say a piece had no counterpart, which is honest, where silently
 * substituting a different category would not be.
 */
export function restyleObjects(
  objects: PlacedObject[],
  culture: SceneCulture,
): { objects: PlacedObject[]; changed: number; unmatched: PlacedObject[] } {
  if (culture === "all") return { objects, changed: 0, unmatched: [] };

  let changed = 0;
  const unmatched: PlacedObject[] = [];

  const next = objects.map((o) => {
    if (o.origin === "found" || !o.catalogId) return o;
    const from = catalogItem(o.catalogId);
    if (!from || from.culture === culture) return o;

    const candidates = CATALOG.filter(
      (c) => c.culture === culture && c.category === from.category,
    );
    if (!candidates.length) {
      unmatched.push(o);
      return o;
    }
    // Nearest by footprint, so a 240cm majlis does not become a 50cm chair.
    const to = [...candidates].sort(
      (a, b) =>
        Math.abs(a.widthCm - from.widthCm) + Math.abs(a.depthCm - from.depthCm) -
        (Math.abs(b.widthCm - from.widthCm) + Math.abs(b.depthCm - from.depthCm)),
    )[0];
    changed++;
    return {
      ...o,
      catalogId: to.id,
      labelEn: to.nameEn,
      labelAr: to.nameAr,
      widthCm: to.widthCm,
      depthCm: to.depthCm,
      heightCm: to.heightCm,
      materialKey: defaultMaterialFor(to),
    };
  });

  return { objects: next, changed, unmatched };
}

/**
 * A conversion expressed in the vocabulary `gatePlan` already understands:
 * take the old piece out, put the counterpart in at the same spot.
 *
 * Going through the ordinary removal + addition path rather than mutating
 * `catalogId` in place is what keeps the collision engine in charge — the new
 * piece has its own real footprint from the ontology, which may be wider than
 * what it replaces, and it must be judged on that.
 */
export function conversionOps(conversions: CultureConversion[]) {
  return {
    removals: conversions.map((c) => ({
      targetUid: c.uid,
      reasonEn: `Replaced by the ${c.toNameEn.toLowerCase()}.`,
      reasonAr: `استُبدلت بـ${c.toNameAr}.`,
    })),
    items: conversions.map((c) => ({
      catalogId: c.toCatalogId,
      xCm: c.x,
      zCm: c.z,
      rotationDeg: c.rotationDeg,
      materialKey: null,
      reasonEn: `Stands where the ${c.fromNameEn.toLowerCase()} did.`,
      reasonAr: `يقف مكان ${c.fromNameAr}.`,
    })),
  };
}
