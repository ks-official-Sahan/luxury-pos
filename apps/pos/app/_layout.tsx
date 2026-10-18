import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { BrandTheme } from "@luxury-pos/theme";
import { api } from "@/lib/api";
import { useSession } from "@/state/session";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useStore } from "@/lib/queries";
import { useOutbox } from "@/state/outbox";
import { BrandProvider, useTokens } from "@/theme/BrandProvider";

/** Signed in: the store's theme. Signed out: the last business's public brand (or `?brand=slug` on web). */
function usePublicBrand(enabled: boolean) {
  const remembered = useSession((s) => s.brandSlug);
  const fromUrl = Platform.OS === "web" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("brand") : null;
  const slug = fromUrl ?? remembered;
  return useQuery({ queryKey: ["public-brand", slug], queryFn: () => api<{ name: string; theme: BrandTheme }>(`/public/brand/${slug}`), enabled: enabled && !!slug, staleTime: 3_600_000, retry: false });
}

function Themed() {
  const store = useStore();
  const brand = usePublicBrand(!store);
  return (
    <BrandProvider theme={store?.theme ?? brand.data?.theme}>
      <Chrome />
    </BrandProvider>
  );
}

function Chrome() {
  const t = useTokens();
  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.color.background }, animation: t.motion.enabled ? "fade" : "none" }} />
    </>
  );
}

/** Replays queued offline sales when the app comes back to the foreground or the network returns. */
function useOutboxPump() {
  useEffect(() => {
    const flush = () => void useOutbox.getState().flush();
    const timer = setInterval(flush, 15_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && flush());
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("online", flush);
    flush();
    return () => {
      clearInterval(timer);
      sub.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("online", flush);
    };
  }, []);
}

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  useOutboxPump();
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <Themed />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
