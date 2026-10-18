import type { Feature, Limit, LimitValue, Plan } from "./catalog";
import { FEATURES, LIMITS } from "./catalog";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "grace" | "canceled" | "suspended";
export type FeatureSource = "plan" | "addon" | "payg" | "override";

export interface AddOn { feature?: Feature; limit?: Limit; amount?: number }

export interface Payg {
  enabled: boolean;
  /** When set, PAYG features apply only to these stores. */
  storeIds?: string[];
  features: Feature[];
  meters: Record<string, { unitPriceMinor: number }>;
}

export interface Subscription {
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt?: string;
  currentPeriodEnd: string;
  graceDays: number;
  addOns: AddOn[];
  payg?: Payg;
  overrides?: { features?: Partial<Record<Feature, boolean>>; limits?: Partial<Record<Limit, LimitValue>> };
}

/** Features that stay available when suspended: owners can always read and export their data. */
export const READ_ONLY_FEATURES: readonly Feature[] = ["reports.advanced", "audit.export"];

const DAY_MS = 86_400_000;

/**
 * Time-derived status. Stored `canceled`/`suspended` are terminal.
 * A lapse (trial end, period end, or stored past_due) is past_due, which is served as `grace` for graceDays, then `suspended`.
 * An active sub past currentPeriodEnd lapses the same way.
 */
export function effectiveStatus(sub: Subscription, now: Date): SubscriptionStatus {
  if (sub.status === "canceled" || sub.status === "suspended") return sub.status;
  let lapsedAt: number | null = null;
  if (sub.status === "trialing") {
    const end = Date.parse(sub.trialEndsAt ?? sub.currentPeriodEnd);
    if (now.getTime() < end) return "trialing";
    lapsedAt = end;
  } else if (sub.status === "active") {
    const end = Date.parse(sub.currentPeriodEnd);
    if (now.getTime() < end) return "active";
    lapsedAt = end;
  } else {
    lapsedAt = Date.parse(sub.currentPeriodEnd);
  }
  const graceEnd = lapsedAt + sub.graceDays * DAY_MS;
  if (now.getTime() >= graceEnd) return "suspended";
  return "grace";
}

export interface Entitlements {
  status: SubscriptionStatus;
  features: Set<Feature>;
  limits: Record<Limit, LimitValue>;
  source: Partial<Record<Feature, FeatureSource>>;
}

export interface ResolveOptions { now: Date; storeId?: string }

function addLimit(a: LimitValue, b: number): LimitValue {
  return a === "unlimited" ? a : a + b;
}

/**
 * Precedence per feature: override > addon > payg (listed stores only when storeIds set) > plan.
 * Override false removes a feature. Suspended/canceled: only READ_ONLY_FEATURES remain.
 * Limits: override replaces; otherwise plan limit plus add-on amounts. Missing plan limit = 0.
 */
export function resolveEntitlements(sub: Subscription, plans: readonly Plan[], opts: ResolveOptions): Entitlements {
  const status = effectiveStatus(sub, opts.now);
  const plan = plans.find((p) => p.id === sub.planId);
  const features = new Set<Feature>();
  const source: Partial<Record<Feature, FeatureSource>> = {};
  const set = (f: Feature, s: FeatureSource) => { features.add(f); source[f] = s; };

  const limits = {} as Record<Limit, LimitValue>;
  for (const l of LIMITS) limits[l] = plan?.limits[l] ?? 0;

  if (status === "suspended" || status === "canceled") {
    for (const f of READ_ONLY_FEATURES) set(f, "plan");
    return { status, features, limits, source };
  }

  for (const f of plan?.features ?? []) set(f, "plan");
  const payg = sub.payg;
  if (payg?.enabled && (!payg.storeIds || (opts.storeId !== undefined && payg.storeIds.includes(opts.storeId)))) {
    for (const f of payg.features) set(f, "payg");
  }
  for (const a of sub.addOns) {
    if (a.feature) set(a.feature, "addon");
    if (a.limit && typeof a.amount === "number") limits[a.limit] = addLimit(limits[a.limit], a.amount);
  }
  const ov = sub.overrides;
  if (ov?.features) {
    for (const f of FEATURES) {
      const v = ov.features[f];
      if (v === true) set(f, "override");
      else if (v === false) { features.delete(f); delete source[f]; }
    }
  }
  if (ov?.limits) {
    for (const l of LIMITS) {
      const v = ov.limits[l];
      if (v !== undefined) limits[l] = v;
    }
  }
  return { status, features, limits, source };
}

export function can(ent: Entitlements, feature: Feature): boolean {
  return ent.features.has(feature);
}

export interface LimitCheck { ok: boolean; remaining: number | "unlimited"; limit: LimitValue }

/** ok when currentUsage is strictly below the limit (i.e. one more unit fits). */
export function withinLimit(ent: Entitlements, limit: Limit, currentUsage: number): LimitCheck {
  const cap = ent.limits[limit];
  if (cap === "unlimited") return { ok: true, remaining: "unlimited", limit: cap };
  const remaining = Math.max(0, cap - currentUsage);
  return { ok: currentUsage < cap, remaining, limit: cap };
}

export type EntitlementErrorCode = "feature_not_in_plan" | "limit_reached" | "subscription_suspended";

export class EntitlementError extends Error {
  constructor(readonly code: EntitlementErrorCode, message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

/** Throws unless the feature is available; a suspended tenant gets `subscription_suspended` rather than a plan error. */
export function assertCan(ent: Entitlements, feature: Feature): void {
  if (can(ent, feature)) return;
  if (ent.status === "suspended" || ent.status === "canceled") {
    throw new EntitlementError("subscription_suspended", `Subscription ${ent.status}; ${feature} unavailable`);
  }
  throw new EntitlementError("feature_not_in_plan", `Feature ${feature} not in plan`);
}

export function assertWithinLimit(ent: Entitlements, limit: Limit, currentUsage: number): void {
  if (!withinLimit(ent, limit, currentUsage).ok) {
    throw new EntitlementError("limit_reached", `Limit ${limit} reached`);
  }
}
