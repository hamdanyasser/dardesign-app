"use client";

/**
 * DarDesign API client. Single source of truth for every backend call.
 *
 * Reads `NEXT_PUBLIC_API_URL` (e.g. the ngrok tunnel). Falls back to
 * `http://localhost:8000` for pure-local dev.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";

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
    // Network / CORS / tunnel-down: surface as a typed error
    throw new ApiError(
      {
        code: "network_unreachable",
        message_en: e instanceof Error ? e.message : "Cannot reach server",
        message_ar: "تعذّر الاتصال بالخادم. تأكد من تشغيل الخدمة.",
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
  /** Present on recommendations: ranking score and why it was suggested. */
  score?: number;
  reasons?: string[];
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
  rotation: number;
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

export interface ConfirmPlacementResult {
  job_id: string;
  style: StyleId;
  furniture_id: string;
  /** The edited room as a base64 PNG data URL. */
  image: string;
  position: PlacementPosition;
  score: number;
  compositing: { brightness_factor: number; warmth_shift: number };
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
  rotation = 0,
): Promise<CandidatePositionsResult> {
  const res = await safeFetch(`${API_URL}/api/furniture/candidate-positions`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, furniture_id: furnitureId, limit, rotation }),
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
      rotation: pos.rotation ?? 0,
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
      rotation: pos.rotation ?? 0,
    }),
  });
  return (await unwrap(res)) as ConfirmPlacementResult;
}

/** Absolute URL for a catalogue item's PNG (served from /public). */
export function furnitureAssetUrl(item: FurnitureItem): string {
  return `/${item.asset.replace(/^\/+/, "")}`;
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
