import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { assignableRoles, PERMISSIONS, uuidv7, type Role } from "@luxury-pos/core";
import { brandThemeSchema, DEFAULT_THEME, type BrandTheme } from "@luxury-pos/theme";
import { hashPassword } from "@sahan-sac/auth-kit/password";
import { apiTokens, devices, memberships, posAuditEvents, stores, tenants, users, withSystem, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { allowed, assertCan, hashToken, invalidateMembership, TOKEN_PREFIX, type Actor } from "../lib/context";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";

/** Everything a device needs after sign-in, in one call: tenant, visible stores with resolved brand, own permissions. */
export async function bootstrap(infra: Infra, actor: Actor) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, theme: tenants.theme, loyalty: tenants.loyalty }).from(tenants).where(eq(tenants.id, actor.tenantId));
    const scope = actor.membership.storeIds;
    const storeRows = await tx.select().from(stores).where(scope ? inArray(stores.id, [...scope]) : undefined);
    return {
      tenant: { id: tenant!.id, name: tenant!.name, slug: tenant!.slug, loyalty: tenant!.loyalty },
      me: { userId: actor.userId, name: actor.name, email: actor.email, role: actor.membership.role },
      permissions: PERMISSIONS.filter((p) => allowed(actor, p)),
      stores: storeRows.map((s) => ({ ...s, theme: s.theme ?? tenant!.theme ?? DEFAULT_THEME })),
    };
  });
}

/** A store owner signs up: user, tenant, first store, OWNER membership and the first device — one transaction. */
export async function signUpTenant(
  infra: Infra,
  input: { email: string; name: string; password: string; tenantName: string; slug: string; storeName: string; currency: string; taxMode: "inclusive" | "exclusive"; timezone: string; theme?: BrandTheme },
) {
  const passwordHash = await hashPassword(input.password);
  return withSystem(infra.db, async (tx) => {
    const [exists] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (exists) throw conflict("slug_taken", "this store address is taken");
    const [user] = await tx
      .insert(users)
      .values({ id: uuidv7(), email: input.email.toLowerCase(), name: input.name, passwordHash, role: "STAFF" })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) throw conflict("email_taken", "an account with this email exists; sign in to add a business");
    const [tenant] = await tx.insert(tenants).values({ name: input.tenantName, slug: input.slug, theme: input.theme ?? DEFAULT_THEME }).returning();
    const [store] = await tx
      .insert(stores)
      .values({ tenantId: tenant!.id, code: "S01", name: input.storeName, currency: input.currency, taxMode: input.taxMode, timezone: input.timezone })
      .returning();
    await tx.insert(memberships).values({ tenantId: tenant!.id, userId: user.id, role: "OWNER" });
    const [device] = await tx.insert(devices).values({ id: uuidv7(), tenantId: tenant!.id, storeId: store!.id, code: "D01", name: "Main till", platform: "web" }).returning();
    return { tenantId: tenant!.id, storeId: store!.id, deviceId: device!.id, userId: user.id };
  });
}

export async function registerDevice(infra: Infra, actor: Actor, input: { id: string; storeId: string; name: string; platform: string }) {
  assertCan(actor, "store.settings", input.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(devices).where(eq(devices.storeId, input.storeId))) as [{ n: number }];
    const [row] = await tx
      .insert(devices)
      .values({ ...input, tenantId: actor.tenantId, code: `D${String(n + 1).padStart(2, "0")}` })
      .onConflictDoUpdate({ target: devices.id, set: { name: input.name, lastSeenAt: new Date() } })
      .returning();
    return row;
  });
}

/** Brand editor: tenant-wide by default, or a store-specific look. Validated and contrast-safe at resolve time. */
export async function setTheme(infra: Infra, actor: Actor, theme: BrandTheme, storeId?: string) {
  assertCan(actor, "store.branding", storeId);
  const parsed = brandThemeSchema.parse(theme);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    if (storeId) {
      const [s] = await tx.update(stores).set({ theme: parsed }).where(eq(stores.id, storeId)).returning({ id: stores.id });
      if (!s) throw notFound("store");
    } else await tx.update(tenants).set({ theme: parsed }).where(eq(tenants.id, actor.tenantId));
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId, actorId: actor.userId, action: "branding.updated", entity: storeId ? "store" : "tenant", entityId: storeId ?? actor.tenantId, data: { name: parsed.name } });
    return parsed;
  });
}

/** Adds a staff member. New people get a one-time password to change at first sign-in. */
export async function addStaff(infra: Infra, actor: Actor, input: { email: string; name: string; role: Role; storeIds: string[] | null }) {
  assertCan(actor, "staff.manage");
  if (!assignableRoles(actor.membership.role).includes(input.role)) throw forbidden();
  if (actor.membership.storeIds && (!input.storeIds || input.storeIds.some((s) => !actor.membership.storeIds!.includes(s)))) throw forbidden();
  const temporaryPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  return withSystem(infra.db, async (tx) => {
    const email = input.email.toLowerCase();
    const inserted = await tx.insert(users).values({ id: uuidv7(), email, name: input.name, passwordHash, role: "STAFF", mustChangePassword: true }).onConflictDoNothing().returning({ id: users.id });
    const [user] = inserted.length ? inserted : await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    const [m] = await tx
      .insert(memberships)
      .values({ tenantId: actor.tenantId, userId: user!.id, role: input.role, storeIds: input.storeIds })
      .onConflictDoNothing()
      .returning({ id: memberships.id });
    if (!m) throw conflict("already_member", "this person is already on the team");
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: "staff.added", entity: "membership", entityId: m.id, data: { role: input.role } });
    return { membershipId: m.id, userId: user!.id, temporaryPassword: inserted.length ? temporaryPassword : null };
  });
}

export async function updateStaff(infra: Infra, actor: Actor, membershipId: string, patch: { role?: Role; storeIds?: string[] | null; active?: boolean }) {
  assertCan(actor, "staff.manage");
  if (patch.role && !assignableRoles(actor.membership.role).includes(patch.role)) throw forbidden();
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [target] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!target) throw notFound("staff member");
    if (target.userId === actor.userId || !assignableRoles(actor.membership.role).includes(target.role as Role)) throw forbidden();
    const [row] = await tx.update(memberships).set(patch).where(eq(memberships.id, membershipId)).returning();
    invalidateMembership(actor.tenantId, target.userId);
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: "staff.updated", entity: "membership", entityId: membershipId, data: patch });
    return row;
  });
}

export async function setPin(infra: Infra, actor: Actor, pin: string) {
  if (!/^\d{4,8}$/.test(pin) || /^(\d)\1+$/.test(pin) || "0123456789".includes(pin)) throw new AppError(422, "weak_pin", "choose a PIN that is not a sequence or a repeated digit");
  const pinHash = await bcrypt.hash(pin, 10);
  await withTenant(infra.db, actor.tenantId, (tx) => tx.update(memberships).set({ pinHash }).where(eq(memberships.id, actor.membershipId)));
  return { ok: true };
}

/** Personal access token for the MCP server. Scopes are capped at what the creator can do; the secret is shown once. */
export async function createApiToken(infra: Infra, actor: Actor, input: { name: string; scopes: (typeof PERMISSIONS)[number][]; expiresInDays: number }) {
  assertCan(actor, "mcp.access");
  if (actor.via === "token") throw forbidden();
  const denied = input.scopes.filter((s) => !allowed(actor, s));
  if (denied.length) throw new AppError(403, "scope_exceeds_role", "a token cannot do more than you can", { denied });
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  const [row] = await withTenant(infra.db, actor.tenantId, (tx) =>
    tx.insert(apiTokens).values({ tenantId: actor.tenantId, userId: actor.userId, name: input.name, tokenHash: hashToken(token), scopes: input.scopes, expiresAt }).returning({ id: apiTokens.id }),
  );
  return { id: row!.id, token, expiresAt };
}

export async function revokeApiToken(infra: Infra, actor: Actor, id: string) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const own = allowed(actor, "staff.manage") ? undefined : eq(apiTokens.userId, actor.userId);
    const rows = await tx.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt), own)).returning({ id: apiTokens.id });
    if (!rows.length) throw notFound("token");
    return { ok: true };
  });
}
