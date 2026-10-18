import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { assignableRoles, DEFAULT_MATRIX, PERMISSIONS, ROLES, type Permission, type Role } from "@luxury-pos/core";
import { apiTokens, customers, devices, memberships, orderLines, orders, payments, posAuditEvents, refunds, stores, tenantRolePermissions, tenants, users, withSystem, withTenant } from "@luxury-pos/db";
import { DEFAULT_THEME } from "@luxury-pos/theme";
import type { Infra } from "../infra";
import { allowed, assertCan, invalidateTenant, type Actor } from "../lib/context";
import { AppError, forbidden, notFound } from "../lib/errors";

/**
 * Read models for the back office. Every list is one or two index-backed queries
 * with keyset pagination (`created_at, id`), so page 500 costs the same as page 1.
 */

type Cursor = { at: Date; id: string };
const encodeCursor = (at: Date, id: string | number) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor?: string): Cursor | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  if (!id || Number.isNaN(date.getTime())) throw new AppError(400, "bad_cursor", "invalid cursor");
  return { at: date, id };
}

const scopeStores = (actor: Actor, storeId?: string) => (storeId ? [storeId] : actor.membership.storeIds ? [...actor.membership.storeIds] : null);

export async function listOrders(infra: Infra, actor: Actor, q: { storeId?: string; cursor?: string; limit: number; status?: string; q?: string }) {
  assertCan(actor, "reports.read", q.storeId);
  const scope = scopeStores(actor, q.storeId);
  const after = decodeCursor(q.cursor);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const where: (SQL | undefined)[] = [
      scope ? inArray(orders.storeId, scope) : undefined,
      q.status ? eq(orders.status, q.status as "completed") : undefined,
      q.q ? sql`${orders.receiptNo} ilike ${`%${q.q.replace(/[%_\\]/g, "\\$&")}%`}` : undefined,
      after ? or(lt(orders.createdAt, after.at), and(eq(orders.createdAt, after.at), lt(orders.id, after.id))) : undefined,
    ];
    const rows = await tx
      .select({
        id: orders.id,
        receiptNo: orders.receiptNo,
        createdAt: orders.createdAt,
        status: orders.status,
        total: orders.total,
        refundedTotal: orders.refundedTotal,
        currency: orders.currency,
        storeId: orders.storeId,
        store: stores.name,
        staff: users.name,
        customer: sql<string | null>`trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))`,
        items: sql<number>`(select coalesce(sum(${orderLines.quantity}), 0)::int from ${orderLines} where ${orderLines.orderId} = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId))
      .leftJoin(users, eq(users.id, orders.staffId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...where))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null };
  });
}

/** One order with lines, tenders and refunds: four indexed lookups, no per-line queries. */
export async function orderDetail(infra: Infra, actor: Actor, id: string) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [order] = await tx
      .select({ order: orders, store: stores.name, staff: users.name, customer: sql<string | null>`trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))` })
      .from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId))
      .leftJoin(users, eq(users.id, orders.staffId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, id));
    if (!order) throw notFound("order");
    if (!allowed(actor, "reports.read", order.order.storeId) && order.order.staffId !== actor.userId) throw notFound("order");
    const [lines, tenders, refundRows] = await Promise.all([
      tx.select().from(orderLines).where(eq(orderLines.orderId, id)),
      tx.select({ method: payments.method, amount: payments.amount, reference: payments.reference, refundId: payments.refundId, createdAt: payments.createdAt }).from(payments).where(eq(payments.orderId, id)),
      tx.select().from(refunds).where(eq(refunds.orderId, id)),
    ]);
    return { ...order.order, store: order.store, staff: order.staff, customer: order.customer, lines, payments: tenders, refunds: refundRows };
  });
}

export async function listStaff(infra: Infra, actor: Actor) {
  assertCan(actor, "staff.manage");
  return withTenant(infra.db, actor.tenantId, (tx) =>
    tx
      .select({ id: memberships.id, userId: memberships.userId, role: memberships.role, storeIds: memberships.storeIds, active: memberships.active, hasPin: sql<boolean>`${memberships.pinHash} is not null`, createdAt: memberships.createdAt, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(memberships.role, users.name),
  );
}

export async function listDevices(infra: Infra, actor: Actor) {
  assertCan(actor, "store.settings");
  return withTenant(infra.db, actor.tenantId, (tx) =>
    tx
      .select({ id: devices.id, code: devices.code, name: devices.name, platform: devices.platform, storeId: devices.storeId, store: stores.name, lastSeenAt: devices.lastSeenAt, receiptSeq: devices.receiptSeq, status: devices.status, lastIp: devices.lastIp, lastUser: users.name })
      .from(devices)
      .innerJoin(stores, eq(stores.id, devices.storeId))
      .leftJoin(users, eq(users.id, devices.lastUserId))
      // Devices waiting for approval first: they are the ones that need someone.
      .orderBy(sql`${devices.status} = 'pending' desc`, stores.name, devices.code),
  );
}

/** Own tokens, or everyone's for people who manage staff. Never returns the secret (only its hash is stored). */
export async function listTokens(infra: Infra, actor: Actor) {
  return withTenant(infra.db, actor.tenantId, (tx) =>
    tx
      .select({ id: apiTokens.id, name: apiTokens.name, scopes: apiTokens.scopes, expiresAt: apiTokens.expiresAt, lastUsedAt: apiTokens.lastUsedAt, createdAt: apiTokens.createdAt, owner: users.name })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(isNull(apiTokens.revokedAt), allowed(actor, "staff.manage") ? undefined : eq(apiTokens.userId, actor.userId)))
      .orderBy(desc(apiTokens.createdAt)),
  );
}

export async function listAudit(infra: Infra, actor: Actor, q: { cursor?: string; limit: number; action?: string }) {
  assertCan(actor, "staff.manage");
  const after = decodeCursor(q.cursor);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: posAuditEvents.id, action: posAuditEvents.action, entity: posAuditEvents.entity, entityId: posAuditEvents.entityId, data: posAuditEvents.data, createdAt: posAuditEvents.createdAt, storeId: posAuditEvents.storeId, actor: users.name })
      .from(posAuditEvents)
      .leftJoin(users, eq(users.id, posAuditEvents.actorId))
      .where(
        and(
          q.action ? sql`${posAuditEvents.action} like ${`${q.action.replace(/[%_\\]/g, "\\$&")}%`}` : undefined,
          after ? or(lt(posAuditEvents.createdAt, after.at), and(eq(posAuditEvents.createdAt, after.at), lt(posAuditEvents.id, Number(after.id)))) : undefined,
        ),
      )
      .orderBy(desc(posAuditEvents.createdAt), desc(posAuditEvents.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null };
  });
}

/** Effective permission matrix: defaults, replaced per role where the tenant has edited it. */
export async function roleMatrix(infra: Infra, actor: Actor) {
  assertCan(actor, "staff.manage");
  const rows = await withTenant(infra.db, actor.tenantId, (tx) => tx.select({ role: tenantRolePermissions.role, permission: tenantRolePermissions.permission }).from(tenantRolePermissions));
  const edited = new Map<string, Permission[]>();
  for (const r of rows) edited.set(r.role, [...(edited.get(r.role) ?? []), r.permission as Permission]);
  const editable = new Set(assignableRoles(actor.membership.role));
  return {
    permissions: PERMISSIONS,
    roles: ROLES.map((role) => ({ role, customized: edited.has(role), editable: editable.has(role) && role !== "OWNER", permissions: edited.get(role) ?? [...DEFAULT_MATRIX[role]] })),
  };
}

/**
 * Replaces one role's permissions. Guards against privilege escalation: you can
 * only edit roles below your own, and only grant permissions you hold yourself.
 * `reset` restores the defaults.
 */
export async function setRolePermissions(infra: Infra, actor: Actor, role: Role, input: { permissions: Permission[] } | { reset: true }) {
  assertCan(actor, "staff.manage");
  if (role === "OWNER" || !assignableRoles(actor.membership.role).includes(role)) throw forbidden();
  const wanted = "reset" in input ? null : [...new Set(input.permissions)];
  if (wanted?.some((p) => !allowed(actor, p))) throw new AppError(403, "grant_exceeds_role", "you can only grant permissions you hold");
  await withTenant(infra.db, actor.tenantId, async (tx) => {
    await tx.delete(tenantRolePermissions).where(eq(tenantRolePermissions.role, role));
    if (wanted?.length) await tx.insert(tenantRolePermissions).values(wanted.map((permission) => ({ tenantId: actor.tenantId, role, permission })));
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: "roles.updated", entity: "role", entityId: role, data: { permissions: wanted ?? "default" } });
  });
  invalidateTenant(actor.tenantId);
  return roleMatrix(infra, actor);
}

/**
 * Public, unauthenticated: the store's look for the sign-in screen and customer
 * displays. Only the theme and display name leave the server; cacheable at the edge.
 */
export async function publicBrand(infra: Infra, slug: string) {
  const [row] = await withSystem(infra.db, (tx) => tx.select({ name: tenants.name, theme: tenants.theme }).from(tenants).where(eq(tenants.slug, slug)).limit(1));
  if (!row) throw notFound("store");
  return { name: row.name, theme: row.theme ?? DEFAULT_THEME };
}
