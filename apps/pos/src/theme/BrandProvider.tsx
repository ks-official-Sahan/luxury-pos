import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";
import { DEFAULT_THEME, resolveTokens, toCssVariables, type BrandTheme, type ThemeTokens } from "@luxury-pos/theme";
import { loadBrandFonts } from "./fonts";

interface BrandContext {
  theme: BrandTheme;
  tokens: ThemeTokens;
  fontsReady: boolean;
  /** Live preview in the brand editor; `null` restores the store theme. */
  preview: (theme: BrandTheme | null) => void;
}

const Ctx = createContext<BrandContext | null>(null);

/**
 * Every colour, font, radius and density the app draws with comes from here,
 * resolved from the signed-in store's brand theme. Changing stores or editing
 * the brand re-themes the whole app at runtime: no rebuild, no per-brand binary.
 */
export function BrandProvider({ theme: storeTheme, children }: { theme: BrandTheme | null | undefined; children: ReactNode }) {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [reduceMotion, setReduceMotion] = useState(false);
  const [draft, setDraft] = useState<BrandTheme | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const theme = draft ?? storeTheme ?? DEFAULT_THEME;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let live = true;
    setFontsReady(false);
    loadBrandFonts(theme.fonts).finally(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, [theme.fonts]);

  const tokens = useMemo(() => resolveTokens(theme, system, { reduceMotion, native: Platform.OS !== "web" }), [theme, system, reduceMotion]);

  // Web and Electron also get CSS variables (scrollbars, selection, print receipts).
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(toCssVariables(tokens))) root.style.setProperty(k, v);
    root.style.colorScheme = tokens.scheme;
    document.body.style.backgroundColor = tokens.color.background;
  }, [tokens]);

  const value = useMemo(() => ({ theme, tokens, fontsReady, preview: setDraft }), [theme, tokens, fontsReady]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBrand outside BrandProvider");
  return ctx;
}

export const useTokens = () => useBrand().tokens;

/** Store-specific wording ("Client" for "Customer"). */
export function useTerm() {
  const { terminology } = useTokens();
  return (word: string) => terminology[word] ?? word;
}
