import { contrastRatio, ensureContrast, mix, readableOn, type Hex } from "./color";
import type { BrandTheme, Palette } from "./schema";

export interface ColorTokens {
  primary: Hex;
  onPrimary: Hex;
  accent: Hex;
  onAccent: Hex;
  background: Hex;
  surface: Hex;
  surfaceRaised: Hex;
  text: Hex;
  textMuted: Hex;
  border: Hex;
  focus: Hex;
  success: Hex;
  warning: Hex;
  danger: Hex;
  onDanger: Hex;
}

export interface ThemeTokens {
  scheme: "light" | "dark";
  color: ColorTokens;
  font: { display: string; body: string; mono: string };
  /** Font sizes in px: xs, sm, base, lg, xl, 2xl, 3xl, 4xl. */
  size: Record<"xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl", number>;
  space: (step: number) => number;
  radius: { sm: number; md: number; lg: number; pill: number };
  /** Minimum touch target (px); raised for spacious stores. */
  hit: number;
  motion: { enabled: boolean; fast: number; base: number };
  terminology: Record<string, string>;
}

const RADIUS = { none: [0, 0, 0], subtle: [2, 4, 6], soft: [6, 10, 16], round: [10, 16, 24] } as const;
const DENSITY = { compact: 4, comfortable: 4.5, spacious: 5 } as const;

/** Dark palette derived from the light one when a brand gives none. */
export function deriveDark(light: Palette): Palette {
  const background = mix(light.text, "#000000", 0.55);
  const surface = mix(background, "#FFFFFF", 0.06);
  return {
    ...light,
    background,
    surface,
    text: mix(light.background, "#FFFFFF", 0.5),
    primary: ensureContrast(light.primary, background, 3),
    accent: ensureContrast(light.accent, background, 3),
    muted: undefined,
    border: undefined,
  };
}

function colors(p: Palette, scheme: "light" | "dark"): ColorTokens {
  const text = ensureContrast(p.text, p.background, 7);
  const primary = ensureContrast(p.primary, p.background, 3); // UI component contrast (WCAG 1.4.11)
  const onPrimary = readableOn(primary, [p.background, p.text, "#FFFFFF", "#0B0B0C"]);
  const accent = ensureContrast(p.accent, p.background, 3);
  const surfaceRaised = mix(p.surface, scheme === "light" ? "#FFFFFF" : "#FFFFFF", scheme === "light" ? 0.5 : 0.06);
  return {
    primary,
    onPrimary: contrastRatio(onPrimary, primary) >= 4.5 ? onPrimary : readableOn(primary),
    accent,
    onAccent: readableOn(accent),
    background: p.background as Hex,
    surface: p.surface as Hex,
    surfaceRaised,
    text,
    textMuted: ensureContrast(p.muted ?? mix(text, p.background, 0.4), p.surface, 4.5),
    border: ensureContrast(p.border ?? mix(text, p.background, 0.82), p.background, 1.3),
    focus: ensureContrast(p.accent, p.background, 3),
    success: ensureContrast(p.success, p.surface, 4.5),
    warning: ensureContrast(p.warning, p.surface, 4.5),
    danger: ensureContrast(p.danger, p.surface, 4.5),
    onDanger: readableOn(ensureContrast(p.danger, p.surface, 4.5)),
  };
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
  const at = (n: number) => Math.round(base * ratio ** n);
  const [sm, md, lg] = RADIUS[theme.radius];
  const unit = DENSITY[theme.density];
  const motionOn = theme.motion === "full" && !opts.reduceMotion;
  const family = (f: string, fb: string) => (opts.native ? f : stack(f, fb));
  return {
    scheme,
    color: colors(palette, scheme),
    font: {
      display: family(theme.fonts.display.family, "Georgia, serif"),
      body: family(theme.fonts.body.family, "system-ui, sans-serif"),
      mono: family(theme.fonts.mono?.family ?? "ui-monospace", "Menlo, monospace"),
    },
    size: { xs: at(-2), sm: at(-1), base, lg: at(1), xl: at(2), "2xl": at(3), "3xl": at(4), "4xl": at(5) },
    space: (step: number) => Math.round(step * unit),
    radius: { sm, md, lg, pill: 999 },
    hit: theme.density === "compact" ? 44 : theme.density === "comfortable" ? 48 : 56,
    motion: { enabled: motionOn, fast: motionOn ? 140 : 0, base: motionOn ? 220 : 0 },
    terminology: theme.terminology,
  };
}

/** CSS custom properties for web / Electron (and for emails and receipts rendered as HTML). */
export function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens.color)) vars[`--color-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v;
  for (const [k, v] of Object.entries(tokens.size)) vars[`--text-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(tokens.radius)) vars[`--radius-${k}`] = `${v}px`;
  vars["--font-display"] = tokens.font.display;
  vars["--font-body"] = tokens.font.body;
  vars["--font-mono"] = tokens.font.mono;
  return vars;
}

export function term(tokens: Pick<ThemeTokens, "terminology">, word: string): string {
  return tokens.terminology[word] ?? word;
}
