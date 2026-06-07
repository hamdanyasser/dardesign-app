/* ============================================================
   Three.js — Qanater Arch Scene
   A pointed Arabic arch the camera dollies through.
   Used in the hero, the result reveal, and the boot scene.
   Ported from dar-design-2 (js/three-arch.js).
   ============================================================ */

import * as THREE from "three";
import type { ArchSceneOpts, SceneHandle } from "./types";

function makeArchShape(w: number, h: number): THREE.Shape {
  const shape = new THREE.Shape();
  const halfW = w / 2;
  const baseH = h * 0.55; // straight column height
  const arcTop = h; // pointed apex
  const inset = w * 0.04; // wall thickness

  // outer outline (closed)
  shape.moveTo(-halfW, 0);
  shape.lineTo(-halfW, baseH);
  // pointed arch — two quadratic curves meeting at apex
  shape.quadraticCurveTo(-halfW, arcTop * 0.95, 0, arcTop);
  shape.quadraticCurveTo(halfW, arcTop * 0.95, halfW, baseH);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);

  // hole inside (opening through the arch)
  const innerHalf = halfW - inset;
  const innerBase = baseH * 0.95;
  const innerApex = arcTop - inset * 1.4;
  const hole = new THREE.Path();
  hole.moveTo(-innerHalf, 0);
  hole.lineTo(-innerHalf, innerBase);
  hole.quadraticCurveTo(-innerHalf, innerApex * 0.97, 0, innerApex);
  hole.quadraticCurveTo(innerHalf, innerApex * 0.97, innerHalf, innerBase);
  hole.lineTo(innerHalf, 0);
  hole.lineTo(-innerHalf, 0);
  shape.holes.push(hole);
  return shape;
}

function makeArchGeometry(w: number, h: number, depth: number): THREE.ExtrudeGeometry {
  const shape = makeArchShape(w, h);
  return new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 3,
    curveSegments: 48,
  });
}

function makeMashrabiyaGrille(w: number, h: number): THREE.Mesh {
  // Subtle brass-on-dark lattice. Smaller, tighter, more atmospheric.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(212,175,55,0.45)";
  ctx.lineWidth = 1.0;
  const r = 22;
  for (let y = -r; y <= 512 + r; y += r * 1.5) {
    const xOff = Math.round(y / (r * 1.5)) % 2 === 0 ? 0 : r;
    for (let x = -r + xOff; x <= 512 + r; x += r * 2) {
      ctx.beginPath();
      for (let a = 0; a < 16; a++) {
        const theta = (a / 16) * Math.PI * 2;
        const radius = a % 2 === 0 ? r * 0.7 : r * 0.32;
        const px = x + Math.cos(theta) * radius;
        const py = y + Math.sin(theta) * radius;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.4);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(w, h);
  return new THREE.Mesh(geo, mat);
}

interface DustField {
  points: THREE.Points;
  positions: Float32Array;
  speeds: Float32Array;
  offsets: Float32Array;
}

function makeDustField(count: number, radius: number): DustField {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const offsets = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = Math.random() * radius;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = (Math.random() - 0.5) * radius * 1.4;
    positions[i * 3 + 2] = Math.sin(a) * r - radius * 0.4;
    speeds[i] = 0.3 + Math.random() * 0.7;
    offsets[i] = Math.random() * 100;
  }
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geom.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));

  const mat = new THREE.PointsMaterial({
    size: 0.06,
    color: 0xf0d78c,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  return { points: new THREE.Points(geom, mat), positions, speeds, offsets };
}

export function ArchScene(container: HTMLElement, opts: ArchSceneOpts = {}): SceneHandle {
  const {
    archColor = 0xd4af37,
    bgColor = null, // transparent if null
    dustCount = 1400,
    cameraZStart = 5,
    cameraZEnd = -1.2,
    enableMashrabiya = true,
    ambient = 0.4,
    offsetX = 0, // shift the whole arch composition horizontally in world units
    angle = 0, // y-axis rotation of the arch cluster (radians)
    fogColor = 0x0a0a0f,
    fogNear = 4,
    fogFar = 18,
  } = opts;

  const scene = new THREE.Scene();
  if (bgColor !== null) scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const camera = new THREE.PerspectiveCamera(58, w / h, 0.05, 60);
  camera.position.set(0, 0, cameraZStart);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: bgColor === null });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";

  // depth layers of arches — grouped so we can rotate + offset together
  const archGroup = new THREE.Group();
  archGroup.position.x = offsetX;
  archGroup.rotation.y = angle;
  scene.add(archGroup);

  const archLayers: THREE.Mesh[] = [];
  const layerDefs = [
    { w: 3.6, h: 4.6, z: 0.6, opacity: 1.0, emissive: 0.55 },
    { w: 4.6, h: 5.8, z: -2.4, opacity: 0.78, emissive: 0.35 },
    { w: 5.8, h: 7.4, z: -5.5, opacity: 0.5, emissive: 0.22 },
    { w: 7.5, h: 9.6, z: -9, opacity: 0.28, emissive: 0.14 },
  ];

  layerDefs.forEach((d, i) => {
    const geo = makeArchGeometry(d.w, d.h, 0.32);
    geo.translate(0, -d.h / 2, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: archColor,
      metalness: 0.85,
      roughness: 0.32,
      transparent: i > 0,
      opacity: d.opacity,
      emissive: 0x6a4410,
      emissiveIntensity: d.emissive,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, 0, d.z);
    archGroup.add(m);
    archLayers.push(m);
  });

  // mashrabiya grille behind the deepest arch
  let grille: THREE.Mesh | null = null;
  if (enableMashrabiya) {
    grille = makeMashrabiyaGrille(16, 16);
    grille.position.set(0, 0, -11);
    archGroup.add(grille);
  }

  // warm back-glow plane — sun bleeding through the deepest arch
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext("2d")!;
  const rg = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, "rgba(255, 220, 140, 0.95)");
  rg.addColorStop(0.4, "rgba(212, 175, 55, 0.45)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  gctx.fillStyle = rg;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), glowMat);
  backGlow.position.set(0, -0.5, -10.5);
  archGroup.add(backGlow);

  // dust
  const dust = makeDustField(dustCount, 8);
  scene.add(dust.points);

  // light — three-point, warm key, hot back-rim
  const ambientLight = new THREE.AmbientLight(0xffe4a8, ambient + 0.3);
  scene.add(ambientLight);
  const key = new THREE.DirectionalLight(0xffe4a8, 2.2);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd4af37, 0.9);
  fill.position.set(-3, 1, 2);
  scene.add(fill);
  const back = new THREE.PointLight(0xffb060, 2.6, 18);
  back.position.set(0, 0, -6);
  scene.add(back);
  const rim = new THREE.PointLight(0xff8a4a, 1.6, 8);
  rim.position.set(0, -1, -2);
  scene.add(rim);

  let progress = 0; // 0..1 dolly into arch
  let mouseX = 0;
  let mouseY = 0;
  let mouseXTarget = 0;
  let mouseYTarget = 0;

  function setProgress(p: number) {
    progress = Math.max(0, Math.min(1, p));
  }
  function setMouse(x: number, y: number) {
    mouseXTarget = x;
    mouseYTarget = y;
  }

  function onResize() {
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;
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

    // ease mouse
    mouseX += (mouseXTarget - mouseX) * 0.06;
    mouseY += (mouseYTarget - mouseY) * 0.06;

    // camera dolly + parallax
    const zPos = cameraZStart + (cameraZEnd - cameraZStart) * progress;
    camera.position.x = mouseX * 0.45;
    camera.position.y = mouseY * 0.3;
    camera.position.z = zPos;
    camera.lookAt(0, 0, -2);

    // arch group parallax — the cluster sways subtly with the mouse
    archGroup.rotation.y = angle + mouseX * 0.1;
    archGroup.rotation.x = -mouseY * 0.05;
    archLayers.forEach((m, i) => {
      m.position.x = mouseX * 0.04 * (i + 1);
    });

    // dust rising
    const posAttr = dust.points.geometry.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    for (let i = 0; i < dust.positions.length / 3; i++) {
      positions[i * 3 + 1] += dust.speeds[i] * 0.005;
      positions[i * 3] += Math.sin(time * 0.4 + dust.offsets[i]) * 0.001;
      if (positions[i * 3 + 1] > 5) {
        positions[i * 3 + 1] = -5;
        positions[i * 3] = (Math.random() - 0.5) * 14;
        positions[i * 3 + 2] = -Math.random() * 12;
      }
    }
    posAttr.needsUpdate = true;
    dust.points.rotation.y = mouseX * 0.05;

    // grille slow rotate
    if (grille) {
      grille.rotation.z = time * 0.02;
    }

    // soft pulse of the back light
    back.intensity = 2.2 + Math.sin(time * 0.6) * 0.5;
    glowMat.opacity = 0.7 + Math.sin(time * 0.4) * 0.18;

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(animate);

  return {
    setProgress,
    setMouse,
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
