import type {
  CreditNote, DocLine, DocTotals, Invoice, LineAmounts, PaymentTerms, Quotation, TaxBreakdownRow,
} from "./types";

const PPM = 1_000_000n;

/** Round-half-to-even division of integers (d > 0), exact for any magnitude via BigInt. */
export function divHalfEven(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const a = n * sign;
  let q = a / d;
  const twice = 2n * (a % d);
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return q * sign;
}

/**
 * gross = round(unitPrice * qty); discount = round(gross * discountPpm); net = gross - discount; tax = round(net * taxPpm).
 * All rounding is banker's rounding; document tax is the sum of per-line rounded tax so lines always add up to totals.
 */
export function lineAmounts(line: DocLine): LineAmounts {
  if (!Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) throw new Error("unitPrice must be a non-negative integer");
  const milli = Math.round(line.quantity * 1000);
  if (!(line.quantity > 0) || Math.abs(line.quantity * 1000 - milli) > 1e-6) throw new Error("quantity must be > 0 with at most 3 decimals");
  const disc = line.discountPpm ?? 0;
  if (!Number.isInteger(disc) || disc < 0 || disc > 1_000_000) throw new Error("discountPpm must be an integer 0..1000000");
  if (!Number.isInteger(line.taxPpm) || line.taxPpm < 0) throw new Error("taxPpm must be a non-negative integer");
  const gross = divHalfEven(BigInt(line.unitPrice) * BigInt(milli), 1000n);
  const discount = divHalfEven(gross * BigInt(disc), PPM);
  const net = gross - discount;
  const tax = divHalfEven(net * BigInt(line.taxPpm), PPM);
  const out = {
    grossMinor: Number(gross), discountMinor: Number(discount), netMinor: Number(net), taxMinor: Number(tax), totalMinor: Number(net + tax),
  };
  for (const v of Object.values(out)) if (!Number.isSafeInteger(v)) throw new Error("amount exceeds safe integer range");
  return out;
}

export function computeTotals(lines: readonly DocLine[]): DocTotals {
  const amounts = lines.map(lineAmounts);
  const by = new Map<number, TaxBreakdownRow>();
  let subtotal = 0, discount = 0, tax = 0;
  lines.forEach((l, i) => {
    const a = amounts[i]!;
    subtotal += a.netMinor; discount += a.discountMinor; tax += a.taxMinor;
    const row = by.get(l.taxPpm) ?? { taxPpm: l.taxPpm, baseMinor: 0, taxMinor: 0 };
    row.baseMinor += a.netMinor; row.taxMinor += a.taxMinor;
    by.set(l.taxPpm, row);
  });
  return {
    lines: amounts, subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: subtotal + tax,
    taxBreakdown: [...by.values()].sort((a, b) => a.taxPpm - b.taxPpm),
  };
}

/** Outstanding amount: total - paid - credited, never negative. */
export function balanceMinor(inv: Invoice): number {
  return Math.max(0, computeTotals(inv.lines).totalMinor - inv.paidMinor - inv.creditedMinor);
}

export interface ConvertMeta { invoiceId: string; terms?: PaymentTerms }

/**
 * Quote -> draft invoice (lines copied). Only accepted quotes convert, and never past validUntil or when
 * status is "expired" (prices are only guaranteed inside the validity window).
 */
export function convertQuotation(quote: Quotation, now: Date, meta: ConvertMeta): { quotation: Quotation; invoice: Invoice } {
  if (quote.status === "expired" || now.getTime() > Date.parse(quote.validUntil)) throw new Error("quotation expired");
  if (quote.status !== "accepted") throw new Error(`quotation must be accepted to convert (is ${quote.status})`);
  const invoice: Invoice = {
    kind: "invoice", id: meta.invoiceId, status: "draft", currency: quote.currency,
    ...(quote.customerId ? { customerId: quote.customerId } : {}),
    lines: quote.lines.map((l) => ({ ...l })), terms: meta.terms ?? "due_on_receipt",
    payments: [], paidMinor: 0, creditedMinor: 0, creditedQty: quote.lines.map(() => 0), quotationId: quote.id,
  };
  return { quotation: { ...quote, status: "converted" }, invoice };
}

export interface CreditMeta { id: string; issuedAt: Date; reason?: string; number?: string }

export function remainingCreditable(inv: Invoice): number[] {
  return inv.lines.map((l, i) => Math.max(0, Math.round((l.quantity - (inv.creditedQty[i] ?? 0)) * 1000) / 1000));
}

/** Credit note for specific quantities. Rejects drafts/voided, unknown lines, and any quantity beyond what is still creditable. */
export function creditNoteFor(
  invoice: Invoice, lines: readonly { lineIndex: number; quantity: number }[], meta: CreditMeta,
): CreditNote {
  if (invoice.status === "draft" || invoice.status === "voided") throw new Error(`cannot credit a ${invoice.status} invoice`);
  if (lines.length === 0) throw new Error("credit note needs at least one line");
  const left = remainingCreditable(invoice);
  const requested = new Map<number, number>();
  for (const r of lines) {
    const src = invoice.lines[r.lineIndex];
    if (!src) throw new Error(`unknown invoice line ${r.lineIndex}`);
    if (!(r.quantity > 0)) throw new Error("credit quantity must be > 0");
    requested.set(r.lineIndex, (requested.get(r.lineIndex) ?? 0) + r.quantity);
  }
  const idx = [...requested.keys()].sort((a, b) => a - b);
  for (const i of idx) {
    if (requested.get(i)! > left[i]! + 1e-9) throw new Error(`line ${i} over-credited: ${requested.get(i)} > ${left[i]}`);
  }
  const cnLines = idx.map((i) => ({ ...invoice.lines[i]!, quantity: Math.round(requested.get(i)! * 1000) / 1000 }));
  const cn: CreditNote = {
    kind: "credit_note", id: meta.id, invoiceId: invoice.id, currency: invoice.currency, issuedAt: meta.issuedAt.toISOString(),
    lines: cnLines, sourceLineIndexes: idx, totals: computeTotals(cnLines),
  };
  if (meta.reason !== undefined) cn.reason = meta.reason;
  if (meta.number !== undefined) cn.number = meta.number;
  return cn;
}

/** Records a credit note on its invoice (creditedQty and creditedMinor). Pure; returns the updated invoice. */
export function applyCreditNote(invoice: Invoice, cn: CreditNote): Invoice {
  if (cn.invoiceId !== invoice.id) throw new Error("credit note belongs to another invoice");
  const creditedQty = [...invoice.creditedQty];
  cn.sourceLineIndexes.forEach((src, k) => {
    creditedQty[src] = Math.round(((creditedQty[src] ?? 0) + cn.lines[k]!.quantity) * 1000) / 1000;
  });
  return { ...invoice, creditedQty, creditedMinor: invoice.creditedMinor + cn.totals.totalMinor };
}

const DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Due date at UTC midnight. eom = last day of the issue month. */
export function paymentTerms(issueDate: Date, terms: PaymentTerms): Date {
  const base = utcDay(issueDate);
  switch (terms) {
    case "due_on_receipt": return new Date(base);
    case "net_15": return new Date(base + 15 * DAY);
    case "net_30": return new Date(base + 30 * DAY);
    case "eom": return new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth() + 1, 0));
  }
}

export interface AgingBucket { count: number; amountMinor: number }
export interface AgingReport {
  current: AgingBucket; "1-30": AgingBucket; "31-60": AgingBucket; "61-90": AgingBucket; "90+": AgingBucket; totalMinor: number;
}

/** Open invoices (issued, partially_paid, overdue) with a balance, bucketed by whole days past dueDate. Single currency only. */
export function agingBuckets(invoices: readonly Invoice[], now: Date): AgingReport {
  const rep: AgingReport = {
    current: { count: 0, amountMinor: 0 }, "1-30": { count: 0, amountMinor: 0 }, "31-60": { count: 0, amountMinor: 0 },
    "61-90": { count: 0, amountMinor: 0 }, "90+": { count: 0, amountMinor: 0 }, totalMinor: 0,
  };
  let currency: string | undefined;
  for (const inv of invoices) {
    if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "overdue") continue;
    const bal = balanceMinor(inv);
    if (bal <= 0) continue;
    if (currency !== undefined && currency !== inv.currency) throw new Error("agingBuckets requires a single currency");
    currency = inv.currency;
    const days = inv.dueDate ? Math.floor((utcDay(now) - utcDay(new Date(inv.dueDate))) / DAY) : 0;
    const key = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    rep[key].count += 1; rep[key].amountMinor += bal; rep.totalMinor += bal;
  }
  return rep;
}
