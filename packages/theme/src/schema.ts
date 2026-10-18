import { z } from "zod";
import { isHex } from "./color";

const hex = z.string().refine(isHex, "expected #rgb or #rrggbb");

/** Brand input a store owner edits. Everything else is derived. */
export const paletteSchema = z.object({
  primary: hex,
  accent: hex,
  background: hex,
  surface: hex,
  text: hex,
  /** Optional overrides; derived from the rest when absent. */
  muted: hex.optional(),
  border: hex.optional(),
  success: hex.default("#1F8A5B"),
  warning: hex.default("#B7791F"),
  danger: hex.default("#C0392B"),
});
export type Palette = z.infer<typeof paletteSchema>;

export const fontSchema = z.object({
  /** CSS/Native family name, e.g. "Cormorant Garamond". */
  family: z.string().min(1).max(64),
  /** Google Fonts family or a media-kit asset URL (woff2/ttf). System fonts need neither. */
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("system") }),
    z.object({ kind: z.literal("google") }),
    z.object({ kind: z.literal("url"), url: z.url(), format: z.enum(["woff2", "ttf", "otf"]) }),
  ]),
  weights: z.array(z.number().int().min(100).max(900)).min(1).max(6).default([400, 600]),
});
export type FontSpec = z.infer<typeof fontSchema>;

export const brandThemeSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).max(60),
  light: paletteSchema,
  dark: paletteSchema.optional(),
  /** "system" follows the device; a store can pin one for its look. */
  colorScheme: z.enum(["system", "light", "dark"]).default("system"),
  fonts: z.object({ display: fontSchema, body: fontSchema, mono: fontSchema.optional() }),
  /** Base body size in px and modular scale ratio (1.2 minor third .. 1.5 perfect fifth). */
  type: z.object({ base: z.number().min(12).max(22).default(16), ratio: z.number().min(1.1).max(1.6).default(1.25) }).default({ base: 16, ratio: 1.25 }),
  radius: z.enum(["none", "subtle", "soft", "round"]).default("soft"),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  motion: z.enum(["full", "reduced", "none"]).default("full"),
  logo: z.object({ light: z.url().optional(), dark: z.url().optional(), mark: z.url().optional() }).default({}),
  /** Rename domain words per vertical: "Client" for "Customer", "Atelier" for "Store". */
  terminology: z.record(z.string().max(32), z.string().max(32)).default({}),
  receipt: z
    .object({
      header: z.string().max(280).default(""),
      footer: z.string().max(280).default(""),
      showLogo: z.boolean().default(true),
      paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
    })
    .default({ header: "", footer: "", showLogo: true, paperWidthMm: 80 }),
});
export type BrandTheme = z.infer<typeof brandThemeSchema>;
export type BrandThemeInput = z.input<typeof brandThemeSchema>;
