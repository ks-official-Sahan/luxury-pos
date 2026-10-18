import { brandThemeSchema, type BrandTheme, type BrandThemeInput } from "./schema";

const google = { kind: "google" } as const;
const system = { kind: "system" } as const;

const inputs = {
  maison: {
    name: "Maison Noir",
    light: { primary: "#111111", accent: "#A8834A", background: "#F7F4EE", surface: "#FFFFFF", text: "#141414" },
    dark: { primary: "#D8B878", accent: "#C9A46A", background: "#0D0D0E", surface: "#17171A", text: "#F2EEE6" },
    fonts: { display: { family: "Cormorant Garamond", source: google, weights: [500, 600] }, body: { family: "Manrope", source: google, weights: [400, 500, 600] } },
    type: { base: 16, ratio: 1.333 },
    radius: "subtle",
    density: "spacious",
    terminology: { Customer: "Client", Sale: "Purchase", Store: "Maison" },
  },
  atelier: {
    name: "Atelier Ivory",
    light: { primary: "#3B2F2A", accent: "#9B6B43", background: "#FBF8F3", surface: "#FFFFFF", text: "#2B2420" },
    fonts: { display: { family: "Playfair Display", source: google, weights: [500, 700] }, body: { family: "Manrope", source: google, weights: [400, 600] } },
    radius: "soft",
    density: "spacious",
    terminology: { Customer: "Client" },
  },
  modern: {
    name: "Modern Retail",
    light: { primary: "#1F4FFF", accent: "#00A389", background: "#F6F7F9", surface: "#FFFFFF", text: "#0F172A" },
    fonts: { display: { family: "Plus Jakarta Sans", source: google, weights: [600, 700] }, body: { family: "Plus Jakarta Sans", source: google, weights: [400, 500] } },
    radius: "soft",
    density: "comfortable",
  },
  cafe: {
    name: "Café Warm",
    light: { primary: "#7A3E1D", accent: "#E0A030", background: "#FFF9F2", surface: "#FFFFFF", text: "#2A1A10" },
    fonts: { display: { family: "Fraunces", source: google, weights: [600] }, body: { family: "Nunito Sans", source: google, weights: [400, 700] } },
    radius: "round",
    density: "compact",
    terminology: { Product: "Item" },
  },
  system: {
    name: "System",
    light: { primary: "#111827", accent: "#2563EB", background: "#FFFFFF", surface: "#F9FAFB", text: "#111827" },
    fonts: { display: { family: "System", source: system }, body: { family: "System", source: system } },
  },
} satisfies Record<string, BrandThemeInput>;

export type PresetId = keyof typeof inputs;

export const PRESETS: Record<PresetId, BrandTheme> = Object.fromEntries(
  Object.entries(inputs).map(([id, input]) => [id, brandThemeSchema.parse(input)]),
) as Record<PresetId, BrandTheme>;

export const DEFAULT_THEME = PRESETS.maison;
