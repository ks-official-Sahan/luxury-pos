import type { TaxResult, TaxTotals } from "./model";

export interface InvoiceTaxRow {
  rateId: string;
  name: string;
  ratePpm: number;
  inclusive: boolean;
  taxable: number;
  tax: number;
}

export interface TaxInvoiceSummary {
  currency: string;
  rows: InvoiceTaxRow[];
  /** Net value of lines carrying no tax at all (exempt), required on many invoices. */
  exemptNet: number;
  totals: TaxTotals;
  exemptionCertificate?: string;
}

/** Flatten a result into per-rate rows (highest rate first, then id) plus totals for printing a tax invoice. */
export function taxInvoiceSummary(result: TaxResult): TaxInvoiceSummary {
  const rows = Object.entries(result.breakdown)
    .map(([rateId, b]): InvoiceTaxRow => ({ rateId, name: b.name, ratePpm: b.ratePpm, inclusive: b.inclusive, taxable: b.taxable, tax: b.tax }))
    .sort((a, b) => b.ratePpm - a.ratePpm || (a.rateId < b.rateId ? -1 : 1));
  const exemptNet = result.lines.filter((l) => l.taxes.length === 0).reduce((s, l) => s + l.net, 0);
  const summary: TaxInvoiceSummary = { currency: result.currency, rows, exemptNet, totals: { ...result.totals } };
  if (result.exemptionCertificate) summary.exemptionCertificate = result.exemptionCertificate;
  return summary;
}
