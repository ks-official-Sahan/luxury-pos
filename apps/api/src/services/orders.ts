import { and, eq, inArray, sql } from "drizzle-orm";
import { discountNeedsApproval, lotExpiry, maxRedeemablePoints, pointsEarned, consumeLots, currencyExponent, priceCart, receiptNumber, settle, tierFor, uuidv7 } from "@luxury-pos/core";
import type { CreateOrderInput, RefundInput } from "@luxury-pos/contracts";
import {
  customers,
  dailySales,
  dailyVariantSales,
  devices,
  drawerSessions,
  orderLines,
  orders,
  outbox,
  payments,
  pointLedger,
  pointLots,
  posAuditEvents,
  products,
  refunds,
  serialItems,
  stockLevels,
  stockMovements,
  stores,
  tenants,
  variants,
  withTenant,
  type Tx,
} from "@luxury-pos/db";
import type { Infra } from "../infra";
import { allowed, assertCan, type Actor } from "../lib/context";
import { AppError, conflict, notFound } from "../lib/errors";
import { verifyOverride } from "./overrides";

/** Local calendar day of an instant in the store's timezone (rollups are per store day). */
export function storeDay(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

async function nextReceiptSeq(tx: Tx, deviceId: string, storeId: string): Promise<{ code: string; seq: number }> {
  // The device row lock serialises receipt numbers: gap-free per device, no global hot row.
  const [row] = await tx
    .update(devices)
    .set({ receiptSeq: sql`${devices.receiptSeq} + 1`, lastSeenAt: new Date() })
    .where(and(eq(devices.id, deviceId), eq(devices.storeId, storeId)))
    .returning({ code: devices.code, seq: devices.receiptSeq });
  if (!row) throw new AppError(422, "unknown_device", "device is not registered to this store");
  return row;
}

/**
 * Creates an order atomically and idempotently.
 * - `input.id` (client UUIDv7) makes offline replays safe: a second call returns the stored order.
 * - Prices, tax and loyalty are recomputed here; the device's total must match.
 * - All reads and writes are batched: one query per table, never one per line.
 */
export async function createOrder(infra: Infra, actor: Actor, input: CreateOrderInput) {
  assertCan(actor, "sale.create", input.storeId);

  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const existing = await tx.query.orders.findFirst({ where: eq(orders.id, input.id), columns: { id: true, receiptNo: true, total: true } });
    if (existing) return { ...existing, replayed: true as const };

    const [store] = await tx.select().from(stores).where(eq(stores.id, input.storeId)).limit(1);
    if (!store) throw notFound("store");

    const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
    const rows = await tx
      .select({ id: variants.id, sku: variants.sku, price: variants.price, cost: variants.cost, name: products.name, taxRateBps: products.taxRateBps, serialized: products.serialized, options: variants.options })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(inArray(variants.id, variantIds), eq(variants.active, true)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = variantIds.filter((id) => !byId.has(id));
    if (missing.length) throw new AppError(422, "unknown_variant", "some items are no longer sold", { missing });

    // --- permissions that depend on the cart ------------------------------------------
    const overrideFor = (action: "price" | "discount") => verifyOverride(infra.env.AUTH_SECRET, input.overrideToken, { action, actor, storeId: store.id });
    let approvedBy: string | null = null;
    if (input.lines.some((l) => l.priceOverride !== undefined) && !allowed(actor, "sale.price_override", store.id)) {
      approvedBy = overrideFor("price");
      if (!approvedBy) throw new AppError(403, "override_required", "price override needs manager approval", { action: "price" });
    }
    const hasDiscount = !!input.orderDiscount || input.lines.some((l) => l.discount);
    if (hasDiscount) assertCan(actor, "sale.discount", store.id);

    const lineInputs = input.lines.map((l, i) => {
      const v = byId.get(l.variantId)!;
      if (v.serialized && (!l.serialNumber || l.quantity !== 1)) throw new AppError(422, "serial_required", `${v.name} needs a serial number and quantity 1`);
      return { id: String(i), unitPrice: l.priceOverride ?? v.price, quantity: l.quantity, taxRateBps: v.taxRateBps, discount: l.discount };
    });
    const priced = priceCart({ currency: store.currency, taxMode: store.taxMode, lines: lineInputs, orderDiscount: input.orderDiscount });

    if (hasDiscount && discountNeedsApproval(priced, store.settings.maxDiscountBps) && !allowed(actor, "sale.discount.override", store.id)) {
      approvedBy = overrideFor("discount") ?? null;
      if (!approvedBy) throw new AppError(403, "override_required", "discount above your limit needs manager approval", { action: "discount" });
    }
    if (priced.total !== input.expectedTotal) throw conflict("price_changed", "prices changed since the cart was built; refresh and retry", { expected: input.expectedTotal, actual: priced.total });

    // --- loyalty --------------------------------------------------------------------------
    const [tenant] = await tx.select({ loyalty: tenants.loyalty }).from(tenants).where(eq(tenants.id, actor.tenantId));
    const program = tenant?.loyalty ?? null;
    let customer: typeof customers.$inferSelect | undefined;
    if (input.customerId) {
      [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for("update");
      if (!customer) throw notFound("customer");
    }
    const redeem = input.redeemPoints ?? 0;
    const pointsTender = input.tenders.filter((t) => t.method === "loyalty_points").reduce((s, t) => s + t.amount, 0);
    if (redeem > 0 || pointsTender > 0) {
      if (!program || !customer) throw new AppError(422, "loyalty_unavailable", "points need a customer and a loyalty program");
      if (redeem > maxRedeemablePoints(program, priced.total, customer.pointsBalance)) throw new AppError(422, "points_exceed_limit", "too many points for this order");
      if (pointsTender !== redeem * program.pointValueMinor) throw new AppError(422, "points_tender_mismatch", "loyalty tender must equal redeemed points value");
    }

    const settlement = settle(priced.total, input.tenders, store.settings.cashIncrement);
    if (!settlement.settled) throw new AppError(422, "unpaid", "tenders do not cover the total", { balance: settlement.balance });

    // --- serial numbers ---------------------------------------------------------------------
    const serials = input.lines.filter((l) => l.serialNumber).map((l) => l.serialNumber!);
    if (serials.length) {
      const sold = await tx
        .update(serialItems)
        .set({ status: "sold", updatedAt: new Date() })
        .where(and(inArray(serialItems.serial, serials), eq(serialItems.status, "in_stock"), eq(serialItems.storeId, store.id)))
        .returning({ serial: serialItems.serial });
      if (sold.length !== serials.length) throw conflict("serial_unavailable", "a serial number is not in stock at this store");
    }

    // --- write the order -------------------------------------------------------------------
    const { code: deviceCode, seq } = await nextReceiptSeq(tx, input.deviceId, store.id);
    const createdAt = new Date(input.createdAt);
    const exponent = currencyExponent(store.currency);
    const tier = program && customer ? tierFor(program, customer.lifetimeSpend) : null;
    const eligible = priced.lines.reduce((s, l) => s + l.net, 0) - pointsTender;
    const earned = program && customer ? pointsEarned(program, eligible, exponent, tier) : 0;

    const [order] = await tx
      .insert(orders)
      .values({
        id: input.id,
        tenantId: actor.tenantId,
        storeId: store.id,
        deviceId: input.deviceId,
        drawerSessionId: input.drawerSessionId,
        customerId: customer?.id,
        staffId: actor.userId,
        receiptNo: receiptNumber(store.code, deviceCode, seq),
        currency: store.currency,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        total: priced.total + settlement.rounding,
        pointsEarned: earned,
        pointsRedeemed: redeem,
        approvedBy,
        note: input.note,
        createdAt,
      })
      .onConflictDoNothing({ target: orders.id })
      .returning({ id: orders.id, receiptNo: orders.receiptNo, total: orders.total });
    // A concurrent replay of the same id won the race: hand back its result.
    if (!order) {
      const again = await tx.query.orders.findFirst({ where: eq(orders.id, input.id), columns: { id: true, receiptNo: true, total: true } });
      return { ...again!, replayed: true as const };
    }

    const lineRows = priced.lines.map((p, i) => {
      const l = input.lines[i]!;
      const v = byId.get(l.variantId)!;
      const label = Object.values(v.options).filter(Boolean).join(" / ");
      return {
        tenantId: actor.tenantId,
        orderId: order.id,
        variantId: v.id,
        name: label ? `${v.name} — ${label}` : v.name,
        sku: v.sku,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        unitCost: v.cost,
        lineDiscount: p.lineDiscount,
        orderDiscount: p.orderDiscount,
        tax: p.tax,
        total: p.total,
        taxRateBps: p.taxRateBps,
        serialNumber: l.serialNumber,
      };
    });
    await tx.insert(orderLines).values(lineRows);
    await tx.insert(payments).values(
      input.tenders.map((t) => ({ tenantId: actor.tenantId, orderId: order.id, method: t.method, amount: t.method === "cash" ? t.amount - settlement.changeDue : t.amount, reference: t.reference })),
    );

    // --- stock: one movement per line, one upsert per variant ------------------------------
    const qtyByVariant = new Map<string, number>();
    for (const r of lineRows) qtyByVariant.set(r.variantId, (qtyByVariant.get(r.variantId) ?? 0) + r.quantity);
    await tx.insert(stockMovements).values(
      lineRows.map((r) => ({ id: uuidv7(), tenantId: actor.tenantId, storeId: store.id, variantId: r.variantId, type: "sale", quantity: -r.quantity, refType: "order", refId: order.id, actorId: actor.userId })),
    );
    await tx
      .insert(stockLevels)
      .values([...qtyByVariant].map(([variantId, q]) => ({ tenantId: actor.tenantId, storeId: store.id, variantId, onHand: -q })))
      .onConflictDoUpdate({ target: [stockLevels.storeId, stockLevels.variantId], set: { onHand: sql`${stockLevels.onHand} + excluded.on_hand`, updatedAt: sql`now()` } });

    // --- cash drawer -------------------------------------------------------------------
    const cashIn = input.tenders.filter((t) => t.method === "cash").reduce((s, t) => s + t.amount, 0) - settlement.changeDue;
    if (cashIn !== 0 && input.drawerSessionId) {
      const updated = await tx
        .update(drawerSessions)
        .set({ expectedCash: sql`${drawerSessions.expectedCash} + ${cashIn}` })
        .where(and(eq(drawerSessions.id, input.drawerSessionId), sql`${drawerSessions.closedAt} is null`))
        .returning({ id: drawerSessions.id });
      if (!updated.length) throw new AppError(422, "drawer_closed", "the cash drawer session is closed");
    }

    // --- loyalty ledger ----------------------------------------------------------------
    if (customer) {
      if (redeem > 0) {
        const lots = await tx.select({ id: pointLots.id, remaining: pointLots.remaining, expiresAt: pointLots.expiresAt }).from(pointLots).where(and(eq(pointLots.customerId, customer.id), sql`${pointLots.remaining} > 0`));
        const takes = consumeLots(lots, redeem, createdAt);
        await tx.execute(sql`update point_lots p set remaining = p.remaining - v.take
          from (select unnest(${takes.map((t) => t.lotId)}::uuid[]) as id, unnest(${takes.map((t) => t.points)}::int[]) as take) v where p.id = v.id`);
        await tx.insert(pointLedger).values({ tenantId: actor.tenantId, customerId: customer.id, delta: -redeem, kind: "redeem", orderId: order.id, actorId: actor.userId });
      }
      if (earned > 0 && program) {
        await tx.insert(pointLots).values({ tenantId: actor.tenantId, customerId: customer.id, orderId: order.id, points: earned, remaining: earned, expiresAt: lotExpiry(program, createdAt) });
        await tx.insert(pointLedger).values({ tenantId: actor.tenantId, customerId: customer.id, delta: earned, kind: "earn", orderId: order.id });
      }
      const newSpend = customer.lifetimeSpend + priced.total;
      await tx
        .update(customers)
        .set({
          pointsBalance: customer.pointsBalance - redeem + earned,
          lifetimeSpend: newSpend,
          tierId: program ? (tierFor(program, newSpend)?.id ?? null) : customer.tierId,
          lastPurchaseAt: createdAt,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customer.id));
    }

    // --- rollups for dashboards and MCP -------------------------------------------------
    const day = storeDay(createdAt, store.timezone);
    const items = lineRows.reduce((s, r) => s + r.quantity, 0);
    const cost = lineRows.reduce((s, r) => s + r.unitCost * r.quantity, 0);
    await tx
      .insert(dailySales)
      .values({ tenantId: actor.tenantId, storeId: store.id, day, orders: 1, items, gross: priced.subtotal, discounts: priced.discountTotal, tax: priced.taxTotal, net: priced.total - priced.taxTotal, cost })
      .onConflictDoUpdate({
        target: [dailySales.storeId, dailySales.day],
        set: {
          orders: sql`${dailySales.orders} + 1`,
          items: sql`${dailySales.items} + excluded.items`,
          gross: sql`${dailySales.gross} + excluded.gross`,
          discounts: sql`${dailySales.discounts} + excluded.discounts`,
          tax: sql`${dailySales.tax} + excluded.tax`,
          net: sql`${dailySales.net} + excluded.net`,
          cost: sql`${dailySales.cost} + excluded.cost`,
        },
      });
    const revenueByVariant = new Map<string, number>();
    for (const r of lineRows) revenueByVariant.set(r.variantId, (revenueByVariant.get(r.variantId) ?? 0) + r.total - r.tax);
    await tx
      .insert(dailyVariantSales)
      .values([...qtyByVariant].map(([variantId, quantity]) => ({ tenantId: actor.tenantId, storeId: store.id, day, variantId, quantity, revenue: revenueByVariant.get(variantId) ?? 0 })))
      .onConflictDoUpdate({
        target: [dailyVariantSales.storeId, dailyVariantSales.day, dailyVariantSales.variantId],
        set: { quantity: sql`${dailyVariantSales.quantity} + excluded.quantity`, revenue: sql`${dailyVariantSales.revenue} + excluded.revenue` },
      });

    // --- side effects through the outbox (delivered after commit) -----------------------
    if (customer?.email && store.settings.receiptEmail) {
      await tx.insert(outbox).values({ tenantId: actor.tenantId, topic: "receipt.email", payload: { orderId: order.id, to: customer.email } });
    }
    await tx.insert(posAuditEvents).values({
      tenantId: actor.tenantId,
      storeId: store.id,
      actorId: actor.userId,
      action: "order.created",
      entity: "order",
      entityId: order.id,
      data: { total: priced.total, approvedBy, offline: Date.now() - createdAt.getTime() > 60_000 },
    });

    return { ...order, replayed: false as const, changeDue: settlement.changeDue, pointsEarned: earned };
  });
}

/** Partial or full refund against the original lines; restocks and reverses rollups and points proportionally. */
export async function refundOrder(infra: Infra, actor: Actor, input: RefundInput) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const done = await tx.query.refunds.findFirst({ where: eq(refunds.id, input.id) });
    if (done) return { id: done.id, total: done.total, replayed: true as const };

    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) throw notFound("order");
    let approvedBy: string | null = null;
    if (!allowed(actor, "sale.refund", order.storeId)) {
      approvedBy = verifyOverride(infra.env.AUTH_SECRET, input.overrideToken, { action: "refund", actor, storeId: order.storeId });
      if (!approvedBy) throw new AppError(403, "override_required", "refund needs manager approval", { action: "refund" });
    }

    const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, order.id), inArray(orderLines.id, input.lines.map((l) => l.orderLineId))));
    const byId = new Map(lines.map((l) => [l.id, l]));
    let total = 0;
    const movements: (typeof stockMovements.$inferInsert)[] = [];
    for (const r of input.lines) {
      const line = byId.get(r.orderLineId);
      if (!line) throw notFound("order line");
      if (line.refundedQuantity + r.quantity > line.quantity) throw conflict("over_refund", `${line.name}: only ${line.quantity - line.refundedQuantity} left to refund`);
      // Pro-rata of what the customer paid for the line, so discounts and tax unwind exactly.
      total += Math.round((line.total * r.quantity) / line.quantity);
      if (r.restock) movements.push({ id: uuidv7(), tenantId: actor.tenantId, storeId: order.storeId, variantId: line.variantId, type: "return", quantity: r.quantity, refType: "refund", refId: input.id, actorId: actor.userId });
    }
    const tendered = input.tenders.reduce((s, t) => s + t.amount, 0);
    if (tendered !== total) throw new AppError(422, "refund_tender_mismatch", "refund tenders must equal the refund total", { total });

    await tx.insert(refunds).values({ id: input.id, tenantId: actor.tenantId, orderId: order.id, total, reason: input.reason, staffId: actor.userId, approvedBy });
    await tx.execute(sql`update order_lines l set refunded_quantity = l.refunded_quantity + v.q
      from (select unnest(${input.lines.map((l) => l.orderLineId)}::uuid[]) as id, unnest(${input.lines.map((l) => l.quantity)}::int[]) as q) v where l.id = v.id`);
    await tx.insert(payments).values(input.tenders.map((t) => ({ tenantId: actor.tenantId, orderId: order.id, refundId: input.id, method: t.method, amount: -t.amount, reference: t.reference })));
    if (movements.length) {
      await tx.insert(stockMovements).values(movements);
      await tx
        .insert(stockLevels)
        .values(movements.map((m) => ({ tenantId: actor.tenantId, storeId: order.storeId, variantId: m.variantId, onHand: m.quantity })))
        .onConflictDoUpdate({ target: [stockLevels.storeId, stockLevels.variantId], set: { onHand: sql`${stockLevels.onHand} + excluded.on_hand`, updatedAt: sql`now()` } });
    }
    const refundedTotal = order.refundedTotal + total;
    await tx.update(orders).set({ refundedTotal, status: refundedTotal >= order.total ? "refunded" : "partially_refunded" }).where(eq(orders.id, order.id));

    const [store] = await tx.select({ timezone: stores.timezone }).from(stores).where(eq(stores.id, order.storeId));
    await tx
      .insert(dailySales)
      .values({ tenantId: actor.tenantId, storeId: order.storeId, day: storeDay(new Date(), store?.timezone ?? "UTC"), refunds: total })
      .onConflictDoUpdate({ target: [dailySales.storeId, dailySales.day], set: { refunds: sql`${dailySales.refunds} + excluded.refunds` } });

    // Claw back points earned on the refunded share; never below zero.
    if (order.customerId && order.pointsEarned > 0 && order.total > 0) {
      const back = Math.floor((order.pointsEarned * total) / order.total);
      if (back > 0) {
        await tx.update(customers).set({ pointsBalance: sql`greatest(${customers.pointsBalance} - ${back}, 0)` }).where(eq(customers.id, order.customerId));
        await tx.insert(pointLedger).values({ tenantId: actor.tenantId, customerId: order.customerId, delta: -back, kind: "reverse", orderId: order.id, actorId: actor.userId });
      }
    }
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId: order.storeId, actorId: actor.userId, action: "order.refunded", entity: "order", entityId: order.id, data: { total, approvedBy, reason: input.reason } });
    return { id: input.id, total, replayed: false as const };
  });
}
