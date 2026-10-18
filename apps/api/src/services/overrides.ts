import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { can, isRole, OVERRIDE_ACTIONS, type OverrideAction } from "@luxury-pos/core";
import { memberships, posAuditEvents, users, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import type { Actor } from "../lib/context";
import { AppError } from "../lib/errors";

interface OverrideClaims {
  /** action */ a: OverrideAction;
  /** approving manager user id */ m: string;
  /** tenant, store */ t: string;
  s: string;
  /** cashier the approval was given to */ u: string;
  /** expiry, epoch seconds */ e: number;
}

const TTL_SECONDS = 120;
const DUMMY_HASH = bcrypt.hashSync("not-a-pin", 10);
const b64 = (s: string) => Buffer.from(s).toString("base64url");

function sign(secret: string, claims: OverrideClaims): string {
  const body = b64(JSON.stringify(claims));
  const mac = createHmac("sha256", `${secret}:override`).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Verifies an approval token for exactly this action, cashier, tenant and store. Returns the approving manager id. */
export function verifyOverride(secret: string, token: string | undefined, expect: { action: OverrideAction; actor: Actor; storeId: string }): string | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", `${secret}:override`).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as OverrideClaims;
  if (claims.e < Date.now() / 1000) return null;
  if (claims.a !== expect.action || claims.t !== expect.actor.tenantId || claims.s !== expect.storeId || claims.u !== expect.actor.userId) return null;
  return claims.m;
}

/**
 * A manager types email + till PIN on the cashier's device. On success the
 * cashier gets a 2-minute token bound to one action, store and cashier.
 */
export async function requestOverride(
  infra: Infra,
  actor: Actor,
  input: { action: OverrideAction; managerEmail: string; pin: string; storeId: string; context?: string },
): Promise<{ token: string; approvedBy: string; expiresIn: number }> {
  const limited = await infra.limit("pin:user", `${actor.tenantId}:${input.managerEmail.toLowerCase()}`);
  if (!limited.ok) throw new AppError(429, "rate_limited", "too many PIN attempts");

  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [manager] = await tx
      .select({ userId: memberships.userId, role: memberships.role, storeIds: memberships.storeIds, pinHash: memberships.pinHash, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(sql`lower(${users.email})`, input.managerEmail.toLowerCase()), eq(memberships.active, true)))
      .limit(1);
    // Compare against a dummy hash when there is no manager so timing never reveals which emails exist.
    const matched = await bcrypt.compare(input.pin, manager?.pinHash ?? DUMMY_HASH);
    const valid = matched && !!manager?.pinHash;
    const permitted =
      valid && manager && isRole(manager.role) && manager.userId !== actor.userId
        ? can({ tenantId: actor.tenantId, role: manager.role, storeIds: manager.storeIds }, OVERRIDE_ACTIONS[input.action], { storeId: input.storeId })
        : false;

    await tx.insert(posAuditEvents).values({
      tenantId: actor.tenantId,
      storeId: input.storeId,
      actorId: actor.userId,
      action: permitted ? "override.granted" : "override.denied",
      entity: "override",
      entityId: input.action,
      data: { manager: manager?.userId ?? null, context: input.context ?? null },
    });
    if (!permitted || !manager) throw new AppError(403, "override_denied", "approval refused");

    const token = sign(infra.env.AUTH_SECRET, { a: input.action, m: manager.userId, t: actor.tenantId, s: input.storeId, u: actor.userId, e: Math.floor(Date.now() / 1000) + TTL_SECONDS });
    return { token, approvedBy: manager.name ?? manager.userId, expiresIn: TTL_SECONDS };
  });
}
