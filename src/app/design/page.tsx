"use client";

/* ============================================================
   /design — DAR Build Mode

   Entered from a Studio result. The room does not start empty: DAR
   already measured a floor area and projected the furniture in the
   photograph, so Build Mode opens INSIDE a plan of the user's own room
   with what is already there reconstructed as locked massing. That is
   the whole idea — you continue designing your room, you do not start a
   generic one.

   The result handoff comes through sessionStorage rather than a query
   string: /redesign returns base64 data URLs and a full analysis payload,
   which cannot survive a URL, and re-fetching is not possible for a
   synchronous endpoint that has already returned. The key is written by
   Studio immediately before navigating.
   ============================================================ */

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import type { RedesignResult } from "@/lib/api";
import CatalogDock from "@/components/design/CatalogDock";
import DesignCanvas, { type DragPayload } from "@/components/design/DesignCanvas";
import HandoffPanel from "@/components/design/HandoffPanel";
import { ObjectInspector, RoomInspector } from "@/components/design/Inspector";
import PlanMinimap from "@/components/design/PlanMinimap";
import PlanPanel from "@/components/design/PlanPanel";
import SourceCard from "@/components/design/SourceCard";
import "@/components/design/design.css";
import { CATALOG, CULTURE_LABEL, catalogItem } from "@/lib/design/catalog";
import { TIMES_OF_DAY, TIME_LABEL, type TimeOfDay } from "@/lib/design/lighting";
import { cultureAccent } from "@/lib/design/materials";
import { SNAP_ROTATION_DEG } from "@/lib/design/placement";
import { HANDOFF_KEY, SCENE_HANDOFF_KEY } from "@/lib/design/handoff";
import { createScene, type WallOpening } from "@/lib/design/roomModel";
import type { ViewPreset } from "@/lib/design/scene3d";
import { designReducer, initialState, loadScene, saveScene } from "@/lib/design/store";
import { SCENE_VERSION } from "@/lib/design/types";
import type { CatalogItem, DesignScene, SceneCulture } from "@/lib/design/types";

interface Handoff {
  result: RedesignResult;
  culture: SceneCulture;
}

function readHandoff(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Handoff;
    if (!parsed?.result?.original) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A saved design being reopened for editing. Consumed once.
 *
 *  The version is re-checked here even though My Designs already checked before
 *  navigating: loadScene refuses a scene whose SCENE_VERSION it does not know,
 *  and a room restored from an unrecognised format would be a plausible-looking
 *  fiction rather than what the user saved. Cleared whether or not it is
 *  accepted, so a rejected scene cannot be retried forever on every visit. */
function readSceneHandoff(): DesignScene | null {
  try {
    const raw = sessionStorage.getItem(SCENE_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SCENE_HANDOFF_KEY);
    const parsed = JSON.parse(raw) as DesignScene;
    if (!parsed || parsed.version !== SCENE_VERSION) return null;
    if (!parsed.room || !Array.isArray(parsed.objects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function DesignPage() {
  return (
    <Suspense fallback={null}>
      <BuildMode />
    </Suspense>
  );
}

function BuildMode() {
  const { isArabic } = useThemeLanguage();

  /* ---- bootstrap: handoff → saved scene → fresh derivation ---- */
  const [boot, setBoot] = useState<{
    scene: ReturnType<typeof createScene>["scene"];
    openings: WallOpening[];
    result: RedesignResult | null;
  } | null>(null);

  useEffect(() => {
    const h = readHandoff();
    const culture: SceneCulture = h?.culture ?? "all";
    const fresh = createScene(h?.result ?? null, culture);
    const saved = loadScene(h?.result?.job_id ?? null);
    // A design reopened from My Designs outranks both. It is a scene someone
    // already composed and saved, so re-deriving a room from the photograph
    // would throw that work away. Read once and cleared, so a later plain visit
    // to /design does not silently resurrect it.
    const reopened = readSceneHandoff();
    setBoot({
      scene: reopened ?? saved ?? fresh.scene,
      openings: fresh.openings,
      result: h?.result ?? null,
    });
  }, []);

  if (!boot) {
    return (
      <div className="dar-build">
        <div style={{ gridRow: "1 / -1", display: "grid", placeItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: "0.62rem",
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "var(--fg-mute)",
            }}
          >
            {isArabic ? "تحضير الغرفة…" : "Preparing the room…"}
          </span>
        </div>
      </div>
    );
  }

  return <BuildModeReady boot={boot} />;
}

function BuildModeReady({
  boot,
}: {
  boot: { scene: ReturnType<typeof createScene>["scene"]; openings: WallOpening[]; result: RedesignResult | null };
}) {
  const { isArabic, theme, toggleLanguage, toggleTheme } = useThemeLanguage();
  const [state, dispatch] = useReducer(designReducer, boot.scene, initialState);
  const [openings] = useState(boot.openings);
  /* What the planner understood that the RENDERER can act on. Deliberately not
     part of DesignScene: adding a field there bumps SCENE_VERSION, and
     loadScene drops any scene whose version does not match. */
  const [renderIntent, setRenderIntent] = useState<{
    roomType: string;
    intensity: number | null;
  }>({ roomType: "living room", intensity: null });
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dragItem, setDragItem] = useState<CatalogItem | null>(null);
  const [validity, setValidity] = useState<{ ok: boolean; blocking: string[]; advisory: string[] } | null>(null);
  const [roomSelected, setRoomSelected] = useState(false);
  const [showFound, setShowFound] = useState(true);
  const [handoff, setHandoff] = useState(false);
  /* Time of day is a VIEW setting, not part of the design, so it lives here
     next to renderIntent rather than in DesignScene — same reason: a new
     scene field bumps SCENE_VERSION and loadScene drops every saved room that
     does not match. */
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("afternoon");
  const [restyleNote, setRestyleNote] = useState<string | null>(null);
  const [viewNonce, setViewNonce] = useState<{ preset: ViewPreset; n: number } | null>(null);
  const [focusNonce, setFocusNonce] = useState<{ uid: string; n: number } | null>(null);
  const nonce = useRef(0);
  const captureRef = useRef<((w: number, h: number) => ReturnType<NonNullable<Parameters<typeof HandoffPanel>[0]["capture"]>>) | null>(null);

  const { scene, selectedUid } = state;
  const accent = cultureAccent(scene.culture);
  const selected = useMemo(
    () => scene.objects.find((o) => o.uid === selectedUid) ?? null,
    [scene.objects, selectedUid],
  );
  const placedCount = scene.objects.filter((o) => o.origin === "catalog").length;

  /* ---- persistence: debounced, keyed by the originating job ---- */
  useEffect(() => {
    const t = setTimeout(() => {
      saveScene(scene);
    }, 600);
    return () => clearTimeout(t);
  }, [scene]);

  /* ---- switching the catalogue culture re-themes the shell too ----
     Now one ordinary reducer action, so it is a single undo. It used to build
     a whole scene and dispatch `replace`, which wipes undo and redo — a
     culture switch destroyed every step before it and could not be taken
     back. */
  const setCulture = useCallback((c: SceneCulture) => {
    dispatch({ type: "setCulture", culture: c });
  }, []);

  /* How many placed pieces belong to a different culture than the room. This
     is the number that makes "Restyle" worth offering — and offering it only
     when there is something to restyle. */
  const foreignCount = useMemo(() => {
    if (scene.culture === "all") return 0;
    return scene.objects.filter((o) => {
      if (o.origin === "found" || !o.catalogId) return false;
      const item = catalogItem(o.catalogId);
      return !!item && item.culture !== scene.culture;
    }).length;
  }, [scene.objects, scene.culture]);

  /* Explicitly asked for, never automatic. Reports what it could not
     translate rather than quietly dropping it: category coverage is
     asymmetric across the three catalogues. */
  const restyle = useCallback(() => {
    if (scene.culture === "all") return;
    const unmatched = scene.objects.filter((o) => {
      if (o.origin === "found" || !o.catalogId) return false;
      const item = catalogItem(o.catalogId);
      if (!item || item.culture === scene.culture) return false;
      return !CATALOG.some((c) => c.culture === scene.culture && c.category === item.category);
    });
    dispatch({ type: "restyleTo", culture: scene.culture });
    setRestyleNote(
      unmatched.length
        ? isArabic
          ? `${unmatched.length} قطعة لا مقابل لها في هذه اللغة التصميمية، وبقيت كما هي.`
          : `${unmatched.length} piece${unmatched.length > 1 ? "s have" : " has"} no counterpart in this design language and stayed as ${unmatched.length > 1 ? "they were" : "it was"}.`
        : null,
    );
  }, [scene.objects, scene.culture, isArabic]);

  /* ---- catalogue drag ---- */
  const beginDrag = useCallback((item: CatalogItem, clientX: number, clientY: number) => {
    setDragItem(item);
    setDrag({ catalogId: item.id, clientX, clientY });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, clientX: e.clientX, clientY: e.clientY } : d));
    const up = () => {
      // The canvas handles a drop over the stage; anywhere else cancels.
      setTimeout(() => {
        setDrag(null);
        setDragItem(null);
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag]);

  const onDropCatalog = useCallback((catalogId: string, x: number, z: number, rotationDeg: number) => {
    dispatch({ type: "addAt", catalogId, x, z, rotationDeg });
    setDrag(null);
    setDragItem(null);
  }, []);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (!selectedUid) {
        if (e.key === "Escape") setRoomSelected(false);
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        dispatch({ type: "duplicate", uid: selectedUid });
        return;
      }
      switch (e.key) {
        case "Escape":
          dispatch({ type: "select", uid: null });
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          dispatch({ type: "remove", uid: selectedUid });
          break;
        case "r":
        case "R": {
          const cur = scene.objects.find((o) => o.uid === selectedUid);
          if (cur) {
            dispatch({
              type: "rotate",
              uid: selectedUid,
              rotationDeg: cur.rotationDeg + (e.shiftKey ? -SNAP_ROTATION_DEG : SNAP_ROTATION_DEG),
            });
          }
          break;
        }
        case "f":
        case "F":
          nonce.current += 1;
          setFocusNonce({ uid: selectedUid, n: nonce.current });
          break;
        default:
          // Arrow-key nudging: 1cm precision with shift, 10cm without.
          if (e.key.startsWith("Arrow")) {
            const cur = scene.objects.find((o) => o.uid === selectedUid);
            if (!cur || cur.locked) return;
            e.preventDefault();
            const step = e.shiftKey ? 1 : 10;
            const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const dz = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
            dispatch({ type: "move", uid: cur.uid, x: cur.x + dx, z: cur.z + dz });
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedUid, scene.objects]);

  const setView = (preset: ViewPreset) => {
    nonce.current += 1;
    setViewNonce({ preset, n: nonce.current });
  };

  const issueText = (issues: string[]): string => {
    if (issues.includes("out-of-bounds")) return isArabic ? "خارج حدود الغرفة" : "Outside the room";
    if (issues.includes("overlaps")) return isArabic ? "يتقاطع مع قطعة وضعتَها" : "Overlaps a piece you placed";
    if (issues.includes("replaces-existing"))
      return isArabic ? "سيحلّ محلّ أثاث موجود" : "Replaces existing furniture";
    if (issues.includes("needs-wall")) return isArabic ? "يُفضّل أن يلامس الجدار" : "Usually sits against a wall";
    return isArabic ? "غير صالح" : "Cannot place here";
  };

  const shellChip = () => {
    const p = scene.provenance;
    if (p.placeholder) {
      return { cls: "chip warn", text: isArabic ? "وضع المعاينة" : "Preview data" };
    }
    if (p.shellSource === "measured") {
      return {
        cls: "chip measured",
        text: isArabic
          ? `مقاسة · ${scene.room.areaM2?.toFixed(1)} م²`
          : `Measured · ${scene.room.areaM2?.toFixed(1)} m²`,
      };
    }
    if (p.shellSource === "estimated") {
      return { cls: "chip warn", text: isArabic ? "مقدَّرة · ثقة منخفضة" : "Estimated · low confidence" };
    }
    return { cls: "chip", text: isArabic ? "غرفة افتراضية" : "Default room" };
  };
  const chip = shellChip();

  return (
    <div className="dar-build">
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="brandline">
          <span className="mark">{isArabic ? "دار" : "DAR"}</span>
          <span className="eyebrow">{isArabic ? "وضع البناء" : "Build Mode"}</span>
        </div>

        <span className={chip.cls} title={isArabic ? "مصدر أبعاد الغرفة" : "Where the room's dimensions came from"}>
          <span className="dot" />
          {chip.text}
        </span>
        {scene.provenance.foundCount > 0 && (
          // Doubles as the layer toggle: the count is the fact, clicking it
          // is the control. Hiding never removes anything — the pieces still
          // collide, so the design stays honest about the real room.
          <button
            className={"tool" + (showFound ? " active" : "")}
            onClick={() => setShowFound((v) => !v)}
            title={
              isArabic
                ? "إظهار أو إخفاء ما قرأته دار من صورتك (تبقى محسوبة في التصادم)"
                : "Show or hide what DAR read from your photograph. Hidden pieces still occupy their space."
            }
          >
            {scene.provenance.foundCount} {isArabic ? "موجودة" : "found"}
          </button>
        )}

        <span className="spacer" />

        <div className="toolgroup">
          <button
            className="tool"
            disabled={!state.undo.length}
            onClick={() => dispatch({ type: "undo" })}
            title={
              state.undo.length
                ? `${isArabic ? "تراجع" : "Undo"} ${isArabic ? state.undo[state.undo.length - 1].labelAr : state.undo[state.undo.length - 1].labelEn}`
                : undefined
            }
          >
            ↶
          </button>
          <button
            className="tool"
            disabled={!state.redo.length}
            onClick={() => dispatch({ type: "redo" })}
            title={isArabic ? "إعادة" : "Redo"}
          >
            ↷
          </button>
        </div>

        <div className="toolgroup">
          <button className="tool" onClick={() => setView("perspective")} title={isArabic ? "منظور" : "Perspective"}>
            {isArabic ? "منظور" : "View"}
          </button>
          <button className="tool" onClick={() => setView("corner")} title={isArabic ? "زاوية" : "Corner"}>
            {isArabic ? "زاوية" : "Corner"}
          </button>
          <button className="tool" onClick={() => setView("plan")} title={isArabic ? "مسقط" : "Plan"}>
            {isArabic ? "مسقط" : "Plan"}
          </button>
        </div>

        {/* Time of day. Four named moments rather than sliders for sun
            azimuth, elevation, temperature and exposure — those are the four
            things each preset actually moves, and nobody designing a room
            wants to set them by hand. Viewport only: the conditioning capture
            pins itself to a fixed daylight, so Render with DAR is unaffected. */}
        <div className="toolgroup" role="group" aria-label={isArabic ? "وقت اليوم" : "Time of day"}>
          {TIMES_OF_DAY.map((t) => (
            <button
              key={t}
              className={"tool" + (timeOfDay === t ? " active" : "")}
              aria-pressed={timeOfDay === t}
              onClick={() => setTimeOfDay(t)}
              title={isArabic ? TIME_LABEL[t].ar : TIME_LABEL[t].en}
            >
              {isArabic ? TIME_LABEL[t].ar : TIME_LABEL[t].en}
            </button>
          ))}
        </div>

        {/* Offered only when there is something to translate. Switching the
            culture re-themes the room but deliberately leaves the user's
            furniture alone; this is the explicit "and the furniture too". */}
        {foreignCount > 0 && scene.culture !== "all" && (
          <button
            className="tool warn"
            onClick={restyle}
            title={
              isArabic
                ? `استبدال ${foreignCount} قطعة بما يقابلها في الطراز ${CULTURE_LABEL[scene.culture].ar} — تراجع واحد يعيدها`
                : `Swap ${foreignCount} piece${foreignCount > 1 ? "s" : ""} for their ${CULTURE_LABEL[scene.culture].en} counterparts. One undo puts them back.`
            }
          >
            {isArabic
              ? `تنسيق ${foreignCount} قطعة`
              : `Restyle ${foreignCount}`}
          </button>
        )}

        <button
          className={"tool" + (roomSelected ? " active" : "")}
          onClick={() => {
            setRoomSelected((v) => !v);
            dispatch({ type: "select", uid: null });
          }}
        >
          {isArabic ? "الغرفة" : "Room"}
        </button>

        {/* Build Mode is a full-screen route with no CinemaChrome, so it has
            to carry the language and theme toggles itself — otherwise someone
            who lands here has no way to switch. */}
        <div className="toolgroup">
          <button className="tool" onClick={toggleLanguage} lang={isArabic ? "en" : "ar"}>
            {isArabic ? "EN" : "ع"}
          </button>
          <button
            className="tool"
            onClick={toggleTheme}
            aria-label={isArabic ? "تبديل السمة" : "Toggle theme"}
            title={isArabic ? "تبديل السمة" : "Toggle theme"}
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>

        <button className="tool active" onClick={() => setHandoff(true)}>
          {isArabic ? "التصميم جاهز" : "Finish"}
        </button>

        <Link href="/studio" className="tool" style={{ textDecoration: "none" }}>
          {isArabic ? "الاستوديو" : "Studio"}
        </Link>
      </header>

      {/* ---------- stage ---------- */}
      <div className="stage">
        <DesignCanvas
          scene={scene}
          openings={openings}
          selectedUid={selectedUid}
          revision={state.revision}
          dragPayload={drag}
          onDropCatalog={onDropCatalog}
          onDragCancel={() => {
            setDrag(null);
            setDragItem(null);
          }}
          onSelect={(uid) => {
            dispatch({ type: "select", uid });
            if (uid) setRoomSelected(false);
          }}
          onMove={(uid, x, z) => dispatch({ type: "move", uid, x, z })}
          onGestureStart={(en, ar) => dispatch({ type: "beginGesture", labelEn: en, labelAr: ar })}
          onGestureEnd={() => dispatch({ type: "endGesture" })}
          onValidity={setValidity}
          viewNonce={viewNonce}
          focusNonce={focusNonce}
          showFound={showFound}
          timeOfDay={timeOfDay}
          onReady={(api) => {
            captureRef.current = api.capture;
          }}
        />

        <PlanPanel
          scene={scene}
          openings={openings}
          shellSource={scene.provenance.shellSource}
          isArabic={isArabic}
          // The maquette is the control signal; this is the step that turns it
          // into the photoreal image, and it was previously only reachable
          // through the Finish button in the top bar.
          onRender={() => setHandoff(true)}
          onApply={(gated, plan) => {
            // One gesture, so a whole plan is one undo. `replace` would have
            // been fewer lines and would have wiped undo/redo entirely — an AI
            // plan you cannot take back is worse than no plan.
            dispatch({
              type: "beginGesture",
              labelEn: "Plan the room",
              labelAr: "تخطيط الغرفة",
            });
            const u = plan.understood;
            // A brief that names a culture ("make this a Moroccan room") has to
            // reach `scene.culture`, because that is what HandoffPanel sends to
            // Render with DAR — plan Moroccan furniture without this and the
            // render still runs the Lebanese LoRA. It goes through `setCulture`
            // rather than `replace` precisely so it can ride inside this
            // gesture and come back out with one Ctrl+Z.
            if (
              (u.culture === "lebanese" ||
                u.culture === "khaleeji" ||
                u.culture === "moroccan" ||
                u.culture === "all") &&
              u.culture !== scene.culture
            ) {
              // setCulture adopts the new culture's own shell palette from
              // SHELL_MATERIALS; a surface the brief actually named is applied
              // immediately below and wins over that default.
              dispatch({ type: "setCulture", culture: u.culture });
            }
            // Wall and floor next, so the room's surfaces are already right
            // as the furniture lands. Both ride inside the same gesture, so a
            // single undo takes the whole design decision back out — colour
            // included, not just the objects.
            if (u.wallMaterialKey) {
              dispatch({ type: "setShellMaterial", surface: "wall", materialKey: u.wallMaterialKey });
            }
            if (u.floorMaterialKey) {
              dispatch({ type: "setShellMaterial", surface: "floor", materialKey: u.floorMaterialKey });
            }
            // A redesign converts the furniture DETERMINISTICALLY and takes only
            // the arrangement from the model. restyleTo runs first and keeps
            // every uid, which is what lets the moves below land on the pieces
            // the model planned against — as their counterparts in the new
            // culture. It is the same mapping the panel previewed the moves
            // against, so what was gated is what gets applied.
            if (u.intent === "redesign" && u.culture !== "all") {
              dispatch({ type: "restyleTo", culture: u.culture as SceneCulture });
            }
            // Remove → move → add, the order the gate judged them in. Applying
            // an add before a removal would drop it into floor that is about to
            // be freed, and the two verdicts would disagree with each other.
            for (const r of gated.removals) {
              dispatch({ type: "remove", uid: r.uid });
            }
            for (const m of gated.moves) {
              dispatch({ type: "move", uid: m.uid, x: m.x, z: m.z });
              dispatch({ type: "rotate", uid: m.uid, rotationDeg: m.rotationDeg });
            }
            for (const p of gated.placements) {
              dispatch({
                type: "addAt",
                catalogId: p.catalogId,
                x: p.x,
                z: p.z,
                rotationDeg: p.rotationDeg,
                materialKey: p.materialKey,
              });
            }
            dispatch({ type: "endGesture" });
            // Carried to Render with DAR: the room type reaches the prompt
            // builder's own vocabulary, and the intensity is the LoRA scale
            // /restyle already uses. Held here rather than in DesignScene —
            // a new scene field would bump SCENE_VERSION and silently discard
            // every scene a user has already saved.
            setRenderIntent({ roomType: u.roomType, intensity: u.intensity });
          }}
        />

        <PlanMinimap
          scene={scene}
          selectedUid={selectedUid}
          accent={accent}
          isArabic={isArabic}
          onPick={(uid) => {
            dispatch({ type: "select", uid });
            nonce.current += 1;
            setFocusNonce({ uid, n: nonce.current });
          }}
        />

        {validity && !validity.ok && (
          <div className="verdict bad" role="status">
            <span aria-hidden>✕</span>
            {issueText(validity.blocking)}
          </div>
        )}
        {validity?.ok && validity.advisory.length > 0 && (
          <div className="verdict note" role="status">
            <span aria-hidden>◆</span>
            {issueText(validity.advisory)}
            <span style={{ opacity: 0.65 }}>
              · {isArabic ? "مسموح" : "allowed"}
            </span>
          </div>
        )}
        {drag && dragItem && validity?.ok && validity.advisory.length === 0 && (
          <div className="verdict good" role="status">
            <span aria-hidden>✓</span>
            {isArabic ? "أفلت للوضع · R للتدوير" : "Release to place · R to rotate"}
          </div>
        )}
        {/* What the restyle could NOT translate. Category coverage is
            asymmetric across the three catalogues, and saying so is better
            than leaving the user to notice a piece did not change. */}
        {restyleNote && (
          <div className="verdict note" role="status" onClick={() => setRestyleNote(null)}>
            <span aria-hidden>◆</span>
            {restyleNote}
          </div>
        )}

        {selected && !roomSelected && (
          <ObjectInspector
            isArabic={isArabic}
            object={selected}
            onMaterial={(k) => dispatch({ type: "setMaterial", uid: selected.uid, materialKey: k })}
            onRotate={(deg) => dispatch({ type: "rotate", uid: selected.uid, rotationDeg: deg })}
            onDuplicate={() => dispatch({ type: "duplicate", uid: selected.uid })}
            onRemove={() => dispatch({ type: "remove", uid: selected.uid })}
            onToggleLock={() => dispatch({ type: "setLocked", uid: selected.uid, locked: !selected.locked })}
          />
        )}
        {roomSelected && (
          <RoomInspector
            isArabic={isArabic}
            scene={scene}
            onFloor={(k) => dispatch({ type: "setShellMaterial", surface: "floor", materialKey: k })}
            onWall={(k) => dispatch({ type: "setShellMaterial", surface: "wall", materialKey: k })}
            onResize={(w, d) => dispatch({ type: "resizeRoom", widthCm: w, depthCm: d })}
            onClose={() => setRoomSelected(false)}
          />
        )}

        {boot.result && (
          <SourceCard
            originalSrc={boot.result.original}
            styledSrc={
              (scene.culture !== "all"
                ? (boot.result[scene.culture] as string | null | undefined)
                : null) ?? null
            }
            culture={scene.culture}
            isArabic={isArabic}
            placeholder={!!boot.result.placeholder}
          />
        )}

        {placedCount === 0 && !drag && (
          <div className="coach">
            <p>
              {isArabic ? (
                <>
                  {scene.provenance.foundCount > 0
                    ? "هذه غرفتك كما فهمتها دار. "
                    : ""}
                  اسحب قطعة من الأسفل إلى الأرضية، أو انقرها لوضعها تلقائياً.
                </>
              ) : (
                <>
                  {scene.provenance.foundCount > 0
                    ? "This is your room as DAR understood it. "
                    : ""}
                  Drag a piece from below onto the floor — or click it to place it for you.
                </>
              )}
            </p>
            <p style={{ marginTop: 6 }}>
              <kbd>R</kbd> {isArabic ? "تدوير" : "rotate"} · <kbd>⌫</kbd> {isArabic ? "حذف" : "remove"} ·{" "}
              <kbd>{isArabic ? "تحكم" : "Ctrl"}+Z</kbd> {isArabic ? "تراجع" : "undo"}
            </p>
          </div>
        )}

        {handoff && (
          <HandoffPanel
            scene={scene}
            isArabic={isArabic}
            onClose={() => setHandoff(false)}
            capture={captureRef.current ?? undefined}
            renderIntent={renderIntent}
          />
        )}
      </div>

      {/* ---------- catalogue ---------- */}
      <CatalogDock
        isArabic={isArabic}
        culture={scene.culture}
        onCulture={setCulture}
        collapsed={dockCollapsed}
        onToggle={() => setDockCollapsed((v) => !v)}
        onDragStart={beginDrag}
        onQuickAdd={(item) => dispatch({ type: "add", catalogId: item.id })}
        draggingId={dragItem?.id ?? null}
      />
    </div>
  );
}
