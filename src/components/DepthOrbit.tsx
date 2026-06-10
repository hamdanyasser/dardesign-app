"use client";

/**
 * DarDesign — DepthOrbit (Tier A interactive 3D, Week 2 Mon task).
 *
 * Displaces a textured plane by the Depth Anything V2 depth map → live
 * in-browser orbit of the styled room. Zero backend cost: it reuses the
 * styled image + depth map the pipeline already returns.
 *
 * Install:   npm i three
 * Usage:     <DepthOrbit imageUrl={styledUrl} depthUrl={depthUrl} />
 *
 * Notes
 *  - depthUrl should be the grayscale depth PNG (larger = closer, the
 *    Depth Anything convention). Flip `nearIsLarge` if yours differs.
 *  - Orbit is intentionally clamped: this is a parallax "look into the
 *    room", not a free fly-through (Tier B mesh comes later).
 *  - Respects prefers-reduced-motion (no idle auto-sway), caps DPR at 2,
 *    cleans up GL resources on unmount.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Props = {
  imageUrl: string;
  depthUrl: string;
  /** Depth Anything outputs disparity-like maps (larger = closer). */
  nearIsLarge?: boolean;
  /** Relief strength in world units. 0.55 reads well for interiors. */
  displacement?: number;
  className?: string;
  /** Plane resolution. 256 is smooth on mid phones; 384 on desktop. */
  segments?: number;
};

export default function DepthOrbit({
  imageUrl,
  depthUrl,
  nearIsLarge = true,
  displacement = 0.55,
  className,
  segments = 256,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // --- renderer / scene / camera -------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.1,
      50
    );
    camera.position.set(0, 0, 2.1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.3;
    controls.maxDistance = 3.2;
    // Clamp to a window-like viewing cone — parallax, not fly-through.
    controls.minAzimuthAngle = -0.5;
    controls.maxAzimuthAngle = 0.5;
    controls.minPolarAngle = Math.PI / 2 - 0.42;
    controls.maxPolarAngle = Math.PI / 2 + 0.42;

    let mesh: THREE.Mesh | null = null;
    let frame = 0;
    let disposed = false;

    // --- load image + depth, displace vertices on CPU -------------------
    const loadImage = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
      });

    Promise.all([loadImage(imageUrl), loadImage(depthUrl)])
      .then(([photo, depthImg]) => {
        if (disposed) return;

        // Sample depth into a (segments+1)² grid via canvas.
        const c = document.createElement("canvas");
        c.width = c.height = segments + 1;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(depthImg, 0, 0, c.width, c.height);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;

        const aspect = photo.width / photo.height;
        const geo = new THREE.PlaneGeometry(
          1.9 * aspect,
          1.9,
          segments,
          segments
        );
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const r = px[i * 4] / 255; // grayscale depth
          const near = nearIsLarge ? r : 1 - r;
          pos.setZ(i, (near - 0.5) * displacement);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const tex = new THREE.Texture(photo);
        tex.needsUpdate = true;
        // three 0.150 (this repo's pin) predates Texture.colorSpace
        tex.encoding = THREE.sRGBEncoding;

        mesh = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ map: tex })
        );
        scene.add(mesh);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));

    // --- loop / resize / cleanup ----------------------------------------
    const clock = new THREE.Clock();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      // Gentle idle sway sells the 3D before the user touches it.
      if (mesh && !prefersReducedMotion) {
        const t = clock.getElapsedTime();
        mesh.rotation.y = Math.sin(t * 0.4) * 0.045;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [imageUrl, depthUrl, nearIsLarge, displacement, segments]);

  return (
    <div
      ref={mountRef}
      dir="rtl"
      className={className ?? "relative h-[420px] w-full overflow-hidden rounded-2xl bg-neutral-900"}
      aria-label="عرض ثلاثي الأبعاد للغرفة | 3D room view"
      role="img"
    >
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-200/80">
          {status === "loading" ? "...يُبنى المشهد ثلاثي الأبعاد" : "تعذّر تحميل العرض ثلاثي الأبعاد"}
        </div>
      )}
    </div>
  );
}
