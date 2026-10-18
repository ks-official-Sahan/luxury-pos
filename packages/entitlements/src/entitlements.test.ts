import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANS, EntitlementError, READ_ONLY_FEATURES, aggregateUsage, assertCan, assertWithinLimit, can,
  effectiveStatus, paygCharges, prorate, resolveEntitlements, withinLimit,
} from "./index";
import type { Subscription } from "./index";

const d = (s: string) => new Date(s);
const base: Subscription = {
  tenantId: "t1", planId: "starter", status: "active", currentPeriodEnd: "2026-02-01T00:00:00Z", graceDays: 7, addOns: [],
};
const plan = (id: string) => DEFAULT_PLANS.find((p) => p.id === id)!;

describe("status transitions", () => {
  const trial: Subscription = { ...base, planId: "trial", status: "trialing", trialEndsAt: "2026-01-15T00:00:00Z" };
  it("trial then expiry then grace then suspended", () => {
    expect(effectiveStatus(trial, d("2026-01-10T00:00:00Z"))).toBe("trialing");
    expect(effectiveStatus(trial, d("2026-01-15T00:00:00Z"))).toBe("grace");
    expect(effectiveStatus(trial, d("2026-01-21T23:59:59Z"))).toBe("grace");
    expect(effectiveStatus(trial, d("2026-01-22T00:00:00Z"))).toBe("suspended");
  });
  it("active lapses and past_due uses grace", () => {
    expect(effectiveStatus(base, d("2026-01-31T00:00:00Z"))).toBe("active");
    expect(effectiveStatus(base, d("2026-02-02T00:00:00Z"))).toBe("grace");
    expect(effectiveStatus({ ...base, status: "past_due" }, d("2026-02-10T00:00:00Z"))).toBe("suspended");
    expect(effectiveStatus({ ...base, status: "canceled" }, d("2026-01-01T00:00:00Z"))).toBe("canceled");
  });
});

describe("precedence", () => {
  const now = d("2026-01-10T00:00:00Z");
  it("plan baseline", () => {
    const e = resolveEntitlements(base, DEFAULT_PLANS, { now });
    expect(can(e, "pos.core")).toBe(true);
    expect(can(e, "sso")).toBe(false);
    expect(e.source["pos.core"]).toBe("plan");
  });
  it("addon beats plan, override beats all", () => {
    const sub: Subscription = {
      ...base, addOns: [{ feature: "sso" }, { feature: "pos.core" }],
      payg: { enabled: true, features: ["ai.insights"], meters: {} },
      overrides: { features: { "pos.core": false, "ai.insights": true, sso: false } },
    };
    const e = resolveEntitlements(sub, DEFAULT_PLANS, { now });
    expect(can(e, "pos.core")).toBe(false);
    expect(can(e, "sso")).toBe(false);
    expect(e.source["ai.insights"]).toBe("override");
    const e2 = resolveEntitlements({ ...sub, overrides: undefined }, DEFAULT_PLANS, { now });
    expect(e2.source["pos.core"]).toBe("addon");
    expect(e2.source["ai.insights"]).toBe("payg");
  });
  it("payg only for selected stores", () => {
    const sub: Subscription = { ...base, payg: { enabled: true, storeIds: ["s1"], features: ["ai.insights"], meters: {} } };
    expect(can(resolveEntitlements(sub, DEFAULT_PLANS, { now, storeId: "s1" }), "ai.insights")).toBe(true);
    expect(can(resolveEntitlements(sub, DEFAULT_PLANS, { now, storeId: "s2" }), "ai.insights")).toBe(false);
    expect(can(resolveEntitlements(sub, DEFAULT_PLANS, { now }), "ai.insights")).toBe(false);
    const all = { ...sub, payg: { ...sub.payg!, storeIds: undefined } };
    expect(can(resolveEntitlements(all, DEFAULT_PLANS, { now }), "ai.insights")).toBe(true);
  });
  it("disabled payg grants nothing", () => {
    const sub: Subscription = { ...base, payg: { enabled: false, features: ["ai.insights"], meters: {} } };
    expect(can(resolveEntitlements(sub, DEFAULT_PLANS, { now }), "ai.insights")).toBe(false);
  });
});

describe("suspension", () => {
  it("keeps only read-only features", () => {
    const sub: Subscription = { ...base, planId: "enterprise", addOns: [{ feature: "sso" }] };
    const e = resolveEntitlements(sub, DEFAULT_PLANS, { now: d("2026-03-01T00:00:00Z") });
    expect(e.status).toBe("suspended");
    expect([...e.features].sort()).toEqual([...READ_ONLY_FEATURES].sort());
    expect(can(e, "audit.export")).toBe(true);
    expect(() => assertCan(e, "pos.core")).toThrowError(EntitlementError);
    try { assertCan(e, "pos.core"); } catch (x) { expect((x as EntitlementError).code).toBe("subscription_suspended"); }
  });
  it("feature_not_in_plan code", () => {
    const e = resolveEntitlements(base, DEFAULT_PLANS, { now: d("2026-01-10T00:00:00Z") });
    try { assertCan(e, "sso"); expect.unreachable(); } catch (x) { expect((x as EntitlementError).code).toBe("feature_not_in_plan"); }
  });
});

describe("limits", () => {
  const now = d("2026-01-10T00:00:00Z");
  it("numeric, addon and unlimited", () => {
    const e = resolveEntitlements({ ...base, addOns: [{ limit: "staff", amount: 3 }] }, DEFAULT_PLANS, { now });
    expect(e.limits.staff).toBe(8);
    expect(withinLimit(e, "staff", 7)).toEqual({ ok: true, remaining: 1, limit: 8 });
    expect(withinLimit(e, "staff", 8).ok).toBe(false);
    expect(() => assertWithinLimit(e, "staff", 8)).toThrowError(/staff/);
    const u = resolveEntitlements({ ...base, planId: "enterprise" }, DEFAULT_PLANS, { now });
    expect(withinLimit(u, "stores", 10_000)).toEqual({ ok: true, remaining: "unlimited", limit: "unlimited" });
  });
  it("override limit replaces", () => {
    const e = resolveEntitlements({ ...base, overrides: { limits: { staff: "unlimited" } } }, DEFAULT_PLANS, { now });
    expect(e.limits.staff).toBe("unlimited");
  });
});

describe("metering", () => {
  const events = [
    { tenantId: "t1", meter: "sms", quantity: 10, at: "2026-01-05T00:00:00Z" },
    { tenantId: "t1", meter: "sms", quantity: 5, at: "2026-01-20T00:00:00Z" },
    { tenantId: "t1", meter: "ai", quantity: 3, at: "2026-01-31T23:59:59Z" },
    { tenantId: "t1", meter: "sms", quantity: 99, at: "2026-02-01T00:00:00Z" },
  ];
  it("aggregates half open and charges", () => {
    const u = aggregateUsage(events, d("2026-01-01T00:00:00Z"), d("2026-02-01T00:00:00Z"));
    expect(u).toEqual({ sms: 15, ai: 3 });
    const sub: Subscription = { ...base, payg: { enabled: true, features: [], meters: { sms: { unitPriceMinor: 7 }, ai: { unitPriceMinor: 100 } } } };
    expect(paygCharges(sub, u)).toEqual([
      { meter: "ai", quantity: 3, unitPriceMinor: 100, amountMinor: 300 },
      { meter: "sms", quantity: 15, unitPriceMinor: 7, amountMinor: 105 },
    ]);
    expect(paygCharges(base, u)).toEqual([]);
  });
});

describe("proration", () => {
  const start = d("2026-01-01T00:00:00Z");
  const end = d("2026-01-31T00:00:00Z");
  it("upgrade mid period", () => {
    const p = prorate(plan("starter"), plan("growth"), start, end, d("2026-01-16T00:00:00Z"));
    expect(p.daysInPeriod).toBe(30);
    expect(p.daysRemaining).toBe(15);
    expect(p.creditMinor).toBe(1450);
    expect(p.chargeMinor).toBe(4950);
    expect(p.netMinor).toBe(3500);
  });
  it("downgrade gives negative net; change at end is zero", () => {
    const p = prorate(plan("growth"), plan("starter"), start, end, d("2026-01-16T00:00:00Z"));
    expect(p.netMinor).toBe(1450 - 4950);
    const z = prorate(plan("growth"), plan("starter"), start, end, end);
    expect(z).toMatchObject({ creditMinor: 0, chargeMinor: 0, netMinor: 0 });
  });
});
