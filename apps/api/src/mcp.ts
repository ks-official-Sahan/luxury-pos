import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { formatMoney, uuidv7 } from "@luxury-pos/core";
import type { Infra } from "./infra";
import type { Actor } from "./lib/context";
import { AppError } from "./lib/errors";
import { bootstrap } from "./services/admin";
import { searchCatalog } from "./services/catalog";
import { customerProfile, searchCustomers } from "./services/customers";
import { askInsights } from "./services/insights";
import { adjustStock, lowStock, transferStock } from "./services/inventory";
import { listAudit, listOrders, listStaff, orderDetail, roleMatrix } from "./services/backoffice";
import { anomalies, salesSummary, staffPerformance, topProducts } from "./services/reports";

const day = z.iso.date().describe("YYYY-MM-DD");
const storeId = z.uuid().optional().describe("Store id from list_stores; omit for every store you can see");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const defaultRange = (from?: string, to?: string) => ({ from: from ?? isoDay(new Date(Date.now() - 6 * 86_400_000)), to: to ?? isoDay(new Date()) });

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> });

/** Every tool runs as the token's owner, inside the token's scopes; the same service checks as the apps apply. */
async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return json(Array.isArray(data) ? { items: data } : data);
  } catch (err) {
    const message = err instanceof AppError ? `${err.code}: ${err.message}` : "internal error";
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

export function createPosMcpServer(infra: Infra, actor: Actor): McpServer {
  const server = new McpServer(
    { name: "luxury-pos", version: "0.2.0" },
    { instructions: "Store management for staff. Amounts are integers in the currency's minor unit (cents). Use list_stores first to get store ids. Write tools need confirm=true; call them without it to preview." },
  );
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool("list_stores", { description: "Stores, currencies and your role and permissions in this business.", inputSchema: z.object({}), annotations: ro }, () =>
    run(async () => {
      const b = await bootstrap(infra, actor);
      return { tenant: b.tenant.name, me: b.me, permissions: b.permissions, stores: b.stores.map((s) => ({ id: s.id, code: s.code, name: s.name, currency: s.currency, timezone: s.timezone })) };
    }),
  );

  server.registerTool(
    "sales_summary",
    { description: "Orders, net sales, discounts, refunds, margin and a daily series for a date range (defaults to the last 7 days).", inputSchema: z.object({ from: day.optional(), to: day.optional(), storeId }), annotations: ro },
    ({ from, to, storeId }) => run(() => salesSummary(infra, actor, { ...defaultRange(from, to), storeId })),
  );

  server.registerTool(
    "top_products",
    {
      description: "Best sellers by revenue or units for a range.",
      inputSchema: z.object({ from: day.optional(), to: day.optional(), storeId, by: z.enum(["revenue", "quantity"]).default("revenue"), limit: z.number().int().min(1).max(50).default(10) }),
      annotations: ro,
    },
    ({ from, to, storeId, by, limit }) => run(() => topProducts(infra, actor, { ...defaultRange(from, to), storeId, by, limit })),
  );

  server.registerTool(
    "low_stock",
    { description: "Items at or under their reorder point at a store, with 28-day sales velocity and a suggested reorder quantity.", inputSchema: z.object({ storeId: z.uuid(), leadTimeDays: z.number().int().min(0).max(120).default(14) }), annotations: ro },
    ({ storeId, leadTimeDays }) => run(() => lowStock(infra, actor, storeId, { leadTimeDays })),
  );

  server.registerTool(
    "staff_performance",
    { description: "Sales, discounts and manager approvals per associate for a range.", inputSchema: z.object({ from: day.optional(), to: day.optional(), storeId }), annotations: ro },
    ({ from, to, storeId }) => run(() => staffPerformance(infra, actor, { ...defaultRange(from, to), storeId })),
  );

  server.registerTool(
    "loss_prevention_signals",
    { description: "Refunds, overrides (granted and denied), stock adjustments and drawer closes per staff member, with simple flags.", inputSchema: z.object({ from: day.optional(), to: day.optional(), storeId }), annotations: ro },
    ({ from, to, storeId }) => run(() => anomalies(infra, actor, { ...defaultRange(from, to), storeId })),
  );

  server.registerTool(
    "search_products",
    { description: "Find products by name, brand, SKU or barcode, with stock at a store.", inputSchema: z.object({ query: z.string().min(1).max(100), storeId, limit: z.number().int().min(1).max(50).default(20) }), annotations: ro },
    ({ query, storeId, limit }) => run(() => searchCatalog(infra, actor, { query, storeId, limit })),
  );

  server.registerTool(
    "find_client",
    { description: "Search clients by name, email or phone. Contact details are masked unless you hold customer.pii.", inputSchema: z.object({ query: z.string().min(2).max(100) }), annotations: ro },
    ({ query }) => run(() => searchCustomers(infra, actor, query)),
  );

  server.registerTool(
    "client_profile",
    { description: "Clienteling view: preferences, notes, tier, points history and the last 20 purchases.", inputSchema: z.object({ customerId: z.uuid() }), annotations: ro },
    ({ customerId }) => run(() => customerProfile(infra, actor, customerId)),
  );

  server.registerTool(
    "ask_store_analyst",
    { description: "Ask a question about the last 30 days of sales and stock; answered by the store's AI analyst from aggregated data.", inputSchema: z.object({ question: z.string().min(3).max(500), storeId }), annotations: ro },
    ({ question, storeId }) => run(() => askInsights(infra, actor, { question, storeId })),
  );

  server.registerTool(
    "adjust_stock",
    {
      description: "Record a stock count correction, damage or shrink at a store (positive or negative quantity). Without confirm=true it only previews.",
      inputSchema: z.object({ storeId: z.uuid(), variantId: z.uuid(), quantity: z.number().int().min(-10_000).max(10_000).refine((n) => n !== 0), reason: z.string().min(3).max(280), confirm: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ storeId, variantId, quantity, reason, confirm }) =>
      run(async () => {
        if (!confirm) return { preview: true, change: { storeId, variantId, quantity, reason }, note: "Call again with confirm=true to apply. It is audited under your name." };
        return adjustStock(infra, actor, { id: uuidv7(), storeId, variantId, type: "adjust", quantity, reason: `[mcp] ${reason}` });
      }),
  );

  server.registerTool(
    "recent_orders",
    {
      description: "Orders newest first, with store, associate, client, items and refund state. Page with the returned nextCursor.",
      inputSchema: z.object({ storeId, status: z.enum(["completed", "partially_refunded", "refunded", "voided"]).optional(), receiptNo: z.string().max(40).optional(), cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(20) }),
      annotations: ro,
    },
    ({ storeId, status, receiptNo, cursor, limit }) => run(() => listOrders(infra, actor, { storeId, status, q: receiptNo, cursor, limit })),
  );

  server.registerTool("order_detail", { description: "One order with its lines, tenders and refunds.", inputSchema: z.object({ orderId: z.uuid() }), annotations: ro }, ({ orderId }) => run(() => orderDetail(infra, actor, orderId)));

  server.registerTool("team", { description: "Team members, their roles, store scope and whether they have a till PIN.", inputSchema: z.object({}), annotations: ro }, () => run(() => listStaff(infra, actor)));

  server.registerTool("role_matrix", { description: "What each role may do in this business (defaults plus this business's edits).", inputSchema: z.object({}), annotations: ro }, () => run(() => roleMatrix(infra, actor)));

  server.registerTool(
    "audit_trail",
    { description: "Who did what and when: sales, refunds, overrides, stock, staff and branding changes. Filter by action prefix such as 'order.' or 'stock.'.", inputSchema: z.object({ action: z.string().max(60).optional(), cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(30) }), annotations: ro },
    ({ action, cursor, limit }) => run(() => listAudit(infra, actor, { action, cursor, limit })),
  );

  server.registerTool(
    "transfer_stock",
    {
      description: "Move stock between two stores (both sides or neither). Without confirm=true it only previews.",
      inputSchema: z.object({ fromStoreId: z.uuid(), toStoreId: z.uuid(), lines: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10_000) })).min(1).max(50), confirm: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ fromStoreId, toStoreId, lines, confirm }) =>
      run(async () => {
        if (!confirm) return { preview: true, change: { fromStoreId, toStoreId, lines }, note: "Call again with confirm=true to apply. It is audited under your name." };
        return transferStock(infra, actor, { id: uuidv7(), fromStoreId, toStoreId, lines });
      }),
  );

  server.registerPrompt(
    "daily_briefing",
    { title: "Daily store briefing", description: "Yesterday's results, best sellers, low stock and anything unusual, for one store or all.", argsSchema: { storeId: z.string().optional() } },
    ({ storeId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Prepare a short morning briefing${storeId ? ` for store ${storeId}` : " across all my stores"}. Use sales_summary for yesterday and the same weekday last week, top_products for yesterday, low_stock for each store, and anomalies for the last 7 days. Lead with the three things a manager should act on today. Amounts are minor units; use format_money.`,
          },
        },
      ],
    }),
  );

  server.registerTool(
    "format_money",
    { description: "Format a minor-unit amount for display.", inputSchema: z.object({ amount: z.number().int(), currency: z.string().length(3) }), annotations: ro },
    async ({ amount, currency }) => ({ content: [{ type: "text" as const, text: formatMoney(amount, currency) }] }),
  );

  return server;
}

/** Stateless Streamable HTTP: one server + transport per request, so it scales horizontally with no sticky sessions. */
export async function handleMcp(infra: Infra, actor: Actor, request: Request): Promise<Response> {
  const server = createPosMcpServer(infra, actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}
