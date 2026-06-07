/* ============================================================
   Three.js — Cultural 3D Ornament
   An interlocking eight-pointed star polyhedron (Star of
   Lakshmi style) extruded in 3D. Per-culture materials.
   Ported from dar-design-2 (js/three-ornament.js).
   ============================================================ */

import * as THREE from "three";
import type { OrnamentSceneOpts, SceneHandle } from "./types";

function makeEightPointStar(r = 1, depth = 0.4): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const inner = r * 0.42;
  // 16-vertex eight-pointed star
  for (let a = 0; a < 16; a++) {
    const theta = (a / 16) * Math.PI * 2 - Math.PI / 2;
    const rad = a % 2 === 0 ? r : inner;
    const x = Math.cos(theta) * rad;
    const y = Math.sin(theta) * rad;
    if (a === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.18,
    bevelSize: depth * 0.18,
    bevelSegments: 3,
    curveSegments: 16,
  });
}

interface VariantDef {
  starColor: number;
  edgeColor: number;
  satelliteColor: number;
  metalness: number;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
  bgGlow: string;
}

// Cultural variants — tuned brass tones, calmer emissives.
const VARIANTS: Record<string, VariantDef> = {
  lebanese: {
    starColor: 0xb89460,
    edgeColor: 0xd4af37,
    satelliteColor: 0x6b4824,
    metalness: 0.7,
    roughness: 0.42,
    emissive: 0x3a2510,
    emissiveIntensity: 0.18,
    bgGlow: "rgba(255, 200, 130, 0.45)",
  },
  khaleeji: {
    starColor: 0xd4af37,
    edgeColor: 0xf0d78c,
    satelliteColor: 0x8a2030,
    metalness: 0.92,
    roughness: 0.22,
    emissive: 0x5a3010,
    emissiveIntensity: 0.22,
    bgGlow: "rgba(255, 220, 140, 0.55)",
  },
  moroccan: {
    starColor: 0x2756a8,
    edgeColor: 0xe2b760,
    satelliteColor: 0xc44a36,
    metalness: 0.78,
    roughness: 0.28,
    emissive: 0x0a1a4a,
    emissiveIntensity: 0.2,
    bgGlow: "rgba(226, 183, 96, 0.45)",
  },
};

export function OrnamentScene(container: HTMLElement, opts: OrnamentSceneOpts = {}): SceneHandle {
  const { variant = "khaleeji", enableAmbientDust = true, starSize = 1.4 } = opts;

  const v = VARIANTS[variant] || VARIANTS.khaleeji;
  const scene = new THREE.Scene();

  const w = container.clientWidth || 480;
  const h = container.clientHeight || 600;
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 30);
  camera.position.set(0, 0, 6.5);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";

  // ---- back-glow (warm radial) ----
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext("2d")!;
  const rg = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, v.bgGlow);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  gctx.fillStyle = rg;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5), glowMat);
  backGlow.position.set(0, 0, -2);
  scene.add(backGlow);

  // ---- main star ----
  const starGeo = makeEightPointStar(starSize, starSize * 0.22);
  starGeo.center();

  const starMat = new THREE.MeshStandardMaterial({
    color: v.starColor,
    metalness: v.metalness,
    roughness: v.roughness,
    emissive: v.emissive,
    emissiveIntensity: v.emissiveIntensity,
  });
  const star1 = new THREE.Mesh(starGeo, starMat);
  scene.add(star1);

  // ---- brass medallion behind the star (depth + decoration) ----
  const ringGeo = new THREE.TorusGeometry(starSize * 1.18, 0.03, 8, 64);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x3a2510,
    emissiveIntensity: 0.4,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.z = -0.5;
  scene.add(ring);

  const innerRingGeo = new THREE.TorusGeometry(starSize * 0.55, 0.018, 8, 48);
  const innerRing = new THREE.Mesh(innerRingGeo, ringMat);
  innerRing.position.z = 0.25;
  scene.add(innerRing);

  // small brass center disc — reads as a polished medallion at the star's heart
  const discGeo = new THREE.CircleGeometry(starSize * 0.14, 32);
  const discMat = new THREE.MeshStandardMaterial({
    color: v.edgeColor,
    metalness: 0.95,
    roughness: 0.18,
    emissive: v.emissive,
    emissiveIntensity: 0.6,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.z = 0.28;
  scene.add(disc);

  // alias for variant tweens (legacy name reused by setVariant logic below)
  const innerMat = discMat;

  // ---- satellite ring (small octahedrons orbiting) ----
  const satellites: THREE.Mesh[] = [];
  const satCount = 8;
  const satGeo = new THREE.OctahedronGeometry(0.1);
  const satMat = new THREE.MeshStandardMaterial({
    color: v.satelliteColor,
    metalness: 0.7,
    roughness: 0.4,
    emissive: v.emissive,
    emissiveIntensity: 0.3,
  });
  for (let i = 0; i < satCount; i++) {
    const s = new THREE.Mesh(satGeo, satMat);
    const a = (i / satCount) * Math.PI * 2;
    const r = starSize * 1.42;
    s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    s.userData = { baseA: a, baseR: r };
    scene.add(s);
    satellites.push(s);
  }

  // ---- dust ----
  let dust: { points: THREE.Points; positions: Float32Array; speeds: Float32Array } | null = null;
  if (enableAmbientDust) {
    const count = 220;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 3 - 0.5;
      speeds[i] = 0.2 + Math.random() * 0.6;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.04,
      color: v.edgeColor,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    dust = { points: new THREE.Points(dustGeo, dustMat), positions, speeds };
    scene.add(dust.points);
  }

  // ---- lights ----
  scene.add(new THREE.AmbientLight(0xffe4a8, 0.5));
  const key = new THREE.DirectionalLight(0xffe4a8, 1.6);
  key.position.set(2.5, 2.5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(0xff8a4a, 1.4, 8);
  rim.position.set(-2, -1, 2);
  scene.add(rim);
  const back = new THREE.PointLight(0xffd070, 1.2, 6);
  back.position.set(0, 0, -1.5);
  scene.add(back);

  let mouseX = 0,
    mouseY = 0;
  let mouseXT = 0,
    mouseYT = 0;
  function setMouse(x: number, y: number) {
    mouseXT = x;
    mouseYT = y;
  }

  // variant transition state (must exist before animate runs)
  let targetVariant: VariantDef = v;
  function setVariant(name: string) {
    const nv = VARIANTS[name];
    if (nv) targetVariant = nv;
  }

  function onResize() {
    const W = container.clientWidth || 480;
    const H = container.clientHeight || 600;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", onResize);

  let running = true;
  let raf = 0;
  function animate(t: number) {
    if (!running) return;
    raf = requestAnimationFrame(animate);
    const time = t * 0.001;
    mouseX += (mouseXT - mouseX) * 0.05;
    mouseY += (mouseYT - mouseY) * 0.05;

    // rotate star
    star1.rotation.z = time * 0.14;
    star1.rotation.y = mouseX * 0.18;
    star1.rotation.x = -mouseY * 0.15;
    // medallion rings counter-rotate
    ring.rotation.z = -time * 0.06;
    innerRing.rotation.z = time * 0.22;
    disc.rotation.z = time * 0.1;

    // satellites orbit
    satellites.forEach((s, i) => {
      const ud = s.userData as { baseA: number; baseR: number };
      const a = ud.baseA + time * 0.25;
      s.position.x = Math.cos(a) * ud.baseR;
      s.position.y = Math.sin(a) * ud.baseR;
      s.rotation.x = time * 0.6 + i;
      s.rotation.y = time * 0.5 + i;
    });

    // dust float
    if (dust) {
      const posAttr = dust.points.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < dust.positions.length / 3; i++) {
        arr[i * 3 + 1] += dust.speeds[i] * 0.005;
        if (arr[i * 3 + 1] > 3) {
          arr[i * 3 + 1] = -3;
          arr[i * 3] = (Math.random() - 0.5) * 6;
        }
      }
      posAttr.needsUpdate = true;
    }

    // back glow pulse
    glowMat.opacity = 0.7 + Math.sin(time * 0.6) * 0.2;
    backGlow.rotation.z = time * 0.05;
    back.intensity = 1.2 + Math.sin(time * 0.5) * 0.4;

    // ease materials toward target variant
    if (targetVariant) {
      const k = 0.05;
      starMat.color.lerp(new THREE.Color(targetVariant.starColor), k);
      innerMat.color.lerp(new THREE.Color(targetVariant.edgeColor), k);
      satMat.color.lerp(new THREE.Color(targetVariant.satelliteColor), k);
      starMat.emissive.lerp(new THREE.Color(targetVariant.emissive), k);
      innerMat.emissive.lerp(new THREE.Color(targetVariant.emissive), k);
      starMat.metalness += (targetVariant.metalness - starMat.metalness) * k;
      starMat.roughness += (targetVariant.roughness - starMat.roughness) * k;
      starMat.emissiveIntensity += (targetVariant.emissiveIntensity - starMat.emissiveIntensity) * k;
    }

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(animate);

  return {
    setMouse,
    setVariant,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      try {
        container.removeChild(renderer.domElement);
      } catch {
        /* already removed */
      }
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (material) {
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    },
    resize: onResize,
  };
}
