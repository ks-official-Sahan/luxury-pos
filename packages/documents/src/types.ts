/** Shared document model. Money is integer minor units; dates are ISO strings; ppm = parts per million (1_000_000 = 100%). */

export type DocType =
  | "quotation" | "sales_order" | "invoice" | "receipt" | "credit_note" | "return" | "purchase_order" | "delivery_note";

export interface DocLine {
  description: string;
  /** Up to 3 decimals (fractional weights/volumes). Must be > 0. */
  quantity: number;
  /** Integer minor units per unit, >= 0. */
  unitPrice: number;
  discountPpm?: number;
  taxPpm: number;
  uom?: string;
  sku?: string;
  serial?: string;
}

export interface LineAmounts { grossMinor: number; discountMinor: number; netMinor: number; taxMinor: number; totalMinor: number }

export interface TaxBreakdownRow { taxPpm: number; baseMinor: number; taxMinor: number }

export interface DocTotals {
  lines: LineAmounts[];
  /** Sum of line nets (after discount, before tax). */
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxBreakdown: TaxBreakdownRow[];
}

export type PaymentTerms = "net_30" | "net_15" | "due_on_receipt" | "eom";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";

export interface Quotation {
  kind: "quotation";
  id: string;
  number?: string;
  status: QuotationStatus;
  currency: string;
  customerId?: string;
  lines: DocLine[];
  issuedAt: string;
  validUntil: string;
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "voided";

export interface Payment { amountMinor: number; at: string }

export interface Invoice {
  kind: "invoice";
  id: string;
  number?: string;
  status: InvoiceStatus;
  currency: string;
  customerId?: string;
  lines: DocLine[];
  terms: PaymentTerms;
  issueDate?: string;
  dueDate?: string;
  payments: Payment[];
  paidMinor: number;
  /** Quantity credited so far per line index (parallel to `lines`). */
  creditedQty: number[];
  creditedMinor: number;
  replaces?: string;
  quotationId?: string;
}

export interface CreditNote {
  kind: "credit_note";
  id: string;
  number?: string;
  invoiceId: string;
  currency: string;
  issuedAt: string;
  reason?: string;
  /** Credited lines; `sourceLineIndexes[i]` is the invoice line index of `lines[i]`. */
  lines: DocLine[];
  sourceLineIndexes: number[];
  totals: DocTotals;
}

export type ReturnStatus = "requested" | "approved" | "received" | "refunded" | "exchanged" | "rejected";
export type Disposition = "restock" | "write_off";

export interface ReturnLine extends DocLine { disposition?: Disposition }

export interface ReturnDoc {
  kind: "return";
  id: string;
  status: ReturnStatus;
  currency: string;
  invoiceId?: string;
  reason?: string;
  lines: ReturnLine[];
}
