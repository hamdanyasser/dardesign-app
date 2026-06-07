"use client";

/* ============================================================
   Boot Scene — opens with calligraphic "ادخل" then doors part.
   Ported from dar-design-2 (jsx/boot.jsx).
   ============================================================ */

import { useEffect, useState } from "react";
import { useCinemaCopy } from "@/components/cinema/copy";
import { usePrefersReducedMotion } from "@/components/cinema/hooks";
import DustLayer from "@/components/cinema/DustLayer";

interface BootProps {
  onDone: () => void;
}

export default function Boot({ onDone }: BootProps) {
  const [opening, setOpening] = useState(false);
  const copy = useCinemaCopy().boot;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => onDone(), 250);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setOpening(true), 3300);
    const t2 = setTimeout(() => onDone(), 4900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone, reduced]);

  return (
    <div className={"boot" + (opening ? " opening" : "")}>
      <div className="doors">
        <div className="door"></div>
        <div className="door"></div>
      </div>
      <DustLayer count={30} seed={3} />
      <div className="core">
        <div className="calligraphy">{copy.calligraphy}</div>
        <div className="english">{copy.english}</div>
      </div>
      <div className="progress"></div>
    </div>
  );
}
