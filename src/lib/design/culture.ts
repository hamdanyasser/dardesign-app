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
import { CATALOG, catalogItem } from "./catalog";
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
