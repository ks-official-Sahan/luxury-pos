import { describe, expect, it } from "vitest";
import { brandThemeSchema, contrastRatio, ensureContrast, hexToOklch, oklchToHex, PRESETS, resolveTokens, tintedNeutral, toCssVariables, toDesignTokens, toRgb } from "./index";

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
  it("nudges a weak brand colour to pass", () => {
    const fixed = ensureContrast("#F5D76E", "#FFFFFF", 4.5);
    expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens", () => {
  it.each(Object.keys(PRESETS))("preset %s passes AA in light and dark", (id) => {
    for (const scheme of ["light", "dark"] as const) {
      const t = resolveTokens({ ...PRESETS[id as keyof typeof PRESETS], colorScheme: scheme });
      expect(contrastRatio(t.color.text, t.color.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.onPrimary, t.color.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.textMuted, t.color.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("rejects bad input and fills defaults", () => {
    expect(brandThemeSchema.safeParse({ name: "x", light: { primary: "red" } }).success).toBe(false);
    const theme = brandThemeSchema.parse({
      name: "Shop",
      light: { primary: "#000", accent: "#c00", background: "#fff", surface: "#fff", text: "#000" },
      fonts: { display: { family: "Inter", source: { kind: "google" } }, body: { family: "Inter", source: { kind: "google" } } },
    });
    expect(theme.density).toBe("comfortable");
    expect(toCssVariables(resolveTokens(theme))["--color-on-primary"]).toBeDefined();
  });
  it("honours reduced motion", () => {
    expect(resolveTokens(PRESETS.maison, "light", { reduceMotion: true }).motion.enabled).toBe(false);
  });
});

describe("oklch", () => {
  it("round-trips sRGB within one step", () => {
    for (const hex of ["#000000", "#ffffff", "#1f4fff", "#9a3b1b", "#e2cc9c", "#808080"]) {
      const back = oklchToHex(hexToOklch(hex));
      const diff = toRgb(back).map((v, i) => Math.abs(v - toRgb(hex)[i]!));
      expect(Math.max(...diff)).toBeLessThanOrEqual(1);
    }
  });
  it("clips out-of-gamut chroma instead of shifting hue or lightness", () => {
    const hex = oklchToHex({ l: 0.6, c: 0.4, h: 140 });
    expect(hexToOklch(hex).l).toBeCloseTo(0.6, 2);
    expect(Math.abs(hexToOklch(hex).h - 140)).toBeLessThan(3);
  });
  it("keeps greys grey and tints neutrals only for chromatic brands", () => {
    expect(hexToOklch(tintedNeutral("#777777", 0.5)).c).toBeLessThan(0.002);
    expect(hexToOklch(tintedNeutral("#5A1F2A", 0.5)).c).toBeGreaterThan(0.004);
  });
});

describe("semantic roles", () => {
  it.each(Object.keys(PRESETS))("preset %s: soft fills, status and chart colours stay legible", (id) => {
    for (const scheme of ["light", "dark"] as const) {
      const t = resolveTokens({ ...PRESETS[id as keyof typeof PRESETS], colorScheme: scheme });
      expect(contrastRatio(t.color.onPrimarySoft, t.color.primarySoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.color.textMuted, t.color.surfaceSunken)).toBeGreaterThanOrEqual(4.5);
      for (const k of ["success", "warning", "danger", "info"] as const) expect(contrastRatio(t.color[k], t.color.surface)).toBeGreaterThanOrEqual(4.5);
      expect(t.chart).toHaveLength(6);
      for (const c of t.chart) expect(contrastRatio(c, t.color.surface)).toBeGreaterThanOrEqual(3);
    }
  });
  it("uses a tighter UI scale than the brand display scale", () => {
    const t = resolveTokens(PRESETS.maison);
    expect(t.size["2xl"]).toBeLessThan(t.display["2xl"]);
  });
  it("exports DTCG tokens with sRGB components", () => {
    const d = toDesignTokens(resolveTokens(PRESETS.modern)) as { color: Record<string, { $type: string; $value: { colorSpace: string } }> };
    expect(d.color.primary!.$type).toBe("color");
    expect(d.color.primary!.$value.colorSpace).toBe("srgb");
  });
  it("defaults the register layout for older stored themes", () => {
    const legacy = { ...PRESETS.system } as Record<string, unknown>;
    delete legacy.layout;
    expect(brandThemeSchema.parse(legacy).layout.ticketSide).toBe("right");
  });
});
