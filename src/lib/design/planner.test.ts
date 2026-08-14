/* ============================================================
   The client trust gate, proved.

   `gatePlan` is the last thing standing between a language model and a
   user's room. The backend's own gates are covered by
   tests/test_design_planner.py; these are the ones only the client can
   make, because only the client has the scene, the walls and the
   oriented-rectangle collision engine.

   Pure module, no React, no THREE, no network.
   ============================================================ */

import { describe, expect, it } from "vitest";
import { gatePlan, gateDesignPlan, planOperationCount } from "./planner";
import { createScene } from "./roomModel";
import { rectOf, overlaps } from "./placement";
import type { PlacedObject } from "./types";
import type { DesignPlan, PlannedItem } from "@/lib/api";

function scene() {
  const { scene: s } = createScene(null, "lebanese");
  return s;
}

function obj(
  uid: string,
  catalogId: string,
  category: string,
  x: number,
  z: number,
  widthCm: number,
  depthCm: number,
  extra: Partial<PlacedObject> = {},
): PlacedObject {
  return {
    uid,
    origin: "catalog",
    catalogId,
    category,
    labelEn: uid,
    labelAr: uid,
    x,
    z,
    rotationDeg: 0,
    widthCm,
    depthCm,
    heightCm: 80,
    materialKey: "cedar",
    ...extra,
  } as PlacedObject;
}

const SOFA = () => obj("u-sofa", "leb-sofa-001", "sofa", 0, -150, 210, 88);
const CHAIR = () => obj("u-chair", "leb-chair-001", "chair", -180, 40, 48, 52);
const FOUND = () =>
  obj("f-found", "leb-coffee-001", "coffee_table", 60, 60, 110, 60, { origin: "found", locked: true });
const LOCKED = () => obj("u-locked", "leb-lamp-001", "lamp", 200, -150, 38, 38, { locked: true });

function add(catalogId: string, xCm: number, zCm: number, over: Partial<PlannedItem> = {}): PlannedItem {
  return {
    catalogId,
    xCm,
    zCm,
    rotationDeg: 0,
    materialKey: null,
    reasonEn: "because",
    reasonAr: "لأن",
    ...over,
  };
}

/* ------------------------------------------------------------------
   removals
   ------------------------------------------------------------------ */

describe("removals", () => {
  it("accepts a piece the user placed", () => {
    const s = scene();
    s.objects = [SOFA(), CHAIR()];
    const g = gatePlan([], s, [], {
      removals: [{ targetUid: "u-chair", reasonEn: "out", reasonAr: "" }],
    });
    expect(g.removals.map((r) => r.uid)).toEqual(["u-chair"]);
    // The label travels with it so the panel can name what it is about to bin.
    expect(g.removals[0].labelEn).toBe("u-chair");
  });

  it("refuses a piece DAR read off the photograph", () => {
    // Re-checked here rather than trusted: the backend enumerated uids from a
    // scene it was TOLD about, and this module can see the scene itself.
    const s = scene();
    s.objects = [FOUND()];
    const g = gatePlan([], s, [], {
      removals: [{ targetUid: "f-found", reasonEn: "x", reasonAr: "" }],
    });
    expect(g.removals).toEqual([]);
  });

  it("refuses a locked piece", () => {
    const s = scene();
    s.objects = [LOCKED()];
    const g = gatePlan([], s, [], {
      removals: [{ targetUid: "u-locked", reasonEn: "x", reasonAr: "" }],
    });
    expect(g.removals).toEqual([]);
  });

  it("ignores a uid that is not in the scene at all", () => {
    const s = scene();
    s.objects = [SOFA()];
    const g = gatePlan([], s, [], {
      removals: [{ targetUid: "ghost", reasonEn: "x", reasonAr: "" }],
    });
    expect(g.removals).toEqual([]);
  });

  it("frees the floor for an add in the same plan", () => {
    // The ordering rule, which is the whole reason removals run first: judging
    // this add against a sofa that is on its way out would refuse the one
    // arrangement the user actually asked for.
    const s = scene();
    s.objects = [SOFA()];
    const g = gatePlan([add("leb-sofa-001", 0, -150)], s, [], {
      removals: [{ targetUid: "u-sofa", reasonEn: "swap", reasonAr: "" }],
    });
    expect(g.removals).toHaveLength(1);
    expect(g.placements).toHaveLength(1);
    expect(g.placements[0].repaired).toBe(false);
    expect(g.dropped).toEqual([]);
  });
});

/* ------------------------------------------------------------------
   moves
   ------------------------------------------------------------------ */

describe("moves", () => {
  it("honours a legal move verbatim", () => {
    const s = scene();
    s.objects = [CHAIR()];
    const g = gatePlan([], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 150, zCm: 120, rotationDeg: 90, reasonEn: "", reasonAr: "" }],
    });
    expect(g.moves).toHaveLength(1);
    expect([g.moves[0].x, g.moves[0].z, g.moves[0].rotationDeg]).toEqual([150, 120, 90]);
    expect(g.moves[0].repaired).toBe(false);
  });

  it("repairs a move that lands outside the room rather than dropping it", () => {
    const s = scene();
    s.objects = [CHAIR()];
    const g = gatePlan([], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 99999, zCm: 0, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
    });
    expect(g.moves).toHaveLength(1);
    expect(g.moves[0].repaired).toBe(true);
    expect(Math.abs(g.moves[0].x)).toBeLessThanOrEqual(s.room.widthCm / 2);
    expect(Math.abs(g.moves[0].z)).toBeLessThanOrEqual(s.room.depthCm / 2);
  });

  it("leaves a piece exactly where it is when the move cannot be honoured", () => {
    // A refused move loses nothing and invents nothing — the piece simply
    // stays put and the panel does not list it.
    //
    // The room has to be smaller than the chair for this to be unrepairable.
    // A merely *cramped* room is not enough: `findSpot` ignores the moving
    // piece against itself, so any room it fits in at all has a valid answer,
    // which is the right behaviour and worth stating.
    const s = scene();
    s.objects = [CHAIR()];
    s.room = { ...s.room, widthCm: 40, depthCm: 40 };
    const g = gatePlan([], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 500, zCm: 500, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
    });
    expect(g.moves).toEqual([]);
  });

  it("repairs rather than refuses whenever the piece still fits somewhere", () => {
    const s = scene();
    s.objects = [CHAIR()];
    s.room = { ...s.room, widthCm: 200, depthCm: 200 };
    const g = gatePlan([], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 5000, zCm: 5000, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
    });
    expect(g.moves).toHaveLength(1);
    expect(g.moves[0].repaired).toBe(true);
  });

  it("refuses to move a found or locked piece", () => {
    const s = scene();
    s.objects = [FOUND(), LOCKED()];
    const g = gatePlan([], s, [], {
      moves: [
        { targetUid: "f-found", xCm: 0, zCm: 0, rotationDeg: 0, reasonEn: "", reasonAr: "" },
        { targetUid: "u-locked", xCm: 0, zCm: 0, rotationDeg: 0, reasonEn: "", reasonAr: "" },
      ],
    });
    expect(g.moves).toEqual([]);
  });

  it("judges the second move against where the first one landed", () => {
    const s = scene();
    s.objects = [CHAIR(), obj("u-chair2", "leb-chair-001", "chair", 180, 40, 48, 52)];
    const g = gatePlan([], s, [], {
      moves: [
        { targetUid: "u-chair", xCm: 0, zCm: 0, rotationDeg: 0, reasonEn: "", reasonAr: "" },
        { targetUid: "u-chair2", xCm: 0, zCm: 0, rotationDeg: 0, reasonEn: "", reasonAr: "" },
      ],
    });
    expect(g.moves).toHaveLength(2);
    // Both asked for the same spot; they must not end up stacked.
    const [a, b] = g.moves;
    expect(a.x === b.x && a.z === b.z).toBe(false);
    expect(b.repaired).toBe(true);
  });
});

/* ------------------------------------------------------------------
   counts — the pieces DAR appended to make a stated number true
   ------------------------------------------------------------------ */

describe("auto-placed additions", () => {
  it("never leaves an auto-placed piece stacked at the origin", () => {
    // The backend deliberately invents no coordinate for these, so a gate that
    // treated (0,0) as a real proposal would pile all five on one spot.
    const s = scene();
    const five = Array.from({ length: 5 }, () => add("leb-chair-001", 0, 0, { autoPlaced: true }));
    const g = gatePlan(five, s, []);
    expect(g.placements).toHaveLength(5);
    expect(g.placements.filter((p) => p.x === 0 && p.z === 0)).toHaveLength(0);
  });

  it("places five chairs without any two overlapping", () => {
    const s = scene();
    const five = Array.from({ length: 5 }, () => add("leb-chair-001", 0, 0, { autoPlaced: true }));
    const g = gatePlan(five, s, []);
    const rects = g.placements.map((p) =>
      rectOf({ x: p.x, z: p.z, widthCm: 48, depthCm: 52, rotationDeg: p.rotationDeg }),
    );
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it("drops what genuinely does not fit, and names it", () => {
    const s = scene();
    s.room = { ...s.room, widthCm: 260, depthCm: 220 };
    const many = Array.from({ length: 12 }, () => add("leb-sofa-001", 0, 0, { autoPlaced: true }));
    const g = gatePlan(many, s, []);
    expect(g.placements.length).toBeLessThan(12);
    expect(g.dropped.length).toBeGreaterThan(0);
    expect(g.dropped[0].reasonEn).toMatch(/no room/i);
  });
});

/* ------------------------------------------------------------------
   the shape of the result
   ------------------------------------------------------------------ */

describe("the gate as a whole", () => {
  it("never mutates the scene it was given", () => {
    const s = scene();
    s.objects = [SOFA(), CHAIR()];
    const before = JSON.stringify(s);
    gatePlan([add("leb-side-001", 100, 100)], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 20, zCm: 20, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
      removals: [{ targetUid: "u-sofa", reasonEn: "", reasonAr: "" }],
    });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("refuses a catalogue id that does not exist", () => {
    const g = gatePlan([add("leb-chandelier-009", 0, 0)], scene(), []);
    expect(g.placements).toEqual([]);
    expect(g.dropped[0].catalogId).toBe("leb-chandelier-009");
  });

  it("counts every kind of operation, so a no-op plan can say so", () => {
    const s = scene();
    s.objects = [SOFA(), CHAIR()];
    const g = gatePlan([add("leb-side-001", 100, 100)], s, [], {
      moves: [{ targetUid: "u-chair", xCm: 20, zCm: 120, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
      removals: [{ targetUid: "u-sofa", reasonEn: "", reasonAr: "" }],
    });
    expect(planOperationCount(g)).toBe(
      g.placements.length + g.moves.length + g.removals.length,
    );
    expect(planOperationCount(g)).toBe(3);
    expect(planOperationCount(gatePlan([], scene(), []))).toBe(0);
  });

  it("reads moves and removals off a whole plan response", () => {
    const s = scene();
    s.objects = [SOFA(), CHAIR()];
    const plan = {
      understood: {},
      items: [],
      moves: [{ targetUid: "u-chair", xCm: 100, zCm: 100, rotationDeg: 0, reasonEn: "", reasonAr: "" }],
      removals: [{ targetUid: "u-sofa", reasonEn: "", reasonAr: "" }],
    } as unknown as DesignPlan;
    const g = gateDesignPlan(plan, s, []);
    expect(g.moves).toHaveLength(1);
    expect(g.removals).toHaveLength(1);
  });

  it("survives a backend too old to send moves or removals", () => {
    // `moves`/`removals` are optional on DesignPlan for exactly this reason.
    const plan = { understood: {}, items: [add("leb-sofa-001", 0, -150)] } as unknown as DesignPlan;
    const g = gateDesignPlan(plan, scene(), []);
    expect(g.placements).toHaveLength(1);
    expect(g.moves).toEqual([]);
    expect(g.removals).toEqual([]);
  });
});
