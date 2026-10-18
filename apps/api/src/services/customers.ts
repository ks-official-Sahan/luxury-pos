import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { customerSchema } from "@luxury-pos/contracts";
import { customers, orderLines, orders, pointLedger, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { allowed, assertCan, type Actor } from "../lib/context";
import { AppError, conflict, notFound } from "../lib/errors";

type CustomerInput = z.infer<typeof customerSchema>;

/** Contact details are masked unless the caller holds customer.pii (data minimisation). */
function mask<T extends { email: string | null; phone: string | null }>(actor: Actor, row: T): T {
  if (allowed(actor, "customer.pii")) return row;
  return {
    ...row,
    email: row.email ? row.email.replace(/^(.).*(@.*)$/, "$1•••$2") : null,
    phone: row.phone ? `•••${row.phone.slice(-3)}` : null,
  };
}

export async function createCustomer(infra: Infra, actor: Actor, input: CustomerInput) {
  assertCan(actor, "customer.write");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({ ...input, email: input.email?.toLowerCase(), tenantId: actor.tenantId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict("email_taken", "a client with this email exists");
    return mask(actor, row);
  });
}

export async function updateCustomer(infra: Infra, actor: Actor, id: string, patch: Partial<CustomerInput>) {
  assertCan(actor, "customer.write");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [row] = await tx.update(customers).set({ ...patch, email: patch.email?.toLowerCase(), updatedAt: new Date() }).where(eq(customers.id, id)).returning();
    if (!row) throw notFound("customer");
    return mask(actor, row);
  });
}

export async function searchCustomers(infra: Infra, actor: Actor, query: string, limit = 20) {
  assertCan(actor, "customer.read");
  const term = query.trim();
  if (term.length < 2) throw new AppError(400, "query_too_short", "type at least 2 characters");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        email: customers.email,
        phone: customers.phone,
        tierId: customers.tierId,
        pointsBalance: customers.pointsBalance,
        lifetimeSpend: customers.lifetimeSpend,
        lastPurchaseAt: customers.lastPurchaseAt,
      })
      .from(customers)
      .where(
        sql`(lower(${customers.email}) = lower(${term}) or ${customers.phone} = ${term}
          or to_tsvector('simple', ${customers.firstName} || ' ' || coalesce(${customers.lastName}, '') || ' ' || coalesce(${customers.email}, '')) @@ plainto_tsquery('simple', ${term}))`,
      )
      .orderBy(desc(customers.lifetimeSpend))
      .limit(limit);
    return rows.map((r) => mask(actor, r));
  });
}

/** Clienteling profile: details, the last purchases with their lines (2 queries total) and the points history. */
export async function customerProfile(infra: Infra, actor: Actor, id: string) {
  assertCan(actor, "customer.read");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
    if (!customer) throw notFound("customer");
    const recent = await tx
      .select({
        id: orders.id,
        receiptNo: orders.receiptNo,
        total: orders.total,
        createdAt: orders.createdAt,
        status: orders.status,
        lines: sql<{ name: string; sku: string; quantity: number; total: number }[]>`coalesce(json_agg(json_build_object('name', ${orderLines.name}, 'sku', ${orderLines.sku}, 'quantity', ${orderLines.quantity}, 'total', ${orderLines.total})) filter (where ${orderLines.id} is not null), '[]')`,
      })
      .from(orders)
      .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
      .where(eq(orders.customerId, id))
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt))
      .limit(20);
    const points = await tx.select().from(pointLedger).where(and(eq(pointLedger.customerId, id))).orderBy(desc(pointLedger.createdAt)).limit(20);
    return { customer: mask(actor, customer), recent, points };
  });
}
