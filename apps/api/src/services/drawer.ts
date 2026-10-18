import { and, eq, isNull, sql } from "drizzle-orm";
import { drawerMovements, drawerSessions, payments, posAuditEvents, withTenant, orders } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { assertCan, type Actor } from "../lib/context";
import { AppError, conflict, notFound } from "../lib/errors";

export async function openDrawer(infra: Infra, actor: Actor, input: { id: string; storeId: string; deviceId: string; openingFloat: number }) {
  assertCan(actor, "drawer.open", input.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [row] = await tx
      .insert(drawerSessions)
      .values({ ...input, tenantId: actor.tenantId, openedBy: actor.userId, expectedCash: input.openingFloat })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const same = await tx.query.drawerSessions.findFirst({ where: eq(drawerSessions.id, input.id) });
      if (same) return same;
      throw conflict("drawer_open", "this device already has an open drawer");
    }
    return row;
  });
}

export async function drawerMovement(infra: Infra, actor: Actor, sessionId: string, input: { kind: "paid_in" | "paid_out"; amount: number; reason: string }) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [s] = await tx.select().from(drawerSessions).where(and(eq(drawerSessions.id, sessionId), isNull(drawerSessions.closedAt))).for("update");
    if (!s) throw notFound("open drawer");
    assertCan(actor, "drawer.paid_in_out", s.storeId);
    const delta = input.kind === "paid_in" ? input.amount : -input.amount;
    if (s.expectedCash + delta < 0) throw new AppError(422, "insufficient_cash", "not enough cash in the drawer");
    await tx.insert(drawerMovements).values({ ...input, tenantId: actor.tenantId, sessionId, actorId: actor.userId });
    await tx.update(drawerSessions).set({ expectedCash: s.expectedCash + delta }).where(eq(drawerSessions.id, sessionId));
    return { expectedCash: s.expectedCash + delta };
  });
}

/**
 * Blind close: the cashier counts first, then sees the variance.
 * Returns a Z-report built from this session's orders in one grouped query.
 */
export async function closeDrawer(infra: Infra, actor: Actor, sessionId: string, input: { countedCash: number; note?: string }) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [s] = await tx.select().from(drawerSessions).where(and(eq(drawerSessions.id, sessionId), isNull(drawerSessions.closedAt))).for("update");
    if (!s) throw notFound("open drawer");
    assertCan(actor, "drawer.close", s.storeId);
    const variance = input.countedCash - s.expectedCash;
    await tx.update(drawerSessions).set({ countedCash: input.countedCash, variance, closedAt: new Date(), closedBy: actor.userId }).where(eq(drawerSessions.id, sessionId));
    const tenders = await tx
      .select({ method: payments.method, amount: sql<number>`sum(${payments.amount})::bigint`, count: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(orders.drawerSessionId, sessionId))
      .groupBy(payments.method);
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId: s.storeId, actorId: actor.userId, action: "drawer.closed", entity: "drawer", entityId: sessionId, data: { variance, note: input.note ?? null } });
    return { sessionId, openingFloat: s.openingFloat, expectedCash: s.expectedCash, countedCash: input.countedCash, variance, tenders };
  });
}
