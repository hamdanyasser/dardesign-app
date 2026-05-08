"use client";

/** Composes the seven-act Atelier scrollytelling. Mounted by /atelier/page.tsx
 *  inside a `.atelier-page` wrapper so the heavy custom CSS is scoped. */

import { useRef } from "react";
import { ActKhaleeji, ActLebanese, ActMoroccan, ActsOverture } from "./acts";
import { Alchemy, Atlas, Coda, Manifesto } from "./content";
import { CursorAndChrome, useActLabel, useReveal, useScrollProgress } from "./effects";
import { Interlude, Morpher } from "./extras";
import { ArchTunnel, Colophon, Palette, ZelligeAssembler } from "./finale";
import { Hero } from "./hero";
import { CinemaIntro, CursorTrail } from "./intro";

export default function AtelierApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress();
  const act = useActLabel();
  useReveal();

  return (
    <div className="atelier-page" ref={rootRef}>
      <CinemaIntro />
      <CursorTrail />
      <CursorAndChrome progress={progress} act={act} rootRef={rootRef} />
      <Hero />
      <Manifesto />
      <Interlude
        kicker="An interlude"
        line='A house is a <em>language</em>.<br/>An interior is a <em>dialect</em>.'
        arabic="البيت لسان · والداخل لهجة"
        anchor="Interlude"
      />
      <Morpher />
      <ArchTunnel />
      <ActsOverture />
      <ActLebanese />
      <ActKhaleeji />
      <ActMoroccan />
      <Interlude
        kicker="Between the houses"
        line='Three suns. Three <em>silences</em>.<br/>One <em>door</em> between them.'
        arabic="ثلاث شموس · باب واحد"
        anchor="Interlude"
      />
      <Palette />
      <ZelligeAssembler />
      <Alchemy />
      <Atlas />
      <Colophon />
      <Coda />
    </div>
  );
}
