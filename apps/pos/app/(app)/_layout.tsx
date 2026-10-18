import { Redirect, Slot, usePathname, useRouter, type Href } from "expo-router";
import { ChartLineUp, CloudSlash, Package, Palette, ShoppingBag, UsersThree } from "@/ui/icons";
import { useEffect, type ComponentType } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Permission } from "@luxury-pos/core";
import { uuidv7 } from "@luxury-pos/core";
import { trackPageView } from "@sahan-sac/analytics-kit/client";
import { api } from "@/lib/api";
import { useCan, useMe, useStore } from "@/lib/queries";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Text, useLayout } from "@/ui/primitives";

type IconType = ComponentType<{ size?: number; color?: string; weight?: "light" | "regular" | "fill" }>;
const NAV: { href: Href; label: string; icon: IconType; permission: Permission }[] = [
  { href: "/", label: "Sell", icon: ShoppingBag, permission: "sale.create" },
  { href: "/clients", label: "Customer", icon: UsersThree, permission: "customer.read" },
  { href: "/inventory", label: "Stock", icon: Package, permission: "inventory.read" },
  { href: "/insights", label: "Insights", icon: ChartLineUp, permission: "reports.read" },
  { href: "/brand", label: "Brand", icon: Palette, permission: "store.branding" },
];

/** First launch on a till: register it so receipts get a per-device sequence. */
function useDevice() {
  const store = useStore();
  const { deviceId, set } = useSession();
  useEffect(() => {
    if (!store || deviceId) return;
    const id = uuidv7();
    api("/devices", { method: "POST", json: { id, storeId: store.id, name: `${Platform.OS} till`, platform: Platform.OS } })
      .then(() => set({ deviceId: id, storeId: store.id }))
      .catch(() => {});
  }, [store, deviceId, set]);
}

export default function AppLayout() {
  const t = useTokens();
  const term = useTerm();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  const tenantId = useSession((s) => s.tenantId);
  const me = useMe();
  const can = useCan();
  const pathname = usePathname();
  const router = useRouter();
  const pending = useOutbox((s) => s.items.length);
  useDevice();

  useEffect(() => {
    if (Platform.OS === "web") trackPageView(pathname);
  }, [pathname]);

  if (!tenantId || me.error) return <Redirect href="/sign-in" />;
  const items = NAV.filter((n) => can(n.permission));

  const nav = items.map((n) => {
    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(String(n.href));
    const Icon = n.icon;
    return (
      <Pressable
        key={String(n.href)}
        accessibilityRole="link"
        accessibilityLabel={term(n.label)}
        accessibilityState={{ selected: active }}
        onPress={() => router.navigate(n.href)}
        style={{ minWidth: t.hit, minHeight: t.hit, paddingHorizontal: wide ? t.space(3) : 0, paddingVertical: t.space(2), borderRadius: t.radius.md, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: active && wide ? t.color.surfaceRaised : "transparent", flex: wide ? undefined : 1 }}
      >
        <Icon size={24} weight={active ? "regular" : "light"} color={active ? t.color.primary : t.color.textMuted} />
        <Text variant="caption" tone={active ? "primary" : "muted"}>
          {term(n.label)}
        </Text>
      </Pressable>
    );
  });

  const offline = pending > 0 && (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: t.space(3), paddingVertical: 6, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceRaised, alignSelf: "center" }}>
      <CloudSlash size={16} color={t.color.warning} weight="light" />
      <Text variant="caption" tone="muted">
        {pending} to sync
      </Text>
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.color.background }}>
        <View accessibilityRole="menu" style={{ width: 96, paddingTop: insets.top + t.space(6), paddingBottom: insets.bottom + t.space(4), alignItems: "center", gap: t.space(2), borderRightWidth: 1, borderRightColor: t.color.border }}>
          {nav}
          <View style={{ flex: 1 }} />
          {offline}
        </View>
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.color.background }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <Slot />
      </View>
      {offline}
      <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingBottom: insets.bottom, paddingHorizontal: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
        {nav}
      </View>
    </View>
  );
}
