/* ============================================================
   Culture conversion — the furniture, not just the label.

   The bug these exist for: setting `scene.culture` changed the accent,
   the rail and the shell materials, and left every piece of furniture
   in its original culture. A "Moroccan room" full of Lebanese seating
   reads as neither, and Render with DAR then prompts one culture while
   conditioning on the geometry of another.
   ============================================================ */

import { describe, expect, it } from "vitest";
import { conversionOps, counterpartFor, planCultureConversion } from "./culture";
import { CATALOG, catalogItem, defaultMaterialFor } from "./catalog";
import { getMaterial } from "./materials";
import { gatePlan } from "./planner";
import { createScene } from "./roomModel";
import type { PlacedObject, SceneCulture } from "./types";

const CULTURES: SceneCulture[] = ["lebanese", "khaleeji", "moroccan"];

function obj(uid: string, catalogId: string, extra: Partial<PlacedObject> = {}): PlacedObject {
  const item = catalogItem(catalogId)!;
  return {
    uid,
    origin: "catalog",
    catalogId,
    category: item.category,
    labelEn: item.nameEn,
    labelAr: item.nameAr,
    x: 40,
    z: -80,
    rotationDeg: 90,
    widthCm: item.widthCm,
    depthCm: item.depthCm,
    heightCm: item.heightCm,
    materialKey: "cedar",
    ...extra,
  } as PlacedObject;
}

describe("counterpartFor", () => {
  it("finds the same category in the target culture", () => {
    const r = counterpartFor("sofa", "moroccan");
    expect(r?.item.culture).toBe("moroccan");
    expect(r?.item.category).toBe("sofa");
    expect(r?.substituted).toBe(false);
  });

  it("substitutes when the culture has no such category, and says so", () => {
    // Khaleeji has no chair; its seat is the majlis armchair.
    expect(CATALOG.some((c) => c.culture === "khaleeji" && c.category === "chair")).toBe(false);
    const r = counterpartFor("chair", "khaleeji");
    expect(r?.item.id).toBe("khal-armchair-001");
    expect(r?.substituted).toBe(true);
  });

  it("answers for every category present in every other culture", () => {
    // Any piece in any culture must be convertible into any other culture,
    // or a room could only be half-converted — which is the state this whole
    // module exists to prevent.
    for (const from of CULTURES) {
      for (const to of CULTURES) {
        if (from === to) continue;
        for (const item of CATALOG.filter((c) => c.culture === from)) {
          const r = counterpartFor(item.category, to);
          expect(r, `${from}.${item.category} -> ${to}`).not.toBeNull();
          expect(r!.item.culture).toBe(to);
        }
      }
    }
  });

  it("has no counterpart for the mixed 'all' catalogue", () => {
    // "all" is not a culture, so there is nothing to convert INTO.
    expect(counterpartFor("sofa", "all")).toBeNull();
  });
});

describe("planCultureConversion", () => {
  it("keeps position and rotation exactly", () => {
    const objects = [obj("u1", "leb-sofa-001", { x: 123, z: -45, rotationDeg: 270 })];
    const { conversions } = planCultureConversion(objects, "moroccan");
    expect(conversions).toHaveLength(1);
    expect([conversions[0].x, conversions[0].z, conversions[0].rotationDeg]).toEqual([123, -45, 270]);
  });

  it("converts every foreign piece and leaves native ones alone", () => {
    const objects = [
      obj("u1", "leb-sofa-001"),
      obj("u2", "mor-pouf-001"), // already Moroccan
      obj("u3", "leb-lamp-001"),
    ];
    const { conversions } = planCultureConversion(objects, "moroccan");
    expect(conversions.map((c) => c.uid).sort()).toEqual(["u1", "u3"]);
    expect(conversions.every((c) => catalogItem(c.toCatalogId)!.culture === "moroccan")).toBe(true);
  });

  it("never touches a found piece", () => {
    // Found massing is DAR's reading of the user's photograph. Converting one
    // would claim the photographed room held a piece it did not.
    const objects = [obj("f1", "leb-sofa-001", { origin: "found", locked: true })];
    expect(planCultureConversion(objects, "moroccan").conversions).toEqual([]);
  });

  it("never touches a locked piece", () => {
    const objects = [obj("u1", "leb-sofa-001", { locked: true })];
    expect(planCultureConversion(objects, "moroccan").conversions).toEqual([]);
  });

  it("skips uids the caller has already dealt with", () => {
    // The planner path passes the pieces the model itself removed, so nothing
    // is removed twice.
    const objects = [obj("u1", "leb-sofa-001"), obj("u2", "leb-lamp-001")];
    const { conversions } = planCultureConversion(objects, "moroccan", {
      skipUids: new Set(["u1"]),
    });
    expect(conversions.map((c) => c.uid)).toEqual(["u2"]);
  });

  it("does nothing for the mixed catalogue", () => {
    const objects = [obj("u1", "leb-sofa-001")];
    expect(planCultureConversion(objects, "all").conversions).toEqual([]);
  });

  it("does not mutate the objects it was given", () => {
    const objects = [obj("u1", "leb-sofa-001")];
    const before = JSON.stringify(objects);
    planCultureConversion(objects, "moroccan");
    expect(JSON.stringify(objects)).toBe(before);
  });

  it("flags a substitution rather than passing it off as the same piece", () => {
    // Lebanese lamp -> Moroccan has no lamp, so the lantern stands in.
    const objects = [obj("u1", "leb-lamp-001")];
    const { conversions } = planCultureConversion(objects, "moroccan");
    expect(conversions[0].substituted).toBe(true);
    expect(catalogItem(conversions[0].toCatalogId)!.category).toBe("lantern");
  });

  it("round-trips a whole room between all three cultures", () => {
    let objects = CATALOG.filter((c) => c.culture === "lebanese").map((c, i) => obj(`u${i}`, c.id));
    for (const target of ["moroccan", "khaleeji", "lebanese"] as SceneCulture[]) {
      const { conversions, kept } = planCultureConversion(objects, target);
      expect(kept, `nothing should be unconvertible into ${target}`).toEqual([]);
      // Apply, keeping uids stable so the next hop has something to convert.
      objects = objects.map((o) => {
        const c = conversions.find((x) => x.uid === o.uid);
        return c ? obj(o.uid, c.toCatalogId) : o;
      });
      expect(objects.every((o) => catalogItem(o.catalogId!)!.culture === target)).toBe(true);
    }
  });
});

describe("conversionOps", () => {
  it("expresses a conversion as a removal plus an addition at the same spot", () => {
    const objects = [obj("u1", "leb-sofa-001", { x: 10, z: 20, rotationDeg: 180 })];
    const { conversions } = planCultureConversion(objects, "moroccan");
    const ops = conversionOps(conversions);

    expect(ops.removals).toEqual([
      expect.objectContaining({ targetUid: "u1" }),
    ]);
    expect(ops.items).toEqual([
      expect.objectContaining({ xCm: 10, zCm: 20, rotationDeg: 180 }),
    ]);
    expect(catalogItem(ops.items[0].catalogId)!.culture).toBe("moroccan");
  });

  it("carries a bilingual reason on both halves", () => {
    const { conversions } = planCultureConversion([obj("u1", "leb-sofa-001")], "moroccan");
    const ops = conversionOps(conversions);
    for (const o of [...ops.removals, ...ops.items]) {
      expect(o.reasonEn.length).toBeGreaterThan(0);
      expect(o.reasonAr.length).toBeGreaterThan(0);
    }
  });

  it("lets the new piece take the material the ontology gives it", () => {
    // null = the counterpart's own default. Carrying the old piece's material
    // across would dress a Moroccan pouf in Lebanese cedar.
    const { conversions } = planCultureConversion([obj("u1", "leb-sofa-001")], "moroccan");
    expect(conversionOps(conversions).items[0].materialKey).toBeNull();
  });
});

/* ------------------------------------------------------------------
   the palette — what a converted room actually LOOKS like

   Conversion swapped the right catalogue ids long before these existed,
   and the room still came out brown, because `fabric` resolved to linen
   and `wood` to cedar for every culture alike. A Moroccan sedari was
   pixel-identical to a Lebanese sofa. These tests are the difference
   between "the data says Moroccan" and "the room reads Moroccan".
   ------------------------------------------------------------------ */

describe("cultural palette", () => {
  function materialOf(culture: SceneCulture, category: string): string | null {
    const item = CATALOG.find((c) => c.culture === culture && c.category === category);
    return item ? defaultMaterialFor(item) : null;
  }

  it("gives the three cultures three different sofas", () => {
    const sofas = CULTURES.map((c) => materialOf(c, "sofa"));
    expect(new Set(sofas).size).toBe(3);
    // The specific failure that was reported: Moroccan and Lebanese were both
    // linen #c9b99a, so "make this a Moroccan room" changed nothing visible.
    expect(materialOf("lebanese", "sofa")).not.toBe(materialOf("moroccan", "sofa"));
  });

  it("reads a Moroccan textile as terracotta kilim, not cream linen", () => {
    expect(materialOf("moroccan", "sofa")).toBe("wool");
    expect(materialOf("moroccan", "armchair")).toBe("wool");
    expect(getMaterial("wool").hex).toBe("#a8442a");
  });

  it("keeps a specific tag meaning itself in every culture", () => {
    // velvet, marble, limestone, leather, zellige are never routed through
    // the culture palette — they already carry their own identity.
    expect(materialOf("khaleeji", "sofa")).toBe("velvet");
    expect(materialOf("lebanese", "side_table")).toBe("limestone");
    expect(materialOf("moroccan", "ottoman")).toBe("leather");
    expect(materialOf("moroccan", "coffee_table")).toBe("zellige");
  });

  it("upholsters a piece whose ontology tags happen to list its frame first", () => {
    // mor-armchair-001 is tagged cedar, brocade, fabric, wood — honouring tag
    // order alone rendered the "Brocade armchair" as a plain wooden chair.
    const armchair = CATALOG.find((c) => c.id === "mor-armchair-001")!;
    expect(armchair.materialTags[0]).toBe("cedar");
    expect(defaultMaterialFor(armchair)).toBe("wool");
  });

  it("does not upholster something that is actually made of wood", () => {
    // The Moroccan "Carved wooden chair" is wood and must stay wood; `chair`
    // is deliberately not in the upholstered list.
    expect(materialOf("moroccan", "chair")).toBe("cedar");
    expect(materialOf("lebanese", "chair")).toBe("walnut");
  });

  it("resolves every catalogue piece to a real material", () => {
    for (const item of CATALOG) {
      const key = defaultMaterialFor(item);
      expect(getMaterial(key).key, `${item.id} -> ${key}`).toBe(key);
    }
  });

  it("gives each culture a palette that is not mostly one colour", () => {
    for (const culture of CULTURES) {
      const keys = CATALOG.filter((c) => c.culture === culture).map(defaultMaterialFor);
      const distinct = new Set(keys);
      expect(distinct.size, `${culture} uses only ${distinct.size} materials`)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it("makes a converted room change colour, not just catalogue ids", () => {
    // The end-to-end property the bug report was really about.
    const before = [
      obj("u1", "leb-sofa-001"),
      obj("u2", "leb-armchair-001"),
      obj("u3", "leb-coffee-001"),
    ];
    const { conversions } = planCultureConversion(before, "moroccan");
    const beforeHex = before.map((o) => getMaterial(defaultMaterialFor(catalogItem(o.catalogId!)!)).hex);
    const afterHex = conversions.map((c) => getMaterial(defaultMaterialFor(catalogItem(c.toCatalogId)!)).hex);
    expect(afterHex).not.toEqual(beforeHex);
    expect(afterHex).toContain("#a8442a"); // Marrakech terracotta
  });
});

/* ------------------------------------------------------------------
   the two halves together

   The converter proposes; the placement engine disposes. A counterpart
   can be WIDER than the piece it replaces, so a conversion is not free
   of collision — it has to survive the same gate as everything else.
   ------------------------------------------------------------------ */

describe("conversion through the placement gate", () => {
  function room() {
    const { scene: s } = createScene(null, "lebanese");
    return s;
  }

  function add(catalogId: string, xCm: number, zCm: number) {
    return {
      catalogId, xCm, zCm, rotationDeg: 0, materialKey: null,
      reasonEn: "because", reasonAr: "لأن",
    };
  }

  it("turns a furnished Lebanese room into a Moroccan one, whole", () => {
    const s = room();
    s.objects = [
      obj("u-sofa", "leb-sofa-001", { x: 0, z: -150, rotationDeg: 0 }),
      obj("u-chair", "leb-chair-001", { x: -180, z: 40, rotationDeg: 90 }),
      obj("u-coffee", "leb-coffee-001", { x: 0, z: -40, rotationDeg: 0 }),
      obj("u-lamp", "leb-lamp-001", { x: 200, z: -150, rotationDeg: 0 }),
    ];

    const { conversions } = planCultureConversion(s.objects, "moroccan");
    expect(conversions).toHaveLength(4);

    const ops = conversionOps(conversions);
    // `culture` is the room this plan PRODUCES. Without it the gate judges
    // Moroccan pieces against a scene still labelled Lebanese and drops every
    // one of them — which is the whole conversion.
    const g = gatePlan(ops.items, s, [], { removals: ops.removals, culture: "moroccan" });

    // Every Lebanese piece leaves, every Moroccan piece lands.
    expect(g.removals).toHaveLength(4);
    expect(g.placements).toHaveLength(4);
    expect(g.dropped).toEqual([]);
    expect(
      g.placements.every((p) => catalogItem(p.catalogId)!.culture === "moroccan"),
    ).toBe(true);

    // Nothing is left of the old culture — the point of the whole exercise.
    const survivors = s.objects
      .filter((o) => !g.removals.some((r) => r.uid === o.uid))
      .filter((o) => catalogItem(o.catalogId!)!.culture !== "moroccan");
    expect(survivors).toEqual([]);
  });

  it("keeps the layout it was given wherever the footprint allows", () => {
    const s = room();
    s.objects = [obj("u-sofa", "leb-sofa-001", { x: 0, z: -150, rotationDeg: 0 })];
    const { conversions } = planCultureConversion(s.objects, "moroccan");
    const ops = conversionOps(conversions);
    const g = gatePlan(ops.items, s, [], { removals: ops.removals, culture: "moroccan" });

    // A sedari is not the same size as a Lebanese sofa, so the engine may
    // nudge it — but it must stay in the same part of the room, not be
    // re-placed somewhere unrelated.
    expect(Math.abs(g.placements[0].x - 0)).toBeLessThan(120);
    expect(Math.abs(g.placements[0].z - -150)).toBeLessThan(120);
  });

  it("judges a conversion against the room it produces, not the one it starts in", () => {
    // The merge bug, pinned. gatePlan gained a client-side culture check that
    // reads `scene.culture` -- correct for every plan except the one that
    // CHANGES the culture, where the scene is still Lebanese while every piece
    // being added is Moroccan. Without the override the gate drops all of them
    // and "make this a Moroccan room" silently does nothing.
    const s = room(); // scene.culture === "lebanese"
    s.objects = [obj("u-sofa", "leb-sofa-001", { x: 0, z: -150 })];
    const { conversions } = planCultureConversion(s.objects, "moroccan");
    const ops = conversionOps(conversions);

    const wrong = gatePlan(ops.items, s, [], { removals: ops.removals });
    expect(wrong.placements).toHaveLength(0);
    expect(wrong.dropped[0].reasonEn).toMatch(/moroccan piece in a lebanese room/i);

    const right = gatePlan(ops.items, s, [], { removals: ops.removals, culture: "moroccan" });
    expect(right.placements).toHaveLength(1);
    expect(right.dropped).toEqual([]);
  });

  it("still refuses a genuinely mixed plan", () => {
    // The override moves the gate, it does not remove it: a Lebanese piece in
    // a plan that declares itself Moroccan is still dropped and named.
    const s = room();
    const g = gatePlan(
      [add("leb-sofa-001", 0, -150), add("mor-pouf-001", 120, 60)],
      s,
      [],
      { culture: "moroccan" },
    );
    expect(g.placements.map((p) => p.catalogId)).toEqual(["mor-pouf-001"]);
    expect(g.dropped[0].catalogId).toBe("leb-sofa-001");
  });

  it("does not remove a found piece on the way through", () => {
    const s = room();
    s.objects = [
      obj("u-sofa", "leb-sofa-001", { x: 0, z: -150 }),
      obj("f-found", "leb-coffee-001", { x: 90, z: 90, origin: "found", locked: true }),
    ];
    const { conversions } = planCultureConversion(s.objects, "moroccan");
    const ops = conversionOps(conversions);
    const g = gatePlan(ops.items, s, [], { removals: ops.removals, culture: "moroccan" });
    expect(g.removals.map((r) => r.uid)).toEqual(["u-sofa"]);
  });
});
