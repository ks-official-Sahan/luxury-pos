/** Unit of measure for a product. `factor` is base units per this unit (integer >= 1). */
export interface Uom {
  code: string;
  name: string;
  factor: number;
}

/** Weighed/measured quantity. Amount is an integer in grams or millilitres. */
export interface Measure {
  unit: "g" | "ml";
  amount: number;
}

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
}

function assertUom(u: Uom): void {
  if (!Number.isSafeInteger(u.factor) || u.factor < 1) {
    throw new RangeError(`Uom ${u.code} factor must be an integer >= 1, got ${u.factor}`);
  }
}

/**
 * Integer division with banker's rounding (round half to even). Denominator must be > 0.
 * Result is exact for |n| < 2^53; ties go to the even neighbour, symmetric for negatives.
 */
export function divRound(n: number, d: number): number {
  if (!(d > 0)) throw new RangeError("divisor must be > 0");
  const neg = n < 0;
  const a = Math.abs(n);
  const q = Math.floor(a / d);
  const twice = (a - q * d) * 2;
  const res = twice > d || (twice === d && q % 2 === 1) ? q + 1 : q;
  return neg && res !== 0 ? -res : res;
}

/** Converts an integer count of `uom` into base units. */
export function toBase(qty: number, uom: Uom): number {
  assertUom(uom);
  assertInt(qty, "qty");
  const r = qty * uom.factor;
  assertInt(r, "result");
  return r;
}

/** Splits base units into whole `uom` units plus a base-unit remainder (0 <= remainder < factor for qty >= 0). */
export function fromBase(baseQty: number, uom: Uom): { whole: number; remainder: number } {
  assertUom(uom);
  assertInt(baseQty, "baseQty");
  const whole = Math.trunc(baseQty / uom.factor);
  return { whole, remainder: baseQty - whole * uom.factor };
}

/** Exact conversion between units via base units. Throws if the result is not an integer count of `to`. */
export function convert(qty: number, from: Uom, to: Uom): number {
  const base = toBase(qty, from);
  assertUom(to);
  if (base % to.factor !== 0) {
    throw new RangeError(`${qty} ${from.code} is not an integral number of ${to.code}`);
  }
  return base / to.factor;
}

/**
 * Price for a weighed quantity: grams * pricePerKg / 1000, banker's rounded to minor units.
 * grams and pricePerKgMinor are non-negative integers.
 */
export function priceForWeight(grams: number, pricePerKgMinor: number): number {
  assertInt(grams, "grams");
  assertInt(pricePerKgMinor, "pricePerKgMinor");
  if (grams < 0 || pricePerKgMinor < 0) throw new RangeError("negative weight or price");
  return divRound(grams * pricePerKgMinor, 1000);
}
