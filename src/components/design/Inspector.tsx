"use client";

/* ============================================================
   The inspector.

   Appears only when something is selected — including the room itself,
   which is why "select a wall" is a real action here rather than a
   highlight. Shows measurements DAR actually has and says "—" for the
   ones it does not, following the same rule as the rest of the app.
   ============================================================ */

import { catalogItem } from "@/lib/design/catalog";
import {
  FLOOR_CHOICES,
  WALL_CHOICES,
  getMaterial,
  materialChoicesFor,
} from "@/lib/design/materials";
import { SNAP_ROTATION_DEG } from "@/lib/design/placement";
import type { DesignScene, PlacedObject } from "@/lib/design/types";

interface Common {
  isArabic: boolean;
}

export function ObjectInspector({
  isArabic,
  object,
  onMaterial,
  onRotate,
  onDuplicate,
  onRemove,
  onToggleLock,
}: Common & {
  object: PlacedObject;
  onMaterial: (key: string) => void;
  onRotate: (deg: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onToggleLock: () => void;
}) {
  const item = object.catalogId ? catalogItem(object.catalogId) : undefined;
  const found = object.origin === "found";
  const choices = materialChoicesFor(object.category);
  const mat = getMaterial(object.materialKey);

  return (
    <aside className="inspector" aria-label={isArabic ? "خصائص العنصر" : "Object properties"}>
      <div className="insp-head">
        <div style={{ minWidth: 0 }}>
          <div className="insp-title">{isArabic ? object.labelAr : object.labelEn}</div>
          <div className="insp-sub">
            {found
              ? isArabic
                ? "من صورتك · تقريبي"
                : "From your photo · approximate"
              : isArabic
                ? object.category.replace(/_/g, " ")
                : object.category.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {found && (
        <p style={{ fontSize: "0.7rem", lineHeight: 1.5, color: "var(--fg-mute)", margin: "0 0 4px" }}>
          {isArabic
            ? "قرأت دار هذا العنصر من صورتك. الأبعاد مُسقطة من خريطة العمق، والارتفاع تقديري."
            : "DAR read this from your photograph. Its footprint is projected from the depth map; its height is an ordinary value for its class, not a measurement."}
        </p>
      )}

      <div className="insp-section">
        <div className="insp-label">{isArabic ? "الأبعاد" : "Dimensions"}</div>
        <dl style={{ margin: 0 }}>
          <div className="readout">
            <dt>{isArabic ? "العرض" : "Width"}</dt>
            <dd>{object.widthCm} cm</dd>
          </div>
          <div className="readout">
            <dt>{isArabic ? "العمق" : "Depth"}</dt>
            <dd>{object.depthCm} cm</dd>
          </div>
          <div className="readout">
            <dt>{isArabic ? "الارتفاع" : "Height"}</dt>
            <dd>
              {object.heightCm} cm{found ? " ≈" : ""}
            </dd>
          </div>
          <div className="readout">
            <dt>{isArabic ? "الموضع" : "Position"}</dt>
            <dd>
              {Math.round(object.x)}, {Math.round(object.z)}
            </dd>
          </div>
          {found && (
            <div className="readout">
              <dt>{isArabic ? "الثقة" : "Confidence"}</dt>
              <dd>{object.confidence != null ? `${Math.round(object.confidence * 100)}%` : "—"}</dd>
            </div>
          )}
        </dl>
      </div>

      {!found && (
        <>
          <div className="insp-section">
            <div className="insp-label">{isArabic ? "الدوران" : "Rotation"}</div>
            <div className="rotrow">
              <input
                type="range"
                min={0}
                max={345}
                step={SNAP_ROTATION_DEG}
                value={object.rotationDeg}
                onChange={(e) => onRotate(Number(e.target.value))}
                aria-label={isArabic ? "زاوية الدوران" : "Rotation angle"}
              />
              <span style={{ fontFamily: "var(--f-mono)", fontSize: "0.65rem", color: "var(--fg-soft)", width: 38 }}>
                {object.rotationDeg}°
              </span>
            </div>
          </div>

          <div className="insp-section">
            <div className="insp-label">
              {isArabic ? "الخامة" : "Material"} · {isArabic ? mat.nameAr : mat.nameEn}
            </div>
            <div className="swatches">
              {choices.map((k) => {
                const s = getMaterial(k);
                return (
                  <button
                    key={k}
                    className="swatch"
                    style={{ background: s.hex }}
                    aria-pressed={object.materialKey === k}
                    aria-label={isArabic ? s.nameAr : s.nameEn}
                    title={`${isArabic ? s.nameAr : s.nameEn} — ${s.source}`}
                    onClick={() => onMaterial(k)}
                  />
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontFamily: "var(--f-mono)", fontSize: "0.5rem", letterSpacing: "0.08em", color: "var(--fg-faint)" }}>
              {mat.source}
            </div>
          </div>
        </>
      )}

      {item && (
        <div className="insp-section">
          <div className="insp-label">{isArabic ? "من الأنطولوجيا" : "From the ontology"}</div>
          <p style={{ fontSize: "0.71rem", lineHeight: 1.5, color: "var(--fg-mute)", margin: 0 }}>
            {isArabic ? item.descriptionAr : item.descriptionEn}
          </p>
          {item.mustTouchWall && (
            <p style={{ fontSize: "0.66rem", color: "var(--brass)", marginTop: 6, marginBottom: 0 }}>
              {isArabic ? "يجب أن يلامس الجدار" : "Must sit against a wall"}
            </p>
          )}
        </div>
      )}

      <div className="insp-section" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {found ? (
          <button className="tool" onClick={onToggleLock}>
            {object.locked
              ? isArabic
                ? "فتح للتحرير"
                : "Unlock"
              : isArabic
                ? "قفل"
                : "Lock"}
          </button>
        ) : (
          <button className="tool" onClick={onDuplicate}>
            {isArabic ? "تكرار" : "Duplicate"}
          </button>
        )}
        <button className="tool danger" onClick={onRemove}>
          {isArabic ? "حذف" : "Remove"}
        </button>
      </div>

      {object.locked && found && (
        <p style={{ fontSize: "0.64rem", lineHeight: 1.45, color: "var(--fg-faint)", margin: "8px 0 0" }}>
          {isArabic
            ? "مقفل لأنه يصف غرفتك كما هي. افتحه لتعامله كقرار تصميمي."
            : "Locked because it describes your room as it is. Unlock to treat it as a design decision."}
        </p>
      )}
    </aside>
  );
}

export function RoomInspector({
  isArabic,
  scene,
  onFloor,
  onWall,
  onResize,
  onClose,
}: Common & {
  scene: DesignScene;
  onFloor: (k: string) => void;
  onWall: (k: string) => void;
  onResize: (w?: number, d?: number) => void;
  onClose: () => void;
}) {
  const { room, provenance } = scene;
  const areaLabel = room.areaM2 != null ? `${room.areaM2.toFixed(1)} m²` : "—";

  return (
    <aside className="inspector" aria-label={isArabic ? "خصائص الغرفة" : "Room properties"}>
      <div className="insp-head">
        <div>
          <div className="insp-title">{isArabic ? "الغرفة" : "The room"}</div>
          <div className="insp-sub">
            {provenance.shellSource === "measured"
              ? isArabic
                ? "مقاسة من صورتك"
                : "Measured from your photo"
              : provenance.shellSource === "estimated"
                ? isArabic
                  ? "مقدَّرة · ثقة منخفضة"
                  : "Estimated · low confidence"
                : isArabic
                  ? "غرفة افتراضية"
                  : "Default room"}
          </div>
        </div>
        <span className="spacer" />
        <button className="tool" onClick={onClose} aria-label={isArabic ? "إغلاق" : "Close"}>
          ✕
        </button>
      </div>

      <div className="insp-section">
        <div className="insp-label">{isArabic ? "القياسات" : "Measurements"}</div>
        <dl style={{ margin: 0 }}>
          <div className="readout">
            <dt>{isArabic ? "المساحة" : "Floor area"}</dt>
            <dd>{areaLabel}</dd>
          </div>
          <div className="readout">
            <dt>{isArabic ? "ثقة المقياس" : "Scale confidence"}</dt>
            <dd>
              {room.scaleConfidence != null ? `${Math.round(room.scaleConfidence * 100)}%` : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="insp-section">
        <div className="insp-label">
          {isArabic ? "العرض" : "Width"} · {room.widthCm} cm
        </div>
        <input
          type="range"
          min={260}
          max={1100}
          step={10}
          value={room.widthCm}
          onChange={(e) => onResize(Number(e.target.value), undefined)}
          aria-label={isArabic ? "عرض الغرفة" : "Room width"}
        />
        <div className="insp-label" style={{ marginTop: 8 }}>
          {isArabic ? "العمق" : "Depth"} · {room.depthCm} cm
        </div>
        <input
          type="range"
          min={260}
          max={1100}
          step={10}
          value={room.depthCm}
          onChange={(e) => onResize(undefined, Number(e.target.value))}
          aria-label={isArabic ? "عمق الغرفة" : "Room depth"}
        />
      </div>

      <div className="insp-section">
        <div className="insp-label">{isArabic ? "الأرضية" : "Floor"}</div>
        <div className="swatches">
          {FLOOR_CHOICES.map((k) => {
            const s = getMaterial(k);
            return (
              <button
                key={k}
                className="swatch"
                style={{ background: s.hex }}
                aria-pressed={room.floorMaterialKey === k}
                aria-label={isArabic ? s.nameAr : s.nameEn}
                title={`${isArabic ? s.nameAr : s.nameEn} — ${s.source}`}
                onClick={() => onFloor(k)}
              />
            );
          })}
        </div>
      </div>

      <div className="insp-section">
        <div className="insp-label">{isArabic ? "الجدران" : "Walls"}</div>
        <div className="swatches">
          {WALL_CHOICES.map((k) => {
            const s = getMaterial(k);
            return (
              <button
                key={k}
                className="swatch"
                style={{ background: s.hex }}
                aria-pressed={room.wallMaterialKey === k}
                aria-label={isArabic ? s.nameAr : s.nameEn}
                title={`${isArabic ? s.nameAr : s.nameEn} — ${s.source}`}
                onClick={() => onWall(k)}
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
}
