import { MagnifyingGlass } from "@/ui/icons";
import { memo, useCallback, useDeferredValue, useState } from "react";
import { FlatList, Image, Pressable, TextInput, View } from "react-native";
import { useCatalogSearch, useStore } from "@/lib/queries";
import { useCart, type CatalogItem } from "@/state/cart";
import { useTokens } from "@/theme/BrandProvider";
import { EmptyState, Money, Text, useLayout } from "@/ui/primitives";

const Tile = memo(function Tile({ item, currency, onAdd }: { item: CatalogItem; currency: string; onAdd: (i: CatalogItem) => void }) {
  const t = useTokens();
  const options = Object.values(item.options).join(" · ");
  const out = item.available !== undefined && item.available <= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${options ? `, ${options}` : ""}, ${out ? "out of stock" : `${item.available ?? ""} available`}`}
      accessibilityHint="Adds to the sale"
      onPress={() => onAdd(item)}
      style={({ pressed }) => ({ flex: 1, margin: t.space(1.5), borderRadius: t.radius.lg, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, overflow: "hidden", opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed && t.motion.enabled ? 0.985 : 1 }] })}
    >
      <View style={{ aspectRatio: 4 / 3, backgroundColor: t.color.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Text variant="title" tone="muted" style={{ opacity: 0.35 }}>
            {item.name.slice(0, 1)}
          </Text>
        )}
      </View>
      <View style={{ padding: t.space(3), gap: 2 }}>
        {item.brand ? (
          <Text variant="eyebrow" tone="muted" numberOfLines={1}>
            {item.brand}
          </Text>
        ) : null}
        <Text variant="label" numberOfLines={2}>
          {item.name}
        </Text>
        {options ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {options}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
          <Money amount={item.price} currency={currency} variant="label" />
          <Text variant="caption" tone={out ? "danger" : "muted"}>
            {out ? "Out" : item.available !== undefined ? `${item.available} in stock` : ""}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

/**
 * Search box doubles as the barcode-scanner input: USB/Bluetooth scanners type
 * the code and press Enter, which adds an exact SKU/barcode match straight to the sale.
 */
export function CatalogGrid() {
  const t = useTokens();
  const { width, wide, bp } = useLayout();
  const store = useStore();
  const add = useCart((s) => s.add);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const { data, isFetching } = useCatalogSearch(deferred);
  const panel = wide ? 420 : 0;
  const columns = Math.max(2, Math.floor((width - panel - (wide ? 96 : 0)) / (bp === "desktop" ? 220 : 190)));
  const onAdd = useCallback((i: CatalogItem) => add(i), [add]);

  const onSubmit = () => {
    const exact = data?.find((d) => d.sku === query.trim() || d.variantId === query.trim());
    if (exact) {
      add(exact);
      setQuery("");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space(2), margin: t.space(3), paddingHorizontal: t.space(4), minHeight: t.hit, borderRadius: t.radius.pill, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border }}>
        <MagnifyingGlass size={20} weight="light" color={t.color.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSubmit}
          placeholder="Search or scan an item"
          placeholderTextColor={t.color.textMuted}
          accessibilityLabel="Search or scan an item"
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, color: t.color.text, fontSize: t.size.base, minHeight: t.hit }}
        />
        {isFetching ? <Text variant="caption" tone="muted">…</Text> : null}
      </View>
      <FlatList
        key={columns}
        data={data ?? []}
        numColumns={columns}
        keyExtractor={(i) => i.variantId}
        renderItem={({ item }) => <Tile item={item} currency={store?.currency ?? "USD"} onAdd={onAdd} />}
        contentContainerStyle={{ paddingHorizontal: t.space(1.5), paddingBottom: t.space(24) }}
        initialNumToRender={18}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={!isFetching ? <EmptyState title="Nothing found" body="Try another name, SKU or barcode." /> : undefined}
      />
    </View>
  );
}
