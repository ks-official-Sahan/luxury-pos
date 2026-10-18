/**
 * Pure routing decisions for the edge gateway, kept free of Workers globals so
 * they are unit-tested in Node. The Worker (index.ts) only wires them to fetch.
 */

export type OriginName = "primary" | "fallback";

export interface RouteRule {
  /** Path prefix, e.g. `/api/insights`. Longest match wins. */
  prefix: string;
  /** Which origin owns this bounded context first. */
  origin: OriginName;
}

/**
 * Origins to try, in order. Route rules move one bounded context at a time to
 * another backend (strangler-fig migration to Django or a split-out service);
 * everything else prefers the primary. A recently failed origin drops to last.
 */
export function originOrder(path: string, rules: readonly RouteRule[], hasFallback: boolean, unhealthy: ReadonlySet<OriginName> = new Set()): OriginName[] {
  const rule = [...rules].sort((a, b) => b.prefix.length - a.prefix.length).find((r) => path === r.prefix || path.startsWith(r.prefix.endsWith("/") ? r.prefix : `${r.prefix}/`));
  const first: OriginName = rule?.origin ?? "primary";
  const order: OriginName[] = hasFallback ? [first, first === "primary" ? "fallback" : "primary"] : ["primary"];
  return [...order.filter((o) => !unhealthy.has(o)), ...order.filter((o) => unhealthy.has(o))];
}

/**
 * Writes whose body carries a client-generated UUIDv7 id are idempotent server
 * side (a replay returns the first result), so they are safe to retry on another
 * origin. Any other non-GET is never retried: it might have been applied.
 */
const IDEMPOTENT_WRITES = [/^\/api\/orders$/, /^\/api\/refunds$/, /^\/api\/stock\/movements$/, /^\/api\/stock\/transfers$/, /^\/api\/drawers$/];

export function isRetriable(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return method === "POST" && IDEMPOTENT_WRITES.some((r) => r.test(path));
}

/** Status codes that mean "this origin could not handle it", not "the request was wrong". */
export const shouldFailover = (status: number) => status === 502 || status === 503 || status === 504;

/** Public, anonymous GETs the edge may cache (the origin's Cache-Control still decides how long). */
export const isEdgeCacheable = (method: string, path: string, hasAuth: boolean) => method === "GET" && !hasAuth && (path.startsWith("/api/public/") || path === "/api/openapi.json");

export type LimitBucket = "auth" | "api" | null;
export function limitBucket(path: string): LimitBucket {
  if (path.startsWith("/api/auth/") || path === "/api/signup") return "auth";
  if (path.startsWith("/api/") || path.startsWith("/mcp")) return "api";
  return null;
}

/** Proxy headers: the origin trusts these only from the gateway, so client-sent copies are overwritten. */
export function forwardHeaders(incoming: Headers, meta: { clientIp: string; host: string; requestId: string }): Headers {
  const h = new Headers(incoming);
  for (const k of ["x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip"]) h.delete(k);
  h.set("x-real-ip", meta.clientIp);
  h.set("x-forwarded-for", meta.clientIp);
  h.set("x-forwarded-host", meta.host);
  h.set("x-forwarded-proto", "https");
  h.set("x-request-id", meta.requestId);
  return h;
}

export function parseRules(json: string | undefined): RouteRule[] {
  if (!json) return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("ROUTE_RULES must be a JSON array");
  return parsed.map((r) => {
    if (typeof r?.prefix !== "string" || !r.prefix.startsWith("/") || (r.origin !== "primary" && r.origin !== "fallback")) throw new Error(`bad route rule ${JSON.stringify(r)}`);
    return { prefix: r.prefix, origin: r.origin };
  });
}
