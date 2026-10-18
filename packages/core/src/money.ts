/**
 * Money is an integer count of the currency's minor unit (cents, fils, yen).
 * Floats never touch an amount: every operation stays in safe integers.
 */
export type Minor = number;

const exponentCache = new Map<string, number>();

/** Minor-unit exponent for an ISO 4217 code (USD 2, JPY 0, BHD 3). */
export function currencyExponent(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;
  const exp = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  exponentCache.set(currency, exp);
  return exp;
}

export function assertMinor(value: number, label = "amount"): Minor {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer in minor units, got ${value}`);
  return value;
}

/** Round half to even (banker's rounding) — the accounting default, no drift over many lines. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  const r = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
  return r + 0; // normalise -0
}

/** `amount * bps / 10_000`, rounded half-even. Fractional bps are fine (8.875% = 887.5). */
export function applyBps(amount: Minor, bps: number): Minor {
  return roundHalfEven((amount * bps) / 10_000);
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total`
 * (largest-remainder method). Used to spread order discounts across lines.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.trunc(r));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = Math.sign(remainder);
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    parts[order[k]!.i]! += step;
    remainder -= step;
  }
  return parts;
}

/** Round to a cash increment (e.g. 5 for CHF 0.05 rounding). */
export function roundToIncrement(amount: Minor, increment: number): Minor {
  if (increment <= 1) return amount;
  return roundHalfEven(amount / increment) * increment;
}

export function formatMoney(amount: Minor, currency: string, locale = "en"): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 10 ** exp);
}

/** Parse a user-typed decimal ("1,299.50") to minor units without float error. */
export function parseMoney(input: string, currency: string): Minor | null {
  const exp = currencyExponent(currency);
  const clean = input.replace(/[\s,]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!match) return null;
  const [, neg, whole, frac = ""] = match;
  if (frac.length > exp) return null;
  const value = Number(whole) * 10 ** exp + Number(frac.padEnd(exp, "0") || 0);
  if (!Number.isSafeInteger(value)) return null;
  return neg ? -value : value;
}
