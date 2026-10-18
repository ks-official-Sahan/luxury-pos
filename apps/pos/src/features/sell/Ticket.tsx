import { FlatList, Pressable, View, type ViewStyle } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { useStore } from "@/lib/queries";
import { modKey } from "@/shell/useShortcuts";
import { priceLines, useCart } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Minus, Plus, ShoppingBag, Tag, Trash, UserCircle, X } from "@/ui/icons";
import { Badge, Button, EmptyState, focusRing, IconButton, Kbd, Money, Row, Stat, Text, useLayout } from "@/ui/primitives";

/**
 * The running sale. Count, total and the pay action never leave the screen
 * (design principle 1). In tender mode it becomes a read-only summary beside
 * the payment panel so the client can follow along.
 */
export function Ticket({ onPay, onClient, onDiscount, tendering, onClose }: { onPay: () => void; onClient: () => void; onDiscount: () => void; tendering?: boolean; onClose?: () => void }) {
  const t = useTokens();
  const term = useTerm();
  const store = useStore();
  const { bp } = useLayout();
  const { lines, orderDiscount, client, setQuantity, remove, clear, setClient } = useCart();
  if (!store) return null;
  const priced = priceLines(lines, orderDiscount, store.currency, store.taxMode);
  const byKey = new Map(priced.lines.map((l) => [l.id, l]));
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const sale = term("Sale");

  return (
    <View style={{ flex: 1, backgroundColor: t.color.surface }}>
      <Row justify="space-between" style={{ paddingHorizontal: t.space(4), paddingTop: t.space(4), paddingBottom: t.space(2) }}>
        <Row gap={2}>
          {onClose ? (
            <IconButton label="Back to items" onPress={onClose} size="sm">
              <X size={18} color={t.color.text} />
            </IconButton>
          ) : null}
          <Text variant="heading" accessibilityRole="header">
            {sale}
          </Text>
          {count ? <Badge label={`${count} item${count > 1 ? "s" : ""}`} /> : null}
        </Row>
        {lines.length && !tendering ? (
          <Button kind="ghost" size="sm" label="Clear" onPress={clear} accessibilityHint="Removes every item from the sale" />
        ) : null}
      </Row>

      {/* Client strip: clienteling starts at the till. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={client ? `${term("Customer")} ${client.name}. Change` : `Add a ${term("Customer").toLowerCase()}`}
        onPress={onClient}
        disabled={tendering}
        style={({ hovered, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            gap: t.space(3),
            marginHorizontal: t.space(4),
            marginBottom: t.space(2),
            minHeight: t.hit,
            paddingHorizontal: t.space(3),
            borderRadius: t.radius.md,
            backgroundColor: client ? t.color.primarySoft : hovered ? t.color.hover : t.color.surfaceSunken,
            ...focusRing(t, focused),
          }) as ViewStyle
        }
      >
        <UserCircle size={22} color={client ? t.color.onPrimarySoft : t.color.textMuted} weight={client ? "fill" : "regular"} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" tone={client ? "onPrimarySoft" : "muted"} numberOfLines={1} style={{ fontWeight: client ? "600" : "500" }}>
            {client ? client.name : `Add ${term("Customer").toLowerCase()}`}
          </Text>
          {client ? (
            <Text variant="caption" tone="onPrimarySoft" numberOfLines={1}>
              {(client.tierId ?? "Member").replace(/^./, (c) => c.toUpperCase())} · {client.pointsBalance.toLocaleString()} points
            </Text>
          ) : null}
        </View>
        {client && !tendering ? (
          <IconButton label={`Remove ${term("Customer").toLowerCase()}`} size="sm" onPress={() => setClient(null)}>
            <X size={16} color={t.color.onPrimarySoft} />
          </IconButton>
        ) : null}
      </Pressable>

      <FlatList
        data={lines}
        keyExtractor={(l) => l.key}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: t.space(4), flexGrow: 1 }}
        ListEmptyComponent={<EmptyState icon={<ShoppingBag size={32} color={t.color.textMuted} weight="light" />} title="Ready for the next sale" body="Scan a barcode, search, or tap an item." />}
        renderItem={({ item: l }) => {
          const p = byKey.get(l.key);
          const discount = p ? p.lineDiscount + p.orderDiscount : 0;
          const meta = [...Object.values(l.item.options), l.serialNumber ? `S/N ${l.serialNumber}` : null].filter(Boolean).join(" · ");
          return (
            <View style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border, gap: t.space(1) }}>
              <Row justify="space-between" align="flex-start">
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <Text variant="label" numberOfLines={2} style={{ fontWeight: "600" }}>
                    {l.item.name}
                  </Text>
                  {meta ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Money amount={p?.total ?? 0} currency={store.currency} variant="label" style={{ fontWeight: "600" }} />
                  {discount > 0 ? <Money amount={-discount} currency={store.currency} variant="caption" tone="success" /> : null}
                </View>
              </Row>
              {tendering ? (
                <Text variant="caption" tone="muted">
                  {l.quantity} × {formatMoney(l.priceOverride ?? l.item.price, store.currency)}
                </Text>
              ) : (
                <Row gap={1}>
                  <IconButton label={`One fewer ${l.item.name}`} size="sm" onPress={() => setQuantity(l.key, l.quantity - 1)}>
                    <Minus size={16} color={t.color.text} />
                  </IconButton>
                  <Text variant="label" style={{ minWidth: 28, textAlign: "center", fontVariant: ["tabular-nums"] }} accessibilityLabel={`Quantity ${l.quantity}`}>
                    {l.quantity}
                  </Text>
                  <IconButton label={`One more ${l.item.name}`} size="sm" disabled={l.item.serialized} onPress={() => setQuantity(l.key, l.quantity + 1)}>
                    <Plus size={16} color={t.color.text} />
                  </IconButton>
                  <Text variant="caption" tone="muted" style={{ flex: 1, marginLeft: t.space(2) }}>
                    {formatMoney(l.priceOverride ?? l.item.price, store.currency)} each
                  </Text>
                  <IconButton label={`Remove ${l.item.name}`} size="sm" tone="danger" onPress={() => remove(l.key)}>
                    <Trash size={16} color={t.color.danger} />
                  </IconButton>
                </Row>
              )}
            </View>
          );
        }}
      />

      <View style={{ padding: t.space(4), gap: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
        <Stat label="Subtotal" value={formatMoney(priced.subtotal, store.currency)} />
        {priced.discountTotal > 0 ? <Stat label={orderDiscount?.kind === "percent" ? `Discount ${orderDiscount.bps / 100}%` : "Discounts"} value={formatMoney(-priced.discountTotal, store.currency)} tone="success" /> : null}
        <Stat label={store.taxMode === "inclusive" ? "Tax included" : "Tax"} value={formatMoney(priced.taxTotal, store.currency)} />
        <Row justify="space-between" align="baseline" style={{ marginTop: t.space(1) }}>
          <Text variant="subheading">Total</Text>
          <Money amount={priced.total} currency={store.currency} variant="amount" />
        </Row>
        {tendering ? null : (
          <Row gap={2} style={{ marginTop: t.space(2) }} align="stretch">
            {/* Icon-only beside Charge so the total on the pay button never truncates. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={orderDiscount ? "Change the discount" : "Add a discount"}
              disabled={!lines.length}
              onPress={onDiscount}
              style={({ hovered, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) =>
                ({ width: t.hit + 20, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, alignItems: "center", justifyContent: "center", gap: 2, opacity: lines.length ? 1 : 0.45, backgroundColor: orderDiscount ? t.color.primarySoft : hovered ? t.color.hover : t.color.surface, ...focusRing(t, focused) }) as ViewStyle
              }
            >
              <Tag size={20} color={orderDiscount ? t.color.onPrimarySoft : t.color.text} />
              <Text variant="caption" tone={orderDiscount ? "onPrimarySoft" : "muted"}>
                Discount
              </Text>
            </Pressable>
            <Button
              size="xl"
              label="Charge"
              trailing={
                <Row gap={2}>
                  <Money amount={priced.total} currency={store.currency} variant="subheading" tone="onPrimary" />
                  {bp === "desktop" ? <Kbd>{`${modKey}↵`}</Kbd> : null}
                </Row>
              }
              onPress={onPay}
              disabled={!lines.length}
              style={{ flex: 1 }}
              accessibilityHint="Choose how the customer pays"
            />
          </Row>
        )}
      </View>
    </View>
  );
}
