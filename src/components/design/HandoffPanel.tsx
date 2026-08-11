"use client";

/* ============================================================
   The way out of Build Mode.

   Build Mode's whole premise is that the AI render is the START of a
   design, not the end — so it needs a credible ending. This panel is
   that ending, and it is deliberately honest about where the seam is:

     • What IS real: the scene. Metric, structured, serializable, with
       every piece's identity, position, rotation, footprint and
       material. That file is exactly what a render endpoint needs.
     • What is NOT real yet: DAR cannot re-render a composed scene.
       /redesign takes a photograph, not a layout.

   So the panel exports the payload and says plainly that the renderer
   is not wired. Showing a "Render" button that faked a result would be
   the single most damaging thing this feature could do.
   ============================================================ */

import { useMemo } from "react";
import { catalogItem, CULTURE_LABEL } from "@/lib/design/catalog";
import { getMaterial } from "@/lib/design/materials";
import type { DesignScene } from "@/lib/design/types";

export interface RenderPayload {
  schema: "dar.scene/v3";
  room: DesignScene["room"];
  culture: string;
  provenance: DesignScene["provenance"];
  pieces: Array<{
    catalogId: string | null;
    origin: string;
    category: string;
    /** cm, room-space, centre of the footprint. */
    x: number;
    z: number;
    rotationDeg: number;
    widthCm: number;
    depthCm: number;
    heightCm: number;
    material: string;
  }>;
}

/** The exact object a render endpoint would be posted. Built here rather
 *  than serialising DesignScene wholesale so the contract is explicit and
 *  UI-only fields never leak into it. */
export function buildRenderPayload(scene: DesignScene): RenderPayload {
  return {
    schema: "dar.scene/v3",
    room: scene.room,
    culture: scene.culture,
    provenance: scene.provenance,
    pieces: scene.objects.map((o) => ({
      catalogId: o.catalogId,
      origin: o.origin,
      category: o.category,
      x: o.x,
      z: o.z,
      rotationDeg: o.rotationDeg,
      widthCm: o.widthCm,
      depthCm: o.depthCm,
      heightCm: o.heightCm,
      material: o.materialKey,
    })),
  };
}

export default function HandoffPanel({
  scene,
  isArabic,
  onClose,
}: {
  scene: DesignScene;
  isArabic: boolean;
  onClose: () => void;
}) {
  const payload = useMemo(() => buildRenderPayload(scene), [scene]);
  const placed = scene.objects.filter((o) => o.origin === "catalog");
  const found = scene.objects.filter((o) => o.origin === "found");

  const materials = useMemo(() => {
    const set = new Map<string, number>();
    for (const o of placed) set.set(o.materialKey, (set.get(o.materialKey) ?? 0) + 1);
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [placed]);

  const cultures = useMemo(() => {
    const set = new Set<string>();
    for (const o of placed) {
      const it = o.catalogId ? catalogItem(o.catalogId) : undefined;
      if (it) set.add(it.culture);
    }
    return Array.from(set);
  }, [placed]);

  const download = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dar-scene-${scene.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="handoff-scrim" role="dialog" aria-modal="true" aria-label={isArabic ? "تسليم التصميم" : "Design handoff"}>
      <div className="handoff">
        <div className="handoff-head">
          <div>
            <div className="eyebrow">{isArabic ? "التصميم جاهز" : "The design so far"}</div>
            <h2 className="handoff-title">
              {isArabic ? "غرفتك، كما صمّمتها" : "Your room, as you designed it"}
            </h2>
          </div>
          <button className="tool" onClick={onClose} aria-label={isArabic ? "إغلاق" : "Close"}>
            ✕
          </button>
        </div>

        <div className="handoff-grid">
          <dl className="handoff-stats">
            <div className="readout">
              <dt>{isArabic ? "الغرفة" : "Room"}</dt>
              <dd>
                {(scene.room.widthCm / 100).toFixed(1)} × {(scene.room.depthCm / 100).toFixed(1)} m
              </dd>
            </div>
            <div className="readout">
              <dt>{isArabic ? "المساحة" : "Floor area"}</dt>
              <dd>{scene.room.areaM2 != null ? `${scene.room.areaM2.toFixed(1)} m²` : "—"}</dd>
            </div>
            <div className="readout">
              <dt>{isArabic ? "قطع وضعتَها" : "Pieces you placed"}</dt>
              <dd>{placed.length}</dd>
            </div>
            <div className="readout">
              <dt>{isArabic ? "قطع من صورتك" : "Read from your photo"}</dt>
              <dd>{found.length}</dd>
            </div>
            <div className="readout">
              <dt>{isArabic ? "لغات التصميم" : "Design languages"}</dt>
              <dd>
                {cultures.length
                  ? cultures
                      .map((c) => (isArabic ? CULTURE_LABEL[c as "lebanese"].ar : CULTURE_LABEL[c as "lebanese"].en))
                      .join(" · ")
                  : "—"}
              </dd>
            </div>
          </dl>

          <div>
            <div className="insp-label">{isArabic ? "الخامات المستخدمة" : "Materials used"}</div>
            {materials.length === 0 ? (
              <p className="handoff-note">{isArabic ? "لم تضع أي قطعة بعد." : "Nothing placed yet."}</p>
            ) : (
              <ul className="handoff-mats">
                {materials.map(([k, n]) => {
                  const s = getMaterial(k);
                  return (
                    <li key={k}>
                      <span className="sw" style={{ background: s.hex }} aria-hidden />
                      <span>{isArabic ? s.nameAr : s.nameEn}</span>
                      <span className="ct">×{n}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* The seam, stated. */}
        <div className="handoff-truth">
          <div className="insp-label">{isArabic ? "ما التالي" : "What happens next"}</div>
          <p>
            {isArabic
              ? "هذا المشهد بيانات حقيقية بالسنتيمتر: موضع كل قطعة ودورانها وأبعادها وخامتها. هذا بالضبط ما يحتاجه محرّك العرض."
              : "This scene is real metric data — every piece's position, rotation, footprint and material in centimetres. That is exactly what a renderer needs."}
          </p>
          <p>
            <strong>
              {isArabic
                ? "لا يستطيع دار حالياً إعادة عرض مشهد مركّب."
                : "DAR cannot re-render a composed scene yet."}
            </strong>{" "}
            {isArabic
              ? "‏/redesign يأخذ صورة فوتوغرافية، لا مخطّطاً. لذلك يصدّر هذا الزر المخطّط بدل أن يدّعي عرضاً لم يحدث."
              : "/redesign takes a photograph, not a layout — so this exports the layout rather than claiming a render that did not happen."}
          </p>
        </div>

        <details className="handoff-payload">
          <summary>{isArabic ? "عرض الحمولة" : "Inspect the payload"}</summary>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>

        <div className="handoff-actions">
          <button className="tool active" onClick={download}>
            {isArabic ? "تنزيل المشهد (JSON)" : "Download scene (JSON)"}
          </button>
          <button className="tool" onClick={onClose}>
            {isArabic ? "متابعة التصميم" : "Keep designing"}
          </button>
        </div>
      </div>
    </div>
  );
}
