import { pow10 } from "./bigmath";

const exponentCache = new Map<string, number>();
let supported: Set<string> | null | undefined;

/** Minor-unit exponent (JPY 0, USD 2, BHD 3) from the platform's ISO 4217 data, cached. */
export function currencyExponent(code: string): number {
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;
  const exp = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  exponentCache.set(code, exp);
  return exp;
}

/**
 * True for an upper-case ISO 4217 shape the runtime knows. Intl accepts any three
 * letters, so we check supportedValuesOf where it exists to avoid inventing currencies.
 */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  if (supported === undefined) {
    try {
      supported = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      supported = null;
    }
  }
  if (supported) return supported.has(code);
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

function toDecimalString(minor: number, exp: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`amount must be a safe integer in minor units, got ${minor}`);
  const neg = minor < 0;
  const digits = BigInt(Math.abs(minor)).toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp);
  return `${neg ? "-" : ""}${whole}${exp > 0 ? `.${frac}` : ""}`;
}

/** Format minor units for display. Goes through a decimal string so no float rounding can alter the digits. */
export function formatMoney(minor: number, currency: string, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(toDecimalString(minor, currencyExponent(currency)) as `${number}`);
}

/**
 * Parse typed input ("1,299.50", "-3") to minor units. Null for malformed input or
 * more decimals than the currency allows (never silently rounds money).
 */
export function parseMoney(text: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.replace(/[\s,]/g, ""));
  if (!m) return null;
  const frac = m[3] ?? "";
  if (frac.length > exp) return null;
  const value = BigInt(m[2] ?? "0") * pow10(exp) + BigInt(frac.padEnd(exp, "0") || "0");
  const signed = m[1] ? -value : value;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(signed) + 0;
}
