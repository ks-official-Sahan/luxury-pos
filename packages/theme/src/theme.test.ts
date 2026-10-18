import { describe, expect, it } from "vitest";
import { brandThemeSchema, contrastRatio, ensureContrast, PRESETS, resolveTokens, toCssVariables } from "./index";

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
