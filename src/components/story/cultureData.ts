import ontologyRaw from "../../../ontology/ontology.json";
import type { StyleId } from "@/lib/api";
import type {
  CultureDnaCategory,
  CultureDnaProfile,
  CultureDnaTerm,
  LocalizedText,
  StoryCulture,
} from "@/components/story/types";

/** The three core cultures served by `/redesign`, in product order. */
export const CULTURE_DNA_ORDER = ["lebanese", "khaleeji", "moroccan"] as const satisfies readonly StyleId[];

/** Canonical category order from ontology/README.md and prompt_builder.py. */
export const CULTURE_DNA_CATEGORIES = [
  "architectural",
  "materials",
  "color_palette",
  "lighting",
  "furniture",
  "textiles",
  "ornamentation",
] as const satisfies readonly CultureDnaCategory[];

export const CULTURE_DNA_NAMES: Record<StyleId, LocalizedText> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
};

interface RawOntologyTerm {
  en: string;
  ar: string;
  weight?: number;
  verified?: boolean;
  note?: string;
  hex?: string;
}

type RawCulture = {
  [Category in CultureDnaCategory]?: RawOntologyTerm[];
};

interface RawOntology {
  version: string;
  cultures: Record<string, RawCulture>;
}

/**
 * A resolved selection never invents a fourth CultureDnaProfile for `all`.
 * `all` is presentation metadata around the three independent backend cultures.
 */
export interface CultureDnaSelection {
  culture: StoryCulture;
  mode: "single" | "editorial-synthesis";
  ontologyVersion: string;
  profiles: CultureDnaProfile[];
}

const ontology = ontologyRaw as unknown as RawOntology;

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid culture ontology value at ${path}`);
  }
  return value;
}

function termId(culture: StyleId, category: CultureDnaCategory, index: number, label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${culture}:${category}:${String(index + 1).padStart(2, "0")}:${slug || "term"}`;
}

function buildProfile(culture: StyleId): CultureDnaProfile {
  const source = ontology.cultures[culture];
  if (!source) throw new Error(`Culture ${culture} is missing from ontology/ontology.json`);

  const terms: CultureDnaTerm[] = CULTURE_DNA_CATEGORIES.flatMap((category) =>
    (source[category] ?? []).map((rawTerm, index) => {
      const en = requireString(rawTerm.en, `cultures.${culture}.${category}[${index}].en`);
      const ar = requireString(rawTerm.ar, `cultures.${culture}.${category}[${index}].ar`);

      return {
        id: termId(culture, category, index, en),
        label: { en, ar },
        category,
        sourceCulture: culture,
        weight: typeof rawTerm.weight === "number" ? rawTerm.weight : undefined,
        verified: typeof rawTerm.verified === "boolean" ? rawTerm.verified : undefined,
        note: typeof rawTerm.note === "string" ? rawTerm.note : undefined,
        hex: typeof rawTerm.hex === "string" ? rawTerm.hex : undefined,
      };
    }),
  );

  return {
    culture,
    name: CULTURE_DNA_NAMES[culture],
    ontologyVersion: requireString(ontology.version, "version"),
    terms,
  };
}

export const CULTURE_DNA_ONTOLOGY_VERSION = requireString(ontology.version, "version");

/** Full, lossless UI profiles derived at build time from the canonical ontology. */
export const CULTURE_DNA_PROFILES: Record<StyleId, CultureDnaProfile> = {
  lebanese: buildProfile("lebanese"),
  khaleeji: buildProfile("khaleeji"),
  moroccan: buildProfile("moroccan"),
};

export function getCultureDnaProfile(culture: StyleId): CultureDnaProfile {
  return CULTURE_DNA_PROFILES[culture];
}

export function getCultureDnaProfiles(culture: StoryCulture): CultureDnaProfile[] {
  return culture === "all"
    ? CULTURE_DNA_ORDER.map((profileCulture) => CULTURE_DNA_PROFILES[profileCulture])
    : [CULTURE_DNA_PROFILES[culture]];
}

export function getCultureDnaSelection(culture: StoryCulture): CultureDnaSelection {
  return {
    culture,
    mode: culture === "all" ? "editorial-synthesis" : "single",
    ontologyVersion: CULTURE_DNA_ONTOLOGY_VERSION,
    profiles: getCultureDnaProfiles(culture),
  };
}

/** Useful to integrations that need a category-specific rail or explanation. */
export function getCultureDnaTerms(
  culture: StoryCulture,
  category?: CultureDnaCategory,
): CultureDnaTerm[] {
  return getCultureDnaProfiles(culture).flatMap((profile) =>
    category ? profile.terms.filter((term) => term.category === category) : profile.terms,
  );
}
