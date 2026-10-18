import { brandThemeSchema, type BrandTheme, type BrandThemeInput } from "./schema";

const google = { kind: "google" } as const;
const system = { kind: "system" } as const;

const inputs = {
  maison: {
    name: "Maison Noir",
    // Dark-first: a boutique floor under gallery spotlights, screen angled toward the client.
    colorScheme: "dark",
    light: { primary: "#141416", accent: "#9C7A45", background: "#F5F5F6", surface: "#FFFFFF", text: "#111113" },
    dark: { primary: "#E2CC9C", accent: "#C9A46A", background: "#0E0E10", surface: "#18181B", text: "#F3F1EC" },
    fonts: { display: { family: "Cormorant Garamond", source: google, weights: [500, 600] }, body: { family: "Manrope", source: google, weights: [400, 500, 600, 700] } },
    type: { base: 16, ratio: 1.333 },
    radius: "subtle",
    density: "spacious",
    terminology: { Customer: "Client", Sale: "Purchase", Store: "Maison" },
  },
  atelier: {
    name: "Atelier Oxblood",
    light: { primary: "#5A1F2A", accent: "#8C6A3F", background: "#F4F4F5", surface: "#FFFFFF", text: "#1B1718" },
    fonts: { display: { family: "Playfair Display", source: google, weights: [500, 700] }, body: { family: "Manrope", source: google, weights: [400, 600, 700] } },
    radius: "soft",
    density: "spacious",
    terminology: { Customer: "Client" },
  },
  modern: {
    name: "Modern Retail",
    light: { primary: "#1F4FFF", accent: "#00A389", background: "#F3F5F8", surface: "#FFFFFF", text: "#0F172A" },
    fonts: { display: { family: "Plus Jakarta Sans", source: google, weights: [600, 700] }, body: { family: "Plus Jakarta Sans", source: google, weights: [400, 500, 600] } },
    radius: "soft",
    density: "comfortable",
  },
  cafe: {
    name: "Terracotta Café",
    light: { primary: "#9A3B1B", accent: "#C98A12", background: "#F7F6F5", surface: "#FFFFFF", text: "#24160F" },
    fonts: { display: { family: "Fraunces", source: google, weights: [600] }, body: { family: "Nunito Sans", source: google, weights: [400, 600, 700] } },
    radius: "round",
    density: "compact",
    terminology: { Product: "Item" },
    layout: { catalog: "grid", tileSize: "l", showImages: false },
  },
  system: {
    name: "System",
    neutrals: "pure",
    light: { primary: "#111827", accent: "#2563EB", background: "#F6F7F9", surface: "#FFFFFF", text: "#111827" },
    fonts: { display: { family: "System", source: system }, body: { family: "System", source: system } },
  },
} satisfies Record<string, BrandThemeInput>;

export type PresetId = keyof typeof inputs;

export const PRESETS: Record<PresetId, BrandTheme> = Object.fromEntries(
  Object.entries(inputs).map(([id, input]) => [id, brandThemeSchema.parse(input)]),
) as Record<PresetId, BrandTheme>;

export const DEFAULT_THEME = PRESETS.maison;
