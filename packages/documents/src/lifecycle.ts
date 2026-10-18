import { applyCreditNote, balanceMinor, computeTotals, creditNoteFor, paymentTerms, remainingCreditable } from "./totals";
import type { CreditNote, Disposition, DocLine, Invoice, Quotation, ReturnDoc } from "./types";

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}
const illegal = (what: string, from: string, ev: string): never => {
  throw new IllegalTransitionError(`${what}: cannot ${ev} from ${from}`);
};

export type QuotationEvent = { type: "send" } | { type: "accept" } | { type: "reject" } | { type: "expire" } | { type: "convert" };

/**
 * draft -> sent -> accepted | rejected | expired; accepted -> converted.
 * accept needs now <= validUntil; expire needs now > validUntil (so a live quote cannot be expired early).
 * `convert` here only flips status; use convertQuotation to also build the invoice.
 */
export function transitionQuotation(q: Quotation, ev: QuotationEvent, now: Date): Quotation {
  const past = now.getTime() > Date.parse(q.validUntil);
  switch (ev.type) {
    case "send":
      if (q.status === "draft") return { ...q, status: "sent" };
      return illegal("quotation", q.status, ev.type);
    case "accept":
      if (q.status !== "sent") return illegal("quotation", q.status, ev.type);
      if (past) throw new IllegalTransitionError("quotation: validity period has passed");
      return { ...q, status: "accepted" };
    case "reject":
      if (q.status === "sent") return { ...q, status: "rejected" };
      return illegal("quotation", q.status, ev.type);
    case "expire":
      if (q.status !== "sent") return illegal("quotation", q.status, ev.type);
      if (!past) throw new IllegalTransitionError("quotation: still within validity period");
      return { ...q, status: "expired" };
    case "convert":
      if (q.status === "accepted") return { ...q, status: "converted" };
      return illegal("quotation", q.status, ev.type);
  }
}

export type InvoiceEvent =
  | { type: "issue" }
  | { type: "pay"; amountMinor: number }
  | { type: "mark_overdue" }
  | { type: "void" };

/**
 * draft -> issued -> partially_paid -> paid; issued/partially_paid -> overdue once past dueDate.
 * void only from issued/overdue with zero payments. Payments may not exceed the balance. Overdue stays overdue
 * until fully paid. Issued content is immutable: use amendInvoice.
 */
export function transitionInvoice(inv: Invoice, ev: InvoiceEvent, now: Date): Invoice {
  switch (ev.type) {
    case "issue": {
      if (inv.status !== "draft") return illegal("invoice", inv.status, ev.type);
      if (inv.lines.length === 0) throw new IllegalTransitionError("invoice: cannot issue without lines");
      computeTotals(inv.lines);
      return { ...inv, status: "issued", issueDate: now.toISOString(), dueDate: paymentTerms(now, inv.terms).toISOString() };
    }
    case "pay": {
      if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "overdue") return illegal("invoice", inv.status, ev.type);
      if (!Number.isSafeInteger(ev.amountMinor) || ev.amountMinor <= 0) throw new IllegalTransitionError("invoice: payment must be a positive integer");
      const bal = balanceMinor(inv);
      if (ev.amountMinor > bal) throw new IllegalTransitionError("invoice: payment exceeds balance");
      const paidMinor = inv.paidMinor + ev.amountMinor;
      const left = bal - ev.amountMinor;
      const status = left === 0 ? "paid" : inv.status === "overdue" ? "overdue" : "partially_paid";
      return { ...inv, status, paidMinor, payments: [...inv.payments, { amountMinor: ev.amountMinor, at: now.toISOString() }] };
    }
    case "mark_overdue": {
      if (inv.status !== "issued" && inv.status !== "partially_paid") return illegal("invoice", inv.status, ev.type);
      if (!inv.dueDate || now.getTime() <= Date.parse(inv.dueDate)) throw new IllegalTransitionError("invoice: not yet past due date");
      if (balanceMinor(inv) === 0) throw new IllegalTransitionError("invoice: nothing outstanding");
      return { ...inv, status: "overdue" };
    }
    case "void": {
      if (inv.status !== "issued" && inv.status !== "overdue") return illegal("invoice", inv.status, ev.type);
      if (inv.paidMinor > 0 || inv.payments.length > 0) throw new IllegalTransitionError("invoice: cannot void with payments; issue a credit note");
      if (inv.creditedMinor > 0) throw new IllegalTransitionError("invoice: cannot void after credit notes");
      return { ...inv, status: "voided" };
    }
  }
}

export interface AmendMeta { now: Date; creditNoteId: string; replacementId: string; reason?: string }

/**
 * Issued invoices are immutable. An edit credits whatever is still creditable on the original (credit note)
 * and creates a new draft invoice with the corrected lines. Caller persists both and applies
 * applyCreditNote(original, creditNote).
 */
export function amendInvoice(inv: Invoice, newLines: readonly DocLine[], meta: AmendMeta): { creditNote: CreditNote; replacement: Invoice } {
  if (inv.status === "draft") throw new IllegalTransitionError("invoice: drafts are edited directly");
  if (inv.status === "voided") throw new IllegalTransitionError("invoice: voided invoices cannot be amended");
  if (newLines.length === 0) throw new Error("replacement needs at least one line");
  computeTotals(newLines);
  const left = remainingCreditable(inv);
  const lines = left.map((q, lineIndex) => ({ lineIndex, quantity: q })).filter((l) => l.quantity > 0);
  const creditNote = creditNoteFor(inv, lines, {
    id: meta.creditNoteId, issuedAt: meta.now, reason: meta.reason ?? "invoice amended",
  });
  const replacement: Invoice = {
    kind: "invoice", id: meta.replacementId, status: "draft", currency: inv.currency,
    ...(inv.customerId ? { customerId: inv.customerId } : {}),
    lines: newLines.map((l) => ({ ...l })), terms: inv.terms, payments: [], paidMinor: 0, creditedMinor: 0,
    creditedQty: newLines.map(() => 0), replaces: inv.id,
  };
  return { creditNote, replacement };
}

export { applyCreditNote };

export type ReturnEvent =
  | { type: "approve" }
  | { type: "receive"; dispositions: { lineIndex: number; disposition: Disposition }[] }
  | { type: "refund" }
  | { type: "exchange" }
  | { type: "reject" };

/**
 * requested -> approved -> received -> refunded | exchanged; reject from requested/approved.
 * receive requires exactly one disposition (restock or write_off) for every line.
 */
export function transitionReturn(r: ReturnDoc, ev: ReturnEvent): ReturnDoc {
  switch (ev.type) {
    case "approve":
      if (r.status === "requested") return { ...r, status: "approved" };
      return illegal("return", r.status, ev.type);
    case "reject":
      if (r.status === "requested" || r.status === "approved") return { ...r, status: "rejected" };
      return illegal("return", r.status, ev.type);
    case "receive": {
      if (r.status !== "approved") return illegal("return", r.status, ev.type);
      const map = new Map<number, Disposition>();
      for (const d of ev.dispositions) {
        if (!r.lines[d.lineIndex]) throw new IllegalTransitionError(`return: unknown line ${d.lineIndex}`);
        if (map.has(d.lineIndex)) throw new IllegalTransitionError(`return: duplicate disposition for line ${d.lineIndex}`);
        map.set(d.lineIndex, d.disposition);
      }
      if (map.size !== r.lines.length) throw new IllegalTransitionError("return: every line needs a disposition");
      return { ...r, status: "received", lines: r.lines.map((l, i) => ({ ...l, disposition: map.get(i)! })) };
    }
    case "refund":
    case "exchange":
      if (r.status === "received") return { ...r, status: ev.type === "refund" ? "refunded" : "exchanged" };
      return illegal("return", r.status, ev.type);
  }
}

/** Inventory effect per received line: restock adds to sellable stock, write_off records a loss. */
export function returnInventoryEffects(r: ReturnDoc): { lineIndex: number; quantity: number; restock: boolean }[] {
  return r.lines.flatMap((l, lineIndex) =>
    l.disposition ? [{ lineIndex, quantity: l.quantity, restock: l.disposition === "restock" }] : []);
}

const EVENTS: Record<AnyDoc["kind"], readonly string[]> = {
  quotation: ["send", "accept", "reject", "expire", "convert"],
  invoice: ["issue", "pay", "mark_overdue", "void"],
  return: ["approve", "receive", "refund", "exchange", "reject"],
};

export type AnyDoc = Quotation | Invoice | ReturnDoc;
export type AnyEvent = QuotationEvent | InvoiceEvent | ReturnEvent;

/** Generic entry point: dispatches on doc.kind; an event that does not belong to that kind is illegal. */
export function transition(doc: Quotation, event: QuotationEvent, now: Date): Quotation;
export function transition(doc: Invoice, event: InvoiceEvent, now: Date): Invoice;
export function transition(doc: ReturnDoc, event: ReturnEvent, now: Date): ReturnDoc;
export function transition(doc: AnyDoc, event: AnyEvent, now: Date): AnyDoc {
  if (!EVENTS[doc.kind].includes(event.type)) return illegal(doc.kind, "any state", event.type);
  switch (doc.kind) {
    case "quotation": return transitionQuotation(doc, event as QuotationEvent, now);
    case "invoice": return transitionInvoice(doc, event as InvoiceEvent, now);
    case "return": return transitionReturn(doc, event as ReturnEvent);
  }
}
