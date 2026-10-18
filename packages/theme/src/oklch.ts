import { toHex, toRgb, type Hex } from "./color";

/**
 * OKLCH helpers (Björn Ottosson's OKLab). Perceptually even lightness lets the
 * resolver derive tinted neutrals, state layers and chart colours from one brand
 * hue without the muddy midtones that RGB mixing produces.
 */
export interface Oklch {
  l: number; // 0..1
  c: number; // 0..~0.37
  h: number; // degrees
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toGamma = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = toRgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Converts to sRGB hex, reducing chroma (never lightness or hue) until the colour fits the gamut. */
export function oklchToHex(color: Oklch): Hex {
  const l = Math.min(1, Math.max(0, color.l));
  let lo = 0;
  let hi = color.c;
  if (!inGamut(oklchToLinear({ ...color, l }))) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  return toHex(oklchToLinear({ l, c: hi, h: color.h }).map((v) => toGamma(Math.min(1, Math.max(0, v)))) as [number, number, number]);
}

/** Same hue and chroma, new lightness. */
export const withLightness = (hex: string, l: number): Hex => oklchToHex({ ...hexToOklch(hex), l });

/** Moves lightness by `delta` (positive = lighter). */
export const shiftLightness = (hex: string, delta: number): Hex => {
  const c = hexToOklch(hex);
  return oklchToHex({ ...c, l: c.l + delta });
};

/** A near-neutral that leans very slightly toward `hueOf`, so greys belong to the brand instead of looking generic. */
export function tintedNeutral(hueOf: string, l: number, chroma = 0.008): Hex {
  const { h, c } = hexToOklch(hueOf);
  return oklchToHex({ l, c: c < 0.02 ? 0 : chroma, h });
}

export function toCssOklch(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}
