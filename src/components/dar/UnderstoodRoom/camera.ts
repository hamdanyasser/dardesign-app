// Timeline math + camera path (UNDERSTOOD_ROOM_THREEJS_SPEC.md §4).
// Pure math — no three.js imports — so every curve is unit-testable.

import {
  CUM,
  DOCKS,
  DOCK_RADIUS,
  DT_CLAMP,
  LEN,
  SMOOTH_RATE,
  T_MAX,
  WORLD,
} from "./tokens";

export type Vec3 = [number, number, number];

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, k: number): number =>
  a + (b - a) * k;

/** Smoothstep between edges a→b, clamped. */
export const sm = (a: number, b: number, v: number): number => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** Cubic ease-in-out. */
export const eio = (k: number): number =>
  k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

/** Normalized progress [0,1] inside scene i at film time t. */
export const local = (i: number, t: number): number =>
  clamp((t - CUM[i]) / LEN[i], 0, 1);

export const sceneIndex = (t: number): number =>
  t < CUM[1] ? 0 : t < CUM[2] ? 1 : t < CUM[3] ? 2 : t < CUM[4] ? 3 : 4;

/**
 * Camera position along the film. The full 5-scene path ships now so later
 * milestones only add world content; scene 1 (+6 → −26, flying through the
 * arch at t≈.85 thanks to the ease) is the M1-visible stretch.
 */
export function cameraPos(t: number): Vec3 {
  const l0 = local(0, t);
  const l1 = local(1, t);
  const l2 = local(2, t);
  const l3 = local(3, t);
  const l4 = local(4, t);
  let x = 0;
  let y = WORLD.camHeight;
  let z: number;
  if (t < CUM[1]) {
    z = lerp(WORLD.camStartZ, WORLD.camScene1EndZ, eio(l0));
  } else if (t < CUM[2]) {
    z = lerp(-26, -54, eio(l1));
    x = 3.0 * sm(0.55, 1, l1);
  } else if (t < CUM[3]) {
    z = -54 - 22 * eio(sm(0, 0.4, l2)) - 16 * eio(sm(0.93, 1, l2));
    x = 3.0 * (1 - sm(0, 0.28, l2));
    y = WORLD.camHeight + 1.4 * eio(sm(0.55, 0.85, l2));
  } else if (t < CUM[4]) {
    z = -92 - 16 * eio(sm(0, 0.35, l3)) - 18 * eio(sm(0.9, 1, l3));
    // crest OVER the majlis wall on the way out — never through the furniture
    y = 2.95 + (1.7 - 2.95) * sm(0, 0.3, l3) + 1.9 * eio(sm(0.88, 1, l3));
  } else {
    const e = 1 - (1 - l4) * (1 - l4);
    z = lerp(-126, -141, e);
    y = 3.6 + (1.62 - 3.6) * sm(0, 0.35, l4);
  }
  return [x, y, z];
}

/**
 * Look target: slightly ahead along the path, with scene-specific interest
 * points blended in so key compositions stay framed (the S3 explode would
 * otherwise pitch out of view as the camera crests). Mirrors the prototype.
 */
export function cameraTarget(t: number, pos: Vec3): Vec3 {
  const ahead = cameraPos(Math.min(t + 0.05, T_MAX));
  let dx = ahead[0] - pos[0];
  let dy = ahead[1] - pos[1];
  let dz = ahead[2] - pos[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let tgt: Vec3 = [pos[0] + dx * 6, pos[1] + dy * 6, pos[2] + dz * 6];

  const s = sceneIndex(t);
  const l = local(s, t);
  let ip: Vec3 | null = null;
  let w = 0;
  if (s === 2) {
    // S3 · hold the majlis + explode centred through the whole beat, then turn
    // forward toward the next room as we crest.
    const cr = sm(0.55, 0.9, l);
    ip = [0, 1.6 - cr * 0.3, -84];
    w = sm(0.06, 0.22, l) * (1 - sm(0.96, 1, l));
    w = Math.max(w, cr * 0.85);
    const h = sm(0.94, 1, l);
    if (h > 0) {
      ip = [0, 0.5, -111];
      w = Math.max(w, h * 0.9);
    }
  } else if (s === 3) {
    // S4 · settle onto Room B for the culture morph.
    const cr2 = 1 - sm(0, 0.38, l);
    ip = [0, lerp(1.1, 0.4, cr2), -118];
    w = Math.min(1, sm(0, 0.18, l) + cr2 * 0.8);
  } else if (s === 4) {
    // S5 · look to the final door.
    ip = [0, 2.2, -144.2];
    w = sm(0.08, 0.45, l);
  }
  if (ip) {
    tgt = [lerp(tgt[0], ip[0], w), lerp(tgt[1], ip[1], w), lerp(tgt[2], ip[2], w)];
  }
  return tgt;
}

/**
 * Scroll → film-time smoothing with soft docking (§4): exponential chase at
 * SMOOTH_RATE, then — when velocity is low and the target has been reached —
 * a gentle pull toward the nearest dock within DOCK_RADIUS.
 */
export class Timeline {
  tS = 0;
  vel = 0;

  update(target: number, dtRaw: number): number {
    const dt = Math.min(DT_CLAMP, Math.max(dtRaw, 1e-4));
    const prev = this.tS;
    this.tS += (target - this.tS) * (1 - Math.exp(-dt * SMOOTH_RATE));
    this.vel = (this.tS - prev) / dt;
    if (Math.abs(this.vel) < 0.15 && Math.abs(target - this.tS) < 0.05) {
      let best = DOCKS[0];
      let bd = Infinity;
      for (const d of DOCKS) {
        const dd = Math.abs(d - this.tS);
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      if (bd > 0.001 && bd < DOCK_RADIUS) {
        this.tS += (best - this.tS) * Math.min(1, dt * 1.4) * (1 - bd / DOCK_RADIUS);
      }
    }
    return this.tS;
  }
}
