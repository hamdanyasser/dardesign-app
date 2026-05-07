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
