import { useState } from "react";
import { FlatList, Pressable, View, type ViewStyle } from "react-native";
import { formatMoney, uuidv7 } from "@luxury-pos/core";
import { useCan, useStore } from "@/lib/queries";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";
import { modKey } from "@/shell/useShortcuts";
import { missingSerials, priceLines, useCart } from "@/state/cart";
import { useHeld } from "@/state/held";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { CaretDown, Clock, Minus, Plus, ShoppingBag, Tag, Trash, UserCircle, X } from "@/ui/icons";
import { Badge, Button, EmptyState, focusRing, IconButton, Kbd, Money, Row, Stat, Text, useLayout } from "@/ui/primitives";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";
import { LineEditor } from "./LineEditor";
import { ApprovalSheet } from "./sheets";

type VoidKind = "line_voided" | "quantity_reduced" | "sale_cleared";
type PendingVoid = { kind: VoidKind; lines: { variantId: string; name: string; quantity: number; amount: number }[]; run: () => void };

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

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
  const { lines, orderDiscount, client, setQuantity, remove, clear, setClient, focusKey, focus, restore } = useCart();
  const held = useHeld();
  const [recall, setRecall] = useState(false);
  const can = useCan();
  const deviceId = useSession((st) => st.deviceId);
  const [pendingVoid, setPendingVoid] = useState<PendingVoid | null>(null);
  if (!store) return null;
  const heldHere = held.items.filter((h) => h.storeId === store.id);
  const unserialed = missingSerials(lines);
  const snapshot = () => ({ lines, orderDiscount, client });

  /**
   * Taking anything off a sale (fewer units, a line, the whole sale) is a void:
   * staff with sale.void do it directly, everyone else needs a manager's PIN.
   * Either way it is written to the audit trail through the outbox, so it is
   * recorded even when the till is offline.
   */
  const guardVoid = (v: PendingVoid) => {
    if (can("sale.void")) return commitVoid(v, false);
    setPendingVoid(v);
  };
  const commitVoid = (v: PendingVoid, approved: boolean) => {
    v.run();
    if (!deviceId) return;
    const id = uuidv7();
    useOutbox.getState().enqueue({ id, path: "/till-events", label: v.kind === "sale_cleared" ? "Sale cleared" : "Line voided", body: { id, action: v.kind, storeId: store.id, deviceId, lines: v.lines, approved, at: new Date().toISOString() } });
    void useOutbox.getState().flush();
  };
  const lineAmount = (key: string) => priceLines(lines, orderDiscount, store.currency, store.taxMode).lines.find((x) => x.id === key)?.total ?? 0;

  // Reversible locally: act, then offer Undo (re-adding never needs approval).
  const clearSale = () =>
    guardVoid({
      kind: "sale_cleared",
      lines: lines.map((l) => ({ variantId: l.item.variantId, name: l.item.name, quantity: l.quantity, amount: lineAmount(l.key) })),
      run: () => {
        const before = snapshot();
        clear();
        toast.undo("Sale cleared", () => restore(before));
      },
    });
  const holdSale = () => {
    held.hold({ id: uuidv7(), at: Date.now(), storeId: store.id, ...snapshot() });
    clear();
    toast.success(client ? `Held for ${client.name}` : "Sale held");
  };
  const pickUp = (id: string) => {
    if (lines.length) held.hold({ id: uuidv7(), at: Date.now(), storeId: store.id, ...snapshot() });
    const sale = held.take(id);
    if (sale) restore(sale);
    setRecall(false);
  };
  const pay = () => {
    const first = unserialed[0];
    if (first) {
      focus(first.key);
      return toast.error(`Choose the serial number for ${first.item.name}`);
    }
    onPay();
  };
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
        {!tendering ? (
          <Row gap={1}>
            {heldHere.length ? <Button kind="ghost" size="sm" label={`Held ${heldHere.length}`} icon={<Clock size={16} color={t.color.text} />} onPress={() => setRecall(true)} accessibilityHint="Sales put aside on this till" /> : null}
            {lines.length ? <Button kind="ghost" size="sm" label="Hold" onPress={holdSale} accessibilityHint="Puts this sale aside so you can start another" /> : null}
            {lines.length ? <Button kind="ghost" size="sm" label="Clear" onPress={clearSale} accessibilityHint="Removes every item; you can undo" /> : null}
          </Row>
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
          const open = focusKey === l.key && !tendering;
          const needsSerial = l.item.serialized && !l.serialNumber;
          return (
            <View style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border, gap: t.space(1) }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${l.item.name}${meta ? `, ${meta}` : ""}, ${formatMoney(p?.total ?? 0, store.currency)}`}
                accessibilityHint={open ? "Closes the line options" : "Serial number, discount and price for this line"}
                accessibilityState={{ expanded: open }}
                disabled={tendering}
                onPress={() => focus(open ? null : l.key)}
                style={({ focused }: { focused?: boolean; pressed: boolean }) => ({ borderRadius: t.radius.sm, ...focusRing(t, focused) }) as ViewStyle}
              >
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
                    {needsSerial ? <Badge tone="warning" label="Serial number needed" /> : null}
                  </View>
                  <Row gap={2} align="flex-start">
                    <View style={{ alignItems: "flex-end" }}>
                      <Money amount={p?.total ?? 0} currency={store.currency} variant="label" style={{ fontWeight: "600" }} />
                      {discount > 0 ? <Money amount={-discount} currency={store.currency} variant="caption" tone="success" /> : null}
                    </View>
                    {!tendering ? <CaretDown size={14} color={t.color.textMuted} style={{ marginTop: 3, transform: [{ rotate: open ? "180deg" : "0deg" }] }} /> : null}
                  </Row>
                </Row>
              </Pressable>
              {tendering ? (
                <Text variant="caption" tone="muted">
                  {l.quantity} × {formatMoney(l.priceOverride ?? l.item.price, store.currency)}
                </Text>
              ) : (
                <Row gap={1}>
                  <IconButton
                    label={`One fewer ${l.item.name}`}
                    size="sm"
                    onPress={() =>
                      guardVoid({
                        kind: l.quantity > 1 ? "quantity_reduced" : "line_voided",
                        lines: [{ variantId: l.item.variantId, name: l.item.name, quantity: 1, amount: Math.round(lineAmount(l.key) / l.quantity) }],
                        run: () => setQuantity(l.key, l.quantity - 1),
                      })
                    }
                  >
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
                  <IconButton
                    label={`Remove ${l.item.name}`}
                    size="sm"
                    tone="danger"
                    onPress={() =>
                      guardVoid({
                        kind: "line_voided",
                        lines: [{ variantId: l.item.variantId, name: l.item.name, quantity: l.quantity, amount: lineAmount(l.key) }],
                        run: () => {
                          const before = snapshot();
                          remove(l.key);
                          toast.undo(`${l.item.name} removed`, () => restore(before));
                        },
                      })
                    }
                  >
                    <Trash size={16} color={t.color.danger} />
                  </IconButton>
                </Row>
              )}
              {open ? <LineEditor line={l} onDone={() => focus(null)} /> : null}
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
              onPress={pay}
              disabled={!lines.length}
              style={{ flex: 1 }}
              accessibilityHint="Choose how the customer pays"
            />
          </Row>
        )}
      </View>
      <ApprovalSheet
        visible={!!pendingVoid}
        action="void"
        storeId={store.id}
        onClose={() => setPendingVoid(null)}
        onApproved={() => {
          if (pendingVoid) commitVoid(pendingVoid, true);
          setPendingVoid(null);
        }}
      />
      <Sheet visible={recall} onClose={() => setRecall(false)} title="Held sales" width={460}>
        {heldHere.map((h) => {
          const total = priceLines(h.lines, h.orderDiscount, store.currency, store.taxMode).total;
          const items = h.lines.reduce((n, l) => n + l.quantity, 0);
          return (
            <Pressable
              key={h.id}
              accessibilityRole="button"
              accessibilityLabel={`${h.client?.name ?? "Walk-in"}, ${items} items, ${formatMoney(total, store.currency)}, held ${ago(h.at)}. Pick up`}
              onPress={() => pickUp(h.id)}
              style={({ hovered, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) =>
                ({ flexDirection: "row", alignItems: "center", gap: t.space(3), padding: t.space(3), borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, backgroundColor: hovered ? t.color.hover : t.color.surface, ...focusRing(t, focused) }) as ViewStyle
              }
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" style={{ fontWeight: "600" }}>
                  {h.client?.name ?? "Walk-in"}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {items} item{items > 1 ? "s" : ""} · {h.lines.map((l) => l.item.name).join(", ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Money amount={total} currency={store.currency} variant="label" style={{ fontWeight: "600" }} />
                <Text variant="caption" tone="muted">
                  {ago(h.at)}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {lines.length ? (
          <Text variant="caption" tone="muted">
            Picking one up puts the current sale on hold first, so nothing is lost.
          </Text>
        ) : null}
      </Sheet>
    </View>
  );
}
