import { describe, expect, it } from "vitest";
import { createCashAdapter } from "./adapters/cash";
import { createManualTerminalAdapter } from "./adapters/manual-terminal";
import { newIntent, transition } from "./state";
import type { CreateInput } from "./types";

const input = (over: Partial<CreateInput> = {}): CreateInput => ({
  idempotencyKey: "k-1", tenantId: "t", storeId: "s", amount: 5000, currency: "LKR", method: "cash", metadata: {}, ...over,
});

describe("cash", () => {
  const cash = createCashAdapter({ currencies: ["lkr"] });
  it("captures immediately and drives the state machine", async () => {
    const r = await cash.create(input());
    expect(r.status).toBe("captured");
    expect(r.providerRef).toBe("cash:k-1");
    const i = transition(newIntent(input(), "cash", 0), { type: "capture", providerRef: r.providerRef });
    expect(i.status).toBe("captured");
    const refund = await cash.refund(r.providerRef ?? "", 1000, "rk-1");
    expect(refund.status).toBe("succeeded");
  });
  it("currency filter", () => {
    expect(cash.supportsCurrency("LKR")).toBe(true);
    expect(cash.supportsCurrency("USD")).toBe(false);
    expect(createCashAdapter().supportsCurrency("USD")).toBe(true);
  });
});

describe("manual terminal", () => {
  const t = createManualTerminalAdapter({ id: "term" });
  it("requires an approval code", async () => {
    expect(await t.create(input({ method: "card_present" }))).toEqual({ status: "failed", failureCode: "missing_approval_code" });
    expect((await t.create(input({ method: "card_present", metadata: { approvalCode: "ab" } }))).failureCode).toBe("missing_approval_code");
  });
  it("captures and stores last4/brand", async () => {
    const r = await t.create(input({ method: "card_present", metadata: { approvalCode: " ab12cd ", last4: "4242", brand: "VISA" } }));
    expect(r).toEqual({ status: "captured", providerRef: "term:AB12CD", metadata: { approvalCode: "AB12CD", last4: "4242", brand: "visa" } });
  });
  it("rejects malformed last4 (guards against full PAN entry)", async () => {
    const r = await t.create(input({ method: "card_present", metadata: { approvalCode: "AB12CD", last4: "4242424242424242" } }));
    expect(r.failureCode).toBe("invalid_last4");
  });
});
