import { eq, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { devices, posAuditEvents, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { assertCan, type Actor, type AppEnv } from "../lib/context";
import { AppError, notFound } from "../lib/errors";

type Trust = { status: "pending" | "approved" | "blocked"; storeId: string; seenAt: number };

/** Per-process verdict cache: every transaction is checked, the database is asked at most every 30 s per device. */
const cache = new Map<string, { at: number; value: Trust | null }>();
const TTL_MS = 30_000;
const forget = (tenantId: string, deviceId: string) => cache.delete(`${tenantId}:${deviceId}`);

/** Client address as the edge saw it. Forwarding headers are trusted only when proxies are configured. */
export function clientIp(headers: Headers, trustedHops: number): string | null {
  if (trustedHops > 0) {
    const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const candidate = chain[chain.length - trustedHops];
    if (candidate) return candidate;
  }
  return headers.get("x-real-ip");
}

async function loadTrust(infra: Infra, tenantId: string, deviceId: string): Promise<Trust | null> {
  const key = `${tenantId}:${deviceId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await withTenant(infra.db, tenantId, (tx) =>
    tx.select({ status: devices.status, storeId: devices.storeId, lastSeenAt: devices.lastSeenAt }).from(devices).where(eq(devices.id, deviceId)).limit(1),
  );
  const value = row ? { status: row.status, storeId: row.storeId, seenAt: row.lastSeenAt?.getTime() ?? 0 } : null;
  if (cache.size > 20_000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Guards every route that moves money or stock: the call must come from a device this
 * tenant registered and approved (`X-Device-Id`). Personal access tokens (MCP,
 * integrations) are not tills, so they pass only where `allowTokens` is set.
 * Records who used the device and from where, at most once a minute.
 */
export function requireApprovedDevice(infra: Infra, opts: { allowTokens?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actor = c.get("actor");
    if (actor.via === "token") {
      if (opts.allowTokens) return next();
      throw new AppError(403, "device_required", "this action can only be done from a registered till");
    }
    const deviceId = c.req.header("x-device-id");
    if (!deviceId || !/^[0-9a-f-]{36}$/i.test(deviceId)) throw new AppError(403, "device_required", "this action can only be done from a registered till");
    const trust = await loadTrust(infra, actor.tenantId, deviceId);
    if (!trust) throw new AppError(403, "device_unknown", "this device is not registered to the business");
    if (trust.status === "blocked") throw new AppError(403, "device_blocked", "this device has been blocked by a manager");
    if (trust.status !== "approved") throw new AppError(403, "device_pending", "a manager needs to approve this device before it can take sales");
    if (Date.now() - trust.seenAt > 60_000) {
      trust.seenAt = Date.now();
      const ip = clientIp(c.req.raw.headers, infra.env.TRUSTED_PROXY_HOPS);
      void withTenant(infra.db, actor.tenantId, (tx) => tx.update(devices).set({ lastSeenAt: new Date(), lastIp: ip, lastUserId: actor.userId }).where(eq(devices.id, deviceId))).catch(() => {});
    }
    return next();
  };
}

/** Approve, block or unblock a device. A block reaches every API instance within the cache window (30 s). */
export async function setDeviceStatus(infra: Infra, actor: Actor, deviceId: string, status: "approved" | "blocked", reason?: string) {
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [d] = await tx.select({ storeId: devices.storeId, status: devices.status }).from(devices).where(eq(devices.id, deviceId)).for("update");
    if (!d) throw notFound("device");
    assertCan(actor, "store.settings", d.storeId);
    const [row] = await tx
      .update(devices)
      .set(status === "approved" ? { status, approvedBy: actor.userId, approvedAt: new Date() } : { status })
      .where(eq(devices.id, deviceId))
      .returning({ id: devices.id, status: devices.status });
    const action = status === "blocked" ? "device.blocked" : d.status === "blocked" ? "device.unblocked" : "device.approved";
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, storeId: d.storeId, actorId: actor.userId, action, entity: "device", entityId: deviceId, data: { from: d.status, reason: reason ?? null } });
    forget(actor.tenantId, deviceId);
    return row;
  });
}

/** The till's own posture, so a pending till shows "waiting for approval" instead of failing at payment. */
export async function deviceStatus(infra: Infra, actor: Actor, deviceId: string) {
  const [row] = await withTenant(infra.db, actor.tenantId, (tx) =>
    tx
      .select({ id: devices.id, code: devices.code, name: devices.name, status: devices.status, storeId: devices.storeId, pendingInTenant: sql<number>`(select count(*)::int from devices where status = 'pending')` })
      .from(devices)
      .where(eq(devices.id, deviceId)),
  );
  if (!row) throw notFound("device");
  return row;
}
