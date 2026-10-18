import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Slot, usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "@luxury-pos/core";
import { trackPageView } from "@sahan-sac/analytics-kit/client";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useCan, useMe, useStore } from "@/lib/queries";
import { CommandPalette } from "@/shell/CommandPalette";
import { LockScreen, useIdleLock } from "@/shell/LockScreen";
import { isActive, NAV, type NavItem } from "@/shell/nav";
import { StoreSwitcher } from "@/shell/StoreSwitcher";
import { SyncStatus } from "@/shell/SyncStatus";
import { useUi } from "@/shell/ui-state";
import { modKey, useShortcuts } from "@/shell/useShortcuts";
import { useCart } from "@/state/cart";
import { useSession } from "@/state/session";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { DotsThree, Lock, MagnifyingGlass, SidebarSimple, SignOut } from "@/ui/icons";
import { Avatar, focusRing, IconButton, Kbd, Text, useLayout } from "@/ui/primitives";
import { Sheet } from "@/ui/Sheet";
import { Toaster } from "@/ui/toast";

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

function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await authClient.signOut().catch(() => {});
    useUi.getState().set({ locked: false });
    useCart.getState().clear();
    useSession.getState().clear();
    qc.clear();
    router.replace("/sign-in");
  };
}

function useNavItems() {
  const can = useCan();
  const term = useTerm();
  return NAV.map((g) => ({
    group: g.group,
    items: g.items.filter((i) => i.permission === null || can(i.permission)).map((i) => ({ ...i, text: i.plural ? `${term(i.label)}s` : term(i.label) })),
  })).filter((g) => g.items.length);
}

type ShownItem = NavItem & { text: string };

function NavLink({ item, active, collapsed, onPress }: { item: ShownItem; active: boolean; collapsed: boolean; onPress: () => void }) {
  const t = useTokens();
  const Icon = item.icon;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={item.text}
      accessibilityState={{ selected: active }}
      aria-current={active ? "page" : undefined}
      onPress={onPress}
      style={({ hovered, focused }: { hovered?: boolean; focused?: boolean; pressed: boolean }) =>
        ({
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: collapsed ? 2 : t.space(3),
          minHeight: collapsed ? 56 : 40,
          paddingHorizontal: collapsed ? 0 : t.space(3),
          borderRadius: t.radius.md,
          backgroundColor: active ? t.color.primarySoft : hovered ? t.color.hover : "transparent",
          ...focusRing(t, focused),
        }) as ViewStyle
      }
    >
      <Icon size={collapsed ? 22 : 20} weight={active ? "fill" : "regular"} color={active ? t.color.onPrimarySoft : t.color.textMuted} />
      <Text variant={collapsed ? "caption" : "label"} tone={active ? "onPrimarySoft" : "text"} numberOfLines={1} style={{ flex: collapsed ? undefined : 1, fontWeight: active ? "600" : "500" }}>
        {item.text}
      </Text>
      {!collapsed && item.shortcut && Platform.OS === "web" ? (
        <Text variant="caption" tone="muted" style={{ opacity: 0.7 }}>
          {`${modKey} ${item.shortcut}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Sidebar({ collapsed, canCollapse }: { collapsed: boolean; canCollapse: boolean }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const groups = useNavItems();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const set = useUi((s) => s.set);
  const signOut = useSignOut();

  return (
    <View accessibilityRole="navigation" style={{ width: collapsed ? 84 : 248, backgroundColor: t.color.chrome, borderRightWidth: 1, borderRightColor: t.color.border, paddingTop: insets.top + t.space(3), paddingBottom: insets.bottom + t.space(3), paddingHorizontal: t.space(collapsed ? 2 : 3) }}>
      <StoreSwitcher collapsed={collapsed} />
      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search and commands"
        onPress={() => set({ paletteOpen: true })}
        style={({ hovered, focused }: { hovered?: boolean; focused?: boolean; pressed: boolean }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: t.space(2),
            marginTop: t.space(3),
            minHeight: 40,
            paddingHorizontal: collapsed ? 0 : t.space(3),
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: t.color.border,
            backgroundColor: hovered ? t.color.hover : t.color.surface,
            ...focusRing(t, focused),
          }) as ViewStyle
        }
      >
        <MagnifyingGlass size={18} color={t.color.textMuted} />
        {collapsed ? null : (
          <>
            <Text variant="label" tone="muted" style={{ flex: 1 }}>
              Search
            </Text>
            <Kbd>{`${modKey} K`}</Kbd>
          </>
        )}
      </Pressable>

      <ScrollView style={{ flex: 1, marginTop: t.space(4) }} contentContainerStyle={{ gap: t.space(5) }}>
        {groups.map((g) => (
          <View key={g.group} style={{ gap: 2 }}>
            {collapsed ? <View style={{ height: 1, backgroundColor: t.color.border, marginHorizontal: t.space(2), marginBottom: t.space(2) }} /> : (
              <Text variant="caption" tone="muted" style={{ paddingHorizontal: t.space(3), marginBottom: t.space(1), fontWeight: "600" }}>
                {g.group}
              </Text>
            )}
            {g.items.map((i) => (
              <NavLink key={String(i.href)} item={i} collapsed={collapsed} active={isActive(i.href, pathname)} onPress={() => router.navigate(i.href)} />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={{ gap: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: t.space(3), alignItems: collapsed ? "center" : "stretch" }}>
        <View style={{ paddingHorizontal: collapsed ? 0 : t.space(2) }}>
          <SyncStatus compact={collapsed} />
        </View>
        <View style={{ flexDirection: collapsed ? "column" : "row", alignItems: "center", gap: t.space(2), paddingHorizontal: collapsed ? 0 : t.space(1) }}>
          <Avatar name={me.data?.me.name ?? me.data?.me.email ?? "?"} />
          {collapsed ? null : (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1}>
                {me.data?.me.name ?? me.data?.me.email ?? ""}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {me.data ? me.data.me.role.charAt(0) + me.data.me.role.slice(1).toLowerCase() : ""}
              </Text>
            </View>
          )}
          <IconButton label={`Lock till (${modKey} L)`} size="sm" onPress={() => useUi.getState().set({ locked: true })}>
            <Lock size={18} color={t.color.textMuted} />
          </IconButton>
          <IconButton label="Sign out" size="sm" onPress={() => void signOut()}>
            <SignOut size={18} color={t.color.textMuted} />
          </IconButton>
        </View>
        {Platform.OS === "web" && canCollapse ? (
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} size="sm" onPress={() => set({ sidebarCollapsed: !collapsed })}>
            <SidebarSimple size={18} color={t.color.textMuted} />
          </IconButton>
        ) : null}
      </View>
    </View>
  );
}

/** Phone: the four floor tasks in thumb reach, everything else under More. */
function TabBar() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const groups = useNavItems();
  const pathname = usePathname();
  const router = useRouter();
  const signOut = useSignOut();
  const [more, setMore] = useState(false);
  const floor = groups.find((g) => g.group === "Floor")?.items ?? [];
  const manage = groups.find((g) => g.group === "Manage")?.items ?? [];
  const tab = (i: ShownItem) => {
    const active = isActive(i.href, pathname);
    const Icon = i.icon;
    return (
      <Pressable key={String(i.href)} accessibilityRole="tab" accessibilityLabel={i.text} accessibilityState={{ selected: active }} onPress={() => router.navigate(i.href)} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 56 }}>
        <Icon size={24} weight={active ? "fill" : "regular"} color={active ? t.color.primary : t.color.textMuted} />
        <Text variant="caption" tone={active ? "primary" : "muted"} style={{ fontWeight: active ? "600" : "500" }}>
          {i.text}
        </Text>
      </Pressable>
    );
  };
  return (
    <>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingBottom: insets.bottom, borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.chrome }}>
        {floor.map(tab)}
        <Pressable accessibilityRole="tab" accessibilityLabel="More" onPress={() => setMore(true)} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 56 }}>
          <DotsThree size={24} color={manage.some((i) => isActive(i.href, pathname)) ? t.color.primary : t.color.textMuted} weight="bold" />
          <Text variant="caption" tone="muted">
            More
          </Text>
        </Pressable>
      </View>
      <Sheet visible={more} onClose={() => setMore(false)} title="More">
        <StoreSwitcher />
        <SyncStatus />
        <View style={{ gap: 2 }}>
          {manage.map((i) => (
            <NavLink key={String(i.href)} item={i} collapsed={false} active={isActive(i.href, pathname)} onPress={() => (setMore(false), router.navigate(i.href))} />
          ))}
        </View>
        <NavLink item={{ href: "/", label: "Lock till", text: "Lock till", icon: Lock, permission: null }} collapsed={false} active={false} onPress={() => (setMore(false), useUi.getState().set({ locked: true }))} />
        <NavLink item={{ href: "/sign-in", label: "Sign out", text: "Sign out", icon: SignOut, permission: null }} collapsed={false} active={false} onPress={() => void signOut()} />
      </Sheet>
    </>
  );
}

export default function AppLayout() {
  const t = useTokens();
  const { bp } = useLayout();
  const insets = useSafeAreaInsets();
  const tenantId = useSession((s) => s.tenantId);
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const groups = useNavItems();
  const collapsedPref = useUi((s) => s.sidebarCollapsed);
  const setUi = useUi((s) => s.set);
  const signOut = useSignOut();
  const touched = useIdleLock();
  useDevice();

  useEffect(() => {
    if (Platform.OS === "web") trackPageView(pathname);
  }, [pathname]);

  const shortcuts: Record<string, () => void> = { "mod+k": () => setUi({ paletteOpen: !useUi.getState().paletteOpen }), "mod+l": () => setUi({ locked: true }) };
  for (const i of groups.flatMap((g) => g.items)) if (i.shortcut) shortcuts[`mod+${i.shortcut}`] = () => router.navigate(i.href);
  useShortcuts(shortcuts);

  if (!tenantId || me.error) return <Redirect href="/sign-in" />;

  const content = (
    <View style={{ flex: 1, backgroundColor: t.color.background }}>
      <Slot />
    </View>
  );

  return (
    <View onTouchStart={touched} style={{ flex: 1, flexDirection: bp === "phone" ? "column" : "row", backgroundColor: t.color.background }}>
      {bp === "phone" ? (
        <>
          <View style={{ flex: 1, paddingTop: insets.top }}>{content}</View>
          <TabBar />
        </>
      ) : (
        <>
          <Sidebar collapsed={bp === "tablet" || collapsedPref} canCollapse={bp === "desktop"} />
          {content}
        </>
      )}
      <CommandPalette />
      <Toaster />
      <LockScreen onSignOut={() => void signOut()} />
    </View>
  );
}
