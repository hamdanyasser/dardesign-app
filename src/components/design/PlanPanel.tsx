"use client";

/* ============================================================
   Describe the room; DAR plans it.

   The panel is deliberately honest about who did the planning. A layout
   from a design model and a layout from DAR's placement rules look the
   same on the floor, so the badge says which one you are looking at, and
   the panel lists every piece that was proposed and refused rather than
   quietly showing a shorter plan.

   Nothing here places furniture. It hands accepted placements up to the
   page, which dispatches them inside one gesture so a single undo takes
   the whole plan back out.
   ============================================================ */

import { useEffect, useState } from "react";
import {
  ApiError,
  checkRenderHost,
  fetchPlannerStatus,
  planLayout,
  type DesignPlan,
  type RenderHostStatus,
} from "@/lib/api";
import { catalogItem } from "@/lib/design/catalog";
import { getMaterial } from "@/lib/design/materials";
import { gatePlan, planOperationCount, type GatedPlan } from "@/lib/design/planner";
import {
  conversionOps,
  planCultureConversion,
  restyleObjects,
  type CultureConversion,
} from "@/lib/design/culture";
import type { WallOpening } from "@/lib/design/roomModel";
import type { DesignScene, SceneCulture } from "@/lib/design/types";

const CULTURE_LABEL: Record<string, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  all: { en: "All three", ar: "الثلاثة" },
};

/* The examples teach the vocabulary. Two of each kind, because the panel can
   now do both and nothing else on screen says so: furnish a room from a
   description, or edit the room you are looking at. */
const EXAMPLES_EN = [
  "A majlis for receiving guests",
  "Make this a Moroccan room",
  "Add 5 chairs and one table",
  "Move the furniture apart",
];
const EXAMPLES_AR = [
  "مجلس لاستقبال الضيوف",
  "اجعلها غرفة مغربية",
  "أضف ٥ كراسٍ وطاولة واحدة",
  "باعد بين قطع الأثاث",
];

/** A category name a person would recognise, for the requested-vs-placed line. */
const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  sofa: { en: "sofa", ar: "أريكة" },
  armchair: { en: "armchair", ar: "كرسي وثير" },
  chair: { en: "chair", ar: "كرسي" },
  coffee_table: { en: "coffee table", ar: "طاولة قهوة" },
  side_table: { en: "side table", ar: "طاولة جانبية" },
  console: { en: "console", ar: "كونسول" },
  cabinet: { en: "cabinet", ar: "خزانة" },
  ottoman: { en: "ottoman", ar: "بوف" },
  lamp: { en: "lamp", ar: "مصباح" },
  lantern: { en: "lantern", ar: "فانوس" },
  screen: { en: "screen", ar: "مشربية" },
  cultural_object: { en: "piece", ar: "قطعة" },
};

function categoryLabel(key: string, isArabic: boolean): string {
  const label = CATEGORY_LABEL[key];
  if (label) return isArabic ? label.ar : label.en;
  return key.replace(/_/g, " ");
}

/** The category that actually stood in for a requested one, if any. */
function substituteFor(plan: DesignPlan, requested: string): string | null {
  return (plan.substitutions ?? []).find((s) => s.requested === requested)?.category ?? null;
}

export default function PlanPanel({
  scene,
  openings,
  shellSource,
  isArabic,
  onApply,
  onRender,
}: {
  scene: DesignScene;
  openings: WallOpening[];
  shellSource: string;
  isArabic: boolean;
  onApply: (gated: GatedPlan, plan: DesignPlan) => void;
  /** Opens the hand-off panel — the step that turns the maquette into a render. */
  onRender: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DesignPlan | null>(null);
  const [gated, setGated] = useState<GatedPlan | null>(null);
  const [converted, setConverted] = useState<CultureConversion[]>([]);
  /** Set on a redesign: how many pieces the deterministic restyle swapped, and
   *  how many had no counterpart in the target culture and stayed as they were. */
  const [restyled, setRestyled] = useState<{ changed: number; unmatched: number } | null>(null);
  /** Set once a plan has landed: the panel stops being a form and becomes the
   *  hand-off to the render, which is the step people were not finding. */
  const [applied, setApplied] = useState<{
    culture: string;
    intent: string;
    summary: string;
  } | null>(null);
  /** Probed when a plan lands, so an expired tunnel is stated before someone
   *  waits 35s for it. null = not asked yet. */
  const [host, setHost] = useState<RenderHostStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<{ configured: boolean; model: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlannerStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* A real plan is 11-35s against the live model (measured 2026-08-14 across
     six briefs). "Planning…" alone for half a minute reads as a hung button,
     and someone waiting on a demo machine presses it again. Elapsed seconds
     are the honest thing to show: /api/design/plan returns once and has no
     intermediate state, so a percentage would be an invented animation —
     the same reason Studio's loading scene shows time and not progress. */
  /* Probe the generator the moment a plan is applied, not when the render
     button is pressed. The render host is a tunnel whose URL rotates every
     session, so "gone" is the ordinary morning-after state of a working setup;
     finding out after a 35-second wait is the worst possible moment. */
  useEffect(() => {
    if (!applied) return;
    let alive = true;
    checkRenderHost().then((s) => {
      if (alive) setHost(s);
    });
    return () => {
      alive = false;
    };
  }, [applied]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);

  async function run() {
    setBusy(true);
    setError(null);
    setPlan(null);
    setGated(null);
    setConverted([]);
    setRestyled(null);
    try {
      const result = await planLayout({
        widthCm: scene.room.widthCm,
        depthCm: scene.room.depthCm,
        heightCm: scene.room.heightCm,
        culture: scene.culture,
        brief,
        // What DAR read from the photograph, so the plan designs around it.
        shellSource,
        existing: scene.objects
          .filter((o) => o.origin === "found")
          .map((o) => ({
            label: o.labelEn,
            xCm: Math.round(o.x),
            zCm: Math.round(o.z),
            widthCm: Math.round(o.widthCm),
            depthCm: Math.round(o.depthCm),
          })),
        // Only what DAR actually detected. Empty for a default room, and the
        // panel says so rather than letting the model imagine a doorway.
        openings: openings.map((o) => ({
          kind: o.kind,
          wall: o.wall,
          t: Number(o.t.toFixed(2)),
          widthCm: Math.round(o.widthCm),
          label: o.labelEn,
        })),
        // The room as it stands. Without this the planner has never been shown
        // the furniture it is being asked to rearrange, so "move these apart"
        // and "remove one chair" can only come back as a second living room
        // stacked on the first. Uids travel with it; the backend enums them so
        // a target that is not in this list is unrepresentable.
        objects: scene.objects.map((o) => ({
          uid: o.uid,
          origin: o.origin,
          catalogId: o.catalogId,
          category: o.category,
          label: o.labelEn,
          xCm: Math.round(o.x),
          zCm: Math.round(o.z),
          rotationDeg: Math.round(o.rotationDeg),
          widthCm: Math.round(o.widthCm),
          depthCm: Math.round(o.depthCm),
          locked: !!o.locked,
        })),
      });
      setPlan(result);

      /* ---- culture conversion -------------------------------------------
         A brief that changes the culture has to change the FURNITURE, not
         just the label: the identity of a room lives in its pieces, and a
         Moroccan room full of Lebanese seating is neither. The model
         sometimes replaces them itself and sometimes does not, so DAR does
         it deterministically rather than hoping.

         Anything the model already dealt with is skipped, so a piece is
         never removed twice or moved and replaced at once. A piece the
         model MOVED is converted at its new spot — the user asked for both
         and the two are not in conflict. */
      const target = result.understood.culture as SceneCulture;
      /* A redesign converts the furniture deterministically (restyleTo) and
         asks the model only for the ARRANGEMENT. So the moves have to be
         judged against the room as it will be AFTER the swap: a Moroccan
         sedari is not the size of the Lebanese sofa it replaces, and a move
         validated against the old footprint can collide once applied. Same
         uids survive the swap, which is what lets the model's moves land. */
      const isRedesign = result.understood.intent === "redesign" && target !== "all";
      const restyled = isRedesign ? restyleObjects(scene.objects, target) : null;
      const gateScene = restyled ? { ...scene, objects: restyled.objects } : scene;
      setRestyled(restyled ? { changed: restyled.changed, unmatched: restyled.unmatched.length } : null);

      const modelMoves = result.moves ?? [];
      const modelRemovals = result.removals ?? [];
      const handled = new Set(modelRemovals.map((r) => r.targetUid));
      const movedTo = new Map(modelMoves.map((m) => [m.targetUid, m]));

      // On a redesign the pieces are already converted in `gateScene`, so the
      // remove-and-replace conversion must not run as well — it would try to
      // convert pieces that are no longer foreign and double-handle the room.
      const { conversions } = isRedesign
        ? { conversions: [] as CultureConversion[] }
        : planCultureConversion(scene.objects, target, { skipUids: handled });
      // Convert at the moved position where the model also moved the piece.
      const placed = conversions.map((c) => {
        const m = movedTo.get(c.uid);
        return m ? { ...c, x: m.xCm, z: m.zCm, rotationDeg: m.rotationDeg } : c;
      });
      const convertedUids = new Set(placed.map((c) => c.uid));
      const ops = conversionOps(placed);

      setConverted(placed);
      // The gate: nothing is trusted until the collision engine has spoken.
      // Conversion additions go FIRST so they claim the spots their originals
      // held before any newly designed piece competes for the same floor.
      setGated(
        gatePlan([...ops.items, ...result.items], gateScene, openings, {
          removals: [...modelRemovals, ...ops.removals],
          // A converted piece is being replaced, so the model's move for it is
          // already expressed by where the replacement stands.
          moves: modelMoves.filter((m) => !convertedUids.has(m.targetUid)),
          // Judge against the room this plan produces. The scene is still
          // Lebanese at this point; every Moroccan piece would be dropped for
          // being the wrong culture — including the conversions themselves.
          culture: target,
        }),
      );
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? isArabic
            ? e.message_ar
            : e.message_en
          : isArabic
            ? "تعذّر التخطيط."
            : "Planning failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="plan-open" onClick={() => setOpen(true)}>
        <span aria-hidden>✦</span>
        {isArabic ? "صِف غرفتك" : "Describe your room"}
      </button>
    );
  }

  /* ---- the plan has landed: hand off to the render --------------------
     The maquette is the control signal, not the deliverable — the photoreal
     image comes from SDXL conditioned on the layout that was just applied.
     Nothing used to say so, so the flow ended with a room full of study-model
     volumes and no indication that the generation step existed.              */
  if (applied) {
    const cult = CULTURE_LABEL[applied.culture] ?? CULTURE_LABEL.all;
    const cultureName = isArabic ? cult.ar : cult.en;
    return (
      <aside className="planner" aria-label={isArabic ? "الغرفة جاهزة" : "Room ready"}>
        <div className="insp-head">
          <div style={{ minWidth: 0 }}>
            <div className="insp-title">{isArabic ? "طُبِّق التصميم" : "Applied"}</div>
            <div className="insp-sub">{applied.summary}</div>
          </div>
          <button
            className="insp-x"
            onClick={() => {
              setApplied(null);
              setOpen(false);
            }}
            aria-label={isArabic ? "إغلاق" : "Close"}
          >
            ✕
          </button>
        </div>

        <p className="plan-notes">
          {isArabic
            ? `غرفتك الآن ${cultureName}. ما تراه نموذج دراسي — الصورة الواقعية تُولَّد منه.`
            : `Your room is now ${cultureName}. What you see is a study model — the photoreal image is generated from it.`}
        </p>

        <button
          className="plan-go"
          disabled={host !== null && !host.reachable}
          onClick={onRender}
        >
          {isArabic ? "أنشئ صورة واقعية" : "Render this room"}
        </button>

        {/* State the pipeline plainly. "Render" is otherwise a black box, and
            the whole argument of this project is that it is not one. */}
        <p className="plan-foot">
          {isArabic
            ? `SDXL مع ضبط ${cultureName}، مشروطاً بعمق وتقسيم هذه الغرفة — نحو ٣٥ ثانية.`
            : `SDXL with the ${cultureName} cultural model, conditioned on this room's depth and segmentation — about 35s.`}
        </p>

        {host !== null && !host.reachable && (
          <p className="plan-warn" role="status">
            {isArabic
              ? "لا يمكن الوصول إلى خادم التوليد. شغّل دفتر Kaggle ثم: npm run dev:tunnel <العنوان الجديد>"
              : "The generator is unreachable — the tunnel URL rotates every session. Start the Kaggle notebook, then run: npm run dev:tunnel <new-url>"}
          </p>
        )}
        {host?.reachable && host.lightMode && (
          <p className="plan-warn" role="status">
            {isArabic
              ? "الخادم في وضع المعاينة ولن يُصدر صورة حقيقية."
              : "The host is in preview mode — it will answer, but it will not produce a real render."}
          </p>
        )}

        <button
          className="plan-chip"
          style={{ marginTop: 10 }}
          onClick={() => {
            setApplied(null);
            setPlan(null);
            setGated(null);
            setBrief("");
          }}
        >
          {isArabic ? "خطِّط مرة أخرى" : "Plan something else"}
        </button>
      </aside>
    );
  }

  const examples = isArabic ? EXAMPLES_AR : EXAMPLES_EN;
  const byModel = plan?.source === "llm";

  return (
    <aside className="planner" aria-label={isArabic ? "تخطيط الغرفة" : "Plan the room"}>
      <div className="insp-head">
        <div style={{ minWidth: 0 }}>
          <div className="insp-title">{isArabic ? "صِف غرفتك" : "Describe your room"}</div>
          <div className="insp-sub">
            {status?.configured
              ? isArabic
                ? "مخطِّط الذكاء الاصطناعي"
                : "AI planner"
              : isArabic
                ? "قواعد التوزيع"
                : "placement rules"}
          </div>
        </div>
        <button className="insp-x" onClick={() => setOpen(false)} aria-label={isArabic ? "إغلاق" : "Close"}>
          ✕
        </button>
      </div>

      <textarea
        className="plan-brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        placeholder={
          isArabic ? "ما الذي تريده في هذه الغرفة؟" : "What do you want in this room?"
        }
      />

      <div className="plan-chips">
        {examples.map((ex) => (
          <button key={ex} className="plan-chip" onClick={() => setBrief(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <button className="plan-go" onClick={run} disabled={busy}>
        {busy
          ? isArabic
            ? `يخطّط… ${elapsed}ث`
            : `Planning… ${elapsed}s`
          : isArabic
            ? "خطِّط الغرفة"
            : "Plan the room"}
      </button>

      {busy && (
        <p className="plan-foot" style={{ marginTop: 6 }}>
          {isArabic
            ? "يقرأ نموذج التصميم غرفتك ووصفك — عادةً من ١٠ إلى ٣٥ ثانية."
            : "The design model is reading your room and your brief — usually 10-35s."}
        </p>
      )}

      {error && <p className="plan-err">{error}</p>}

      {plan && gated && (
        <div className="plan-result">
          <p className="plan-badge">
            {byModel
              ? isArabic
                ? `خطّطها ${plan.model}`
                : `Planned by ${plan.model}`
              : isArabic
                ? "خطّطتها قواعد دار"
                : "Planned by DAR's rules"}
            {plan.cached && (isArabic ? " · محفوظة" : " · cached")}
          </p>

          {/* WHY it is rule-based, when a model was supposed to answer.
              The backend has always computed this; the panel used to drop it,
              so a provider outage was indistinguishable from a deliberate
              layout — you got the same seven pieces whatever you typed and
              nothing on screen admitted your brief had not been read. */}
          {!byModel && status?.configured && (
            <p className="plan-warn" role="status">
              {isArabic
                ? `لم يُقرأ وصفك: تعذّر الوصول إلى نموذج التصميم${plan.warning ? ` (${plan.warning})` : ""}. هذا التوزيع من قواعد دار وحدها — أعد المحاولة.`
                : `Your brief was not read: the design model could not be reached${plan.warning ? ` (${plan.warning})` : ""}. This layout is DAR's placement rules alone — try again.`}
            </p>
          )}

          {/* The model answered, but its response came back incomplete and the
              usable prefix was recovered. Said out loud for the same reason the
              rules warning above is: the plan IS the model's — every piece was
              written by it and judged by the same gates — but a truncated
              answer may be missing operations the brief asked for, and the user
              is the one deciding whether to press the button again. */}
          {byModel && plan.salvaged && (
            <p className="plan-warn" role="status">
              {isArabic
                ? "جاء ردّ النموذج ناقصًا؛ استُخدم الجزء الصالح منه. قد تنقص بعض العناصر — أعد المحاولة للحصول على خطة كاملة."
                : "The model's response came back incomplete, so the usable part was used. Some pieces may be missing — try again for a full plan."}
            </p>
          )}

          {/* DAR understood — the brief read back as design decisions, not as
              a transcript. Every value here was validated against a real DAR
              vocabulary server-side, so nothing in this block is a guess. */}
          {(() => {
            const u = plan.understood;
            const cult = CULTURE_LABEL[u.culture] ?? CULTURE_LABEL.all;
            const wall = u.wallMaterialKey ? getMaterial(u.wallMaterialKey) : null;
            const floor = u.floorMaterialKey ? getMaterial(u.floorMaterialKey) : null;
            const seats = plan.seatingEstimate;
            return (
              <section className="und" aria-label={isArabic ? "ما فهمته دار" : "What DAR understood"}>
                <div className="insp-sub">{isArabic ? "فهمت دار" : "DAR understood"}</div>

                <p className="und-line">
                  {isArabic ? cult.ar : cult.en}
                  <span className="und-dot">·</span>
                  {u.roomType}
                  {u.capacity != null && (
                    <>
                      <span className="und-dot">·</span>
                      {isArabic ? `${u.capacity} أشخاص` : `${u.capacity} people`}
                    </>
                  )}
                </p>

                {(wall || floor) && (
                  <p className="und-line">
                    {wall && (
                      <span className="und-mat">
                        <span className="und-sw" style={{ background: wall.hex }} aria-hidden />
                        {isArabic ? wall.nameAr : wall.nameEn}
                        <span className="und-mut">{isArabic ? " جدران" : " walls"}</span>
                      </span>
                    )}
                    {floor && (
                      <span className="und-mat">
                        <span className="und-sw" style={{ background: floor.hex }} aria-hidden />
                        {isArabic ? floor.nameAr : floor.nameEn}
                        <span className="und-mut">{isArabic ? " أرضية" : " floor"}</span>
                      </span>
                    )}
                  </p>
                )}

                {u.intensity != null && (
                  <p className="und-line und-mut">
                    {isArabic
                      ? `شدّة ثقافية ${Math.round(u.intensity * 100)}٪`
                      : `Cultural intensity ${Math.round(u.intensity * 100)}%`}
                  </p>
                )}

                {/* DAR's own arithmetic over what was placed, not a claim by
                    the model — and labelled an estimate because seat counts
                    are derived from real widths, not stored in the ontology. */}
                <p className="und-line und-mut">
                  {isArabic ? `يتّسع لنحو ${seats}` : `Seats about ${seats}`}
                  {u.capacity != null && seats < u.capacity && (
                    <span className="und-warn">
                      {isArabic ? ` · طُلب ${u.capacity}` : ` · ${u.capacity} asked for`}
                    </span>
                  )}
                </p>

                {/* Counts you stated, checked. DAR tops a short plan up to the
                    number asked for and trims a long one, so `requested` and
                    `planned` normally agree — when they cannot, because the
                    floor ran out, the shortfall is stated rather than quietly
                    delivered as "some chairs". */}
                {(plan.counts ?? []).length > 0 && (
                  <ul className="und-counts">
                    {(plan.counts ?? []).map((c) => {
                      // The gate can only ever place fewer than were planned,
                      // never more, so the honest number is the gated one.
                      const placed = gated.placements.filter((p) => {
                        const cat = catalogItem(p.catalogId)?.category;
                        return cat === c.category || cat === substituteFor(plan, c.category);
                      }).length;
                      const short = placed < c.requested;
                      return (
                        <li key={c.category}>
                          {isArabic
                            ? `${placed} من ${c.requested} ${categoryLabel(c.category, true)}`
                            : `${placed} of ${c.requested} ${categoryLabel(c.category, false)}${c.requested === 1 ? "" : "s"}`}
                          {short && (
                            <span className="und-warn">
                              {isArabic ? " · لم تتّسع الغرفة للبقية" : " · the floor ran out"}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* A culture that has no such piece. Khaleeji has no chair —
                    its seat is the majlis armchair — so five chairs there are
                    five armchairs, and saying so is the difference between a
                    substitution and a quiet swap. */}
                {(plan.substitutions ?? []).map((s) => (
                  <p className="und-line und-mut" key={s.requested}>
                    {isArabic
                      ? `لا يوجد ${categoryLabel(s.requested, true)} في كتالوج ${CULTURE_LABEL[s.culture]?.ar ?? s.culture} — استُخدم ${catalogItem(s.catalogId)?.nameAr ?? s.nameEn} بدلاً منه.`
                      : `${CULTURE_LABEL[s.culture]?.en ?? s.culture} has no ${categoryLabel(s.requested, false)} in DAR's catalogue — the ${(catalogItem(s.catalogId)?.nameEn ?? s.nameEn).toLowerCase()} stood in.`}
                  </p>
                ))}

                {u.requirements.length > 0 && (
                  <ul className="und-reqs">
                    {u.requirements.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}

                <p className="und-line und-mut">
                  {openings.length > 0
                    ? isArabic
                      ? `${openings.length} فتحة معروفة (باب/نافذة) رُوعيت.`
                      : `${openings.length} detected opening${openings.length === 1 ? "" : "s"} respected.`
                    : isArabic
                      ? "لم تُكتشف أبواب أو نوافذ في هذه الغرفة."
                      : "No door or window detected in this room."}
                </p>
              </section>
            );
          })()}

          {/* Cultural evidence — what DAR retrieved for this brief, and whether
              the plan actually read it. Three things are kept apart on purpose:
              retrieved knowledge (here), the model's interpretation (the notes
              and per-piece reasons below) and DAR's spatial validation (the
              "DAR adjusted the position" tags). Blurring them would turn an
              honest pipeline into a claim. */}
          {(() => {
            const evidence = plan.evidence ?? [];
            const meta = plan.evidenceMeta;
            // A backend older than this feature sends neither field; showing an
            // empty "evidence" heading would imply the lookup happened.
            if (!meta || evidence.length === 0) return null;
            return (
              <section
                className="und evid"
                aria-label={isArabic ? "الأدلة الثقافية المستخدمة" : "Cultural evidence used"}
              >
                <div className="insp-sub">
                  {isArabic ? "أدلة ثقافية" : "Cultural evidence"}
                  {!meta.injected && (
                    <span className="und-mut">
                      {isArabic
                        ? " · لم يعتمد عليها هذا التوزيع"
                        : " · not used by this plan"}
                    </span>
                  )}
                </div>
                <ul className="evid-list">
                  {evidence.map((e) => (
                    <li key={e.id}>
                      <span className="evid-el">
                        {isArabic ? e.elementAr || e.elementEn : e.elementEn}
                      </span>
                      {e.evidenceState === "unverified" && (
                        <span className="und-warn evid-flag">
                          {isArabic ? "بانتظار التوثيق" : "unverified"}
                        </span>
                      )}
                      {e.source && <span className="evid-src">{e.source}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}

          <p className="plan-notes">{isArabic ? plan.notesAr : plan.notesEn}</p>

          {/* A redesign: what DAR swapped, and the layout rules the model was
              asked to arrange the room by. The two are kept apart on purpose —
              the conversion is deterministic and always happens, the
              arrangement is the model's work and may or may not have landed.
              Stage 2 measures the second half; until then the panel states the
              rules without claiming they were satisfied. */}
          {restyled && (
            <section
              className="und"
              aria-label={isArabic ? "إعادة تصميم ثقافية" : "Cultural redesign"}
            >
              <div className="insp-sub">
                {isArabic
                  ? `أُعيد تصميمها ${CULTURE_LABEL[plan.understood.culture]?.ar ?? ""}`
                  : `Redesigned as ${CULTURE_LABEL[plan.understood.culture]?.en ?? ""}`}
              </div>
              <p className="und-line und-mut">
                {isArabic
                  ? `بُدِّلت ${restyled.changed} قطعة إلى مقابلها، وأعاد النموذج ترتيب الغرفة.`
                  : `${restyled.changed} piece${restyled.changed === 1 ? "" : "s"} swapped for their counterparts; the model rearranged the room.`}
                {restyled.unmatched > 0 && (
                  <span className="und-warn">
                    {isArabic
                      ? ` · ${restyled.unmatched} بلا مقابل، بقيت كما هي`
                      : ` · ${restyled.unmatched} had no counterpart and stayed`}
                  </span>
                )}
              </p>

              {(plan.conventions ?? []).length > 0 && (
                <>
                  <div className="insp-sub" style={{ marginTop: 8 }}>
                    {isArabic ? "أعراف التوزيع" : "Layout conventions"}
                    <span className="und-warn"> {isArabic ? "غير موثّقة" : "unverified"}</span>
                  </div>
                  <ul className="conv-rules">
                    {(plan.conventions ?? []).map((c) => (
                      <li key={c.id}>
                        <span className="conv-title">{isArabic ? c.titleAr : c.titleEn}</span>
                        {(isArabic ? c.avoidAr : c.avoidEn) && (
                          <span className="conv-avoid">
                            {isArabic ? c.avoidAr : c.avoidEn}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="und-line und-mut">
                    {isArabic
                      ? "إرشاد تحريري من قاعدة معرفة دار، بلا توثيق أو مرجع."
                      : "Editorial guidance from DAR's knowledge base — no sign-off, no citation."}
                  </p>
                </>
              )}
            </section>
          )}

          {/* Culture conversion, stated piece by piece. This is the most
              consequential thing a plan can do to a room you built — it
              replaces furniture you chose — so it is named in full before the
              Apply button, never discovered afterwards. */}
          {converted.length > 0 && (
            <section
              className="und"
              aria-label={isArabic ? "تحويل ثقافي" : "Culture conversion"}
            >
              <div className="insp-sub">
                {isArabic
                  ? `حُوّلت ${converted.length} قطعة إلى ${CULTURE_LABEL[plan.understood.culture]?.ar ?? plan.understood.culture}`
                  : `${converted.length} piece${converted.length === 1 ? "" : "s"} converted to ${CULTURE_LABEL[plan.understood.culture]?.en ?? plan.understood.culture}`}
              </div>
              <ul className="conv-list">
                {converted.map((c) => (
                  <li key={c.uid}>
                    <span className="conv-from">{isArabic ? c.fromNameAr : c.fromNameEn}</span>
                    <span className="conv-arrow" aria-hidden>
                      {isArabic ? "←" : "→"}
                    </span>
                    <span className="conv-to">{isArabic ? c.toNameAr : c.toNameEn}</span>
                    {c.substituted && (
                      <span className="und-warn conv-sub">
                        {isArabic ? "أقرب بديل" : "nearest equivalent"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="und-line und-mut">
                {isArabic
                  ? "تبقى كل قطعة في مكانها ودورانها — يتغيّر الطراز لا التوزيع."
                  : "Each piece keeps its position and rotation — the style changes, not your layout."}
              </p>
            </section>
          )}

          {/* What this plan does to pieces that are ALREADY in the room. Kept
              above the additions because taking something out or standing it
              somewhere else is the more surprising half of an edit, and the
              user should see it before they press a button that does it. */}
          {gated.removals.length > 0 && (
            <>
              <div className="insp-sub">{isArabic ? "سيُزال" : "Taken out"}</div>
              <ul className="plan-list">
                {gated.removals.map((r) => (
                  <li key={r.uid}>
                    <span className="plan-name">{isArabic ? r.labelAr : r.labelEn}</span>
                    <span className="plan-why">{isArabic ? r.reasonAr : r.reasonEn}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {gated.moves.length > 0 && (
            <>
              <div className="insp-sub">{isArabic ? "سيُنقل" : "Moved"}</div>
              <ul className="plan-list">
                {gated.moves.map((m) => (
                  <li key={m.uid}>
                    <span className="plan-name">{isArabic ? m.labelAr : m.labelEn}</span>
                    <span className="plan-why">{isArabic ? m.reasonAr : m.reasonEn}</span>
                    {m.repaired && (
                      <span className="plan-tag">
                        {isArabic ? "عدّلت دار الموضع" : "DAR adjusted the position"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {gated.placements.length > 0 && (gated.moves.length > 0 || gated.removals.length > 0) && (
            <div className="insp-sub">{isArabic ? "سيُضاف" : "Added"}</div>
          )}

          <ul className="plan-list">
            {gated.placements.map((p, i) => {
              const item = catalogItem(p.catalogId);
              return (
                <li key={`${p.catalogId}-${i}`}>
                  <span className="plan-name">
                    {isArabic ? item?.nameAr : item?.nameEn}
                  </span>
                  <span className="plan-why">{isArabic ? p.reasonAr : p.reasonEn}</span>
                  {(p.repaired || p.blocksOpening) && (
                    <span className="plan-tag">
                      {p.repaired &&
                        (isArabic ? "عدّلت دار الموضع" : "DAR adjusted the position")}
                      {p.blocksOpening && (
                        <span className="und-warn">
                          {p.repaired ? " · " : ""}
                          {isArabic
                            ? `قريب من ${p.blocksOpening.labelAr}`
                            : `close to the ${p.blocksOpening.labelEn}`}
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {(gated.dropped.length > 0 || plan.rejected.length > 0) && (
            <div className="plan-dropped">
              <div className="insp-sub">{isArabic ? "لم تُوضع" : "Not placed"}</div>
              <ul>
                {gated.dropped.map((d, i) => (
                  <li key={`d${i}`}>
                    {catalogItem(d.catalogId)?.[isArabic ? "nameAr" : "nameEn"] ?? d.catalogId}
                    {" — "}
                    {isArabic ? d.reasonAr : d.reasonEn}
                  </li>
                ))}
                {plan.rejected.map((r, i) => (
                  <li key={`r${i}`}>
                    {r.catalogId ?? "—"} — {r.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The label names what will actually happen. "Place 7 pieces" on a
              plan whose whole job was to move two of them was the panel's own
              version of the bug this feature had. */}
          {(() => {
            const total = planOperationCount(gated);
            const parts: string[] = [];
            if (gated.placements.length) {
              parts.push(
                isArabic
                  ? `إضافة ${gated.placements.length}`
                  : `add ${gated.placements.length}`,
              );
            }
            if (gated.moves.length) {
              parts.push(isArabic ? `نقل ${gated.moves.length}` : `move ${gated.moves.length}`);
            }
            if (gated.removals.length) {
              parts.push(
                isArabic ? `إزالة ${gated.removals.length}` : `remove ${gated.removals.length}`,
              );
            }
            return (
              <button
                className="plan-go"
                disabled={total === 0}
                onClick={() => {
                  onApply(gated, plan);
                  // Deliberately NOT setOpen(false). Closing here is what made
                  // the flow dead-end: the room changed, the panel vanished,
                  // and nothing on screen said the photoreal step existed at
                  // all. The panel becomes the bridge to it instead.
                  setApplied({
                    culture: plan.understood.culture,
                    intent: plan.understood.intent ?? "furnish",
                    summary: parts.join(" · "),
                  });
                }}
              >
                {total === 0
                  ? isArabic
                    ? "لا تغييرات"
                    : "Nothing to change"
                  : isArabic
                    ? `طبّق: ${parts.join(" · ")}`
                    : `Apply: ${parts.join(" · ")}`}
              </button>
            );
          })()}
          <p className="plan-foot">
            {isArabic
              ? "كل موضع تحقّقت منه محرّكة التصادم نفسها التي تحكم السحب اليدوي. يمكنك تعديل كل شيء بعد الوضع."
              : "Every position was checked by the same collision engine that governs a manual drag. You can edit all of it afterwards."}
          </p>
        </div>
      )}
    </aside>
  );
}
