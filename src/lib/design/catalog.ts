/* ============================================================
   DAR Build Mode — catalogue

   Reads `ontology/furniture.json` directly. That file is already the
   single source of truth for the backend's recommendation ranking and
   placement scoring, so the editor deliberately does not keep its own
   copy of dimensions or cultural tags: an item added to the ontology
   appears here with no code change, and can never disagree with what
   the placement endpoints believe.
   ============================================================ */

import furnitureOntology from "../../../ontology/furniture.json";
import type { StyleId } from "@/context/ImageContext";
import { materialForTags } from "./materials";
import type { CatalogItem, SceneCulture } from "./types";

interface RawItem {
  id: string;
  culture: string;
  category: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  asset: string;
  real_width_cm: number;
  real_height_cm: number;
  real_depth_cm: number;
  must_touch_wall: boolean;
  preferred_zones: string[];
  cultural_tags: string[];
  material_tags: string[];
  color_tags: string[];
}

const RAW = (furnitureOntology as { items: RawItem[]; version: string }).items;

export const CATALOG_VERSION = (furnitureOntology as { version: string }).version;

export const CATALOG: CatalogItem[] = RAW.map((r) => ({
  id: r.id,
  culture: r.culture as StyleId,
  category: r.category,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  descriptionEn: r.description_en,
  descriptionAr: r.description_ar,
  widthCm: r.real_width_cm,
  depthCm: r.real_depth_cm,
  heightCm: r.real_height_cm,
  mustTouchWall: r.must_touch_wall,
  preferredZones: r.preferred_zones,
  culturalTags: r.cultural_tags,
  materialTags: r.material_tags,
  colorTags: r.color_tags,
  assetUrl: "/" + r.asset,
}));

const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

/** Items for a culture. `all` returns the whole catalogue, grouped so the
 *  three design languages stay legible rather than being shuffled together. */
export function catalogFor(culture: SceneCulture): CatalogItem[] {
  if (culture === "all") return CATALOG;
  return CATALOG.filter((c) => c.culture === culture);
}

/** Canonical category order — seating first, then tables, then light, then
 *  the objects that carry the most cultural specificity. This is the order
 *  a room actually gets designed in, not alphabetical. */
export const CATEGORY_ORDER = [
  "sofa",
  "chair",
  "ottoman",
  "coffee_table",
  "side_table",
  "lamp",
  "lantern",
  "cultural_object",
];

export const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  sofa: { en: "Seating", ar: "مجالس" },
  chair: { en: "Chairs", ar: "كراسي" },
  ottoman: { en: "Poufs", ar: "مقاعد منخفضة" },
  coffee_table: { en: "Low tables", ar: "طاولات منخفضة" },
  side_table: { en: "Side tables", ar: "طاولات جانبية" },
  lamp: { en: "Lighting", ar: "إضاءة" },
  lantern: { en: "Lanterns", ar: "فوانيس" },
  cultural_object: { en: "Objects", ar: "مقتنيات" },
};

export function categoryLabel(cat: string, isArabic: boolean): string {
  const l = CATEGORY_LABEL[cat];
  if (l) return isArabic ? l.ar : l.en;
  return cat.replace(/_/g, " ");
}

export function sortByCategory(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) => {
    const d = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return d !== 0 ? d : a.widthCm - b.widthCm;
  });
}

/** The default material for a catalogue item, from its own ontology tags. */
export function defaultMaterialFor(item: CatalogItem): string {
  const fallback = item.category === "lamp" || item.category === "lantern" ? "brass" : "cedar";
  return materialForTags(item.materialTags, fallback);
}

export const CULTURE_LABEL: Record<SceneCulture, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  all: { en: "All three", ar: "الثلاثة" },
};
