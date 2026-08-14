/* ============================================================
   DAR Build Mode — procedural ornament

   The patterned surfaces of these three cultures are geometric constructions,
   not photographs, so they are DRAWN rather than downloaded. That is not a
   compromise: zellige really is a compass-and-straightedge tessellation, and
   generating it means the cobalt is the ontology's own cobalt, the tile size
   is a real tile size, and there is no licence attached to any of it.

   The precedent is already in this repo — the landing page draws its act
   materials as inline-SVG tessellations (`tile()` in DarCinema) after a
   `repeating-linear-gradient` rug read as a barcode and a 46px conic-gradient
   read as harlequin argyle. Same lesson here: a pattern has to be constructed
   the way the craft constructs it or it reads as wallpaper.

   Colours come from `ontology/ontology.json`'s per-culture `color_palette`,
   the same source materials.ts draws on — cobalt Majorelle #0040c0 is in this
   file because the Moroccan profile says so.

   Vocabulary, from ontology/sources.md:
     zellige      Moroccan cobalt tile tessellation (Aga Khan Documentation Centre)
     encaustic    Lebanese/Levantine cement floor tile (Beirut Heritage Foundation)
     sadu         Khaleeji woven bands (Sheikh Mohammed Centre)
     gypsumFret   Najdi carved gypsum, "jus" (Saudi Ministry of Culture)
     mashrabiya   Levantine turned-wood screen (Aga Khan Trust)
   ============================================================ */

import * as THREE from "three";

export type PatternKey = "zellige" | "encaustic" | "sadu" | "gypsumFret" | "mashrabiya";

/** One canvas per pattern, shared by every surface using it. */
const cache = new Map<string, THREE.CanvasTexture>();

/** Texture resolution. 512 is enough: these are flat-colour geometric fills
 *  with hard edges, so the cost is in the edges, not the pixels. */
const PX = 512;

function canvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  // Guarded because the module graph is evaluated during the server build even
  // though /design is a client component.
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = PX;
  cv.height = PX;
  const ctx = cv.getContext("2d");
  return ctx ? { cv, ctx } : null;
}

/* ---------------- the constructions ---------------- */

/** Zellige: the 8-pointed star (khatam) tessellation.
 *
 *  Built the way the craft builds it — a square and the same square rotated
 *  45 degrees — rather than by drawing a star glyph. The landing page learned
 *  this the hard way: a literal 5-pointed star reads as a flag emblem, not as
 *  tessellation. Grout lines are drawn last so every piece is separated, which
 *  is most of what makes cut tile read as cut tile. */
function drawZellige(ctx: CanvasRenderingContext2D) {
  const n = 4;                       // 4 x 4 stars across the tile
  const c = PX / n;
  ctx.fillStyle = "#0040c0";         // moroccan · cobalt Majorelle blue
  ctx.fillRect(0, 0, PX, PX);

  const square = (cx: number, cy: number, r: number, rot: number, fill: string) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = fill;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  };

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = (x + 0.5) * c;
      const cy = (y + 0.5) * c;
      // The star: two overlapping squares, 45 degrees apart.
      square(cx, cy, c * 0.3, 0, "#e2d6bf");            // ivory tadelakt
      square(cx, cy, c * 0.3, Math.PI / 4, "#e2d6bf");
      // Saffron centre — the small cut piece at the heart of the khatam.
      square(cx, cy, c * 0.11, Math.PI / 4, "#e3a92f"); // saffron yellow
      // Corner fillers, so the ground reads as cut tile rather than as gaps.
      square(cx + c / 2, cy + c / 2, c * 0.12, Math.PI / 4, "#e2d6bf");
    }
  }

  // Grout.
  ctx.strokeStyle = "rgba(20,24,34,0.34)";
  ctx.lineWidth = Math.max(1, PX / 340);
  for (let i = 0; i <= n; i++) {
    const p = i * c;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, PX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(PX, p); ctx.stroke();
  }
}

/** Encaustic cement tile: the Beirut floor. A bordered square with a
 *  four-petal geometric motif — terracotta and deep green on cream, which is
 *  the palette these floors actually use. */
function drawEncaustic(ctx: CanvasRenderingContext2D) {
  const n = 2;
  const c = PX / n;
  ctx.fillStyle = "#d8c9ad";
  ctx.fillRect(0, 0, PX, PX);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ox = x * c;
      const oy = y * c;
      ctx.save();
      ctx.translate(ox, oy);

      // border
      ctx.strokeStyle = "#8f4f2e";
      ctx.lineWidth = c * 0.045;
      ctx.strokeRect(c * 0.06, c * 0.06, c * 0.88, c * 0.88);

      // four petals meeting at the centre
      ctx.fillStyle = "#8f4f2e";
      const r = c * 0.30;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(c / 2, c / 2);
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r, -r * 0.55, 0, -r * 1.25);
        ctx.quadraticCurveTo(-r, -r * 0.55, 0, 0);
        ctx.fill();
        ctx.restore();
      }

      // centre boss + corner dots
      ctx.fillStyle = "#4a5b3f";
      ctx.beginPath(); ctx.arc(c / 2, c / 2, c * 0.075, 0, Math.PI * 2); ctx.fill();
      for (const [dx, dy] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        ctx.beginPath(); ctx.arc(c * dx, c * dy, c * 0.035, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}

/** Sadu: Bedouin weaving. Horizontal bands of triangles and diamonds in the
 *  red / black / cream the tradition uses, drawn as bands because sadu is a
 *  warp-faced weave — the pattern runs in stripes, it does not tile freely. */
function drawSadu(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#8a1f1f";          // khaleeji · sadu deep red
  ctx.fillRect(0, 0, PX, PX);

  const bands = 8;
  const h = PX / bands;
  for (let b = 0; b < bands; b++) {
    const y = b * h;
    if (b % 2 === 0) {
      ctx.fillStyle = "#1d1a17";
      ctx.fillRect(0, y, PX, h * 0.5);
      // Cream triangles along the band — the classic sadu sawtooth.
      ctx.fillStyle = "#e6dcc6";
      const steps = 16;
      const w = PX / steps;
      for (let i = 0; i < steps; i++) {
        ctx.beginPath();
        ctx.moveTo(i * w, y + h * 0.5);
        ctx.lineTo(i * w + w / 2, y + h * 0.16);
        ctx.lineTo(i * w + w, y + h * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // Thin cream rule + diamonds
      ctx.fillStyle = "#e6dcc6";
      ctx.fillRect(0, y + h * 0.62, PX, h * 0.10);
      ctx.fillStyle = "#b08a3e";
      const steps = 10;
      const w = PX / steps;
      for (let i = 0; i < steps; i++) {
        const cx = i * w + w / 2;
        const cy = y + h * 0.32;
        const r = h * 0.16;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        ctx.closePath(); ctx.fill();
      }
    }
  }
}

/** Carved gypsum (jus): Najdi plaster relief. Rows of stepped triangles cut
 *  into a cream ground. Drawn nearly tonally — this is carving, so what the
 *  eye reads is shadow, not colour. */
function drawGypsumFret(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#e6dcc6";
  ctx.fillRect(0, 0, PX, PX);

  const rows = 6;
  const h = PX / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const steps = 12;
    const w = PX / steps;
    for (let i = 0; i < steps; i++) {
      const flip = (r + i) % 2 === 0;
      const x = i * w;
      // recessed triangle: mid tone with a darker lower edge for the undercut
      ctx.fillStyle = "#cfc3a8";
      ctx.beginPath();
      if (flip) {
        ctx.moveTo(x, y + h * 0.15); ctx.lineTo(x + w, y + h * 0.15); ctx.lineTo(x + w / 2, y + h * 0.85);
      } else {
        ctx.moveTo(x + w / 2, y + h * 0.15); ctx.lineTo(x + w, y + h * 0.85); ctx.lineTo(x, y + h * 0.85);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(90,78,58,0.5)";
      ctx.lineWidth = Math.max(1, PX / 420);
      ctx.stroke();
    }
  }
}

/** Mashrabiya: the turned-wood screen lattice, as a mask.
 *
 *  White is timber, black is the opening. Used as an alphaMap so light and the
 *  room behind actually come through the screen — a screen that is not
 *  see-through is a wall, and the openwork is the entire point of the piece. */
function drawMashrabiya(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, PX, PX);
  ctx.fillStyle = "#ffffff";

  const n = 6;
  const c = PX / n;
  const bar = c * 0.17;

  // Lattice of interlocking octagons: draw the timber, leave the voids black.
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const cx = x * c;
      const cy = y * c;
      // the turned "bead" at each crossing
      ctx.beginPath();
      ctx.arc(cx, cy, bar * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // diagonal ribs both ways -> the classic interlaced diamond grille
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = bar;
  for (let i = -n; i <= n * 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * c, 0);
    ctx.lineTo(i * c + PX, PX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * c, PX);
    ctx.lineTo(i * c + PX, 0);
    ctx.stroke();
  }
}

const DRAW: Record<PatternKey, (ctx: CanvasRenderingContext2D) => void> = {
  zellige: drawZellige,
  encaustic: drawEncaustic,
  sadu: drawSadu,
  gypsumFret: drawGypsumFret,
  mashrabiya: drawMashrabiya,
};

/** The tessellation for `key`, drawn once and shared.
 *  Returns null during SSR, where callers keep their flat colour. */
export function pattern(key: PatternKey): THREE.CanvasTexture | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = canvas();
  if (!made) return null;

  DRAW[key](made.ctx);
  const tex = new THREE.CanvasTexture(made.cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // three 0.150 predates Texture.colorSpace; these carry colour, so sRGB.
  tex.encoding = key === "mashrabiya" ? THREE.LinearEncoding : THREE.sRGBEncoding;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function disposePatterns() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
