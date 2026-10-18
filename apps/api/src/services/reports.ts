import { and, between, desc, eq, inArray, sql } from "drizzle-orm";
import { dailySales, dailyVariantSales, orders, posAuditEvents, products, stores, users, variants, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { assertCan, type Actor } from "../lib/context";

export interface Range {
  from: string;
  to: string;
  storeId?: string;
}

/** Stores the actor may see in this range; null = all. */
function storeScope(actor: Actor, storeId?: string): string[] | null {
  if (storeId) return [storeId];
  return actor.membership.storeIds ? [...actor.membership.storeIds] : null;
}

/** Totals and per-day series from the rollup table — cost is O(days × stores), not O(orders). */
export async function salesSummary(infra: Infra, actor: Actor, range: Range) {
  assertCan(actor, "reports.read", range.storeId);
  const scope = storeScope(actor, range.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const where = and(between(dailySales.day, range.from, range.to), scope ? inArray(dailySales.storeId, scope) : undefined);
    const series = await tx
      .select({
        day: dailySales.day,
        orders: sql<number>`sum(${dailySales.orders})::int`,
        items: sql<number>`sum(${dailySales.items})::int`,
        gross: sql<number>`sum(${dailySales.gross})::bigint`,
        discounts: sql<number>`sum(${dailySales.discounts})::bigint`,
        net: sql<number>`sum(${dailySales.net})::bigint`,
        tax: sql<number>`sum(${dailySales.tax})::bigint`,
        refunds: sql<number>`sum(${dailySales.refunds})::bigint`,
        cost: sql<number>`sum(${dailySales.cost})::bigint`,
      })
      .from(dailySales)
      .where(where)
      .groupBy(dailySales.day)
      .orderBy(dailySales.day);
    const num = (v: unknown) => Number(v ?? 0);
    const totals = series.reduce(
      (t, d) => ({
        orders: t.orders + num(d.orders),
        items: t.items + num(d.items),
        gross: t.gross + num(d.gross),
        discounts: t.discounts + num(d.discounts),
        net: t.net + num(d.net),
        tax: t.tax + num(d.tax),
        refunds: t.refunds + num(d.refunds),
        cost: t.cost + num(d.cost),
      }),
      { orders: 0, items: 0, gross: 0, discounts: 0, net: 0, tax: 0, refunds: 0, cost: 0 },
    );
    const byStore = await tx
      .select({ storeId: dailySales.storeId, name: stores.name, currency: stores.currency, net: sql<number>`sum(${dailySales.net})::bigint`, orders: sql<number>`sum(${dailySales.orders})::int` })
      .from(dailySales)
      .innerJoin(stores, eq(stores.id, dailySales.storeId))
      .where(where)
      .groupBy(dailySales.storeId, stores.name, stores.currency)
      .orderBy(desc(sql`sum(${dailySales.net})`));
    return {
      range,
      totals: { ...totals, averageOrder: totals.orders ? Math.round(totals.net / totals.orders) : 0, marginBps: totals.net ? Math.round(((totals.net - totals.cost) * 10_000) / totals.net) : 0 },
      series: series.map((d) => ({ ...d, gross: num(d.gross), net: num(d.net), tax: num(d.tax), discounts: num(d.discounts), refunds: num(d.refunds), cost: num(d.cost) })),
      byStore: byStore.map((s) => ({ ...s, net: num(s.net) })),
    };
  });
}

export async function topProducts(infra: Infra, actor: Actor, range: Range & { limit?: number; by?: "revenue" | "quantity" }) {
  assertCan(actor, "reports.read", range.storeId);
  const scope = storeScope(actor, range.storeId);
  const metric = range.by === "quantity" ? sql`sum(${dailyVariantSales.quantity})` : sql`sum(${dailyVariantSales.revenue})`;
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        variantId: dailyVariantSales.variantId,
        sku: variants.sku,
        name: products.name,
        options: variants.options,
        quantity: sql<number>`sum(${dailyVariantSales.quantity})::int`,
        revenue: sql<number>`sum(${dailyVariantSales.revenue})::bigint`,
      })
      .from(dailyVariantSales)
      .innerJoin(variants, eq(variants.id, dailyVariantSales.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(between(dailyVariantSales.day, range.from, range.to), scope ? inArray(dailyVariantSales.storeId, scope) : undefined))
      .groupBy(dailyVariantSales.variantId, variants.sku, products.name, variants.options)
      .orderBy(desc(metric))
      .limit(Math.min(range.limit ?? 10, 100));
    return rows.map((r) => ({ ...r, revenue: Number(r.revenue) }));
  });
}

/** Sales per associate (commission base). Uses the orders_staff index over the range. */
export async function staffPerformance(infra: Infra, actor: Actor, range: Range) {
  assertCan(actor, "reports.read", range.storeId);
  const scope = storeScope(actor, range.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        staffId: orders.staffId,
        name: users.name,
        orders: sql<number>`count(*)::int`,
        net: sql<number>`sum(${orders.total} - ${orders.taxTotal} - ${orders.refundedTotal})::bigint`,
        discounts: sql<number>`sum(${orders.discountTotal})::bigint`,
        approvals: sql<number>`count(${orders.approvedBy})::int`,
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.staffId))
      .where(
        and(
          sql`${orders.createdAt} >= ${range.from}::date and ${orders.createdAt} < ${range.to}::date + 1`,
          scope ? inArray(orders.storeId, scope) : undefined,
          sql`${orders.status} <> 'voided'`,
        ),
      )
      .groupBy(orders.staffId, users.name)
      .orderBy(desc(sql`sum(${orders.total})`));
    return rows.map((r) => ({ ...r, net: Number(r.net), discounts: Number(r.discounts) }));
  });
}

/**
 * Loss-prevention signals: refunds, overrides, stock adjustments and drawer closes
 * per staff member, with simple threshold flags. Rules-based (explainable) before any ML.
 */
export async function anomalies(infra: Infra, actor: Actor, range: Range) {
  assertCan(actor, "reports.read", range.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const rows = await tx
      .select({ actorId: posAuditEvents.actorId, action: posAuditEvents.action, count: sql<number>`count(*)::int` })
      .from(posAuditEvents)
      .where(
        and(
          inArray(posAuditEvents.action, ["order.refunded", "override.granted", "override.denied", "stock.adjust", "drawer.closed"]),
          sql`${posAuditEvents.createdAt} >= ${range.from}::date and ${posAuditEvents.createdAt} < ${range.to}::date + 1`,
          range.storeId ? eq(posAuditEvents.storeId, range.storeId) : undefined,
        ),
      )
      .groupBy(posAuditEvents.actorId, posAuditEvents.action);
    const byActor = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const key = r.actorId ?? "unknown";
      byActor.set(key, { ...byActor.get(key), [r.action]: r.count });
    }
    return [...byActor].map(([actorId, counts]) => ({ actorId, counts, flagged: (counts["override.denied"] ?? 0) >= 3 || (counts["order.refunded"] ?? 0) >= 10 }));
  });
}
