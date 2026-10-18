import { describe, expect, it } from "vitest";
import {
  buildGs1, buildInStore, classifyScan, code128B, code128BChecksum, createScanBuffer, ean13Modules,
  escposBarcode, expandUpcE, generateInternalCode, gtinCheckDigit, isValidEan13, isValidEan8, isValidGtin,
  isValidUpcA, isValidUpcE, normalizeGtin, parseGs1, parseInStore, toSvg, widthsToModules, zplLabel,
} from "./index";
import type { InStoreScheme } from "./index";

describe("ean", () => {
  it("validates EAN-13, EAN-8, UPC-A", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan8("96385074")).toBe(true);
    expect(isValidUpcA("036000291452")).toBe(true);
    expect(isValidGtin("036000291453")).toBe(false);
    expect(gtinCheckDigit("400638133393")).toBe(1);
  });
  it("expands UPC-E", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("01234565")).toBe("012345000065");
    expect(isValidUpcE("04252614")).toBe(true);
    expect(isValidUpcE("04252615")).toBe(false);
    expect(isValidUpcE("24252614")).toBe(false);
  });
  it("normalizes to GTIN-14", () => {
    expect(normalizeGtin("4006381333931")).toBe("04006381333931");
    expect(normalizeGtin("036000291452")).toBe("00036000291452");
    expect(normalizeGtin("96385074")).toBe("00000096385074");
    expect(normalizeGtin("04252614", { upcE: true })).toBe("00042100005264");
    expect(() => normalizeGtin("123")).toThrow();
  });
});

describe("gs1", () => {
  const fnc1 = "0104006381333931\x1d1712123110ABC123\x1d3103001250";
  it("parses FNC1 form incl. weight and lot", () => {
    const r = parseGs1("0104006381333931" + "17" + "121200" + "10LOT7\x1d3103001250");
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ gtin: "04006381333931", expiry: "2012-12-31", lot: "LOT7", netWeightGrams: 1250 });
    expect(r.raw["3103"]).toBe("001250");
    const r2 = parseGs1(fnc1);
    expect(r2.ok).toBe(true);
    expect(r2.data.lot).toBe("ABC123");
    expect(r2.data.expiry).toBe("2012-12-31");
  });
  it("handles day 00 as end of month incl. leap years", () => {
    expect(parseGs1("(01)04006381333931(17)240200").data.expiry).toBe("2024-02-29");
    expect(parseGs1("(17)250200").data.expiry).toBe("2025-02-28");
  });
  it("parses human-readable form and other AIs", () => {
    const r = parseGs1("(01)04006381333931(15)261015(10)B-9(21)SN1(30)12(3922)00995");
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ bestBefore: "2026-10-15", lot: "B-9", serial: "SN1", count: 12, price: { value: 995, decimals: 2 } });
    const sscc = "01234567890123456" + gtinCheckDigit("01234567890123456");
    expect(parseGs1("]C100" + sscc).data.sscc).toBe(sscc);
  });
  it("reports errors", () => {
    expect(parseGs1("(01)04006381333932").errors[0]).toMatch(/check digit/);
    expect(parseGs1("(17)251301").errors[0]).toMatch(/date/);
    expect(parseGs1("99abc").ok).toBe(false);
    expect(parseGs1("(10)ABCDEFGHIJKLMNOPQRSTU").ok).toBe(false);
    expect(parseGs1("(10)A(10)B").errors.join()).toMatch(/duplicate/);
  });
  it("builds and round-trips", () => {
    const els = [
      { ai: "01", value: "04006381333931" }, { ai: "10", value: "LOT1" }, { ai: "17", value: "271200" },
      { ai: "3103", value: "000500" },
    ];
    const b = buildGs1(els);
    expect(b.fnc1).toBe("0104006381333931" + "10LOT1\x1d" + "17271200" + "3103000500");
    expect(b.human).toBe("(01)04006381333931(10)LOT1(17)271200(3103)000500");
    expect(parseGs1(b.fnc1).elements).toEqual(els);
    expect(parseGs1(b.human).elements).toEqual(els);
    expect(() => buildGs1([{ ai: "01", value: "123" }])).toThrow();
  });
});

describe("instore", () => {
  const price: InStoreScheme = { prefix: "2", itemDigits: 6, valueKind: "price", valueDigits: 5, decimals: 2 };
  const weight: InStoreScheme = { prefix: "21", itemDigits: 5, valueKind: "weight", valueDigits: 5, decimals: 3 };
  it("round-trips price and weight codes", () => {
    const p = buildInStore("123", 1999, price);
    expect(p).toHaveLength(13);
    expect(isValidEan13(p)).toBe(true);
    expect(parseInStore(p, [price, weight])).toMatchObject({ itemCode: "000123", price: 1999, priceDecimals: 2 });
    const w = buildInStore("77", 1250, weight);
    expect(w.startsWith("21")).toBe(true);
    expect(parseInStore(w, [price, weight])).toMatchObject({ itemCode: "00077", weightGrams: 1250 });
    expect(parseInStore("4006381333931", [price, weight])).toBeNull();
    expect(() => buildInStore("1", 100000, price)).toThrow();
  });
  it("generates valid internal codes", () => {
    const c = generateInternalCode(42);
    expect(c).toHaveLength(13);
    expect(c.startsWith("2")).toBe(true);
    expect(isValidEan13(c)).toBe(true);
    expect(isValidEan13(generateInternalCode(0, "29"))).toBe(true);
    expect(() => generateInternalCode(10 ** 11)).toThrow();
  });
});

describe("scanner", () => {
  it("accepts fast input, rejects slow typing", () => {
    const b = createScanBuffer();
    let out: string | null = null;
    "4006381333931".split("").forEach((k, i) => b.push(k, 1000 + i * 8));
    out = b.push("Enter", 1000 + 13 * 8);
    expect(out).toBe("4006381333931");
    "4006381333931".split("").forEach((k, i) => b.push(k, 5000 + i * 120));
    expect(b.push("Enter", 5000 + 14 * 120)).toBeNull();
    expect(b.pending()).toBe("");
  });
  it("restarts after a slow gap and enforces min length and fast terminator", () => {
    const b = createScanBuffer();
    b.push("x", 0);
    "123456".split("").forEach((k, i) => b.push(k, 500 + i * 5));
    expect(b.push("Enter", 540)).toBe("123456");
    "12".split("").forEach((k, i) => b.push(k, i * 5));
    expect(b.push("Enter", 20)).toBeNull();
    "123456".split("").forEach((k, i) => b.push(k, i * 5));
    expect(b.push("Enter", 500)).toBeNull();
  });
  it("classifies scans", () => {
    const price: InStoreScheme = { prefix: "2", itemDigits: 6, valueKind: "price", valueDigits: 5, decimals: 2 };
    expect(classifyScan("4006381333931")).toMatchObject({ kind: "gtin", gtin14: "04006381333931", format: "EAN-13" });
    expect(classifyScan("036000291452").kind).toBe("gtin");
    expect(classifyScan(buildInStore("5", 250, price), { schemes: [price] }).kind).toBe("instore");
    expect(classifyScan(generateInternalCode(7)).kind).toBe("internal");
    expect(classifyScan("https://shop.example/p/1").kind).toBe("qr_url");
    expect(classifyScan("0104006381333931\x1d10A1").kind).toBe("gs1");
    expect(classifyScan("(01)04006381333931(17)271200").kind).toBe("gs1");
    expect(classifyScan("0104006381333931").kind).toBe("gs1");
    expect(classifyScan("12345").kind).toBe("unknown");
    expect(classifyScan("").kind).toBe("unknown");
  });
});

describe("render", () => {
  it("computes the Code 128 checksum", () => {
    expect(code128BChecksum("ABC")).toBe(1);
    expect(code128BChecksum("Hello")).toBe(76);
    const w = code128B("ABC");
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 * 5 + 13);
    expect(w.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(w.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
    expect(widthsToModules(w).startsWith("11010010000")).toBe(true);
    expect(() => code128B("é")).toThrow();
  });
  it("builds 95-module EAN-13", () => {
    const m = ean13Modules("4006381333931");
    expect(m).toHaveLength(95);
    expect(m.startsWith("101")).toBe(true);
    expect(m.slice(45, 50)).toBe("01010");
    expect(m.endsWith("101")).toBe(true);
    expect(m.slice(3, 10)).toBe("0001101"); // first digit 4 -> LGLLGG, so digit 0 uses L
    expect(() => ean13Modules("4006381333932")).toThrow();
  });
  it("renders SVG", () => {
    const svg = toSvg(ean13Modules("4006381333931"), { height: 60, moduleWidth: 2, quiet: 9 });
    expect(svg).toContain("<rect");
    expect(svg).toContain('width="226"');
    expect(toSvg(code128B("A"), { height: 10, moduleWidth: 1 })).toContain("<svg");
  });
  it("builds ZPL", () => {
    const z = zplLabel({ name: "Silk ^Scarf", price: 12999, barcode: "4006381333931", currencySymbol: "$" });
    expect(z).toContain("^XA");
    expect(z).toContain("^XZ");
    expect(z).toContain("^BC");
    expect(z).toContain("$129.99");
    expect(z).toContain("Silk _5EScarf");
  });
  it("builds ESC/POS", () => {
    const b = escposBarcode("4006381333931", "EAN13");
    expect([...b.slice(0, 4)]).toEqual([0x1d, 0x6b, 67, 13]);
    expect(b).toHaveLength(17);
    expect(escposBarcode("400638133393", "EAN13")[3]).toBe(13);
    expect([...escposBarcode("AB", "CODE128")]).toEqual([0x1d, 0x6b, 73, 4, 0x7b, 0x42, 65, 66]);
    expect(() => escposBarcode("12", "EAN13")).toThrow();
  });
});
