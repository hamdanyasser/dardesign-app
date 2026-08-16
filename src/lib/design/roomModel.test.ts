import { describe, expect, it } from "vitest";
import { deriveRoom } from "./roomModel";
import { catalogItem } from "./catalog";
import type { RedesignResult } from "@/lib/api";

/** A response shaped like the real one, with an object_map the projector could
 *  actually have produced. cy is post-flip (0 = far wall), matching what
 *  backend/main.py sends. */
function resultWith(objects: Array<Record<string, unknown>>): RedesignResult {
  return {
    original: "data:image/png;base64,x",
    lebanese: "data:image/png;base64,y",
    styles: ["lebanese"],
    object_map: { jobId: "j", style: "all", objects, version: "projection-v1" },
    room_analysis: {
      free_floor_m2: 12,
      free_floor_of_floor: 0.55,
      scale_confidence: 0.8,
    },
  } as unknown as RedesignResult;
}

const obj = (classKey: string, over: Record<string, unknown> = {}) => ({
  classKey,
  labelEn: classKey,
  labelAr: classKey,
  cx: 0.5,
  cy: 0.5,
  w: 0.3,
  h: 0.2,
  area: 0.06,
  confidence: 0.8,
  ...over,
});

describe("deriveRoom — detected furniture becomes real catalogue pieces", () => {
  it("resolves the common classes to catalogue items of the room's culture", () => {
    const { objects } = deriveRoom(
      resultWith([obj("sofa"), obj("armchair"), obj("coffee_table"), obj("cabinet"), obj("lamp")]),
      "lebanese",
    );
    expect(objects).toHaveLength(5);
    for (const o of objects) {
      expect(o.origin).toBe("found");
      expect(o.catalogId, `${o.category} did not resolve to a catalogue piece`).toBeTruthy();
      expect(catalogItem(o.catalogId!)!.culture).toBe("lebanese");
      // The piece is a stand-in; the POSITION and SIZE are still measurements,
      // so it stays locked.
      expect(o.locked).toBe(true);
      // A real material, not the neutral survey grey.
      expect(o.materialKey).not.toBe("found");
    }
  });

  it("keeps the MEASURED footprint rather than the catalogue's", () => {
    // w 0.6 of a derived room is a wide sofa. The catalogue piece chosen must
    // not resize it — the footprint came from the photograph.
    const { objects } = deriveRoom(resultWith([obj("sofa", { w: 0.6, h: 0.25 })]), "lebanese");
    const sofa = objects[0];
    const item = catalogItem(sofa.catalogId!)!;
    expect(sofa.widthCm).not.toBe(item.widthCm);
    expect(sofa.widthCm).toBeGreaterThan(150);
  });

  it("leaves classes with no counterpart as massing", () => {
    const { objects } = deriveRoom(resultWith([obj("bed"), obj("rug")]), "lebanese");
    for (const o of objects) {
      expect(o.catalogId).toBeNull();
      expect(o.materialKey).toBe("found");
    }
  });

  it("substitutes rather than failing where a culture lacks the category", () => {
    // Khaleeji has no `chair`.
    const { objects } = deriveRoom(resultWith([obj("chair")]), "khaleeji");
    expect(objects[0].catalogId).toBeTruthy();
    expect(catalogItem(objects[0].catalogId!)!.culture).toBe("khaleeji");
  });

  it("gives a coffee table its own height, not the generic table height", () => {
    // The key was "coffee table" with a space while the classKey is
    // `coffee_table`, so the exact lookup missed and the substring loop hit
    // "table" first — every coffee table came out 45cm.
    const { objects } = deriveRoom(resultWith([obj("coffee_table")]), "lebanese");
    expect(objects[0].heightCm).toBe(42);
  });

  it("caps classes that used to be uncapped", () => {
    // A merged segmentation blob must not become room-sized furniture.
    const { objects } = deriveRoom(
      resultWith([obj("ottoman", { w: 0.95, h: 0.95 })]),
      "lebanese",
    );
    expect(objects[0].widthCm).toBeLessThanOrEqual(90);
    expect(objects[0].depthCm).toBeLessThanOrEqual(90);
  });

  it("still drops wall-mounted and on-furniture classes", () => {
    const { objects } = deriveRoom(
      resultWith([obj("painting"), obj("curtain"), obj("cushion"), obj("sofa")]),
      "lebanese",
    );
    expect(objects.map((o) => o.category)).toEqual([catalogItem(objects[0].catalogId!)!.category]);
  });

  it("still turns doors and windows into openings, not furniture", () => {
    const { objects, openings } = deriveRoom(
      resultWith([obj("door", { cx: 0.1 }), obj("window", { cx: 0.9 })]),
      "lebanese",
    );
    expect(objects).toHaveLength(0);
    expect(openings).toHaveLength(2);
  });
});
