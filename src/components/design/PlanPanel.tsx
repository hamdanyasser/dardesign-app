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
import { gatePlan, type GatedPlan } from "@/lib/design/planner";
import type { DesignScene } from "@/lib/design/types";

const EXAMPLES_EN = [
  "A majlis for receiving guests",
  "A quiet corner for reading",
  "Somewhere to eat and talk",
];
const EXAMPLES_AR = ["مجلس لاستقبال الضيوف", "ركن هادئ للقراءة", "مكان للأكل والحديث"];

export default function PlanPanel({
  scene,
  isArabic,
  onApply,
}: {
  scene: DesignScene;
  isArabic: boolean;
  onApply: (gated: GatedPlan) => void;
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
        existing: scene.objects
          .filter((o) => o.origin === "found")
          .map((o) => ({
            label: o.labelEn,
            xCm: Math.round(o.x),
            zCm: Math.round(o.z),
            widthCm: Math.round(o.widthCm),
            depthCm: Math.round(o.depthCm),
          })),
      });
      setPlan(result);
      // The gate: nothing is trusted until the collision engine has spoken.
      setGated(gatePlan(result.items, scene));
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
                  {p.repaired && (
                    <span className="plan-tag">
                      {isArabic ? "عُدّل الموضع" : "position adjusted"}
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
              onApply(gated);
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
