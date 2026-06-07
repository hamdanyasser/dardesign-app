"use client";

import { useEffect } from "react";
import { ArchScene } from "@/lib/three/archScene";
import type { ArchSceneOpts } from "@/lib/three/types";
import { cn } from "@/lib/utils";
import { useScene } from "./hooks";
import { StaticArch } from "./svg/Fallbacks";

interface ArchCanvasProps {
  opts?: ArchSceneOpts;
  /** 0..1 dolly progress, applied via setProgress. */
  progress?: number;
  /** Re-mount the scene when any of these change (e.g. [isArabic]). */
  resetKey?: ReadonlyArray<unknown>;
  className?: string;
  fallbackOpacity?: number;
}

/** Full-bleed Three.js qanater-arch canvas with a static SVG fallback. */
export default function ArchCanvas({
  opts = {},
  progress,
  resetKey = [],
  className,
  fallbackOpacity = 0.5,
}: ArchCanvasProps) {
  const { containerRef, handleRef, suppressed } = useScene(ArchScene, opts, resetKey);

  useEffect(() => {
    if (!suppressed && progress != null) handleRef.current?.setProgress?.(progress);
  }, [progress, suppressed, handleRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn(className)}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {suppressed && <StaticArch opacity={fallbackOpacity} />}
    </div>
  );
}
