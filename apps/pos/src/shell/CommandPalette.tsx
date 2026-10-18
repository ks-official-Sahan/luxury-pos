import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import React, { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Modal, Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useCan, useStore } from "@/lib/queries";
import { useCart, type CatalogItem } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { ArrowRight, MagnifyingGlass, Package, UserCircle } from "@/ui/icons";
import { Kbd, Text, useLayout } from "@/ui/primitives";
import { toast } from "@/ui/toast";
import { NAV } from "./nav";
import { useUi } from "./ui-state";
import { modKey } from "./useShortcuts";

type Entry = { id: string; group: string; label: string; hint?: string; icon?: ReactNode; run: () => void };

/**
 * ⌘K / Ctrl+K: jump anywhere, add an item to the sale, open a client, run an action.
 * Everything a role cannot use is left out, not disabled.
 */
export function CommandPalette() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const router = useRouter();
  const store = useStore();
  const { wide } = useLayout();
  const open = useUi((s) => s.paletteOpen);
  const set = useUi((s) => s.set);
  const add = useCart((s) => s.add);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const deferred = useDeferredValue(q.trim());
  const close = () => (set({ paletteOpen: false }), setQ(""), setCursor(0));

  const products = useQuery({
    queryKey: ["palette", "catalog", store?.id, deferred],
    queryFn: ({ signal }) => api<CatalogItem[]>(`/catalog/search?${new URLSearchParams({ q: deferred, limit: "5", ...(store ? { storeId: store.id } : {}) })}`, { signal }),
    enabled: open && deferred.length >= 2 && can("sale.create"),
    staleTime: 15_000,
  });
  const clients = useQuery({
    queryKey: ["palette", "clients", deferred],
    queryFn: ({ signal }) => api<{ id: string; firstName: string; lastName: string | null; email: string | null }[]>(`/customers?q=${encodeURIComponent(deferred)}`, { signal }),
    enabled: open && deferred.length >= 2 && can("customer.read"),
    staleTime: 15_000,
  });

  const entries = useMemo<Entry[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const go = (href: Href) => () => (close(), router.navigate(href));
    const nav = NAV.flatMap((g) =>
      g.items
        .filter((i) => i.permission === null || can(i.permission))
        .map((i) => ({ i, label: i.plural ? `${term(i.label)}s` : term(i.label) }))
        .filter(({ i, label }) => match(`${label} ${i.keywords ?? ""}`))
        .map(({ i, label }) => ({ id: `nav:${String(i.href)}`, group: "Go to", label, hint: i.shortcut && Platform.OS === "web" ? `${modKey} ${i.shortcut}` : undefined, icon: <i.icon size={18} color={t.color.textMuted} />, run: go(i.href) })),
    );
    const actions: Entry[] = [
      { id: "a:new", group: "Actions", label: "Start a new sale", run: () => (useCart.getState().clear(), go("/")()) },
      { id: "a:sidebar", group: "Actions", label: "Collapse or expand the sidebar", run: () => (set({ sidebarCollapsed: !useUi.getState().sidebarCollapsed }), close()) },
    ].filter((a) => match(a.label));
    const items: Entry[] = (products.data ?? []).map((p) => ({
      id: `p:${p.variantId}`,
      group: "Add to sale",
      label: [p.name, ...Object.values(p.options)].join(" · "),
      hint: store ? formatMoney(p.price, store.currency) : undefined,
      icon: <Package size={18} color={t.color.textMuted} />,
      run: () => (add(p), toast.success(`${p.name} added`), close(), router.navigate("/")),
    }));
    const people: Entry[] = (clients.data ?? []).slice(0, 5).map((c) => ({
      id: `c:${c.id}`,
      group: `${term("Customer")}s`,
      label: [c.firstName, c.lastName].filter(Boolean).join(" "),
      hint: c.email ?? undefined,
      icon: <UserCircle size={18} color={t.color.textMuted} />,
      run: go({ pathname: "/clients", params: { id: c.id } }),
    }));
    return [...items, ...people, ...nav, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, products.data, clients.data, can, term, store, t]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  const onKey = (e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    const k = e.nativeEvent.key;
    if (k === "ArrowDown") (e.preventDefault?.(), setCursor((c) => Math.min(entries.length - 1, c + 1)));
    else if (k === "ArrowUp") (e.preventDefault?.(), setCursor((c) => Math.max(0, c - 1)));
    else if (k === "Enter") entries[cursor]?.run();
    else if (k === "Escape") close();
  };

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close}>
      <Pressable accessibilityLabel="Close search" onPress={close} style={{ flex: 1, backgroundColor: t.color.scrim, alignItems: "center", paddingTop: wide ? "12%" : 0 }}>
        <Pressable
          role="dialog"
          aria-label="Search and commands"
          onPress={(e) => e.stopPropagation()}
          style={{
            width: wide ? 620 : "100%",
            maxWidth: "100%",
            maxHeight: wide ? 480 : "100%",
            flex: wide ? undefined : 1,
            backgroundColor: t.color.surface,
            borderRadius: wide ? t.radius.lg : 0,
            borderWidth: wide ? 1 : 0,
            borderColor: t.color.border,
            overflow: "hidden",
            ...(Platform.OS === "web" ? ({ boxShadow: t.elevation.overlay } as object) : {}),
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.space(3), paddingHorizontal: t.space(4), minHeight: 56, borderBottomWidth: 1, borderBottomColor: t.color.border }}>
            <MagnifyingGlass size={20} color={t.color.textMuted} />
            <TextInput
              ref={input}
              value={q}
              onChangeText={setQ}
              onKeyPress={onKey as never}
              onSubmitEditing={() => entries[cursor]?.run()}
              placeholder={`Search items, ${term("Customer").toLowerCase()}s, pages…`}
              placeholderTextColor={t.color.textMuted}
              accessibilityLabel="Search"
              autoCorrect={false}
              autoCapitalize="none"
              style={{ flex: 1, fontSize: t.size.lg, color: t.color.text, minHeight: 48, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}) }}
            />
            <Kbd>Esc</Kbd>
          </View>
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text tone="muted" style={{ padding: t.space(5), textAlign: "center" }}>
                Nothing matches “{q}”.
              </Text>
            }
            renderItem={({ item, index }) => {
              const showGroup = index === 0 || entries[index - 1]!.group !== item.group;
              const on = index === cursor;
              return (
                <View>
                  {showGroup ? (
                    <Text variant="caption" tone="muted" style={{ paddingHorizontal: t.space(4), paddingTop: t.space(3), paddingBottom: t.space(1), fontWeight: "600" }}>
                      {item.group}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={item.run}
                    {...(Platform.OS === "web" ? { onHoverIn: () => setCursor(index) } : {})}
                    style={{ flexDirection: "row", alignItems: "center", gap: t.space(3), marginHorizontal: t.space(2), paddingHorizontal: t.space(3), minHeight: 44, borderRadius: t.radius.md, backgroundColor: on ? t.color.primarySoft : "transparent" } as ViewStyle}
                  >
                    {item.icon ?? <ArrowRight size={18} color={t.color.textMuted} />}
                    <Text variant="label" tone={on ? "onPrimarySoft" : "text"} style={{ flex: 1 }} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {item.hint ? (
                      <Text variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                        {item.hint}
                      </Text>
                    ) : null}
                  </Pressable>
                </View>
              );
            }}
            contentContainerStyle={{ paddingBottom: t.space(2) }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
