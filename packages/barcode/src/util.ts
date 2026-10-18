/** Integer division with banker's rounding (round half to even). Divisor must be > 0. */
export function divRound(n: number, d: number): number {
  if (!(d > 0)) throw new RangeError("divisor must be > 0");
  const neg = n < 0;
  const a = Math.abs(n);
  const q = Math.floor(a / d);
  const twice = (a - q * d) * 2;
  const res = twice > d || (twice === d && q % 2 === 1) ? q + 1 : q;
  return neg && res !== 0 ? -res : res;
}

export function isDigits(s: string): boolean {
  return /^\d+$/.test(s);
}
