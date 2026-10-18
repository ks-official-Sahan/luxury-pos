import { isDigits } from "./util";

export type GtinFormat = "EAN-13" | "EAN-8" | "UPC-A" | "GTIN-14";

/**
 * GS1 mod-10 check digit for a digit string WITHOUT its check digit. Rightmost body digit has weight 3,
 * weights alternate 3,1. Works for every GTIN length and for SSCC (17-digit body).
 */
export function gtinCheckDigit(body: string): number {
  if (!isDigits(body)) throw new RangeError("body must be digits");
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48;
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Appends the check digit to a body. */
export function withCheckDigit(body: string): string {
  return body + gtinCheckDigit(body);
}

/** True when `code` is all digits and its last digit is the correct check digit (length >= 2). */
export function hasValidCheckDigit(code: string): boolean {
  return code.length >= 2 && isDigits(code) && gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/** Identifies GTIN family by length (8, 12, 13, 14) and validates the check digit; null when invalid. */
export function gtinFormat(code: string): GtinFormat | null {
  if (!hasValidCheckDigit(code)) return null;
  switch (code.length) {
    case 8: return "EAN-8";
    case 12: return "UPC-A";
    case 13: return "EAN-13";
    case 14: return "GTIN-14";
    default: return null;
  }
}

/** Valid GTIN-8/12/13/14 (digits only, correct check digit). */
export function isValidGtin(code: string): boolean {
  return gtinFormat(code) !== null;
}
export function isValidEan13(code: string): boolean { return gtinFormat(code) === "EAN-13"; }
export function isValidEan8(code: string): boolean { return gtinFormat(code) === "EAN-8"; }
export function isValidUpcA(code: string): boolean { return gtinFormat(code) === "UPC-A"; }

/**
 * Expands UPC-E (8 digits: number system 0/1, 6 data digits, check digit) to its 12-digit UPC-A.
 * Throws if the number system is not 0/1 or the check digit does not match the expansion.
 */
export function expandUpcE(upce: string): string {
  if (!/^[01]\d{7}$/.test(upce)) throw new RangeError("UPC-E must be 8 digits with number system 0 or 1");
  const ns = upce[0] as string;
  const d = upce.slice(1, 7);
  const last = d[5] as string;
  let body: string;
  if (last <= "2") body = d.slice(0, 2) + last + "0000" + d.slice(2, 5);
  else if (last === "3") body = d.slice(0, 3) + "00000" + d.slice(3, 5);
  else if (last === "4") body = d.slice(0, 4) + "00000" + d[4];
  else body = d.slice(0, 5) + "0000" + last;
  const upcA = ns + body + (upce[7] as string);
  if (!hasValidCheckDigit(upcA)) throw new RangeError("invalid UPC-E check digit");
  return upcA;
}

/** True when `code` is a well-formed UPC-E with a check digit matching its UPC-A expansion. */
export function isValidUpcE(code: string): boolean {
  try {
    expandUpcE(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes EAN-8, UPC-A, EAN-13 or GTIN-14 to a zero-padded GTIN-14. Throws on invalid input.
 * 8-digit input is read as EAN-8 unless `upcE` is true, in which case it is expanded as UPC-E first.
 */
export function normalizeGtin(code: string, opts: { upcE?: boolean } = {}): string {
  const c = code.trim();
  const full = opts.upcE === true && c.length === 8 ? expandUpcE(c) : c;
  if (!isValidGtin(full)) throw new RangeError(`invalid GTIN: ${code}`);
  return full.padStart(14, "0");
}
