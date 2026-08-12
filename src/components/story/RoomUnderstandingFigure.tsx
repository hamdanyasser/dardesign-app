"use client";

import { useId, useMemo, useState } from "react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import type { ObjectMapObject, SegRegionItem } from "@/lib/api";
import type { StoryImage, StoryRoomUnderstanding } from "./types";
import styles from "./RoomUnderstandingFigure.module.css";

export interface RoomUnderstandingFigureProps {
  image: StoryImage;
  understanding?: StoryRoomUnderstanding;
  className?: string;
  /** Limits visual leaders without discarding the complete semantic ledger. */
  maxLeaders?: number;
}

function validBox(region: SegRegionItem): boolean {
  const [x, y, w, h] = region.bbox;
  return (
    [x, y, w, h, region.area].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    w > 0 &&
    h > 0 &&
    x + w <= 1 &&
    y + h <= 1 &&
    region.area >= 0
  );
}

function validObject(object: ObjectMapObject): boolean {
  return (
    [object.cx, object.cy, object.w, object.h].every(Number.isFinite) &&
    object.cx >= 0 &&
    object.cx <= 1 &&
    object.cy >= 0 &&
    object.cy <= 1 &&
    object.w > 0 &&
    object.w <= 1 &&
    object.h > 0 &&
    object.h <= 1
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function projectedRect(object: ObjectMapObject) {
  const x1 = clamp((object.cx - object.w / 2) * 100, 0, 100);
  const x2 = clamp((object.cx + object.w / 2) * 100, 0, 100);
  const y1 = clamp((object.cy - object.h / 2) * 100, 0, 100);
  const y2 = clamp((object.cy + object.h / 2) * 100, 0, 100);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export default function RoomUnderstandingFigure({
  image,
  understanding,
  className,
  maxLeaders = 7,
}: RoomUnderstandingFigureProps) {
  const { isArabic } = useThemeLanguage();
  const titleId = useId();
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [showSegmentation, setShowSegmentation] = useState(
    Boolean(understanding?.segmentationImage),
  );

  const regions = useMemo(
    () => (understanding?.regions ?? []).filter(validBox).sort((a, b) => b.area - a.area),
    [understanding?.regions],
  );
  const leaders = regions.slice(0, Math.max(0, maxLeaders));
  const objects = useMemo(
    () => (understanding?.objects ?? []).filter(validObject),
    [understanding?.objects],
  );
  const visibleImage = showSegmentation && understanding?.segmentationImage
    ? understanding.segmentationImage
    : image;
  const hasRegionEnvelope = Array.isArray(understanding?.regions);
  const hasObjectEnvelope = Array.isArray(understanding?.objects);
  const roomAnalysis = understanding?.roomAnalysis;
  const hasEvidence =
    hasRegionEnvelope ||
    hasObjectEnvelope ||
    Boolean(
      understanding?.segmentationImage ||
        understanding?.depthImage ||
        roomAnalysis,
    );
  const numberLocale = isArabic ? "ar" : "en";

  const labelForRegion = (region: SegRegionItem) =>
    isArabic ? region.labelAr || region.classKey : region.labelEn || region.classKey;
  const labelForObject = (object: ObjectMapObject) =>
    isArabic ? object.labelAr || object.classKey : object.labelEn || object.classKey;

  return (
    <figure
      className={cn(styles.root, className)}
      dir={isArabic ? "rtl" : "ltr"}
      aria-labelledby={titleId}
    >
      <div className={styles.figureHeader}>
        <div>
          <p className={styles.kicker}>
            {isArabic ? "بيانات الغرفة المُعادة" : "Returned room evidence"}
          </p>
          <h3 id={titleId} className={styles.title}>
            {isArabic ? "قراءة تقنية للمكان" : "A technical reading of the space"}
          </h3>
        </div>

        {understanding?.segmentationImage && (
          <div
            className={styles.viewSwitch}
            role="group"
            aria-label={isArabic ? "طبقة الصورة" : "Image layer"}
          >
            <button
              type="button"
              className={cn(styles.viewButton, !showSegmentation && styles.viewButtonActive)}
              aria-pressed={!showSegmentation}
              onClick={() => setShowSegmentation(false)}
            >
              {isArabic ? "الغرفة" : "Room"}
            </button>
            <button
              type="button"
              className={cn(styles.viewButton, showSegmentation && styles.viewButtonActive)}
              aria-pressed={showSegmentation}
              onClick={() => setShowSegmentation(true)}
            >
              {isArabic ? "التقسيم" : "Segmentation"}
            </button>
          </div>
        )}
      </div>

      <div className={styles.layout}>
        <div className={styles.imageStage}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={visibleImage.src}
            alt={isArabic ? visibleImage.alt.ar : visibleImage.alt.en}
            className={styles.image}
            style={{
              objectPosition: `${visibleImage.focalPoint?.x ?? 50}% ${visibleImage.focalPoint?.y ?? 50}%`,
            }}
          />

          {leaders.length > 0 && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className={styles.annotationLayer}
              aria-hidden="true"
            >
              {leaders.map((region, index) => {
                const [x, y, w, h] = region.bbox.map((v) => v * 100) as [number, number, number, number];
                const cx = clamp(x + w / 2, 2, 98);
                const cy = clamp(y + h / 2, 2, 98);
                const towardStart = cx < 50;
                const endX = towardStart ? 3 : 97;
                const elbowX = towardStart ? clamp(cx - 8, 6, 90) : clamp(cx + 8, 10, 94);
                const endY = clamp(cy + ((index % 3) - 1) * 5, 4, 96);
                const key = `${region.classKey}-${index}`;
                const active = activeRegion === key;
                return (
                  <g key={key} className={active ? styles.annotationActive : undefined}>
                    <rect x={x} y={y} width={w} height={h} rx="0.8" />
                    <polyline points={`${cx},${cy} ${elbowX},${cy} ${endX},${endY}`} />
                    <circle cx={endX} cy={endY} r="1.1" />
                    <text x={endX} y={endY - 1.8} textAnchor={towardStart ? "start" : "end"}>
                      {String(index + 1).padStart(2, "0")}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          <div className={styles.cornerMeta} aria-hidden="true">
            <span>IMG / SEG</span>
            <span>{understanding?.segmentationVersion ?? "—"}</span>
          </div>
        </div>

        <aside className={styles.ledger} aria-label={isArabic ? "سجل التحليل" : "Analysis ledger"}>
          <section className={styles.ledgerSection}>
            <div className={styles.ledgerHeading}>
              <h4>{isArabic ? "العناصر المكتشفة" : "Detected elements"}</h4>
              <span>{hasRegionEnvelope ? regions.length : "—"}</span>
            </div>
            {regions.length > 0 ? (
              <ol className={styles.regionList}>
                {regions.map((region, index) => {
                  const key = `${region.classKey}-${index}`;
                  const content = (
                    <>
                      <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                      <span>{labelForRegion(region)}</span>
                      <bdi className={styles.classKey}>{region.classKey}</bdi>
                    </>
                  );
                  return (
                    <li key={key}>
                      {index < leaders.length ? (
                        <button
                          type="button"
                          onClick={() => setActiveRegion((current) => (current === key ? null : key))}
                          className={styles.regionButton}
                          aria-pressed={activeRegion === key}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={`${styles.regionButton} ${styles.regionStatic}`}>
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={styles.empty}>
                {hasRegionEnvelope
                  ? isArabic
                    ? "لم يكتشف النظام مناطق مدعومة"
                    : "No supported regions detected"
                  : isArabic
                    ? "لا تتوفر بيانات مناطق مُعادة"
                    : "No returned region data"}
              </p>
            )}
          </section>

          <section className={styles.ledgerSection}>
            <div className={styles.ledgerHeading}>
              <h4>{isArabic ? "المخطط المكاني" : "Spatial projection"}</h4>
              <span>{hasObjectEnvelope ? objects.length : "—"}</span>
            </div>
            {objects.length > 0 ? (
              <>
                <svg
                  viewBox="0 0 100 100"
                  className={styles.plan}
                  role="img"
                  aria-label={isArabic ? "مخطط علوي تقريبي للعناصر المُعادة" : "Approximate returned top-down object projection"}
                >
                  <path d="M0 25H100M0 50H100M0 75H100M25 0V100M50 0V100M75 0V100" />
                  {objects.slice(0, 14).map((object, index) => (
                    <g key={`${object.classKey}-${index}`}>
                      <rect {...projectedRect(object)} rx="1" />
                      <text x={clamp(object.cx * 100, 3, 97)} y={clamp(object.cy * 100 + 1.5, 4, 98)}>
                        {index + 1}
                      </text>
                    </g>
                  ))}
                </svg>
                <ul className={styles.objectList}>
                  {objects.slice(0, 8).map((object, index) => (
                    <li key={`${object.classKey}-${index}`}>
                      <span>{index + 1}</span>
                      {labelForObject(object)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.empty}>
                {hasObjectEnvelope
                  ? isArabic
                    ? "لم يُعِد النظام عناصر مكانية مدعومة"
                    : "No supported spatial objects returned"
                  : isArabic
                    ? "لا تتوفر بيانات مخطط مكاني مُعادة"
                    : "No returned spatial-map data"}
              </p>
            )}
          </section>

          {roomAnalysis && (
            <section className={styles.ledgerSection}>
              <div className={styles.ledgerHeading}>
                <h4>{isArabic ? "تحليل الغرفة المحسوب" : "Computed room analysis"}</h4>
                <span>ROOM</span>
              </div>
              <dl className={styles.analysisFacts}>
                <div>
                  <dt>{isArabic ? "نسبة الأرضية الحرة" : "Free-floor ratio"}</dt>
                  <dd dir="ltr">
                    {Number.isFinite(roomAnalysis.free_floor_ratio) &&
                    roomAnalysis.free_floor_ratio >= 0 &&
                    roomAnalysis.free_floor_ratio <= 1
                      ? new Intl.NumberFormat(numberLocale, {
                          style: "percent",
                          maximumFractionDigits: 1,
                        }).format(roomAnalysis.free_floor_ratio)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{isArabic ? "مواقع الوضع المرشحة" : "Placement candidates"}</dt>
                  <dd dir="ltr">
                    {Array.isArray(roomAnalysis.candidates)
                      ? new Intl.NumberFormat(numberLocale).format(roomAnalysis.candidates.length)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{isArabic ? "الفئات الموجودة" : "Existing categories"}</dt>
                  <dd dir="ltr">
                    {Array.isArray(roomAnalysis.existing_categories)
                      ? new Intl.NumberFormat(numberLocale).format(roomAnalysis.existing_categories.length)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{isArabic ? "ثقة المقياس" : "Scale confidence"}</dt>
                  <dd dir="ltr">
                    {Number.isFinite(roomAnalysis.scale_confidence) &&
                    roomAnalysis.scale_confidence >= 0 &&
                    roomAnalysis.scale_confidence <= 1
                      ? new Intl.NumberFormat(numberLocale, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        }).format(roomAnalysis.scale_confidence)
                      : "—"}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {understanding?.depthImage && (
            <section className={styles.depthFact}>
              <span className={styles.depthLine} aria-hidden="true" />
              <p>{isArabic ? "أُعيدت خريطة عمق حقيقية مع هذه النتيجة." : "A real depth map was returned with this result."}</p>
            </section>
          )}
        </aside>
      </div>

      {!hasEvidence && (
        <figcaption className={styles.noEvidence}>
          {isArabic
            ? "لم تُعَد بيانات لفهم الغرفة. تبقى الصورة الأصلية ظاهرة بلا طبقات مختلقة."
            : "No room-understanding data was returned. The original remains visible without invented overlays."}
        </figcaption>
      )}
    </figure>
  );
}
