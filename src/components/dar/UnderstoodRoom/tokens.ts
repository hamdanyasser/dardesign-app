// Design tokens + timeline constants for "The Understood Room" (الغرفة المفهومة).
// Source of truth: UNDERSTOOD_ROOM_THREEJS_SPEC.md §3–§4.
// The DOM reads the same palette through the html[data-dd-mode] CSS variables in
// understood.css — keep the two in sync when a value changes.

export type DDMode = "night" | "day";

/** Hex color literal — matches three's HexColorString so palettes feed THREE.Color directly. */
export type HexColor = `#${string}`;

export interface Palette {
  /** DOM page background (day parchment is warmer than the world haze). */
  pageBg: HexColor;
  /** scene.background + fog color (day uses the world haze, not the page bg). */
  worldBg: HexColor;
  panel: HexColor;
  ink: HexColor;
  body: HexColor;
  sub: HexColor;
  faint: HexColor;
  gold: HexColor;
  goldBright: HexColor;
  goldDim: HexColor;
  /** Drawn-structure line colors — gold light at night, bronze ink by day. */
  lineBright: HexColor;
  lineMain: HexColor;
  lineDim: HexColor;
  dustColor: HexColor;
  /** Additive starfield at night; dark bronze motes with normal blending by day. */
  dustAdditive: boolean;
  /** Warm horizon glow beyond the threshold arch (RGB 0..1). */
  glowWarm: [number, number, number];
  /** Flash right behind the arch during the fly-through (RGB 0..1). */
  flashWarm: [number, number, number];
  glowIntensity: number;
}

export const PALETTES: Record<DDMode, Palette> = {
  night: {
    pageBg: "#0a0a0f",
    worldBg: "#0a0a0f",
    panel: "#12121a",
    ink: "#f5f0e8",
    body: "#cfc8bb",
    sub: "#8a8598",
    faint: "#68637a",
    gold: "#d4af37",
    goldBright: "#f0d78c",
    goldDim: "#8b7432",
    lineBright: "#f0d78c",
    lineMain: "#d4af37",
    lineDim: "#8b7432",
    dustColor: "#f0d78c",
    dustAdditive: true,
    glowWarm: [1, 0.78, 0.42],
    flashWarm: [1, 0.85, 0.55],
    glowIntensity: 1,
  },
  day: {
    pageBg: "#f6ecd4",
    worldBg: "#efe2c4",
    panel: "#fdf6e3",
    ink: "#251a0e",
    body: "#4a3b28",
    sub: "#8d7a58",
    faint: "#b3a17c",
    gold: "#8a5c14",
    goldBright: "#b4501a",
    goldDim: "#a4854a",
    lineBright: "#8a5c14",
    lineMain: "#8a5c14",
    lineDim: "#a4854a",
    dustColor: "#7a5310",
    dustAdditive: false,
    glowWarm: [1, 0.9, 0.62],
    flashWarm: [1, 0.96, 0.85],
    glowIntensity: 1.15,
  },
};

// ---------------------------------------------------------------------------
// Timeline (§4). Virtual film time t ∈ [0, T_MAX].
// ---------------------------------------------------------------------------

export const T_MAX = 8.8;
export const LEN: readonly number[] = [1.5, 1.9, 2.4, 1.9, 1.1];
export const CUM: readonly number[] = [0, 1.5, 3.4, 5.8, 7.7];
export const DOCKS: readonly number[] = [0, 2.45, 4.65, 6.75, 8.45];

export const SMOOTH_RATE = 3.4;
export const DT_CLAMP = 0.05;
export const DOCK_RADIUS = 0.35;
export const SPACER_HEIGHT_CSS = "max(880vh, 11800px)";

export const FOG_NEAR = 16;
export const FOG_FAR = 42;

// ---------------------------------------------------------------------------
// World layout along −Z (§4 table).
// ---------------------------------------------------------------------------

export const WORLD = {
  camStartZ: 6,
  camScene1EndZ: -26,
  archZ: -14.5,
  portalXs: [-6, 0, 6],
  portalsZ: -49,
  roomAZ: -84,
  roomBZ: -118,
  doorZ: -144.2,
  threadY: 0.035,
  threadZStart: 4.6,
  threadZEnd: -158,
  camHeight: 1.55,
  parallaxX: 0.4,
  parallaxY: 0.25,
} as const;

// Threshold arch construction (matches the accepted prototype exactly):
// two-centered pointed arch — springing 3.0, centers ±1.15, radius 4.2,
// half-span 3.05 (span 6.1), apex ≈ 7.04; archivolt (extrados) offset .45.
export const ARCH = {
  spring: 3.0,
  center: 1.15,
  radius: 4.2,
  halfSpan: 3.05,
  extradosOffset: 0.45,
  thresholdOverhang: 0.8,
} as const;

export const DUST_COUNT = 2500;

// Horizon glow beyond the arch + the warm flash you pass through (prototype values).
export const GLOWS = {
  horizon: { position: [0, 3.2, -34], scale: [17, 8.5] },
  flash: { position: [0, 5, -10.5], scale: [10, 7] },
} as const;

// ---------------------------------------------------------------------------
// S2 · البيوت الثلاثة — three culture portals (§5).
// ---------------------------------------------------------------------------

/** Two-centered pointed-arch profile. halfSpan MUST equal radius − center so
 *  the jambs meet the arc springers. */
export interface ArchProfile {
  spring: number;
  center: number;
  radius: number;
  halfSpan: number;
}

// Portal doorway arch — smaller than the monumental threshold: span ~4.4,
// apex ≈ 5.1. halfSpan = radius − center = 2.2.
export const PORTAL_ARCH: ArchProfile = {
  spring: 2.2,
  center: 0.8,
  radius: 3.0,
  halfSpan: 2.2,
};

export type StyleKey = "lebanese" | "khaleeji" | "moroccan";

export const PORTAL = {
  frameZ: WORLD.portalsZ, // -49, the drawn frame plane
  interiorZ: -49.35, // interiors sit just behind the frame
  apexY: 5.1, // for label anchors above each opening
  counts: { lebanese: 40, khaleeji: 48, moroccan: 36 },
  // additive glow color per culture (RGB 0..1)
  glow: {
    lebanese: [1, 0.78, 0.42] as [number, number, number], // warm limestone
    khaleeji: [0.6, 0.72, 0.86] as [number, number, number], // cool gypsum
    moroccan: [1, 0.72, 0.32] as [number, number, number], // saffron
  },
} as const;

// Moroccan zellige palette — teal / cobalt / saffron / white (§5).
export const ZELLIGE: HexColor[] = ["#1f7a6d", "#1f4287", "#e0a419", "#f3ead6"];

// Per-culture interior base colors (night; the day relight lands with M5).
export const PORTAL_MATERIAL = {
  limestone: "#c9a876" as HexColor, // Lebanese mountain stone
  gypsum: "#e8e2d4" as HexColor, // Khaleeji carved gypsum
} as const;
