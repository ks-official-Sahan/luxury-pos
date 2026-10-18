import { gtinCheckDigit, hasValidCheckDigit } from "./ean";
import { divRound, isDigits } from "./util";

const GS = "\x1d";

interface AiSpec {
  name: string;
  /** Exact length for fixed-length AIs. */
  fixed?: number;
  /** Max length for variable-length AIs (terminated by FNC1 unless last). */
  max?: number;
  numeric: boolean;
}

function specOf(ai: string): AiSpec | undefined {
  switch (ai) {
    case "00": return { name: "SSCC", fixed: 18, numeric: true };
    case "01": return { name: "GTIN", fixed: 14, numeric: true };
    case "10": return { name: "BATCH/LOT", max: 20, numeric: false };
    case "11": return { name: "PROD DATE", fixed: 6, numeric: true };
    case "15": return { name: "BEST BEFORE", fixed: 6, numeric: true };
    case "17": return { name: "EXPIRY", fixed: 6, numeric: true };
    case "21": return { name: "SERIAL", max: 20, numeric: false };
    case "30": return { name: "VAR COUNT", max: 8, numeric: true };
    case "37": return { name: "COUNT", max: 8, numeric: true };
  }
  if (/^310\d$/.test(ai)) return { name: "NET WEIGHT (kg)", fixed: 6, numeric: true };
  if (/^392\d$/.test(ai)) return { name: "PRICE", max: 15, numeric: true };
  return undefined;
}

export interface Gs1Element {
  ai: string;
  value: string;
}

/** Typed view of recognised AIs. Dates are ISO YYYY-MM-DD; DD=00 resolves to the last day of the month. */
export interface Gs1Data {
  sscc?: string;
  gtin?: string;
  lot?: string;
  productionDate?: string;
  bestBefore?: string;
  expiry?: string;
  serial?: string;
  count?: number;
  /** Net weight in grams (310n: kg with n decimals, banker's rounded to whole grams). */
  netWeightGrams?: number;
  /** 392n amount payable: integer digits and the decimal count n. Minor units when n equals the currency exponent. */
  price?: { value: number; decimals: number };
}

export interface Gs1Parsed {
  ok: boolean;
  data: Gs1Data;
  /** AI -> raw string value, in input order. */
  raw: Record<string, string>;
  elements: Gs1Element[];
  errors: string[];
}

export interface Gs1ParseOptions {
  /** Century for 2-digit years (default 2000). */
  century?: number;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseDate(v: string, century: number): string | null {
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  const dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const y = century + yy;
  const dim = daysInMonth(y, mm);
  const day = dd === 0 ? dim : dd;
  if (day > dim) return null;
  return `${String(y).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validateElement(e: Gs1Element, spec: AiSpec, errors: string[]): boolean {
  const { ai, value } = e;
  if (value.length === 0) return err(errors, `AI ${ai}: empty value`);
  if (spec.fixed !== undefined && value.length !== spec.fixed) return err(errors, `AI ${ai}: expected ${spec.fixed} characters, got ${value.length}`);
  if (spec.max !== undefined && value.length > spec.max) return err(errors, `AI ${ai}: exceeds ${spec.max} characters`);
  if (spec.numeric && !isDigits(value)) return err(errors, `AI ${ai}: must be numeric`);
  if (!spec.numeric && !/^[\x21-\x7e]+$/.test(value)) return err(errors, `AI ${ai}: invalid characters`);
  if ((ai === "00" || ai === "01") && !hasValidCheckDigit(value)) return err(errors, `AI ${ai}: bad check digit`);
  return true;
}

function err(errors: string[], msg: string): false {
  errors.push(msg);
  return false;
}

function lookupAt(s: string, pos: number): { ai: string; spec: AiSpec } | undefined {
  for (const len of [2, 4]) {
    const ai = s.slice(pos, pos + len);
    if (ai.length !== len) continue;
    const spec = specOf(ai);
    if (spec) return { ai, spec };
  }
  return undefined;
}

function tokenizeFnc1(s: string, errors: string[]): Gs1Element[] {
  const out: Gs1Element[] = [];
  let pos = 0;
  while (pos < s.length) {
    if (s[pos] === GS) {
      pos++;
      continue;
    }
    const hit = lookupAt(s, pos);
    if (!hit) {
      errors.push(`unknown AI at position ${pos}`);
      break;
    }
    pos += hit.ai.length;
    let end: number;
    if (hit.spec.fixed !== undefined) {
      end = pos + hit.spec.fixed;
      if (end > s.length) {
        errors.push(`AI ${hit.ai}: value truncated`);
        break;
      }
    } else {
      const g = s.indexOf(GS, pos);
      end = g === -1 ? s.length : g;
    }
    out.push({ ai: hit.ai, value: s.slice(pos, end) });
    pos = end;
  }
  return out;
}

function tokenizeHuman(s: string, errors: string[]): Gs1Element[] {
  const out: Gs1Element[] = [];
  const re = /\((\d{2,4})\)([^(]*)/gy;
  let consumed = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out.push({ ai: m[1] as string, value: m[2] as string });
    consumed = re.lastIndex;
  }
  if (consumed !== s.length) errors.push(`malformed element string at position ${consumed}`);
  return out;
}

/**
 * Parses a GS1-128 / DataMatrix element string. Accepts FNC1 form (group separator \x1d, optional leading
 * symbology identifier ]C1 / ]d2 / ]Q3 / ]e0 and leading FNC1) and parenthesised "(01)...(17)...".
 * Never throws: problems are listed in `errors` and `ok` is false. Check digits of AI 00 and 01 are verified,
 * dates are calendar-checked, duplicate AIs are rejected.
 */
export function parseGs1(input: string, opts: Gs1ParseOptions = {}): Gs1Parsed {
  const century = opts.century ?? 2000;
  const errors: string[] = [];
  const s = input.replace(/^\](?:C1|d2|Q3|e0)/, "");
  const elements = s.startsWith("(") ? tokenizeHuman(s, errors) : tokenizeFnc1(s, errors);
  if (elements.length === 0 && errors.length === 0) errors.push("empty element string");
  const raw: Record<string, string> = {};
  const data: Gs1Data = {};
  for (const e of elements) {
    const spec = specOf(e.ai);
    if (!spec) {
      errors.push(`unknown AI ${e.ai}`);
      continue;
    }
    if (Object.hasOwn(raw, e.ai)) {
      errors.push(`AI ${e.ai}: duplicate`);
      continue;
    }
    raw[e.ai] = e.value;
    if (!validateElement(e, spec, errors)) continue;
    const v = e.value;
    switch (e.ai) {
      case "00": data.sscc = v; break;
      case "01": data.gtin = v; break;
      case "10": data.lot = v; break;
      case "21": data.serial = v; break;
      case "30":
      case "37": data.count = Number(v); break;
      case "11":
      case "15":
      case "17": {
        const d = parseDate(v, century);
        if (d === null) {
          errors.push(`AI ${e.ai}: invalid date ${v}`);
        } else if (e.ai === "11") data.productionDate = d;
        else if (e.ai === "15") data.bestBefore = d;
        else data.expiry = d;
        break;
      }
      default: {
        const n = Number(e.ai[3]);
        if (e.ai.startsWith("310")) data.netWeightGrams = divRound(Number(v) * 1000, 10 ** n);
        else data.price = { value: Number(v), decimals: n };
      }
    }
  }
  return { ok: errors.length === 0, data, raw, elements, errors };
}

/** True when the AI is fixed length (needs no FNC1 separator after it). */
export function isFixedLengthAi(ai: string): boolean {
  return specOf(ai)?.fixed !== undefined;
}

/**
 * Builds element strings from AI/value pairs, validating each (length, charset, check digit).
 * `fnc1` has \x1d after every variable-length element except the last (no leading FNC1: the symbology adds it);
 * `human` is "(ai)value(ai)value". Order is preserved. Throws RangeError on invalid elements.
 */
export function buildGs1(elements: readonly Gs1Element[]): { fnc1: string; human: string } {
  if (elements.length === 0) throw new RangeError("no elements");
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    const spec = specOf(e.ai);
    if (!spec) throw new RangeError(`unknown AI ${e.ai}`);
    if (seen.has(e.ai)) throw new RangeError(`duplicate AI ${e.ai}`);
    seen.add(e.ai);
    validateElement(e, spec, errors);
    if (/^(11|15|17)$/.test(e.ai) && errors.length === 0 && parseDate(e.value, 2000) === null) errors.push(`AI ${e.ai}: invalid date`);
  }
  if (errors.length > 0) throw new RangeError(errors.join("; "));
  let fnc1 = "";
  let human = "";
  elements.forEach((e, i) => {
    fnc1 += e.ai + e.value;
    if (!isFixedLengthAi(e.ai) && i < elements.length - 1) fnc1 += GS;
    human += `(${e.ai})${e.value}`;
  });
  return { fnc1, human };
}

/** Builds a GTIN-14 element value from a 13-digit body (adds check digit). */
export function gtin14FromBody(body13: string): string {
  return body13 + gtinCheckDigit(body13);
}
