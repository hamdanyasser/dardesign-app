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
import { ApiError, fetchPlannerStatus, planLayout, type DesignPlan } from "@/lib/api";
import { catalogItem } from "@/lib/design/catalog";
import { getMaterial } from "@/lib/design/materials";
import { gatePlan, type GatedPlan } from "@/lib/design/planner";
import type { WallOpening } from "@/lib/design/roomModel";
import type { DesignScene } from "@/lib/design/types";

const CULTURE_LABEL: Record<string, { en: string; ar: string }> = {
  lebanese: { en: "Lebanese", ar: "لبناني" },
  khaleeji: { en: "Khaleeji", ar: "خليجي" },
  moroccan: { en: "Moroccan", ar: "مغربي" },
  all: { en: "All three", ar: "الثلاثة" },
};

const EXAMPLES_EN = [
  "A majlis for receiving guests",
  "A quiet corner for reading",
  "Somewhere to eat and talk",
];
const EXAMPLES_AR = ["مجلس لاستقبال الضيوف", "ركن هادئ للقراءة", "مكان للأكل والحديث"];

export default function PlanPanel({
  scene,
  openings,
  shellSource,
  isArabic,
  onApply,
}: {
  scene: DesignScene;
  openings: WallOpening[];
  shellSource: string;
  isArabic: boolean;
  onApply: (gated: GatedPlan, plan: DesignPlan) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DesignPlan | null>(null);
  const [gated, setGated] = useState<GatedPlan | null>(null);
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

  async function run() {
    setBusy(true);
    setError(null);
    setPlan(null);
    setGated(null);
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
      });
      setPlan(result);
      // The gate: nothing is trusted until the collision engine has spoken.
      setGated(gatePlan(result.items, scene, openings));
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
            ? "يخطّط…"
            : "Planning…"
          : isArabic
            ? "خطِّط الغرفة"
            : "Plan the room"}
      </button>

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

          <button
            className="plan-go"
            disabled={gated.placements.length === 0}
            onClick={() => {
              onApply(gated, plan);
              setOpen(false);
            }}
          >
            {isArabic
              ? `ضَع ${gated.placements.length} قطعة`
              : `Place ${gated.placements.length} piece${gated.placements.length === 1 ? "" : "s"}`}
          </button>
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
