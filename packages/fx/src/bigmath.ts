export type Rounding = "half_even" | "half_up" | "down";

/**
 * `n / d` rounded to an integer. `d` must be positive. "half_up" and "down" are
 * symmetric (away from zero on ties, toward zero) so refunds mirror sales exactly.
 */
export function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d <= 0n) throw new RangeError("divisor must be positive");
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const sign = n < 0n ? -1n : 1n;
  if (mode === "down") return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d) return q + sign;
  if (twice < d) return q;
  if (mode === "half_up") return q + sign;
  return q % 2n === 0n ? q : q + sign;
}

export const pow10 = (n: number): bigint => 10n ** BigInt(n);

export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

/** Parse a positive decimal string ("1.0842", "149") into an exact ratio. Floats and exponents are rejected. */
export function parseDecimalRatio(text: string): Ratio {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new RangeError(`invalid decimal "${text}"`);
  const frac = m[2] ?? "";
  const num = BigInt((m[1] ?? "0") + frac);
  if (num === 0n) throw new RangeError("rate must be positive");
  return { num, den: pow10(frac.length) };
}

/** Render a ratio as a decimal string with at most `places` decimals (half-even), trailing zeros trimmed. */
export function ratioToDecimal(r: Ratio, places = 18): string {
  const scaled = divRound(r.num * pow10(places), r.den, "half_even");
  const s = scaled.toString().padStart(places + 1, "0");
  const whole = s.slice(0, s.length - places);
  const frac = s.slice(s.length - places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
