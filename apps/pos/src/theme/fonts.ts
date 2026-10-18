import * as Font from "expo-font";
import { Platform } from "react-native";
import type { BrandTheme, FontSpec } from "@luxury-pos/theme";

const loaded = new Set<string>();

/** Family name used for a weight on native, where each weight is its own font file. */
export const nativeFamily = (family: string, weight: number) => `${family}-${weight}`;

function googleCss(spec: FontSpec): string {
  const weights = [...new Set(spec.weights)].sort((a, b) => a - b).join(";");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(spec.family).replace(/%20/g, "+")}:wght@${weights}&display=swap`;
}

async function loadWeb(spec: FontSpec) {
  if (spec.source.kind === "system" || typeof document === "undefined") return;
  if (spec.source.kind === "google") {
    const href = googleCss(spec);
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  } else {
    const face = new FontFace(spec.family, `url(${spec.source.url}) format("${spec.source.format === "ttf" ? "truetype" : spec.source.format}")`);
    (document.fonts as unknown as { add(f: FontFace): void }).add(await face.load());
  }
  await Promise.all(spec.weights.map((w) => document.fonts.load(`${w} 16px "${spec.family}"`))).catch(() => {});
}

/**
 * Native: Google's CSS API answers TrueType URLs to a generic user agent,
 * so each weight is fetched and registered as `${family}-${weight}`.
 */
async function loadNative(spec: FontSpec) {
  if (spec.source.kind === "system") return;
  if (spec.source.kind === "url") {
    for (const w of spec.weights) await Font.loadAsync({ [nativeFamily(spec.family, w)]: spec.source.url });
    return;
  }
  for (const w of spec.weights) {
    const name = nativeFamily(spec.family, w);
    if (loaded.has(name) || Font.isLoaded(name)) continue;
    const css = await (await fetch(googleCss({ ...spec, weights: [w] }), { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const url = /url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
    if (url) {
      await Font.loadAsync({ [name]: url });
      loaded.add(name);
    }
  }
}

/** Loads the brand's display, body and mono fonts; failures fall back to system fonts silently. */
export async function loadBrandFonts(fonts: BrandTheme["fonts"]): Promise<void> {
  const specs = [fonts.display, fonts.body, fonts.mono].filter((f): f is FontSpec => !!f);
  await Promise.all(specs.map((s) => (Platform.OS === "web" ? loadWeb(s) : loadNative(s)).catch(() => {})));
}
