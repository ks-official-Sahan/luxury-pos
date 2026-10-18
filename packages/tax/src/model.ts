export interface TaxRate {
  id: string;
  name: string;
  /** Parts per million: 20% = 200000, 8.875% = 88750. Integer so rates never drift through floats. */
  ratePpm: number;
  /** Applied on base plus the preceding non-compound taxes (Quebec QST on GST). */
  compound?: boolean;
  /** Price already contains this tax; it is extracted rather than added. */
  inclusive?: boolean;
}

export interface TaxGroup {
  id: string;
  name: string;
  /** Order matters: compound rates see the non-compound rates listed before them. Empty = exempt. */
  rates: TaxRate[];
}

export interface Jurisdiction {
  id: string;
  name: string;
  country: string;
  region?: string;
  /** Product tax class to tax group id. */
  classes: Record<string, string>;
  defaultGroupId: string;
}

export interface Fee {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  /** Percent fees: parts per million of the subtotal. */
  ppm?: number;
  /** Fixed fees: minor units. */
  amount?: number;
  taxable: boolean;
  appliesTo: "order" | "tender";
  /** Tender fees only: restrict to these methods (e.g. ["card"]). Omitted = any tender. */
  tenderMethods?: string[];
}

export type RoundingScope = "line" | "invoice";

export interface TaxLineInput {
  id: string;
  /** Minor units, net of discounts. Includes inclusive taxes when the group has any. */
  amount: number;
  taxClass: string;
  quantity: number;
}

export interface Exemptions {
  /** Rates not charged to this customer. */
  taxRateIds?: string[];
  /** Exemption certificate reference, kept on the result for audit. Without taxRateIds it exempts every rate. */
  certificate?: string;
}

export interface TaxInput {
  currency: string;
  lines: TaxLineInput[];
  jurisdiction: Jurisdiction;
  groups: TaxGroup[];
  exemptions?: Exemptions;
  rounding: RoundingScope;
}

export interface TaxEntry {
  rateId: string;
  name: string;
  amount: number;
}

export interface TaxedLine {
  id: string;
  groupId: string;
  net: number;
  taxes: TaxEntry[];
  gross: number;
}

export interface BreakdownEntry {
  name: string;
  ratePpm: number;
  inclusive: boolean;
  taxable: number;
  tax: number;
}

export interface TaxTotals {
  net: number;
  tax: number;
  gross: number;
}

export interface TaxResult {
  currency: string;
  rounding: RoundingScope;
  lines: TaxedLine[];
  totals: TaxTotals;
  breakdown: Record<string, BreakdownEntry>;
  exemptionCertificate?: string;
}
