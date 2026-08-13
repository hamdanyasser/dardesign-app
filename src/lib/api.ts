"use client";

/**
 * DarDesign API client. Single source of truth for every backend call.
 *
 * Reads `NEXT_PUBLIC_API_URL` (e.g. the ngrok tunnel). Falls back to
 * `http://localhost:8000` for pure-local dev.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";

/**
 * Where accounts, saved designs and ratings live — the data that has to outlive
 * a GPU session. Defaults to API_URL, so a single-backend setup behaves exactly
 * as before. Point `NEXT_PUBLIC_DATA_API_URL` at a backend on this machine to
 * keep the SQLite file and `images/` local while renders still come from a
 * throwaway GPU host, whose container is wiped between sessions.
 *
 * Renders (/redesign, /restyle) and room compute (/api/furniture/*) stay on
 * API_URL: they need the GPU and hold no durable state.
 */
const DATA_API_URL =
  process.env.NEXT_PUBLIC_DATA_API_URL?.replace(/\/+$/, "") ?? API_URL;

const COMMON_HEADERS = {
  // ngrok injects an HTML interstitial unless this header is set on every call
  "ngrok-skip-browser-warning": "true",
};

export type StyleId = "lebanese" | "khaleeji" | "moroccan";

export type JobStatusName = "pending" | "queued" | "running" | "done" | "error";

export interface ApiErrorPayload {
  code: string;
  message_en: string;
  message_ar: string;
}

export class ApiError extends Error {
  code: string;
  message_en: string;
  message_ar: string;
  http_status: number;

  constructor(payload: ApiErrorPayload, http_status: number) {
    super(payload.message_en);
    this.code = payload.code;
    this.message_en = payload.message_en;
    this.message_ar = payload.message_ar;
    this.http_status = http_status;
  }
}

/**
 * Studio edit actions (colour control, furniture placement) act on a job that
 * only exists in the render backend's memory. If that process restarts
 * mid-session — a real failure mode this app cannot recover from without a
 * fresh generation, since the depth/segmentation data behind it is never
 * persisted — the backend correctly reports "job_not_found", but that raw
 * string doesn't say why or what to do about it. This turns it into an
 * honest, actionable message instead of hiding or inventing a recovery.
 */
export function describeEditError(
  e: unknown,
  fallback: { en: string; ar: string },
): { en: string; ar: string } {
  if (e instanceof ApiError) {
    if (e.code === "job_not_found") {
      return {
        en: "This design session is no longer available on the server (it may have restarted). Redesign the room to continue editing.",
        ar: "لم تعد جلسة التصميم هذه متاحة على الخادم (قد يكون قد أعيد تشغيله). أعد تصميم الغرفة لمتابعة التعديل.",
      };
    }
    return { en: e.message_en, ar: e.message_ar };
  }
  return fallback;
}

async function unwrap(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // FastAPI puts our payload at .detail
  const candidate =
    body && typeof body === "object" && "detail" in body
      ? (body as { detail: unknown }).detail
      : body;
  if (
    candidate &&
    typeof candidate === "object" &&
    "code" in candidate &&
    "message_en" in candidate &&
    "message_ar" in candidate
  ) {
    throw new ApiError(candidate as ApiErrorPayload, res.status);
  }
  throw new ApiError(
    {
      code: "network_error",
      message_en: `Request failed (${res.status})`,
      message_ar: "فشل الاتصال بالخادم",
    },
    res.status,
  );
}

async function safeFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    // A caller that abandoned its own request has not lost the server. Wrapping
    // this as "cannot reach server" would put a red banner on the screen every
    // time a filter was changed twice in a row.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // Network / CORS / tunnel-down: surface as a typed error
    throw new ApiError(
      {
        code: "network_unreachable",
        message_en: `Cannot reach the data service at ${DATA_API_URL}. Start the local backend or configure NEXT_PUBLIC_DATA_API_URL.`,
        message_ar: "تعذّر الاتصال بخدمة البيانات. شغّل الخادم المحلي أو اضبط NEXT_PUBLIC_DATA_API_URL.",
      },
      0,
    );
  }
}

export interface UploadResponse {
  job_id: string;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await safeFetch(`${API_URL}/upload`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: fd,
  });
  return (await unwrap(res)) as UploadResponse;
}

export async function startTransform(
  jobId: string,
  style: StyleId,
  options: { seed?: number; room?: string } = {},
): Promise<UploadResponse> {
  const res = await safeFetch(`${API_URL}/transform`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, style, ...options }),
  });
  return (await unwrap(res)) as UploadResponse;
}

export async function retryJob(
  jobId: string,
  style: StyleId,
  options: { seed?: number; room?: string } = {},
): Promise<UploadResponse> {
  const res = await safeFetch(`${API_URL}/retry/${jobId}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, style, ...options }),
  });
  return (await unwrap(res)) as UploadResponse;
}

export interface JobStatus {
  job_id: string;
  status: JobStatusName;
  progress: number;
  style: StyleId | null;
  error_code: string | null;
  error_message_en: string | null;
  error_message_ar: string | null;
}

export async function getStatus(jobId: string): Promise<JobStatus> {
  const res = await safeFetch(`${API_URL}/status/${jobId}`, {
    headers: COMMON_HEADERS,
  });
  return (await unwrap(res)) as JobStatus;
}

export function resultUrl(jobId: string): string {
  return `${API_URL}/result/${jobId}`;
}

export interface ShareTokenResponse {
  token: string;
  expires_in_seconds: number;
}

export async function mintShareToken(jobId: string): Promise<ShareTokenResponse> {
  const res = await safeFetch(`${API_URL}/share-token/${jobId}`, {
    headers: COMMON_HEADERS,
  });
  return (await unwrap(res)) as ShareTokenResponse;
}

export function shareLink(token: string): string {
  return `${API_URL}/share/${token}`;
}

/**
 * Fetch the result PNG as a Blob (works around `<img>` not supporting
 * `ngrok-skip-browser-warning` headers natively). Returns an object URL the
 * caller should revoke when no longer needed.
 */
export async function fetchResultBlob(jobId: string): Promise<string> {
  const res = await safeFetch(resultUrl(jobId), { headers: COMMON_HEADERS });
  if (!res.ok) {
    await unwrap(res); // throws ApiError
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Poll /status until done|error, or until aborted. Calls onUpdate after each
 * poll; resolves with the terminal status. Stops cleanly when the AbortSignal
 * fires.
 */
export async function pollStatus(
  jobId: string,
  {
    intervalMs = 1000,
    timeoutMs = 120_000,
    signal,
    onUpdate,
  }: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onUpdate?: (s: JobStatus) => void;
  } = {},
): Promise<JobStatus> {
  const started = Date.now();
  while (true) {
    if (signal?.aborted) {
      throw new ApiError(
        { code: "aborted", message_en: "Polling aborted", message_ar: "تم إلغاء المراقبة" },
        0,
      );
    }
    const s = await getStatus(jobId);
    onUpdate?.(s);
    if (s.status === "done" || s.status === "error") return s;
    if (Date.now() - started > timeoutMs) {
      throw new ApiError(
        {
          code: "timeout",
          message_en: "Generation timed out",
          message_ar: "انتهت مهلة التوليد",
        },
        0,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* -------------------------------------------------------------------------- */
/*  POST /redesign — synchronous, one-shot, all three styles at once.         */
/* -------------------------------------------------------------------------- */

/** One detected object on the top-down plan (backend/projection.py). */
export interface ObjectMapObject {
  classKey: string;
  labelEn: string;
  labelAr: string;
  /** Normalized 0..1; cy=0 is the far wall, matching RoomMap2D. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Fraction of image pixels the blob covers. */
  area: number;
  /** 0..1 depth-coherence heuristic. */
  confidence: number;
}

/** Envelope produced by to_room_map_payload() in backend/projection.py. */
export interface ObjectMapPayload {
  jobId: string;
  style: string;
  objects: ObjectMapObject[];
  version: string;
  /** True when DARDESIGN_LIGHT returned a synthetic layout, not detections. */
  placeholder?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  GET /audit — the render audit trail (metadata only, never image bytes).   */
/* -------------------------------------------------------------------------- */

export interface AuditEvent {
  ts: string;
  event: string;
  job_id?: string;
  ok?: boolean;
  style?: string;
  styles?: string[];
  scale?: number;
  duration_s?: number;
  light?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function fetchAuditLog(limit = 50, token?: string): Promise<AuditEvent[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (token) qs.set("token", token);
  const res = await safeFetch(`${API_URL}/audit?${qs}`, { headers: COMMON_HEADERS });
  return (await unwrap(res)) as AuditEvent[];
}

/** One on-image highlighter region (backend/projection.py seg_bounding_boxes). */
export interface SegRegionItem {
  classKey: string;
  labelEn: string;
  labelAr: string;
  /** [x, y, w, h] in normalized 0..1 image coordinates. */
  bbox: [number, number, number, number];
  /** Fraction of image pixels the blob covers. */
  area: number;
}

/** Envelope produced by to_seg_regions_payload() in backend/projection.py. */
export interface SegRegionsPayload {
  jobId: string;
  regions: SegRegionItem[];
  version: string;
  /** True when DARDESIGN_LIGHT returned a synthetic layout, not detections. */
  placeholder?: boolean;
}

/**
 * The shape returned by `POST /redesign`. Every image value is a base64 PNG
 * **data URL** (e.g. `data:image/png;base64,…`), so it can be dropped straight
 * into an `<img src>` or an `<a download href>` — no extra fetch, no
 * ngrok-header dance like the legacy `/result` blob endpoint needed.
 */
export interface RedesignResult {
  original: string;
  /** Null when that culture wasn't requested — see `styles`. */
  lebanese?: string | null;
  khaleeji?: string | null;
  moroccan?: string | null;
  /** Which cultures this result actually carries. Render from this rather than
   *  guessing from which image fields happen to be present. */
  styles?: StyleId[];
  /** 2D top-down object map (Week 2). Null/absent when projection fails. */
  object_map?: ObjectMapPayload | null;
  /** On-image highlighter regions from the same seg pass. Null on failure. */
  seg_regions?: SegRegionsPayload | null;
  /** Grayscale depth PNG data URL (brighter = closer) for DepthOrbit. */
  depth_map?: string | null;
  /** Placement masks summary. Null when the depth/seg pass or analysis failed. */
  room_analysis?: RoomAnalysisSummary | null;
  /** Needed by the furniture endpoints, which look the cached analysis up by job. */
  job_id?: string | null;
  /** Server-measured generation time. Absent on older backends. */
  duration_s?: number | null;
  /** Structure preservation per style, 0..1 — did the room survive the restyle?
   *  Same measure the offline evaluation suite uses. Absent on older backends. */
  ssim?: Record<string, number> | null;
  /** True in DARDESIGN_LIGHT: images are tinted stand-ins, not real renders. */
  placeholder?: boolean | null;
}

const REDESIGN_STYLE_KEYS = ["lebanese", "khaleeji", "moroccan"] as const;

/**
 * Send a room photo to the backend and get back the original plus all three
 * cultural redesigns in a single request.
 *
 * The backend runs three generations sequentially, so a call routinely takes
 * ~1–2 minutes warm — and longer on the T4's first call while SDXL+ControlNet
 * download. We therefore default to a generous 300s timeout (configurable)
 * and abort cleanly if it's exceeded. A caller-supplied `signal` (e.g. for a
 * "cancel"/unmount) is honoured in addition to the internal timeout.
 */
export async function redesignRoom(
  file: File,
  {
    timeoutMs = 300_000,
    signal,
    styles,
  }: { timeoutMs?: number; signal?: AbortSignal; styles?: StyleId[] } = {},
): Promise<RedesignResult> {
  const fd = new FormData();
  fd.append("file", file);
  // Omitted means all three — the server's default. Requesting a single culture
  // is roughly 3x faster, since the depth/segmentation pass and room analysis
  // run once regardless of how many styles follow.
  if (styles?.length) fd.append("styles", styles.join(","));

  // Compose the internal timeout with any caller-provided abort signal.
  const ctrl = new AbortController();
  let timedOut = false;
  const onParentAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await safeFetch(`${API_URL}/redesign`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: fd,
      signal: ctrl.signal,
    });
  } catch (e) {
    // safeFetch turns an AbortError into a generic network ApiError; recover the
    // real cause so the UI can show an accurate, bilingual message.
    if (timedOut) {
      throw new ApiError(
        {
          code: "timeout",
          message_en: "The design is taking longer than expected. Please try again.",
          message_ar: "استغرق التصميم وقتاً أطول من المتوقع. يرجى المحاولة مجدداً.",
        },
        0,
      );
    }
    if (signal?.aborted) {
      throw new ApiError(
        { code: "aborted", message_en: "Request cancelled", message_ar: "تم إلغاء الطلب" },
        0,
      );
    }
    throw e; // already a typed network ApiError from safeFetch
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
  }

  const data = (await unwrap(res)) as Partial<RedesignResult>;

  // Validate so a partial/garbled response fails loudly instead of rendering
  // broken <img> tags. The original is always required; styles are checked
  // against what the server says it produced, because a single-culture request
  // legitimately returns nulls for the other two.
  const isImage = (v: unknown) => typeof v === "string" && v.startsWith("data:image");
  const produced = (data.styles?.length ? data.styles : REDESIGN_STYLE_KEYS) as StyleId[];
  const missing = [
    ...(isImage(data.original) ? [] : ["original"]),
    ...produced.filter((k) => !isImage(data[k])),
  ];
  if (missing.length) {
    throw new ApiError(
      {
        code: "bad_response",
        message_en: `Server returned an incomplete result (missing: ${missing.join(", ")}).`,
        message_ar: "أعاد الخادم نتيجة غير مكتملة. يرجى المحاولة مجدداً.",
      },
      res.status,
    );
  }

  return { ...data, styles: produced } as RedesignResult;
}

/* -------------------------------------------------------------------------- */
/*  Cultural furniture recommendation + placement                             */
/* -------------------------------------------------------------------------- */

/** One catalogue item (ontology/furniture.json). */
export interface FurnitureItem {
  id: string;
  culture: StyleId;
  category: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  /** Path under /public, e.g. "furniture/lebanese/leb-chair-001.png". */
  asset: string;
  placement_type: string;
  room_types: string[];
  real_width_cm: number;
  real_height_cm: number;
  must_touch_wall: boolean;
  must_stand_on_floor: boolean;
  cultural_tags: string[];
  material_tags: string[];
  color_tags: string[];
  /** Present on recommendations: ranking score and why it was suggested.
   *  Both languages always ship together — a justification that exists in only
   *  one of them is a blank space in the other. Ordered most-distinguishing
   *  first, so `reasons[0]` is the line worth putting on a card. */
  score?: number;
  reasons?: string[];
  reasons_ar?: string[];
}

/** An open spot the room analysis found (normalized image coords). */
export interface CandidateSpot {
  cx: number;
  cy: number;
  clearance_px: number;
  depth: number;
  max_width_cm: number | null;
}

export interface RoomAnalysisSummary {
  free_floor_ratio: number;
  free_floor_of_floor: number;
  free_floor_m2: number | null;
  /** 0..1 — how much to trust free_floor_m2. Low means treat it loosely. */
  scale_confidence: number;
  existing_categories: string[];
  candidates: CandidateSpot[];
  warnings: string[];
  placeholder?: boolean;
}

/** A placement box in **rendered-image pixels** (not mask space). */
export interface PlacementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementCandidate {
  valid: boolean;
  score: number;
  position: PlacementPosition;
  depth: number;
  reason: string | null;
  reason_ar: string | null;
  confidence: number;
  breakdown: Record<string, number>;
}

export interface CandidatePositionsResult {
  job_id: string;
  furniture_id: string;
  /** Pixel size of the rendered image these positions are expressed in. */
  image_size: { width: number; height: number } | null;
  positions: PlacementCandidate[];
  /** Set only when `positions` is empty — no safe space was found. */
  message: string | null;
  message_ar: string | null;
}

export interface ValidatePositionResult extends PlacementCandidate {
  adjusted_position: PlacementPosition | null;
}

/** One confirmed placement, as stored on the job. */
export interface PlacementRecord {
  furniture_id: string;
  style: StyleId;
  position: PlacementPosition;
  score: number;
  created_at: number;
}

export interface ConfirmPlacementResult {
  job_id: string;
  style: StyleId;
  furniture_id: string;
  /** The edited room as a base64 PNG data URL. */
  image: string;
  position: PlacementPosition;
  score: number;
  compositing: { brightness_factor: number; warmth_shift: number };
  /** Every placement confirmed on this job so far, oldest first. */
  placements: PlacementRecord[];
}

/** Ranked 3–6 culturally appropriate items for this room. */
export async function fetchFurnitureRecommendations(
  culture: StyleId,
  opts: {
    roomType?: string;
    mood?: string;
    freeFloorM2?: number | null;
    existing?: string[];
    limit?: number;
  } = {},
): Promise<FurnitureItem[]> {
  const qs = new URLSearchParams({ culture });
  if (opts.roomType) qs.set("room_type", opts.roomType);
  if (opts.mood) qs.set("mood", opts.mood);
  if (opts.freeFloorM2 != null) qs.set("free_floor_m2", String(opts.freeFloorM2));
  if (opts.existing?.length) qs.set("existing", opts.existing.join(","));
  if (opts.limit) qs.set("limit", String(opts.limit));
  const res = await safeFetch(`${API_URL}/api/furniture/recommendations?${qs}`, {
    headers: COMMON_HEADERS,
  });
  const data = (await unwrap(res)) as { items: FurnitureItem[] };
  return data.items ?? [];
}

/** Best few places this item could go. Empty `positions` is a valid answer. */
export async function fetchCandidatePositions(
  jobId: string,
  furnitureId: string,
  limit = 3,
): Promise<CandidatePositionsResult> {
  const res = await safeFetch(`${API_URL}/api/furniture/candidate-positions`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, furniture_id: furnitureId, limit }),
  });
  return (await unwrap(res)) as CandidatePositionsResult;
}

/**
 * Is this exact box valid? Called while dragging, so callers should debounce and
 * pass a `signal` to drop stale in-flight checks.
 *
 * The backend is authoritative — this is the same check `confirm-placement` runs,
 * so the green/red outline can never disagree with what confirming will do.
 */
export async function validatePlacement(
  jobId: string,
  furnitureId: string,
  pos: PlacementPosition,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ValidatePositionResult> {
  const res = await safeFetch(`${API_URL}/api/furniture/validate-position`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      furniture_id: furnitureId,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    }),
    signal,
  });
  return (await unwrap(res)) as ValidatePositionResult;
}

/** Insert the item and get the edited room back. Re-validated server-side. */
export async function confirmPlacement(
  jobId: string,
  furnitureId: string,
  style: StyleId,
  pos: PlacementPosition,
): Promise<ConfirmPlacementResult> {
  const res = await safeFetch(`${API_URL}/api/furniture/confirm-placement`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      furniture_id: furnitureId,
      style,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    }),
  });
  return (await unwrap(res)) as ConfirmPlacementResult;
}

/** Absolute URL for a catalogue item's PNG (served from /public). */
export function furnitureAssetUrl(item: FurnitureItem): string {
  return `/${item.asset.replace(/^\/+/, "")}`;
}

/* ------------------------------------------------------------------
   Colour Control — recolour the wall or floor of a finished render
   inside its segmentation mask. See backend/recolor_api.py.
   ------------------------------------------------------------------ */

/** The only two surfaces that can be recoloured. */
export type ColorTarget = "wall" | "floor";

export interface ColorTargetAvailability {
  target: ColorTarget;
  /** Fraction of the frame this surface covers, 0..1. */
  coverage: number;
  /** False when the surface isn't visible enough to recolour reliably. */
  available: boolean;
}

export interface RecolorResult {
  job_id: string;
  style: StyleId;
  /** The recoloured room as a base64 PNG data URL. */
  image: string;
  target: ColorTarget;
  color: string;
  strength: number;
  coverage: number;
  /** Only on apply/undo/reset: is there a previous version to step back to? */
  can_undo?: boolean;
}

interface RecolorBody {
  job_id: string;
  style: StyleId;
  target: ColorTarget;
  color: string;
  strength?: number;
}

async function colorPost(path: string, body: unknown): Promise<RecolorResult> {
  const res = await safeFetch(`${API_URL}/api/color/${path}`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await unwrap(res)) as RecolorResult;
}

export interface ColorState {
  targets: ColorTargetAvailability[];
  /** Whether the server can still step this style back. Authoritative — the
   *  undo stack lives there, so the panel must not infer it from its own state. */
  canUndo: boolean;
}

/** Which surfaces this room has, and whether an undo is available for `style`. */
export async function fetchColorState(jobId: string, style: StyleId): Promise<ColorState> {
  const res = await safeFetch(
    `${API_URL}/api/color/targets?job_id=${encodeURIComponent(jobId)}&style=${encodeURIComponent(style)}`,
    { headers: COMMON_HEADERS },
  );
  const body = (await unwrap(res)) as { targets?: ColorTargetAvailability[]; can_undo?: boolean };
  return { targets: body.targets ?? [], canUndo: !!body.can_undo };
}

/** Try a colour. Changes nothing server-side — the job is untouched. */
export function previewRecolor(body: RecolorBody): Promise<RecolorResult> {
  return colorPost("preview", body);
}

/** Commit the colour: it becomes the job's current render, so a later save
 *  (or another edit) builds on it. */
export function applyRecolor(body: RecolorBody): Promise<RecolorResult> {
  return colorPost("apply", body);
}

/** Step back one confirmed colour change. */
export function undoRecolor(jobId: string, style: StyleId): Promise<RecolorResult> {
  return colorPost("undo", { job_id: jobId, style });
}

/** Drop every colour change on this style. Furniture placed earlier stays. */
export function resetRecolor(jobId: string, style: StyleId): Promise<RecolorResult> {
  return colorPost("reset", { job_id: jobId, style });
}

export interface RestyleResult {
  image: string;
  style: RestyleStyleId;
  scale: number;
  /** C2PA-style provenance: model, LoRA, seed, ControlNet weights, SHA-256. */
  manifest?: Record<string, unknown> | null;
}

/**
 * Style Intensity Slider — re-render ONE culture at a given LoRA `scale` (0..1):
 * 0 ≈ generic SDXL, 1 ≈ full culture. The ablation made live. ~30–60s on the T4
 * (instant placeholder in DARDESIGN_LIGHT).
 */
/** /restyle also serves persian — the prompt-only 4th culture (no LoRA), which
 *  never joins the 3-style /redesign flow so demo timing stays fixed. */
export type RestyleStyleId = StyleId | "persian";

export async function restyleRoom(
  file: File,
  style: RestyleStyleId,
  scale: number,
  // One T4 render is ~1-3 min, and a /restyle can queue behind a running
  // /redesign (the backend serializes generations) — 120s aborted real runs.
  { timeoutMs = 360_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RestyleResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("style", style);
  fd.append("scale", String(Math.max(0, Math.min(1, scale))));

  const ctrl = new AbortController();
  let timedOut = false;
  const onParentAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await safeFetch(`${API_URL}/restyle`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: fd,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (timedOut) {
      throw new ApiError(
        {
          code: "timeout",
          message_en: "The restyle is taking longer than expected. Please try again.",
          message_ar: "استغرقت إعادة التصميم وقتاً أطول من المتوقع. يرجى المحاولة مجدداً.",
        },
        0,
      );
    }
    if (signal?.aborted) {
      throw new ApiError(
        { code: "aborted", message_en: "Request cancelled", message_ar: "تم إلغاء الطلب" },
        0,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
  }

  const data = (await unwrap(res)) as Partial<RestyleResult>;
  if (typeof data.image !== "string" || !data.image.startsWith("data:image")) {
    throw new ApiError(
      {
        code: "bad_response",
        message_en: "Server returned an incomplete restyle. Please try again.",
        message_ar: "أعاد الخادم نتيجة غير مكتملة. يرجى المحاولة مجدداً.",
      },
      res.status,
    );
  }
  return { image: data.image, style, scale, manifest: data.manifest ?? null };
}

/* -------------------------------------------------------------------------- */
/*  Accounts + saved designs                                                   */
/* -------------------------------------------------------------------------- */

export type UserRole = "User" | "Admin";

/** Basic is the free plan (3 designs a week); Pro is unlimited while it lasts. */
export type PlanId = "basic" | "pro";

export interface AuthUser {
  id: number;
  fullName: string;
  phoneNumber: string | null;
  email: string;
  role: UserRole;
  /** Plan, so the chrome can reflect it without a second call. The allowance
   *  itself always comes from fetchSubscription() — this is a label. */
  plan: PlanId;
  isSubscribed: boolean;
  numberOfUses: number;
  planExpiryDate: number | null;
}

/** The rating a design already has, from the existing feedback record.
 *  Read-only: the rating form remains the only thing that writes one. */
export interface DesignRating {
  culturalAccuracy: number;
  imageQuality: number;
  roomPreservation: number;
  /** Mean of the three — derived, because the form has no overall field. */
  overall: number;
  /** The rest of the record, served only on the owner's own History. The shared
   *  gallery gets the scores alone, so these are simply absent there. */
  furniturePlacement?: FurniturePlacementVerdict;
  comment?: string | null;
  updatedAt?: number;
}

export interface HistoryEntry {
  id: number;
  userId: number;
  oldImageUrl: string;
  newImageUrl: string;
  isSuggested: boolean;
  /** How the design was generated. Null on entries saved before this was recorded. */
  culture?: StyleId | string | null;
  intensity?: number | null;
  createdAt: number;
  /** Present only on the shared gallery — first name of whoever made it. */
  authorName?: string | null;
  /** The design's existing rating, or null when nobody has rated it. */
  rating?: DesignRating | null;
}

/** How the user judged the furniture in a design. */
export type FurniturePlacementVerdict = "valid" | "invalid" | "not_applicable";

export const FEEDBACK_RATING_MIN = 1;
export const FEEDBACK_RATING_MAX = 5;
export const FEEDBACK_COMMENT_MAX = 500;

/** One user's rating of one generated design. */
export interface Feedback {
  id: number;
  historyId: number;
  userId: number;
  /** Read server-side from the design record — never from the form. */
  culture: string | null;
  intensity: number | null;
  culturalAccuracy: number;
  imageQuality: number;
  roomPreservation: number;
  furniturePlacement: FurniturePlacementVerdict;
  comment: string | null;
  createdAt: number;
  updatedAt: number;
  /** True when this call revised an existing rating rather than creating one. */
  updated?: boolean;
  /** Admin listing only — first name of whoever submitted it. */
  authorName?: string | null;
}

/** What the form collects. Everything else is derived server-side. */
export interface FeedbackInput {
  culturalAccuracy: number;
  imageQuality: number;
  roomPreservation: number;
  furniturePlacement: FurniturePlacementVerdict;
  comment?: string | null;
}

export interface FeedbackStats {
  total: number;
  averageCulturalAccuracy: number | null;
  averageImageQuality: number | null;
  averageRoomPreservation: number | null;
  placementValid: number;
  placementInvalid: number;
  placementNotApplicable: number;
}

export interface FeedbackByCulture {
  culture: string | null;
  total: number;
  averageCulturalAccuracy: number | null;
  averageImageQuality: number | null;
  averageRoomPreservation: number | null;
}

export interface AdminFeedbackResult {
  stats: FeedbackStats;
  byCulture: FeedbackByCulture[];
  recent: Feedback[];
  cultures: string[];
}

/** Session lives in an httpOnly cookie, so every auth-aware call must opt in to
 *  sending credentials — cross-origin fetch omits cookies by default. */
const WITH_CREDENTIALS: RequestInit = { credentials: "include" };

export async function register(input: {
  fullName: string;
  phoneNumber?: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await safeFetch(`${DATA_API_URL}/api/auth/register`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await safeFetch(`${DATA_API_URL}/api/auth/login`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as AuthUser;
}

export async function logout(): Promise<void> {
  await safeFetch(`${DATA_API_URL}/api/auth/logout`, {
    method: "POST",
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
}

/** Current user, or null when signed out. Never throws on "not logged in" —
 *  that's a normal state the app boots into, not an error. */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await safeFetch(`${DATA_API_URL}/api/auth/me`, {
      headers: COMMON_HEADERS,
      ...WITH_CREDENTIALS,
    });
    if (!res.ok) return null;
    return (await res.json()) as AuthUser | null;
  } catch {
    return null;
  }
}

/** Save the current design. Nothing is persisted until this is called.
 *
 *  `culture`/`intensity` describe how it was generated; they are stored on the
 *  design so that rating it later reads them from the database instead of
 *  trusting the rating form. */
export async function saveToHistory(
  oldImage: string,
  newImage: string,
  meta: {
    culture?: string | null;
    intensity?: number | null;
    /** Seconds the generation took, from the /redesign response. */
    duration?: number | null;
    /** Structure preservation for this design, 0..1. */
    ssim?: number | null;
    /** True when colour control or furniture placement changed the render.
     *  Such a design is still saved, but left out of the evaluation metrics. */
    edited?: boolean;
    /** True when /redesign answered `placeholder: true` — a DARDESIGN_LIGHT
     *  tint rather than a render. Saved like any other design, but kept out of
     *  generation timing and model metrics: it took milliseconds and no model
     *  was involved. */
    light?: boolean;
  } = {},
): Promise<HistoryEntry> {
  const res = await safeFetch(`${DATA_API_URL}/api/history`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      oldImage,
      newImage,
      culture: meta.culture ?? null,
      intensity: meta.intensity ?? null,
      duration: meta.duration ?? null,
      ssim: meta.ssim ?? null,
      edited: !!meta.edited,
      light: !!meta.light,
    }),
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as HistoryEntry;
}

/** Rate one of your own saved designs, or revise your earlier rating.
 *
 *  One record per design: calling this twice edits the first. The backend reads
 *  the author, culture and intensity itself, so only the judgements travel. */
export async function submitFeedback(
  historyId: number,
  input: FeedbackInput,
): Promise<Feedback> {
  const res = await safeFetch(`${DATA_API_URL}/api/feedback`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      historyId,
      culturalAccuracy: input.culturalAccuracy,
      imageQuality: input.imageQuality,
      roomPreservation: input.roomPreservation,
      furniturePlacement: input.furniturePlacement,
      comment: input.comment?.trim() || null,
    }),
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as Feedback;
}

/** Your existing rating for a design, or null. 404s for anyone else's design. */
export async function fetchFeedback(historyId: number): Promise<Feedback | null> {
  const res = await safeFetch(`${DATA_API_URL}/api/feedback/${historyId}`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as Feedback | null;
}

/** Aggregated feedback for the admin panel. Admin role required. */
export async function fetchAdminFeedback(
  opts: { culture?: string; since?: number; until?: number; limit?: number } = {},
): Promise<AdminFeedbackResult> {
  const qs = new URLSearchParams();
  if (opts.culture) qs.set("culture", opts.culture);
  if (opts.since != null) qs.set("since", String(opts.since));
  if (opts.until != null) qs.set("until", String(opts.until));
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  const res = await safeFetch(`${DATA_API_URL}/api/admin/feedback?${qs}`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as AdminFeedbackResult;
}

/* ------------------------------------------------------------------
   Evaluation dashboard. See backend/evaluation.py.

   Every average is `number | null`: null means "not measured", which the UI
   must render as "—" rather than 0. A zero on this page would be read as a
   result, and there is a real difference between "users rated this 0" (which
   the 1-5 scale cannot even express) and "nobody has rated this".
   ------------------------------------------------------------------ */

export interface EvaluationCultureRow {
  culture: string | null;
  total: number;
  averageCulturalAccuracy: number | null;
  averageImageQuality: number | null;
  averageRoomPreservation: number | null;
}

/** Rooms generated and their timings, computed over the history table.
 *
 *  Two populations, and the response names both: `roomsGenerated` is everything
 *  the filters matched, while every average below is taken over
 *  `evaluableDesigns` — the pipeline's own unedited, non-placeholder output. */
export interface GenerationStats {
  /** Every saved design inside the filters, edits and placeholders included. */
  roomsGenerated: number;
  /** The corpus the averages below are drawn from. */
  evaluableDesigns: number;
  /** Held back from the averages, and why — so the arithmetic closes on screen. */
  editedExcluded: number;
  lightExcluded: number;
  /** Sum of durations divided by the rows that have one. Null when none do. */
  averageSeconds: number | null;
  totalSeconds: number | null;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  /** How many rows carried a duration and therefore backed the average. */
  sampleSize: number;
  /** Mean structure preservation (SSIM) over the designs that carry one. */
  averageSsim: number | null;
  ssimSampleSize: number;
  /** Perceptual distance to the input — lower is closer. */
  averageLpips: number | null;
  lpipsSampleSize: number;
  /** CLIP similarity to the design's own culture prompt. */
  averageClipScore: number | null;
  clipSampleSize: number;
}

/** How many of the filtered designs carry each measurement. */
export interface EvaluationCoverage {
  total: number;
  ssim: number;
  lpips: number;
  clip: number;
  predicted: number;
  timed: number;
  rated: number;
}

/** Intended culture vs CLIP's zero-shot prediction, over saved designs. */
export interface CultureConfusion {
  /** matrix[intended][predicted] = count */
  matrix: Record<string, Record<string, number>>;
  /** Designs generated as each culture — the denominator for each row's %. */
  rowTotals: Record<string, number>;
  total: number;
  correct: number;
  /** Null when nothing has been classified — never 0, which is a real result. */
  accuracy: number | null;
}

/** Mean and sample size for one metric. The n travels with the value so the two
 *  can never be printed from different populations. */
export interface MetricSummary {
  mean: number | null;
  n: number;
}

/** One arm of the offline corpus — the trained pipeline, or base SDXL. */
export interface AutomaticSet {
  set: "lora" | "baseline" | string;
  label_en: string;
  label_ar: string;
  images: number;
  overall: Record<string, MetricSummary>;
  byCulture: Array<{ culture: string; samples: number } & Record<string, number | string | null>>;
  recognition: CultureConfusion;
}

export interface Ablation {
  available: boolean;
  reason_en?: string;
  reason_ar?: string;
  hint?: string;
  rows: Array<{
    metric: string;
    lora: MetricSummary;
    baseline: MetricSummary;
    delta: number | null;
  }>;
  recognition?: { lora: CultureConfusion; baseline: CultureConfusion };
  /** False when the two arms did not cover the same rooms — an uncontrolled
   *  comparison, reported rather than quietly averaged. */
  sameCorpus?: boolean;
}

/** SSIM / LPIPS / CLIP from eval/run_metrics.py, when it has been run. */
export interface AutomaticMetrics {
  available: boolean;
  reason_en?: string;
  reason_ar?: string;
  hint?: string;
  path?: string;
  culture?: string | null;
  /** The corpus carries no timestamps, so the date filter cannot apply to it. */
  dateFilterable?: boolean;
  metrics: string[];
  images?: number;
  byCulture: Array<{ culture: string; samples: number } & Record<string, number | string | null>>;
  recognition?: CultureConfusion;
  sets: AutomaticSet[];
  ablation: Ablation;
}

export interface EvaluationReport {
  filters: { culture: string | null; since: number | null; until: number | null };
  cultures: string[];
  stats: FeedbackStats;
  /** Mean of the three rated dimensions — derived, not a stored column. */
  averageOverall: number | null;
  byCulture: EvaluationCultureRow[];
  recent: Feedback[];
  generation: GenerationStats;
  coverage: EvaluationCoverage;
  confusion: CultureConfusion;
  automatic: AutomaticMetrics;
}

/** Every dashboard figure for one set of filters, in one call.
 *
 *  The filters go to the backend rather than being applied to the response:
 *  an average cannot be filtered after it has been taken, so narrowing here
 *  would leave a global mean sitting under a per-culture heading.
 *
 *  `signal` lets the page drop a superseded request. Switching culture three
 *  times fires three fetches, and without it the slowest — not the latest —
 *  decides what is on screen. */
export async function fetchEvaluation(
  opts: {
    culture?: string;
    since?: number;
    until?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<EvaluationReport> {
  const qs = new URLSearchParams();
  if (opts.culture) qs.set("culture", opts.culture);
  if (opts.since != null) qs.set("since", String(opts.since));
  if (opts.until != null) qs.set("until", String(opts.until));
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  const res = await safeFetch(`${DATA_API_URL}/api/admin/evaluation?${qs}`, {
    headers: COMMON_HEADERS,
    signal: opts.signal,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as EvaluationReport;
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await safeFetch(`${DATA_API_URL}/api/history`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as HistoryEntry[];
}

/** Share one of your designs to the public gallery, or take it back. */
export async function setSuggested(id: number, isSuggested: boolean): Promise<void> {
  const res = await safeFetch(`${DATA_API_URL}/api/history/${id}/suggest`, {
    method: "PATCH",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ isSuggested }),
    ...WITH_CREDENTIALS,
  });
  await unwrap(res);
}

/** Other users' shared designs — never your own, never anything unshared. */
export async function fetchSuggested(): Promise<HistoryEntry[]> {
  const res = await safeFetch(`${DATA_API_URL}/api/history/suggested`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as HistoryEntry[];
}

export async function deleteHistoryEntry(id: number): Promise<void> {
  const res = await safeFetch(`${DATA_API_URL}/api/history/${id}`, {
    method: "DELETE",
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  await unwrap(res);
}

/** Saved images are served by the backend, not Next's /public. */
export function storedImageUrl(path: string): string {
  return `${DATA_API_URL}/${path.replace(/^\/+/, "")}`;
}

/* -------------------------------------------------------------------------- */
/*  Plans, the weekly allowance, and upgrade requests                          */
/* -------------------------------------------------------------------------- */

/** Price, duration and free allowance — served by the backend rather than
 *  written into the page, so what is displayed cannot drift from what is
 *  enforced. See backend/subscriptions.py. */
export interface PlanTerms {
  priceUsd: number;
  durationDays: number;
  basicWeeklyLimit: number;
}

export type SubscriptionRequestStatus = "pending" | "approved" | "declined";

export interface SubscriptionRequest {
  id: number;
  userId: number;
  status: SubscriptionRequestStatus;
  createdAt: number;
  decidedAt: number | null;
  /** Admin listing only — the account the request belongs to. */
  fullName?: string;
  email?: string;
  phoneNumber?: string | null;
  plan?: PlanId;
  planExpiryDate?: number | null;
}

export interface SubscriptionState {
  plan: PlanId;
  isSubscribed: boolean;
  planStartedAt: number | null;
  planExpiryDate: number | null;
  numberOfUses: number;
  /** Null on Pro — unlimited. Render that as "unlimited", never as a number. */
  limit: number | null;
  remaining: number | null;
  windowStart: number;
  /** When the free weekly allowance refills. Null on Pro. */
  windowEnds: number | null;
  /** The request waiting for an admin, when there is one. */
  pendingRequest: SubscriptionRequest | null;
  terms: PlanTerms;
}

/** What /api/usage/consume answers with when the generation is allowed. */
export interface UsageResult extends Omit<SubscriptionState, "pendingRequest" | "terms"> {
  allowed: boolean;
}

export async function fetchSubscription(): Promise<SubscriptionState> {
  const res = await safeFetch(`${DATA_API_URL}/api/subscription`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as SubscriptionState;
}

/** Ask an admin for Pro. Grants nothing on its own — the plan changes only when
 *  the admin approves it on /admin/subscriptions. */
export async function requestSubscription(): Promise<SubscriptionState> {
  const res = await safeFetch(`${DATA_API_URL}/api/subscription/request`, {
    method: "POST",
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as SubscriptionState;
}

/** Leave Pro and go back to Basic, immediately. */
export async function cancelSubscription(): Promise<SubscriptionState> {
  const res = await safeFetch(`${DATA_API_URL}/api/subscription/cancel`, {
    method: "POST",
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as SubscriptionState;
}

/**
 * Count one generation against the account before starting it.
 *
 * Throws ApiError `quota_exceeded` (429) when the free weekly allowance is
 * gone, and `not_authenticated` (401) when nobody is signed in. The counter is
 * the server's: this call is the only thing that moves it.
 */
export async function consumeGeneration(): Promise<UsageResult> {
  const res = await safeFetch(`${DATA_API_URL}/api/usage/consume`, {
    method: "POST",
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as UsageResult;
}

export interface AdminSubscriptionQueue {
  requests: SubscriptionRequest[];
  pendingCount: number;
  terms: PlanTerms;
}

/** The upgrade queue — pending first. Admin role required. */
export async function fetchSubscriptionRequests(
  status?: SubscriptionRequestStatus,
): Promise<AdminSubscriptionQueue> {
  const qs = status ? `?status=${status}` : "";
  const res = await safeFetch(`${DATA_API_URL}/api/admin/subscriptions${qs}`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as AdminSubscriptionQueue;
}

/** Approve (starts 30 days of Pro) or decline one pending request. */
export async function decideSubscriptionRequest(
  requestId: number,
  approve: boolean,
): Promise<SubscriptionRequest> {
  const res = await safeFetch(
    `${DATA_API_URL}/api/admin/subscriptions/${requestId}/decision`,
    {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ approve }),
      ...WITH_CREDENTIALS,
    },
  );
  return (await unwrap(res)) as SubscriptionRequest;
}

export interface AdminUserRow {
  id: number;
  fullName: string;
  phoneNumber: string | null;
  email: string;
  role: UserRole;
  plan: PlanId;
  isSubscribed: boolean;
  /** Null on Basic — there is no start or end date for a plan nobody bought. */
  planStartedAt: number | null;
  planExpiryDate: number | null;
  numberOfUses: number;
  /** When the current weekly window opened. Null before the first generation. */
  usageWindowStart: number | null;
  designsSaved: number;
  createdAt: number;
}

/** Every account with its plan. Admin role required. */
export async function fetchAdminUsers(): Promise<{ users: AdminUserRow[]; terms: PlanTerms }> {
  const res = await safeFetch(`${DATA_API_URL}/api/admin/users`, {
    headers: COMMON_HEADERS,
    ...WITH_CREDENTIALS,
  });
  return (await unwrap(res)) as { users: AdminUserRow[]; terms: PlanTerms };
}

/* ----------------------------------------------------------------------------
 * Build Mode -> photorealistic render
 * ------------------------------------------------------------------------- */

export interface SceneRenderResult {
  jobId: string;
  style: string;
  /** base64 PNG data URL. */
  image: string;
  durationS: number | null;
  /** True when the backend had no GPU and returned a LIGHT-mode stand-in.
   *  The UI must say so rather than presenting it as a render. */
  placeholder: boolean;
}

/** The address a render will actually be posted to. Surfaced in the failure
 *  message because "could not be reached" is useless when the cause is almost
 *  always a rotated tunnel URL in .env.local. */
export function renderEndpoint(): string {
  return `${API_URL}/render-scene`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Post Build Mode's rendered depth + ADE20K segmentation to the generator.
 *
 *  These are the same two control images `/redesign` normally derives from the
 *  photograph, so the layout the model is conditioned on is the one the user
 *  composed. Same generous timeout as `/restyle`: a T4 render can queue behind
 *  a running generation, and the backend serializes them. */
export async function renderScene(
  depthDataUrl: string,
  segDataUrl: string,
  style: string,
  {
    room = "living room",
    /** 0..1 cultural intensity — the LoRA scale. Omitted leaves the pipeline default. */
    scale,
    timeoutMs = 360_000,
    signal,
  }: { room?: string; scale?: number | null; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SceneRenderResult> {
  const fd = new FormData();
  fd.append("depth", dataUrlToBlob(depthDataUrl), "depth.png");
  fd.append("seg", dataUrlToBlob(segDataUrl), "seg.png");
  fd.append("style", style);
  fd.append("room", room);
  if (typeof scale === "number" && Number.isFinite(scale)) {
    fd.append("scale", String(Math.max(0, Math.min(1, scale))));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });

  try {
    const res = await fetch(`${API_URL}/render-scene`, {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
      credentials: "omit",
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(
        {
          code: "render_failed",
          message_en: `The render could not be produced (${res.status}).${detail ? " " + detail : ""}`,
          message_ar: `تعذّر إنتاج العرض (${res.status}).`,
        },
        res.status,
      );
    }
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.image !== "string" || !j.image.startsWith("data:image")) {
      throw new ApiError(
        {
          code: "render_empty",
          message_en: "The renderer returned no image.",
          message_ar: "لم يُعِد المحرك أي صورة.",
        },
        502,
      );
    }
    return {
      jobId: String(j.job_id ?? ""),
      style: String(j.style ?? style),
      image: j.image,
      durationS: typeof j.duration_s === "number" ? j.duration_s : null,
      placeholder: j.placeholder === true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   Design Planner — a written brief becomes a proposed layout.

   On DATA_API_URL, not API_URL: the model API key belongs on a machine the
   user controls, never on a throwaway Kaggle GPU container.

   Everything returned here is a PROPOSAL. `src/lib/design/planner.ts`
   re-validates every placement against the real collision engine before any
   of it reaches the scene.
   ============================================================ */

export interface PlannedItem {
  catalogId: string;
  xCm: number;
  zCm: number;
  rotationDeg: number;
  /** null = use the catalogue item's own default material. */
  materialKey: string | null;
  reasonEn: string;
  reasonAr: string;
}

/**
 * DAR's reading of the brief. Every field is validated server-side against a
 * real vocabulary — a culture we have, a room type the prompt builder knows,
 * a material on the actual swatch list — so `null` always means "not said"
 * rather than "we guessed".
 */
export interface PlanUnderstood {
  culture: string;
  roomType: string;
  capacity: number | null;
  /** 0..1 — the same LoRA scale /restyle exposes. */
  intensity: number | null;
  wallMaterialKey: string | null;
  floorMaterialKey: string | null;
  conceptEn: string;
  conceptAr: string;
  requirements: string[];
  requestedFurniture: Array<{ category: string; count: number }>;
}

/**
 * One piece of cultural knowledge DAR retrieved for this brief.
 *
 * Knowledge only — an element, what it is for, how it is misused. It names no
 * furniture and no dimensions, because the catalogue and the placement engine
 * own those. See `backend/knowledge.py`.
 */
export interface CulturalEvidence {
  id: string;
  culture: string;
  category: string;
  elementEn: string;
  elementAr: string;
  guidanceEn: string;
  guidanceAr: string;
  verified: boolean;
  /**
   * Three states, never collapsed to a boolean:
   * `verified-cited` — signed off AND traceable to a public source,
   * `verified`       — signed off, no page-level reference recorded,
   * `unverified`     — seed vocabulary awaiting review.
   * Lebanese is currently 0/30 verified; Khaleeji and Moroccan are 30/30.
   */
  evidenceState: "verified-cited" | "verified" | "unverified";
  /** A citation from ontology/sources.md, or null. Never fabricated. */
  source: string | null;
  score?: number;
}

export interface EvidenceMeta {
  /**
   * Whether this evidence actually went into the model's prompt. Retrieval is
   * local and runs on every path, but only the model path DESIGNS with it — a
   * rule-based plan reports what DAR knows with `injected: false` rather than
   * claiming an influence it never had.
   */
  injected: boolean;
  /** false = the corpus is missing or failed to load, distinct from "no match". */
  available: boolean;
  culture: string | null;
  rooms: string[];
  reason: string | null;
  count: number;
}

export interface DesignPlan {
  understood: PlanUnderstood;
  items: PlannedItem[];
  /** DAR's own arithmetic over the placed pieces, estimated from real widths. */
  seatingEstimate: number;
  placedCounts: Record<string, number>;
  notesEn: string;
  notesAr: string;
  /** "llm" — a design model planned it. "rules" — DAR's placement rules did. */
  source: "llm" | "rules";
  model: string | null;
  provider: string | null;
  /** Pieces the backend threw out, with why. Shown, never swallowed. */
  rejected: Array<{ catalogId: string | null; why: string }>;
  /** Optional: a backend older than the RAG feature sends neither field. */
  evidence?: CulturalEvidence[];
  evidenceMeta?: EvidenceMeta;
  warning?: string;
  cached?: boolean;
}

export interface PlanRoomInput {
  widthCm: number;
  depthCm: number;
  heightCm?: number;
  culture: string;
  brief: string;
  existing?: Array<Record<string, unknown>>;
  openings?: Array<Record<string, unknown>>;
  shellSource?: string | null;
}

/** Ask the planner for a layout. ~10-20s with a model; instant without one. */
export async function planLayout(
  input: PlanRoomInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DesignPlan> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onParentAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const res = await safeFetch(`${DATA_API_URL}/api/design/plan`, {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        width_cm: input.widthCm,
        depth_cm: input.depthCm,
        height_cm: input.heightCm ?? 300,
        culture: input.culture,
        brief: input.brief,
        existing: input.existing ?? [],
        openings: input.openings ?? [],
        shell_source: input.shellSource ?? null,
      }),
      signal: ctrl.signal,
      ...WITH_CREDENTIALS,
    });
    const data = (await unwrap(res)) as DesignPlan;
    // Shape check: an empty plan renders as a broken panel, so say so plainly.
    if (!Array.isArray(data?.items)) {
      throw new ApiError(
        {
          code: "bad_response",
          message_en: "The planner returned no layout.",
          message_ar: "لم يُعِد المخطِّط أي توزيع.",
        },
        res.status,
      );
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(
        timedOut
          ? {
              code: "timeout",
              message_en: "The planner took too long. Try a shorter brief.",
              message_ar: "استغرق المخطِّط وقتاً طويلاً. جرّب وصفاً أقصر.",
            }
          : {
              code: "aborted",
              message_en: "Planning was cancelled.",
              message_ar: "أُلغي التخطيط.",
            },
        0,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onParentAbort);
  }
}

export interface PlannerStatus {
  configured: boolean;
  model: string | null;
  provider?: string | null;
}

/** Whether a design model is configured, so the panel can say so before asking. */
export async function fetchPlannerStatus(): Promise<PlannerStatus> {
  try {
    const res = await safeFetch(`${DATA_API_URL}/api/design/planner-status`, {
      headers: COMMON_HEADERS,
    });
    if (!res.ok) return { configured: false, model: null };
    return (await res.json()) as PlannerStatus;
  } catch {
    return { configured: false, model: null };
  }
}
