import { describe, expect, it } from "vitest";
import {
  allocate,
  can,
  consumeLots,
  maxRedeemablePoints,
  parseMoney,
  pointsEarned,
  priceCart,
  reorderSuggestion,
  roundHalfEven,
  settle,
  signedQuantity,
  tierFor,
  uuidv7,
  weightedAverageCost,
  type LoyaltyProgram,
} from "./index";

describe("money", () => {
  it("rounds half to even", () => {
    expect([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 0, 2, 3]);
  });
  it("allocates exactly", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(-10, [3, 7]).reduce((a, b) => a + b)).toBe(-10);
  });
  it("parses typed amounts without float error", () => {
    expect(parseMoney("1,299.50", "USD")).toBe(129_950);
    expect(parseMoney("0.1", "USD")).toBe(10);
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("1.234", "USD")).toBeNull();
    expect(parseMoney("1.234", "BHD")).toBe(1234);
  });
});

describe("priceCart", () => {
  it("exclusive tax with an order discount spread across lines", () => {
    const cart = priceCart({
      currency: "USD",
      taxMode: "exclusive",
      lines: [
        { id: "a", unitPrice: 10_000, quantity: 2, taxRateBps: 887.5 },
        { id: "b", unitPrice: 5_000, quantity: 1, taxRateBps: 0 },
      ],
      orderDiscount: { kind: "fixed", amount: 2_500 },
    });
    expect(cart.subtotal).toBe(25_000);
    expect(cart.discountTotal).toBe(2_500);
    expect(cart.lines.map((l) => l.orderDiscount)).toEqual([2_000, 500]);
    expect(cart.lines[0]!.tax).toBe(1_598); // 18_000 * 8.875% = 1597.5 → half-even 1598
    expect(cart.total).toBe(18_000 + 1_598 + 4_500);
  });
  it("inclusive tax extracts VAT", () => {
    const cart = priceCart({ currency: "EUR", taxMode: "inclusive", lines: [{ id: "a", unitPrice: 12_000, quantity: 1, taxRateBps: 2000 }] });
    expect(cart.total).toBe(12_000);
    expect(cart.taxTotal).toBe(2_000);
    expect(cart.lines[0]!.net).toBe(10_000);
  });
  it("caps discounts at the line value", () => {
    const cart = priceCart({ currency: "USD", taxMode: "exclusive", lines: [{ id: "a", unitPrice: 100, quantity: 1, taxRateBps: 0, discount: { kind: "fixed", amount: 500 } }] });
    expect(cart.total).toBe(0);
  });
  it("rejects fractional quantity", () => {
    expect(() => priceCart({ currency: "USD", taxMode: "exclusive", lines: [{ id: "a", unitPrice: 100, quantity: 1.5, taxRateBps: 0 }] })).toThrow();
  });
});

describe("settle", () => {
  it("split tender with cash change", () => {
    const s = settle(10_000, [{ method: "card", amount: 6_000 }, { method: "cash", amount: 5_000 }]);
    expect(s).toMatchObject({ settled: true, changeDue: 1_000, paid: 10_000 });
  });
  it("cash rounding to 0.05", () => {
    const s = settle(1_002, [{ method: "cash", amount: 2_000 }], 5);
    expect(s.rounding).toBe(-2);
    expect(s.changeDue).toBe(1_000);
  });
  it("refuses card over-tender", () => {
    expect(() => settle(100, [{ method: "card", amount: 200 }])).toThrow();
  });
});

describe("loyalty", () => {
  const program: LoyaltyProgram = {
    pointsPerUnit: 1,
    pointValueMinor: 1,
    maxRedeemBps: 5_000,
    expiryDays: 365,
    tiers: [
      { id: "gold", name: "Gold", threshold: 500_000, earnMultiplierBps: 15_000 },
      { id: "base", name: "Member", threshold: 0, earnMultiplierBps: 10_000 },
    ],
  };
  it("picks tier and earns with multiplier", () => {
    const tier = tierFor(program, 600_000);
    expect(tier?.id).toBe("gold");
    expect(pointsEarned(program, 12_345, 2, tier)).toBe(185); // 123.45 * 1.5 = 185.175 → floor
  });
  it("caps redemption", () => {
    expect(maxRedeemablePoints(program, 10_000, 99_999)).toBe(5_000);
  });
  it("consumes soonest-expiring lots first", () => {
    const now = new Date("2026-01-01");
    const lots = [
      { id: "never", remaining: 100, expiresAt: null },
      { id: "late", remaining: 50, expiresAt: new Date("2026-12-01") },
      { id: "soon", remaining: 30, expiresAt: new Date("2026-02-01") },
      { id: "dead", remaining: 999, expiresAt: new Date("2025-12-01") },
    ];
    expect(consumeLots(lots, 100, now)).toEqual([
      { lotId: "soon", points: 30 },
      { lotId: "late", points: 50 },
      { lotId: "never", points: 20 },
    ]);
    expect(() => consumeLots(lots, 1_000, now)).toThrow();
  });
});

describe("inventory", () => {
  it("signs movements", () => {
    expect(signedQuantity("sale", 2)).toBe(-2);
    expect(signedQuantity("adjust", -3)).toBe(-3);
    expect(() => signedQuantity("receive", -1)).toThrow();
  });
  it("weighted average cost", () => {
    expect(weightedAverageCost({ onHand: 10, avgCost: 1_000 }, 10, 2_000)).toBe(1_500);
  });
  it("reorder suggestion rounds to pack size", () => {
    expect(reorderSuggestion({ available: 2, dailyVelocity: 1, leadTimeDays: 7, safetyDays: 3, packSize: 6 })).toEqual({ reorderPoint: 10, suggest: 18 });
    expect(reorderSuggestion({ available: 50, dailyVelocity: 1, leadTimeDays: 7, safetyDays: 3 }).suggest).toBe(0);
  });
});

describe("permissions", () => {
  it("respects role, store scope and hard denials", () => {
    expect(can({ tenantId: "t", role: "CASHIER", storeIds: null }, "sale.create")).toBe(true);
    expect(can({ tenantId: "t", role: "CASHIER", storeIds: null }, "sale.refund")).toBe(false);
    expect(can({ tenantId: "t", role: "MANAGER", storeIds: ["s1"] }, "sale.refund", { storeId: "s2" })).toBe(false);
    expect(can({ tenantId: "t", role: "AUDITOR", storeIds: null }, "sale.create", { matrix: { AUDITOR: new Set(["sale.create"]) } })).toBe(false);
  });
});

describe("uuidv7", () => {
  it("is time ordered", () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
