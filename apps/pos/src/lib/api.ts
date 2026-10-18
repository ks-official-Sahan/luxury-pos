import type { ApiError } from "@luxury-pos/contracts";
import { rawFetch } from "./auth";
import { useSession } from "../state/session";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  /** Network down, timeout or server unavailable: worth queueing offline. */
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Typed JSON call to our API with the session and the active tenant. Never throws on non-JSON bodies. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs = 15_000, ...rest } = init;
  const { tenantId, deviceId } = useSession.getState();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await rawFetch(`/api${path}`, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(tenantId ? { "x-tenant-id": tenantId } : {}), ...(deviceId ? { "x-device-id": deviceId } : {}), ...(rest.headers as Record<string, string>) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiRequestError(0, "network", "You appear to be offline");
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText, body?.error?.details);
  return body as T;
}
