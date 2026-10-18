import { gtinCheckDigit, isValidEan13 } from "./ean";
import { divRound, isDigits } from "./util";

/**
 * Layout of a 13-digit in-store code: prefix + itemDigits + valueDigits + check digit (so lengths sum to 12).
 * Weight values are kg with `decimals` decimals (decimals 3 = grams); price values are integers with `decimals`
 * implied decimals (minor units when decimals equals the currency exponent).
 */
export interface InStoreScheme {
  /** Restricted-circulation prefix, starts with 2 (e.g. "2", "20"-"29"). */
  prefix: string;
  itemDigits: number;
  valueKind: "price" | "weight";
  valueDigits: number;
  decimals: number;
}

export interface InStoreResult {
  scheme: InStoreScheme;
  itemCode: string;
  /** Encoded price integer (see scheme.decimals); present for price schemes. */
  price?: number;
  priceDecimals?: number;
  /** Weight in whole grams (banker's rounded); present for weight schemes. */
  weightGrams?: number;
}

function assertScheme(s: InStoreScheme): void {
  if (!/^2\d{0,1}$/.test(s.prefix)) throw new RangeError("prefix must be 1-2 digits starting with 2");
  if (!Number.isSafeInteger(s.itemDigits) || !Number.isSafeInteger(s.valueDigits) || s.itemDigits < 1 || s.valueDigits < 1) {
    throw new RangeError("itemDigits and valueDigits must be positive integers");
  }
  if (s.prefix.length + s.itemDigits + s.valueDigits !== 12) throw new RangeError("prefix + item + value digits must total 12");
  if (!Number.isSafeInteger(s.decimals) || s.decimals < 0 || s.decimals > s.valueDigits) throw new RangeError("bad decimals");
}

/**
 * Parses an EAN-13 against schemes (longest matching prefix wins). Returns null when the code is not a valid
 * EAN-13 or no scheme matches. Throws only for a misconfigured scheme.
 */
export function parseInStore(code: string, schemes: readonly InStoreScheme[]): InStoreResult | null {
  if (!isValidEan13(code)) return null;
  const ordered = [...schemes].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const scheme of ordered) {
    assertScheme(scheme);
    if (!code.startsWith(scheme.prefix)) continue;
    const itemStart = scheme.prefix.length;
    const valueStart = itemStart + scheme.itemDigits;
    const itemCode = code.slice(itemStart, valueStart);
    const value = Number(code.slice(valueStart, valueStart + scheme.valueDigits));
    if (scheme.valueKind === "price") return { scheme, itemCode, price: value, priceDecimals: scheme.decimals };
    return { scheme, itemCode, weightGrams: divRound(value * 1000, 10 ** scheme.decimals) };
  }
  return null;
}

/**
 * Builds a price/weight-embedded EAN-13. `value` is the encoded price integer for price schemes, or whole grams
 * for weight schemes (banker's rounded to the scheme's resolution). Item code is zero-padded. Throws on overflow.
 */
export function buildInStore(itemCode: string, value: number, scheme: InStoreScheme): string {
  assertScheme(scheme);
  if (!isDigits(itemCode) || itemCode.length > scheme.itemDigits) throw new RangeError("item code must be digits within itemDigits");
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("value must be a non-negative integer");
  const encoded = scheme.valueKind === "weight" ? divRound(value * 10 ** scheme.decimals, 1000) : value;
  if (encoded >= 10 ** scheme.valueDigits) throw new RangeError("value does not fit in valueDigits");
  const body = scheme.prefix + itemCode.padStart(scheme.itemDigits, "0") + String(encoded).padStart(scheme.valueDigits, "0");
  return body + gtinCheckDigit(body);
}

/**
 * Valid EAN-13 for a custom product in the restricted-circulation range: prefix (default "2"; 1-2 digits
 * starting with 2) + zero-padded sequence + check digit. Throws if seq does not fit.
 */
export function generateInternalCode(seq: number, prefix = "2"): string {
  if (!/^2\d?$/.test(prefix)) throw new RangeError("prefix must be 1-2 digits starting with 2");
  const room = 12 - prefix.length;
  if (!Number.isSafeInteger(seq) || seq < 0 || seq >= 10 ** room) throw new RangeError("seq out of range");
  const body = prefix + String(seq).padStart(room, "0");
  return body + gtinCheckDigit(body);
}
