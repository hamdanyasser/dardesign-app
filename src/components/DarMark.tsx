"use client";

/**
 * The DarDesign mark — a threshold arch, drawn once and reused.
 *
 * Why an arch and not a monogram: "dar" (دار) is a house, and the doorway is
 * the one architectural element this project already treats as its signature —
 * the landing's first act is literally العتبة, the threshold. It is also
 * *qanater*, the Levantine triple-arch, rather than a generic Islamic star,
 * which keeps it a building rather than decoration. A "DD" lozenge said
 * nothing that the wordmark beside it was not already saying.
 *
 * Two arches, the same shape at two scales, sharing one floor: the room you
 * walk into and the room DAR reads inside it. That is the product's whole
 * argument, and it is the same nesting the threshold tunnel animates.
 *
 * The geometry was chosen by drawing four variants and rendering each at
 * 12/16/22/32/48/88px on both grounds, because a logo fails at its SMALLEST
 * use and every variant looks fine at 88. What that showed:
 *
 *  - a floor line at the same y as the feet merges with them below ~16px and
 *    the mark bottoms out into a solid blob. The ground line therefore sits
 *    BELOW the feet, so the two can never touch. It also reads as a section
 *    drawing, which is the A3 technical-editorial language this app already
 *    speaks.
 *  - the inner niche has to be small and lifted, or the negative space either
 *    side of it closes against the legs at 16px.
 *  - a literal qanater (three arches, the ontology's own Lebanese motif) is
 *    the most distinctive option at 88px and turns into a comb at 16. Kept as
 *    a large-format option, not as the mark.
 *
 * Other rules:
 *  - 32u grid, ~3u safe margin, so it never clips;
 *  - strokes 2.2-2.4u with round joins — thinner greys out on a projector,
 *    the same failure the palette work chased out of the hairlines;
 *  - the inner niche is SOLID, so the mark survives when the outline collapses;
 *  - everything paints `currentColor`, so it inherits whatever it sits on and
 *    cannot drift from the theme the way a hardcoded hex would.
 */
export default function DarMark({
  size = 34,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {/* outer arch — the room you walk into */}
      <path
        d="M6.5 24V13.5a9.5 9.5 0 0 1 19 0V24"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* inner niche — the room DAR reads inside it */}
      <path d="M13.6 24v-5a2.4 2.4 0 0 1 4.8 0v5z" fill="currentColor" />
      {/* ground line, clear of the feet on purpose — see the note above */}
      <path
        d="M3.5 28h25"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
