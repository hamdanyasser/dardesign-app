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
import furnitureModels from "../../../ontology/furniture_models.json";
import type { StyleId } from "@/context/ImageContext";
import { materialForCulture } from "./materials";
import type { CatalogItem, CatalogModel, ModelTier, SceneCulture } from "./types";

interface RawItem {
  id: string;
  culture: string;
  category: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  asset: string;
  placement_type: string;
  room_types: string[];
  real_width_cm: number;
  real_height_cm: number;
  real_depth_cm: number;
  /** [width, depth]. Typed loosely because a JSON import infers `number[]`,
   *  not a tuple; narrowed once, below, rather than asserted at every use. */
  floor_footprint_cm: number[];
  must_touch_wall: boolean;
  must_stand_on_floor: boolean;
  preferred_zones: string[];
  cultural_tags: string[];
  material_tags: string[];
  color_tags: string[];
}

const RAW = (furnitureOntology as { items: RawItem[]; version: string }).items;

/** 3D provenance, from the sidecar. Deliberately a separate file — see the
 *  `_note` in furniture_models.json. */
const MODELS = (furnitureModels as { models: Record<string, CatalogModel> }).models;

export const CATALOG_VERSION = (furnitureOntology as { version: string }).version;
export const MODELS_VERSION = (furnitureModels as { version: string }).version;

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
  mustStandOnFloor: r.must_stand_on_floor,
  preferredZones: r.preferred_zones,
  culturalTags: r.cultural_tags,
  materialTags: r.material_tags,
  colorTags: r.color_tags,
  roomTypes: r.room_types,
  placementType: r.placement_type,
  floorFootprintCm: [r.floor_footprint_cm[0], r.floor_footprint_cm[1]],
  assetUrl: "/" + r.asset,
  ...(MODELS[r.id] ? { model: MODELS[r.id] } : {}),
}));

const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

/** The real 3D asset for a catalogue id, if there is one. */
export function catalogModel(id: string | null | undefined): CatalogModel | undefined {
  return id ? MODELS[id] : undefined;
}

/** How much DAR actually knows about this object's form.
 *
 *  `builtCategories` is passed in rather than imported so this module stays
 *  free of THREE — `planner.ts` imports the catalogue and is deliberately a
 *  pure module with no React and no 3D. Callers hand it
 *  `BUILT_CATEGORIES` from geometry.ts. */
export function modelTier(
  opts: { catalogId?: string | null; category: string; origin: string },
  builtCategories: readonly string[],
): ModelTier {
  if (opts.origin === "found") return "massing";
  if (catalogModel(opts.catalogId)) return "real";
  return builtCategories.includes(opts.category) ? "procedural" : "massing";
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
/** All twelve categories the catalogue actually ships. Four were missing —
 *  armchair, console, cabinet, screen — and `indexOf` returns -1 for an absent
 *  key, so sortByCategory put every one of them BEFORE the sofa at index 0.
 *  The Lebanese rail opened on a folding screen. */
export const CATEGORY_ORDER = [
  "sofa",
  "armchair",
  "chair",
  "ottoman",
  "coffee_table",
  "side_table",
  "console",
  "cabinet",
  "screen",
  "lamp",
  "lantern",
  "cultural_object",
];

export const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  sofa: { en: "Seating", ar: "مجالس" },
  armchair: { en: "Armchairs", ar: "كراسي بمساند" },
  chair: { en: "Chairs", ar: "كراسي" },
  ottoman: { en: "Poufs", ar: "مقاعد منخفضة" },
  coffee_table: { en: "Low tables", ar: "طاولات منخفضة" },
  side_table: { en: "Side tables", ar: "طاولات جانبية" },
  console: { en: "Consoles", ar: "طاولات جانبية طويلة" },
  cabinet: { en: "Cabinets", ar: "خزائن" },
  screen: { en: "Screens", ar: "مشربيات" },
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

/**
 * The material a piece renders in — read in its own culture.
 *
 * This used to be `materialForTags`, which is culture-blind: `fabric` became
 * linen and `wood` became cedar for everyone, so a Moroccan sedari came out the
 * same cream as a Lebanese sofa and five of Moroccan's nine pieces came out
 * plain cedar brown. Converting a room to Moroccan then changed its data and
 * nothing anyone could see. `materialForCulture` reads a generic tag through
 * `ontology/culture_palette.json` instead; a specific tag still means itself.
 */
export function defaultMaterialFor(item: CatalogItem): string {
  const fallback = item.category === "lamp" || item.category === "lantern" ? "brass" : "cedar";
  return materialForCulture(item.materialTags, item.culture, item.category, fallback);
}

export const CULTURE_LABEL: Record<SceneCulture, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  all: { en: "All three", ar: "الثلاثة" },
};
