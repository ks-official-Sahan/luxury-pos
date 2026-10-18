import type { AuditDraft } from "./chain";

export interface GlassBreakGrant {
  id: string;
  userId: string;
  reason: string;
  scopes: string[];
  grantedAt: string;
  expiresAt: string;
  approvedBy?: string;
}

export const GLASS_BREAK_MIN_REASON = 15;
export const GLASS_BREAK_MAX_MS = 4 * 3_600_000;

export interface GlassBreakRequest {
  id: string;
  userId: string;
  tenantId?: string;
  reason: string;
  scopes: string[];
  now: Date;
  durationMs: number;
  approvedBy?: string;
}

/** Emergency access: reason >= 15 chars, at least one scope, 0 < duration <= 4h. Approver must differ from requester. */
export function requestGlassBreak(r: GlassBreakRequest): GlassBreakGrant {
  const reason = r.reason.trim();
  if (reason.length < GLASS_BREAK_MIN_REASON) throw new Error(`glass break reason must be at least ${GLASS_BREAK_MIN_REASON} characters`);
  if (r.scopes.length === 0) throw new Error("glass break requires at least one scope");
  if (!(r.durationMs > 0) || r.durationMs > GLASS_BREAK_MAX_MS) throw new Error("glass break duration out of range");
  if (r.approvedBy !== undefined && r.approvedBy === r.userId) throw new Error("glass break cannot be self approved");
  const grant: GlassBreakGrant = {
    id: r.id, userId: r.userId, reason, scopes: [...r.scopes],
    grantedAt: r.now.toISOString(), expiresAt: new Date(r.now.getTime() + r.durationMs).toISOString(),
  };
  if (r.approvedBy !== undefined) grant.approvedBy = r.approvedBy;
  return grant;
}

/** Active when grantedAt <= now < expiresAt and scope is granted ("*" grants all). */
export function isGlassBreakActive(grant: GlassBreakGrant, now: Date, scope: string): boolean {
  const t = now.getTime();
  return t >= Date.parse(grant.grantedAt) && t < Date.parse(grant.expiresAt) &&
    (grant.scopes.includes("*") || grant.scopes.includes(scope));
}

/** Every use of a grant must append this entry. Pass to appendEntry. */
export function glassBreakAuditDraft(
  grant: GlassBreakGrant,
  use: { tenantId: string; action: string; entity?: string; entityId?: string; at: Date; deviceId?: string; ip?: string },
): AuditDraft {
  const d: AuditDraft = {
    tenantId: use.tenantId,
    at: use.at.toISOString(),
    actor: { userId: grant.userId, ...(use.deviceId ? { deviceId: use.deviceId } : {}), ...(use.ip ? { ip: use.ip } : {}) },
    action: `glass_break:${use.action}`,
    entity: use.entity ?? "glass_break_grant",
    entityId: use.entityId ?? grant.id,
    reason: grant.reason,
    after: { grantId: grant.id, scopes: grant.scopes, expiresAt: grant.expiresAt, approvedBy: grant.approvedBy ?? null },
  };
  return d;
}
