"use client";

/* ============================================================
   Studio — the upload → loading → result flow.
   Keeps the shipped synchronous /redesign contract (all three
   styles in one call) but wears the dar-design-2 cinematic skin:
   a full-bleed dropzone with a 3D arch backdrop, a particle
   dissolve that assembles into an arch while we wait, and a
   before/after reveal slider. The FYP grid + Cultural Highlighter
   + 2D map are kept below (outside .cinema so their Tailwind
   styling is untouched).
   ============================================================ */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import ArchCanvas from "@/components/cinema/ArchCanvas";
import DissolveCanvas from "@/components/cinema/DissolveCanvas";
import DustLayer from "@/components/cinema/DustLayer";
import { MotifTiles } from "@/components/cinema/svg/MotifTiles";
import { useCinemaCopy } from "@/components/cinema/copy";
import CulturalElementHighlighter, {
  DEMO_REGIONS,
} from "@/components/CulturalElementHighlighter";
import RoomMap2D, { DEMO_MAP } from "@/components/RoomMap2D";
import ColorControl from "@/components/ColorControl";
import CulturalNarration from "@/components/CulturalNarration";
import DepthOrbit from "@/components/DepthOrbit";
import FurniturePlacement from "@/components/FurniturePlacement";
import BeforeAfterSlider from "@/components/before-after-slider";
import ProvenanceXray from "@/components/ProvenanceXray";
import EnterBuildMode from "@/components/design/EnterBuildMode";
import {
  CultureDNA,
  DesignStory,
  GenerationStory,
  createDesignStoryData,
  createGenerationStoryAssets,
  generationCapabilitiesFromProvenance,
  type GenerationStoryAssets,
} from "@/components/story";
import RoomReport from "@/components/RoomReport";
import SaveDesignButton from "@/components/SaveDesignButton";
import StyleIntensitySlider from "@/components/StyleIntensitySlider";
import { useAuth } from "@/context/AuthContext";
import { useImage, type StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { DarAudio } from "@/lib/audio";
import {
  ApiError,
  consumeGeneration,
  fetchProvenance,
  fetchSubscription,
  redesignRoom,
  type RedesignProvenance,
  type RedesignResult,
  type SubscriptionState,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Phase = "idle" | "loading" | "done" | "error";

/** Result sections. "result" is the room itself; "story"/"dna"/"inside" are the
 *  narrative layer (Design Story, Culture DNA, Inside DAR); "understand"/"edit"
 *  are the existing analysis and editing tools. */
type ResultTab = "result" | "story" | "dna" | "inside" | "understand" | "edit";

/** The analysis/editing panels below the tab bar belong to these two tabs only,
 *  so the narrative tabs render on their own rather than inheriting them. */
const TOOL_TABS: readonly ResultTab[] = ["understand", "edit"];

/** The explanation layers offered under a finished result. */
const NARRATIVE_TABS = [
  { key: "story" as const, en: "Design story", ar: "قصة التصميم" },
  { key: "dna" as const, en: "Culture DNA", ar: "البصمة الثقافية" },
  { key: "inside" as const, en: "Inside DAR", ar: "داخل دار" },
];

/** Defense Mode (?demo=1): pre-rendered canonical rooms served from
 *  /public/demo — the zero-backend fallback if the GPU tunnel dies mid-demo.
 *  Build the pack with `python scripts/make_demo_pack.py`. */
interface DemoRoom {
  id: string;
  label_ar: string;
  label_en: string;
  has_depth: boolean;
  has_meta: boolean;
}

const STYLE_ORDER: StyleId[] = ["lebanese", "khaleeji", "moroccan"];
const STYLE_MOTIF: Record<StyleId, string> = {
  lebanese: "qanater",
  khaleeji: "majlis",
  moroccan: "zellige",
};
const DISSOLVE_COLOR: Record<StyleId, number> = {
  lebanese: 0xf0d78c,
  khaleeji: 0xd4af37,
  moroccan: 0xf0d78c,
};

// "original" isn't a culture, so it keeps a plain glyph; the three cultures
// get their material motif instead (see the Motif lookup at render time).
const TILES = [
  { key: "original", ar: "الأصلية", en: "Original", flag: "🏠" },
  { key: "lebanese", ar: "لبناني", en: "Lebanese" },
  { key: "khaleeji", ar: "خليجي", en: "Khaleeji" },
  { key: "moroccan", ar: "مغربي", en: "Moroccan" },
] as const;

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

export default function StudioPage() {
  const { isArabic } = useThemeLanguage();
  const copy = useCinemaCopy();
  const { imageFile, imagePreviewUrl, setImage, clearImage } = useImage();
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RedesignResult | null>(null);
  const [err, setErr] = useState<{ en: string; ar: string } | null>(null);
  const [featured, setFeatured] = useState<StyleId>("lebanese");
  // Which cultures to generate. "all" keeps the shipped behaviour (and the
  // "one compute serves all three" demo story); a single culture is ~3x faster
  // because generation dominates — depth/seg and the room analysis run once
  // either way.
  const [generateScope, setGenerateScope] = useState<StyleId | "all">("all");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [over, setOver] = useState(false);
  const [validationErr, setValidationErr] = useState<string | null>(null);
  /* Results IA (P1-8). The results view used to stack ~9 heavy panels in one
     column behind a single Show/Hide toggle, so the jury had to scroll a long
     way to find anything. Grouped into three tabs instead — every panel is
     still reachable, now in one click. Panels stay mounted (hidden via CSS)
     so an in-progress colour pick or furniture placement survives a tab
     switch. */
  const [resultTab, setResultTab] = useState<ResultTab>("result");
  /* Which explanation layer is open, or null for none. Only the selected one
     is mounted — see the note at the render site. */
  const [narrative, setNarrative] = useState<null | "story" | "dna" | "inside">(null);
  const [demoRooms, setDemoRooms] = useState<DemoRoom[]>([]);
  // The renders exactly as generated, before any colour or furniture edit. Kept
  // so Save can say whether what it is storing is still the pipeline's own
  // output — an edited image is a fine design but a misleading measurement.
  const [pristine, setPristine] = useState<Record<string, string>>({});
  // The account's plan and what is left of the weekly allowance. Displayed here
  // and enforced by the backend — this copy is only ever what the server last
  // said, never the thing that decides.
  const [plan, setPlan] = useState<SubscriptionState | null>(null);
  // True when the last attempt was refused for having no designs left, which
  // turns the error scene into an upgrade prompt rather than a "try again".
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  /* What the render host will do, fetched once on mount. The model, the LoRA
     and the ControlNet weights are CONFIGURATION, not results, so they are
     knowable before a generation starts — which is what lets "Inside DAR"'s
     pipeline chapter state real facts during the wait instead of captioning
     itself as a diagram. Null on any failure, including an older backend with
     no such endpoint; null means unknown and the chapter falls back. */
  const [hostProvenance, setHostProvenance] = useState<RedesignProvenance | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchProvenance(undefined, ac.signal).then(setHostProvenance).catch(() => {});
    return () => ac.abort();
  }, []);

  // Defense Mode: read ?demo=1 via window.location (client-only page; avoids
  // the useSearchParams Suspense requirement) and load the static manifest.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("demo")) return;
    fetch("/demo/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setDemoRooms(m?.rooms ?? []))
      .catch(() => setDemoRooms([]));
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reassuring elapsed timer during the ~1–2 min synchronous generation.
  useEffect(() => {
    if (phase !== "loading") {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Drives the particle dissolve ONLY — it is an animation curve, not a
  // measurement. /redesign is a single synchronous call with no progress
  // events, so there is nothing real to report as a percentage and none is
  // shown: the UI reports elapsed time, which is measured, and an
  // indeterminate ring, which promises nothing.
  useEffect(() => {
    if (phase !== "loading") return;
    const start = performance.now();
    const id = setInterval(() => {
      const el = (performance.now() - start) / 1000;
      const target = Math.min(0.92, 1 - Math.exp(-el / 40));
      setProgress((p) => (p >= 1 ? p : Math.max(p, target)));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // Abort any in-flight request if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const acceptFile = useCallback(
    async (f: File | undefined | null) => {
      setValidationErr(null);
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        setValidationErr(
          isArabic ? "يجب أن يكون الملف صورة" : "The file must be an image",
        );
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setValidationErr(
          isArabic
            ? "يجب أن يكون الحجم أقل من 10 ميغابايت"
            : "File must be under 10MB",
        );
        return;
      }
      try {
        const { w, h } = await readDimensions(f);
        if (w < 256 || h < 256) {
          setValidationErr(
            isArabic
              ? "الصورة صغيرة جدًا (256×256 على الأقل)"
              : "Image too small (256×256 minimum)",
          );
          return;
        }
      } catch {
        setValidationErr(
          isArabic ? "تعذّر قراءة الصورة" : "Could not read the image",
        );
        return;
      }
      setImage(f);
    },
    [isArabic, setImage],
  );

  // What the account may still do. Refreshed after every generation, because the
  // count it shows has just changed.
  const loadPlan = useCallback(() => {
    if (!user) {
      setPlan(null);
      return;
    }
    fetchSubscription()
      .then(setPlan)
      // A missing or unreachable accounts backend leaves the hint unrendered;
      // it must not put an error in front of someone trying to design a room.
      .catch(() => setPlan(null));
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadPlan();
  }, [authLoading, loadPlan]);

  /**
   * Count this generation against the account before it starts.
   *
   * Returns the refusal to show, or null to go ahead. Only two answers stop a
   * generation: "your free designs for this week are gone" and "nobody is
   * signed in". Anything else — the accounts backend being a different host in
   * a split deployment, or simply down — lets the design through: an
   * infrastructure failure is not the user's overspend.
   */
  const spendGeneration = useCallback(async (): Promise<ApiError | null> => {
    try {
      const usage = await consumeGeneration();
      setPlan((prev) => (prev ? { ...prev, ...usage } : prev));
      return null;
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === "quota_exceeded" || e.code === "not_authenticated")
      ) {
        return e;
      }
      return null;
    }
  }, []);

  const runRedesign = useCallback(async () => {
    if (!imageFile) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setErr(null);
    setQuotaBlocked(false);
    setResult(null);
    setResultTab("result");
    setProgress(0);

    // Before the loading scene, so a refusal is immediate rather than a
    // dissolve that turns out to have been for nothing.
    const refused = await spendGeneration();
    if (refused) {
      setQuotaBlocked(refused.code === "quota_exceeded");
      setErr({ en: refused.message_en, ar: refused.message_ar });
      setPhase("error");
      return;
    }

    setPhase("loading");

    try {
      // 7 min: covers the T4's cold first call (SDXL+ControlNet download) —
      // warm calls finish in ~1.5–3 min and resolve long before this fires.
      const r = await redesignRoom(imageFile, {
        timeoutMs: 420_000,
        signal: ctrl.signal,
        styles: generateScope === "all" ? undefined : [generateScope],
      });
      setResult(r);
      setPristine(
        Object.fromEntries(
          (r.styles ?? [])
            .map((k) => [k, r[k]] as const)
            .filter(
              (pair): pair is readonly [StyleId, string] =>
                typeof pair[1] === "string",
            ),
        ),
      );
      // The featured tile must be one that actually exists, or every consumer of
      // result[featured] (slider, download, report, 3D orbit, furniture panel)
      // would read undefined.
      if (r.styles?.length && !r.styles.includes(featured))
        setFeatured(r.styles[0]);
      setProgress(1);
      DarAudio.chime();
      // brief hold so the assembled arch is felt before the reveal
      setTimeout(() => setPhase("done"), 900);
    } catch (e) {
      if (e instanceof ApiError && e.code === "aborted") return; // we cancelled it
      const fb_en = "Something went wrong. Please try again.";
      const fb_ar = "حدث خطأ، يرجى المحاولة مجدداً.";
      if (e instanceof ApiError) {
        setErr({ en: e.message_en || fb_en, ar: e.message_ar || fb_ar });
      } else {
        setErr({ en: fb_en, ar: fb_ar });
      }
      setPhase("error");
    }
  }, [imageFile, generateScope, featured, spendGeneration]);

  // Defense Mode: hydrate `result` from the static pack — no network beyond
  // same-origin fetches, so the full reveal (grid, highlighter, map, orbit)
  // works with the backend completely offline.
  const loadDemoRoom = useCallback(async (room: DemoRoom) => {
    const base = `/demo/${room.id}`;
    let meta: {
      object_map?: RedesignResult["object_map"];
      seg_regions?: RedesignResult["seg_regions"];
    } = {};
    if (room.has_meta) {
      try {
        meta = await fetch(`${base}/meta.json`).then((r) =>
          r.ok ? r.json() : {},
        );
      } catch {
        /* images alone still make the demo */
      }
    }
    setErr(null);
    setResultTab("result");
    setResult({
      original: `${base}/original.png`,
      lebanese: `${base}/lebanese.png`,
      khaleeji: `${base}/khaleeji.png`,
      moroccan: `${base}/moroccan.png`,
      depth_map: room.has_depth ? `${base}/depth_map.png` : null,
      object_map: meta.object_map ?? null,
      seg_regions: meta.seg_regions ?? null,
    });
    setProgress(1);
    DarAudio.chime();
    setPhase("done");
  }, []);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    setResult(null);
    setErr(null);
    setResultTab("result");
    setProgress(0);
    clearImage();
    setPhase("idle");
  }, [clearImage]);

  const downloadTile = useCallback((dataUrl: string, key: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `dardesign-${key}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const tc = copy.transform;
  const lc = copy.loading;
  const rc = copy.result;

  // Week 2: /redesign now ships a backend-computed top-down object map,
  // on-image highlighter regions, and a depth PNG for the 3D orbit. Fall
  // back to the illustrative demo data for older backends that omit them.
  const backendMap = result?.object_map;
  const mapObjects = backendMap?.objects?.length
    ? backendMap.objects
    : DEMO_MAP;
  const hasRealMap = !!backendMap?.objects?.length && !backendMap.placeholder;
  const backendRegions = result?.seg_regions;
  const highlightRegions = backendRegions?.regions?.length
    ? backendRegions.regions
    : DEMO_REGIONS;
  const hasRealRegions =
    !!backendRegions?.regions?.length && !backendRegions.placeholder;
  // LIGHT-mode stand-ins, not real renders. Top-level flag on new backends;
  // envelope flags cover older ones.
  const isPlaceholder = !!(
    result?.placeholder ||
    backendMap?.placeholder ||
    backendRegions?.placeholder
  );

  const msgIdx = Math.min(
    lc.messages.length - 1,
    Math.floor(progress * lc.messages.length),
  );
  const ringR = 90;
  const ringC = 2 * Math.PI * ringR;

  // What is actually being rendered this run — stated plainly, because "all
  // three" genuinely takes about three times as long as one culture.
  const scopeLabel =
    generateScope === "all"
      ? isArabic
        ? "ثلاث لغات تصميم"
        : "THREE DESIGN LANGUAGES"
      : isArabic
        ? `لغة تصميم واحدة · ${tc.styles[generateScope].name}`
        : `ONE DESIGN LANGUAGE · ${tc.styles[generateScope].name.toUpperCase()}`;

  // The weekly allowance, as a line under the CTA. Only a plan the backend
  // actually reported produces one; when the accounts backend is unreachable
  // the hint is simply absent rather than guessed at.
  const outOfDesigns = !!plan && !plan.isSubscribed && plan.remaining === 0;
  const allowance: {
    text: string;
    link?: { href: string; label: string };
  } | null = authLoading
    ? null
    : !user
      ? {
          text: isArabic
            ? "سجّل الدخول لبدء التصميم."
            : "Sign in to start designing.",
          link: {
            href: "/login",
            label: isArabic ? "تسجيل الدخول" : "Sign in",
          },
        }
      : !plan
        ? null
        : plan.isSubscribed
          ? {
              text: isArabic
                ? "الخطة الاحترافية — تصاميم غير محدودة."
                : "Pro plan — unlimited designs.",
            }
          : {
              text: isArabic
                ? `تبقّى ${plan.remaining} من ${plan.limit} تصاميم مجانية هذا الأسبوع.`
                : `${plan.remaining} of ${plan.limit} free designs left this week.`,
              link: {
                href: "/subscription",
                label: isArabic ? "الترقية إلى الاحترافية" : "Upgrade to Pro",
              },
            };

  return (
    <main className="app-page relative min-h-screen">
      {/* ---------- IDLE: cinematic upload + featured-style picker ---------- */}
      {phase === "idle" && (
        <div className="cinema studio-workspace">
          <section className="transform-scene">
            <div className="ambient-3d">
              <ArchCanvas
                opts={{
                  dustCount: 700,
                  cameraZStart: 9,
                  cameraZEnd: 8,
                  enableMashrabiya: true,
                  ambient: 0.4,
                  angle: -0.18,
                  archColor:
                    DISSOLVE_COLOR[featured] === 0xd4af37
                      ? 0xd4af37
                      : featured === "moroccan"
                        ? 0x1f4287
                        : 0xc9a876,
                  fogNear: 2,
                  fogFar: 12,
                }}
                resetKey={[featured]}
                fallbackOpacity={0.28}
              />
            </div>
            <DustLayer count={20} seed={9} />
            <div className="wrap">
              <div className="lead">
                <div className="eyebrow">{tc.eyebrow}</div>
                <h1>
                  {tc.title.map((w, i) => (
                    <span
                      key={i}
                      className={i === tc.italicIdx ? "italic" : ""}
                    >
                      {w}
                      {i < tc.title.length - 1 ? " " : ""}
                    </span>
                  ))}
                </h1>
                <p>{tc.sub}</p>
              </div>

              {/* Defense Mode strip — only when ?demo=1 and a pack exists */}
              {demoRooms.length > 0 && (
                <div
                  role="group"
                  aria-label={isArabic ? "وضع العرض الآمن" : "Defense mode"}
                  style={{
                    margin: "0 auto var(--s-6)",
                    width: "min(1100px, 92vw)",
                    padding: "14px 18px",
                    border: "1px dashed var(--brass)",
                    borderRadius: "16px",
                    background: "var(--brass-wash)",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: "0.7rem",
                      letterSpacing: "0.12em",
                      color: "var(--brass-bright)",
                      marginBottom: 10,
                    }}
                  >
                    {isArabic
                      ? "وضع العرض الآمن — غرف جاهزة بدون خادم · DEFENSE MODE"
                      : "DEFENSE MODE — pre-rendered rooms, zero backend · وضع العرض الآمن"}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {demoRooms.map((room) => (
                      <button
                        key={room.id}
                        onClick={() => void loadDemoRoom(room)}
                        style={{
                          border: "1px solid var(--hairline-2)",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "transparent",
                          cursor: "pointer",
                          width: 128,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/demo/${room.id}/original.png`}
                          alt={isArabic ? room.label_ar : room.label_en}
                          style={{
                            width: "100%",
                            aspectRatio: "4/3",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                        <span
                          className={isArabic ? "font-arabic" : "font-ui"}
                          style={{
                            display: "block",
                            padding: "6px 4px",
                            fontSize: "0.72rem",
                            color: "var(--fg-mute)",
                          }}
                        >
                          {isArabic ? room.label_ar : room.label_en}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="stage">
                {/* DROPZONE */}
                <div
                  className={"dropzone " + (over ? "over" : "")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    void acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  onClick={() => !imagePreviewUrl && inputRef.current?.click()}
                  /* The file input is display:none, which also removes it from the
                     tab order — so without this the whole flow had no keyboard
                     entry point at all. Only expose it while it can actually act,
                     mirroring the onClick guard. */
                  role={!imagePreviewUrl ? "button" : undefined}
                  tabIndex={!imagePreviewUrl ? 0 : undefined}
                  aria-label={!imagePreviewUrl ? tc.dropPrompt : undefined}
                  onKeyDown={(e) => {
                    if (imagePreviewUrl) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      inputRef.current?.click();
                    }
                  }}
                >
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => void acceptFile(e.target.files?.[0])}
                  />
                  {!imagePreviewUrl && (
                    <div>
                      <div className="icon">
                        <svg
                          viewBox="0 0 96 96"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        >
                          <rect
                            x="14"
                            y="22"
                            width="68"
                            height="50"
                            stroke="currentColor"
                          />
                          <circle cx="48" cy="47" r="14" />
                          <circle cx="48" cy="47" r="6" />
                          <path d="M30 22 L36 14 L60 14 L66 22" />
                          <line x1="20" y1="30" x2="26" y2="30" />
                        </svg>
                      </div>
                      <h3 className="prompt">{tc.dropPrompt}</h3>
                      <div className="sub">{tc.dropClick}</div>
                      <div className="formats">{tc.formats}</div>
                      <div
                        className="formats"
                        style={{ marginTop: 6, opacity: 0.75 }}
                      >
                        {isArabic
                          ? "صورك تُحذف تلقائيًا بعد ٢٤ ساعة ما لم تحفظها."
                          : "Your photos are automatically deleted after 24 hours unless you save them."}
                      </div>
                      {validationErr && (
                        <div
                          style={{
                            marginTop: "var(--s-4)",
                            color: "var(--error)",
                            fontSize: "0.85rem",
                          }}
                        >
                          {validationErr}
                        </div>
                      )}
                    </div>
                  )}
                  {imagePreviewUrl && (
                    <div
                      className="preview"
                      style={{ backgroundImage: `url(${imagePreviewUrl})` }}
                    >
                      <div className="scrim" />
                      <button
                        className="remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearImage();
                        }}
                      >
                        {tc.remove} ✕
                      </button>
                      <div className="filename">
                        {tc.filenamePrefix} · {imageFile?.name}
                      </div>
                    </div>
                  )}
                </div>

                {/* STYLE PICKER — chooses what to GENERATE. "All three" keeps
                    the original behaviour; picking one culture renders only it,
                    which is roughly 3x faster. */}
                <div className="styles-picker">
                  <div className="label">{tc.pickLabel}</div>
                  {STYLE_ORDER.map((id) => {
                    const Motif =
                      MotifTiles[STYLE_MOTIF[id] as keyof typeof MotifTiles];
                    return (
                      <button
                        key={id}
                        className={
                          "style-card " +
                          (generateScope === id ? "selected" : "")
                        }
                        onClick={() => {
                          setGenerateScope(id);
                          setFeatured(id);
                        }}
                      >
                        {/* Atmosphere for the chosen house — architecture and
                            material only, never a room being designed. It is
                            decoration and must never be mistaken for a DAR
                            output, which is why it lives here and NOT on any
                            surface that carries evidence (Culture DNA, the
                            element highlighter, material swatches).

                            Mounted only while selected, so exactly one video
                            decodes at a time rather than three. `poster` is a
                            still from the same clip, so a slow or blocked
                            file degrades to a photograph instead of a hole. */}
                        {generateScope === id ? (
                          <video
                            className="card-film"
                            src={`/video/${id}.mp4`}
                            poster={`/video/${id}.jpg`}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="auto"
                            aria-hidden
                          />
                        ) : null}
                        <div className="motif">{Motif ? <Motif /> : null}</div>
                        <div>
                          <h3 className="name">{tc.styles[id].name}</h3>
                          <p className="desc">{tc.styles[id].desc}</p>
                        </div>
                        <div className="check">
                          {generateScope === id ? "✓" : ""}
                        </div>
                      </button>
                    );
                  })}

                  <button
                    className={
                      "style-card " +
                      (generateScope === "all" ? "selected" : "")
                    }
                    onClick={() => setGenerateScope("all")}
                  >
                    {/* Was an empty <div className="motif"/>, which rendered as a
                        blank black square next to three illustrated cards — it
                        read as a failed image. A triptych of the three motifs
                        says "all three" without inventing new artwork. */}
                    <div className="motif motif-trio" aria-hidden>
                      {STYLE_ORDER.map((id) => {
                        const Motif = MotifTiles[STYLE_MOTIF[id] as keyof typeof MotifTiles];
                        return Motif ? (
                          <span key={id} className="motif-third">
                            <Motif />
                          </span>
                        ) : null;
                      })}
                    </div>
                    <div>
                      <h3 className="name">
                        {isArabic ? "الثلاثة معاً" : "All three"}
                      </h3>
                      <p className="desc">
                        {isArabic
                          ? "يولّد الثقافات الثلاث للمقارنة — أبطأ بثلاث مرات"
                          : "Generate all three cultures to compare — about 3x slower"}
                      </p>
                    </div>
                    <div className="check">
                      {generateScope === "all" ? "✓" : ""}
                    </div>
                  </button>

                  <div className="transform-cta">
                    <button
                      className={"btn " + (imageFile ? "" : "ghost")}
                      onClick={runRedesign}
                      disabled={!imageFile || outOfDesigns}
                      style={
                        !imageFile || outOfDesigns
                          ? { opacity: 0.55, cursor: "not-allowed" }
                          : {}
                      }
                    >
                      <span>
                        {imageFile ? tc.ctaReady : tc.ctaWaitingImage}
                      </span>
                      <span className="arrow">→</span>
                    </button>
                    {/* What this account has left. Rendered from the plan the
                        backend last reported, never computed here. */}
                    {allowance && (
                      <p
                        style={{
                          marginTop: "var(--s-3)",
                          fontSize: "0.8rem",
                          opacity: 0.75,
                        }}
                      >
                        {allowance.text}{" "}
                        {allowance.link && (
                          <Link
                            href={allowance.link.href}
                            style={{ color: "var(--dd-gold)" }}
                          >
                            {allowance.link.label}
                          </Link>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ---------- LOADING: particle dissolve assembling the arch ---------- */}
      {phase === "loading" && (
        <div className="cinema studio-workspace">
          <section className="loading-scene" role="status" aria-live="polite">
            {/* Noise resolving into an eight-pointed star, then dissolving
                back. Diffusion genuinely is noise resolving into form, so this
                is an honest metaphor for what the backend is doing right now —
                and it resolves into GEOMETRY, never a room, so it cannot be
                read as "watch DAR generate your photograph". Decoration, not
                evidence: the chapters beside it carry the actual explanation. */}
            <video
              className="wait-film"
              src="/video/diffusion.mp4"
              poster="/video/diffusion.jpg"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden
            />
            <div className="canvas">
              <DissolveCanvas
                progress={progress}
                count={4500}
                color={DISSOLVE_COLOR[featured]}
              />
            </div>
            <DustLayer count={26} seed={17} />
            <div className="core">
              {/* Indeterminate by design. A percentage here would be invented:
                  /redesign returns once, with no intermediate state to read. */}
              <div className="ring-wrap">
                <svg viewBox="0 0 200 200">
                  <circle className="ring-bg" cx="100" cy="100" r={ringR} />
                  <circle
                    className="ring-fg ring-indeterminate"
                    cx="100"
                    cy="100"
                    r={ringR}
                    strokeDasharray={`${(ringC * 0.16).toFixed(1)} ${ringC.toFixed(1)}`}
                  />
                </svg>
                <div className="ring-pct">
                  <span className="pct-num mono">{mmss(elapsed)}</span>
                  <span className="pct">{isArabic ? "منقضية" : "elapsed"}</span>
                </div>
              </div>
              <div className="step-label">{lc.pretitle}</div>
              <h2 key={msgIdx}>{lc.messages[msgIdx]}</h2>
              <div
                className="mono"
                style={{ marginTop: "var(--s-3)", opacity: 0.6 }}
              >
                {mmss(elapsed)}
              </div>
            </div>
            <div className="footer-meta">{lc.meta}</div>
          </section>
        </div>
      )}

      {/* Inside DAR, during the real wait. Studio's animated percentage is
          deliberately NOT passed as progress: /redesign is one synchronous
          call with no stage telemetry, so the only honest inputs are the
          upload preview, the requested scope and measured elapsed time. The
          chapter loop is documentary pacing, not an estimate of completion. */}
      {phase === "loading" && imagePreviewUrl && (
        <section className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
          <GenerationStory
            inputImage={imagePreviewUrl}
            culture={generateScope}
            // Real host configuration, known before the render returns. The
            // assets (depth, segmentation, renders) genuinely do not exist yet
            // and are deliberately NOT passed here.
            capabilities={generationCapabilitiesFromProvenance(
              hostProvenance,
              generateScope === "all" ? "lebanese" : generateScope,
            )}
            status={{ state: "requesting", elapsedSeconds: elapsed }}
          />
        </section>
      )}

      {/* ---------- ERROR ---------- */}
      {phase === "error" && err && (
        <div className="cinema studio-workspace">
          <section className="error-scene">
            <DustLayer count={18} seed={29} />
            <div>
              <div className="code">{copy.error.code}</div>
              <h1>
                {copy.error.title.map((w, i) => (
                  <span
                    key={i}
                    className={i === copy.error.italicIdx ? "italic" : ""}
                  >
                    {w}
                    {i < copy.error.title.length - 1 ? " " : ""}
                  </span>
                ))}
              </h1>
              <p>{isArabic ? err.ar : err.en}</p>
              <div
                style={{
                  display: "flex",
                  gap: "var(--s-4)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                {/* Retrying cannot help when the weekly allowance is spent, so
                    the limit offers the plan instead of the same refusal. */}
                {quotaBlocked ? (
                  <Link className="btn" href="/subscription">
                    <span>{isArabic ? "عرض الخطط" : "See plans"}</span>
                    <span className="arrow">→</span>
                  </Link>
                ) : !user ? (
                  <Link className="btn" href="/login">
                    <span>{isArabic ? "تسجيل الدخول" : "Sign in"}</span>
                    <span className="arrow">→</span>
                  </Link>
                ) : (
                  <button className="btn" onClick={runRedesign}>
                    <span>{copy.error.cta}</span>
                    <span className="arrow">↻</span>
                  </button>
                )}
                <button className="btn ghost" onClick={startOver}>
                  <span>{copy.error.home}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ---------- DONE: cinematic reveal + compare, then the FYP grid ---------- */}
      {phase === "done" &&
        result &&
        (() => {
          // The featured style is guaranteed to be one that was generated (see
          // runRedesign), but fall back to the original so a null can never reach
          // an <img src> or the report/orbit/furniture panel.
          const featuredSrc = result[featured] ?? result.original;
          // Every other culture this run actually produced, in catalogue order.
          // Read from `styles` — the backend's own answer about what it made —
          // with a presence check for payloads that predate that field. Empty
          // for a single-culture run, which is what makes the saved design fall
          // back to a plain before/after rather than a comparison of one.
          const siblingOutputs = (result.styles ?? STYLE_ORDER)
            .filter((id) => id !== featured && typeof result[id] === "string")
            .map((id) => ({ culture: id, image: result[id] as string }));
          // adapters.ts is the truth gate: it excludes placeholder artifacts,
          // never falls back to DEMO_REGIONS/DEMO_MAP, emits unmeasured values
          // as `measured: false` rather than inventing them, and returns null
          // outright when the original or the selected output is missing. Null
          // simply means the explanation layer is not offered.
          const storyData = createDesignStoryData(result, featured);
          // Inside DAR's chapters were rendering as diagrams-of-a-pipeline
          // because `assets` was never passed — the prop existed, the type was
          // even imported here, and nothing filled it. This hands the chapters
          // the run's OWN depth map and segmentation regions, behind the same
          // placeholder gate storyData uses.
          const generationAssets: GenerationStoryAssets | null =
            createGenerationStoryAssets(result);
          // What the render host actually did, for the culture on screen. Empty
          // on a LIGHT run or an older backend, which keeps the pipeline chapter
          // captioned as architecture rather than letting it claim a LoRA and a
          // dual ControlNet it cannot prove.
          const generationCapabilities = generationCapabilitiesFromProvenance(
            result.provenance,
            featured,
          );
          return (
            <>
              <div className="cinema studio-workspace">
                <section className="result-scene">
                  <div className="reveal-stage">
                    <div className="canvas">
                      <ArchCanvas
                        opts={{
                          dustCount: 900,
                          cameraZStart: 7,
                          cameraZEnd: 6.4,
                          enableMashrabiya: true,
                          ambient: 0.6,
                        }}
                        fallbackOpacity={0.35}
                      />
                    </div>
                    <DustLayer count={26} seed={21} />
                    <div className="label">
                      <div className="eyebrow">{rc.eyebrow}</div>
                      <h1>
                        {rc.title.map((w, i) => (
                          <span
                            key={i}
                            className={i === rc.italicIdx ? "italic" : ""}
                          >
                            {w}
                            {i < rc.title.length - 1 ? " " : ""}
                          </span>
                        ))}
                      </h1>
                    </div>
                  </div>

                  {/* culture toggle for the reveal lead */}
                  <div
                    style={{
                      display: "flex",
                      gap: "var(--s-3)",
                      justifyContent: "center",
                      flexWrap: "wrap",
                      marginTop: "var(--s-5)",
                    }}
                  >
                    {STYLE_ORDER.map((id) => (
                      <button
                        key={id}
                        onClick={() => setFeatured(id)}
                        className="mono"
                        style={{
                          padding: "8px 18px",
                          borderRadius: "var(--r-pill)",
                          border: `1px solid ${featured === id ? "var(--brass)" : "var(--hairline-2)"}`,
                          background:
                            featured === id
                              ? "var(--brass-wash)"
                              : "transparent",
                          color:
                            featured === id
                              ? "var(--brass-bright)"
                              : "var(--fg-mute)",
                        }}
                      >
                        {tc.styles[id].name}
                      </button>
                    ))}
                  </div>

                  {/* Unmissable notice when the backend served LIGHT-mode stand-ins */}
                  {isPlaceholder && (
                    <div
                      role="status"
                      style={{
                        margin: "var(--s-5) auto 0",
                        width: "min(1400px, 92vw)",
                        padding: "12px 20px",
                        border: "1px solid var(--brass)",
                        background: "var(--brass-wash)",
                        borderRadius: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        textAlign: "center",
                      }}
                    >
                      <span
                        className="font-arabic"
                        dir="rtl"
                        style={{
                          color: "var(--brass-bright)",
                          fontWeight: 600,
                        }}
                      >
                        وضع المعاينة — لا توجد وحدة GPU متصلة؛ هذه ألوان تمييزية
                        وليست تصاميم حقيقية
                      </span>
                      <span
                        className="mono"
                        style={{
                          color: "var(--fg-mute)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.08em",
                        }}
                      >
                        PREVIEW MODE — no GPU connected. These tints are
                        placeholders, not real redesigns.
                      </span>
                    </div>
                  )}

                  <div
                    style={{ padding: "var(--s-7) 0", position: "relative" }}
                  >
                    {/* afterSide="right": the result is pinned to the right in
                    both languages, matching .lbl.before/.lbl.after in
                    cinema.css, so the images and their labels agree in RTL. */}
                    <BeforeAfterSlider
                      beforeSrc={result.original}
                      afterSrc={featuredSrc}
                      beforeLabel={rc.before}
                      afterLabel={rc.after}
                      afterSide="right"
                      className="compare max-w-none rounded-none"
                    />
                  </div>

                  {/* Provenance X-ray. Mounted right under the reveal, because
                      this is the moment the claim needs its evidence: the wipe
                      above says "we redesigned your room", and this says what
                      the room was measured as. It renders itself away when the
                      run returned no real depth or regions, so a LIGHT run or an
                      older backend simply does not show it — never a sample. */}
                  {(() => {
                    const realDepth =
                      !result.placeholder && typeof result.depth_map === "string"
                        ? result.depth_map
                        : null;
                    const realRegions =
                      !result.placeholder && result.seg_regions?.placeholder !== true
                        ? result.seg_regions?.regions ?? null
                        : null;
                    if (!realDepth && !realRegions?.length) return null;
                    return (
                      <div style={{ padding: "0 0 var(--s-7)" }}>
                        <ProvenanceXray
                          renderSrc={featuredSrc}
                          depthSrc={realDepth}
                          regions={realRegions}
                        />
                      </div>
                    );
                  })()}

                  <div className="actions">
                    <button
                      className="btn"
                      onClick={() => downloadTile(featuredSrc, featured)}
                    >
                      <span>{rc.download}</span>
                      <span className="arrow">↓</span>
                    </button>
                    <button className="btn ghost" onClick={startOver}>
                      <span>{rc.again}</span>
                    </button>
                  </div>
                </section>
              </div>

              {/* ----- FYP: full grid + Cultural Highlighter + 2D map (outside .cinema) ----- */}
              <section className="studio-results-panel relative z-10 mx-auto max-w-6xl px-4 pb-16">
                <div className="mb-6 flex items-center justify-between">
                  <h2
                    className={cn(
                      "text-lg font-semibold text-cream",
                      isArabic ? "font-arabic" : "font-display",
                    )}
                  >
                    {isArabic ? "كل البيوت الثلاثة" : "All three houses"}
                  </h2>
                  <div
                    className={cn(
                      "flex items-center gap-3",
                      isArabic && "flex-row-reverse",
                    )}
                  >
                    {/* Save the CURRENT state: featuredSrc is replaced after every
                    furniture insertion, so pressing this after editing stores
                    the edited room, not the freshly generated one. */}
                    {/* `featured` is the culture actually on screen, so it is the
                    one this design should be recorded and rated as. */}
                    <SaveDesignButton
                      oldImage={result.original}
                      newImage={featuredSrc}
                      culture={featured}
                      // The renderer's own measurement of this generation, stored on
                      // the design so the evaluation dashboard can average it.
                      duration={result.duration_s}
                      // The score for the culture actually on screen — that is the
                      // image being saved.
                      ssim={result.ssim?.[featured] ?? null}
                      // Colour control and furniture placement replace this image;
                      // when they have, it is no longer what the pipeline produced.
                      edited={
                        !!pristine[featured] &&
                        pristine[featured] !== featuredSrc
                      }
                      // Preview mode: a tint, not a render. Still worth saving, but
                      // its millisecond "generation time" must not reach the
                      // evaluation dashboard's averages.
                      light={isPlaceholder}
                      // The other cultures this run produced. An "all three"
                      // generation makes three readings of one room, and saving
                      // only the featured one threw the comparison away — the
                      // whole point of asking for three. Sent as companions to
                      // this design: still ONE saved design, still measured as
                      // the featured culture alone.
                      siblings={siblingOutputs}
                    />
                    <RoomReport
                      beforeSrc={result.original}
                      afterSrc={featuredSrc}
                      styleLabel={{
                        ar: TILES.find((t) => t.key === featured)?.ar ?? "",
                        en: TILES.find((t) => t.key === featured)?.en ?? "",
                      }}
                      regions={highlightRegions}
                      mapObjects={mapObjects}
                      isLive={hasRealRegions && hasRealMap}
                      placeholder={result.placeholder === true}
                      jobId={backendMap?.jobId}
                    />
                    {/* The doorway into Build Mode. Without it /design can only
                    ever open on the default sandbox room, so the room DAR just
                    understood — its measured shell, the furniture it found and
                    the openings it detected — never reaches the 3D editor. */}
                    <EnterBuildMode result={result} culture={featured} variant="link" />
                    <button
                      onClick={startOver}
                      className={cn(
                        "flex items-center gap-2 text-sm text-cream-muted transition hover:text-gold",
                        isArabic ? "font-arabic flex-row-reverse" : "font-ui",
                      )}
                    >
                      <RotateCcw size={16} />
                      {isArabic ? "غرفة جديدة" : "New room"}
                    </button>
                  </div>
                </div>

                {/* Colour Control — repaint the wall or floor of the featured
                render. Needs the cached room analysis for the same reason
                furniture placement does: the masks live server-side and are
                only derivable from the generation pass. Confirming replaces
                the featured image, so Save, the report and the 3D orbit all
                pick the recoloured room up without knowing about this panel. */}
                {result.job_id && result.room_analysis && (
                  <div className="mb-6">
                    <ColorControl
                      jobId={result.job_id}
                      style={featured}
                      imageSrc={featuredSrc}
                      onImageChange={(image) =>
                        setResult((prev) =>
                          prev ? { ...prev, [featured]: image } : prev,
                        )
                      }
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {/* Only tiles that were actually generated — a single-culture
                  request legitimately returns nulls for the other two. */}
                  {TILES.filter((t) => typeof result[t.key] === "string").map(
                    (t) => {
                      const src = result[t.key] as string;
                      // Cultures get their motif tile; "Original" is not a
                      // culture and keeps its house icon.
                      const Motif =
                        t.key === "original"
                          ? null
                          : MotifTiles[
                              STYLE_MOTIF[
                                t.key as StyleId
                              ] as keyof typeof MotifTiles
                            ];
                      return (
                        <figure
                          key={t.key}
                          className="group overflow-hidden rounded-2xl border border-gold/20 bg-[var(--dd-surface)] transition-colors duration-300 hover:border-gold/60"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt={isArabic ? t.ar : t.en}
                            className="block aspect-[4/3] w-full object-cover"
                          />
                          <figcaption
                            className={cn(
                              "flex items-center justify-between gap-2 px-4 py-3",
                              isArabic && "flex-row-reverse",
                            )}
                          >
                            <span
                              className={cn(
                                "flex items-center gap-2",
                                isArabic && "flex-row-reverse",
                              )}
                            >
                              {Motif ? (
                                <span
                                  className="block h-5 w-5 shrink-0 overflow-hidden rounded-sm"
                                  aria-hidden
                                >
                                  <Motif />
                                </span>
                              ) : (
                                <span>
                                  {t.key === "original" ? t.flag : null}
                                </span>
                              )}
                              <span
                                className={cn(
                                  "text-sm font-medium text-cream-soft",
                                  isArabic && "font-arabic",
                                )}
                              >
                                {t.ar}
                              </span>
                              <span className="font-ui text-xs text-cream-muted">
                                {t.en}
                              </span>
                            </span>
                            <button
                              onClick={() => downloadTile(src, t.key)}
                              aria-label={
                                isArabic
                                  ? `تنزيل التصميم ${t.ar}`
                                  : `Download ${t.en} design`
                              }
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border border-gold px-3 py-1.5 text-xs font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
                                isArabic
                                  ? "font-arabic flex-row-reverse"
                                  : "font-ui",
                              )}
                            >
                              <Download size={14} />
                              {isArabic ? "تنزيل" : "Download"}
                            </button>
                          </figcaption>
                        </figure>
                      );
                    },
                  )}
                </div>

                {/* ---------------------------------------------------------
                    The narrative layer: how DAR read this room, the culture it
                    drew on, and how the system works. These explain the AI and
                    are what separate DAR from an image generator, so they are
                    surfaced here rather than buried.

                    Exactly ONE panel is mounted at a time. That is deliberate,
                    not a styling choice: GenerationStory runs a timed chapter
                    loop and DesignStory measures natural image ratios, so
                    CSS-hiding them would leave timers and measurement running
                    offscreen for the whole session.

                    The panels' CSS modules are authored to a 1480px measure,
                    which this narrower results column would collapse — hence
                    the symmetric negative margin-inline. Logical properties,
                    because `left` resolves against the inline start and would
                    throw the panel off the page in RTL.
                    --------------------------------------------------------- */}
                {storyData && (
                  <section className="mt-12 border-t border-gold/15 pt-8">
                    <div
                      className={cn(
                        "mb-5 flex flex-wrap items-center gap-1.5",
                        isArabic && "flex-row-reverse",
                      )}
                      role="tablist"
                      aria-label={isArabic ? "طبقات الشرح" : "Explanation layers"}
                    >
                      {NARRATIVE_TABS.map((tab) => {
                        const active = narrative === tab.key;
                        return (
                          <button
                            key={tab.key}
                            role="tab"
                            aria-selected={active}
                            onClick={() => setNarrative(active ? null : tab.key)}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-xs transition",
                              isArabic ? "font-arabic" : "font-ui",
                              active
                                ? "border-gold bg-gold/10 text-gold"
                                : "border-cream-muted/30 text-cream-muted hover:border-gold/60 hover:text-gold",
                            )}
                          >
                            {isArabic ? tab.ar : tab.en}
                          </button>
                        );
                      })}
                    </div>

                    {narrative && (
                      <div
                        style={{
                          width: "min(1480px, calc(100vw - 2rem))",
                          marginInline: "calc((100% - min(1480px, calc(100vw - 2rem))) / 2)",
                        }}
                      >
                        {narrative === "story" && <DesignStory data={storyData} />}
                        {narrative === "dna" && <CultureDNA culture={featured} />}
                        {narrative === "inside" && (
                          <GenerationStory
                            inputImage={result.original}
                            culture={featured}
                            // The real depth map and segmentation regions this
                            // run produced. Gated by the same placeholder rule
                            // createDesignStoryData uses, so a LIGHT run passes
                            // null here and the chapters keep their honest
                            // fallback rather than presenting a synthetic room
                            // as evidence.
                            assets={generationAssets ?? undefined}
                            capabilities={generationCapabilities}
                            status={{
                              state: "done",
                              jobId: result.job_id ?? null,
                              // Real measured duration, or omitted entirely —
                              // the component renders an em dash rather than a
                              // fabricated zero.
                              elapsedSeconds: result.duration_s ?? undefined,
                            }}
                          />
                        )}
                      </div>
                    )}
                  </section>
                )}

                {/* Cultural elements + 2D layout — scaffold preview (sample data). */}
                <div className="mt-12 border-t border-gold/15 pt-8">
                  <div
                    className={cn(
                      "mb-4 flex items-center justify-between gap-3",
                      isArabic && "flex-row-reverse",
                    )}
                  >
                    <div className={cn(isArabic ? "text-right" : "text-left")}>
                      <h2
                        className={cn(
                          "text-lg font-semibold text-cream",
                          isArabic ? "font-arabic" : "font-display",
                        )}
                      >
                        {isArabic
                          ? "العناصر الثقافية والمخطط"
                          : "Cultural elements & layout"}
                        <span className="ms-2 align-middle text-xs text-cream-muted">
                          {hasRealRegions && hasRealMap
                            ? isArabic
                              ? "(حيّ)"
                              : "(live)"
                            : isArabic
                              ? "(تجريبي)"
                              : "(preview)"}
                        </span>
                      </h2>
                      <p
                        className={cn(
                          "mt-1 text-xs text-cream-muted",
                          isArabic && "font-arabic",
                        )}
                      >
                        {isArabic
                          ? hasRealRegions && hasRealMap
                            ? "التظليل والمخطط محسوبان من الخادم لغرفتك (عمق + تجزئة). اضغط أي عنصر."
                            : hasRealMap
                              ? "التظليل على الصورة تجريبي؛ المخطط العلوي محسوب من الخادم (عمق + تجزئة). اضغط أي عنصر."
                              : "عناصر ومخطط تجريبيان — الخادم لم يُرجع خريطة التجزئة والإسقاط. اضغط أي عنصر."
                          : hasRealRegions && hasRealMap
                            ? "Highlights & top-down map are computed by the backend for your room (depth + segmentation). Click any element."
                            : hasRealMap
                              ? "Highlight regions are samples; the top-down map is computed by the backend (depth + segmentation). Click any element."
                              : "Sample regions + top-down map — the backend did not return segmentation & projection data. Click any element."}
                      </p>
                    </div>
                  </div>

                  <>
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div>
                          <p
                            className={cn(
                              "mb-2 text-xs font-medium text-cream-soft",
                              isArabic && "font-arabic",
                            )}
                          >
                            {isArabic
                              ? "التظليل على الصورة"
                              : "On-image highlight"}
                          </p>
                          <CulturalElementHighlighter
                            imageSrc={result.original}
                            regions={highlightRegions}
                            alt={
                              isArabic
                                ? "تحليل العناصر الثقافية"
                                : "Cultural element analysis"
                            }
                          />
                        </div>
                        <div>
                          <p
                            className={cn(
                              "mb-2 text-xs font-medium text-cream-soft",
                              isArabic && "font-arabic",
                            )}
                          >
                            {isArabic
                              ? "المخطط العلوي ثنائي الأبعاد"
                              : "2D top-down map"}
                          </p>
                          <RoomMap2D objects={mapObjects} />
                        </div>
                      </div>
                      {/* The Understood Room, layer 3: orbit the redesigned room in 3D.
                      Depth comes from the input photo; structure is preserved by
                      the ControlNets, so it displaces the styled image cleanly. */}
                      {result.depth_map && (
                        <div className="mt-6">
                          <p
                            className={cn(
                              "mb-2 text-xs font-medium text-cream-soft",
                              isArabic && "font-arabic",
                            )}
                          >
                            {isArabic
                              ? `الجولة ثلاثية الأبعاد — ${TILES.find((t) => t.key === featured)?.ar ?? ""} (اسحب للدوران)`
                              : `3D room view — ${TILES.find((t) => t.key === featured)?.en ?? ""} (drag to orbit)`}
                          </p>
                          <DepthOrbit
                            imageUrl={featuredSrc}
                            depthUrl={result.depth_map}
                          />
                        </div>
                      )}

                      {/* Cultural furniture: recommend, position, confirm, insert.
                      Needs the cached room analysis (masks live server-side), so
                      it only renders when /redesign returned a job id and an
                      analysis — otherwise placement has nothing to validate
                      against and the panel would offer a broken promise. */}
                      {result.job_id && result.room_analysis && (
                        <FurniturePlacement
                          jobId={result.job_id}
                          style={featured}
                          imageSrc={featuredSrc}
                          analysis={result.room_analysis}
                          onPlaced={(image) =>
                            setResult((prev) =>
                              prev ? { ...prev, [featured]: image } : prev,
                            )
                          }
                        />
                      )}

                      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div>
                          <p
                            className={cn(
                              "mb-2 text-xs font-medium text-cream-soft",
                              isArabic && "font-arabic",
                            )}
                          >
                            {isArabic
                              ? "السرد الثقافي الصوتي (يتحدّث عربيّاً)"
                              : "Bilingual cultural narration (it speaks)"}
                          </p>
                          <CulturalNarration />
                        </div>
                        <div>
                          <p
                            className={cn(
                              "mb-2 text-xs font-medium text-cream-soft",
                              isArabic && "font-arabic",
                            )}
                          >
                            {isArabic
                              ? "شدّة الطراز (الاستئصال حيّاً)"
                              : "Style intensity (the ablation, live)"}
                          </p>
                          <StyleIntensitySlider />
                        </div>
                      </div>
                  </>
                </div>
              </section>
            </>
          );
        })()}
    </main>
  );
}
