// Scene-graph builders for "The Understood Room". M1 builds Scene 1:
// starfield dust, the drawn threshold arch (Line2), the golden floor thread,
// and the warm horizon/flash glows. Everything is procedural — no textures.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { clamp, lerp, local, sm } from "./camera";
import type { ArchProfile, HexColor, Palette, StyleKey } from "./tokens";
import {
  ARCH,
  DUST_COUNT,
  FOG_FAR,
  FOG_NEAR,
  GLOWS,
  PALETTES,
  PORTAL,
  PORTAL_ARCH,
  PORTAL_MATERIAL,
  WORLD,
  ZELLIGE,
} from "./tokens";

export interface WorldUpdateCtx {
  /** Smoothed film time. */
  tS: number;
  /** Wall-clock seconds since the film started (drives drift/twinkle). */
  time: number;
  /** Hovered portal index in Scene 2 (0/1/2), or -1 for none. */
  hoverIdx?: number;
  /** Culture intensity 0..1 for the Scene 4 morph (from the scrubber). */
  culture?: number;
}

export interface World {
  update(ctx: WorldUpdateCtx): void;
  /** Fat-line materials need the viewport size (CSS pixels). */
  setResolution(width: number, height: number): void;
  /** Relight the 3D world night↔day (0 = night, 1 = day). DOM handles itself. */
  relight(dayAmount: number): void;
  /** World-space anchors above each portal apex, for DOM label projection. */
  portalAnchors: THREE.Vector3[];
  /** S3 layer anchors (style / plan / depth), updated each frame in the explode. */
  layerAnchors: THREE.Vector3[];
  /** Reshuffle the Moroccan zellige into a fresh generative pattern (S2 click). */
  regenerateZellige(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Deterministic rng (same recurrence as the accepted prototype).
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ---------------------------------------------------------------------------
// Two-centered pointed arch curve (prototype-exact).
// ---------------------------------------------------------------------------

const A_END = Math.acos(-ARCH.center / ARCH.radius);

/** k 0..1: left springer → apex → right springer. Returns [x, y]. */
function archCurve(k: number): [number, number] {
  const left = k < 0.5;
  const kk = left ? k * 2 : (1 - k) * 2;
  const a = Math.PI + (A_END - Math.PI) * kk;
  const x = ARCH.center + Math.cos(a) * ARCH.radius;
  const y = ARCH.spring + Math.sin(a) * ARCH.radius;
  return [left ? x : -x, y];
}

/** Arc polyline with a radial offset (0 = intrados, .45 = extrados), flat xyz. */
function arcPoints(offset: number, z: number, steps = 44): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = archCurve(i / steps);
    const cx = p[0] <= 0 ? ARCH.center : -ARCH.center;
    const dx = (p[0] - cx) / ARCH.radius;
    const dy = (p[1] - ARCH.spring) / ARCH.radius;
    pts.push(p[0] + dx * offset, p[1] + dy * offset, z);
  }
  return pts;
}

/** Vertical jamb from the floor to the springing, subdivided so it draws in smoothly. */
function jambPoints(x: number, offset: number, z: number, steps = 10): number[] {
  const xx = x + Math.sign(x) * offset;
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) pts.push(xx, (i / steps) * ARCH.spring, z);
  return pts;
}

function thresholdPoints(z: number, steps = 12): number[] {
  const w = ARCH.halfSpan + ARCH.thresholdOverhang;
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) pts.push(-w + (i / steps) * 2 * w, 0.02, z);
  return pts;
}

/** Point ON the arch outline for the gathering dust (prototype distribution). */
function archTargetPoint(u: number, rand: () => number): [number, number, number] {
  let x: number;
  let y: number;
  if (u < 0.34) {
    // intrados arc
    const p = archCurve(u / 0.34);
    x = p[0];
    y = p[1];
  } else if (u < 0.58) {
    // archivolt band (outer arc)
    const k = (u - 0.34) / 0.24;
    const p = archCurve(k);
    const cx = p[0] <= 0 ? ARCH.center : -ARCH.center;
    const dx = p[0] - cx;
    const dy = p[1] - ARCH.spring;
    const dl = Math.hypot(dx, dy) || 1;
    x = p[0] + (dx / dl) * ARCH.extradosOffset;
    y = p[1] + (dy / dl) * ARCH.extradosOffset;
  } else if (u < 0.92) {
    // double jambs grounding the arch to the floor
    const s2 = (u - 0.58) / 0.34;
    const side = s2 < 0.5 ? 1 : -1;
    const ss = (s2 * 2) % 1;
    const inner = (Math.floor(ss * 7) & 1) === 0;
    x = side * (ARCH.halfSpan + (inner ? 0 : ARCH.extradosOffset));
    y = ss * ARCH.spring;
  } else {
    // threshold base line
    const s2 = (u - 0.92) / 0.08;
    x = (s2 - 0.5) * 2 * (ARCH.halfSpan + 0.5);
    y = 0.02;
  }
  return [
    x + (rand() - 0.5) * 0.05,
    y + (rand() - 0.5) * 0.05,
    WORLD.archZ + (rand() - 0.5) * 0.4,
  ];
}

// ---------------------------------------------------------------------------
// S2 portals — generic pointed-arch profile + instanced interiors.
// ---------------------------------------------------------------------------

/** Pointed-arch curve for an arbitrary profile (portal-sized doorways). */
function archCurveProfile(profile: ArchProfile, k: number): [number, number] {
  const aEnd = Math.acos(-profile.center / profile.radius);
  const left = k < 0.5;
  const kk = left ? k * 2 : (1 - k) * 2;
  const a = Math.PI + (aEnd - Math.PI) * kk;
  const x = profile.center + Math.cos(a) * profile.radius;
  const y = profile.spring + Math.sin(a) * profile.radius;
  return [left ? x : -x, y];
}

/** One continuous polyline (→ one Line2): left jamb ↑ · arc · right jamb ↓. */
function portalFrameOutline(profile: ArchProfile, cx: number, z: number): number[] {
  const { halfSpan, spring } = profile;
  const pts: number[] = [];
  const jSteps = 6;
  for (let i = 0; i <= jSteps; i++) pts.push(cx - halfSpan, (i / jSteps) * spring, z);
  const aSteps = 40;
  for (let i = 0; i <= aSteps; i++) {
    const p = archCurveProfile(profile, i / aSteps);
    pts.push(cx + p[0], p[1], z);
  }
  for (let i = 0; i <= jSteps; i++) pts.push(cx + halfSpan, spring - (i / jSteps) * spring, z);
  return pts;
}

/** Is (x, y) inside the portal opening? Rectangle below the spring line, then
 *  the intersection of the two arch disks above it. x is portal-local. */
function insideOpening(x: number, y: number): boolean {
  const P = PORTAL_ARCH;
  if (y < 0.1) return false;
  if (y <= P.spring) return Math.abs(x) <= P.halfSpan - 0.2;
  const R = P.radius - 0.18;
  const dL = Math.hypot(x - P.center, y - P.spring);
  const dR = Math.hypot(x + P.center, y - P.spring);
  return dL <= R && dR <= R;
}

interface InstanceSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rot?: number;
  /** 0..1 appear order for the staggered reveal. */
  order: number;
  color?: THREE.Color;
}

interface RevealMesh {
  mesh: THREE.InstancedMesh;
  reveal: (p: number) => void;
  /** Re-apply matrices at the current progress (after mutating specs). */
  rebuild: () => void;
}

/** Build an InstancedMesh whose instances scale in, staggered by `order`. */
function buildInstanced(
  specs: InstanceSpec[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material
): RevealMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let anyColor = false;
  for (let i = 0; i < specs.length; i++) {
    const c = specs[i].color;
    if (c) {
      mesh.setColorAt(i, c);
      anyColor = true;
    }
  }
  if (anyColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  let last = -1;
  const apply = (p: number): void => {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const g = clamp((p - s.order * 0.55) / 0.45, 0, 1);
      const k = g * g * (3 - 2 * g);
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, 0, s.rot ?? 0);
      dummy.scale.set(s.sx * k, s.sy * k, s.sz * k);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  const reveal = (p: number): void => {
    if (Math.abs(p - last) < 0.002) return; // skip redundant rebuilds
    last = p;
    apply(p);
  };
  const rebuild = (): void => apply(last < 0 ? 0 : last);
  reveal(0);
  return { mesh, reveal, rebuild };
}

/** 8-point zellige star (flat, facing +Z toward the camera). */
function starGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const points = 8;
  const outer = 1;
  const inner = 0.42;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** Lebanese — limestone courses, brickwork stagger, rising bottom→top. */
function limestoneSpecs(cx: number, z: number, rand: () => number): InstanceSpec[] {
  const specs: InstanceSpec[] = [];
  const base = new THREE.Color(PORTAL_MATERIAL.limestone);
  const courseH = 0.34;
  let y = 0.28;
  let row = 0;
  while (y < 4.4) {
    const off = (row % 2) * 0.45;
    for (let x = -1.8 + off; x < 1.8; x += 0.9) {
      if (!insideOpening(x, y)) continue;
      const c = base.clone().offsetHSL(0, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.08);
      specs.push({ x: cx + x, y, z, sx: 0.82, sy: courseH, sz: 0.14, order: y / 4.6, color: c });
    }
    y += courseH + 0.07;
    row++;
  }
  return specs;
}

/** Khaleeji — carved gypsum lattice (vertical + horizontal bars) + niches. */
function gypsumSpecs(cx: number, z: number, rand: () => number): InstanceSpec[] {
  const specs: InstanceSpec[] = [];
  const col = new THREE.Color(PORTAL_MATERIAL.gypsum);
  for (let x = -1.6; x <= 1.6; x += 0.5) {
    for (let y = 0.4; y < 4.2; y += 0.95) {
      if (!insideOpening(x, y)) continue;
      specs.push({
        x: cx + x,
        y,
        z,
        sx: 0.07,
        sy: 0.85,
        sz: 0.12,
        order: (y / 4.6) * 0.6 + rand() * 0.1,
        color: col.clone(),
      });
    }
  }
  for (let y = 0.7; y < 4.2; y += 0.72) {
    for (let x = -1.4; x <= 1.4; x += 1.0) {
      if (!insideOpening(x, y)) continue;
      specs.push({
        x: cx + x,
        y,
        z,
        sx: 0.9,
        sy: 0.07,
        sz: 0.12,
        order: (y / 4.6) * 0.6 + 0.2,
        color: col.clone(),
      });
    }
  }
  return specs;
}

/** Moroccan — zellige star tiles, palette cycling, spiral-in from the centre. */
function zelligeSpecs(cx: number, z: number, rand: () => number): InstanceSpec[] {
  const specs: InstanceSpec[] = [];
  const pal = ZELLIGE.map((h) => new THREE.Color(h));
  let idx = 0;
  for (let gy = 0.6; gy < 4.2; gy += 0.62) {
    for (let gx = -1.6; gx <= 1.6; gx += 0.62) {
      if (!insideOpening(gx, gy)) continue;
      const ang = Math.atan2(gy - 2.4, gx);
      const rad = Math.hypot(gx, gy - 2.4);
      specs.push({
        x: cx + gx,
        y: gy,
        z,
        sx: 0.3,
        sy: 0.3,
        sz: 0.3,
        rot: rand() * Math.PI,
        order: clamp(rad / 3, 0, 1) * 0.7 + ((ang + Math.PI) / (2 * Math.PI)) * 0.3,
        color: pal[idx++ % pal.length],
      });
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Drawn lines — reveal by animating the instanced segment count.
// ---------------------------------------------------------------------------

interface DrawnLine {
  line: Line2;
  segments: number;
}

function makeDrawnLine(points: number[], material: LineMaterial): DrawnLine {
  const geometry = new LineGeometry();
  geometry.setPositions(points);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.frustumCulled = false;
  const segments = points.length / 3 - 1;
  geometry.instanceCount = 0; // drawn in by setDrawProgress
  return { line, segments };
}

function setDrawProgress(drawn: DrawnLine, p: number): void {
  const geometry = drawn.line.geometry as LineGeometry;
  geometry.instanceCount = Math.round(clamp(p, 0, 1) * drawn.segments);
}

// ---------------------------------------------------------------------------
// Dust (Points + procedural round-sprite shader; no textures).
// ---------------------------------------------------------------------------

const DUST_VERT = /* glsl */ `
  attribute vec3 aArch;
  attribute float aSeed;
  uniform float uMix;
  uniform float uTime;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    float gather = uMix * step(aSeed, 0.55); // ~55% of the motes answer the call
    vec3 p = mix(position, aArch, gather);
    float free = 1.0 - gather;
    p.x += sin(uTime * (0.30 + aSeed) + aSeed * 40.0) * 0.18 * free;
    p.y += cos(uTime * (0.25 + aSeed * 0.5) + aSeed * 60.0) * 0.12 * free;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(-mv.z, 0.001);
    // Perspective point size: uSize maps a ~0.03-unit mote to pixels at unit
    // depth, so motes read as a fine starfield that grows as the camera nears.
    gl_PointSize = clamp(uSize * (0.4 + aSeed * 0.8) / dist, 0.6, 22.0);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 90.0);
    vAlpha = twinkle * smoothstep(150.0, 40.0, dist) * smoothstep(0.4, 2.2, dist);
    vAlpha *= 1.0 + gather * 0.6; // gathered motes burn a little brighter
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.08, d) * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// ---------------------------------------------------------------------------
// Soft radial glow billboard (procedural).
// ---------------------------------------------------------------------------

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length((vUv - 0.5) * 2.0);
    float a = pow(max(1.0 - d, 0.0), 2.2) * uIntensity;
    gl_FragColor = vec4(uColor, a);
  }
`;

// ---------------------------------------------------------------------------
// World assembly.
// ---------------------------------------------------------------------------

export function buildWorld(scene: THREE.Scene, palette: Palette): World {
  scene.background = new THREE.Color(palette.worldBg);
  scene.fog = new THREE.Fog(palette.worldBg, FOG_NEAR, FOG_FAR);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const lineMaterials: LineMaterial[] = [];

  // --- theme tracking for the night↔day relight (§6) ---
  type LineRole = "bright" | "main" | "dim";
  const roleHex = (role: LineRole, p: Palette): HexColor =>
    role === "bright" ? p.lineBright : role === "main" ? p.lineMain : p.lineDim;
  const themedLines: { mat: LineMaterial; night: THREE.Color; day: THREE.Color }[] = [];
  const nightBg = new THREE.Color(PALETTES.night.worldBg);
  const dayBg = new THREE.Color(PALETTES.day.worldBg);
  const nightDust = new THREE.Color(PALETTES.night.dustColor);
  const dayDust = new THREE.Color(PALETTES.day.dustColor);

  // Interior materials that must re-tint for day (so pale stone/gypsum reads on
  // parchment). 1 = day at build time; relight() lerps mat.color night↔day.
  const initDay = palette.worldBg === PALETTES.day.worldBg ? 1 : 0;
  const themedBasics: { mat: THREE.MeshBasicMaterial; night: THREE.Color; day: THREE.Color }[] = [];
  const themedBasic = (
    nightHex: number,
    dayHex: number,
    opts: THREE.MeshBasicMaterialParameters = {}
  ): THREE.MeshBasicMaterial => {
    const night = new THREE.Color(nightHex);
    const day = new THREE.Color(dayHex);
    const mat = new THREE.MeshBasicMaterial({
      color: night.clone().lerp(day, initDay),
      fog: true,
      ...opts,
    });
    materials.push(mat);
    themedBasics.push({ mat, night, day });
    return mat;
  };

  const lineMaterial = (role: LineRole, width: number, dashed = false): LineMaterial => {
    const mat = new LineMaterial({
      color: new THREE.Color(roleHex(role, palette)).getHex(),
      linewidth: width,
      dashed,
    });
    // LineMaterialParameters doesn't expose fog, but the material supports it.
    mat.fog = true;
    mat.needsUpdate = true;
    if (dashed) {
      mat.dashSize = 0.25;
      mat.gapSize = 0.55;
      mat.transparent = true;
      mat.opacity = 0.8;
    }
    materials.push(mat);
    lineMaterials.push(mat);
    themedLines.push({
      mat,
      night: new THREE.Color(roleHex(role, PALETTES.night)),
      day: new THREE.Color(roleHex(role, PALETTES.day)),
    });
    return mat;
  };

  // --- Threshold arch: intrados + extrados + double jambs + threshold bar ---
  const brightMat = lineMaterial("bright", 3.2);
  const mainMat = lineMaterial("main", 2.4);
  const dimMat = lineMaterial("dim", 2.0);

  const AZ = WORLD.archZ;
  const HS = ARCH.halfSpan;
  const OFF = ARCH.extradosOffset;
  const archLines: DrawnLine[] = [
    makeDrawnLine(arcPoints(0, AZ), brightMat),
    makeDrawnLine(arcPoints(OFF, AZ), mainMat),
    makeDrawnLine(jambPoints(-HS, 0, AZ), brightMat),
    makeDrawnLine(jambPoints(-HS, OFF, AZ), mainMat),
    makeDrawnLine(jambPoints(HS, 0, AZ), brightMat),
    makeDrawnLine(jambPoints(HS, OFF, AZ), mainMat),
    makeDrawnLine(thresholdPoints(AZ), dimMat),
  ];
  for (const drawn of archLines) {
    geometries.push(drawn.line.geometry);
    scene.add(drawn.line);
  }

  // --- Golden floor thread: dashed, runs the whole journey ---
  const threadMat = lineMaterial("dim", 1.6, true);
  const threadPts: number[] = [];
  for (let z = WORLD.threadZStart; z >= WORLD.threadZEnd; z -= 2.2) {
    threadPts.push(0, WORLD.threadY, z);
  }
  const thread = makeDrawnLine(threadPts, threadMat);
  setDrawProgress(thread, 1); // always fully present — the storyline underfoot
  geometries.push(thread.line.geometry);
  scene.add(thread.line);

  // --- Dust ---
  const rand = rng(3);
  const scatter = new Float32Array(DUST_COUNT * 3);
  const archTargets = new Float32Array(DUST_COUNT * 3);
  const seeds = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = 2.5 + 18 * Math.pow(rand(), 1.5);
    scatter[i * 3] = Math.cos(ang) * rr;
    scatter[i * 3 + 1] = Math.pow(rand(), 2) * 6.5 + 0.1;
    scatter[i * 3 + 2] = 8 - rand() * 160;
    const ap = archTargetPoint(rand(), rand);
    archTargets[i * 3] = ap[0];
    archTargets[i * 3 + 1] = ap[1];
    archTargets[i * 3 + 2] = ap[2];
    seeds[i] = rand();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(scatter, 3));
  dustGeo.setAttribute("aArch", new THREE.BufferAttribute(archTargets, 3));
  dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    uniforms: {
      uMix: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 34 },
      uColor: { value: new THREE.Color(palette.dustColor) },
      uOpacity: { value: palette.dustAdditive ? 0.55 : 0.5 },
    },
    transparent: true,
    depthWrite: false,
    blending: palette.dustAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  geometries.push(dustGeo);
  materials.push(dustMat);
  scene.add(dust);

  // --- Warm horizon glow beyond the arch + fly-through flash ---
  const makeGlow = (
    rgb: [number, number, number],
    position: readonly number[],
    scale: readonly number[]
  ): THREE.ShaderMaterial => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) },
        uIntensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], 1);
    mesh.frustumCulled = false;
    geometries.push(geo);
    materials.push(mat);
    scene.add(mesh);
    return mat;
  };
  const horizonMat = makeGlow(palette.glowWarm, GLOWS.horizon.position, GLOWS.horizon.scale);
  const flashMat = makeGlow(palette.flashWarm, GLOWS.flash.position, GLOWS.flash.scale);

  // --- S2 · three culture portals: frame drawn first, interior inhabited after ---
  const buildPortals = () => {
    const styles: StyleKey[] = ["lebanese", "khaleeji", "moroccan"];
    const group = new THREE.Group();
    group.visible = false;
    const rand = rng(7);

    const frames: DrawnLine[] = [];
    const interiors: RevealMesh[] = [];
    const glowMats: THREE.ShaderMaterial[] = [];
    const hoverAmt = [0, 0, 0];
    const anchors: THREE.Vector3[] = [];
    const star = starGeometry();
    geometries.push(star);
    let regenerate: (() => void) | null = null; // set when the zellige is built

    styles.forEach((style, i) => {
      const cx = WORLD.portalXs[i];

      // frame — drawn as a single Line2 outline
      const frameMat = lineMaterial("bright", 2.6);
      const frame = makeDrawnLine(portalFrameOutline(PORTAL_ARCH, cx, PORTAL.frameZ), frameMat);
      geometries.push(frame.line.geometry);
      group.add(frame.line);
      frames.push(frame);

      // interior — one InstancedMesh per portal. The base tints per-instance
      // colours; day tints keep pale stone/gypsum legible on parchment.
      let interior: RevealMesh;
      if (style === "moroccan") {
        // vivid zellige reads in both modes — no day re-tint
        const mat = themedBasic(0xffffff, 0xffffff, { side: THREE.DoubleSide });
        const zSpecs = zelligeSpecs(cx, PORTAL.interiorZ, rand);
        const zi = buildInstanced(zSpecs, star, mat);
        interior = zi;
        // Interactive regeneration: reshuffle the tessellation's palette +
        // star orientations into a fresh procedural pattern on each click.
        const zPal = ZELLIGE.map((h) => new THREE.Color(h));
        let zSeed = 1;
        regenerate = () => {
          zSeed++;
          for (let k = 0; k < zSpecs.length; k++) {
            const s = zSpecs[k];
            s.rot = rand() * Math.PI;
            s.color = zPal[(k * 3 + zSeed) % zPal.length];
            zi.mesh.setColorAt(k, s.color);
          }
          if (zi.mesh.instanceColor) zi.mesh.instanceColor.needsUpdate = true;
          zi.rebuild();
        };
      } else {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geometries.push(geo);
        // limestone: gentle warm-down; gypsum (near-white): real darken to taupe
        const mat =
          style === "lebanese"
            ? themedBasic(0xffffff, 0xdccba6)
            : themedBasic(0xffffff, 0x9c8a6e);
        const gen = style === "lebanese" ? limestoneSpecs : gypsumSpecs;
        interior = buildInstanced(gen(cx, PORTAL.interiorZ, rand), geo, mat);
      }
      group.add(interior.mesh);
      interiors.push(interior);

      // portal glow behind the opening + floor light spill (additive)
      const rgb = PORTAL.glow[style];
      const glowGeo = new THREE.PlaneGeometry(1, 1);
      geometries.push(glowGeo);
      const mkGlow = (pos: [number, number, number], scl: [number, number], rotX = 0) => {
        const mat = new THREE.ShaderMaterial({
          vertexShader: GLOW_VERT,
          fragmentShader: GLOW_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) },
            uIntensity: { value: 0 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        materials.push(mat);
        const mesh = new THREE.Mesh(glowGeo, mat);
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.scale.set(scl[0], scl[1], 1);
        if (rotX) mesh.rotation.x = rotX;
        mesh.frustumCulled = false;
        group.add(mesh);
        glowMats.push(mat);
      };
      mkGlow([cx, 2.3, PORTAL.frameZ - 0.6], [5.2, 5.8]);
      mkGlow([cx, 0.05, PORTAL.frameZ + 1.6], [4.2, 3.2], -Math.PI / 2);

      anchors.push(new THREE.Vector3(cx, PORTAL.apexY + 0.5, PORTAL.frameZ));
    });

    scene.add(group);

    const updatePortals = (tS: number, hoverIdx: number, dt: number): void => {
      const active = tS > 1.25 && tS < 3.55;
      group.visible = active;
      if (!active) return;
      const l1 = local(1, tS);
      for (let i = 0; i < 3; i++) {
        setDrawProgress(frames[i], sm(0.05 + i * 0.05, 0.3 + i * 0.05, l1));
        interiors[i].reveal(sm(0.24, 0.62, l1));
        const target = hoverIdx === i ? 1 : 0;
        hoverAmt[i] += (target - hoverAmt[i]) * (1 - Math.exp(-dt * 6));
        const base = 0.32 + 0.5 * hoverAmt[i];
        glowMats[i * 2].uniforms.uIntensity.value = base;
        glowMats[i * 2 + 1].uniforms.uIntensity.value = base * 0.7;
      }
    };

    return { anchors, update: updatePortals, regenerate: () => regenerate?.() };
  };
  const portals = buildPortals();

  // --- S3 · الفهم — majlis room, top-down plan lift, explode into 3 layers ---
  const buildUnderstanding = () => {
    const Z = WORLD.roomAZ; // -84
    const group = new THREE.Group();
    group.visible = false;

    const s3basics: THREE.MeshBasicMaterial[] = [];
    const s3glows: THREE.ShaderMaterial[] = [];
    const lantern = { mat: null as THREE.ShaderMaterial | null };

    const basic = (color: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color, fog: true, transparent: true, opacity: 0 });
      materials.push(m);
      s3basics.push(m);
      return m;
    };
    const box = (
      w: number, h: number, d: number, color: number,
      x: number, y: number, z: number
    ): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, h, d);
      geometries.push(g);
      const mesh = new THREE.Mesh(g, basic(color));
      mesh.position.set(x, y, z);
      return mesh;
    };
    const glowAt = (
      rgb: [number, number, number], x: number, y: number, z: number,
      sx: number, sy: number, collect: THREE.ShaderMaterial[]
    ): THREE.ShaderMaterial => {
      const g = new THREE.PlaneGeometry(1, 1);
      geometries.push(g);
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: { uColor: { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) }, uIntensity: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, 1);
      mesh.frustumCulled = false;
      group.add(mesh);
      collect.push(mat);
      return mat;
    };

    // === Layer 1 · photo-room (style) ===
    const room = new THREE.Group();
    room.add(box(6, 0.1, 5, 0x2a1c14, 0, 0.02, Z)); // floor
    // kilim rug stripes
    const kilim = [0x7a1f1f, 0xb5892f, 0x244b4b];
    for (let i = 0; i < 7; i++) {
      room.add(box(3.4, 0.03, 0.34, kilim[i % 3], 0, 0.08, Z - 1.5 + i * 0.5));
    }
    room.add(box(6, 3.2, 0.14, 0x171009, 0, 1.6, Z - 2.35)); // back wall
    room.add(box(4.6, 0.55, 0.75, 0x7a1f1f, 0, 0.38, Z - 1.85)); // diwan
    for (let k = -1.6; k <= 1.6; k += 0.8) {
      room.add(box(0.62, 0.5, 0.18, 0x9a3b2f, k, 0.78, Z - 2.1)); // back cushions
    }
    for (let k = -1.2; k <= 1.2; k += 1.2) {
      room.add(box(0.5, 0.3, 0.5, 0xb5892f, k, 0.2, Z + 0.4)); // floor cushions
    }
    // triple-arch window glows (lit) on the back wall
    for (let k = -1; k <= 1; k++) {
      glowAt([0.55, 0.62, 0.82], k * 1.4, 2.05, Z - 2.28, 0.9, 1.5, s3glows);
    }
    // brass lantern glow (warm, flickers in update)
    lantern.mat = glowAt([1, 0.8, 0.42], 0, 2.4, Z - 0.4, 1.4, 1.6, []);
    group.add(room);

    // === Layer 2 · top-down plan (map) — gold Line2 rects, XY plane, lifts ===
    const planGroup = new THREE.Group();
    const planMat = lineMaterial("main", 2.0);
    const rectXY = (w: number, h: number, cx: number, cy: number) => {
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      const pts = [x0, y0, Z, x1, y0, Z, x1, y1, Z, x0, y1, Z, x0, y0, Z];
      const d = makeDrawnLine(pts, planMat);
      setDrawProgress(d, 1);
      geometries.push(d.line.geometry);
      planGroup.add(d.line);
    };
    rectXY(4.2, 3.2, 0, 1.7); // room outline
    rectXY(3.0, 0.5, 0, 2.9); // diwan footprint
    rectXY(0.7, 0.7, -1.0, 0.7); // cushion
    rectXY(0.7, 0.7, 1.0, 0.7); // cushion
    rectXY(1.2, 0.3, 0, 3.15); // window run
    group.add(planGroup);

    // === Layer 3 · relief panel (depth) — gold-graded low blocks ===
    const reliefGroup = new THREE.Group();
    const reliefSpecs: InstanceSpec[] = [];
    const goldLo = new THREE.Color(0x6b5220);
    const goldHi = new THREE.Color(0xf0d78c);
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const h = 0.2 + 0.9 * Math.abs(Math.sin(gx * 0.9) * Math.cos(gz * 1.3));
        reliefSpecs.push({
          x: gx * 0.62, y: h / 2, z: gz * 0.62,
          sx: 0.5, sy: h, sz: 0.5,
          order: (gx + 2) / 4,
          color: goldLo.clone().lerp(goldHi, h / 1.1),
        });
      }
    }
    const reliefGeo = new THREE.BoxGeometry(1, 1, 1);
    geometries.push(reliefGeo);
    const reliefMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, transparent: true, opacity: 0 });
    materials.push(reliefMat);
    s3basics.push(reliefMat);
    const relief = buildInstanced(reliefSpecs, reliefGeo, reliefMat);
    reliefGroup.add(relief.mesh);
    reliefGroup.position.set(0, 0.1, Z);
    group.add(reliefGroup);

    scene.add(group);

    const anchors = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    const updateUnderstanding = (tS: number, time: number): void => {
      const active = tS > 3.15 && tS < 5.95;
      group.visible = active;
      if (!active) return;
      const l2 = local(2, tS);
      const fade = sm(0.05, 0.2, l2) * (1 - sm(0.9, 1, l2));
      for (const m of s3basics) m.opacity = fade;
      planMat.opacity = fade;
      planMat.transparent = true;
      for (const g of s3glows) g.uniforms.uIntensity.value = fade * 1.1;
      if (lantern.mat) {
        lantern.mat.uniforms.uIntensity.value = fade * (0.8 + 0.18 * Math.sin(time * 7) * Math.sin(time * 3.3));
      }

      // plan lifts off the room and floats up (t .35–.55), then explodes higher
      const lift = sm(0.35, 0.55, l2);
      const ex = sm(0.58, 0.8, l2);
      const planY = lerp(0.1, 1.9, lift) + ex * 1.6;
      planGroup.position.y = planY;
      relief.reveal(sm(0.5, 0.85, l2));
      reliefGroup.position.y = 0.1 - ex * 2.0; // depth layer sinks

      anchors[0].set(0, 2.7, Z); // style — above the room
      anchors[1].set(-2.4, planY + 1.9, Z); // plan — beside the lifted map
      anchors[2].set(-2.4, reliefGroup.position.y + 0.6, Z); // depth — by the relief
    };

    return { anchors, update: updateUnderstanding };
  };
  const understanding = buildUnderstanding();

  // --- S4 · التحوّل — neutral room ↔ full Lebanese materiality (culture 0..1) ---
  const buildTransformation = () => {
    const Z = WORLD.roomBZ; // -118
    const group = new THREE.Group();
    group.visible = false;

    const neutral = new THREE.Color(0x3a3a42);
    const warmFloor = new THREE.Color(0x2a1c14);
    const warmWall = new THREE.Color(0x1a130c);

    const floorMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: true });
    const wallMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: true });
    materials.push(floorMat, wallMat);
    const floorGeo = new THREE.BoxGeometry(6, 0.1, 5);
    const wallGeo = new THREE.BoxGeometry(6, 3.2, 0.14);
    geometries.push(floorGeo, wallGeo);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, 0.02, Z);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 1.6, Z - 2.35);
    group.add(floor, wall);

    // cultural elements (scale in with culture)
    const cultural = new THREE.Group();
    // limestone courses on the wall
    const stoneSpecs: InstanceSpec[] = [];
    const lime = new THREE.Color(PORTAL_MATERIAL.limestone);
    for (let gy = 0.5; gy < 3.0; gy += 0.4) {
      const off = (Math.round(gy / 0.4) % 2) * 0.45;
      for (let gx = -2.3 + off; gx < 2.3; gx += 0.9) {
        stoneSpecs.push({
          x: gx, y: gy + 0.2, z: Z - 2.26,
          sx: 0.82, sy: 0.32, sz: 0.12,
          order: gy / 3.2, color: lime.clone(),
        });
      }
    }
    const stoneGeo = new THREE.BoxGeometry(1, 1, 1);
    geometries.push(stoneGeo);
    const stoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: true });
    materials.push(stoneMat);
    const stone = buildInstanced(stoneSpecs, stoneGeo, stoneMat);
    cultural.add(stone.mesh);
    // kilim rug
    const kilimGrp = new THREE.Group();
    const kilimCols = [0x7a1f1f, 0xb5892f, 0x244b4b];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.BoxGeometry(3.4, 0.03, 0.34);
      geometries.push(g);
      const m = new THREE.MeshBasicMaterial({ color: kilimCols[i % 3], transparent: true, opacity: 0, fog: true });
      materials.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, 0.08, Z - 1.5 + i * 0.5);
      kilimGrp.add(mesh);
    }
    cultural.add(kilimGrp);
    // red diwan
    const diwanGeo = new THREE.BoxGeometry(4.6, 0.55, 0.75);
    geometries.push(diwanGeo);
    const diwanMat = new THREE.MeshBasicMaterial({ color: 0x7a1f1f, transparent: true, opacity: 0, fog: true });
    materials.push(diwanMat);
    const diwan = new THREE.Mesh(diwanGeo, diwanMat);
    diwan.position.set(0, 0.38, Z - 1.85);
    cultural.add(diwan);
    group.add(cultural);
    const culturalMats = [stoneMat, diwanMat, ...kilimGrp.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial)];

    // lantern + storm glows
    const glow = (rgb: [number, number, number], x: number, y: number, z: number, sx: number, sy: number) => {
      const g = new THREE.PlaneGeometry(1, 1);
      geometries.push(g);
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: { uColor: { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) }, uIntensity: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, 1);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mat;
    };
    const lanternMat = glow([1, 0.8, 0.42], 0, 2.4, Z - 0.4, 1.5, 1.7);
    const stormMat = glow([1, 0.9, 0.7], 0, 1.6, Z - 1.0, 7, 5);

    scene.add(group);

    let prevC = 0;
    const updateTransformation = (tS: number, culture: number, dt: number): void => {
      const active = tS > 5.55 && tS < 7.8;
      group.visible = active;
      if (!active) {
        prevC = culture;
        return;
      }
      const l3 = local(3, tS);
      const fade = sm(0.03, 0.15, l3) * (1 - sm(0.9, 1, l3));
      const c = clamp(culture, 0, 1);
      const ec = c * c * (3 - 2 * c);

      floorMat.color.copy(neutral).lerp(warmFloor, c);
      wallMat.color.copy(neutral).lerp(warmWall, c);
      floorMat.opacity = fade;
      wallMat.opacity = fade;
      for (const m of culturalMats) m.opacity = fade * ec;
      stone.reveal(ec);
      const scl = 0.02 + ec;
      cultural.scale.set(1, scl > 1 ? 1 : scl, 1);
      lanternMat.uniforms.uIntensity.value = fade * ec * (0.85 + 0.12 * Math.sin((tS + prevC) * 40));

      const dc = Math.abs(c - prevC) / Math.max(dt, 0.001);
      prevC = c;
      stormMat.uniforms.uIntensity.value = fade * clamp(dc * 1.6, 0, 0.6);
    };

    return { update: updateTransformation };
  };
  const transformation = buildTransformation();

  // --- S5 · الدعوة — the final door drawn first, warm halo, then inhabited ---
  const buildInvitation = () => {
    const Z = WORLD.doorZ; // -144.2
    const group = new THREE.Group();
    group.visible = false;

    const doorProfile: ArchProfile = { spring: 3.4, center: 0.444, radius: 2.244, halfSpan: 1.8 };
    const doorMat = lineMaterial("bright", 3.0);
    const door = makeDrawnLine(portalFrameOutline(doorProfile, 0, Z), doorMat);
    geometries.push(door.line.geometry);
    group.add(door.line);

    const haloGeo = new THREE.PlaneGeometry(1, 1);
    geometries.push(haloGeo);
    const haloMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(palette.glowWarm[0], palette.glowWarm[1], palette.glowWarm[2]) },
        uIntensity: { value: 0 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    materials.push(haloMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 2.6, Z - 0.4);
    halo.scale.set(6.2, 6.2, 1);
    halo.frustumCulled = false;
    group.add(halo);

    scene.add(group);

    const updateInvitation = (tS: number, time: number): void => {
      const active = tS > 7.35;
      group.visible = active;
      if (!active) return;
      const l4 = local(4, tS);
      setDrawProgress(door, sm(0.02, 0.4, l4));
      // A small base glow the instant the scene is active bridges the S4→S5 seam
      // (the room has just faded); it then grows and breathes.
      const grow = sm(0.05, 0.5, l4);
      haloMat.uniforms.uIntensity.value =
        (0.2 + grow * 0.8) * (0.85 + 0.15 * Math.sin(time * 1.4)) * palette.glowIntensity;
    };

    return { update: updateInvitation };
  };
  const invitation = buildInvitation();

  // --- Per-frame ---
  let prevTime = 0;
  const update = ({ tS, time, hoverIdx = -1, culture = 0 }: WorldUpdateCtx): void => {
    const dt = Math.min(0.05, Math.max(time - prevTime, 0));
    prevTime = time;
    const l0 = local(0, tS);
    // "يُرسَم أولًا ثم يُسكَن" — the arch draws itself over t .05–.35 …
    const draw = sm(0.05, 0.35, l0);
    for (const drawn of archLines) setDrawProgress(drawn, draw);
    // … while the dust gathers along it, holding until we've flown through.
    const dustUniforms = dustMat.uniforms;
    dustUniforms.uMix.value = sm(0.08, 0.38, l0) * (1 - sm(0.6, 0.88, l0));
    dustUniforms.uTime.value = time;
    // Warm horizon breathes beyond the doorway; the flash peaks as we pass.
    // It belongs to Scene 1 — fade it out as Scene 2 opens so it doesn't wash
    // over the portals.
    const l1 = local(1, tS);
    horizonMat.uniforms.uIntensity.value =
      (0.7 + 0.35 * sm(0.2, 0.9, l0) + 0.06 * Math.sin(time * 0.5)) *
      (1 - sm(0.05, 0.45, l1)) *
      palette.glowIntensity;
    flashMat.uniforms.uIntensity.value =
      sm(0.45, 0.62, l0) * (1 - sm(0.75, 0.95, l0)) * 0.45 * palette.glowIntensity;

    portals.update(tS, hoverIdx, dt);
    understanding.update(tS, time);
    transformation.update(tS, culture, dt);
    invitation.update(tS, time);
  };

  const setResolution = (width: number, height: number): void => {
    for (const mat of lineMaterials) mat.resolution.set(width, height);
  };

  // --- Day/Night relight (§6): lerp the 3D chrome; DOM flips via data-dd-mode ---
  const relight = (dayAmount: number): void => {
    const d = clamp(dayAmount, 0, 1);
    const bg = scene.background as THREE.Color;
    bg.lerpColors(nightBg, dayBg, d);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg);
    for (const tl of themedLines) tl.mat.color.lerpColors(tl.night, tl.day, d);
    for (const tb of themedBasics) tb.mat.color.lerpColors(tb.night, tb.day, d);
    (dustMat.uniforms.uColor.value as THREE.Color).lerpColors(nightDust, dayDust, d);
    // additive gold motes by night → normal-blended dark motes by day
    const wantNormal = d > 0.5;
    const isNormal = dustMat.blending === THREE.NormalBlending;
    if (wantNormal !== isNormal) {
      dustMat.blending = wantNormal ? THREE.NormalBlending : THREE.AdditiveBlending;
      dustMat.needsUpdate = true;
    }
    dustMat.uniforms.uOpacity.value = lerp(0.55, 0.5, d);
  };

  const dispose = (): void => {
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    scene.clear();
  };

  return {
    update,
    setResolution,
    relight,
    portalAnchors: portals.anchors,
    layerAnchors: understanding.anchors,
    regenerateZellige: portals.regenerate,
    dispose,
  };
}
