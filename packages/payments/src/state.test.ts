import { describe, expect, it } from "vitest";
import { newIntent, PaymentStateError, transition, type PaymentEvent } from "./state";
import type { PaymentIntent, PaymentStatus } from "./types";

const base = newIntent(
  { idempotencyKey: "i-1", tenantId: "t", storeId: "s", amount: 10_000, currency: "lkr", method: "card_online", metadata: { a: "b" } },
  "stripe",
  1000,
);

const at = (status: PaymentStatus, extra: Partial<PaymentIntent> = {}): PaymentIntent => ({ ...base, status, ...extra });
const cap = (extra: Partial<PaymentIntent> = {}) => at("captured", { capturedAmount: 10_000, ...extra });

describe("newIntent", () => {
  it("builds a created intent with upper-case currency", () => {
    expect(base.status).toBe("created");
    expect(base.currency).toBe("LKR");
    expect(base.id).toBe("i-1");
    expect(base.capturedAmount).toBe(0);
  });
  it("rejects non-positive or fractional amounts", () => {
    for (const amount of [0, -5, 1.5]) {
      expect(() => newIntent({ ...{ idempotencyKey: "x", tenantId: "t", storeId: "s", currency: "USD", method: "cash" as const, metadata: {} }, amount }, "cash", 0)).toThrow(PaymentStateError);
    }
  });
});

describe("transition legal", () => {
  it("created -> authorized -> captured -> partially_refunded -> refunded", () => {
    const a = transition(base, { type: "authorize", providerRef: "pi_1" }, 2000);
    expect(a.status).toBe("authorized");
    expect(a.providerRef).toBe("pi_1");
    expect(a.updatedAt).toBe(2000);
    const c = transition(a, { type: "capture" }, 3000);
    expect(c.status).toBe("captured");
    expect(c.capturedAmount).toBe(10_000);
    const r1 = transition(c, { type: "refund", amount: 4000 });
    expect(r1.status).toBe("partially_refunded");
    expect(r1.refundedAmount).toBe(4000);
    const r2 = transition(r1, { type: "refund", amount: 6000 });
    expect(r2.status).toBe("refunded");
  });
  it("supports partial capture", () => {
    const c = transition(at("authorized"), { type: "capture", amount: 7000 });
    expect(c.capturedAmount).toBe(7000);
    const r = transition(c, { type: "refund", amount: 7000 });
    expect(r.status).toBe("refunded");
  });
  it("created -> requires_action -> authorized / captured", () => {
    const ra = transition(base, { type: "require_action" });
    expect(ra.status).toBe("requires_action");
    expect(transition(ra, { type: "authorize" }).status).toBe("authorized");
    expect(transition(ra, { type: "capture" }).status).toBe("captured");
  });
  it("direct capture from created (cash)", () => {
    expect(transition(base, { type: "capture" }).status).toBe("captured");
  });
  it.each(["created", "requires_action", "authorized"] as const)("void, fail and expire from %s", (s) => {
    expect(transition(at(s), { type: "void" }).status).toBe("voided");
    const f = transition(at(s), { type: "fail", code: "card_declined" });
    expect(f.status).toBe("failed");
    expect(f.failureCode).toBe("card_declined");
    expect(transition(at(s), { type: "expire" }).status).toBe("expired");
  });
  it("is pure", () => {
    const frozen = Object.freeze({ ...base, metadata: Object.freeze({ a: "b" }) }) as PaymentIntent;
    const out = transition(frozen, { type: "authorize" }, 5);
    expect(out).not.toBe(frozen);
    expect(frozen.status).toBe("created");
    expect(frozen.updatedAt).toBe(1000);
  });
});

describe("transition illegal", () => {
  const bad = (i: PaymentIntent, e: PaymentEvent) => expect(() => transition(i, e)).toThrow(PaymentStateError);

  it("refund before capture", () => {
    for (const s of ["created", "requires_action", "authorized", "voided", "failed", "expired"] as const) {
      bad(at(s), { type: "refund", amount: 1 });
    }
  });
  it("capture more than authorized, or non-positive", () => {
    bad(at("authorized"), { type: "capture", amount: 10_001 });
    bad(at("authorized"), { type: "capture", amount: 0 });
    bad(at("authorized"), { type: "capture", amount: 1.5 });
  });
  it("refund more than captured, cumulative, or non-positive", () => {
    bad(cap(), { type: "refund", amount: 10_001 });
    bad(cap({ status: "partially_refunded", refundedAmount: 9000 }), { type: "refund", amount: 1001 });
    bad(cap(), { type: "refund", amount: 0 });
    bad(cap(), { type: "refund", amount: -1 });
  });
  it("double capture and post-capture void/fail/expire", () => {
    bad(cap(), { type: "capture" });
    bad(cap(), { type: "void" });
    bad(cap(), { type: "fail", code: "x" });
    bad(cap(), { type: "expire" });
  });
  it("terminal states accept nothing", () => {
    for (const s of ["voided", "failed", "expired", "refunded"] as const) {
      const i = at(s, { capturedAmount: 10_000, refundedAmount: 10_000 });
      for (const e of [{ type: "authorize" }, { type: "require_action" }, { type: "capture" }, { type: "void" }, { type: "expire" }, { type: "fail", code: "x" }] as PaymentEvent[]) bad(i, e);
    }
  });
  it("authorize / require_action from wrong states", () => {
    bad(at("authorized"), { type: "authorize" });
    bad(at("authorized"), { type: "require_action" });
    bad(at("requires_action"), { type: "require_action" });
    bad(cap(), { type: "authorize" });
  });
  it("error carries state and event", () => {
    try {
      transition(base, { type: "refund", amount: 1 });
    } catch (e) {
      expect((e as PaymentStateError).from).toBe("created");
      expect((e as PaymentStateError).event).toBe("refund");
    }
  });
});
