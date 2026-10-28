import type {
  EventResponse,
  StandardResponse,
  StatusResponse,
  TimelineResponse,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  retryAfter: number | null;

  constructor(code: string, status: number, retryAfter: number | null = null) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * FastAPI reports failures as `{detail: "..."}`, and Pydantic validation adds a
 * list of objects instead of a string. Both shapes collapse to one error code
 * so callers keep switching on a single string.
 */
interface ErrorPayload {
  detail?: unknown;
  error?: unknown;
}

function errorCode(payload: ErrorPayload | null): string {
  const detail = payload?.detail ?? payload?.error;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) return "invalid_request";
  return "request_failed";
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // 默认绕开 HTTP 缓存（管理台的读必须新鲜）；下面三个公开只读接口自己传
    // `cache: "default"`，让浏览器与边缘 CDN 的 `max-age` 生效。
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError("network", 0);
  }

  const payload = (await response.json().catch(() => null)) as
    | ErrorPayload
    | T
    | null;

  if (!response.ok) {
    const header = response.headers.get("retry-after");
    const retry = header === null ? null : Number(header);
    throw new ApiError(
      errorCode(payload as ErrorPayload | null),
      response.status,
      retry !== null && Number.isFinite(retry) ? retry : null
    );
  }
  return payload as T;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(`${BASE}${path}`, init);
}

export function fetchTimeline(limit = 1200, signal?: AbortSignal) {
  return request<TimelineResponse>(`/timeline?limit=${limit}`, { signal, cache: "default" });
}

export function fetchEvent(id: string, signal?: AbortSignal) {
  return request<EventResponse>(`/events?id=${encodeURIComponent(id)}`, {
    signal,
  });
}

export function fetchEventBySlug(slug: string, signal?: AbortSignal) {
  return request<EventResponse>(`/events/${encodeURIComponent(slug)}`, {
    signal,
  });
}

export function fetchStatus(signal?: AbortSignal) {
  return request<StatusResponse>("/status", { signal, cache: "default" });
}

export function fetchStandard(signal?: AbortSignal) {
  return request<StandardResponse>("/standard", { signal, cache: "default" });
}
