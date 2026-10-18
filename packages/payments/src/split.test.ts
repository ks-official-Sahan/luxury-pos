import { describe, expect, it } from "vitest";
import { planSplit, SplitError } from "./split";

describe("planSplit", () => {
  it("exact split", () => {
    const p = planSplit(10_000, [{ method: "card_present", amount: 6000 }, { method: "qr", amount: 4000 }]);
    expect(p.change).toBe(0);
    expect(p.allocations.map((a) => a.amount)).toEqual([6000, 4000]);
  });
  it("last part takes remainder", () => {
    const p = planSplit(10_000, [{ method: "gift_card", amount: 2500 }, { method: "cash" }]);
    expect(p.allocations[1]?.amount).toBe(7500);
  });
  it("single remainder part covers whole total", () => {
    expect(planSplit(500, [{ method: "cash" }]).allocations[0]?.amount).toBe(500);
  });
  it("cash over-tender returns change", () => {
    const p = planSplit(10_000, [{ method: "card_present", amount: 4000 }, { method: "cash", amount: 7000 }]);
    expect(p.change).toBe(1000);
    expect(p.allocations[1]).toEqual({ method: "cash", amount: 6000, tendered: 7000 });
    expect(p.allocations.reduce((s, a) => s + a.amount, 0)).toBe(10_000);
  });
  it("rejects under-payment", () => {
    expect(() => planSplit(10_000, [{ method: "cash", amount: 9999 }])).toThrow(SplitError);
  });
  it("rejects non-cash overpayment and change larger than cash", () => {
    expect(() => planSplit(10_000, [{ method: "card_present", amount: 10_001 }])).toThrow(SplitError);
    expect(() => planSplit(10_000, [{ method: "card_present", amount: 9000 }, { method: "cash", amount: 1500 }, { method: "qr", amount: 500 }])).not.toThrow();
    expect(() => planSplit(10_000, [{ method: "card_present", amount: 9900 }, { method: "qr", amount: 1000 }, { method: "cash", amount: 100 }])).toThrow(SplitError);
  });
  it("rejects negatives, zero, fractions, bad totals, empty", () => {
    expect(() => planSplit(100, [{ method: "cash", amount: -1 }, { method: "qr" }])).toThrow(SplitError);
    expect(() => planSplit(100, [{ method: "cash", amount: 0 }, { method: "qr" }])).toThrow(SplitError);
    expect(() => planSplit(100, [{ method: "cash", amount: 1.5 }, { method: "qr" }])).toThrow(SplitError);
    expect(() => planSplit(0, [{ method: "cash" }])).toThrow(SplitError);
    expect(() => planSplit(100, [])).toThrow(SplitError);
  });
  it("remainder must be last and positive", () => {
    expect(() => planSplit(100, [{ method: "cash" }, { method: "qr", amount: 50 }])).toThrow(SplitError);
    expect(() => planSplit(100, [{ method: "qr", amount: 100 }, { method: "cash" }])).toThrow(SplitError);
  });
});
