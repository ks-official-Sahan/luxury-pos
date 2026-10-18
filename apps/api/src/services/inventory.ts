import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { reorderSuggestion, signedQuantity, uuidv7, weightedAverageCost, type Permission } from "@luxury-pos/core";
import type { stockAdjustSchema, transferSchema } from "@luxury-pos/contracts";
import { dailyVariantSales, posAuditEvents, products, serialItems, stockLevels, stockMovements, variants, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { assertCan, type Actor } from "../lib/context";
import { AppError, conflict } from "../lib/errors";
import { emit } from "../events/emit";

type AdjustInput = z.infer<typeof stockAdjustSchema>;
type TransferInput = z.infer<typeof transferSchema>;

const PERMISSION: Record<AdjustInput["type"], Permission> = {
  receive: "inventory.receive",
  adjust: "inventory.adjust",
  transfer_in: "inventory.transfer",
  transfer_out: "inventory.transfer",
  consign_in: "inventory.receive",
  consign_out: "inventory.adjust",
};

export async function adjustStock(infra: Infra, actor: Actor, input: AdjustInput) {
  assertCan(actor, PERMISSION[input.type], input.storeId);
  const qty = signedQuantity(input.type, input.quantity);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const inserted = await tx
      .insert(stockMovements)
      .values({ id: input.id, tenantId: actor.tenantId, storeId: input.storeId, variantId: input.variantId, type: input.type, quantity: qty, unitCost: input.unitCost, reason: input.reason, actorId: actor.userId })
      .onConflictDoNothing()
      .returning({ id: stockMovements.id });
    if (!inserted.length) return { replayed: true as const };

    const [level] = await tx.select().from(stockLevels).where(and(eq(stockLevels.storeId, input.storeId), eq(stockLevels.variantId, input.variantId))).for("update");
    const avgCost = input.type === "receive" && input.unitCost !== undefined ? weightedAverageCost({ onHand: level?.onHand ?? 0, avgCost: level?.avgCost ?? 0 }, qty, input.unitCost) : (level?.avgCost ?? 0);
    const [next] = await tx
      .insert(stockLevels)
      .values({ tenantId: actor.tenantId, storeId: input.storeId, variantId: input.variantId, onHand: qty, avgCost })
      .onConflictDoUpdate({ target: [stockLevels.storeId, stockLevels.variantId], set: { onHand: sql`${stockLevels.onHand} + ${qty}`, avgCost, updatedAt: sql`now()` } })
      .returning();
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId: input.storeId, actorId: actor.userId, action: `stock.${input.type}`, entity: "variant", entityId: input.variantId, data: { quantity: qty, reason: input.reason ?? null } });
    await emit(tx, actor.tenantId, "pos.stock.adjusted.v1", { storeId: input.storeId, reason: input.type, changes: [{ variantId: input.variantId, delta: qty }] }, { storeId: input.storeId });
    return { replayed: false as const, level: next };
  });
}

/** Moves stock between stores in one transaction: both sides or neither. Locks rows in a fixed order to avoid deadlocks. */
export async function transferStock(infra: Infra, actor: Actor, input: TransferInput) {
  if (input.fromStoreId === input.toStoreId) throw new AppError(422, "same_store", "choose two different stores");
  assertCan(actor, "inventory.transfer", input.fromStoreId);
  assertCan(actor, "inventory.transfer", input.toStoreId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const ids = input.lines.map((l) => l.variantId).sort();
    const source = await tx
      .select({ variantId: stockLevels.variantId, onHand: stockLevels.onHand, reserved: stockLevels.reserved, avgCost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.storeId, input.fromStoreId), inArray(stockLevels.variantId, ids)))
      .orderBy(asc(stockLevels.variantId))
      .for("update");
    const bySource = new Map(source.map((s) => [s.variantId, s]));
    const short = input.lines.filter((l) => (bySource.get(l.variantId)?.onHand ?? 0) - (bySource.get(l.variantId)?.reserved ?? 0) < l.quantity);
    if (short.length) throw conflict("insufficient_stock", "not enough stock to transfer", { variants: short.map((s) => s.variantId) });

    const movements = input.lines.flatMap((l) => [
      { id: uuidv7(), tenantId: actor.tenantId, storeId: input.fromStoreId, variantId: l.variantId, type: "transfer_out", quantity: -l.quantity, refType: "transfer", refId: input.id, actorId: actor.userId },
      { id: uuidv7(), tenantId: actor.tenantId, storeId: input.toStoreId, variantId: l.variantId, type: "transfer_in", quantity: l.quantity, refType: "transfer", refId: input.id, actorId: actor.userId },
    ]);
    await tx.insert(stockMovements).values(movements);
    await tx
      .insert(stockLevels)
      .values(movements.map((m) => ({ tenantId: actor.tenantId, storeId: m.storeId, variantId: m.variantId, onHand: m.quantity, avgCost: bySource.get(m.variantId)?.avgCost ?? 0 })))
      .onConflictDoUpdate({ target: [stockLevels.storeId, stockLevels.variantId], set: { onHand: sql`${stockLevels.onHand} + excluded.on_hand`, updatedAt: sql`now()` } });
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId: input.fromStoreId, actorId: actor.userId, action: "stock.transfer", entity: "transfer", entityId: input.id, data: { to: input.toStoreId, lines: input.lines.length } });
    for (const [storeId, sign] of [[input.fromStoreId, -1], [input.toStoreId, 1]] as const)
      await emit(tx, actor.tenantId, "pos.stock.adjusted.v1", { storeId, reason: "transfer", changes: input.lines.map((l) => ({ variantId: l.variantId, delta: sign * l.quantity })) }, { storeId });
    return { id: input.id, lines: input.lines.length };
  });
}

/** Low stock with a reorder suggestion from the last 28 days of sales (one grouped query). */
export async function lowStock(infra: Infra, actor: Actor, storeId: string, opts: { leadTimeDays?: number; safetyDays?: number; limit?: number } = {}) {
  assertCan(actor, "inventory.read", storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const velocity = tx
      .select({ variantId: dailyVariantSales.variantId, sold: sql<number>`sum(${dailyVariantSales.quantity})::int`.as("sold") })
      .from(dailyVariantSales)
      .where(and(eq(dailyVariantSales.storeId, storeId), sql`${dailyVariantSales.day} >= current_date - 28`))
      .groupBy(dailyVariantSales.variantId)
      .as("velocity");
    const rows = await tx
      .select({
        variantId: stockLevels.variantId,
        sku: variants.sku,
        name: products.name,
        options: variants.options,
        onHand: stockLevels.onHand,
        available: sql<number>`${stockLevels.onHand} - ${stockLevels.reserved}`,
        reorderPoint: stockLevels.reorderPoint,
        sold28: sql<number>`coalesce(${velocity.sold}, 0)`,
      })
      .from(stockLevels)
      .innerJoin(variants, eq(variants.id, stockLevels.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .leftJoin(velocity, eq(velocity.variantId, stockLevels.variantId))
      .where(and(eq(stockLevels.storeId, storeId), sql`${stockLevels.onHand} - ${stockLevels.reserved} <= greatest(${stockLevels.reorderPoint}, coalesce(${velocity.sold}, 0) / 28.0 * ${(opts.leadTimeDays ?? 14) + (opts.safetyDays ?? 7)})`))
      .orderBy(sql`${stockLevels.onHand} - ${stockLevels.reserved}`)
      .limit(opts.limit ?? 50);
    return rows.map((r) => ({ ...r, ...reorderSuggestion({ available: r.available, dailyVelocity: r.sold28 / 28, leadTimeDays: opts.leadTimeDays ?? 14, safetyDays: opts.safetyDays ?? 7 }) }));
  });
}

/** Serial numbers on hand at a store for one variant, so the till can offer them instead of free typing. */
export async function availableSerials(infra: Infra, actor: Actor, storeId: string, variantId: string) {
  assertCan(actor, "sale.create", storeId);
  return withTenant(infra.db, actor.tenantId, (tx) =>
    tx
      .select({ serial: serialItems.serial, certificateUrl: serialItems.certificateUrl })
      .from(serialItems)
      .where(and(eq(serialItems.storeId, storeId), eq(serialItems.variantId, variantId), eq(serialItems.status, "in_stock")))
      .orderBy(asc(serialItems.serial))
      .limit(100),
  );
}
