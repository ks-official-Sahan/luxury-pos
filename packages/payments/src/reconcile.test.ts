import { describe, expect, it } from "vitest";
import { reconcile, type SettlementLine } from "./reconcile";
import { newIntent, transition } from "./state";
import type { PaymentIntent, PaymentMethod } from "./types";

const DAY = 86_400_000;
function captured(id: string, ref: string | undefined, amount: number, method: PaymentMethod = "card_online", at = 1_000_000): PaymentIntent {
  const i = newIntent({ idempotencyKey: id, tenantId: "t", storeId: "s", amount, currency: "USD", method, metadata: {} }, "stripe", at);
  const c = transition(i, ref ? { type: "capture", providerRef: ref } : { type: "capture" }, at);
  return c;
}
const line = (providerRef: string, amount: number, settledAt = 1_000_000 + DAY, currency = "USD"): SettlementLine => ({ providerRef, amount, currency, settledAt });

describe("reconcile", () => {
  it("matches, and categorises every discrepancy", () => {
    const a = captured("a", "pi_a", 1000);
    const b = captured("b", "pi_b", 2000);
    const c = captured("c", "pi_c", 3000);
    const d = captured("d", "pi_d", 4000);
    const cash = captured("e", undefined, 500, "cash");
    const pending = newIntent({ idempotencyKey: "f", tenantId: "t", storeId: "s", amount: 1, currency: "USD", method: "card_online", metadata: {} }, "stripe", 0);
    const r = reconcile(
      [a, b, c, d, cash, pending],
      [line("pi_a", 1000), line("pi_b", 1999), line("pi_c", 3000, 1_000_000, "EUR"), line("pi_x", 777), line("pi_d", 4000, 1_000_000 + 30 * DAY)],
    );
    expect(r.matched.map((m) => m.intent.id)).toEqual(["a"]);
    expect(r.amountMismatches.map((m) => [m.intent.id, m.reason])).toEqual([["b", "amount"], ["c", "currency"]]);
    expect(r.missingInSettlement.map((i) => i.id)).toEqual(["d"]);
    expect(r.unexpected.map((l) => l.providerRef).sort()).toEqual(["pi_d", "pi_x"]);
  });
  it("consumes each line once", () => {
    const a = captured("a", "pi_a", 1000);
    const dup = captured("b", "pi_a", 1000);
    const r = reconcile([a, dup], [line("pi_a", 1000)]);
    expect(r.matched).toHaveLength(1);
    expect(r.missingInSettlement).toHaveLength(1);
  });
  it("honours custom window and flags intents lacking providerRef", () => {
    const a = captured("a", "pi_a", 1000);
    expect(reconcile([a], [line("pi_a", 1000, 1_000_000 + 2 * DAY)], { windowMs: DAY }).missingInSettlement).toHaveLength(1);
    const noRef = captured("n", undefined, 1000);
    expect(reconcile([noRef], []).missingInSettlement).toHaveLength(1);
  });
  it("partially refunded intents compare on captured amount", () => {
    const a = transition(captured("a", "pi_a", 1000), { type: "refund", amount: 300 });
    expect(reconcile([a], [line("pi_a", 1000)]).matched).toHaveLength(1);
  });
});
