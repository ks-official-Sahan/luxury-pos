import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { can, isPermission, isRole, type Membership, type Permission, type PermissionMatrix, type Role } from "@luxury-pos/core";
import { apiTokens, memberships, tenantRolePermissions, users, withSystem, withTenant, type Db } from "@luxury-pos/db";
import type { Auth } from "../auth";
import type { Infra } from "../infra";
import { AppError, forbidden } from "./errors";

export interface Actor {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  membershipId: string;
  membership: Membership;
  matrix: PermissionMatrix;
  /** Set for API-token (MCP/integration) calls: the token can never exceed these. */
  scopes: ReadonlySet<Permission> | null;
  via: "session" | "token";
}

export type AppEnv = { Variables: { actor: Actor } };

export const TOKEN_PREFIX = "lpos_";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Short-lived per-process cache: membership + tenant matrix are read on every request. */
const cache = new Map<string, { at: number; value: Omit<Actor, "via" | "scopes" | "email" | "name"> | null }>();
const TTL_MS = 30_000;
export const invalidateMembership = (tenantId: string, userId: string) => cache.delete(`${tenantId}:${userId}`);

async function loadMembership(db: Db, tenantId: string, userId: string) {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await withTenant(db, tenantId, async (tx) => {
    // One round trip: membership plus this tenant's matrix edits for that role.
    const [m] = await tx
      .select({ id: memberships.id, role: memberships.role, storeIds: memberships.storeIds })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
      .limit(1);
    if (!m || !isRole(m.role)) return null;
    const grants = await tx.select({ permission: tenantRolePermissions.permission }).from(tenantRolePermissions).where(eq(tenantRolePermissions.role, m.role));
    const matrix: PermissionMatrix = grants.length ? { [m.role as Role]: new Set(grants.map((g) => g.permission).filter(isPermission)) } : {};
    return { userId, tenantId, membershipId: m.id, membership: { tenantId, role: m.role as Role, storeIds: m.storeIds }, matrix };
  });
  if (cache.size > 10_000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves who is calling and in which tenant:
 * - `Authorization: Bearer lpos_...` — a personal access token (MCP, integrations), tenant fixed by the token;
 * - otherwise the auth-kit session cookie plus `X-Tenant-Id`.
 * Answers 401 when neither is valid, 403 when the user has no membership in the tenant.
 */
export function authenticate(infra: Infra, auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (header?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
      const token = header.slice(7);
      const limited = await infra.limit("api:token", hashToken(token).slice(0, 16));
      if (!limited.ok) throw new AppError(429, "rate_limited", "too many requests");
      const row = await withSystem(infra.db, async (tx) => {
        const [r] = await tx
          .select({ id: apiTokens.id, tenantId: apiTokens.tenantId, userId: apiTokens.userId, scopes: apiTokens.scopes, email: users.email, name: users.name })
          .from(apiTokens)
          .innerJoin(users, eq(users.id, apiTokens.userId))
          .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt), gt(apiTokens.expiresAt, sql`now()`), isNull(users.disabledAt)))
          .limit(1);
        if (r) await tx.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, r.id));
        return r;
      });
      if (!row) throw new AppError(401, "unauthenticated", "invalid or expired token");
      const m = await loadMembership(infra.db, row.tenantId, row.userId);
      if (!m) throw forbidden();
      c.set("actor", { ...m, email: row.email, name: row.name, via: "token", scopes: new Set(row.scopes.filter(isPermission)) });
      return next();
    }

    const session = await auth.readSession(c.req.raw.headers);
    if (!session) throw new AppError(401, "unauthenticated", "sign in required");
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId || !UUID.test(tenantId)) throw new AppError(400, "tenant_required", "X-Tenant-Id header required");
    const m = await loadMembership(infra.db, tenantId, session.userId);
    if (!m) throw forbidden();
    c.set("actor", { ...m, email: session.email, name: session.name, via: "session", scopes: null });
    return next();
  };
}

export function allowed(actor: Actor, permission: Permission, storeId?: string): boolean {
  if (actor.scopes && !actor.scopes.has(permission)) return false;
  return can(actor.membership, permission, { storeId, matrix: actor.matrix });
}

export function assertCan(actor: Actor, permission: Permission, storeId?: string): void {
  if (!allowed(actor, permission, storeId)) throw forbidden(permission);
}

export const requirePermission =
  (permission: Permission): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    assertCan(c.get("actor"), permission, c.req.query("storeId") ?? c.req.param("storeId"));
    return next();
  };
