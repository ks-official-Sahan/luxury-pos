/** sRGB hex helpers and WCAG 2.2 contrast. No dependencies, runs on every platform. */
export type Hex = `#${string}`;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(value: string): value is Hex {
  return HEX.test(value);
}

export function toRgb(hex: string): [number, number, number] {
  if (!isHex(hex)) throw new TypeError(`invalid hex colour ${hex}`);
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: readonly [number, number, number]): Hex {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix two colours; `weight` is the share of `b` (0..1). */
export function mix(a: string, b: string, weight: number): Hex {
  const ra = toRgb(a);
  const rb = toRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i]! + (rb[i]! - ra[i]!) * weight) as [number, number, number]);
}

/** Black or white, whichever reads better on `bg` (prefers the brand's own ink colours when given). */
export function readableOn(bg: string, candidates: readonly string[] = ["#0B0B0C", "#FFFFFF"]): Hex {
  let best = candidates[0]!;
  for (const c of candidates) if (contrastRatio(c, bg) > contrastRatio(best, bg)) best = c;
  return best as Hex;
}

/**
 * Nudges `fg` toward black or white until it reaches `min` contrast on `bg`.
 * Brands keep their hue; text stays legible (AA 4.5 for body, 3 for large/UI).
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): Hex {
  if (contrastRatio(fg, bg) >= min) return toHex(toRgb(fg));
  const target = luminance(bg) > 0.4 ? "#000000" : "#FFFFFF";
  for (let w = 0.05; w <= 1; w += 0.05) {
    const candidate = mix(fg, target, w);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target as Hex;
}
