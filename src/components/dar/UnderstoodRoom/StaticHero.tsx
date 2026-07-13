// Reduced-motion / no-WebGL fallback (spec §1 rule 5): the title, the three
// portal cards, and the studio CTA as plain DOM. Never a blank page.

import Link from "next/link";
import { COPY } from "./copy";

export default function StaticHero() {
  return (
    <div className="ur-root ur-hero" dir="rtl">
      {/* Cinematic grain + vignette (grain animation freezes under reduced-motion) */}
      <div className="ur-grain" aria-hidden="true" />
      <div className="ur-vignette" aria-hidden="true" />
      <div className="ur-hero-inner">
        <div className="ur-eyebrow">
          <span className="ur-eyebrow-ar">{COPY.s1.eyebrowAr}</span> ·{" "}
          {COPY.s1.eyebrowEn}
        </div>
        <h1 className="ur-h1">{COPY.s1.h1}</h1>
        <div className="ur-sub">{COPY.s1.sub}</div>
        <p className="ur-lines">
          {COPY.s1.line1}
          <br />
          {COPY.s1.line2}
        </p>
        <div className="ur-line-en">{COPY.s1.lineEn}</div>

        <div className="ur-hero-cards">
          {COPY.s2.portals.map((portal) => (
            <div className="ur-card" key={portal.en}>
              <div className="ur-card-ar">{portal.ar}</div>
              <div className="ur-card-en">{portal.en}</div>
              <div className="ur-card-detail">{portal.detail}</div>
            </div>
          ))}
        </div>

        <Link href="/studio" className="ur-cta">
          <span className="ur-cta-ar">{COPY.s5.doorAr}</span>
          <span className="ur-cta-en">{COPY.s5.doorEn}</span>
        </Link>

        <div className="ur-hero-closing">
          <div>{COPY.s5.closing1}</div>
          <div className="ur-hero-closing-sub">{COPY.s5.closing2}</div>
        </div>
      </div>
    </div>
  );
}
