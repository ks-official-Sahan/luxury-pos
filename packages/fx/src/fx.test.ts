import { describe, expect, it } from "vitest";
import {
  RateTable, breakdown, changeInBase, convert, convertWithTable, currencyExponent, denominations,
  foreignTenderValue, formatMoney, isCurrency, isStale, parseMoney, tenderRate,
} from "./index";

describe("currencies", () => {
  it("exponents", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("BHD")).toBe(3);
  });
  it("isCurrency", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("usd")).toBe(false);
    expect(isCurrency("US")).toBe(false);
    expect(isCurrency("ZZZ")).toBe(false);
  });
  it("format", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(-5, "USD")).toBe("-$0.05");
    expect(formatMoney(1500, "JPY")).toContain("1,500");
    expect(formatMoney(1234, "BHD")).toContain("1.234");
  });
  it("parse", () => {
    expect(parseMoney("1,299.50", "USD")).toBe(129950);
    expect(parseMoney("0.07", "USD")).toBe(7);
    expect(parseMoney("19.99", "USD")).toBe(1999);
    expect(parseMoney("-3", "USD")).toBe(-300);
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("1.5", "JPY")).toBeNull();
    expect(parseMoney("1.2345", "BHD")).toBeNull();
    expect(parseMoney("1.234", "BHD")).toBe(1234);
    expect(parseMoney("abc", "USD")).toBeNull();
    expect(parseMoney("", "USD")).toBeNull();
    expect(parseMoney("99999999999999999", "USD")).toBeNull();
  });
});

const rates = [
  { base: "EUR", quote: "USD", rate: "1.0800", source: "ecb", asOf: "2026-01-01T00:00:00Z" },
  { base: "EUR", quote: "USD", rate: "1.1000", source: "ecb", asOf: "2026-01-03T00:00:00Z" },
  { base: "GBP", quote: "USD", rate: "1.25", source: "ecb", asOf: "2026-01-02T00:00:00Z" },
  { base: "USD", quote: "JPY", rate: "150", source: "boj", asOf: "2026-01-02T12:00:00Z" },
];

describe("RateTable", () => {
  const t = new RateTable(rates);
  it("direct and latest", () => {
    const r = t.get("EUR", "USD");
    expect(r).toMatchObject({ rate: "1.1000", path: ["EUR", "USD"], derived: false, source: "ecb" });
  });
  it("as-of selection", () => {
    expect(t.get("EUR", "USD", new Date("2026-01-02T00:00:00Z"))?.rate).toBe("1.0800");
    expect(t.get("EUR", "USD", new Date("2026-01-03T00:00:00Z"))?.rate).toBe("1.1000");
    expect(t.get("EUR", "USD", new Date("2025-12-31T00:00:00Z"))).toBeNull();
  });
  it("inverse", () => {
    const r = t.get("USD", "GBP");
    expect(r?.derived).toBe(true);
    expect(r?.rate).toBe("0.8");
    expect(r?.path).toEqual(["USD", "GBP"]);
    expect(t.get("USD", "EUR")?.rate).toBe("0.909090909090909091");
  });
  it("triangulation via pivot", () => {
    const r = t.get("EUR", "JPY");
    expect(r).toMatchObject({ rate: "165", path: ["EUR", "USD", "JPY"], derived: true, source: "ecb+boj" });
    expect(r?.asOf).toBe("2026-01-02T12:00:00Z");
    expect(t.get("GBP", "EUR")?.path).toEqual(["GBP", "USD", "EUR"]);
  });
  it("custom pivot, identity, missing", () => {
    const eurPivot = new RateTable(
      [
        { base: "EUR", quote: "GBP", rate: "0.85", source: "x", asOf: "2026-01-01T00:00:00Z" },
        { base: "EUR", quote: "CHF", rate: "0.95", source: "x", asOf: "2026-01-01T00:00:00Z" },
      ],
      { pivot: "EUR" },
    );
    expect(eurPivot.get("GBP", "CHF")?.path).toEqual(["GBP", "EUR", "CHF"]);
    expect(t.get("USD", "USD")?.rate).toBe("1");
    expect(t.get("EUR", "AUD")).toBeNull();
    expect(() => new RateTable([{ base: "A", quote: "B", rate: "x", source: "", asOf: "2026-01-01T00:00:00Z" }])).toThrow(RangeError);
  });
  it("staleness", () => {
    const r = { asOf: "2026-01-01T00:00:00Z" };
    const hour = 3_600_000;
    expect(isStale(r, new Date("2026-01-01T01:00:00Z"), hour)).toBe(false);
    expect(isStale(r, new Date("2026-01-01T01:00:01Z"), hour)).toBe(true);
    expect(isStale({ asOf: "bad" }, new Date(), hour)).toBe(true);
  });
});

describe("convert", () => {
  it("USD to EUR exact", () => expect(convert(100000, "USD", "EUR", "0.9231")).toBe(92310));
  it("JPY and USD", () => {
    expect(convert(10000, "JPY", "USD", "0.0067")).toBe(6700);
    expect(convert(10000, "USD", "JPY", "149.25")).toBe(14925);
  });
  it("BHD", () => {
    expect(convert(10000, "USD", "BHD", "0.376")).toBe(37600);
    expect(convert(37600, "BHD", "USD", "2.6596")).toBe(10000);
  });
  it("rounding modes", () => {
    const c = (m: number, mode: "half_even" | "half_up" | "down") => convert(m, "USD", "EUR", "0.5", { rounding: mode });
    expect([c(1, "half_even"), c(1, "half_up"), c(1, "down")]).toEqual([0, 1, 0]);
    expect([c(3, "half_even"), c(3, "half_up"), c(3, "down")]).toEqual([2, 2, 1]);
    expect([c(5, "half_even"), c(5, "half_up"), c(5, "down")]).toEqual([2, 3, 2]);
    expect([c(-5, "half_even"), c(-5, "half_up"), c(-5, "down")]).toEqual([-2, -3, -2]);
    expect(convert(7, "USD", "EUR", "0.51")).toBe(4);
  });
  it("unsafe and invalid", () => {
    expect(() => convert(Number.MAX_SAFE_INTEGER, "USD", "EUR", "2")).toThrow(RangeError);
    expect(() => convert(1.5, "USD", "EUR", "2")).toThrow(RangeError);
    expect(() => convert(1, "USD", "EUR", "0")).toThrow(RangeError);
    expect(() => convert(1, "USD", "EUR", "1e3")).toThrow(RangeError);
  });
  it("convertWithTable", () => {
    const t = new RateTable(rates);
    expect(convertWithTable(10000, "EUR", "JPY", t)).toEqual({ amount: 16500, rate: "165", path: ["EUR", "USD", "JPY"], asOf: "2026-01-02T12:00:00Z", source: "ecb+boj" });
    expect(convertWithTable(10000, "EUR", "USD", t, new Date("2026-01-02T00:00:00Z")).amount).toBe(10800);
    expect(() => convertWithTable(1, "EUR", "AUD", t)).toThrow();
  });
});

describe("tender", () => {
  it("applies buy spread", () => {
    expect(foreignTenderValue({ amount: 10000, currency: "EUR" }, "USD", "1.10")).toBe(11000);
    expect(foreignTenderValue({ amount: 10000, currency: "EUR" }, "USD", "1.10", 200)).toBe(10780);
    expect(tenderRate("1.10", 200)).toBe("1.078");
  });
  it("JPY to USD with spread", () => {
    expect(foreignTenderValue({ amount: 10000, currency: "JPY" }, "USD", "0.0067", 100)).toBe(6633);
  });
  it("rejects bad spread", () => {
    expect(() => foreignTenderValue({ amount: 1, currency: "EUR" }, "USD", "1.1", -1)).toThrow(RangeError);
    expect(() => foreignTenderValue({ amount: 1, currency: "EUR" }, "USD", "1.1", 10000)).toThrow(RangeError);
  });
  it("changeInBase", () => {
    expect(changeInBase(5000, { amount: 5000, currency: "EUR" }, "USD", "1.10", 200)).toEqual({ tenderedBase: 5390, change: 390, remaining: 0 });
    expect(changeInBase(9000, { amount: 5000, currency: "EUR" }, "USD", "1.10", 200)).toEqual({ tenderedBase: 5390, change: 0, remaining: 3610 });
  });
  it("denominations", () => {
    expect(denominations("USD")).toEqual([10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1]);
    expect(denominations("JPY")[0]).toBe(10000);
    expect(denominations("JPY")).toContain(500);
    expect(denominations("LKR")).toContain(500000);
    expect(denominations("CHF")).toContain(100000);
    expect(denominations("XXX")).toEqual([]);
    for (const c of ["USD", "EUR", "GBP", "LKR", "AED", "JPY", "INR", "AUD", "CAD", "CHF"]) expect(denominations(c).length).toBeGreaterThan(5);
  });
  it("breakdown", () => {
    expect(breakdown(1737, denominations("USD"))).toEqual({
      lines: [{ value: 1000, count: 1 }, { value: 500, count: 1 }, { value: 200, count: 1 }, { value: 25, count: 1 }, { value: 10, count: 1 }, { value: 1, count: 2 }],
      remainder: 0,
    });
    expect(breakdown(7, [5, 2])).toEqual({ lines: [{ value: 5, count: 1 }, { value: 2, count: 1 }], remainder: 0 });
    expect(breakdown(3, [5])).toEqual({ lines: [], remainder: 3 });
    expect(() => breakdown(-1, [1])).toThrow(RangeError);
  });
});
