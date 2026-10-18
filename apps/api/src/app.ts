import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { ROLES } from "@luxury-pos/core";
import {
  apiTokenSchema,
  askSchema,
  createOrderSchema,
  customerSchema,
  drawerCloseSchema,
  drawerMovementSchema,
  drawerOpenSchema,
  membershipSchema,
  overrideRequestSchema,
  productSchema,
  rangeQuerySchema,
  refundSchema,
  stockAdjustSchema,
  syncPullSchema,
  themeUpdateSchema,
  transferSchema,
} from "@luxury-pos/contracts";
import { createCollectHandler } from "@sahan-sac/analytics-kit/collect";
import { parseRange } from "@sahan-sac/analytics-kit";
import { betterAuthRoute, originGuard, securityHeaders } from "@sahan-sac/auth-kit/hono";
import type { Auth } from "./auth";
import type { Infra } from "./infra";
import { assertCan, authenticate, type AppEnv } from "./lib/context";
import { AppError, onError } from "./lib/errors";
import { handleMcp } from "./mcp";
import * as admin from "./services/admin";
import * as catalog from "./services/catalog";
import * as customers from "./services/customers";
import * as drawer from "./services/drawer";
import { askInsights } from "./services/insights";
import * as inventory from "./services/inventory";
import { signUpload } from "./services/media";
import { createOrder, refundOrder } from "./services/orders";
import { requestOverride } from "./services/overrides";
import * as reports from "./services/reports";

const signUpSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12).max(128),
  tenantName: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
  storeName: z.string().min(2).max(80),
  currency: z.string().length(3).toUpperCase(),
  taxMode: z.enum(["inclusive", "exclusive"]),
  timezone: z.string().min(1).max(64),
});

export function createApp(infra: Infra, auth: Auth) {
  const { env } = infra;
  const webOrigins = [env.SITE_URL, ...env.APP_ORIGINS];
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.use(securityHeaders());
  app.use("/api/*", cors({ origin: webOrigins, credentials: true, allowHeaders: ["content-type", "authorization", "x-tenant-id", "idempotency-key"], maxAge: 600 }));
  app.use("/api/*", bodyLimit({ maxSize: 512 * 1024 }));
  app.use("/api/*", originGuard({ siteUrl: env.SITE_URL, nativeOrigins: env.NATIVE_ORIGINS }));

  app.get("/healthz", async (c) => {
    await infra.pool.query("select 1");
    return c.json({ ok: true });
  });

  // auth-kit's Better Auth routes (sign-in with lockout, MFA, sign-out).
  app.on(["GET", "POST"], "/api/auth/*", betterAuthRoute(auth.auth));

  // Cookieless first-party usage analytics for the web app (analytics-kit).
  const collect = createCollectHandler({ store: infra.analytics, clientIp: (r) => r.headers.get("x-real-ip") ?? "unknown", siteHosts: [new URL(env.SITE_URL).host] });
  app.post("/api/collect", (c) => collect(c.req.raw));

  app.post("/api/signup", async (c) => {
    const ip = c.req.header("x-real-ip") ?? "unknown";
    if (!(await infra.limit("login:ip", `signup:${ip}`)).ok) throw new AppError(429, "rate_limited", "try again later");
    return c.json(await admin.signUpTenant(infra, signUpSchema.parse(await c.req.json())), 201);
  });

  // Everything below needs a session (+ X-Tenant-Id) or a personal access token.
  const api = new Hono<AppEnv>();
  api.use(authenticate(infra, auth));
  const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T) => schema.parse(await c.req.json()) as z.infer<T>;
  const actor = (c: { get: (k: "actor") => AppEnv["Variables"]["actor"] }) => c.get("actor");

  api.get("/me", async (c) => c.json(await admin.bootstrap(infra, actor(c))));

  // catalog
  api.get("/catalog/search", async (c) =>
    c.json(await catalog.searchCatalog(infra, actor(c), { query: c.req.query("q"), storeId: c.req.query("storeId"), limit: Math.min(Number(c.req.query("limit") ?? 40), 100) })),
  );
  api.get("/catalog/sync", async (c) => c.json(await catalog.pullCatalog(infra, actor(c), syncPullSchema.parse(c.req.query()))));
  api.post("/products", async (c) => c.json(await catalog.createProduct(infra, actor(c), await body(c, productSchema)), 201));
  api.patch("/products/:id", async (c) => c.json(await catalog.updateProduct(infra, actor(c), c.req.param("id"), await body(c, productSchema.omit({ variants: true }).partial()))));

  // selling
  api.post("/orders", async (c) => {
    const result = await createOrder(infra, actor(c), await body(c, createOrderSchema));
    return c.json(result, result.replayed ? 200 : 201);
  });
  api.post("/refunds", async (c) => c.json(await refundOrder(infra, actor(c), await body(c, refundSchema)), 201));
  api.post("/overrides", async (c) => c.json(await requestOverride(infra, actor(c), await body(c, overrideRequestSchema))));

  // drawer
  api.post("/drawers", async (c) => c.json(await drawer.openDrawer(infra, actor(c), await body(c, drawerOpenSchema)), 201));
  api.post("/drawers/:id/movements", async (c) => c.json(await drawer.drawerMovement(infra, actor(c), c.req.param("id"), await body(c, drawerMovementSchema))));
  api.post("/drawers/:id/close", async (c) => c.json(await drawer.closeDrawer(infra, actor(c), c.req.param("id"), await body(c, drawerCloseSchema))));

  // inventory
  api.post("/stock/movements", async (c) => c.json(await inventory.adjustStock(infra, actor(c), await body(c, stockAdjustSchema))));
  api.post("/stock/transfers", async (c) => c.json(await inventory.transferStock(infra, actor(c), await body(c, transferSchema)), 201));
  api.get("/stores/:storeId/low-stock", async (c) => c.json(await inventory.lowStock(infra, actor(c), c.req.param("storeId"))));

  // clients
  api.get("/customers", async (c) => c.json(await customers.searchCustomers(infra, actor(c), c.req.query("q") ?? "")));
  api.post("/customers", async (c) => c.json(await customers.createCustomer(infra, actor(c), await body(c, customerSchema)), 201));
  api.patch("/customers/:id", async (c) => c.json(await customers.updateCustomer(infra, actor(c), c.req.param("id"), await body(c, customerSchema.partial()))));
  api.get("/customers/:id", async (c) => c.json(await customers.customerProfile(infra, actor(c), c.req.param("id"))));

  // reports + AI
  api.get("/reports/summary", async (c) => c.json(await reports.salesSummary(infra, actor(c), rangeQuerySchema.parse(c.req.query()))));
  api.get("/reports/top-products", async (c) => c.json(await reports.topProducts(infra, actor(c), rangeQuerySchema.parse(c.req.query()))));
  api.get("/reports/staff", async (c) => c.json(await reports.staffPerformance(infra, actor(c), rangeQuerySchema.parse(c.req.query()))));
  api.get("/reports/anomalies", async (c) => c.json(await reports.anomalies(infra, actor(c), rangeQuerySchema.parse(c.req.query()))));
  api.post("/insights/ask", async (c) => c.json(await askInsights(infra, actor(c), await body(c, askSchema), c.req.raw.signal)));
  api.get("/analytics/usage", async (c) => {
    assertCan(actor(c), "tenant.billing");
    return c.json(await infra.analytics.read(parseRange(c.req.query("range"))));
  });

  // administration
  api.put("/branding", async (c) => c.json(await admin.setTheme(infra, actor(c), await body(c, themeUpdateSchema), c.req.query("storeId"))));
  api.post("/devices", async (c) => c.json(await admin.registerDevice(infra, actor(c), await body(c, z.object({ id: z.uuid(), storeId: z.uuid(), name: z.string().min(1).max(60), platform: z.string().max(20) }))), 201));
  api.post("/staff", async (c) => c.json(await admin.addStaff(infra, actor(c), await body(c, membershipSchema)), 201));
  api.patch("/staff/:id", async (c) =>
    c.json(await admin.updateStaff(infra, actor(c), c.req.param("id"), await body(c, z.object({ role: z.enum(ROLES).optional(), storeIds: z.array(z.uuid()).nullable().optional(), active: z.boolean().optional() })))),
  );
  api.put("/me/pin", async (c) => c.json(await admin.setPin(infra, actor(c), (await body(c, z.object({ pin: z.string() }))).pin)));
  api.post("/tokens", async (c) => c.json(await admin.createApiToken(infra, actor(c), await body(c, apiTokenSchema)), 201));
  api.delete("/tokens/:id", async (c) => c.json(await admin.revokeApiToken(infra, actor(c), c.req.param("id"))));
  api.post("/media/sign", async (c) =>
    c.json(signUpload(infra, actor(c), await body(c, z.object({ filename: z.string().max(200), contentType: z.string().max(100), bytes: z.number().int().positive(), purpose: z.enum(["product", "brand", "certificate"]) })))),
  );

  app.route("/api", api);

  // Staff MCP endpoint (Streamable HTTP). Personal access tokens only: an AI client never holds a session cookie.
  const mcp = new Hono<AppEnv>();
  mcp.use(async (c, next) => {
    if (!c.req.header("authorization")?.startsWith("Bearer lpos_")) {
      c.header("WWW-Authenticate", 'Bearer realm="luxury-pos", error="invalid_token"');
      throw new AppError(401, "unauthenticated", "create a personal access token in Settings → Integrations");
    }
    return next();
  });
  mcp.use(authenticate(infra, auth));
  mcp.use(async (c, next) => {
    assertCan(actor(c), "mcp.access");
    return next();
  });
  mcp.post("/", (c) => handleMcp(infra, actor(c), c.req.raw));
  mcp.on(["GET", "DELETE"], "/", (c) => c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405));
  app.route("/mcp", mcp);

  return app;
}
