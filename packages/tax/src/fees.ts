import { prepareRates, runCore } from "./engine";
import { assertMinor, divHalfEven, toSafe } from "./math";
import type { Exemptions, Fee, RoundingScope, TaxEntry, TaxGroup } from "./model";

export interface FeeLine {
  id: string;
  name: string;
  /** Amount charged before any exclusive tax. */
  amount: number;
  /** Amount excluding inclusive tax. */
  net: number;
  taxes: TaxEntry[];
  tax: number;
  gross: number;
}

export interface FeesResult {
  fees: FeeLine[];
  /** Sum of fee amounts. */
  total: number;
  tax: number;
  gross: number;
}

export interface ApplyFeesInput {
  /** Base for percent fees, minor units (callers decide whether it includes tax). */
  subtotal: number;
  fees: Fee[];
  /** Tender method being paid with; tender fees are skipped without one. */
  tenderMethod?: string;
  /** Group applied to taxable fees. Taxable fees with no group are untaxed. */
  taxGroupForFees?: TaxGroup;
  exemptions?: Exemptions;
  rounding?: RoundingScope;
}

function feeAmount(fee: Fee, subtotal: number): number {
  if (fee.kind === "percent") {
    const ppm = fee.ppm ?? 0;
    if (!Number.isInteger(ppm) || ppm < 0) throw new RangeError(`fee ${fee.id}: ppm must be a non-negative integer`);
    return toSafe(divHalfEven(BigInt(subtotal) * BigInt(ppm), 1_000_000n), "fee");
  }
  const amount = fee.amount ?? 0;
  assertMinor(amount, `fee ${fee.id} amount`);
  if (amount < 0) throw new RangeError(`fee ${fee.id}: amount must not be negative`);
  return amount;
}

/**
 * Resolve fees for an order. Tender fees (card surcharge) apply only when the chosen
 * tender matches, so changing tender re-prices cleanly. Zero fees are dropped.
 */
export function applyFees(input: ApplyFeesInput): FeesResult {
  assertMinor(input.subtotal, "subtotal");
  const active = input.fees.filter((f) => {
    if (f.appliesTo === "order") return true;
    if (input.tenderMethod === undefined) return false;
    return f.tenderMethods === undefined || f.tenderMethods.includes(input.tenderMethod);
  });
  const priced = active.map((fee) => ({ fee, amount: feeAmount(fee, input.subtotal) })).filter((p) => p.amount > 0);
  const group = input.taxGroupForFees;
  const rates = group ? prepareRates(group, input.exemptions) : [];
  const core = runCore(
    priced.map(({ fee, amount }) => ({ id: fee.id, groupId: group?.id ?? "", amount, rates: fee.taxable ? rates : [] })),
    input.rounding ?? "line",
  );
  const fees = priced.map(({ fee, amount }, i): FeeLine => {
    const l = core.lines[i]!;
    return { id: fee.id, name: fee.name, amount, net: l.net, taxes: l.taxes, tax: l.taxes.reduce((s, t) => s + t.amount, 0), gross: l.gross };
  });
  return { fees, total: fees.reduce((s, f) => s + f.amount, 0), tax: core.totals.tax, gross: core.totals.gross };
}
