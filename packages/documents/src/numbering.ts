import type { DocType } from "./types";

export interface NumberingScheme {
  docType: DocType;
  /** Tokens: {PREFIX} {STORE} {DEVICE} {YYYY} {YY} {MM} {SEQ} {SEQ:n}. {SEQ} alone pads to 6. Exactly one SEQ token. */
  pattern: string;
  prefix: string;
  resetEvery: "never" | "year" | "month";
}

export interface NumberContext { storeCode: string; deviceCode: string; date: Date }

const TOKEN = /\{([A-Z]+)(?::(\d+))?\}/g;
const LITERAL = /^[A-Za-z0-9\-/_.#]*$/;
const KNOWN = new Set(["PREFIX", "STORE", "DEVICE", "YYYY", "YY", "MM", "SEQ"]);
const SAFE_VALUE = /^[A-Za-z0-9\-_.]*$/;

/** Returns human readable problems; empty means valid. */
export function validateScheme(s: NumberingScheme): string[] {
  const errs: string[] = [];
  const tokens = [...s.pattern.matchAll(TOKEN)];
  const seq = tokens.filter((t) => t[1] === "SEQ");
  if (seq.length !== 1) errs.push("pattern must contain exactly one {SEQ} or {SEQ:n} token");
  for (const t of tokens) {
    if (!KNOWN.has(t[1]!)) errs.push(`unknown token {${t[1]}}`);
    if (t[2] !== undefined && t[1] !== "SEQ") errs.push(`token {${t[1]}} takes no width`);
    if (t[1] === "SEQ" && t[2] !== undefined && (Number(t[2]) < 1 || Number(t[2]) > 12)) errs.push("SEQ width must be 1..12");
  }
  const literal = s.pattern.replace(TOKEN, "");
  if (!LITERAL.test(literal)) errs.push("pattern literals may only use letters, digits and - / _ . #");
  if (/[{}]/.test(literal)) errs.push("unbalanced braces in pattern");
  if (!SAFE_VALUE.test(s.prefix)) errs.push("prefix may only use letters, digits and - _ .");
  const has = (n: string) => tokens.some((t) => t[1] === n);
  if (s.resetEvery === "year" && !has("YYYY") && !has("YY")) errs.push("yearly reset requires {YYYY} or {YY} in pattern");
  if (s.resetEvery === "month" && !((has("YYYY") || has("YY")) && has("MM"))) errs.push("monthly reset requires year and {MM} in pattern");
  return errs;
}

function assertValid(s: NumberingScheme): void {
  const e = validateScheme(s);
  if (e.length) throw new Error(`invalid numbering scheme: ${e.join("; ")}`);
}

function checkCodes(ctx: NumberContext): void {
  if (!SAFE_VALUE.test(ctx.storeCode) || !SAFE_VALUE.test(ctx.deviceCode)) throw new Error("store/device code contains unsafe characters");
}

/** UTC calendar parts of the document date. */
function parts(d: Date) {
  const y = d.getUTCFullYear();
  return { YYYY: String(y).padStart(4, "0"), YY: String(y % 100).padStart(2, "0"), MM: String(d.getUTCMonth() + 1).padStart(2, "0") };
}

/** Renders the document number. `seq` is a positive integer; it grows past the pad width rather than truncating. */
export function formatNumber(scheme: NumberingScheme, ctx: NumberContext & { seq: number }): string {
  assertValid(scheme);
  checkCodes(ctx);
  if (!Number.isSafeInteger(ctx.seq) || ctx.seq < 1) throw new Error("seq must be a positive integer");
  const p = parts(ctx.date);
  return scheme.pattern.replace(TOKEN, (_m, name: string, width?: string) => {
    switch (name) {
      case "PREFIX": return scheme.prefix;
      case "STORE": return ctx.storeCode;
      case "DEVICE": return ctx.deviceCode;
      case "YYYY": return p.YYYY;
      case "YY": return p.YY;
      case "MM": return p.MM;
      default: return String(ctx.seq).padStart(width === undefined ? 6 : Number(width), "0");
    }
  });
}

/**
 * Counter key for the sequence store. Counters are scoped to docType and prefix, to store/device only when the
 * pattern embeds them (otherwise numbers would not be unique), and to the reset period.
 */
export function nextSequenceKey(scheme: NumberingScheme, ctx: NumberContext): string {
  assertValid(scheme);
  checkCodes(ctx);
  const p = parts(ctx.date);
  const period = scheme.resetEvery === "never" ? "all" : scheme.resetEvery === "year" ? p.YYYY : `${p.YYYY}-${p.MM}`;
  const key = [scheme.docType, scheme.prefix];
  if (scheme.pattern.includes("{STORE}")) key.push(`store=${ctx.storeCode}`);
  if (scheme.pattern.includes("{DEVICE}")) key.push(`device=${ctx.deviceCode}`);
  key.push(period);
  return key.join(":");
}
