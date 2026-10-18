import { describe, expect, it } from "vitest";
import {
  agingBuckets, amendInvoice, applyCreditNote, balanceMinor, computeTotals, convertQuotation, creditNoteFor, formatNumber,
  nextSequenceKey, paymentTerms, renderHtml, renderReceiptText, returnInventoryEffects, transition, validateScheme,
} from "./index";
import type { DocLine, DocumentTemplate, Invoice, NumberingScheme, Quotation, RenderableDocument, ReturnDoc } from "./index";

const d = (s: string) => new Date(s);
const line = (o: Partial<DocLine> = {}): DocLine => ({ description: "Widget", quantity: 2, unitPrice: 1000, taxPpm: 100_000, ...o });

describe("numbering", () => {
  const s: NumberingScheme = { docType: "invoice", pattern: "{PREFIX}-{STORE}-{YY}{MM}-{SEQ:6}", prefix: "INV", resetEvery: "month" };
  const ctx = { storeCode: "S01", deviceCode: "D2", date: d("2026-03-15T10:00:00Z") };
  it("formats tokens", () => {
    expect(formatNumber(s, { ...ctx, seq: 42 })).toBe("INV-S01-2603-000042");
    expect(formatNumber({ ...s, pattern: "{DEVICE}/{YYYY}/{SEQ}", resetEvery: "year" }, { ...ctx, seq: 7 })).toBe("D2/2026/000007");
    expect(formatNumber(s, { ...ctx, seq: 1234567 })).toBe("INV-S01-2603-1234567");
  });
  it("period reset keys", () => {
    const k = nextSequenceKey(s, ctx);
    expect(k).toBe("invoice:INV:store=S01:2026-03");
    expect(nextSequenceKey(s, { ...ctx, date: d("2026-04-01T00:00:00Z") })).not.toBe(k);
    expect(nextSequenceKey(s, { ...ctx, deviceCode: "D9" })).toBe(k);
    expect(nextSequenceKey({ ...s, resetEvery: "year" }, { ...ctx, date: d("2026-12-31T00:00:00Z") })).toBe("invoice:INV:store=S01:2026");
    expect(nextSequenceKey({ ...s, pattern: "{PREFIX}{SEQ}", resetEvery: "never" }, ctx)).toBe("invoice:INV:all");
  });
  it("validates", () => {
    expect(validateScheme({ ...s, pattern: "{PREFIX}-000" })[0]).toMatch(/SEQ/);
    expect(validateScheme({ ...s, pattern: "{SEQ}{FOO}" }).join()).toMatch(/unknown token/);
    expect(validateScheme({ ...s, pattern: "{SEQ:6}", resetEvery: "year" }).join()).toMatch(/yearly/);
    expect(validateScheme({ ...s, pattern: "<b>{SEQ}" }).join()).toMatch(/literals/);
    expect(validateScheme(s)).toEqual([]);
    expect(() => formatNumber({ ...s, pattern: "X" }, { ...ctx, seq: 1 })).toThrow();
  });
});

describe("totals", () => {
  it("banker's rounding", () => {
    // 2.5 -> 2, 3.5 -> 4 (net 25 at 10% tax = 2.5)
    expect(computeTotals([line({ quantity: 1, unitPrice: 25, taxPpm: 100_000 })]).taxMinor).toBe(2);
    expect(computeTotals([line({ quantity: 1, unitPrice: 35, taxPpm: 100_000 })]).taxMinor).toBe(4);
  });
  it("discount, fractional qty, breakdown", () => {
    const t = computeTotals([line({ quantity: 1.5, unitPrice: 1001, discountPpm: 100_000 }), line({ taxPpm: 0, unitPrice: 500, quantity: 1 })]);
    expect(t.lines[0]).toEqual({ grossMinor: 1502, discountMinor: 150, netMinor: 1352, taxMinor: 135, totalMinor: 1487 });
    expect(t.totalMinor).toBe(1487 + 500);
    expect(t.taxBreakdown.map((r) => r.taxPpm)).toEqual([0, 100_000]);
  });
  it("rejects bad input", () => {
    expect(() => computeTotals([line({ unitPrice: 1.5 })])).toThrow();
    expect(() => computeTotals([line({ quantity: 0 })])).toThrow();
  });
});

describe("quotation lifecycle", () => {
  const q: Quotation = { kind: "quotation", id: "q1", status: "draft", currency: "USD", lines: [line()], issuedAt: "2026-01-01T00:00:00Z", validUntil: "2026-01-31T00:00:00Z" };
  it("happy path and conversion", () => {
    let x = transition(q, { type: "send" }, d("2026-01-02T00:00:00Z"));
    x = transition(x, { type: "accept" }, d("2026-01-10T00:00:00Z"));
    const r = convertQuotation(x, d("2026-01-11T00:00:00Z"), { invoiceId: "i1", terms: "net_30" });
    expect(r.quotation.status).toBe("converted");
    expect(r.invoice).toMatchObject({ status: "draft", quotationId: "q1", terms: "net_30", lines: [line()] });
    expect(() => transition(r.quotation, { type: "send" }, d("2026-01-11T00:00:00Z"))).toThrow(/cannot send/);
  });
  it("illegal moves, expiry", () => {
    expect(() => transition(q, { type: "accept" }, d("2026-01-02T00:00:00Z"))).toThrow(/cannot accept/);
    expect(() => transition(q, { type: "pay", amountMinor: 1 } as never, d("2026-01-02T00:00:00Z"))).toThrow(/cannot pay/);
    const sent = transition(q, { type: "send" }, d("2026-01-02T00:00:00Z"));
    expect(() => transition(sent, { type: "accept" }, d("2026-02-01T00:00:00Z"))).toThrow(/validity/);
    expect(() => transition(sent, { type: "expire" }, d("2026-01-20T00:00:00Z"))).toThrow(/still within/);
    const expired = transition(sent, { type: "expire" }, d("2026-02-01T00:00:00Z"));
    expect(expired.status).toBe("expired");
    expect(() => convertQuotation(expired, d("2026-02-02T00:00:00Z"), { invoiceId: "i" })).toThrow(/expired/);
    expect(() => convertQuotation({ ...sent, status: "accepted" }, d("2026-03-01T00:00:00Z"), { invoiceId: "i" })).toThrow(/expired/);
    expect(() => convertQuotation(sent, d("2026-01-03T00:00:00Z"), { invoiceId: "i" })).toThrow(/accepted/);
  });
});

describe("invoice lifecycle", () => {
  const draft: Invoice = {
    kind: "invoice", id: "i1", status: "draft", currency: "USD", lines: [line(), line({ description: "B", unitPrice: 500, quantity: 4 })],
    terms: "net_15", payments: [], paidMinor: 0, creditedMinor: 0, creditedQty: [0, 0],
  };
  const total = computeTotals(draft.lines).totalMinor; // (2000+2000)*1.1 = 4400
  const issued = () => transition(draft, { type: "issue" }, d("2026-01-01T12:00:00Z"));
  it("issue sets due date; payments; overdue", () => {
    expect(total).toBe(4400);
    const i = issued();
    expect(i.dueDate).toBe("2026-01-16T00:00:00.000Z");
    const p = transition(i, { type: "pay", amountMinor: 1000 }, d("2026-01-05T00:00:00Z"));
    expect(p.status).toBe("partially_paid");
    expect(() => transition(p, { type: "pay", amountMinor: 3401 }, d("2026-01-06T00:00:00Z"))).toThrow(/exceeds/);
    expect(() => transition(p, { type: "mark_overdue" }, d("2026-01-16T00:00:00Z"))).toThrow(/not yet/);
    const o = transition(p, { type: "mark_overdue" }, d("2026-01-17T00:00:00Z"));
    expect(o.status).toBe("overdue");
    const part = transition(o, { type: "pay", amountMinor: 400 }, d("2026-01-18T00:00:00Z"));
    expect(part.status).toBe("overdue");
    expect(transition(part, { type: "pay", amountMinor: 3000 }, d("2026-01-19T00:00:00Z")).status).toBe("paid");
  });
  it("void blocked after payment, allowed otherwise", () => {
    const p = transition(issued(), { type: "pay", amountMinor: 100 }, d("2026-01-02T00:00:00Z"));
    expect(() => transition(p, { type: "void" }, d("2026-01-03T00:00:00Z"))).toThrow();
    expect(transition(issued(), { type: "void" }, d("2026-01-03T00:00:00Z")).status).toBe("voided");
    expect(() => transition(draft, { type: "void" }, d("2026-01-03T00:00:00Z"))).toThrow(/cannot void/);
  });
  it("amend produces credit note and replacement, original untouched", () => {
    const i = issued();
    const { creditNote, replacement } = amendInvoice(i, [line({ quantity: 3 })], { now: d("2026-01-03T00:00:00Z"), creditNoteId: "cn1", replacementId: "i2" });
    expect(creditNote.totals.totalMinor).toBe(total);
    expect(creditNote.invoiceId).toBe("i1");
    expect(replacement).toMatchObject({ status: "draft", replaces: "i1" });
    expect(computeTotals(replacement.lines).totalMinor).toBe(3300);
    expect(i.lines).toEqual(draft.lines);
    const after = applyCreditNote(i, creditNote);
    expect(balanceMinor(after)).toBe(0);
    expect(() => amendInvoice(after, [line()], { now: d("2026-01-04T00:00:00Z"), creditNoteId: "cn2", replacementId: "i3" })).toThrow();
    expect(() => amendInvoice(draft, [line()], { now: d("2026-01-04T00:00:00Z"), creditNoteId: "c", replacementId: "r" })).toThrow(/drafts/);
  });
  it("credit note over-credit rejected", () => {
    const i = issued();
    const cn = creditNoteFor(i, [{ lineIndex: 0, quantity: 1 }], { id: "c1", issuedAt: d("2026-01-02T00:00:00Z") });
    expect(cn.totals.totalMinor).toBe(1100);
    const i2 = applyCreditNote(i, cn);
    expect(() => creditNoteFor(i2, [{ lineIndex: 0, quantity: 1.5 }], { id: "c2", issuedAt: d("2026-01-03T00:00:00Z") })).toThrow(/over-credited/);
    expect(() => creditNoteFor(i2, [{ lineIndex: 9, quantity: 1 }], { id: "c2", issuedAt: d("2026-01-03T00:00:00Z") })).toThrow(/unknown/);
    expect(() => creditNoteFor(draft, [{ lineIndex: 0, quantity: 1 }], { id: "c", issuedAt: d("2026-01-03T00:00:00Z") })).toThrow(/draft/);
    expect(creditNoteFor(i2, [{ lineIndex: 0, quantity: 1 }], { id: "c3", issuedAt: d("2026-01-03T00:00:00Z") }).totals.totalMinor).toBe(1100);
  });
});

describe("return flow", () => {
  const r: ReturnDoc = { kind: "return", id: "r1", status: "requested", currency: "USD", lines: [line(), line({ description: "B" })] };
  it("restock vs write-off per line", () => {
    const a = transition(r, { type: "approve" }, d("2026-01-01T00:00:00Z"));
    expect(() => transition(a, { type: "receive", dispositions: [{ lineIndex: 0, disposition: "restock" }] }, d("2026-01-01T00:00:00Z"))).toThrow(/every line/);
    const rec = transition(a, { type: "receive", dispositions: [{ lineIndex: 0, disposition: "restock" }, { lineIndex: 1, disposition: "write_off" }] }, d("2026-01-02T00:00:00Z"));
    expect(returnInventoryEffects(rec).map((e) => e.restock)).toEqual([true, false]);
    expect(transition(rec, { type: "refund" }, d("2026-01-03T00:00:00Z")).status).toBe("refunded");
    expect(transition(rec, { type: "exchange" }, d("2026-01-03T00:00:00Z")).status).toBe("exchanged");
  });
  it("illegal and reject", () => {
    expect(() => transition(r, { type: "refund" }, d("2026-01-01T00:00:00Z"))).toThrow();
    expect(transition(r, { type: "reject" }, d("2026-01-01T00:00:00Z")).status).toBe("rejected");
    const rej = transition(r, { type: "reject" }, d("2026-01-01T00:00:00Z"));
    expect(() => transition(rej, { type: "approve" }, d("2026-01-01T00:00:00Z"))).toThrow();
  });
});

describe("terms and aging", () => {
  it("payment terms", () => {
    const issue = d("2026-02-10T15:30:00Z");
    expect(paymentTerms(issue, "due_on_receipt").toISOString()).toBe("2026-02-10T00:00:00.000Z");
    expect(paymentTerms(issue, "net_15").toISOString()).toBe("2026-02-25T00:00:00.000Z");
    expect(paymentTerms(issue, "net_30").toISOString()).toBe("2026-03-12T00:00:00.000Z");
    expect(paymentTerms(issue, "eom").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(paymentTerms(d("2028-02-10T00:00:00Z"), "eom").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(paymentTerms(d("2026-12-31T00:00:00Z"), "eom").toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
  it("aging buckets", () => {
    const mk = (id: string, due: string, status: Invoice["status"] = "issued", paid = 0): Invoice => ({
      kind: "invoice", id, status, currency: "USD", lines: [line({ taxPpm: 0, quantity: 1, unitPrice: 1000 })], terms: "net_30",
      dueDate: due, payments: [], paidMinor: paid, creditedMinor: 0, creditedQty: [0],
    });
    const now = d("2026-06-30T12:00:00Z");
    const r = agingBuckets([
      mk("a", "2026-07-10T00:00:00Z"), mk("b", "2026-06-30T00:00:00Z"), mk("c", "2026-06-29T00:00:00Z"),
      mk("d", "2026-05-30T00:00:00Z", "overdue"), mk("e", "2026-04-30T00:00:00Z", "overdue", 400),
      mk("f", "2026-03-31T00:00:00Z", "overdue"), mk("g", "2025-01-01T00:00:00Z", "paid", 1000), mk("h", "2025-01-01T00:00:00Z", "voided"),
    ], now);
    expect(r.current).toEqual({ count: 2, amountMinor: 2000 });
    expect(r["1-30"]).toEqual({ count: 1, amountMinor: 1000 });
    expect(r["31-60"]).toEqual({ count: 1, amountMinor: 1000 });
    expect(r["61-90"]).toEqual({ count: 1, amountMinor: 600 });
    expect(r["90+"]).toEqual({ count: 1, amountMinor: 1000 });
    expect(r.totalMinor).toBe(5600);
  });
});

describe("layout", () => {
  const tpl: DocumentTemplate = {
    id: "t", docType: "receipt", paper: "80mm",
    header: [{ kind: "text", value: "Luxury Boutique with a very long shop name that needs wrapping", align: "center" }, { kind: "taxId", value: "TX-123", align: "center" }, { kind: "divider", align: "left" }],
    footer: [{ kind: "text", value: "Thank you!", align: "center" }],
    showQrFor: "receipt_lookup", notes: "Returns within 14 days.",
    fields: { showTaxBreakdown: true, showSku: true, showSerial: true, showCashier: true, showLoyalty: true },
  };
  const doc: RenderableDocument = {
    docType: "receipt", number: "R-000001", issuedAt: "2026-01-01 10:00", currency: "USD", cashier: "Ana", paidMinor: 20000,
    lookupUrl: "https://example.com/r/abcdefghijklmnopqrstuvwxyz0123456789", loyalty: { earned: 12, balance: 340 },
    lines: [
      line({ description: "Supercalifragilisticexpialidocious_extraordinarily_long_name", sku: "SKU-VERY-LONG-0001", serial: "SN123456789012345678", unitPrice: 123456, discountPpm: 50_000 }),
      line({ description: "Silk scarf", quantity: 1.5, uom: "m", unitPrice: 999 }),
    ],
  };
  it("never exceeds width", () => {
    for (const w of [58 / 2 + 3, 32, 42, 48, 16]) {
      const txt = renderReceiptText(doc, tpl, w);
      for (const l of txt.split("\n")) expect(l.length).toBeLessThanOrEqual(w);
    }
    const txt = renderReceiptText(doc, tpl, 42);
    expect(txt).toContain("TOTAL USD");
    expect(txt).toContain("Tax ID: TX-123");
    expect(txt).toContain("https://example.com/r/abcdefghijklmnopqrst");
    const total = computeTotals(doc.lines).totalMinor;
    const totalLine = txt.split("\n").find((l) => l.startsWith("TOTAL"))!;
    expect(totalLine.length).toBe(42);
    expect(totalLine.endsWith(`${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`)).toBe(true);
  });
  it("strips control characters", () => {
    const txt = renderReceiptText({ ...doc, customerName: "A\u001b[0mB\tC" }, tpl, 42);
    expect(txt).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });
  it("html escapes user text and sanitises style inputs", () => {
    const evil = "<script>alert(1)</script>";
    const html = renderHtml(
      { ...doc, docType: "invoice", customerName: evil, lines: [line({ description: evil, sku: '"><img onerror=x>' })] },
      { ...tpl, paper: "A4", letterhead: { imageUrl: "https://x.test/lh.png", position: "background", heightMm: 40 }, notes: evil,
        header: [{ kind: "text", value: evil, align: "left" }, { kind: "logo", value: "javascript:alert(1)", align: "left" }] },
      { name: evil, primaryColor: "red;}</style><script>x</script>", fontFamily: "Inter</style><script>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('src="https://x.test/lh.png"');
    expect(html).toContain("@page{size:A4");
    expect(html).toContain("#111111");
  });
});
