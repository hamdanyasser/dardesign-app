"use client";

import { useEffect } from "react";
import { OrnamentScene } from "@/lib/three/ornamentScene";
import type { OrnamentVariant } from "@/lib/three/types";
import { cn } from "@/lib/utils";
import { useScene } from "./hooks";
import { StaticStar } from "./svg/Fallbacks";

interface OrnamentCanvasProps {
  variant: OrnamentVariant;
  starSize?: number;
  className?: string;
}

/**
 * The shared morphing eight-pointed-star ornament. Mounts once and
 * morphs material/colour across cultures via setVariant.
 */
export default function OrnamentCanvas({
  variant,
  starSize = 0.95,
  className,
}: OrnamentCanvasProps) {
  const { containerRef, handleRef, suppressed } = useScene(OrnamentScene, {
    variant,
    starSize,
    enableAmbientDust: true,
  });

  useEffect(() => {
    if (!suppressed) handleRef.current?.setVariant?.(variant);
  }, [variant, suppressed, handleRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn(className)}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {suppressed && <StaticStar variant={variant} />}
    </div>
  );
}
