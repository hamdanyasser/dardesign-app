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
  lebanese: string;
  khaleeji: string;
  moroccan: string;
  /** 2D top-down object map (Week 2). Null/absent when projection fails. */
  object_map?: ObjectMapPayload | null;
  /** On-image highlighter regions from the same seg pass. Null on failure. */
  seg_regions?: SegRegionsPayload | null;
  /** Grayscale depth PNG data URL (brighter = closer) for DepthOrbit. */
  depth_map?: string | null;
}

const REDESIGN_KEYS = ["original", "lebanese", "khaleeji", "moroccan"] as const;

/**
 * Send a room photo to the backend and get back the original plus all three
 * cultural redesigns in a single request.
 *
 * The backend runs three generations sequentially, so a call routinely takes
 * ~1–2 minutes. We therefore default to a generous 180s timeout (configurable)
 * and abort cleanly if it's exceeded. A caller-supplied `signal` (e.g. for a
 * "cancel"/unmount) is honoured in addition to the internal timeout.
 */
export async function redesignRoom(
  file: File,
  { timeoutMs = 180_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RedesignResult> {
  const fd = new FormData();
  fd.append("file", file);

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

  // Validate the payload so a partial/garbled backend response fails loudly
  // and predictably instead of rendering broken <img> tags.
  const missing = REDESIGN_KEYS.filter(
    (k) => typeof data[k] !== "string" || !data[k]!.startsWith("data:image"),
  );
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

  return data as RedesignResult;
}

export interface RestyleResult {
  image: string;
  style: StyleId;
  scale: number;
  /** C2PA-style provenance: model, LoRA, seed, ControlNet weights, SHA-256. */
  manifest?: Record<string, unknown> | null;
}

/**
 * Style Intensity Slider — re-render ONE culture at a given LoRA `scale` (0..1):
 * 0 ≈ generic SDXL, 1 ≈ full culture. The ablation made live. ~30–60s on the T4
 * (instant placeholder in DARDESIGN_LIGHT).
 */
export async function restyleRoom(
  file: File,
  style: StyleId,
  scale: number,
  { timeoutMs = 120_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
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
