/* ============================================================
   DAR Build Mode — light, sun and time of day

   The old rig was three analytic lights and no environment. That is why every
   metal read as a dark grey lump: `brass` is metalness 0.85 and a metal shows
   you what is around it, so with nothing around it there is nothing to show.
   The single largest change in this file is therefore not the sun -- it is
   giving the room an environment to reflect at all.

   IBL comes from three's own RoomEnvironment through PMREMGenerator. No HDRI
   is downloaded: it is a procedural interior box of emissive panels, which is
   both free and exactly the right thing to reflect in an interior.

   TIME OF DAY IS REAL LIGHTING, NOT A COLOUR FILTER. Each preset moves the sun
   in azimuth and elevation, changes its colour temperature and intensity,
   re-tunes the hemisphere and the exposure, and scales the lamps the furniture
   already carries. Sunset really does throw long shadows because the sun is
   really 8 degrees above the horizon.

   IT IS ALSO DELIBERATELY VIEWPORT-ONLY. `neutral()` pins the rig to a fixed
   daylight for the conditioning capture and hands back a restore function, so
   Render with DAR is byte-for-byte unaffected by what the user was looking at.
   Depth and segmentation are material-overridden and could not be affected
   anyway; this keeps the beauty evidence deterministic too.
   ============================================================ */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type TimeOfDay = "morning" | "afternoon" | "sunset" | "night";

export const TIMES_OF_DAY: TimeOfDay[] = ["morning", "afternoon", "sunset", "night"];

export const TIME_LABEL: Record<TimeOfDay, { en: string; ar: string }> = {
  morning: { en: "Morning", ar: "صباح" },
  afternoon: { en: "Afternoon", ar: "ظهيرة" },
  sunset: { en: "Sunset", ar: "غروب" },
  night: { en: "Night", ar: "ليل" },
};

interface Preset {
  /** Compass direction the sun comes FROM, radians. */
  azimuth: number;
  /** Degrees above the horizon. Drives shadow length directly. */
  elevationDeg: number;
  sun: number;
  sunColor: number;
  skyColor: number;
  groundColor: number;
  hemi: number;
  /** Multiplier on the PointLights lamps and lanterns already carry. */
  lamps: number;
  /** Multiplier on material.envMapIntensity. */
  env: number;
  exposure: number;
  /** Colour seen through a window reveal. */
  sky: number;
}

/* Calibrated against the rig this replaced, which was a key of 1.15 and a
 * hemisphere of 0.45 at exposure 0.92 and looked right. The first cut here
 * raised the sun to 2.6 AND added image-based lighting, and the room went
 * white — IBL contributes a large ambient term of its own, so adding it means
 * taking the analytic lights DOWN, not up. three r150 is also on legacy
 * (non-physical) light units, where these numbers are not lux and 2.6 is
 * enormous. */
const PRESETS: Record<TimeOfDay, Preset> = {
  // Low warm sun, cool sky fill. Long shadows from one side.
  morning: {
    azimuth: 1.05, elevationDeg: 20, sun: 1.15, sunColor: 0xffd7a8,
    skyColor: 0xcfe0ff, groundColor: 0x3a3228, hemi: 0.26,
    lamps: 0.2, env: 0.48, exposure: 0.94, sky: 0xbcd8f5,
  },
  // High neutral sun: short shadows, the most even and legible for editing.
  // This is the default, and the state the conditioning capture pins to.
  afternoon: {
    azimuth: 2.3, elevationDeg: 62, sun: 1.30, sunColor: 0xfff1dc,
    skyColor: 0xe6f0ff, groundColor: 0x4a4030, hemi: 0.28,
    lamps: 0.15, env: 0.55, exposure: 0.90, sky: 0xd6ebff,
  },
  // Low, strongly warm, raking right across the floor.
  sunset: {
    azimuth: 4.2, elevationDeg: 7, sun: 1.30, sunColor: 0xff8f43,
    skyColor: 0xffc79a, groundColor: 0x2a1d16, hemi: 0.17,
    lamps: 0.7, env: 0.38, exposure: 0.98, sky: 0xff9e63,
  },
  // No sun worth the name; the room is lit by what is standing in it.
  night: {
    azimuth: 5.4, elevationDeg: 34, sun: 0.07, sunColor: 0x9fb6ff,
    skyColor: 0x1b2440, groundColor: 0x0a0a10, hemi: 0.09,
    lamps: 2.4, env: 0.16, exposure: 1.16, sky: 0x0e1630,
  },
};

export class LightingRig {
  readonly key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private env: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;

  private roomW = 520;
  private roomD = 420;
  private roomH = 300;
  private current: TimeOfDay = "afternoon";
  /** Azimuth of the room's largest window, if it has one. Daylight that comes
   *  through the glass rather than through a wall is most of what makes an
   *  interior read as lit by the outdoors. */
  private windowAzimuth: number | null = null;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.hemi = new THREE.HemisphereLight(0xe6f0ff, 0x4a4030, 0.62);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0012;
    this.key.shadow.normalBias = 1.4;
    scene.add(this.key, this.key.target);

    // A dim opposite fill so the shadow side is modelled rather than black.
    // Kept low: raise it and the room flattens into an even wash.
    this.fill = new THREE.DirectionalLight(0xbcd2e8, 0.22);
    this.fill.position.set(-520, 340, -260);
    scene.add(this.fill);

    this.buildEnvironment();
    this.apply("afternoon");
  }

  /** Image-based lighting from three's own procedural room. Costs one render
   *  at construction and nothing per frame. */
  private buildEnvironment() {
    try {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
      this.pmrem.compileEquirectangularShader();
      const room = new RoomEnvironment();
      this.env = this.pmrem.fromScene(room, 0.04).texture;
      this.scene.environment = this.env;
      room.dispose?.();
    } catch {
      // An environment is an enhancement, not a requirement — the analytic
      // lights alone are exactly what Build Mode had before.
      this.env = null;
    }
  }

  setRoom(w: number, d: number, h: number) {
    this.roomW = w;
    this.roomD = d;
    this.roomH = h;
    this.apply(this.current);
  }

  /** Point the sun at the wall the biggest window is in, so daylight arrives
   *  through the opening instead of through masonry. */
  setWindowAzimuth(a: number | null) {
    this.windowAzimuth = a;
    this.apply(this.current);
  }

  get timeOfDay(): TimeOfDay {
    return this.current;
  }

  apply(tod: TimeOfDay) {
    this.current = tod;
    const p = PRESETS[tod];

    // Daylight prefers the window; night keeps its own direction, since a
    // moon coming through the same window is a coincidence not worth forcing.
    const az = this.windowAzimuth !== null && tod !== "night" ? this.windowAzimuth : p.azimuth;
    const el = (p.elevationDeg * Math.PI) / 180;
    const span = Math.max(this.roomW, this.roomD);
    const dist = span * 1.6;

    this.key.position.set(
      Math.cos(az) * Math.cos(el) * dist,
      Math.sin(el) * dist,
      Math.sin(az) * Math.cos(el) * dist,
    );
    this.key.target.position.set(0, this.roomH * 0.25, 0);
    this.key.target.updateMatrixWorld();
    this.key.color.setHex(p.sunColor);
    this.key.intensity = p.sun;
    this.key.castShadow = p.sun > 0.25;

    // Fit the shadow frustum to the room. Left at a fixed +-800 a small room
    // spends most of its shadow map on empty space and the contact shadows go
    // soft and stepped.
    const r = span * 0.85;
    const cam = this.key.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 10;
    cam.far = dist * 2.2;
    cam.updateProjectionMatrix();

    this.hemi.color.setHex(p.skyColor);
    this.hemi.groundColor.setHex(p.groundColor);
    this.hemi.intensity = p.hemi;
    this.fill.intensity = tod === "night" ? 0.05 : 0.22;

    this.renderer.toneMappingExposure = p.exposure;
    this.applyEnvIntensity(p.env);
    this.applyLampScale(p.lamps);
  }

  /** three has no scene-wide environment intensity in r150, so it is set per
   *  material. Cheap: this runs on a preset change, not per frame. */
  private applyEnvIntensity(v: number) {
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat instanceof THREE.MeshStandardMaterial) mat.envMapIntensity = v;
      }
    });
  }

  /** Lamps and lanterns carry their own PointLight from geometry.ts. Their
   *  authored intensity is the daylight value; this scales it so the same
   *  lamp that is a detail at noon is the light source at night. */
  private applyLampScale(v: number) {
    this.scene.traverse((o) => {
      if (o instanceof THREE.PointLight) {
        const base = (o.userData.baseIntensity as number | undefined) ?? o.intensity;
        o.userData.baseIntensity = base;
        o.intensity = base * v;
      }
    });
  }

  /** Called after objects are (re)built, so new lamps and new materials pick
   *  up the current preset instead of their authored defaults. */
  refresh() {
    this.apply(this.current);
  }

  /** The colour a window reveal should glow, for the current time of day. */
  skyColor(): number {
    return PRESETS[this.current].sky;
  }

  /** Pin the rig to a fixed daylight for a conditioning capture, and return
   *  the undo.
   *
   *  Render with DAR must not depend on what the user was looking at. Depth and
   *  segmentation are material-overridden so they were never at risk, but the
   *  beauty pass is shown as evidence of the design and would otherwise come
   *  back nearly black if the user happened to be in Night. */
  neutral(): () => void {
    const prev = this.current;
    if (prev === "afternoon") return () => {};
    this.apply("afternoon");
    return () => this.apply(prev);
  }

  dispose() {
    this.env?.dispose();
    this.pmrem?.dispose();
    this.scene.environment = null;
  }
}
