/* Shared types for the cinematic Three.js scenes. */

export interface SceneHandle {
  setProgress?: (p: number) => void;
  setMouse: (x: number, y: number) => void;
  setVariant?: (name: string) => void;
  resize: () => void;
  destroy: () => void;
}

export interface ArchSceneOpts {
  archColor?: number;
  bgColor?: number | null;
  dustCount?: number;
  cameraZStart?: number;
  cameraZEnd?: number;
  enableMashrabiya?: boolean;
  ambient?: number;
  offsetX?: number;
  angle?: number;
  fogColor?: number;
  fogNear?: number;
  fogFar?: number;
}

export type OrnamentVariant = "lebanese" | "khaleeji" | "moroccan";

export interface OrnamentSceneOpts {
  variant?: OrnamentVariant;
  enableAmbientDust?: boolean;
  starSize?: number;
}

export interface DissolveSceneOpts {
  count?: number;
  color?: number;
  bgColor?: number | null;
}
