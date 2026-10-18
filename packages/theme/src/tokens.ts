import { contrastRatio, ensureContrast, mix, readableOn, type Hex } from "./color";
import { hexToOklch, oklchToHex, shiftLightness, tintedNeutral } from "./oklch";
import type { BrandTheme, Palette } from "./schema";

/**
 * Three tiers: the brand's palette (primitives) → these semantic roles → components.
 * Components only ever read semantic roles, so any brand renders correctly.
 */
export interface ColorTokens {
  primary: Hex;
  onPrimary: Hex;
  /** Tinted fill for selected rows, active nav, soft badges. */
  primarySoft: Hex;
  onPrimarySoft: Hex;
  accent: Hex;
  onAccent: Hex;
  /** App canvas behind content. */
  background: Hex;
  /** Second neutral layer for navigation and tool panels. */
  chrome: Hex;
  surface: Hex;
  surfaceRaised: Hex;
  surfaceSunken: Hex;
  /** Modal / sheet scrim (with alpha). */
  scrim: string;
  /** Hover and pressed state layers drawn over any surface (with alpha). */
  hover: string;
  pressed: string;
  text: Hex;
  textMuted: Hex;
  border: Hex;
  borderStrong: Hex;
  focus: Hex;
  success: Hex;
  successSoft: Hex;
  warning: Hex;
  warningSoft: Hex;
  danger: Hex;
  dangerSoft: Hex;
  onDanger: Hex;
  info: Hex;
  infoSoft: Hex;
}

type Scale = Record<"xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl", number>;

export interface ThemeTokens {
  scheme: "light" | "dark";
  color: ColorTokens;
  /** Categorical series colours for charts, derived from the brand hue; each ≥ 3:1 on surface. */
  chart: Hex[];
  font: { display: string; body: string; mono: string };
  /** UI type scale in px (tight ratio for dense product screens). */
  size: Scale;
  /** Display scale in px (the brand's own ratio), for page titles and totals moments. */
  display: Scale;
  space: (step: number) => number;
  radius: { sm: number; md: number; lg: number; pill: number };
  /** Minimum touch target (px); raised for spacious stores. */
  hit: number;
  motion: { enabled: boolean; fast: number; base: number; slow: number; easing: string };
  /** Shadows only for floating layers (menus, sheets, toasts); in-flow surfaces use tone and hairlines. */
  elevation: { overlay: string; float: string };
  z: { sticky: number; dropdown: number; scrim: number; sheet: number; toast: number; tooltip: number };
  layout: BrandTheme["layout"];
  terminology: Record<string, string>;
}

const RADIUS = { none: [0, 0, 0], subtle: [3, 6, 8], soft: [6, 10, 14], round: [10, 14, 16] } as const;
const DENSITY = { compact: 4, comfortable: 4.5, spacious: 5 } as const;

/** Dark palette derived from the light one when a brand gives none: same hues, OKLCH lightness flipped. */
export function deriveDark(light: Palette): Palette {
  const background = tintedNeutral(light.primary, 0.17, 0.01);
  const surface = tintedNeutral(light.primary, 0.215, 0.01);
  return {
    ...light,
    background,
    surface,
    text: tintedNeutral(light.primary, 0.95, 0.006),
    primary: ensureContrast(hexToOklch(light.primary).l < 0.4 ? withL(light.primary, 0.82) : light.primary, background, 3),
    accent: ensureContrast(light.accent, background, 3),
    muted: undefined,
    border: undefined,
  };
}

const withL = (hex: string, l: number) => oklchToHex({ ...hexToOklch(hex), l });
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function colors(p: Palette, scheme: "light" | "dark", pureNeutrals: boolean): ColorTokens {
  const dark = scheme === "dark";
  const bg = p.background as Hex;
  const text = ensureContrast(p.text, bg, 7);
  const primary = ensureContrast(p.primary, bg, 3); // UI component contrast (WCAG 1.4.11)
  const onPrimary = readableOn(primary, [p.background, p.text, "#FFFFFF", "#0B0B0C"]);
  const accent = ensureContrast(p.accent, bg, 3);
  // Neutral layers move in OKLCH lightness from the brand's own background, so they keep its tint.
  const layer = (base: string, delta: number) => {
    const shifted = shiftLightness(base, delta);
    return pureNeutrals ? oklchToHex({ ...hexToOklch(shifted), c: 0 }) : shifted;
  };
  const surface = p.surface as Hex;
  const surfaceRaised = dark ? layer(surface, 0.04) : mix(surface, "#FFFFFF", 0.6);
  const surfaceSunken = layer(bg, dark ? -0.025 : -0.03);
  const chrome = layer(bg, dark ? -0.015 : -0.018);
  const soft = (c: Hex) => mix(surface, c, dark ? 0.22 : 0.12);
  const primarySoft = soft(primary);
  // Status colours are read on the plain surface and on their own soft fill (badges, notes):
  // the fill is tinted from the brand's colour, then the text is nudged until both pass 4.5:1.
  const status = (raw: string) => {
    const fill = soft(ensureContrast(raw, surface, 4.5));
    return [ensureContrast(ensureContrast(raw, surface, 4.5), fill, 4.5), fill] as const;
  };
  const [success, successSoft] = status(p.success);
  const [warning, warningSoft] = status(p.warning);
  const [danger, dangerSoft] = status(p.danger);
  const [info, infoSoft] = status(dark ? "#7DB3FF" : "#2563B8");
  return {
    primary,
    onPrimary: contrastRatio(onPrimary, primary) >= 4.5 ? onPrimary : readableOn(primary),
    primarySoft,
    onPrimarySoft: ensureContrast(dark ? withL(primary, 0.88) : primary, primarySoft, 4.5),
    accent,
    onAccent: readableOn(accent),
    background: bg,
    chrome,
    surface,
    surfaceRaised,
    surfaceSunken,
    scrim: alpha(dark ? "#000000" : tintedNeutral(p.text, 0.18), dark ? 0.6 : 0.36),
    hover: alpha(text, dark ? 0.08 : 0.05),
    pressed: alpha(text, dark ? 0.14 : 0.09),
    text,
    textMuted: ensureContrast(p.muted ?? mix(text, bg, 0.38), surfaceSunken, 4.5),
    border: ensureContrast(p.border ?? mix(text, bg, 0.86), bg, 1.25),
    borderStrong: ensureContrast(mix(text, bg, 0.62), surface, 3),
    focus: ensureContrast(p.accent, bg, 3),
    success,
    successSoft,
    warning,
    warningSoft,
    danger,
    dangerSoft,
    onDanger: readableOn(danger),
    info,
    infoSoft,
  };
}

/**
 * Chart series: start at the primary hue, then rotate around the wheel at a fixed
 * lightness/chroma so series are equally prominent and still on-brand.
 */
function chartPalette(c: ColorTokens, scheme: "light" | "dark"): Hex[] {
  const base = hexToOklch(c.primary);
  const accent = hexToOklch(c.accent);
  const l = scheme === "dark" ? 0.74 : 0.56;
  const hues = [base.c < 0.03 ? accent.h : base.h, accent.h + (Math.abs(accent.h - base.h) < 30 ? 150 : 0), base.h + 72, base.h + 216, base.h + 288, base.h + 144];
  return hues.map((h, i) => ensureContrast(oklchToHex({ l: i === 0 && base.c >= 0.03 ? Math.min(l, base.l + 0.1) : l, c: 0.13, h: ((h % 360) + 360) % 360 }), c.surface, 3));
}

function stack(family: string, fallback: string): string {
  return /[\s,]/.test(family) && !family.includes(",") ? `"${family}", ${fallback}` : `${family}, ${fallback}`;
}

/**
 * Resolves a stored brand theme into concrete tokens. Brand colours are kept,
 * but nudged where needed so every text and control pair passes WCAG AA.
 */
export function resolveTokens(theme: BrandTheme, systemScheme: "light" | "dark" = "light", opts: { reduceMotion?: boolean; native?: boolean } = {}): ThemeTokens {
  const scheme = theme.colorScheme === "system" ? systemScheme : theme.colorScheme;
  const palette = scheme === "dark" ? (theme.dark ?? deriveDark(theme.light)) : theme.light;
  const { base, ratio } = theme.type;
  const scale = (r: number): Scale => {
    const at = (n: number) => Math.round(base * r ** n);
    return { xs: at(-2), sm: at(-1), base, lg: at(1), xl: at(2), "2xl": at(3), "3xl": at(4), "4xl": at(5) };
  };
  const [sm, md, lg] = RADIUS[theme.radius];
  const unit = DENSITY[theme.density];
  const motionOn = theme.motion === "full" && !opts.reduceMotion;
  const family = (f: string, fb: string) => (opts.native ? f : stack(f, fb));
  const color = colors(palette, scheme, theme.neutrals === "pure");
  const dark = scheme === "dark";
  return {
    scheme,
    color,
    chart: chartPalette(color, scheme),
    font: {
      display: family(theme.fonts.display.family, "Georgia, serif"),
      body: family(theme.fonts.body.family, "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"),
      mono: family(theme.fonts.mono?.family ?? "ui-monospace", "SFMono-Regular, Menlo, Consolas, monospace"),
    },
    size: scale(Math.min(ratio, 1.2)),
    display: scale(ratio),
    space: (step: number) => Math.round(step * unit),
    radius: { sm, md, lg, pill: 999 },
    hit: theme.density === "compact" ? 44 : theme.density === "comfortable" ? 48 : 56,
    motion: { enabled: motionOn, fast: motionOn ? 140 : 0, base: motionOn ? 200 : 0, slow: motionOn ? 320 : 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    elevation: {
      overlay: dark ? "0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.5)" : "0 0 0 1px rgba(0,0,0,0.04), 0 8px 24px rgba(20,20,24,0.12)",
      float: dark ? "0 2px 8px rgba(0,0,0,0.45)" : "0 2px 8px rgba(20,20,24,0.10)",
    },
    z: { sticky: 10, dropdown: 20, scrim: 30, sheet: 40, toast: 50, tooltip: 60 },
    layout: theme.layout,
    terminology: theme.terminology,
  };
}

/** CSS custom properties for web / Electron (and for emails and receipts rendered as HTML). */
export function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const [k, v] of Object.entries(tokens.color)) vars[`--color-${kebab(k)}`] = v;
  tokens.chart.forEach((v, i) => (vars[`--chart-${i + 1}`] = v));
  for (const [k, v] of Object.entries(tokens.size)) vars[`--text-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(tokens.radius)) vars[`--radius-${k}`] = `${v}px`;
  vars["--font-display"] = tokens.font.display;
  vars["--font-body"] = tokens.font.body;
  vars["--font-mono"] = tokens.font.mono;
  vars["--ease-out"] = tokens.motion.easing;
  return vars;
}

/** W3C Design Tokens (DTCG 2025.10) export, so a brand can round-trip with Figma or Style Dictionary. */
export function toDesignTokens(tokens: ThemeTokens): Record<string, unknown> {
  const value = (type: string, v: string | number) => {
    if (typeof v === "number") return { value: v, unit: "px" };
    if (type !== "color" || !v.startsWith("#")) return v;
    const n = parseInt(v.slice(1), 16);
    return { colorSpace: "srgb", components: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => +(c / 255).toFixed(4)), hex: v };
  };
  const group = (type: string, entries: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(entries).filter(([, v]) => type !== "color" || String(v).startsWith("#")).map(([k, v]) => [k, { $type: type, $value: value(type, v) }]));
  return {
    color: group("color", tokens.color as unknown as Record<string, string>),
    chart: group("color", Object.fromEntries(tokens.chart.map((c, i) => [`series-${i + 1}`, c]))),
    fontFamily: group("fontFamily", tokens.font),
    fontSize: group("dimension", tokens.size),
    radius: group("dimension", tokens.radius),
  };
}

export function term(tokens: Pick<ThemeTokens, "terminology">, word: string): string {
  return tokens.terminology[word] ?? word;
}
