/* ============================================================
   DAR Build Mode — scene store

   A reducer over a plain serializable scene, wrapped in a snapshot-based
   history. Deliberately not a state library: the whole store is one
   useReducer plus localStorage, so there is no new runtime dependency and
   the scene shape stays the same object that gets persisted and will one
   day be posted to a render endpoint.

   HISTORY MODEL. Every mutating action pushes the PREVIOUS scene onto an
   undo stack with a label. Continuous gestures (dragging, scrubbing a
   rotation) must not push one entry per animation frame, so they are
   coalesced: the gesture opens with `beginGesture`, mutates freely, and
   the single entry is the state from before the gesture started.
   ============================================================ */

"use client";

import { catalogItem, defaultMaterialFor } from "./catalog";
import { findSpot } from "./placement";
import { SCENE_VERSION, type DesignScene, type HistoryEntry, type PlacedObject } from "./types";

const HISTORY_LIMIT = 60;
const STORAGE_PREFIX = "dar-scene-v3";

export interface DesignState {
  scene: DesignScene;
  selectedUid: string | null;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  /** Set while a drag/scrub is in flight so we coalesce into one entry. */
  gesture: { scene: DesignScene; labelEn: string; labelAr: string } | null;
  /** Bumped whenever the scene changes in a way the renderer must rebuild. */
  revision: number;
}

export type DesignAction =
  | { type: "add"; catalogId: string }
  | { type: "addAt"; catalogId: string; x: number; z: number; rotationDeg?: number }
  | { type: "select"; uid: string | null }
  | { type: "beginGesture"; labelEn: string; labelAr: string }
  | { type: "endGesture" }
  | { type: "move"; uid: string; x: number; z: number }
  | { type: "rotate"; uid: string; rotationDeg: number }
  | { type: "setMaterial"; uid: string; materialKey: string }
  | { type: "setLocked"; uid: string; locked: boolean }
  | { type: "duplicate"; uid: string }
  | { type: "remove"; uid: string }
  | { type: "setShellMaterial"; surface: "floor" | "wall"; materialKey: string }
  | { type: "resizeRoom"; widthCm?: number; depthCm?: number }
  | { type: "clearPlaced" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "replace"; scene: DesignScene };

function uid(prefix = "obj"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function touch(scene: DesignScene): DesignScene {
  return { ...scene, updatedAt: Date.now() };
}

/** Push the pre-mutation scene onto the undo stack, unless a gesture already
 *  captured it — that is what keeps a 200-frame drag to a single undo. */
function withHistory(
  state: DesignState,
  next: DesignScene,
  labelEn: string,
  labelAr: string,
): DesignState {
  if (state.gesture) {
    return { ...state, scene: touch(next), revision: state.revision + 1 };
  }
  const undo = [...state.undo, { scene: state.scene, labelEn, labelAr }].slice(-HISTORY_LIMIT);
  return { ...state, scene: touch(next), undo, redo: [], revision: state.revision + 1 };
}

function mapObject(
  scene: DesignScene,
  uidToChange: string,
  fn: (o: PlacedObject) => PlacedObject,
): DesignScene {
  return { ...scene, objects: scene.objects.map((o) => (o.uid === uidToChange ? fn(o) : o)) };
}

export function designReducer(state: DesignState, action: DesignAction): DesignState {
  switch (action.type) {
    case "select":
      return state.selectedUid === action.uid ? state : { ...state, selectedUid: action.uid };

    case "beginGesture":
      // Re-entrant begins are ignored so a nested gesture cannot lose the
      // original pre-gesture snapshot.
      if (state.gesture) return state;
      return {
        ...state,
        gesture: { scene: state.scene, labelEn: action.labelEn, labelAr: action.labelAr },
      };

    case "endGesture": {
      const g = state.gesture;
      if (!g) return state;
      // Nothing actually changed during the gesture → no history entry.
      if (g.scene === state.scene) return { ...state, gesture: null };
      const undo = [...state.undo, { scene: g.scene, labelEn: g.labelEn, labelAr: g.labelAr }].slice(
        -HISTORY_LIMIT,
      );
      return { ...state, gesture: null, undo, redo: [] };
    }

    case "add":
    case "addAt": {
      const item = catalogItem(action.catalogId);
      if (!item) return state;
      let x = 0;
      let z = 0;
      let rotationDeg = 0;
      if (action.type === "addAt") {
        x = action.x;
        z = action.z;
        rotationDeg = action.rotationDeg ?? 0;
      } else {
        const spot = findSpot(
          { widthCm: item.widthCm, depthCm: item.depthCm, heightCm: item.heightCm },
          item.mustTouchWall,
          item.preferredZones,
          state.scene.objects,
          state.scene.room,
        );
        // No free spot: still add it at the centre rather than silently doing
        // nothing. The invalid-placement affordance then explains the problem.
        x = spot?.x ?? 0;
        z = spot?.z ?? 0;
        rotationDeg = spot?.rotationDeg ?? 0;
      }
      const obj: PlacedObject = {
        uid: uid(item.category),
        origin: "catalog",
        catalogId: item.id,
        category: item.category,
        labelEn: item.nameEn,
        labelAr: item.nameAr,
        x: Math.round(x),
        z: Math.round(z),
        rotationDeg,
        widthCm: item.widthCm,
        depthCm: item.depthCm,
        heightCm: item.heightCm,
        materialKey: defaultMaterialFor(item),
      };
      const next = { ...state.scene, objects: [...state.scene.objects, obj] };
      return {
        ...withHistory(state, next, `add ${item.nameEn}`, `إضافة ${item.nameAr}`),
        selectedUid: obj.uid,
      };
    }

    case "move": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o || o.locked) return state;
      if (o.x === action.x && o.z === action.z) return state;
      const next = mapObject(state.scene, action.uid, (v) => ({ ...v, x: action.x, z: action.z }));
      return withHistory(state, next, `move ${o.labelEn}`, `تحريك ${o.labelAr}`);
    }

    case "rotate": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o || o.locked) return state;
      const r = ((action.rotationDeg % 360) + 360) % 360;
      if (o.rotationDeg === r) return state;
      const next = mapObject(state.scene, action.uid, (v) => ({ ...v, rotationDeg: r }));
      return withHistory(state, next, `rotate ${o.labelEn}`, `تدوير ${o.labelAr}`);
    }

    case "setMaterial": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o || o.materialKey === action.materialKey) return state;
      const next = mapObject(state.scene, action.uid, (v) => ({ ...v, materialKey: action.materialKey }));
      return withHistory(state, next, `restyle ${o.labelEn}`, `تغيير خامة ${o.labelAr}`);
    }

    case "setLocked": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o) return state;
      const next = mapObject(state.scene, action.uid, (v) => ({ ...v, locked: action.locked }));
      return withHistory(
        state,
        next,
        action.locked ? `lock ${o.labelEn}` : `unlock ${o.labelEn}`,
        action.locked ? `قفل ${o.labelAr}` : `فتح ${o.labelAr}`,
      );
    }

    case "duplicate": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o) return state;
      const spot = findSpot(
        { widthCm: o.widthCm, depthCm: o.depthCm, heightCm: o.heightCm },
        false,
        ["open_floor"],
        state.scene.objects,
        state.scene.room,
      );
      const copy: PlacedObject = {
        ...o,
        uid: uid(o.category),
        // A duplicate is a new design decision even when the original was a
        // locked reading of the photograph, so it is unlocked and authored.
        origin: "catalog",
        locked: false,
        confidence: undefined,
        x: spot?.x ?? o.x + 40,
        z: spot?.z ?? o.z + 40,
      };
      const next = { ...state.scene, objects: [...state.scene.objects, copy] };
      return {
        ...withHistory(state, next, `duplicate ${o.labelEn}`, `تكرار ${o.labelAr}`),
        selectedUid: copy.uid,
      };
    }

    case "remove": {
      const o = state.scene.objects.find((v) => v.uid === action.uid);
      if (!o) return state;
      const next = { ...state.scene, objects: state.scene.objects.filter((v) => v.uid !== action.uid) };
      return {
        ...withHistory(state, next, `remove ${o.labelEn}`, `حذف ${o.labelAr}`),
        selectedUid: null,
      };
    }

    case "setShellMaterial": {
      const key = action.surface === "floor" ? "floorMaterialKey" : "wallMaterialKey";
      if (state.scene.room[key] === action.materialKey) return state;
      const next = { ...state.scene, room: { ...state.scene.room, [key]: action.materialKey } };
      return withHistory(
        state,
        next,
        action.surface === "floor" ? "change floor" : "change walls",
        action.surface === "floor" ? "تغيير الأرضية" : "تغيير الجدران",
      );
    }

    case "resizeRoom": {
      const room = {
        ...state.scene.room,
        ...(action.widthCm != null ? { widthCm: action.widthCm } : {}),
        ...(action.depthCm != null ? { depthCm: action.depthCm } : {}),
      };
      if (room.widthCm === state.scene.room.widthCm && room.depthCm === state.scene.room.depthCm) {
        return state;
      }
      // Resizing invalidates a measured shell: it is now the user's number,
      // not DAR's, and the provenance chip must stop claiming otherwise.
      const next = {
        ...state.scene,
        room: { ...room, areaM2: (room.widthCm * room.depthCm) / 10000 },
        provenance: { ...state.scene.provenance, shellSource: "default" as const },
      };
      return withHistory(state, next, "resize room", "تغيير أبعاد الغرفة");
    }

    case "clearPlaced": {
      const kept = state.scene.objects.filter((o) => o.origin === "found");
      if (kept.length === state.scene.objects.length) return state;
      const next = { ...state.scene, objects: kept };
      return { ...withHistory(state, next, "clear design", "مسح التصميم"), selectedUid: null };
    }

    case "undo": {
      const prev = state.undo[state.undo.length - 1];
      if (!prev) return state;
      return {
        ...state,
        scene: prev.scene,
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, { scene: state.scene, labelEn: prev.labelEn, labelAr: prev.labelAr }],
        selectedUid: prev.scene.objects.some((o) => o.uid === state.selectedUid)
          ? state.selectedUid
          : null,
        revision: state.revision + 1,
      };
    }

    case "redo": {
      const nxt = state.redo[state.redo.length - 1];
      if (!nxt) return state;
      return {
        ...state,
        scene: nxt.scene,
        redo: state.redo.slice(0, -1),
        undo: [...state.undo, { scene: state.scene, labelEn: nxt.labelEn, labelAr: nxt.labelAr }],
        selectedUid: nxt.scene.objects.some((o) => o.uid === state.selectedUid)
          ? state.selectedUid
          : null,
        revision: state.revision + 1,
      };
    }

    case "replace":
      return {
        scene: action.scene,
        selectedUid: null,
        undo: [],
        redo: [],
        gesture: null,
        revision: state.revision + 1,
      };

    default:
      return state;
  }
}

export function initialState(scene: DesignScene): DesignState {
  return { scene, selectedUid: null, undo: [], redo: [], gesture: null, revision: 0 };
}

/* ---------- persistence ---------- */

function storageKey(jobId: string | null): string {
  return `${STORAGE_PREFIX}:${jobId ?? "sandbox"}`;
}

export function saveScene(scene: DesignScene): void {
  try {
    localStorage.setItem(storageKey(scene.provenance.jobId), JSON.stringify(scene));
  } catch {
    /* quota or private mode — the editor keeps working, it just won't restore */
  }
}

export function loadScene(jobId: string | null): DesignScene | null {
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DesignScene;
    // A scene from an older model is dropped rather than migrated blindly;
    // reconstructing it from the result is cheap and always correct.
    if (parsed?.version !== SCENE_VERSION || !Array.isArray(parsed.objects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSavedScene(jobId: string | null): void {
  try {
    localStorage.removeItem(storageKey(jobId));
  } catch {
    /* ignore */
  }
}
