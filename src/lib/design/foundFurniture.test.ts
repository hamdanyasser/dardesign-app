import { describe, expect, it } from "vitest";
import { ADE_TO_CATALOG, resolveFoundPiece } from "./foundFurniture";
import { CATALOG, catalogItem } from "./catalog";
import type { SceneCulture } from "./types";

/* Every ADE20K class backend/projection.py can emit, minus the ones
   roomModel.ts filters out before they ever become a PlacedObject
   (OPENING_CLASSES, WALL_MOUNTED_CLASSES, ON_FURNITURE_CLASSES).

   Kept as a literal list on purpose: if the backend adds a class, this test
   fails and someone has to DECIDE what it becomes, rather than letting it fall
   through to a box by accident. */
const DETECTABLE = [
  "bed", "cabinet", "table", "chair", "sofa", "shelf", "rug", "armchair",
  "desk", "wardrobe", "lamp", "chest", "fireplace", "bookcase", "bench",
  "swivel_chair", "ottoman", "stool", "vase", "radiator",
] as const;

const REAL_CULTURES: Exclude<SceneCulture, "all">[] = ["lebanese", "khaleeji", "moroccan"];

describe("ADE_TO_CATALOG coverage", () => {
  it("has an explicit decision for every detectable class", () => {
    for (const cls of DETECTABLE) {
      expect(
        Object.prototype.hasOwnProperty.call(ADE_TO_CATALOG, cls),
        `${cls} has no entry — decide whether it maps to a catalogue category or is explicitly null`,
      ).toBe(true);
    }
  });

  it("every non-null target is a category the catalogue actually has", () => {
    const categories = new Set(CATALOG.map((c) => c.category));
    for (const [cls, cat] of Object.entries(ADE_TO_CATALOG)) {
      if (cat === null) continue;
      expect(categories.has(cat), `${cls} -> ${cat}, which no catalogue item has`).toBe(true);
    }
  });
});

describe("resolveFoundPiece", () => {
  it("resolves in every culture, for every class that has a mapping", () => {
    for (const cls of DETECTABLE) {
      if (ADE_TO_CATALOG[cls] === null) continue;
      for (const culture of REAL_CULTURES) {
        const r = resolveFoundPiece(cls, culture, 150, 80);
        expect(r, `${cls} did not resolve in ${culture}`).not.toBeNull();
        const item = catalogItem(r!.catalogId);
        expect(item, `${cls} -> ${r!.catalogId} is not a catalogue id`).toBeDefined();
        // A room must never end up with a piece from another culture in it.
        expect(item!.culture).toBe(culture);
      }
    }
  });

  it("returns null for classes the catalogue cannot stand in for", () => {
    // Drawing a bed as a sofa would be a worse lie than drawing it as a box.
    for (const cls of ["bed", "rug", "fireplace", "radiator", "vase"]) {
      expect(resolveFoundPiece(cls, "lebanese", 200, 200)).toBeNull();
    }
  });

  it("substitutes through the shared table when a culture lacks the category", () => {
    // Khaleeji has no `chair` — its seat is the majlis armchair. The result is
    // still a real Khaleeji piece and is REPORTED as a substitution.
    const r = resolveFoundPiece("chair", "khaleeji", 50, 50);
    expect(r).not.toBeNull();
    expect(r!.substituted).toBe(true);
    expect(catalogItem(r!.catalogId)!.culture).toBe("khaleeji");
  });

  it("picks the nearest candidate by footprint, not the first", () => {
    const sofas = CATALOG.filter((c) => c.culture === "lebanese" && c.category === "sofa");
    if (sofas.length < 2) return; // nothing to choose between
    const widest = sofas.reduce((a, b) => (a.widthCm > b.widthCm ? a : b));
    const r = resolveFoundPiece("sofa", "lebanese", widest.widthCm, widest.depthCm);
    expect(r!.catalogId).toBe(widest.id);
  });

  it("is case-insensitive about the class key", () => {
    expect(resolveFoundPiece("SOFA", "lebanese", 200, 90)).not.toBeNull();
  });

  it("draws an 'all' room in one concrete culture rather than refusing", () => {
    // The handoff collapses "all" to Lebanese for rendering, so the drawing
    // must agree with what the generator will be told.
    const r = resolveFoundPiece("sofa", "all", 200, 90);
    expect(r).not.toBeNull();
    expect(catalogItem(r!.catalogId)!.culture).toBe("lebanese");
  });

  it("resolves the category the BUILDERS map is keyed on, not the ADE class", () => {
    // The raw ADE key never matched BUILDERS, which is half of why every
    // detection drew as a box.
    const r = resolveFoundPiece("table", "lebanese", 110, 60);
    expect(r!.category).toBe(catalogItem(r!.catalogId)!.category);
  });
});
