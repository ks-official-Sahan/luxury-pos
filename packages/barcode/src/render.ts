import { gtinCheckDigit, isValidEan13 } from "./ean";

// Code 128 element widths (bar, space, bar, space, bar, space) per symbol value 0..105, then 106 = stop (7 elements).
const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;

/**
 * Code 128 set B element widths (alternating bar, space, starting with a bar): start B, one symbol per character
 * (ASCII 32-126), mod-103 checksum, stop. Excludes quiet zones. Total module width is 11 * (chars + 2) + 13.
 */
export function code128B(text: string): number[] {
  if (text.length === 0) throw new RangeError("empty text");
  const values: number[] = [START_B];
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) throw new RangeError(`character ${i} not encodable in Code 128 set B`);
    values.push(c - 32);
    sum += (c - 32) * (i + 1);
  }
  values.push(sum % 103, STOP);
  const out: number[] = [];
  for (const v of values) for (const ch of C128[v] as string) out.push(Number(ch));
  return out;
}

/** Code 128 mod-103 checksum symbol value for set B text (exposed for verification). */
export function code128BChecksum(text: string): number {
  let sum = START_B;
  for (let i = 0; i < text.length; i++) sum += (text.charCodeAt(i) - 32) * (i + 1);
  return sum % 103;
}

/** Converts alternating bar/space widths (bar first) to a module string of "1" (bar) and "0" (space). */
export function widthsToModules(widths: readonly number[]): string {
  let s = "";
  widths.forEach((w, i) => {
    s += (i % 2 === 0 ? "1" : "0").repeat(w);
  });
  return s;
}

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"] as const;
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"] as const;

const flip = (s: string) => s.replace(/[01]/g, (b) => (b === "0" ? "1" : "0"));
const rev = (s: string) => [...s].reverse().join("");

/** EAN-13 as exactly 95 modules: guard 101, 6 left digits (L/G by first digit), 01010, 6 right digits (R), guard 101. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new RangeError("invalid EAN-13");
  const parity = PARITY[Number(code[0])] as string;
  let out = "101";
  for (let i = 0; i < 6; i++) {
    const enc = L[Number(code[i + 1])] as string;
    out += parity[i] === "L" ? enc : rev(enc);
  }
  out += "01010";
  for (let i = 7; i < 13; i++) out += flip(L[Number(code[i])] as string);
  return out + "101";
}

export interface SvgOptions {
  /** Bar height in px. */
  height: number;
  /** Width of one module in px. */
  moduleWidth: number;
  /** Quiet zone in modules on each side (default 10). */
  quiet?: number;
}

/**
 * SVG for a module string (or bar/space widths). Adjacent bar modules merge into one rect; white background
 * rect included. Output is deterministic and contains no scripts.
 */
export function toSvg(modules: string | readonly number[], opts: SvgOptions): string {
  const bits = typeof modules === "string" ? modules : widthsToModules(modules);
  if (!/^[01]+$/.test(bits)) throw new RangeError("modules must be a string of 0 and 1");
  const quiet = opts.quiet ?? 10;
  const { height, moduleWidth: mw } = opts;
  if (!(height > 0) || !(mw > 0) || quiet < 0) throw new RangeError("bad dimensions");
  const width = (bits.length + 2 * quiet) * mw;
  let rects = "";
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === "1") {
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      rects += `<rect x="${(i + quiet) * mw}" y="0" width="${(j - i) * mw}" height="${height}"/>`;
      i = j;
    } else i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

export interface ZplLabelInput {
  name: string;
  /** Integer minor units. */
  price: number;
  barcode: string;
  currencySymbol: string;
  /** Currency exponent (default 2). */
  minorDigits?: number;
}

function zplEscape(s: string): string {
  return s.replace(/[_^~]/g, (c) => "_" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

/** Formats integer minor units as a decimal string, e.g. 1999 -> "19.99". */
export function formatMinor(minor: number, minorDigits = 2): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("price must be an integer");
  const neg = minor < 0;
  const a = String(Math.abs(minor)).padStart(minorDigits + 1, "0");
  const body = minorDigits === 0 ? a : `${a.slice(0, -minorDigits)}.${a.slice(-minorDigits)}`;
  return neg ? `-${body}` : body;
}

/**
 * ZPL II shelf/price label (UTF-8, ^FH hex escaping so ^ ~ _ in names are safe). Barcode is Code 128 (^BC),
 * human-readable text below.
 */
export function zplLabel(l: ZplLabelInput): string {
  if (l.barcode.length === 0) throw new RangeError("empty barcode");
  const price = `${l.currencySymbol}${formatMinor(l.price, l.minorDigits ?? 2)}`;
  return [
    "^XA",
    "^CI28",
    "^FO30,20^A0N,36,36^FH_^FD" + zplEscape(l.name) + "^FS",
    "^FO30,70^A0N,60,60^FH_^FD" + zplEscape(price) + "^FS",
    "^FO30,150^BY2^BCN,80,Y,N,N^FH_^FD" + zplEscape(l.barcode) + "^FS",
    "^XZ",
  ].join("\n");
}

export type EscposBarcodeType = "UPCA" | "UPCE" | "EAN13" | "EAN8" | "CODE39" | "ITF" | "CODABAR" | "CODE93" | "CODE128";

const ESCPOS_M: Record<EscposBarcodeType, number> = { UPCA: 65, UPCE: 66, EAN13: 67, EAN8: 68, CODE39: 69, ITF: 70, CODABAR: 71, CODE93: 72, CODE128: 73 };
const DIGIT_LENGTHS: Partial<Record<EscposBarcodeType, readonly number[]>> = { UPCA: [11, 12], UPCE: [6, 7, 8, 11, 12], EAN13: [12, 13], EAN8: [7, 8] };

/**
 * ESC/POS "GS k m n d1..dn" (function B) bytes for receipt printers. Numeric symbologies are length-checked;
 * EAN-13 and UPC-A/EAN-8 data without a check digit gets one appended. CODE128 data is prefixed with "{B"
 * (code set B) and must be printable ASCII. Data is ASCII, max 255 bytes.
 */
export function escposBarcode(code: string, type: EscposBarcodeType): Uint8Array {
  let data = code;
  const lens = DIGIT_LENGTHS[type];
  if (lens) {
    if (!/^\d+$/.test(code) || !lens.includes(code.length)) throw new RangeError(`${type} needs ${lens.join("/")} digits`);
    if ((type === "EAN13" && code.length === 12) || (type === "EAN8" && code.length === 7) || (type === "UPCA" && code.length === 11)) {
      data = code + gtinCheckDigit(code);
    }
  } else if (type === "CODE128") {
    data = "{B" + code;
  }
  if (data.length === 0 || data.length > 255) throw new RangeError("barcode data length must be 1-255");
  const bytes = [0x1d, 0x6b, ESCPOS_M[type], data.length];
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new RangeError("barcode data must be printable ASCII");
    bytes.push(c);
  }
  return Uint8Array.from(bytes);
}
