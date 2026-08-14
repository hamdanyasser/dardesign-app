"use client";

/* ============================================================
   DAR Build Mode — interaction surface

   Owns every pointer and key gesture and translates them into store
   actions. The 3D world (DesignWorld) is told what to draw; it never
   decides anything. That split is what lets placement rules live in one
   module and be identical for the ghost, the drop and the inspector.

   Gesture model, chosen so nothing needs a modifier to do the common thing:

     drag empty space      orbit
     drag an object        move it on the floor plane
     wheel                 zoom
     middle / space / shift+drag   pan
     click object          select     ·  click empty  deselect
   ============================================================ */

import { useCallback, useEffect, useRef } from "react";
import { catalogItem, defaultMaterialFor } from "@/lib/design/catalog";
import { evaluatePlacement, rectOf, snapPosition, SNAP_ROTATION_DEG } from "@/lib/design/placement";
import type { WallOpening } from "@/lib/design/roomModel";
import type { TimeOfDay } from "@/lib/design/lighting";
import { DesignWorld, type ViewPreset } from "@/lib/design/scene3d";
import type { DesignScene, PlacedObject } from "@/lib/design/types";

export interface DragPayload {
  catalogId: string;
  clientX: number;
  clientY: number;
}

export interface DesignCanvasProps {
  scene: DesignScene;
  openings: WallOpening[];
  selectedUid: string | null;
  revision: number;
  /** Set while the user is dragging a card out of the catalogue. */
  dragPayload: DragPayload | null;
  onDropCatalog: (catalogId: string, x: number, z: number, rotationDeg: number) => void;
  onDragCancel: () => void;
  onSelect: (uid: string | null) => void;
  onMove: (uid: string, x: number, z: number) => void;
  onGestureStart: (labelEn: string, labelAr: string) => void;
  onGestureEnd: () => void;
  /** Reports whether the piece under the cursor may legally land there, so
   *  the surrounding UI can explain the refusal in words. */
  onValidity: (v: { ok: boolean; blocking: string[]; advisory: string[] } | null) => void;
  viewNonce: { preset: ViewPreset; n: number } | null;
  focusNonce: { uid: string; n: number } | null;
  /** "See the room as it is" vs "design it empty". Existing furniture read
   *  off the photograph is real information, but it is also the main thing
   *  in the way once you start composing — so it is a control, not a fact
   *  of the scene, and hiding it never deletes anything. */
  showFound: boolean;
  /** Which of the four lighting moments the room is seen under. A view
   *  setting: it never reaches the conditioning capture, which pins itself to
   *  a fixed daylight. */
  timeOfDay: TimeOfDay;
  /** Hands the page a way to capture ControlNet conditioning from the live
   *  scene. The world is owned here, but "Render with DAR" lives in the
   *  handoff panel, so the capture has to cross that boundary. */
  onReady?: (api: { capture: (w: number, h: number) => ReturnType<DesignWorld["renderConditioning"]> }) => void;
}

type Mode = "idle" | "orbit" | "pan" | "move";

export default function DesignCanvas({
  scene,
  openings,
  selectedUid,
  revision,
  dragPayload,
  onDropCatalog,
  onDragCancel,
  onSelect,
  onMove,
  onGestureStart,
  onGestureEnd,
  onValidity,
  viewNonce,
  focusNonce,
  showFound,
  timeOfDay,
  onReady,
}: DesignCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<DesignWorld | null>(null);
  const modeRef = useRef<Mode>("idle");
  const lastRef = useRef({ x: 0, y: 0 });
  const movingRef = useRef<{ uid: string; dx: number; dz: number } | null>(null);
  const spaceRef = useRef(false);
  const draggedRef = useRef(false);

  // Latest scene without re-binding listeners on every keystroke.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selRef = useRef(selectedUid);
  selRef.current = selectedUid;
  const dragRef = useRef(dragPayload);
  dragRef.current = dragPayload;
  /** Rotation applied to the catalogue ghost before it is dropped. */
  const ghostRotRef = useRef(0);

  /* ---------- mount ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = new DesignWorld(canvas);
    worldRef.current = world;
    // Dev-only handle. The conditioning capture is the one part of Build Mode
    // whose correctness cannot be judged from the UI — a wrong depth ramp or
    // an off-palette segmentation colour looks fine on screen and silently
    // ruins the render. Being able to pull the raw maps out in the console is
    // how that gets checked.
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __darWorld?: DesignWorld }).__darWorld = world;
    }
    const parent = canvas.parentElement!;
    const ro = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect();
      world.resize(Math.max(1, r.width), Math.max(1, r.height));
    });
    ro.observe(parent);
    const r0 = parent.getBoundingClientRect();
    world.resize(Math.max(1, r0.width), Math.max(1, r0.height));
    world.frameRoom();
    onReady?.({ capture: (w, h) => world.renderConditioning(w, h) });
    return () => {
      ro.disconnect();
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  /* ---------- shell rebuild ---------- */
  useEffect(() => {
    worldRef.current?.buildShell(scene, openings);
    // buildShell reads exactly these fields off the scene — the room box, both
    // surface materials and the culture accent — so they are the whole dep set.
    //
    // `scene` itself used to be listed too, and the reducer returns a fresh
    // scene object for every action, so the plinth, floor, grid, four walls,
    // four skirtings and every opening were torn down and rebuilt on each
    // dispatch — i.e. once per pointermove for the whole of a drag.
  }, [
    scene.room.widthCm,
    scene.room.depthCm,
    scene.room.heightCm,
    scene.room.floorMaterialKey,
    scene.room.wallMaterialKey,
    scene.culture,
    openings,
  ]);

  /* ---------- objects ---------- */
  useEffect(() => {
    worldRef.current?.syncObjects(scene.objects, selectedUid);
    worldRef.current?.setFoundVisible(showFound);
  }, [scene.objects, selectedUid, revision, showFound]);

  /* ---------- time of day ---------- */
  useEffect(() => {
    worldRef.current?.setTimeOfDay(timeOfDay);
  }, [timeOfDay]);

  /* ---------- imperative view commands ---------- */
  useEffect(() => {
    if (viewNonce) worldRef.current?.setView(viewNonce.preset);
  }, [viewNonce]);

  useEffect(() => {
    if (!focusNonce) return;
    const o = sceneRef.current.objects.find((v) => v.uid === focusNonce.uid);
    if (o) worldRef.current?.focusOn(o);
  }, [focusNonce]);

  /* ---------- helpers ---------- */

  const ghostFor = useCallback((catalogId: string, x: number, z: number, rot: number): PlacedObject | null => {
    const item = catalogItem(catalogId);
    if (!item) return null;
    return {
      uid: "__ghost__",
      origin: "catalog",
      catalogId: item.id,
      category: item.category,
      labelEn: item.nameEn,
      labelAr: item.nameAr,
      x,
      z,
      rotationDeg: rot,
      widthCm: item.widthCm,
      depthCm: item.depthCm,
      heightCm: item.heightCm,
      materialKey: defaultMaterialFor(item),
    };
  }, []);

  /** Shared by the catalogue ghost and the move gesture: snap, validate,
   *  draw guides, and report the verdict upward. One path, so what you see
   *  while dragging is exactly what the drop will do. */
  const previewAt = useCallback(
    (proto: PlacedObject, ignoreUid?: string) => {
      const world = worldRef.current;
      if (!world) return null;
      const s = sceneRef.current;
      const snapped = snapPosition(
        proto.x,
        proto.z,
        { widthCm: proto.widthCm, depthCm: proto.depthCm, rotationDeg: proto.rotationDeg },
        s.objects,
        s.room,
        ignoreUid,
      );
      const item = proto.catalogId ? catalogItem(proto.catalogId) : undefined;
      const verdict = evaluatePlacement(
        rectOf({ ...proto, x: snapped.x, z: snapped.z }),
        s.objects,
        s.room,
        { mustTouchWall: item?.mustTouchWall, heightCm: proto.heightCm },
        ignoreUid,
      );
      world.setGuides(snapped.guides);
      onValidity({ ok: verdict.ok, blocking: verdict.blocking, advisory: verdict.advisory });
      return { x: snapped.x, z: snapped.z, verdict };
    },
    [onValidity],
  );

  /* ---------- catalogue drag ---------- */
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    if (!dragPayload) {
      world.setGhost(null, "ok");
      world.setGuides([]);
      onValidity(null);
      ghostRotRef.current = 0;
      return;
    }
    const hit = world.pickFloor(dragPayload.clientX, dragPayload.clientY);
    if (!hit) return;
    const proto = ghostFor(dragPayload.catalogId, hit.x, hit.z, ghostRotRef.current);
    if (!proto) return;
    const res = previewAt(proto);
    if (!res) return;
    world.setGhost(
      { ...proto, x: res.x, z: res.z },
      res.verdict.ok ? (res.verdict.advisory.length ? "advisory" : "ok") : "blocked",
    );
  }, [dragPayload, ghostFor, previewAt, onValidity]);

  /* ---------- pointer ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = worldRef.current;
      if (!world) return;
      // Capture keeps a drag alive past the canvas edge. It throws if the
      // pointer id is not live (synthetic events, or a pointer already
      // released by the browser) — losing capture is survivable, an
      // exception mid-gesture is not.
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* continue without capture */
      }
      lastRef.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;

      if (e.button === 1 || e.shiftKey || spaceRef.current) {
        modeRef.current = "pan";
        return;
      }
      if (e.button !== 0) return;

      const uid = world.pickObject(e.clientX, e.clientY);
      if (uid) {
        const o = sceneRef.current.objects.find((v) => v.uid === uid);
        onSelect(uid);
        if (o && !o.locked) {
          const hit = world.pickFloor(e.clientX, e.clientY);
          if (hit) {
            movingRef.current = { uid, dx: o.x - hit.x, dz: o.z - hit.z };
            modeRef.current = "move";
            onGestureStart(`move ${o.labelEn}`, `تحريك ${o.labelAr}`);
            return;
          }
        }
        // Locked object: selecting is allowed, dragging is not. Fall through
        // to orbit so the gesture still does something sensible.
      }
      modeRef.current = "orbit";
    },
    [onSelect, onGestureStart],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = worldRef.current;
      if (!world) return;
      const dx = e.clientX - lastRef.current.x;
      const dy = e.clientY - lastRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) draggedRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };

      if (modeRef.current === "orbit") world.orbit(dx, dy);
      else if (modeRef.current === "pan") world.pan(dx, dy);
      else if (modeRef.current === "move" && movingRef.current) {
        const m = movingRef.current;
        const o = sceneRef.current.objects.find((v) => v.uid === m.uid);
        if (!o) return;
        const hit = world.pickFloor(e.clientX, e.clientY);
        if (!hit) return;
        const res = previewAt({ ...o, x: hit.x + m.dx, z: hit.z + m.dz }, o.uid);
        if (res) onMove(o.uid, Math.round(res.x), Math.round(res.z));
      }
    },
    [onMove, previewAt],
  );

  const endGesture = useCallback(() => {
    const world = worldRef.current;
    if (modeRef.current === "move") {
      onGestureEnd();
      world?.setGuides([]);
      onValidity(null);
    }
    modeRef.current = "idle";
    movingRef.current = null;
  }, [onGestureEnd, onValidity]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = worldRef.current;
      // Dropping a catalogue item takes priority over any camera gesture.
      const drag = dragRef.current;
      if (drag && world) {
        const hit = world.pickFloor(e.clientX, e.clientY);
        if (hit) {
          const proto = ghostFor(drag.catalogId, hit.x, hit.z, ghostRotRef.current);
          if (proto) {
            const res = previewAt(proto);
            if (res?.verdict.ok) {
              onDropCatalog(drag.catalogId, Math.round(res.x), Math.round(res.z), ghostRotRef.current);
            } else {
              onDragCancel();
            }
          }
        } else {
          onDragCancel();
        }
        world.setGhost(null, "ok");
        world.setGuides([]);
        onValidity(null);
        endGesture();
        return;
      }
      // A click that never moved on empty space clears the selection.
      if (modeRef.current === "orbit" && !draggedRef.current) {
        const uid = world?.pickObject(e.clientX, e.clientY) ?? null;
        if (!uid) onSelect(null);
      }
      endGesture();
    },
    [endGesture, ghostFor, onDragCancel, onDropCatalog, onSelect, onValidity, previewAt],
  );

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    worldRef.current?.zoom(e.deltaY);
  }, []);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
      // While a catalogue ghost is in flight, R spins it before it lands.
      if (dragRef.current && (e.key === "r" || e.key === "R")) {
        ghostRotRef.current = (ghostRotRef.current + (e.shiftKey ? -SNAP_ROTATION_DEG : SNAP_ROTATION_DEG) + 360) % 360;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none outline-none"
      style={{ cursor: modeRef.current === "move" ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      aria-label="Room model"
    />
  );
}
