import { describe, expect, it } from "vitest";
import {
  abcClassify, adjustmentsFromCount, allocate, applyPicks, cogs, convert, cycleSchedule, deadStock, dueOnDay,
  expiryReport, fromBase, markExpired, planTransfer, pricedPicks, priceForWeight, receiveTransfer,
  reorderPoint, safetyStock, stockGapAlerts, suggestMisplacement, suggestReplenishment, toBase, valuation,
  variance, divRound,
} from "./index";
import type { CountSession, Lot, Location, Uom } from "./index";

const piece: Uom = { code: "pc", name: "Piece", factor: 1 };
const box: Uom = { code: "box", name: "Box", factor: 12 };
const carton: Uom = { code: "ctn", name: "Carton", factor: 144 };
const now = new Date("2026-06-01T00:00:00Z");

const lot = (id: string, o: Partial<Lot> = {}): Lot => ({
  id, productId: "p1", locationId: "w1", quantity: 10, unitCost: 100,
  receivedAt: "2026-01-01T00:00:00Z", status: "available", ...o,
});

describe("units", () => {
  it("converts and splits remainder", () => {
    expect(toBase(3, box)).toBe(36);
    expect(fromBase(150, carton)).toEqual({ whole: 1, remainder: 6 });
    expect(convert(2, carton, box)).toBe(24);
    expect(() => convert(5, piece, box)).toThrow();
    expect(convert(24, piece, box)).toBe(2);
    expect(() => toBase(1.5, box)).toThrow();
  });
  it("prices weight with banker's rounding", () => {
    expect(priceForWeight(500, 1999)).toBe(1000); // 999.5 -> 1000 (even)
    expect(priceForWeight(501, 1000)).toBe(501);
    expect(priceForWeight(1, 1500)).toBe(2); // 1.5 -> 2
    expect(priceForWeight(1, 2500)).toBe(2); // 2.5 -> 2
    expect(divRound(-5, 2)).toBe(-2);
  });
});

describe("lots", () => {
  const lots = [
    lot("a", { expiresAt: "2026-07-01T00:00:00Z", receivedAt: "2026-02-01T00:00:00Z" }),
    lot("b", { expiresAt: "2026-06-10T00:00:00Z", receivedAt: "2026-03-01T00:00:00Z", unitCost: 120 }),
    lot("c", { expiresAt: "2026-05-01T00:00:00Z" }),
    lot("d", { expiresAt: "2026-06-05T00:00:00Z", status: "quarantine" }),
    lot("e", { status: "recalled" }),
    lot("f", { receivedAt: "2026-04-01T00:00:00Z", unitCost: 90 }),
  ];
  it("FEFO skips expired/quarantine/recalled, no-expiry last", () => {
    const r = allocate(lots, 25, { strategy: "FEFO", now });
    expect(r.picks.map((p) => p.lotId)).toEqual(["b", "a", "f"]);
    expect(r.picks.map((p) => p.quantity)).toEqual([10, 10, 5]);
    expect(r.cost).toBe(10 * 120 + 10 * 100 + 5 * 90);
    expect(r.shortfall).toBe(0);
  });
  it("FIFO, LIFO, SPECIFIC", () => {
    expect(allocate(lots, 15, { strategy: "FIFO", now }).picks.map((p) => p.lotId)).toEqual(["a", "b"]);
    expect(allocate(lots, 15, { strategy: "LIFO", now }).picks.map((p) => p.lotId)).toEqual(["f", "b"]);
    const s = allocate(lots, 15, { strategy: "SPECIFIC", now, lotIds: ["f", "a", "c", "d"] });
    expect(s.picks.map((p) => p.lotId)).toEqual(["f", "a"]);
  });
  it("reports shortfall, allows expired but never quarantine", () => {
    const r = allocate(lots, 100, { strategy: "FEFO", now });
    expect(r.shortfall).toBe(100 - 30);
    const r2 = allocate(lots, 100, { strategy: "FEFO", now, allowExpired: true });
    expect(r2.picks.map((p) => p.lotId)).toEqual(["c", "b", "a", "f"]);
    expect(allocate(lots, 5, { strategy: "FIFO", now, locationId: "zzz" }).shortfall).toBe(5);
  });
  it("breaks ties by id and applies picks immutably", () => {
    const t = [lot("z"), lot("m")];
    const r = allocate(t, 12, { strategy: "FIFO", now });
    expect(r.picks.map((p) => p.lotId)).toEqual(["m", "z"]);
    const next = applyPicks(t, r.picks);
    expect(next.map((l) => l.quantity)).toEqual([8, 0]);
    expect(t[0]?.quantity).toBe(10);
    expect(() => applyPicks(t, [{ lotId: "z", quantity: 11, unitCost: 1 }])).toThrow();
  });
  it("prices mixed-price lots", () => {
    const l = [lot("x", { unitPrice: 150 }), lot("y")];
    const { lines, total } = pricedPicks(l, [{ lotId: "x", quantity: 2, unitCost: 100 }, { lotId: "y", quantity: 3, unitCost: 100 }], 200);
    expect(lines.map((x) => x.unitPrice)).toEqual([150, 200]);
    expect(total).toBe(900);
  });
  it("values FIFO vs weighted average", () => {
    const l = [lot("a", { quantity: 10, unitCost: 100 }), lot("b", { quantity: 10, unitCost: 200, receivedAt: "2026-02-01T00:00:00Z" })];
    expect(valuation(l, "FIFO").value).toBe(3000);
    expect(cogs(l, 5, "FIFO").cost).toBe(500);
    expect(cogs(l, 5, "WEIGHTED_AVERAGE").cost).toBe(750);
    expect(cogs(l, 25, "FIFO")).toEqual({ cost: 3000, shortfall: 5 });
    const r = [lot("a", { quantity: 1, unitCost: 100 }), lot("b", { quantity: 2, unitCost: 101 })];
    expect(valuation(r, "FIFO").value).toBe(302);
    expect(valuation(r, "WEIGHTED_AVERAGE")).toEqual({ quantity: 3, value: 303, averageCost: 101 });
  });
  it("reports expiry and marks expired", () => {
    const rep = expiryReport(lots, now, 14);
    expect(rep.expired.map((l) => l.id)).toEqual(["c"]);
    expect(rep.expiringSoon.map((x) => [x.lot.id, x.daysLeft])).toEqual([["d", 4], ["b", 9]]);
    expect(rep.fine.map((l) => l.id)).toEqual(["a", "e", "f"]);
    const m = markExpired(lots, now);
    expect(m.find((l) => l.id === "c")?.status).toBe("expired");
    expect(m.find((l) => l.id === "d")?.status).toBe("quarantine");
    expect(lots.find((l) => l.id === "c")?.status).toBe("available");
  });
});

describe("locations", () => {
  const wh: Location = { id: "w1", kind: "warehouse", name: "WH" };
  const st: Location = { id: "s1", kind: "store", name: "Store" };
  it("plans via transit and handles partial receipt", () => {
    const plan = planTransfer(wh, st, [{ lotId: "a", quantity: 10, unitCost: 100 }, { lotId: "b", quantity: 5, unitCost: 90 }], { transferId: "T1" });
    expect(plan.movements.map((m) => `${m.fromLocationId}>${m.toLocationId}`)).toEqual([
      "w1>transit:w1:s1", "transit:w1:s1>s1", "w1>transit:w1:s1", "transit:w1:s1>s1",
    ]);
    const r = receiveTransfer(plan, [{ lotId: "a", quantity: 7 }, { lotId: "b", quantity: 6 }, { lotId: "q", quantity: 1 }]);
    expect(r.movements.map((m) => [m.lotId, m.quantity])).toEqual([["a", 7], ["b", 5]]);
    expect(r.discrepancies.map((d) => [d.lotId, d.kind, d.diff])).toEqual([["a", "short", -3], ["b", "over", 1], ["q", "unexpected", 1]]);
    expect(r.remainingInTransit).toEqual([{ lotId: "a", quantity: 3 }]);
    expect(() => planTransfer(wh, wh, [])).toThrow();
  });
});

describe("counts", () => {
  const session = (locationId: string, lines: CountSession["lines"]): CountSession => ({
    id: `s-${locationId}`, locationId, scope: "cycle", blind: true, startedAt: "2026-06-01T00:00:00Z", lines,
  });
  const costs = { p1: 100, p2: 50, p3: 10 };
  it("computes statuses and summary", () => {
    const s = session("st1", [
      { productId: "p1", expected: 20, counted: 20 },
      { productId: "p1", lotId: "L2", expected: 20, counted: 18 },
      { productId: "p2", expected: 10, counted: 12 },
      { productId: "p3", expected: 100, counted: 60 },
      { productId: "p3", lotId: "L9", expected: 100, counted: 60, recount: 61 },
      { productId: "p2", lotId: "L3", expected: 5 },
    ]);
    const v = variance(s, costs, { thresholdUnits: 10, thresholdPct: 50 });
    expect(v.lines.map((l) => l.status)).toEqual(["match", "short", "over", "needs_recount", "short", "uncounted"]);
    expect(v.lines[1]?.valueDiff).toBe(-200);
    expect(v.summary).toMatchObject({ shrinkUnits: 2 + 39, shrinkValue: 200 + 390, overUnits: 2, needsRecount: 1, uncounted: 1, accuracyPct: 20 });
    expect(() => variance(session("x", [{ productId: "zz", expected: 1, counted: 1 }]), costs)).toThrow();
  });
  it("percent threshold triggers recount", () => {
    const s = session("st1", [{ productId: "p2", expected: 4, counted: 3 }]);
    expect(variance(s, costs, { thresholdUnits: 10, thresholdPct: 10 }).lines[0]?.status).toBe("needs_recount");
    expect(variance(s, costs, { thresholdUnits: 10, thresholdPct: 30 }).lines[0]?.status).toBe("short");
  });
  it("suggests misplacement across two stores before write-off", () => {
    const a = session("A", [{ productId: "p1", expected: 10, counted: 6 }, { productId: "p2", expected: 5, counted: 3 }]);
    const b = session("B", [{ productId: "p1", expected: 10, counted: 13 }]);
    const r = suggestMisplacement([a, b], { thresholdUnits: 100, thresholdPct: 100 });
    expect(r.suggestions).toEqual([{ productId: "p1", shortLocationId: "A", overLocationId: "B", quantity: 3 }]);
    expect(r.unmatchedShort).toEqual([
      { productId: "p1", locationId: "A", quantity: 1 },
      { productId: "p2", locationId: "A", quantity: 2 },
    ]);
    expect(r.unmatchedOver).toEqual([]);
  });
  it("builds adjustments from resolved lines", () => {
    const s = session("st1", [
      { productId: "p1", expected: 5, counted: 3 },
      { productId: "p2", expected: 5, counted: 7 },
      { productId: "p3", expected: 5 },
    ]);
    expect(adjustmentsFromCount(s, "count_shrink", { thresholdUnits: 50, thresholdPct: 100 }).map((a) => [a.productId, a.delta, a.reason])).toEqual([
      ["p1", -2, "count_shrink"], ["p2", 2, "count_found"],
    ]);
  });
  it("classifies ABC and schedules cycles", () => {
    const r = abcClassify([
      { id: "e", annualValue: 20 }, { id: "a", annualValue: 800 }, { id: "c", annualValue: 50 },
      { id: "b", annualValue: 100 }, { id: "d", annualValue: 30 },
    ]);
    expect(r.map((x) => `${x.id}${x.class}`)).toEqual(["aA", "bB", "cB", "dC", "eC"]);
    expect(r[4]?.cumulativeShare).toBe(1);
    const sched = cycleSchedule(r, { A: 30, B: 2, C: 90 });
    expect(sched.find((e) => e.id === "c")?.offset).toBe(1);
    expect(dueOnDay(sched, 0).sort()).toEqual(["a", "b", "d"]);
    expect(dueOnDay(sched, 1).sort()).toEqual(["c", "e"]);
  });
});

describe("replenishment", () => {
  it("computes ROP and safety stock", () => {
    expect(safetyStock(1.65, 4, 9)).toBe(20);
    expect(reorderPoint({ dailyDemand: 2.5, leadTimeDays: 4, safetyStock: 3 })).toBe(13);
  });
  it("rounds up to pack size and MOQ with reasons", () => {
    const base = { onOrder: 0, dailyDemand: 5, leadTimeDays: 4, safetyStock: 5 };
    const s = suggestReplenishment([
      { ...base, productId: "p1", onHand: 20, packSize: 12 },
      { ...base, productId: "p2", onHand: 0, packSize: 6, minOrderQty: 60 },
      { ...base, productId: "p3", onHand: 100 },
      { ...base, productId: "p4", onHand: 30, packSize: 10, expiryWindowDays: 7,
        lots: [lot("x", { productId: "p4", quantity: 10, expiresAt: "2026-06-03T00:00:00Z" }), lot("y", { productId: "p4", quantity: 20 })] },
    ], now);
    expect(s.map((x) => x.productId)).toEqual(["p2", "p1", "p4"]);
    expect(s[0]).toMatchObject({ quantity: 60, reasons: ["stockout", "below_rop"], reorderPoint: 25 });
    expect(s[1]).toMatchObject({ quantity: 12, reasons: ["below_rop"] });
    expect(s[2]).toMatchObject({ quantity: 10, reasons: ["expiring_soon_replace"], position: 20 });
  });
  it("finds dead stock and combines alerts", () => {
    const dead = deadStock([
      { productId: "d1", onHand: 5, unitCost: 100, receivedAt: "2025-01-01T00:00:00Z" },
      { productId: "d2", onHand: 5, unitCost: 100, receivedAt: "2025-01-01T00:00:00Z", lastSoldAt: "2026-05-20T00:00:00Z" },
      { productId: "d3", onHand: 0, unitCost: 100, receivedAt: "2025-01-01T00:00:00Z" },
    ], now, 180);
    expect(dead.map((d) => d.productId)).toEqual(["d1"]);
    const alerts = stockGapAlerts({
      lots: [lot("old", { expiresAt: "2026-01-01T00:00:00Z" })],
      items: [{ productId: "p9", onHand: 0, onOrder: 0, dailyDemand: 1, leadTimeDays: 2, safetyStock: 0 }],
      dead: [{ productId: "d1", onHand: 5, unitCost: 100, receivedAt: "2025-01-01T00:00:00Z" }],
    }, now, { warnDays: 7, noSaleDays: 180 });
    expect(alerts.map((a) => a.kind)).toEqual(["expired", "stockout", "dead_stock"]);
  });
});
