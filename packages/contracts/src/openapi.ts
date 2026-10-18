import { z } from "zod";
import * as c from "./index";

/**
 * The HTTP contract as data. The Hono API implements it today; any other backend
 * (a Django/DRF service, a regional Worker, a microservice split out later) is
 * swappable behind the edge gateway as long as it serves the same document.
 * `pnpm --filter @luxury-pos/contracts openapi` writes docs/openapi.json.
 */
type Route = { method: "get" | "post" | "put" | "patch" | "delete"; path: string; summary: string; permission?: string; body?: z.ZodType; query?: z.ZodObject; public?: true };

const page = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export const ROUTES: Route[] = [
  { method: "get", path: "/api/public/brand/{slug}", summary: "Store name and brand theme (cacheable)", public: true },
  { method: "post", path: "/api/signup", summary: "Create a business, first store and owner", public: true },
  { method: "get", path: "/api/me", summary: "Bootstrap: tenant, visible stores with resolved theme, own permissions" },
  { method: "get", path: "/api/catalog/search", summary: "Search sellable variants with stock", permission: "catalog.read", query: z.object({ q: z.string().optional(), storeId: z.uuid().optional(), limit: z.coerce.number().optional() }) },
  { method: "get", path: "/api/catalog/sync", summary: "Keyset catalogue sync for offline devices", permission: "catalog.read", query: c.syncPullSchema },
  { method: "post", path: "/api/products", summary: "Create a product with variants", permission: "catalog.write", body: c.productSchema },
  { method: "post", path: "/api/orders", summary: "Book a sale (UUIDv7 id = idempotency key)", permission: "sale.create", body: c.createOrderSchema },
  { method: "get", path: "/api/orders", summary: "Orders, newest first (keyset)", permission: "reports.read", query: page.extend({ storeId: z.uuid().optional(), status: z.string().optional(), q: z.string().optional() }) },
  { method: "get", path: "/api/orders/{id}", summary: "Order with lines, tenders and refunds", permission: "reports.read" },
  { method: "post", path: "/api/refunds", summary: "Refund lines of an order", permission: "sale.refund", body: c.refundSchema },
  { method: "post", path: "/api/overrides", summary: "Manager PIN approval token", body: c.overrideRequestSchema },
  { method: "post", path: "/api/drawers", summary: "Open a cash drawer session", permission: "drawer.open", body: c.drawerOpenSchema },
  { method: "post", path: "/api/drawers/{id}/close", summary: "Blind count and Z-report", permission: "drawer.close", body: c.drawerCloseSchema },
  { method: "post", path: "/api/stock/movements", summary: "Receive, count or adjust stock", permission: "inventory.adjust", body: c.stockAdjustSchema },
  { method: "post", path: "/api/stock/transfers", summary: "Transfer stock between stores", permission: "inventory.transfer", body: c.transferSchema },
  { method: "get", path: "/api/stores/{storeId}/low-stock", summary: "Low stock with reorder suggestions", permission: "inventory.read" },
  { method: "get", path: "/api/stores/{storeId}/serials", summary: "Serial numbers in stock for a variant", permission: "sale.create", query: z.object({ variantId: z.uuid() }) },
  { method: "get", path: "/api/customers", summary: "Search clients", permission: "customer.read", query: z.object({ q: z.string().optional() }) },
  { method: "post", path: "/api/customers", summary: "Create a client", permission: "customer.write", body: c.customerSchema },
  { method: "get", path: "/api/customers/{id}", summary: "Client profile, history and points", permission: "customer.read" },
  { method: "get", path: "/api/reports/summary", summary: "Sales totals and daily series (rollups)", permission: "reports.read", query: c.rangeQuerySchema },
  { method: "get", path: "/api/reports/top-products", summary: "Best sellers", permission: "reports.read", query: c.rangeQuerySchema },
  { method: "get", path: "/api/reports/staff", summary: "Staff performance", permission: "reports.read", query: c.rangeQuerySchema },
  { method: "get", path: "/api/reports/anomalies", summary: "Loss-prevention signals", permission: "reports.read", query: c.rangeQuerySchema },
  { method: "post", path: "/api/insights/ask", summary: "AI analyst over aggregates", permission: "ai.insights", body: c.askSchema },
  { method: "post", path: "/api/till-events", summary: "Record a void on the till (fewer units, line removed, sale cleared); approved device only", permission: "sale.create", body: z.object({ id: z.uuid(), action: z.enum(["line_voided", "quantity_reduced", "sale_cleared"]), storeId: z.uuid(), deviceId: z.uuid(), approved: z.boolean(), at: z.iso.datetime() }) },
  { method: "get", path: "/api/devices/{id}/status", summary: "Trust status of a device (pending, approved, blocked)" },
  { method: "post", path: "/api/devices/{id}/approve", summary: "Approve or unblock a till", permission: "store.settings" },
  { method: "post", path: "/api/devices/{id}/block", summary: "Block a till from taking sales", permission: "store.settings", body: z.object({ reason: z.string().max(280).optional() }) },
  { method: "post", path: "/api/me/pin/verify", summary: "Unlock a locked till with the signed-in person's PIN", body: z.object({ pin: z.string().regex(/^\d{4,8}$/) }) },
  { method: "put", path: "/api/branding", summary: "Set tenant or store theme", permission: "store.branding", body: c.themeUpdateSchema },
  { method: "get", path: "/api/staff", summary: "Team members", permission: "staff.manage" },
  { method: "post", path: "/api/staff", summary: "Add a team member", permission: "staff.manage", body: c.membershipSchema },
  { method: "get", path: "/api/roles", summary: "Effective permission matrix", permission: "staff.manage" },
  { method: "put", path: "/api/roles/{role}", summary: "Replace or reset one role's permissions", permission: "staff.manage" },
  { method: "get", path: "/api/audit", summary: "Audit trail (keyset)", permission: "staff.manage", query: page.extend({ action: z.string().optional() }) },
  { method: "get", path: "/api/devices", summary: "Registered tills", permission: "store.settings" },
  { method: "get", path: "/api/tokens", summary: "Personal access tokens (no secrets)" },
  { method: "post", path: "/api/tokens", summary: "Create a scoped token for MCP / integrations", permission: "mcp.access", body: c.apiTokenSchema },
  { method: "post", path: "/mcp", summary: "Staff MCP server (Streamable HTTP, bearer token)", permission: "mcp.access" },
];

export function buildOpenApi(version = "0.2.0") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const query = r.query
      ? Object.entries(z.toJSONSchema(r.query, { io: "input", unrepresentable: "any" }).properties ?? {}).map(([name, schema]) => ({ name, in: "query", required: false, schema }))
      : [];
    (paths[r.path] ??= {})[r.method] = {
      summary: r.summary,
      ...(r.permission ? { "x-permission": r.permission } : {}),
      security: r.public ? [] : r.path === "/mcp" ? [{ bearer: [] }] : [{ session: [], tenant: [] }, { bearer: [] }],
      parameters: [...params, ...query],
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(r.body, { io: "input", unrepresentable: "any" }) } } } } : {}),
      responses: { "200": { description: "OK" }, "4XX": { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Luxury POS API", version, description: "Multi-tenant POS API. Every non-public route needs a session cookie plus X-Tenant-Id, or a personal access token." },
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        tenant: { type: "apiKey", in: "header", name: "X-Tenant-Id" },
        bearer: { type: "http", scheme: "bearer", description: "Personal access token (lpos_…)" },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
        CloudEvent: z.toJSONSchema(c.cloudEventSchema),
      },
    },
  };
}
