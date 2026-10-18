import { divRound, parseDecimalRatio, pow10, type Rounding } from "./bigmath";
import { currencyExponent } from "./currencies";
import type { RateTable } from "./rates";

export interface ConvertOptions {
  rounding?: Rounding;
}

function toSafe(value: bigint, label: string): number {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > limit || value < -limit) throw new RangeError(`${label} exceeds the safe integer range`);
  return Number(value) + 0;
}

/**
 * Convert by an exact ratio `num/den` (quote per base, in major units). Exponent
 * differences between currencies are folded into the ratio so there is one rounding step.
 */
export function convertRatio(minor: number, from: string, to: string, num: bigint, den: bigint, rounding: Rounding = "half_even"): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`amount must be a safe integer in minor units, got ${minor}`);
  if (num <= 0n || den <= 0n) throw new RangeError("rate must be positive");
  const n = BigInt(minor) * num * pow10(currencyExponent(to));
  const d = den * pow10(currencyExponent(from));
  return toSafe(divRound(n, d, rounding), "converted amount");
}

/** Convert minor units of `from` to `to` at a decimal-string rate (units of `to` per 1 `from`). */
export function convert(minor: number, from: string, to: string, rate: string, opts: ConvertOptions = {}): number {
  const r = parseDecimalRatio(rate);
  return convertRatio(minor, from, to, r.num, r.den, opts.rounding ?? "half_even");
}

export interface TableConversion {
  amount: number;
  rate: string;
  path: string[];
  asOf: string;
  source: string;
}

/** Convert using a RateTable, returning the rate provenance so receipts can record it. Throws if no rate exists. */
export function convertWithTable(minor: number, from: string, to: string, table: RateTable, at?: Date, opts: ConvertOptions = {}): TableConversion {
  const found = table.get(from, to, at);
  if (!found) throw new Error(`No FX rate available for ${from}/${to}`);
  return { amount: convert(minor, from, to, found.rate, opts), rate: found.rate, path: found.path, asOf: found.asOf, source: found.source };
}
