/** Floor division for any sign; `d` must be positive. */
export function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d < 0n ? q - 1n : q;
}

/** `n / d` rounded half to even (banker's), exact for any sign. `d` must be positive. */
export function divHalfEven(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError("divisor must be positive");
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  const sign = n < 0n ? -1n : 1n;
  if (twice > d) return q + sign;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + sign;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export const lcm = (a: bigint, b: bigint): bigint => (a / gcd(a, b)) * b;

/** Narrow to a JS number, refusing anything outside the safe integer range. */
export function toSafe(v: bigint, label: string): number {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (v > limit || v < -limit) throw new RangeError(`${label} exceeds the safe integer range`);
  return Number(v) + 0;
}

export function assertMinor(v: number, label: string): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${label} must be a safe integer in minor units, got ${v}`);
}
