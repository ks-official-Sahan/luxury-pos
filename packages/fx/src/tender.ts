import { parseDecimalRatio, ratioToDecimal, type Rounding } from "./bigmath";
import { convertRatio } from "./convert";
import { currencyExponent } from "./currencies";

export interface ForeignAmount {
  amount: number;
  currency: string;
}

function spreadRatio(rate: string, spreadBps: number) {
  if (!Number.isInteger(spreadBps) || spreadBps < 0 || spreadBps >= 10_000) throw new RangeError("spreadBps must be an integer in [0, 10000)");
  const r = parseDecimalRatio(rate);
  return { num: r.num * BigInt(10_000 - spreadBps), den: r.den * 10_000n };
}

/** Rate the customer actually gets: mid rate reduced by the store's buy spread. */
export function tenderRate(rate: string, spreadBps = 0): string {
  return ratioToDecimal(spreadRatio(rate, spreadBps));
}

/**
 * Base-currency value of foreign cash. The store buys foreign currency below mid,
 * so the credit is `mid * (1 - spread)`. `rate` is base per 1 foreign unit.
 */
export function foreignTenderValue(tender: ForeignAmount, baseCurrency: string, rate: string, spreadBps = 0, rounding: Rounding = "half_even"): number {
  const { num, den } = spreadRatio(rate, spreadBps);
  return convertRatio(tender.amount, tender.currency, baseCurrency, num, den, rounding);
}

export interface ChangeResult {
  tenderedBase: number;
  /** Base-currency change owed back to the customer. */
  change: number;
  /** Base-currency amount still unpaid. */
  remaining: number;
}

/** Apply foreign cash against a base-currency amount due; change is always given in base. */
export function changeInBase(due: number, tender: ForeignAmount, baseCurrency: string, rate: string, spreadBps = 0, rounding: Rounding = "half_even"): ChangeResult {
  const tenderedBase = foreignTenderValue(tender, baseCurrency, rate, spreadBps, rounding);
  return { tenderedBase, change: Math.max(0, tenderedBase - due), remaining: Math.max(0, due - tenderedBase) };
}

/** [notes major units, coins major units] per currency; converted to minor units on lookup. */
const CASH: Record<string, readonly (readonly number[])[]> = {
  USD: [[1, 2, 5, 10, 20, 50, 100], [0.01, 0.05, 0.1, 0.25, 0.5]],
  EUR: [[5, 10, 20, 50, 100, 200, 500], [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]],
  GBP: [[5, 10, 20, 50], [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]],
  LKR: [[20, 50, 100, 500, 1000, 2000, 5000], [1, 2, 5, 10]],
  AED: [[5, 10, 20, 50, 100, 200, 500, 1000], [0.25, 0.5, 1]],
  JPY: [[1000, 2000, 5000, 10000], [1, 5, 10, 50, 100, 500]],
  INR: [[10, 20, 50, 100, 200, 500], [1, 2, 5, 10]],
  AUD: [[5, 10, 20, 50, 100], [0.05, 0.1, 0.2, 0.5, 1, 2]],
  CAD: [[5, 10, 20, 50, 100], [0.05, 0.1, 0.25, 1, 2]],
  CHF: [[10, 20, 50, 100, 200, 1000], [0.05, 0.1, 0.2, 0.5, 1, 2, 5]],
};

/** Common circulating notes and coins in minor units, largest first. Empty for currencies we do not list. */
export function denominations(currency: string): number[] {
  const groups = CASH[currency.toUpperCase()];
  if (!groups) return [];
  const exp = currencyExponent(currency.toUpperCase());
  const out = new Set<number>();
  for (const g of groups) for (const v of g) out.add(Math.round(v * 10 ** exp));
  return [...out].filter((v) => v > 0).sort((a, b) => b - a);
}

export interface BreakdownLine {
  value: number;
  count: number;
}

export interface Breakdown {
  lines: BreakdownLine[];
  /** Amount the denominations cannot make exactly (non-zero when the smallest coin exceeds 1). */
  remainder: number;
}

/** Greedy change breakdown, largest denomination first. Exact for canonical cash systems. */
export function breakdown(amount: number, denoms: readonly number[]): Breakdown {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative safe integer");
  const sorted = [...new Set(denoms)].sort((a, b) => b - a);
  let left = amount;
  const lines: BreakdownLine[] = [];
  for (const value of sorted) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError("denominations must be positive integers");
    const count = Math.floor(left / value);
    if (count > 0) {
      lines.push({ value, count });
      left -= count * value;
    }
  }
  return { lines, remainder: left };
}
