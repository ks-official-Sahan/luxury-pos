import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useStore } from "@/lib/queries";
import { useOutbox } from "@/state/outbox";
import { BrandProvider, useTokens } from "@/theme/BrandProvider";

function Themed() {
  const store = useStore();
  return (
    <BrandProvider theme={store?.theme}>
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
