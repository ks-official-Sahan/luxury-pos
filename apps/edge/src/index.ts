import { forwardHeaders, isEdgeCacheable, isRetriable, limitBucket, originOrder, parseRules, shouldFailover, type OriginName, type RouteRule } from "./gateway";

export interface Env {
  ASSETS: Fetcher;
  /** Node API today (e.g. https://api-origin.example.com). */
  PRIMARY_ORIGIN: string;
  /** Optional second backend: another region, or the Django service. */
  FALLBACK_ORIGIN?: string;
  /** JSON RouteRule[]: hand a bounded context to a different backend. */
  ROUTE_RULES?: string;
  AUTH_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;
}

const MAX_BODY = 1024 * 1024;
const COOLDOWN_MS = 10_000;
/** Per-isolate circuit breaker: an origin that just failed is tried last for a few seconds. */
const downUntil: Record<OriginName, number> = { primary: 0, fallback: 0 };
let cachedRules: { raw: string | undefined; rules: RouteRule[] } = { raw: undefined, rules: [] };

function rulesFor(env: Env) {
  if (cachedRules.raw !== env.ROUTE_RULES) cachedRules = { raw: env.ROUTE_RULES, rules: parseRules(env.ROUTE_RULES) };
  return cachedRules.rules;
}

const json = (status: number, code: string, message: string, extra: HeadersInit = {}) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json", ...extra } });

async function proxy(request: Request, env: Env, url: URL, requestId: string): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return json(413, "payload_too_large", "request body too large");
  // Buffer once so the same body can be replayed on the fallback origin.
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  if (body && body.byteLength > MAX_BODY) return json(413, "payload_too_large", "request body too large");

  const now = Date.now();
  const unhealthy = new Set((Object.keys(downUntil) as OriginName[]).filter((o) => downUntil[o] > now));
  const order = originOrder(url.pathname, rulesFor(env), !!env.FALLBACK_ORIGIN, unhealthy);
  const headers = forwardHeaders(request.headers, { clientIp: request.headers.get("cf-connecting-ip") ?? "unknown", host: url.host, requestId });
  const retriable = isRetriable(request.method, url.pathname);

  let last: Response | null = null;
  for (const [i, name] of order.entries()) {
    const base = name === "primary" ? env.PRIMARY_ORIGIN : env.FALLBACK_ORIGIN!;
    try {
      const res = await fetch(new URL(url.pathname + url.search, base), { method: request.method, headers, body, redirect: "manual" });
      if (!shouldFailover(res.status)) return withGatewayHeaders(res, name, requestId);
      downUntil[name] = Date.now() + COOLDOWN_MS;
      last = res;
    } catch {
      downUntil[name] = Date.now() + COOLDOWN_MS;
    }
    if (!retriable || i === order.length - 1) break;
  }
  return last ? withGatewayHeaders(last, order[0]!, requestId) : json(502, "origin_unreachable", "the store service is unreachable; sales queue on the till and sync later", { "retry-after": "5" });
}

function withGatewayHeaders(res: Response, origin: OriginName, requestId: string) {
  const out = new Response(res.body, res);
  out.headers.set("x-request-id", requestId);
  out.headers.set("x-served-by", origin);
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/edge/healthz") return json(200, "ok", "edge up");
    const bucket = limitBucket(url.pathname);
    if (!bucket) return env.ASSETS.fetch(request); // web app (SPA fallback configured in wrangler.toml)

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const limiter = bucket === "auth" ? env.AUTH_LIMITER : env.API_LIMITER;
    if (limiter) {
      const key = bucket === "auth" ? `auth:${ip}` : `api:${ip}:${request.headers.get("x-tenant-id") ?? "-"}`;
      if (!(await limiter.limit({ key })).success) return json(429, "rate_limited", "too many requests", { "retry-after": "60" });
    }

    const requestId = request.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
    const cacheable = isEdgeCacheable(request.method, url.pathname, request.headers.has("authorization") || request.headers.has("cookie"));
    const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
    if (cacheable && cache) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    const res = await proxy(request, env, url, requestId);
    if (cacheable && cache && res.ok) ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
} satisfies ExportedHandler<Env>;
