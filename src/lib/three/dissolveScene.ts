/* ============================================================
   Three.js — Particle Dissolve / Result Reveal
   A field of gold particles that assembles into a luminous
   pointed-arch silhouette as progress→1.
   Ported from dar-design-2 (js/three-dissolve.js).
   ============================================================ */

import * as THREE from "three";
import type { DissolveSceneOpts, SceneHandle } from "./types";

function sampleArchPoints(count: number, w: number, h: number): number[][] {
  // Sample points along the silhouette of a pointed arch + interior
  const pts: number[][] = [];
  const halfW = w / 2;
  const baseH = h * 0.55;
  const arcTop = h;

  function bezierQuad(t: number, p0: number[], p1: number[], p2: number[]): number[] {
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
  }

  const outline: number[][] = [];
  // left column
  for (let i = 0; i < 40; i++) outline.push([-halfW, (i / 40) * baseH]);
  // left arc
  for (let i = 0; i < 80; i++) {
    const t = i / 79;
    const [x, y] = bezierQuad(t, [-halfW, baseH], [-halfW, arcTop * 0.95], [0, arcTop]);
    outline.push([x, y]);
  }
  // right arc
  for (let i = 0; i < 80; i++) {
    const t = i / 79;
    const [x, y] = bezierQuad(t, [0, arcTop], [halfW, arcTop * 0.95], [halfW, baseH]);
    outline.push([x, y]);
  }
  // right column
  for (let i = 0; i < 40; i++) outline.push([halfW, baseH - (i / 40) * baseH]);
  // base
  for (let i = 0; i < 60; i++) outline.push([halfW - (i / 60) * w, 0]);

  // densify
  for (let i = 0; i < count; i++) {
    const pick = outline[Math.floor(Math.random() * outline.length)];
    const jitter = (Math.random() - 0.5) * 0.12;
    pts.push([pick[0] + jitter, pick[1] + jitter, (Math.random() - 0.5) * 0.6]);
  }
  return pts;
}

export function DissolveScene(container: HTMLElement, opts: DissolveSceneOpts = {}): SceneHandle {
  const { count = 4000, color = 0xf0d78c, bgColor = null } = opts;

  const scene = new THREE.Scene();
  if (bgColor !== null) scene.background = new THREE.Color(bgColor);

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 80);
  camera.position.set(0, 0.8, 6);
  camera.lookAt(0, 1.2, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";

  // generate target positions (arch shape)
  const targetPts = sampleArchPoints(count, 3.6, 4.6);
  // generate start positions (chaos cloud)
  const start = new Float32Array(count * 3);
  const target = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // start: random in a wide cloud
    start[i * 3] = (Math.random() - 0.5) * 18;
    start[i * 3 + 1] = (Math.random() - 0.5) * 12;
    start[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    target[i * 3] = targetPts[i][0];
    target[i * 3 + 1] = targetPts[i][1];
    target[i * 3 + 2] = targetPts[i][2];
    phase[i] = Math.random();
  }

  const positions = new Float32Array(count * 3);
  positions.set(start);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.05,
    color: color,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  // soft back-glow plane
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext("2d")!;
  const radial = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  radial.addColorStop(0, "rgba(255, 200, 100, 0.7)");
  radial.addColorStop(0.5, "rgba(212, 175, 55, 0.2)");
  radial.addColorStop(1, "rgba(0,0,0,0)");
  gctx.fillStyle = radial;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), glowMat);
  glow.position.set(0, 1.5, -1);
  scene.add(glow);

  let progress = 0;
  function setProgress(p: number) {
    progress = Math.max(0, Math.min(1, p));
  }

  let mouseX = 0,
    mouseY = 0;
  let mouseXT = 0,
    mouseYT = 0;
  function setMouse(x: number, y: number) {
    mouseXT = x;
    mouseYT = y;
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

    mouseX += (mouseXT - mouseX) * 0.06;
    mouseY += (mouseYT - mouseY) * 0.06;

    // ease progress per-particle by phase
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const p = Math.max(0, Math.min(1, (progress - phase[i] * 0.4) / 0.6));
      const eased = 1 - Math.pow(1 - p, 3);
      const sx = start[i * 3],
        sy = start[i * 3 + 1],
        sz = start[i * 3 + 2];
      const tx = target[i * 3],
        ty = target[i * 3 + 1],
        tz = target[i * 3 + 2];
      // add gentle floating jitter
      const j = (1 - eased) * 0.02;
      arr[i * 3] = sx + (tx - sx) * eased + Math.sin(time * 1.3 + phase[i] * 12) * j;
      arr[i * 3 + 1] = sy + (ty - sy) * eased + Math.cos(time * 1.1 + phase[i] * 11) * j;
      arr[i * 3 + 2] = sz + (tz - sz) * eased;
    }
    posAttr.needsUpdate = true;
    points.rotation.y = mouseX * 0.1;
    points.rotation.x = -mouseY * 0.05;
    glowMat.opacity = progress * 0.85;
    glow.rotation.z = time * 0.03;

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
