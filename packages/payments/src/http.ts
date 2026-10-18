import { AdapterError } from "./adapter";

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Performs a fetch and normalises faults: transport errors and timeouts, 5xx and 429 throw retryable
 * AdapterErrors. 401/403 throw non-retryable `auth`. Other statuses (incl. 402 declines, 4xx) are returned.
 */
export async function send(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpResult> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new AdapterError("timeout", `timeout after ${timeoutMs}ms`);
    throw new AdapterError("network", e instanceof Error ? e.message : "network error");
  }
  if (res.status >= 500) throw new AdapterError("server", `upstream ${res.status}`, res.status);
  if (res.status === 429) throw new AdapterError("rate_limited", "rate limited", 429);
  if (res.status === 401 || res.status === 403) throw new AdapterError("auth", `unauthorized ${res.status}`, res.status);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/** Stripe-style bracket form encoding. Skips undefined values. */
export function formEncode(fields: Array<[string, string | number | boolean | undefined]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of fields) if (v !== undefined) p.append(k, String(v));
  return p.toString();
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
