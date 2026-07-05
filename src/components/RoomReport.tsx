"use client";

/**
 * RoomReport — "The Understood Room", as a takeaway artifact.
 *
 * One click composes the whole analysis onto a branded canvas and downloads it
 * as a PNG: before/after, the detected cultural elements with their Arabic
 * terms (ontology), the top-down 2D plan, and a provenance footer. Pure
 * client-side (data URLs + <canvas>), so it works offline, in LIGHT mode, and
 * can never destabilize the demo. Prints beautifully — hand it to the panel.
 */

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";
import ontologyRaw from "@/data/ontology.json";
import type { SegRegion } from "@/components/CulturalElementHighlighter";
import type { MapObject } from "@/components/RoomMap2D";

const ONTOLOGY = ontologyRaw as Record<string, { ar?: string; en?: string; note?: string }>;

// Fixed dark-gold brand palette — the report is an artifact, not a themed page.
const INK = "#0d0d12";
const PANEL = "#14141c";
const GOLD = "#d4af37";
const GOLD_SOFT = "#f0d78c";
const CREAM = "#f5f0e8";
const MUTED = "#8a8598";

export interface RoomReportProps {
  beforeSrc: string;
  afterSrc: string;
  styleLabel: { ar: string; en: string };
  regions: SegRegion[];
  mapObjects: MapObject[];
  /** True when regions/map are backend detections rather than demo data. */
  isLive: boolean;
  jobId?: string;
  className?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Cover-fit `img` into the (x, y, w, h) box. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.globalAlpha = 1;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function composeReport(props: RoomReportProps, isArabic: boolean): Promise<string> {
  const W = 1240;
  const H = 1650;
  const M = 64; // page margin

  await document.fonts.ready;
  const [before, after] = await Promise.all([loadImage(props.beforeSrc), loadImage(props.afterSrc)]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const AR_FONT = '"Tajawal", "Noto Kufi Arabic", sans-serif';
  const EN_FONT = '"DM Sans", "Inter", sans-serif';

  // page
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.35;
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);
  ctx.globalAlpha = 1;

  // ---- header -------------------------------------------------------------
  let y = M + 30;
  ctx.textAlign = "center";
  ctx.fillStyle = GOLD;
  ctx.font = `700 44px ${AR_FONT}`;
  ctx.fillText("دار ديزاين · DarDesign", W / 2, y);
  y += 44;
  ctx.fillStyle = CREAM;
  ctx.font = `500 26px ${AR_FONT}`;
  ctx.fillText("الغرفة المفهومة — The Understood Room", W / 2, y);
  y += 30;
  ctx.fillStyle = MUTED;
  ctx.font = `400 18px ${EN_FONT}`;
  const dateStr = new Date().toLocaleDateString(isArabic ? "ar" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  ctx.fillText(`${props.styleLabel.ar} · ${props.styleLabel.en} — ${dateStr}`, W / 2, y);
  y += 26;
  ctx.strokeStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  y += 34;

  // ---- before / after -----------------------------------------------------
  const imgW = (W - M * 2 - 32) / 2;
  const imgH = imgW * 0.75;
  drawCover(ctx, before, M, y, imgW, imgH);
  drawCover(ctx, after, M + imgW + 32, y, imgW, imgH);
  ctx.fillStyle = GOLD_SOFT;
  ctx.font = `500 20px ${AR_FONT}`;
  ctx.fillText(isArabic ? "قبل · Before" : "Before · قبل", M + imgW / 2, y + imgH + 30);
  ctx.fillText(
    `${props.styleLabel.ar} · ${props.styleLabel.en}`,
    M + imgW + 32 + imgW / 2,
    y + imgH + 30,
  );
  y += imgH + 66;

  // ---- elements (left) + 2D plan (right) ----------------------------------
  const colW = (W - M * 2 - 48) / 2;
  const sectionTop = y;

  ctx.textAlign = isArabic ? "right" : "left";
  const elX = isArabic ? M + colW : M;
  const textAnchor = isArabic ? elX + colW - 0 : elX;

  ctx.fillStyle = GOLD;
  ctx.font = `700 24px ${AR_FONT}`;
  ctx.fillText(isArabic ? "العناصر الثقافية · Elements" : "Cultural elements · العناصر", isArabic ? M + colW * 2 + 48 : M, y);
  y += 36;

  const known = props.regions
    .map((r) => ({ r, info: ONTOLOGY[r.classKey] }))
    .filter((d) => d.info?.ar && d.info?.en)
    .slice(0, 6);
  for (const { info } of known) {
    ctx.fillStyle = CREAM;
    ctx.font = `600 20px ${AR_FONT}`;
    ctx.fillText(`◆ ${info!.ar} — ${info!.en}`, isArabic ? M + colW * 2 + 48 : M, y);
    y += 26;
    if (info!.note) {
      ctx.fillStyle = MUTED;
      ctx.font = `400 16px ${AR_FONT}`;
      ctx.fillText(truncate(info!.note, 58), isArabic ? M + colW * 2 + 48 : M, y);
      y += 30;
    } else {
      y += 8;
    }
  }
  if (known.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 18px ${AR_FONT}`;
    ctx.fillText(isArabic ? "لا عناصر مكتشفة" : "No detected elements", isArabic ? M + colW * 2 + 48 : M, y);
    y += 30;
  }

  // 2D plan panel (always drawn on the opposite column)
  const planX = isArabic ? M : M + colW + 48;
  const planY = sectionTop + 12;
  const planS = Math.min(colW, 420);
  ctx.fillStyle = PANEL;
  ctx.fillRect(planX, planY, planS, planS);
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.6;
  ctx.strokeRect(planX + 0.5, planY + 0.5, planS - 1, planS - 1);
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `400 14px ${AR_FONT}`;
  ctx.fillText(isArabic ? "الجدار البعيد" : "far wall", planX + planS / 2, planY + 20);
  for (const o of props.mapObjects.slice(0, 14)) {
    const info = ONTOLOGY[o.classKey];
    const w = (o.w ?? 0.08) * planS;
    const h = (o.h ?? 0.08) * planS;
    const cx = planX + o.cx * planS;
    const cy = planY + o.cy * planS;
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.globalAlpha = 1;
    if (info?.ar) {
      ctx.fillStyle = CREAM;
      ctx.font = `400 13px ${AR_FONT}`;
      ctx.fillText(info.ar, cx, cy + 4);
    }
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 14px ${AR_FONT}`;
  ctx.fillText(
    isArabic ? "المخطط العلوي ثنائي الأبعاد" : "Top-down 2D plan",
    planX + planS / 2,
    planY + planS + 24,
  );

  // ---- provenance footer ----------------------------------------------------
  const fy = H - M - 58;
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(M, fy - 28);
  ctx.lineTo(W - M, fy - 28);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `400 15px ${EN_FONT}`;
  ctx.fillText(
    `SDXL 1.0 + dual ControlNet (Depth Anything V2 · OneFormer ADE20K) + cultural LoRA${props.jobId ? ` — job ${props.jobId}` : ""}`,
    W / 2,
    fy,
  );
  ctx.font = `400 15px ${AR_FONT}`;
  ctx.fillText(
    props.isLive
      ? "العناصر والمخطط محسوبان من الخادم لهذه الغرفة · Elements & plan computed for this room"
      : "عناصر ومخطط توضيحيان (وضع المعاينة) · Illustrative elements & plan (preview mode)",
    W / 2,
    fy + 26,
  );

  return canvas.toDataURL("image/png");
}

export default function RoomReport(props: RoomReportProps) {
  const { isArabic } = useThemeLanguage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setErr(false);
    try {
      const url = await composeReport(props, isArabic);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dardesign-room-report.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-gold px-3 py-1.5 text-xs font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
        isArabic ? "font-arabic flex-row-reverse" : "font-ui",
        err && "border-[var(--error)] text-[var(--error)]",
        props.className,
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
      {err
        ? isArabic ? "تعذّر الإنشاء — أعد المحاولة" : "Failed — retry"
        : isArabic ? "تقرير الغرفة (PNG)" : "Room report (PNG)"}
    </button>
  );
}
