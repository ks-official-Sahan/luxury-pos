import React, { memo, useCallback, useDeferredValue, useRef, useState } from "react";
import { FlatList, Image, Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import { useCatalogSearch, useStore } from "@/lib/queries";
import { useShortcuts } from "@/shell/useShortcuts";
import { useCart, type CatalogItem } from "@/state/cart";
import { useBrand } from "@/theme/BrandProvider";
import { Barcode, GridFour, ListBullets, MagnifyingGlass } from "@/ui/icons";
import { Badge, EmptyState, Field, focusRing, Kbd, Money, Segmented, Skeleton, Text, useLayout } from "@/ui/primitives";
import { toast } from "@/ui/toast";

type View_ = "grid" | "list";

const stockBadge = (available: number | undefined, show: boolean) => {
  if (!show || available === undefined) return null;
  if (available <= 0) return <Badge tone="danger" label="Out of stock" />;
  if (available <= 2) return <Badge tone="warning" label={`${available} left`} />;
  return null;
};

const Tile = memo(function Tile({ item, currency, onAdd, size, showImages: imagesOn, showStock }: { item: CatalogItem; currency: string; onAdd: (i: CatalogItem) => void; size: "s" | "m" | "l"; showImages: boolean; showStock: boolean }) {
  const { tokens: t } = useBrand();
  const options = Object.values(item.options).join(" · ");
  const out = item.available !== undefined && item.available <= 0;
  // No photo on file: a text tile reads better than an empty placeholder square.
  const showImages = imagesOn && !!item.imageUrl;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${options ? `, ${options}` : ""}, ${out ? "out of stock" : item.available !== undefined ? `${item.available} in stock` : ""}`}
      accessibilityHint="Adds to the sale"
      onPress={() => onAdd(item)}
      style={({ hovered, pressed, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) =>
        ({
          flex: 1,
          margin: t.space(1),
          borderRadius: t.radius.lg,
          backgroundColor: t.color.surface,
          borderWidth: 1,
          borderColor: hovered ? t.color.borderStrong : t.color.border,
          overflow: "hidden",
          opacity: out ? 0.6 : 1,
          transform: [{ scale: pressed && t.motion.enabled ? 0.98 : 1 }],
          ...focusRing(t, focused),
          ...(Platform.OS === "web" ? { transitionProperty: "border-color, transform", transitionDuration: `${t.motion.fast}ms`, cursor: "pointer" } : {}),
        }) as ViewStyle
      }
    >
      {showImages ? (
        <View style={{ aspectRatio: 1, backgroundColor: t.color.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
          <Image source={{ uri: item.imageUrl! }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
          <View style={{ position: "absolute", top: 8, left: 8 }}>{stockBadge(item.available, showStock)}</View>
        </View>
      ) : null}
      <View style={{ padding: t.space(size === "s" ? 2 : 3), gap: 2, minHeight: showImages ? undefined : size === "l" ? 120 : 92, justifyContent: "space-between" }}>
        <View style={{ gap: 2 }}>
          {item.brand ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {item.brand}
            </Text>
          ) : null}
          <Text variant={size === "l" ? "subheading" : "label"} numberOfLines={2} style={{ fontWeight: "600" }}>
            {item.name}
          </Text>
          {options ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {options}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: t.space(2), gap: 6 }}>
          <Money amount={item.price} currency={currency} variant="label" style={{ fontWeight: "600" }} />
          {!showImages ? stockBadge(item.available, showStock) : null}
        </View>
      </View>
    </Pressable>
  );
});

const ListRow = memo(function ListRow({ item, currency, onAdd, showStock }: { item: CatalogItem; currency: string; onAdd: (i: CatalogItem) => void; showStock: boolean }) {
  const { tokens: t } = useBrand();
  const options = Object.values(item.options).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${options ? `, ${options}` : ""}`}
      accessibilityHint="Adds to the sale"
      onPress={() => onAdd(item)}
      style={({ hovered, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) =>
        ({ flexDirection: "row", alignItems: "center", gap: t.space(3), minHeight: t.hit + 8, paddingHorizontal: t.space(4), borderBottomWidth: 1, borderBottomColor: t.color.border, backgroundColor: hovered ? t.color.hover : "transparent", ...focusRing(t, focused) }) as ViewStyle
      }
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
          {item.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {[item.brand, options, item.sku].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {stockBadge(item.available, showStock) ?? (showStock && item.available !== undefined ? <Text variant="caption" tone="muted">{item.available} in stock</Text> : null)}
      <Money amount={item.price} currency={currency} variant="label" style={{ minWidth: 88, textAlign: "right", fontWeight: "600" }} />
    </Pressable>
  );
});

/**
 * The search field doubles as the scanner input: USB/Bluetooth scanners type the
 * code and press Enter, which adds an exact SKU match straight to the sale.
 * `/` focuses it from anywhere on desktop.
 */
export function CatalogGrid({ width }: { width: number }) {
  const { tokens: t, theme } = useBrand();
  const { bp } = useLayout();
  const store = useStore();
  const add = useCart((s) => s.add);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View_>(theme.layout.catalog);
  const deferred = useDeferredValue(query);
  const { data, isFetching, isLoading } = useCatalogSearch(deferred);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const size = theme.layout.tileSize;
  const min = { s: 150, m: bp === "desktop" ? 196 : 176, l: 236 }[size];
  const columns = Math.max(2, Math.floor((width - 16) / min));
  const onAdd = useCallback(
    (i: CatalogItem) => {
      if (i.available !== undefined && i.available <= 0 && i.serialized) return toast.error(`${i.name} is not in stock here`);
      add(i);
    },
    [add],
  );
  useShortcuts({ "/": () => input.current?.focus() });

  const onSubmit = () => {
    const code = query.trim();
    const exact = data?.find((d) => d.sku === code || d.variantId === code);
    if (exact) {
      onAdd(exact);
      setQuery("");
    } else if (data?.length === 1) {
      onAdd(data[0]!);
      setQuery("");
    }
  };

  const currency = store?.currency ?? "USD";
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space(2), padding: t.space(3), paddingBottom: t.space(2) }}>
        <Field
          ref={input}
          label="Search or scan an item"
          hideLabel
          size="lg"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSubmit}
          placeholder={bp === "phone" ? "Search or scan" : "Search name, SKU or scan"}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          blurOnSubmit={false}
          leading={isFetching ? <Barcode size={20} color={t.color.primary} /> : <MagnifyingGlass size={20} color={t.color.textMuted} />}
          trailing={bp === "desktop" ? <Kbd>/</Kbd> : undefined}
          style={{ flex: 1 }}
        />
        <Segmented
          label="Catalogue view"
          iconOnly={bp === "phone"}
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "Grid", icon: <GridFour size={18} color={view === "grid" ? t.color.text : t.color.textMuted} /> },
            { value: "list", label: "List", icon: <ListBullets size={18} color={view === "list" ? t.color.text : t.color.textMuted} /> },
          ]}
        />
      </View>
      {isLoading ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", padding: t.space(2) }}>
          {Array.from({ length: columns * 2 }, (_, i) => (
            <View key={i} style={{ width: `${100 / columns}%`, padding: t.space(1) }}>
              <Skeleton height={theme.layout.showImages ? 220 : 100} radius={t.radius.lg} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          key={view === "grid" ? `g${columns}` : "list"}
          data={data ?? []}
          numColumns={view === "grid" ? columns : 1}
          keyExtractor={(i) => i.variantId}
          renderItem={({ item }) =>
            view === "grid" ? (
              <Tile item={item} currency={currency} onAdd={onAdd} size={size} showImages={theme.layout.showImages} showStock={theme.layout.showStock} />
            ) : (
              <ListRow item={item} currency={currency} onAdd={onAdd} showStock={theme.layout.showStock} />
            )
          }
          contentContainerStyle={{ paddingHorizontal: view === "grid" ? t.space(2) : 0, paddingBottom: t.space(28) }}
          initialNumToRender={24}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "web"}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState title={query ? `Nothing matches “${query}”` : "No items yet"} body={query ? "Try part of the name, the SKU, or scan the barcode." : "Add products in the catalogue, or connect your inventory."} />}
        />
      )}
    </View>
  );
}
