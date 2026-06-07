"use client";

import { useEffect } from "react";
import { DissolveScene } from "@/lib/three/dissolveScene";
import { cn } from "@/lib/utils";
import { useScene } from "./hooks";
import { StaticArch } from "./svg/Fallbacks";

interface DissolveCanvasProps {
  /** 0..1 — particles assemble into the arch as this approaches 1. */
  progress: number;
  count?: number;
  color?: number;
  className?: string;
}

/** Gold-particle dissolve that assembles into a pointed arch as progress→1. */
export default function DissolveCanvas({
  progress,
  count = 4000,
  color = 0xf0d78c,
  className,
}: DissolveCanvasProps) {
  const { containerRef, handleRef, suppressed } = useScene(DissolveScene, { count, color });

  useEffect(() => {
    if (!suppressed) handleRef.current?.setProgress?.(progress);
  }, [progress, suppressed, handleRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn(className)}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {suppressed && <StaticArch opacity={0.2 + progress * 0.6} />}
    </div>
  );
}
