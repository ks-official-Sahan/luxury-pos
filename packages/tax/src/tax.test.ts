import { describe, expect, it } from "vitest";
import { applyFees, computeTaxes, taxInvoiceSummary } from "./index";
import type { Fee, Jurisdiction, TaxGroup, TaxInput, TaxLineInput } from "./index";

const group = (id: string, rates: TaxGroup["rates"]): TaxGroup => ({ id, name: id, rates });
const juris = (classes: Record<string, string>, def: string): Jurisdiction => ({ id: "j", name: "J", country: "XX", classes, defaultGroupId: def });
const line = (id: string, amount: number, taxClass = "std"): TaxLineInput => ({ id, amount, taxClass, quantity: 1 });
const run = (groups: TaxGroup[], lines: TaxLineInput[], over: Partial<TaxInput> = {}, classes: Record<string, string> = {}) =>
  computeTaxes({ currency: "USD", lines, jurisdiction: juris(classes, groups[0]!.id), groups, rounding: "line", ...over });

const vat20 = group("vat", [{ id: "vat20", name: "VAT 20%", ratePpm: 200000 }]);
const vat20inc = group("vati", [{ id: "vat20", name: "VAT 20%", ratePpm: 200000, inclusive: true }]);
const ca = group("ca", [
  { id: "gst", name: "GST", ratePpm: 50000 },
  { id: "pst", name: "PST", ratePpm: 70000 },
]);
const qc = group("qc", [
  { id: "gst", name: "GST", ratePpm: 50000 },
  { id: "qst", name: "QST", ratePpm: 99750, compound: true },
]);

describe("computeTaxes", () => {
  it("20% exclusive", () => {
    const r = run([vat20], [line("a", 10000)]);
    expect(r.lines[0]).toEqual({ id: "a", groupId: "vat", net: 10000, taxes: [{ rateId: "vat20", name: "VAT 20%", amount: 2000 }], gross: 12000 });
    expect(r.totals).toEqual({ net: 10000, tax: 2000, gross: 12000 });
  });

  it("20% inclusive extraction", () => {
    expect(run([vat20inc], [line("a", 12000)]).totals).toEqual({ net: 10000, tax: 2000, gross: 12000 });
    const r = run([vat20inc], [line("a", 10000)]);
    expect(r.lines[0]).toMatchObject({ net: 8333, gross: 10000 });
    expect(r.totals.tax).toBe(1667);
  });

  it("US 8.875% with banker's rounding", () => {
    const us = group("ny", [{ id: "nyc", name: "NYC", ratePpm: 88750 }]);
    expect(run([us], [line("a", 10000)]).totals.tax).toBe(888); // 887.5 -> even
    expect(run([us], [line("a", 9999)]).totals.tax).toBe(887);
    expect(run([us], [line("a", 1000)]).totals.tax).toBe(89);
  });

  it("Canada GST + PST non-compound", () => {
    const r = run([ca], [line("a", 10000)]);
    expect(r.lines[0]!.taxes.map((t) => t.amount)).toEqual([500, 700]);
    expect(r.totals.gross).toBe(11200);
  });

  it("Quebec compound", () => {
    const r = run([qc], [line("a", 10000)]);
    expect(r.lines[0]!.taxes.map((t) => t.amount)).toEqual([500, 1047]); // 9.975% of 10500
    expect(r.totals).toEqual({ net: 10000, tax: 1547, gross: 11547 });
    expect(r.breakdown.qst).toMatchObject({ taxable: 10500, tax: 1047 });
    expect(r.breakdown.gst).toMatchObject({ taxable: 10000, tax: 500 });
  });

  it("exempt line via class mapping", () => {
    const exempt = group("exempt", []);
    const r = run([vat20, exempt], [line("a", 10000), line("b", 5000, "food")], {}, { food: "exempt" });
    expect(r.lines[1]).toMatchObject({ net: 5000, taxes: [], gross: 5000 });
    expect(r.totals).toEqual({ net: 15000, tax: 2000, gross: 17000 });
  });

  it("zero-rated group is reported with zero tax", () => {
    const zero = group("zero", [{ id: "vat0", name: "VAT 0%", ratePpm: 0 }]);
    const r = run([vat20, zero], [line("a", 10000, "book")], {}, { book: "zero" });
    expect(r.totals).toEqual({ net: 10000, tax: 0, gross: 10000 });
    expect(r.breakdown.vat0).toMatchObject({ taxable: 10000, tax: 0 });
    expect(taxInvoiceSummary(r).exemptNet).toBe(0);
  });

  it("certificate exemption removes a rate", () => {
    const r = run([ca], [line("a", 10000)], { exemptions: { taxRateIds: ["pst"], certificate: "CERT-1" } });
    expect(r.lines[0]!.taxes.map((t) => t.rateId)).toEqual(["gst"]);
    expect(r.totals.tax).toBe(500);
    expect(r.exemptionCertificate).toBe("CERT-1");
    expect(r.breakdown.pst).toBeUndefined();
  });

  it("certificate alone exempts everything; inclusive price drops to net", () => {
    expect(run([ca], [line("a", 10000)], { exemptions: { certificate: "C" } }).totals).toEqual({ net: 10000, tax: 0, gross: 10000 });
    expect(run([vat20inc], [line("a", 12000)], { exemptions: { certificate: "C" } }).totals).toEqual({ net: 10000, tax: 0, gross: 10000 });
  });

  it("exempt exclusive rate leaves the compound base alone", () => {
    const r = run([qc], [line("a", 10000)], { exemptions: { taxRateIds: ["gst"] } });
    expect(r.totals.tax).toBe(998); // 9.975% of 10000, GST not in base
  });

  it("line vs invoice rounding with many small lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => line(`l${i}`, 33));
    const g = group("t", [{ id: "t10", name: "T", ratePpm: 100000 }]);
    const perLine = run([g], lines);
    expect(perLine.totals.tax).toBe(300);
    const inv = run([g], lines, { rounding: "invoice" });
    expect(inv.totals.tax).toBe(330);
    const sum = inv.lines.reduce((s, l) => s + l.taxes[0]!.amount, 0);
    expect(sum).toBe(inv.totals.tax);
    expect(inv.lines.every((l) => l.taxes[0]!.amount === 3 || l.taxes[0]!.amount === 4)).toBe(true);
    expect(inv.lines.reduce((s, l) => s + l.gross, 0)).toBe(inv.totals.gross);
    expect(inv.totals.gross).toBe(3300 + 330);
  });

  it("invoice rounding ties go to the earliest line and totals use half-even", () => {
    const g = group("t", [{ id: "t10", name: "T", ratePpm: 100000 }]);
    const r = run([g], [line("a", 5), line("b", 5), line("c", 5)], { rounding: "invoice" });
    expect(r.lines.map((l) => l.taxes[0]!.amount)).toEqual([1, 1, 0]);
    expect(r.totals.tax).toBe(2); // 1.5 -> even
    expect(run([g], [line("a", 5), line("b", 5), line("c", 5)]).totals.tax).toBe(0);
  });

  it("invoice rounding with inclusive tax keeps lines exact", () => {
    const lines = Array.from({ length: 37 }, (_, i) => line(`l${i}`, 99 + i));
    const r = run([vat20inc], lines, { rounding: "invoice" });
    for (const l of r.lines) expect(l.net + l.taxes[0]!.amount).toBe(l.gross);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    expect(r.totals.gross).toBe(amount);
    expect(r.totals.net + r.totals.tax).toBe(amount);
    expect(r.totals.tax).toBe(Math.round((amount * 0.2) / 1.2));
    expect(r.lines.reduce((s, l) => s + l.net, 0)).toBe(r.totals.net);
  });

  it("invoice rounding across mixed groups and a negative refund line", () => {
    const g5 = group("g5", [{ id: "r5", name: "R5", ratePpm: 50000 }]);
    const r = run([vat20, g5], [line("a", 333), line("b", 777, "low"), line("c", -250), line("d", 101, "low")], { rounding: "invoice" }, { low: "g5" });
    expect(r.lines.reduce((s, l) => s + l.net, 0)).toBe(r.totals.net);
    expect(r.lines.reduce((s, l) => s + l.taxes.reduce((x, t) => x + t.amount, 0), 0)).toBe(r.totals.tax);
    expect(r.breakdown.vat20!.tax + r.breakdown.r5!.tax).toBe(r.totals.tax);
    expect(r.breakdown.vat20!.tax).toBe(Math.round((333 - 250) * 0.2));
  });

  it("rejects bad input", () => {
    expect(() => run([vat20], [line("a", 1), line("a", 2)])).toThrow(/duplicate/);
    expect(() => run([vat20], [line("a", 1.5)])).toThrow(RangeError);
    expect(() => run([vat20], [line("a", 1, "x")], {}, { x: "nope" })).toThrow(/unknown tax group/);
    expect(() => run([group("bad", [{ id: "x", name: "x", ratePpm: -1 }])], [line("a", 1)])).toThrow(RangeError);
  });
});

describe("applyFees", () => {
  const card: Fee = { id: "card", name: "Card surcharge", kind: "percent", ppm: 30000, taxable: false, appliesTo: "tender", tenderMethods: ["card"] };
  const delivery: Fee = { id: "del", name: "Delivery", kind: "fixed", amount: 500, taxable: true, appliesTo: "order" };

  it("card surcharge only for card tender", () => {
    expect(applyFees({ subtotal: 10000, fees: [card], tenderMethod: "card" })).toMatchObject({ total: 300, tax: 0, gross: 300 });
    expect(applyFees({ subtotal: 10000, fees: [card], tenderMethod: "cash" }).fees).toEqual([]);
    expect(applyFees({ subtotal: 10000, fees: [card] }).total).toBe(0);
  });

  it("taxable fee carries tax", () => {
    const r = applyFees({ subtotal: 10000, fees: [delivery, card], tenderMethod: "card", taxGroupForFees: vat20 });
    expect(r.fees[0]).toMatchObject({ id: "del", amount: 500, tax: 100, gross: 600 });
    expect(r.fees[1]).toMatchObject({ id: "card", amount: 300, tax: 0, gross: 300 });
    expect(r).toMatchObject({ total: 800, tax: 100, gross: 900 });
  });

  it("taxable fee without a group is untaxed; exemptions apply; percent rounds half-even", () => {
    expect(applyFees({ subtotal: 10000, fees: [delivery] }).tax).toBe(0);
    expect(applyFees({ subtotal: 10000, fees: [delivery], taxGroupForFees: vat20, exemptions: { certificate: "C" } }).tax).toBe(0);
    const half: Fee = { id: "h", name: "h", kind: "percent", ppm: 5000, taxable: false, appliesTo: "order" };
    expect(applyFees({ subtotal: 100, fees: [half] }).total).toBe(0); // 0.5 -> 0
    expect(applyFees({ subtotal: 300, fees: [half] }).total).toBe(2); // 1.5 -> 2
  });

  it("rejects negative fixed fees", () => {
    expect(() => applyFees({ subtotal: 1, fees: [{ ...delivery, amount: -1 }] })).toThrow(RangeError);
  });
});

describe("taxInvoiceSummary", () => {
  it("lists rates, exempt net, totals", () => {
    const exempt = group("exempt", []);
    const r = run([qc, exempt], [line("a", 10000), line("b", 2000, "food")], { exemptions: undefined }, { food: "exempt" });
    const s = taxInvoiceSummary(r);
    expect(s.rows).toEqual([
      { rateId: "qst", name: "QST", ratePpm: 99750, inclusive: false, taxable: 10500, tax: 1047 },
      { rateId: "gst", name: "GST", ratePpm: 50000, inclusive: false, taxable: 10000, tax: 500 },
    ]);
    expect(s.exemptNet).toBe(2000);
    expect(s.totals).toEqual({ net: 12000, tax: 1547, gross: 13547 });
  });
});
