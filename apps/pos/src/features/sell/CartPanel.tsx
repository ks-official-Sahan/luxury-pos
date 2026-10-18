import { Minus, Plus, Tag, Trash, UserCircle } from "@/ui/icons";
import { FlatList, Pressable, View } from "react-native";
import { useStore } from "@/lib/queries";
import { priceLines, useCart } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Button, Divider, EmptyState, IconButton, Money, Row, Text } from "@/ui/primitives";

/** The running sale: lines, quantity steppers, totals and the pay action. */
export function CartPanel({ onPay, onClient, onDiscount }: { onPay: () => void; onClient: () => void; onDiscount: () => void }) {
  const t = useTokens();
  const term = useTerm();
  const store = useStore();
  const { lines, orderDiscount, client, setQuantity, remove } = useCart();
  if (!store) return null;
  const priced = priceLines(lines, orderDiscount, store.currency, store.taxMode);
  const byKey = new Map(priced.lines.map((l) => [l.id, l]));

  return (
    <View style={{ flex: 1, backgroundColor: t.color.surface }}>
      <Row style={{ padding: t.space(4), justifyContent: "space-between" }}>
        <Text variant="heading" accessibilityRole="header">
          Current {term("Sale").toLowerCase()}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={client ? `${term("Customer")} ${client.name}, change` : `Add ${term("Customer").toLowerCase()}`} onPress={onClient} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: t.hit, paddingHorizontal: t.space(3), borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.color.border }}>
          <UserCircle size={20} weight="light" color={client ? t.color.primary : t.color.textMuted} />
          <Text variant="label" tone={client ? "primary" : "muted"} numberOfLines={1}>
            {client ? client.name : term("Customer")}
          </Text>
        </Pressable>
      </Row>

      <FlatList
        data={lines}
        keyExtractor={(l) => l.key}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: t.space(4) }}
        ListEmptyComponent={<EmptyState title="Ready when you are" body="Scan or tap an item to start." />}
        renderItem={({ item: l }) => {
          const p = byKey.get(l.key);
          return (
            <View style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border, gap: t.space(2) }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" numberOfLines={2}>
                    {l.item.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {[...Object.values(l.item.options), l.item.sku].join(" · ")}
                    {l.serialNumber ? ` · S/N ${l.serialNumber}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Money amount={p?.total ?? 0} currency={store.currency} variant="label" />
                  {p && p.lineDiscount + p.orderDiscount > 0 ? <Money amount={-(p.lineDiscount + p.orderDiscount)} currency={store.currency} variant="caption" tone="success" /> : null}
                </View>
              </Row>
              <Row gap={1}>
                <IconButton label={`Decrease ${l.item.name}`} onPress={() => setQuantity(l.key, l.quantity - 1)}>
                  <Minus size={18} color={t.color.text} weight="light" />
                </IconButton>
                <Text variant="label" style={{ minWidth: 28, textAlign: "center" }} accessibilityRole="text">
                  {l.quantity}
                </Text>
                <IconButton label={`Increase ${l.item.name}`} onPress={() => !l.item.serialized && setQuantity(l.key, l.quantity + 1)}>
                  <Plus size={18} color={l.item.serialized ? t.color.border : t.color.text} weight="light" />
                </IconButton>
                <View style={{ flex: 1 }} />
                <IconButton label={`Remove ${l.item.name}`} onPress={() => remove(l.key)}>
                  <Trash size={18} color={t.color.danger} weight="light" />
                </IconButton>
              </Row>
            </View>
          );
        }}
      />

      <View style={{ padding: t.space(4), gap: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text tone="muted">Subtotal</Text>
          <Money amount={priced.subtotal} currency={store.currency} tone="muted" />
        </Row>
        {priced.discountTotal > 0 ? (
          <Row style={{ justifyContent: "space-between" }}>
            <Text tone="muted">Discounts</Text>
            <Money amount={-priced.discountTotal} currency={store.currency} tone="success" />
          </Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}>
          <Text tone="muted">Tax {store.taxMode === "inclusive" ? "(included)" : ""}</Text>
          <Money amount={priced.taxTotal} currency={store.currency} tone="muted" />
        </Row>
        <Divider />
        <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <Text variant="heading">Total</Text>
          <Money amount={priced.total} currency={store.currency} variant="amount" />
        </Row>
        <Row gap={2} style={{ marginTop: t.space(2) }}>
          <Button kind="secondary" label="Discount" icon={<Tag size={18} weight="light" color={t.color.text} />} onPress={onDiscount} disabled={!lines.length} />
          <Button label="Charge" size="lg" onPress={onPay} disabled={!lines.length} style={{ flex: 1 }} accessibilityHint="Choose how the customer pays" />
        </Row>
      </View>
    </View>
  );
}
