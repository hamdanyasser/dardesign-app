"use client";

/* ============================================================
   The way out of Build Mode.

   Build Mode's premise is that the AI render is the START of a design,
   not the end, so it needs a credible ending. This panel is that ending:
   it renders the composed scene into the two ControlNet images the
   generator already conditions on and posts them to /render-scene.

   The evidence strip is the argument. Showing the depth and segmentation
   maps beside the result is what turns "the AI respected my layout" from
   a claim into something the viewer can check — those maps ARE the
   layout signal, so a sofa's silhouette visible in the seg map and again
   in the render is proof rather than marketing.

   Two rules this file exists to keep:
     • The conditioning is captured and shown BEFORE the request, so the
       evidence survives a backend that is down.
     • A placeholder result is labelled as one. A LIGHT backend returns
       placeholder:true and the copy says the image is not a real render.
       Passing a stand-in off as output would be the single most damaging
       thing this feature could do.
   ============================================================ */

import { useCallback, useMemo, useState } from "react";
import {
  ApiError,
  checkRenderHost,
  renderEndpoint,
  renderScene,
  type SceneRenderResult,
} from "@/lib/api";
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

export interface Conditioning {
  depth: string;
  seg: string;
  beauty: string;
  meta: { width: number; height: number };
}

export default function HandoffPanel({
  scene,
  isArabic,
  onClose,
  capture,
  renderIntent,
}: {
  scene: DesignScene;
  isArabic: boolean;
  onClose: () => void;
  /** What the planner understood that the generator can act on: a room type
   *  the prompt builder knows, and the LoRA scale /restyle already exposes.
   *  Both optional — a hand-built room simply renders on the defaults. */
  renderIntent?: { roomType: string; intensity: number | null };
  /** Renders the live 3D scene into ControlNet conditioning. Absent only if
   *  the canvas has not mounted, in which case rendering is not offered. */
  capture?: (w: number, h: number) => Conditioning;
}) {
  const [cond, setCond] = useState<Conditioning | null>(null);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<SceneRenderResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const culture = scene.culture === "all" ? "lebanese" : scene.culture;

  const doRender = useCallback(async () => {
    if (!capture) return;
    setErr(null);
    setResult(null);
    // Capture first and show it immediately: the conditioning is real evidence
    // and does not depend on the backend being reachable, so the user sees what
    // is being preserved even if the render itself fails.
    const c = capture(1024, 768);
    setCond(c);
    setRendering(true);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const r = await renderScene(c.depth, c.seg, culture, {
        room: renderIntent?.roomType || "living room",
        scale: renderIntent?.intensity ?? null,
      });
      setResult(r);
    } catch (e) {
      /* A guessed cause is worse than an unknown one. This used to print "could
         not reach the renderer — the tunnel URL rotates" for ANY error that was
         not an ApiError, so a mid-render timeout, an aborted request and a
         genuinely dead tunnel were indistinguishable. Measured 2026-08-14: that
         message named a tunnel whose /healthz answered 200 and which completed a
         real 31s render seconds later, and it sent an hour into re-pointing a URL
         that was already correct.

         So: ask the host before blaming it, and otherwise say what actually
         threw and how long it ran. Same discipline as plan.warning — the honest
         report of a failure is what makes the next one diagnosable. */
      let msg: string;
      if (e instanceof ApiError) {
        msg = isArabic ? e.message_ar : e.message_en;
      } else {
        const secs = Math.round((Date.now() - t0) / 1000);
        const host = await checkRenderHost();
        const name = e instanceof Error ? e.name : "Error";
        const detail = e instanceof Error && e.message ? e.message : String(e);
        if (!host.reachable) {
          msg = isArabic
            ? `تعذّر الوصول إلى محرك العرض على ${renderEndpoint()} (${name} بعد ${secs}ث). عنوان النفق يتغيّر كل جلسة — أعد تعيينه عبر npm run dev:tunnel.`
            : `Could not reach the renderer at ${renderEndpoint()} (${name} after ${secs}s). The tunnel URL rotates each session — re-point it with npm run dev:tunnel.`;
        } else {
          // The host answered, so the URL is fine and re-pointing it would be a
          // wild goose chase. A render that dies while the host stays healthy is
          // usually the connection being dropped mid-flight.
          msg = isArabic
            ? `المحرك يستجيب، لكن العرض فشل بعد ${secs}ث: ${name} — ${detail}. غالبًا انقطع الاتصال أثناء العرض؛ أعد المحاولة.`
            : `The renderer is reachable, but the render failed after ${secs}s: ${name} — ${detail}. That usually means the connection dropped mid-render rather than a bad URL; try again.`;
        }
      }
      setErr(msg);
    } finally {
      clearInterval(tick);
      setRendering(false);
    }
  }, [capture, culture, isArabic]);

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

        {/* ---- Render with DAR ---- */}
        <div className="handoff-truth">
          <div className="insp-label">{isArabic ? "العرض بواسطة دار" : "Render with DAR"}</div>
          <p>
            {isArabic
              ? "تُحوَّل غرفتك إلى صورتَي تحكّم — خريطة عمق وخريطة تقسيم دلالي — وهما بالضبط ما يشترطه محرّك التوليد. لذلك يُشتق التخطيط من تصميمك بدل أن يُستنتج من وصف نصّي."
              : "Your room is rendered into the two control images the generator already conditions on — a depth map and a semantic segmentation map. Layout comes from your design as control signal, not from a sentence describing it."}
          </p>

          <div className="handoff-actions" style={{ marginTop: 12 }}>
            <button className="tool active" onClick={doRender} disabled={rendering || !capture}>
              {rendering
                ? isArabic
                  ? `جارٍ العرض… ${elapsed}s`
                  : `Rendering… ${elapsed}s`
                : isArabic
                  ? "اعرض بواسطة دار"
                  : "Render with DAR"}
            </button>
            {!capture && (
              <span className="handoff-note">
                {isArabic ? "المشهد غير جاهز بعد." : "The scene is not ready yet."}
              </span>
            )}
          </div>

          {err && (
            <p style={{ color: "#ff8a72", fontSize: "0.76rem", marginTop: 8 }} role="alert">
              {err}
            </p>
          )}

          {cond && (
            <>
              <div className="insp-label" style={{ marginTop: 16 }}>
                {isArabic ? "ما الذي يُحفَظ فعلاً" : "What is actually preserved"}
              </div>
              <div className="cond-grid">
                <figure>
                  <img src={cond.beauty} alt={isArabic ? "تصميمك" : "Your design"} />
                  <figcaption>{isArabic ? "تصميمك" : "Your design"}</figcaption>
                </figure>
                <figure>
                  <img src={cond.depth} alt={isArabic ? "خريطة العمق" : "Depth control"} />
                  <figcaption>{isArabic ? "العمق · هندسة" : "Depth · geometry"}</figcaption>
                </figure>
                <figure>
                  <img src={cond.seg} alt={isArabic ? "خريطة التقسيم" : "Segmentation control"} />
                  <figcaption>{isArabic ? "التقسيم · هوية القطع" : "Segments · identity"}</figcaption>
                </figure>
                {result && (
                  <figure>
                    <img src={result.image} alt={isArabic ? "نتيجة دار" : "DAR render"} />
                    <figcaption className={result.placeholder ? "warn" : "good"}>
                      {result.placeholder
                        ? isArabic
                          ? "بديل — لا وحدة GPU"
                          : "Stand-in — no GPU"
                        : isArabic
                          ? `عرض دار · ${result.durationS ?? "—"}s`
                          : `DAR render · ${result.durationS ?? "—"}s`}
                    </figcaption>
                  </figure>
                )}
              </div>
            </>
          )}

          {result?.placeholder && (
            <p style={{ marginTop: 10 }}>
              <strong>
                {isArabic
                  ? "هذه ليست نتيجة حقيقية."
                  : "That last image is not a real render."}
              </strong>{" "}
              {isArabic
                ? "الخادم المتصل يعمل بوضع DARDESIGN_LIGHT بلا وحدة GPU، فأعاد صورة بديلة. صورتا التحكّم إلى اليسار حقيقيتان ومأخوذتان من مشهدك."
                : "The connected backend is running DARDESIGN_LIGHT with no GPU, so it returned a placeholder. The control images beside it are real, and were rendered from your scene."}
            </p>
          )}

          <div className="insp-label" style={{ marginTop: 16 }}>
            {isArabic ? "حدود هذا العرض" : "What this can and cannot hold"}
          </div>
          <p>
            {isArabic
              ? "المحفوظ: مواضع القطع واتجاهاتها، هندسة الغرفة، ونقطة النظر — لأنها إشارة التحكّم نفسها. غير المضمون: مظهر كل قطعة على حدة؛ يخترع النموذج التفاصيل داخل الصورة الظلّية التي يتلقّاها، وتصل الخامات عبر النص فتوجّه ولا تُلزِم."
              : "Held: placement, orientation, room geometry and viewpoint — they are the control signal itself. Not guaranteed: the appearance of any individual piece. The model invents surface and ornament inside the silhouette it is given, and material choices reach it through the prompt, so they steer rather than bind."}
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
