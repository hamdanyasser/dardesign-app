/* ============================================================
   Detected furniture -> a real catalogue piece.

   Build Mode reads furniture off the user's photograph: the room
   analyser returns an ADE20K class, a footprint and a position.
   Until now that became `buildFound()` — a translucent survey box —
   because the project's tier system says a found object has
   "footprint and class known, FORM NOT".

   The box is honest and it looks broken. This module resolves the
   detected class to the nearest piece in the room's own catalogue,
   so a detected sofa is drawn as a sofa.

   WHAT THIS DOES AND DOES NOT CLAIM. The position and the footprint
   remain measurements — they came from the photograph and the object
   stays locked so they cannot be edited into fiction. The PIECE is
   DAR's nearest catalogue match, not a claim about what the room
   contained, and the Inspector says exactly that. Anything with no
   catalogue counterpart resolves to null and keeps its massing box:
   a bed drawn as a sofa would be a worse lie than a bed drawn as a
   box.

   It also matters to the renderer, not just the viewer. Build Mode
   captures a segmentation pass in ADE20K colours and hands it to the
   ControlNet as conditioning. A box labelled `table` conditions the
   generator to produce a table. A sofa-shaped silhouette labelled
   `sofa` conditions it to produce a sofa. Getting the class and the
   silhouette right is a render-accuracy fix that happens to also
   look better.
   ============================================================ */

import { CATALOG, catalogItem } from "./catalog";
import { counterpartFor } from "./culture";
import type { CatalogItem, SceneCulture } from "./types";

/**
 * Detected ADE20K class -> catalogue category, or null for "no counterpart".
 *
 * Mirrors `ADE_TO_CATEGORY` in backend/room_analysis.py, which already does
 * this translation for the furniture recommender. Keeping the same shape means
 * the two can be diffed; a test asserts the overlap agrees.
 *
 * A null is a DECISION, not a lookup miss. Every class the projector can emit
 * appears here, so adding a class to `ADE20K_FURNITURE` without deciding what
 * it becomes will fail the coverage test rather than silently fall through to
 * a box.
 */
export const ADE_TO_CATALOG: Record<string, string | null> = {
  /* seating */
  sofa: "sofa",
  bench: "sofa",
  chair: "chair",
  swivel_chair: "chair",
  armchair: "armchair",
  ottoman: "ottoman",
  stool: "ottoman",

  /* tables */
  coffee_table: "coffee_table",
  table: "side_table",
  desk: "side_table",

  /* storage — all read as a cabinet-like volume against a wall */
  cabinet: "cabinet",
  chest: "cabinet",
  wardrobe: "cabinet",
  shelf: "console",
  bookcase: "console",

  /* light */
  lamp: "lamp",

  /* No catalogue counterpart in ANY culture. These keep their massing box,
     which is the honest drawing for "we know it is a bed, about this big,
     here" when the catalogue contains no bed. */
  bed: null,
  rug: null,
  fireplace: null,
  radiator: null,
  vase: null,
};

/** Culture used to draw a found piece when the room is set to "all". The
 *  handoff collapses "all" to Lebanese for rendering too, so this agrees with
 *  what the generator will actually be told. */
const NEUTRAL_CULTURE: Exclude<SceneCulture, "all"> = "lebanese";

export interface ResolvedFoundPiece {
  catalogId: string;
  /** The CATALOGUE category, which is what geometry.ts BUILDERS is keyed on —
   *  not the raw ADE class, which is why nothing matched before. */
  category: string;
  /** True when the culture had no piece of this category and one stood in. */
  substituted: boolean;
}

/**
 * Nearest piece by footprint, so a 240cm detection does not become a 50cm
 * stool. Same comparison `restyleObjects` uses — sum of absolute width and
 * depth difference — kept identical on purpose so a piece resolved here and
 * the same piece re-resolved during a culture swap agree.
 */
function nearestByFootprint(
  candidates: CatalogItem[],
  widthCm: number,
  depthCm: number,
): CatalogItem {
  return [...candidates].sort(
    (a, b) =>
      Math.abs(a.widthCm - widthCm) + Math.abs(a.depthCm - depthCm) -
      (Math.abs(b.widthCm - widthCm) + Math.abs(b.depthCm - depthCm)),
  )[0];
}

/**
 * The catalogue piece that stands in for this detection, or null to keep the
 * massing box.
 *
 * `widthCm`/`depthCm` are the MEASURED footprint and are used only to pick
 * between candidates — the caller keeps its own measurements. Substitution
 * across cultures goes through `counterpartFor`, which reads the shared
 * ontology/category_substitutes.json, so Khaleeji (no `chair`) resolves a
 * detected chair to its majlis armchair and reports it as substituted.
 */
export function resolveFoundPiece(
  classKey: string,
  culture: SceneCulture,
  widthCm: number,
  depthCm: number,
): ResolvedFoundPiece | null {
  const category = ADE_TO_CATALOG[classKey.toLowerCase()];
  if (!category) return null;

  const target = culture === "all" ? NEUTRAL_CULTURE : culture;
  const exact = CATALOG.filter((c) => c.culture === target && c.category === category);
  if (exact.length) {
    const item = nearestByFootprint(exact, widthCm, depthCm);
    return { catalogId: item.id, category: item.category, substituted: false };
  }

  // No piece of that category in this culture — the shared substitution chain.
  const alt = counterpartFor(category, target);
  if (!alt) return null;
  return { catalogId: alt.item.id, category: alt.item.category, substituted: true };
}

/** True when this object is drawn as a real catalogue piece rather than a
 *  massing box. Used by geometry, the Inspector and the tier reporter so the
 *  three cannot disagree about what is on screen. */
export function isCatalogueBacked(o: {
  origin: string;
  catalogId?: string | null;
}): boolean {
  return Boolean(o.catalogId) && catalogItem(o.catalogId as string) !== undefined;
}
