/* ============================================================
   DAR Build Mode — material language

   Every colour here is taken from `ontology/ontology.json`'s own
   `color_palette` for that culture, or from the material tags the
   furniture ontology already assigns to each item. Nothing is invented
   to look nice: if a surface is cobalt it is cobalt because the Moroccan
   profile says "cobalt Majorelle blue #0040c0".

   The scene is deliberately a MAQUETTE, not a fake photograph. Objects
   are honest volumes in true material colours, the way an architect's
   study model is. That reads as a design instrument rather than as a
   failed attempt at photorealism — and it never implies DAR rendered
   something it did not.
   ============================================================ */

import type { StyleId } from "@/context/ImageContext";
import type { SceneCulture } from "./types";

export interface MaterialSpec {
  key: string;
  nameEn: string;
  nameAr: string;
  /** Base colour, straight from the ontology palette where one applies. */
  hex: string;
  roughness: number;
  metalness: number;
  /** Slight emissive lift for lamps/lanterns so they read as light sources. */
  glow?: number;
  /** Source note, surfaced in the inspector. Keeps provenance visible. */
  source: string;
}

function m(
  key: string,
  nameEn: string,
  nameAr: string,
  hex: string,
  roughness: number,
  metalness: number,
  source: string,
  glow?: number,
): MaterialSpec {
  return { key, nameEn, nameAr, hex, roughness, metalness, source, ...(glow ? { glow } : {}) };
}

/** The shared material vocabulary. Keys are stable and stored in scenes. */
export const MATERIALS: Record<string, MaterialSpec> = {
  /* stone + plaster */
  limestone: m("limestone", "Limestone", "حجر جيري", "#dccdb0", 0.92, 0, "lebanese · limestone cream"),
  tadelakt: m("tadelakt", "Tadelakt", "تادلاكت", "#e2d6bf", 0.78, 0, "moroccan · ivory tadelakt"),
  gypsum: m("gypsum", "Gypsum", "جبس", "#e6dcc6", 0.95, 0, "khaleeji · cream gypsum white"),
  sand: m("sand", "Desert sand", "رمل صحراوي", "#d9c39a", 0.9, 0, "khaleeji · desert sand"),
  marble: m("marble", "Marble", "رخام", "#e6e2d8", 0.28, 0.02, "khal-coffee-001 · marble"),
  // Deeper than the palette's own terracotta: a floor fills a third of the
  // frame and takes the key light almost square-on, so the swatch value that
  // looks right on a chip renders as pale peach across a whole floor plate.
  encaustic: m("encaustic", "Encaustic tile", "بلاط مزخرف", "#8f4f2e", 0.68, 0, "lebanese · encaustic floor tiles"),

  /* woods */
  cedar: m("cedar", "Cedar", "أرز", "#8a5a33", 0.75, 0, "lebanese · carved cedar wood"),
  walnut: m("walnut", "Walnut", "جوز", "#5c3a24", 0.7, 0, "leb-chair-001 · walnut"),
  boneInlay: m("boneInlay", "Bone inlay", "تطعيم عظمي", "#c9b48c", 0.6, 0, "mor-side-001 · bone_inlay"),

  /* metals */
  brass: m("brass", "Brass", "نحاس أصفر", "#b08a3e", 0.32, 0.85, "khaleeji · antique gold"),
  agedBrass: m("agedBrass", "Aged brass", "نحاس عتيق", "#8c6d33", 0.48, 0.7, "lebanese · aged brass fittings"),
  iron: m("iron", "Wrought iron", "حديد مطاوع", "#2f2b28", 0.55, 0.6, "lebanese · wrought iron"),

  /* textiles + leather */
  linen: m("linen", "Linen", "كتان", "#c9b99a", 0.98, 0, "leb-sofa-001 · linen"),
  velvet: m("velvet", "Velvet", "مخمل", "#8a1f1f", 0.99, 0, "khaleeji · sadu deep red"),
  leather: m("leather", "Leather", "جلد", "#9c6b3f", 0.72, 0, "mor-pouf-001 · leather"),
  wool: m("wool", "Kilim wool", "صوف كليم", "#a8442a", 0.99, 0, "moroccan · Marrakech terracotta"),

  /* ceramic + glass */
  zellige: m("zellige", "Zellige", "زليج", "#0040c0", 0.35, 0.05, "moroccan · cobalt Majorelle blue"),
  saffron: m("saffron", "Saffron glaze", "طلاء زعفراني", "#e3a92f", 0.4, 0.05, "moroccan · saffron yellow"),
  glass: m("glass", "Glass", "زجاج", "#cfd8d4", 0.1, 0.1, "khal-side-001 · glass"),

  /* light */
  lamplight: m("lamplight", "Lamplight", "ضوء المصباح", "#ffd9a0", 0.4, 0, "emissive · lamp shade", 0.85),

  /* the neutral used for objects read off the photograph */
  found: m("found", "Existing", "موجود", "#6d675e", 0.95, 0, "read from your photograph"),
};

/** Floor / wall defaults per culture, from that culture's own palette.
 *  Floor and wall are always DIFFERENT materials: a room whose floor and
 *  walls share one colour has no readable horizon and the whole model goes
 *  flat. The Lebanese pairing uses the profile's own encaustic floor tiles
 *  under limestone walls rather than limestone on limestone. */
export const SHELL_MATERIALS: Record<SceneCulture, { floor: string; wall: string }> = {
  lebanese: { floor: "encaustic", wall: "limestone" },
  khaleeji: { floor: "sand", wall: "gypsum" },
  moroccan: { floor: "zellige", wall: "tadelakt" },
  all: { floor: "cedar", wall: "gypsum" },
};

/** Accent colour per culture — used for selection, snap guides and the UI
 *  rail, so the whole editor visibly belongs to the chosen design language. */
export const CULTURE_ACCENT: Record<SceneCulture, string> = {
  lebanese: "#c45c2a",
  khaleeji: "#b08a3e",
  moroccan: "#0040c0",
  all: "#d4af37",
};

/** Map an ontology material tag onto our vocabulary. Ordered: the first tag
 *  that resolves wins, which matches how the ontology lists the dominant
 *  material first ("marble, brass, metal"). */
const TAG_TO_MATERIAL: Record<string, string> = {
  walnut: "walnut",
  cedar: "cedar",
  wood: "cedar",
  rush: "linen",
  linen: "linen",
  velvet: "velvet",
  fabric: "linen",
  leather: "leather",
  brass: "brass",
  metal: "agedBrass",
  iron: "iron",
  marble: "marble",
  limestone: "limestone",
  stone: "limestone",
  ceramic: "zellige",
  zellige: "zellige",
  glass: "glass",
  bone_inlay: "boneInlay",
};

export function materialForTags(tags: string[], fallback = "cedar"): string {
  for (const t of tags) {
    const hit = TAG_TO_MATERIAL[t];
    if (hit) return hit;
  }
  return fallback;
}

export function getMaterial(key: string): MaterialSpec {
  return MATERIALS[key] ?? MATERIALS.cedar;
}

/** Materials offered in the inspector for a given category. Restricted on
 *  purpose: a velvet lamp-post or a brass sofa is not a design choice, it is
 *  a mistake the UI should not make easy. */
export function materialChoicesFor(category: string): string[] {
  switch (category) {
    case "sofa":
    case "ottoman":
      return ["linen", "velvet", "leather", "wool"];
    case "chair":
      return ["walnut", "cedar", "linen", "leather"];
    case "coffee_table":
    case "side_table":
      return ["cedar", "walnut", "marble", "zellige", "brass", "boneInlay"];
    case "lamp":
    case "lantern":
      return ["brass", "agedBrass", "iron", "glass"];
    case "cultural_object":
      return ["brass", "agedBrass", "cedar", "zellige"];
    default:
      return ["cedar", "limestone", "brass", "linen"];
  }
}

/** Surface choices for the room shell itself, so "select a wall" is a real
 *  editing action rather than a decorative highlight. */
export const FLOOR_CHOICES = ["limestone", "encaustic", "tadelakt", "sand", "cedar", "zellige", "marble"];
export const WALL_CHOICES = ["limestone", "gypsum", "tadelakt", "sand"];

export function cultureAccent(culture: SceneCulture): string {
  return CULTURE_ACCENT[culture] ?? CULTURE_ACCENT.all;
}

export function isStyleId(c: SceneCulture): c is StyleId {
  return c !== "all";
}
