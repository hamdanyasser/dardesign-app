/* ============================================================
   DAR Build Mode — the 3D world

   Owns the renderer, camera, room shell and object meshes. Deliberately
   knows nothing about React: it takes a DesignScene in and answers
   picking questions, so the interaction layer can stay a thin component
   and the same world could later be driven by a replay or a tour.

   CAMERA. A hand-written orbit rig rather than OrbitControls. Three
   reasons: the polar angle must be clamped so you can never get under
   the floor, the target must stay inside the room so you cannot lose it,
   and the motion wants critical-ish damping that OrbitControls' generic
   feel does not give. It is ~60 lines and worth owning.

   WALL CULLING. The two walls nearest the camera fade out every frame.
   Without it an interior model is unusable — you spend the whole time
   orbiting to see past a wall. With it the room feels like a doll's
   house you are looking into, which is the intended feeling.
   ============================================================ */

import * as THREE from "three";
import { ADE20K_CEILING, ADE20K_DOOR, ADE20K_FLOOR, ADE20K_WALL, ADE20K_WINDOW, ade20kHex } from "./ade20k";
import { buildObjectMesh, colorOf, standardMaterial } from "./geometry";
import { MATERIALS, cultureAccent, getMaterial } from "./materials";
import type { WallOpening } from "./roomModel";
import type { DesignScene, PlacedObject } from "./types";

export type ViewPreset = "perspective" | "plan" | "corner";

interface Spherical {
  radius: number;
  /** polar, from +Y down. Clamped so the camera stays above the floor. */
  phi: number;
  /** azimuth around Y. */
  theta: number;
}

const MIN_PHI = 0.12;
const MAX_PHI = Math.PI / 2 - 0.04;

/** Conditioning capture — a person standing in the room, not an orbit camera.
 *  Eye height for an adult standing; a ~24mm interior lens (54deg vertical on
 *  4:3 is ~68deg horizontal), which is the framing interior photography — and
 *  therefore the ControlNets' training data — actually uses; and how far off
 *  the back wall to stand so the near wall is behind the lens, not in it. */
const CAPTURE_EYE_Y = 155;
const CAPTURE_FOV_DEG = 54;
const CAPTURE_WALL_CLEARANCE = 45;
/** Half the space a standing person occupies, plus enough that whatever is
 *  beside them does not fill the lens. Used to reject camera spots that fall
 *  inside or hard against a piece of furniture. */
const CAPTURE_BODY_CM = 55;

/** Linear -> sRGB transfer, as a 256-entry byte LUT built once. The real
 *  piecewise function, not a 1/2.2 approximation, because the beauty pass is
 *  shown next to the on-screen view and a gamma mismatch is exactly what the
 *  eye picks up in a side-by-side. */
let _srgbLut: Uint8Array | null = null;
function SRGB_LUT(): Uint8Array {
  if (_srgbLut) return _srgbLut;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
  _srgbLut = lut;
  return lut;
}

export class DesignWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private canvas: HTMLCanvasElement;
  private shellGroup = new THREE.Group();
  private objectGroup = new THREE.Group();
  private helperGroup = new THREE.Group();
  /** Each wall plus anything drawn onto it. Openings must fade WITH their
   *  wall — a door reveal left visible after its wall is culled reads as a
   *  slab floating in the middle of the room. */
  private wallMeshes: Array<{
    mesh: THREE.Mesh;
    normal: THREE.Vector3;
    id: WallOpening["wall"];
    attachments: THREE.Mesh[];
  }> = [];
  private floorMesh: THREE.Mesh | null = null;
  private objectIndex = new Map<string, THREE.Group>();

  private sph: Spherical = { radius: 780, phi: 1.02, theta: -0.62 };
  private targetSph: Spherical = { radius: 780, phi: 1.02, theta: -0.62 };
  private target = new THREE.Vector3(0, 60, 0);
  private targetTarget = new THREE.Vector3(0, 60, 0);

  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pointer = new THREE.Vector2();

  private selectionCage: THREE.LineSegments | null = null;
  private selectionRing: THREE.Mesh | null = null;
  private ghost: THREE.Group | null = null;
  private guideGroup = new THREE.Group();

  private accent = colorOf("#d4af37");
  private raf = 0;
  private disposed = false;
  private roomW = 520;
  private roomD = 420;
  private roomH = 300;
  private dirty = true;
  /** Frames still to render after the last change. Keeps the loop idle when
   *  nothing moves, which matters on a laptop GPU also running a dev server. */
  private settleFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // three 0.150 predates outputColorSpace; sRGBEncoding is its equivalent.
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Deliberately under 1. ACES plus three's legacy (non-physical) light
    // units blows saturated colour out fast: at exposure 1.05 with a key of
    // 2.1, Moroccan cobalt #0040c0 rendered as pale sky blue and the whole
    // palette lost its identity. The ontology's colours have to survive the
    // renderer or there was no point sourcing them from it.
    this.renderer.toneMappingExposure = 0.92;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 10, 8000);

    // The shared material cache in geometry.ts hands the SAME instance to every
    // object using a key, so disposeObject must not free them when one object
    // is removed — the other twenty are still drawing with it. This call marks
    // them, and it is not optional: without it a rebuild disposes a material
    // that live meshes still reference (and, once maps are attached, orphans
    // their textures too). It used to be exported and never called.
    protectSharedMaterials(Object.keys(MATERIALS));

    this.scene.add(this.shellGroup, this.objectGroup, this.helperGroup, this.guideGroup);
    this.setupLights();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------------- lighting ---------------- */

  private key!: THREE.DirectionalLight;

  private setupLights() {
    // Warm key from high and to one side, cool fill opposite: the standard
    // architectural model lighting that makes massing legible. The hemisphere
    // is kept low — raise it and the model flattens into an even wash, which
    // is exactly what makes a 3D room look like a screenshot of nothing.
    const hemi = new THREE.HemisphereLight(0xfff3e0, 0x2a2318, 0.45);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0d8, 1.15);
    key.position.set(420, 780, 380);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 50;
    key.shadow.camera.far = 2600;
    const s = 800;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 1.4;
    this.key = key;
    this.scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xbcd2e8, 0.26);
    fill.position.set(-520, 340, -260);
    this.scene.add(fill);
  }

  /** The plinth the model sits on.
   *
   *  Without it the room floats in a void and reads as a screenshot of a
   *  renderer. With it the whole thing reads as a physical study model on a
   *  table, which is the entire premise: honest massing you can pick up and
   *  turn, not a failed photograph. It also catches the room's shadow, which
   *  is what actually sells the weight. */
  private buildPlinth(w: number, d: number) {
    // Just wide enough to read as a base and catch the shadow. Larger and the
    // room starts looking small on a runway.
    const size = Math.max(w, d) * 1.5;
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(size / 2, size / 2, 6, 96),
      new THREE.MeshStandardMaterial({
        color: colorOf("#171410"),
        roughness: 0.96,
        metalness: 0,
      }),
    );
    plinth.position.y = -11;
    plinth.receiveShadow = true;
    plinth.userData.isPlinth = true;
    this.shellGroup.add(plinth);

    // A hairline ring at the room's own footprint: a drawing on the model.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size / 2 - 2.2, size / 2, 96),
      new THREE.MeshBasicMaterial({
        color: this.accent,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -7.6;
    ring.userData.isPlinth = true;
    this.shellGroup.add(ring);
  }

  /* ---------------- room shell ---------------- */

  buildShell(scene: DesignScene, openings: WallOpening[]) {
    this.disposeGroup(this.shellGroup);
    this.wallMeshes = [];
    const { widthCm: w, depthCm: d, heightCm: h } = scene.room;
    this.roomW = w;
    this.roomD = d;
    this.roomH = h;
    this.accent = colorOf(cultureAccent(scene.culture));

    const floorSpec = getMaterial(scene.room.floorMaterialKey);
    const floorMat = new THREE.MeshStandardMaterial({
      color: colorOf(floorSpec.hex),
      roughness: floorSpec.roughness,
      metalness: floorSpec.metalness,
    });
    this.buildPlinth(w, d);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d), floorMat);
    floor.position.y = -4;
    floor.receiveShadow = true;
    floor.userData.isFloor = true;
    floor.userData.ade = ADE20K_FLOOR;
    this.floorMesh = floor;
    this.shellGroup.add(floor);

    // A metric grid, one line per 50cm. Reads as a drawing underlay and
    // silently communicates the scale of everything on it.
    const grid = new THREE.GridHelper(Math.max(w, d), Math.round(Math.max(w, d) / 50), 0x000000, 0x000000);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.07;
    grid.position.y = 0.6;
    this.shellGroup.add(grid);

    const wallSpec = getMaterial(scene.room.wallMaterialKey);
    const wallMat = new THREE.MeshStandardMaterial({
      color: colorOf(wallSpec.hex),
      roughness: wallSpec.roughness,
      metalness: 0,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });

    const t = 10;
    const defs: Array<{ w: number; h: number; d: number; pos: [number, number, number]; n: THREE.Vector3; id: WallOpening["wall"] }> = [
      { w, h, d: t, pos: [0, h / 2, -d / 2], n: new THREE.Vector3(0, 0, 1), id: "north" },
      { w, h, d: t, pos: [0, h / 2, d / 2], n: new THREE.Vector3(0, 0, -1), id: "south" },
      { w: t, h, d, pos: [-w / 2, h / 2, 0], n: new THREE.Vector3(1, 0, 0), id: "west" },
      { w: t, h, d, pos: [w / 2, h / 2, 0], n: new THREE.Vector3(-1, 0, 0), id: "east" },
    ];
    for (const def of defs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), wallMat.clone());
      mesh.position.set(...def.pos);
      mesh.receiveShadow = true;
      mesh.userData.wall = def.id;
      mesh.userData.ade = ADE20K_WALL;
      this.shellGroup.add(mesh);
      const entry = { mesh, normal: def.n, id: def.id, attachments: [] as THREE.Mesh[] };
      this.wallMeshes.push(entry);

      // Skirting. A 12cm band at the base of each wall, one step darker than
      // the wall itself. It costs one box per wall and it is most of what
      // separates "two planes meeting" from "a room that was built" — the
      // floor/wall junction is the line the eye actually reads for scale.
      const skirtH = 12;
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(
          def.id === "west" || def.id === "east" ? t + 2 : def.w,
          skirtH,
          def.id === "west" || def.id === "east" ? def.d : t + 2,
        ),
        new THREE.MeshStandardMaterial({
          color: colorOf(wallSpec.hex).multiplyScalar(0.72),
          roughness: 0.85,
          metalness: 0,
          transparent: true,
        }),
      );
      skirt.position.set(def.pos[0], skirtH / 2, def.pos[2]);
      skirt.receiveShadow = true;
      skirt.userData.ade = ADE20K_WALL;
      this.shellGroup.add(skirt);
      entry.attachments.push(skirt);
    }

    // Openings read off the photograph, drawn as recessed reveals on the wall
    // they projected nearest to. They are architecture, not furniture.
    for (const o of openings) {
      const rev = new THREE.Mesh(
        new THREE.BoxGeometry(o.widthCm, o.heightCm, 3),
        new THREE.MeshStandardMaterial({
          color: colorOf(o.kind === "door" ? "#2b2620" : "#cfe2ee"),
          roughness: 0.6,
          metalness: 0,
          emissive: colorOf(o.kind === "door" ? "#000000" : "#8fb8d4"),
          emissiveIntensity: o.kind === "door" ? 0 : 0.28,
        }),
      );
      const sill = o.kind === "door" ? o.heightCm / 2 : 95 + o.heightCm / 2;
      if (o.wall === "north" || o.wall === "south") {
        rev.position.set(-w / 2 + o.t * w, sill, (o.wall === "north" ? -1 : 1) * (d / 2 - 6));
      } else {
        rev.rotation.y = Math.PI / 2;
        rev.position.set((o.wall === "west" ? -1 : 1) * (w / 2 - 6), sill, -d / 2 + o.t * d);
      }
      (rev.material as THREE.Material).transparent = true;
      rev.userData.ade = o.kind === "door" ? ADE20K_DOOR : ADE20K_WINDOW;
      this.shellGroup.add(rev);
      this.wallMeshes.find((x) => x.id === o.wall)?.attachments.push(rev);
    }

    this.key.target.position.set(0, 0, 0);
    this.targetTarget.set(0, Math.min(90, h * 0.3), 0);
    this.markDirty();
  }

  /* ---------------- objects ---------------- */

  syncObjects(objects: PlacedObject[], selectedUid: string | null) {
    const seen = new Set<string>();
    for (const o of objects) {
      seen.add(o.uid);
      const existing = this.objectIndex.get(o.uid);
      // Split into what the geometry depends on and what only the transform
      // does. Moving a sofa one centimetre used to dispose and rebuild every
      // box it is made of, once per pointermove — survivable for five boxes,
      // ruinous for a loaded model. Position and rotation are a matrix write.
      const geoSig = `${o.category}|${o.origin}|${o.materialKey}|${o.widthCm}|${o.depthCm}|${o.heightCm}`;
      const xformSig = `${o.x}|${o.z}|${o.rotationDeg}|${o.locked}`;
      if (existing && existing.userData.geoSig === geoSig) {
        if (existing.userData.xformSig !== xformSig) {
          existing.position.set(o.x, 0, o.z);
          existing.rotation.y = (o.rotationDeg * Math.PI) / 180;
          existing.userData.xformSig = xformSig;
        }
        continue;
      }
      if (existing) {
        this.objectGroup.remove(existing);
        this.disposeObject(existing);
        this.objectIndex.delete(o.uid);
      }
      const mesh = buildObjectMesh(o, () => this.markDirty());
      mesh.userData.geoSig = geoSig;
      mesh.userData.xformSig = xformSig;
      this.objectGroup.add(mesh);
      this.objectIndex.set(o.uid, mesh);
    }
    for (const [uid, mesh] of Array.from(this.objectIndex.entries())) {
      if (!seen.has(uid)) {
        this.objectGroup.remove(mesh);
        this.disposeObject(mesh);
        this.objectIndex.delete(uid);
      }
    }
    this.setSelection(objects.find((o) => o.uid === selectedUid) ?? null);
    this.markDirty();
  }

  /** Hide/show the massing read off the photograph. Purely presentational —
   *  the objects stay in the scene, stay in the plan and keep colliding, so
   *  turning the layer off never quietly changes what a placement means. */
  setFoundVisible(visible: boolean) {
    let changed = false;
    this.objectIndex.forEach((mesh) => {
      if (mesh.userData.origin === "found" && mesh.visible !== visible) {
        mesh.visible = visible;
        changed = true;
      }
    });
    if (changed) this.markDirty();
  }

  /* ---------------- selection ---------------- */

  private setSelection(o: PlacedObject | null) {
    if (this.selectionCage) {
      this.helperGroup.remove(this.selectionCage);
      this.selectionCage.geometry.dispose();
      (this.selectionCage.material as THREE.Material).dispose();
      this.selectionCage = null;
    }
    if (this.selectionRing) {
      this.helperGroup.remove(this.selectionRing);
      this.selectionRing.geometry.dispose();
      (this.selectionRing.material as THREE.Material).dispose();
      this.selectionRing = null;
    }
    if (!o) return;

    // A wireframe cage rather than a glow: this is a drawing instrument, and
    // an architect's selection is a measured box, not a video-game aura.
    const box = new THREE.BoxGeometry(o.widthCm + 3, o.heightCm + 3, o.depthCm + 3);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const cage = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: this.accent, transparent: true, opacity: 0.95 }),
    );
    cage.position.set(o.x, o.heightCm / 2, o.z);
    cage.rotation.y = (o.rotationDeg * Math.PI) / 180;
    this.helperGroup.add(cage);
    this.selectionCage = cage;

    // Floor ring: shows the footprint that collision actually uses.
    const r = Math.max(o.widthCm, o.depthCm) * 0.62;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 2.4, 56),
      new THREE.MeshBasicMaterial({
        color: this.accent,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(o.x, 1.6, o.z);
    this.helperGroup.add(ring);
    this.selectionRing = ring;
  }

  /* ---------------- ghost + guides ---------------- */

  /** The translucent preview shown while dragging from the catalogue or
   *  moving a piece. Green-ish when it may land, red when it may not — the
   *  colour is driven by the same evaluatePlacement the drop uses. */
  setGhost(o: PlacedObject | null, tone: "ok" | "advisory" | "blocked") {
    if (this.ghost) {
      this.helperGroup.remove(this.ghost);
      this.disposeObject(this.ghost);
      this.ghost = null;
    }
    if (!o) {
      this.markDirty();
      return;
    }
    const g = buildObjectMesh(o);
    const tint = colorOf(tone === "ok" ? "#5fbf8a" : tone === "advisory" ? "#e0aa4a" : "#e05c48");
    g.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.material = new THREE.MeshStandardMaterial({
          color: tint,
          transparent: true,
          opacity: 0.42,
          roughness: 0.8,
          depthWrite: false,
        });
      }
      if (c instanceof THREE.PointLight) c.intensity = 0;
    });
    // Footprint plate — the honest thing being tested is the plan rectangle.
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(o.widthCm, o.depthCm),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 2;
    g.add(plate);
    this.helperGroup.add(g);
    this.ghost = g;
    this.markDirty();
  }

  setGuides(guides: Array<{ axis: "x" | "z"; at: number }>) {
    this.disposeGroup(this.guideGroup);
    for (const g of guides) {
      const mat = new THREE.LineBasicMaterial({ color: this.accent, transparent: true, opacity: 0.75 });
      const half = (g.axis === "x" ? this.roomD : this.roomW) / 2;
      const pts =
        g.axis === "x"
          ? [new THREE.Vector3(g.at, 2.4, -half), new THREE.Vector3(g.at, 2.4, half)]
          : [new THREE.Vector3(-half, 2.4, g.at), new THREE.Vector3(half, 2.4, g.at)];
      this.guideGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    this.markDirty();
  }

  /* ---------------- picking ---------------- */

  private setPointer(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pickObject(clientX: number, clientY: number): string | null {
    this.setPointer(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.objectGroup.children, true);
    for (const h of hits) {
      const uid = h.object.userData.uid as string | undefined;
      if (uid) return uid;
    }
    return null;
  }

  /** Where the pointer meets the floor plane, in room space. Returns null
   *  when the ray is parallel to the floor (grazing camera angles). */
  pickFloor(clientX: number, clientY: number): { x: number; z: number } | null {
    this.setPointer(clientX, clientY);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.floorPlane, hit);
    if (!ok) return null;
    return { x: hit.x, z: hit.z };
  }

  /* ---------------- camera ---------------- */

  orbit(dxPx: number, dyPx: number) {
    this.targetSph.theta -= dxPx * 0.0055;
    this.targetSph.phi = THREE.MathUtils.clamp(this.targetSph.phi - dyPx * 0.0045, MIN_PHI, MAX_PHI);
    this.markDirty();
  }

  zoom(delta: number) {
    const min = 220;
    const max = Math.max(this.roomW, this.roomD) * 2.6;
    this.targetSph.radius = THREE.MathUtils.clamp(this.targetSph.radius * (1 + delta * 0.0014), min, max);
    this.markDirty();
  }

  pan(dxPx: number, dyPx: number) {
    // Pan in the camera's own screen plane, then clamp the target inside the
    // room so the model can never be lost off-screen.
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.getWorldDirection(right);
    right.cross(this.camera.up).normalize();
    up.copy(this.camera.up).normalize();
    const k = this.sph.radius * 0.0016;
    this.targetTarget.addScaledVector(right, -dxPx * k);
    this.targetTarget.addScaledVector(up, dyPx * k * 0.6);
    const hw = this.roomW * 0.6;
    const hd = this.roomD * 0.6;
    this.targetTarget.x = THREE.MathUtils.clamp(this.targetTarget.x, -hw, hw);
    this.targetTarget.z = THREE.MathUtils.clamp(this.targetTarget.z, -hd, hd);
    this.targetTarget.y = THREE.MathUtils.clamp(this.targetTarget.y, 0, this.roomH);
    this.markDirty();
  }

  /** Distance at which the room's own corners fill `fill` of the viewport.
   *
   *  A fixed multiple of the room span cannot work here: the stage is a wide
   *  letterbox between the top bar and the dock, so the vertical field is the
   *  binding constraint and a room framed for a square viewport ends up
   *  marooned in the middle of a very wide frame. This projects the eight
   *  corners of the room volume at a trial distance and scales by whichever
   *  axis overflows first, which is correct at any aspect ratio. */
  private fitRadius(phi: number, theta: number, fill = 0.86): number {
    const hw = this.roomW / 2;
    const hd = this.roomD / 2;
    const h = this.roomH;
    const target = new THREE.Vector3(0, Math.min(90, h * 0.3), 0);

    const trial = Math.max(this.roomW, this.roomD, h) * 2;
    const sinPhi = Math.sin(phi);
    const eye = new THREE.Vector3(
      target.x + trial * sinPhi * Math.cos(theta),
      target.y + trial * Math.cos(phi),
      target.z + trial * sinPhi * Math.sin(theta),
    );
    const probe = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 1, 1e5);
    probe.position.copy(eye);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    probe.updateProjectionMatrix();

    let maxAbsX = 1e-6;
    let maxAbsY = 1e-6;
    for (const x of [-hw, hw]) {
      for (const z of [-hd, hd]) {
        for (const y of [0, h]) {
          const p = new THREE.Vector3(x, y, z).project(probe);
          maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
          maxAbsY = Math.max(maxAbsY, Math.abs(p.y));
        }
      }
    }
    // NDC scales ~linearly with 1/distance, so one probe gives the answer.
    const overflow = Math.max(maxAbsX, maxAbsY) / fill;
    return THREE.MathUtils.clamp(trial * overflow, 200, 12000);
  }

  setView(preset: ViewPreset) {
    let phi: number;
    let theta: number;
    let fill: number;
    if (preset === "plan") {
      phi = MIN_PHI;
      theta = -Math.PI / 2;
      fill = 0.92;
    } else if (preset === "corner") {
      // Low and close: standing in the doorway, not hovering over the model.
      phi = 1.24;
      theta = -2.42;
      fill = 1.16;
    } else {
      // Lower than a floor-plan bird's eye: the room should read as a space
      // you could walk into, not a diagram you hover above.
      phi = 1.06;
      theta = -0.72;
      fill = 1.0;
    }
    this.targetSph = { radius: this.fitRadius(phi, theta, fill), phi, theta };
    this.targetTarget.set(0, Math.min(90, this.roomH * 0.3), 0);
    this.markDirty();
  }

  frameRoom() {
    this.setView("perspective");
    // No easing on first frame: the room should already be framed when the
    // editor appears, not glide in from an arbitrary starting distance.
    this.sph = { ...this.targetSph };
    this.target.copy(this.targetTarget);
  }

  /** Ease the camera to look at one object without changing the orbit feel. */
  focusOn(o: PlacedObject) {
    this.targetTarget.set(o.x, o.heightCm * 0.5, o.z);
    this.targetSph.radius = Math.min(this.targetSph.radius, Math.max(280, Math.max(o.widthCm, o.depthCm) * 4));
    this.markDirty();
  }

  /* ---------------- loop ---------------- */

  private markDirty() {
    this.dirty = true;
    this.settleFrames = 90;
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    // Critically-damped-ish easing. 0.16 is the value where a drag feels
    // attached to the cursor but a view change still reads as a move.
    const k = 0.16;
    const before = this.sph.radius + this.sph.phi + this.sph.theta + this.target.lengthSq();
    this.sph.radius += (this.targetSph.radius - this.sph.radius) * k;
    this.sph.phi += (this.targetSph.phi - this.sph.phi) * k;
    this.sph.theta += (this.targetSph.theta - this.sph.theta) * k;
    this.target.lerp(this.targetTarget, k);
    const after = this.sph.radius + this.sph.phi + this.sph.theta + this.target.lengthSq();

    if (Math.abs(after - before) > 1e-4) this.settleFrames = Math.max(this.settleFrames, 2);
    if (!this.dirty && this.settleFrames <= 0) return;
    this.settleFrames--;
    this.dirty = false;

    const sinPhi = Math.sin(this.sph.phi);
    this.camera.position.set(
      this.target.x + this.sph.radius * sinPhi * Math.cos(this.sph.theta),
      this.target.y + this.sph.radius * Math.cos(this.sph.phi),
      this.target.z + this.sph.radius * sinPhi * Math.sin(this.sph.theta),
    );
    this.camera.lookAt(this.target);

    this.cullWalls();
    this.renderer.render(this.scene, this.camera);
  }

  /** Fade whichever walls sit between the camera and the room. */
  private cullWalls() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    for (const { mesh, normal, attachments } of this.wallMeshes) {
      const facing = normal.dot(dir);
      // facing > 0 means the wall's inward normal points away from the
      // camera, i.e. we are looking at its back — fade it out.
      const want = facing > 0.02 ? 0.045 : 1;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.opacity += (want - m.opacity) * 0.18;
      m.transparent = m.opacity < 0.99;
      m.depthWrite = m.opacity > 0.6;
      for (const a of attachments) {
        const am = a.material as THREE.MeshStandardMaterial;
        am.opacity = m.opacity;
        am.depthWrite = m.depthWrite;
        a.visible = m.opacity > 0.08;
      }
      if (Math.abs(want - m.opacity) > 0.01) this.settleFrames = Math.max(this.settleFrames, 2);
    }
  }

  /* ---------------- conditioning capture ---------------- */

  /** Render the designed scene into the two images the generation pipeline
   *  already conditions on.
   *
   *  This is the whole trick behind "Render with DAR". backend/transform.py
   *  runs SDXL with a dual ControlNet — Depth Anything depth plus an
   *  ADE20K-palette OneFormer segmentation map — and normally derives both
   *  from the user's photograph. Those two images ARE the layout signal. So
   *  instead of describing the design in a prompt and hoping, we hand the
   *  pipeline depth and segmentation rendered from the actual scene the user
   *  built. Geometry, placement, orientation and viewpoint stop being
   *  something the model has to infer and become something it is conditioned
   *  on, because they are drawn into its control inputs.
   *
   *  Conventions are matched deliberately to the annotators being replaced:
   *  depth is brighter-nearer (Depth Anything's output, and what DepthOrbit
   *  already assumes), and segmentation uses the exact ADE20K-150 palette the
   *  seg ControlNet was trained on — a near-miss colour is not a near-miss
   *  class, it is a different class or none at all.
   */
  renderConditioning(width: number, height: number): {
    depth: string;
    seg: string;
    beauty: string;
    meta: { width: number; height: number; near: number; far: number; fov: number };
  } {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // ---- the capture camera stands INSIDE the room, at eye level ----
    //
    // This used to clone the on-screen orbit camera: outside the room, ~30
    // degrees above horizontal, 38mm-equivalent. That is a doll's house — an
    // open-topped box seen from above and outside. SDXL and both ControlNets
    // were trained on interior photographs made from inside rooms at eye
    // height with a wide lens, so every capture handed them a viewpoint no
    // camera could occupy, and the render came back reading as a model of a
    // room rather than a room. Layout was honoured; believability was not.
    //
    // So the capture no longer borrows the editor's viewpoint. It keeps the
    // one thing that carries the user's intent — the azimuth, i.e. which way
    // they were facing — and replaces elevation, position and lens with a
    // human standing in the room. The editor camera is untouched; only what
    // the generator is shown changes.
    const cam = this.camera.clone() as THREE.PerspectiveCamera;
    cam.aspect = width / height;
    cam.fov = CAPTURE_FOV_DEG;

    // Stand with your back to the wall the orbit camera was on, so you face
    // the same part of the room the user was looking at.
    const dirX = Math.cos(this.sph.theta);
    const dirZ = Math.sin(this.sph.theta);
    const halfW = this.roomW / 2;
    const halfD = this.roomD / 2;
    // Distance from centre to the wall along that ray, then step off it.
    const reachX = Math.abs(dirX) > 1e-4 ? halfW / Math.abs(dirX) : Infinity;
    const reachZ = Math.abs(dirZ) > 1e-4 ? halfD / Math.abs(dirZ) : Infinity;
    const maxStand = Math.min(reachX, reachZ) - CAPTURE_WALL_CLEARANCE;
    const minStand = Math.min(halfW, halfD) * 0.35;
    const eyeY = Math.min(CAPTURE_EYE_Y, this.roomH - 40);

    // A person does not stand inside the sofa. Placing the lens at a fixed
    // distance off the wall works in an empty room and fails the moment the
    // room is furnished: with a planned majlis the seating runs along exactly
    // the wall the camera backs onto, so the capture ended up embedded in a
    // piece of furniture and one slatted screen filled the entire frame.
    //
    // Walk in from the wall and stop at the first spot that is neither inside
    // a piece nor pressed right up against one, judged against the objects'
    // own world bounds. If the room is too full for any such spot the old
    // wall-hugging position stands, which is no worse than before.
    const solids: THREE.Box3[] = [];
    this.objectIndex.forEach((mesh) => {
      const b = new THREE.Box3().setFromObject(mesh);
      if (Number.isFinite(b.min.x) && b.max.y > 12) solids.push(b);
    });
    const clearAt = (s: number): boolean => {
      const px = this.target.x + s * dirX;
      const pz = this.target.z + s * dirZ;
      for (const b of solids) {
        if (
          px > b.min.x - CAPTURE_BODY_CM &&
          px < b.max.x + CAPTURE_BODY_CM &&
          pz > b.min.z - CAPTURE_BODY_CM &&
          pz < b.max.z + CAPTURE_BODY_CM
        ) {
          return false;
        }
      }
      return true;
    };
    let standOff = Math.max(maxStand, minStand);
    for (let s = maxStand; s >= minStand; s -= 15) {
      if (clearAt(s)) {
        standOff = s;
        break;
      }
    }

    cam.position.set(
      this.target.x + standOff * dirX,
      eyeY,
      this.target.z + standOff * dirZ,
    );
    // Level enough to keep verticals from converging the way a tilted lens
    // would, but aimed a little below the eye so the floor and the furniture
    // standing on it carry the frame rather than bare wall.
    cam.lookAt(this.target.x, eyeY * 0.74, this.target.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // Depth range spans the room as seen from inside it, so the 8-bit ramp is
    // spent between the lens and the far corner instead of on approach space.
    const near = 10;
    const far =
      Math.hypot(this.roomW, this.roomD, this.roomH) + CAPTURE_WALL_CLEARANCE;

    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D) => {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    };
    // Editor furniture is not part of the room.
    hide(this.helperGroup);
    hide(this.guideGroup);
    for (const c of this.shellGroup.children) {
      if (c instanceof THREE.GridHelper) hide(c);
      if (c.userData.isPlinth) hide(c);
    }
    // Found massing is deliberately KEPT: it is furniture physically present
    // in the room, so it belongs in the layout the renderer is conditioned on
    // even when the user has toggled its display off.
    const restoredFound: THREE.Object3D[] = [];
    this.objectIndex.forEach((mesh) => {
      if (mesh.userData.origin === "found" && !mesh.visible) {
        mesh.visible = true;
        restoredFound.push(mesh);
      }
    });

    // Every wall stays. The old exterior camera had to hide the two walls it
    // was looking through, which handed the generator a room with holes where
    // its corners belonged — a large share of the frame unconstrained, and
    // unconstrained pixels are pixels SDXL invents. From inside, the wall at
    // the lens's back is simply behind the camera, so the frame closes itself
    // and all four surfaces condition normally. cullWalls()' on-screen fade is
    // a display state and is deliberately not consulted here.
    //
    // The maquette has no ceiling — correct on screen, wrong from inside,
    // where an open top reads as sky and takes the top of the frame with it.
    // A capture-only ceiling in the real ADE20K ceiling class closes the room
    // for the segmentation ControlNet and is removed again below.
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(this.roomW, 8, this.roomD),
      // Lit from above by the room's own lights, its underside would render
      // black in the beauty pass and read as a hole rather than a ceiling.
      // The emissive term is cosmetic — the depth and segmentation passes
      // replace this material outright and never see it.
      new THREE.MeshStandardMaterial({
        color: 0xf2ede4,
        roughness: 0.95,
        emissive: 0x6f6a63,
      }),
    );
    ceiling.position.set(0, this.roomH + 4, 0);
    ceiling.userData.ade = ADE20K_CEILING;
    this.shellGroup.add(ceiling);

    // cullWalls() fades the near walls in place, every frame, on the material
    // itself. The comment above says the on-screen fade is not consulted here,
    // but nothing actually undid it — so a capture taken from the usual view
    // handed the generator two walls at opacity 0.045 and their skirtings and
    // reveals switched off entirely. Force every wall solid for the capture.
    const wallState = this.wallMeshes.map(({ mesh, attachments }) => {
      const m = mesh.material as THREE.MeshStandardMaterial;
      const prev = { m, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      m.opacity = 1;
      m.transparent = false;
      m.depthWrite = true;
      const atts = attachments.map((a) => {
        const am = a.material as THREE.MeshStandardMaterial;
        const p = { a, am, opacity: am.opacity, depthWrite: am.depthWrite, visible: a.visible };
        am.opacity = 1;
        am.depthWrite = true;
        a.visible = true;
        return p;
      });
      return { prev, atts };
    });

    const prevTarget = this.renderer.getRenderTarget();
    const prevBg = this.scene.background;
    const prevTone = this.renderer.toneMapping;
    const prevExposure = this.renderer.toneMappingExposure;
    const prevEncoding = this.renderer.outputEncoding;
    const prevClear = this.renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = this.renderer.getClearAlpha();
    // A background would be drawn over the clear colour and straight into the
    // depth and segmentation maps. Nothing sets one today, but the time-of-day
    // sky must never reach conditioning, so it is nulled here rather than left
    // as an implicit precondition.
    this.scene.background = null;

    /** @param encode true only for the beauty pass. three r150 forces
     *  outputEncoding to Linear for any non-XR render target (three.cjs:19458),
     *  so a captured colour pass comes back linear no matter what the renderer
     *  is set to — visibly darker than the same scene on screen. Depth and
     *  segmentation want exactly those raw linear bytes, so only the beauty
     *  pass is transfer-encoded, and it is done here rather than by setting
     *  outputEncoding, which is a no-op in a render target. */
    const readToDataUrl = (encode = false): string => {
      const buf = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, buf);
      const cv = document.createElement("canvas");
      cv.width = width;
      cv.height = height;
      const ctx = cv.getContext("2d")!;
      const img = ctx.createImageData(width, height);
      // WebGL reads bottom-up; canvas ImageData is top-down.
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * rowBytes;
        img.data.set(buf.subarray(src, src + rowBytes), y * rowBytes);
      }
      if (encode) {
        const lut = SRGB_LUT();
        const px = img.data;
        for (let i = 0; i < px.length; i += 4) {
          px[i] = lut[px[i]];
          px[i + 1] = lut[px[i + 1]];
          px[i + 2] = lut[px[i + 2]];
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL("image/png");
    };

    // ---- 1. beauty pass (the maquette itself, for the comparison) ----
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x0f0f14, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const beauty = readToDataUrl(true);

    // Conditioning is DATA, not a picture. ACES tone mapping plus sRGB output
    // is exactly right for the beauty pass above and exactly wrong here: it
    // moved wall grey 120 to 129 and lamp yellow (224,255,8) to (187,189,40),
    // and the seg ControlNet reads a shifted colour as a different class or no
    // class at all. Depth wants its linear ramp intact for the same reason.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputEncoding = THREE.LinearEncoding;

    // ---- 2. depth pass ----
    const depthMat = new THREE.ShaderMaterial({
      uniforms: { uNear: { value: near }, uFar: { value: far } },
      vertexShader: `
        varying float vViewDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uNear;
        uniform float uFar;
        varying float vViewDepth;
        void main() {
          float t = clamp((vViewDepth - uNear) / max(uFar - uNear, 0.0001), 0.0, 1.0);
          float v = 1.0 - t;            // brighter = closer, matching Depth Anything
          gl_FragColor = vec4(v, v, v, 1.0);
        }`,
    });
    this.scene.overrideMaterial = depthMat;
    // Black = infinitely far, so unpainted background reads as "not the room".
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const depth = readToDataUrl();
    this.scene.overrideMaterial = null;
    depthMat.dispose();

    // ---- 3. segmentation pass ----
    // Per-object colour, so overrideMaterial cannot be used; swap and restore.
    const swapped: Array<{ mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }> = [];
    const segMatCache = new Map<number, THREE.MeshBasicMaterial>();
    const segMat = (classId: number) => {
      let m = segMatCache.get(classId);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: ade20kHex(classId), fog: false });
        segMatCache.set(classId, m);
      }
      return m;
    };
    // One rule, applied to everything that draws: a MESH carrying a class id
    // is painted in that class; anything else is hidden.
    //
    // Both halves matter. The old loops tested `instanceof THREE.Mesh`, which a
    // Line is not, so found-object wireframes were neither repainted nor
    // hidden — and `buildObjectMesh` stamps `userData.ade` on every descendant,
    // so the wireframe even had a class id and would survive a naive
    // "hide the unclassified" pass too. Measured: LineBasicMaterial 0x8d857a at
    // opacity 0.5 over wall (120,120,120) produced (131,127,121), and over sofa
    // (11,102,255) produced (76,118,188). An off-palette colour is not a
    // near-miss class to the seg ControlNet, it is no class at all.
    //
    // Only a surface can state a class. Lines, points and sprites are drawing
    // annotations, and the solid volume beneath each one already paints the
    // correct class, so hiding them loses nothing.
    const unclassified: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const d = o as THREE.Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
      };
      if (!(d.isMesh || d.isLine || d.isPoints || d.isSprite)) return;
      const cls = o.userData.ade;
      if (d.isMesh && typeof cls === "number") {
        const mesh = o as THREE.Mesh;
        swapped.push({ mesh, mat: mesh.material });
        mesh.material = segMat(cls);
        return;
      }
      o.visible = false;
      unclassified.push(o);
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const seg = readToDataUrl();

    for (const u of unclassified) u.visible = true;
    for (const s of swapped) s.mesh.material = s.mat;
    segMatCache.forEach((m) => m.dispose());

    // ---- restore ----
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTone;
    this.renderer.toneMappingExposure = prevExposure;
    this.renderer.outputEncoding = prevEncoding;
    // The seg pass leaves the clear colour at opaque black. That was never put
    // back, so after one "Render with DAR" the canvas — created with
    // alpha: true precisely so the CSS backdrop shows through — cleared to
    // solid black for the rest of the session.
    this.renderer.setClearColor(prevClear, prevClearAlpha);
    this.scene.background = prevBg;
    for (const { prev, atts } of wallState) {
      prev.m.opacity = prev.opacity;
      prev.m.transparent = prev.transparent;
      prev.m.depthWrite = prev.depthWrite;
      for (const p of atts) {
        p.am.opacity = p.opacity;
        p.am.depthWrite = p.depthWrite;
        p.a.visible = p.visible;
      }
    }
    for (const o of hidden) o.visible = true;
    for (const o of restoredFound) o.visible = false;
    this.shellGroup.remove(ceiling);
    ceiling.geometry.dispose();
    (ceiling.material as THREE.Material).dispose();
    rt.dispose();
    this.markDirty();

    return {
      depth,
      seg,
      beauty,
      meta: { width, height, near, far, fov: cam.fov },
    };
  }

  /* ---------------- teardown ---------------- */

  private disposeObject(o: THREE.Object3D) {
    // Tells an in-flight model load that its group is gone, so the swap does
    // not resurrect children into a detached object.
    o.userData.disposed = true;
    o.traverse((c) => {
      // Clones of a loaded asset SHARE the prototype's geometry and materials
      // with every other instance of that model. Freeing them here would blank
      // out the ottoman standing on the other side of the room.
      if (c.userData.sharedAsset) return;
      // Lines and points own geometry and materials exactly as meshes do. Only
      // Mesh was handled here, so the grid, the selection cage, the snap guides
      // and every found-object wireframe leaked on each rebuild.
      const d = c as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (!d.geometry && !d.material) return;
      d.geometry?.dispose();
      const mat = d.material;
      if (!mat) return;
      // Shared cache materials must survive; only clones are disposed.
      if (Array.isArray(mat)) mat.forEach((x) => disposeUnshared(x));
      else disposeUnshared(mat);
    });
  }

  private disposeGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      this.disposeObject(c);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.disposeGroup(this.shellGroup);
    this.disposeGroup(this.objectGroup);
    this.disposeGroup(this.helperGroup);
    this.disposeGroup(this.guideGroup);
    this.objectIndex.clear();
    this.renderer.dispose();
  }
}

/** Frees a material unless it is one of the shared cache instances that other
 *  live objects are still drawing with. Also releases any maps it owns, which
 *  a bare dispose() does not do. */
function disposeUnshared(m: THREE.Material) {
  if ((m as THREE.Material & { __shared?: boolean }).__shared) return;
  for (const slot of ["map", "normalMap", "roughnessMap", "aoMap", "metalnessMap", "emissiveMap", "alphaMap"] as const) {
    const tex = (m as unknown as Record<string, unknown>)[slot];
    if (tex instanceof THREE.Texture) tex.dispose();
  }
  m.dispose();
}

/** Marks the shared cache materials so disposeObject leaves them alone. */
export function protectSharedMaterials(keys: string[]) {
  for (const k of keys) {
    (standardMaterial(k) as THREE.Material & { __shared?: boolean }).__shared = true;
  }
}
