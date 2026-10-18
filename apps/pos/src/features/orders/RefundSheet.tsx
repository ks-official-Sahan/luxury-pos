import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { formatMoney, uuidv7 } from "@luxury-pos/core";
import { ApprovalSheet } from "@/features/sell/sheets";
import { api, ApiRequestError } from "@/lib/api";
import { useTokens } from "@/theme/BrandProvider";
import { ArrowCounterClockwise, Check, Minus, Plus } from "@/ui/icons";
import { Badge, Button, Chip, ErrorNote, Field, focusRing, IconButton, Money, Row, Segmented, Stack, Switch, Text } from "@/ui/primitives";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";

export type OrderStatus = "completed" | "partially_refunded" | "refunded" | "voided";

export type OrderLine = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  orderDiscount: number;
  tax: number;
  total: number;
  serialNumber: string | null;
  refundedQuantity: number;
};

export type OrderPayment = { method: string; amount: number; reference: string | null; refundId: string | null; createdAt: string };
export type OrderRefund = { id: string; total: number; reason: string | null; createdAt: string };

export type OrderDetail = {
  id: string;
  receiptNo: string | null;
  createdAt: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  refundedTotal: number;
  pointsEarned: number;
  pointsRedeemed: number;
  note: string | null;
  storeId: string;
  customerId: string | null;
  staffId: string | null;
  approvedBy: string | null;
  store: string | null;
  staff: string | null;
  customer: string | null;
  lines: OrderLine[];
  payments: OrderPayment[];
  refunds: OrderRefund[];
};

/** Items still open to refund on a line. */
export const refundableQuantity = (line: OrderLine) => Math.max(0, line.quantity - line.refundedQuantity);

/** Same rule as the server: pro-rata share of the line total, rounded per line. */
export const lineRefundAmount = (line: OrderLine, quantity: number) => Math.round((line.total * quantity) / line.quantity);

const REASONS = ["Changed mind", "Faulty", "Wrong size", "Gift exchange"] as const;

const METHODS = [
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "store_credit", label: "Store credit" },
] as const;
type RefundMethod = (typeof METHODS)[number]["value"];

type Pick = { on: boolean; quantity: number; restock: boolean };
const DEFAULT_PICK: Pick = { on: false, quantity: 1, restock: true };

/** The refund goes back the way the sale was paid, when that method can be refunded here. */
function defaultMethod(order: OrderDetail): RefundMethod {
  const first = order.payments.find((p) => p.amount > 0)?.method;
  return METHODS.find((m) => m.value === first)?.value ?? "card";
}

function refundError(err: Error | null): string | null {
  if (!err) return null;
  if (err instanceof ApiRequestError) {
    if (err.status === 0) return "You appear to be offline. Refunds need a connection, so try again when it returns.";
    if (err.status < 500) return err.message;
  }
  return "Nothing was refunded. Try again in a moment.";
}

/**
 * Refund items from a sale. Remounted on every open (key below), so each refund
 * starts from a clean form with its own idempotency key.
 */
export function RefundSheet({ order, visible, onClose }: { order: OrderDetail | null; visible: boolean; onClose: () => void }) {
  if (!order) return null;
  return <RefundForm key={`${order.id}:${visible}`} order={order} visible={visible} onClose={onClose} />;
}

function RefundForm({ order, visible, onClose }: { order: OrderDetail; visible: boolean; onClose: () => void }) {
  const t = useTokens();
  const qc = useQueryClient();
  const [requestId] = useState(() => uuidv7());
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<RefundMethod>(() => defaultMethod(order));
  const [approvalOpen, setApprovalOpen] = useState(false);

  const pickOf = (id: string) => picks[id] ?? DEFAULT_PICK;
  const update = (id: string, patch: Partial<Pick>) => setPicks((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_PICK), ...patch } }));

  const selected = order.lines.flatMap((line) => {
    const p = pickOf(line.id);
    const max = refundableQuantity(line);
    if (!p.on || max === 0) return [];
    const quantity = Math.min(p.quantity, max);
    return [{ line, quantity, restock: p.restock, amount: lineRefundAmount(line, quantity) }];
  });
  const total = selected.reduce((sum, s) => sum + s.amount, 0);
  const itemCount = selected.reduce((sum, s) => sum + s.quantity, 0);
  const reasonText = reason.trim();
  const valid = selected.length > 0 && total > 0 && reasonText.length >= 2;

  const refund = useMutation({
    mutationFn: (overrideToken: string | undefined) =>
      api<{ id: string }>("/refunds", {
        method: "POST",
        json: {
          id: requestId,
          orderId: order.id,
          lines: selected.map((s) => ({ orderLineId: s.line.id, quantity: s.quantity, restock: s.restock })),
          tenders: [{ method, amount: total }],
          reason: reasonText,
          ...(overrideToken ? { overrideToken } : {}),
        },
      }),
    onSuccess: () => {
      toast.success(`Refunded ${formatMoney(total, order.currency)}`);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "override_required") setApprovalOpen(true);
    },
  });

  const overrideNeeded = refund.error instanceof ApiRequestError && refund.error.code === "override_required";
  const failure = overrideNeeded ? null : refundError(refund.error);
  const anyRefundable = order.lines.some((l) => refundableQuantity(l) > 0);

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Refund items"
        description={`Receipt ${order.receiptNo ?? "pending sync"}`}
        footer={
          <Button
            label={`Refund ${formatMoney(total, order.currency)}`}
            size="lg"
            block
            disabled={!valid}
            loading={refund.isPending}
            onPress={() => refund.mutate(undefined)}
            icon={<ArrowCounterClockwise size={18} color={t.color.onPrimary} />}
          />
        }
      >
        {!anyRefundable ? <Text variant="label" tone="muted">Every item on this sale is already refunded.</Text> : null}

        <Stack gap={3}>
          <Text variant="label" tone="muted">
            Items
          </Text>
          {order.lines.map((line) => (
            <LinePick key={line.id} line={line} currency={order.currency} pick={pickOf(line.id)} onChange={(patch) => update(line.id, patch)} />
          ))}
        </Stack>

        <Stack gap={2}>
          <Field
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="For example, clasp is loose"
            maxLength={280}
            error={reason.length > 0 && reasonText.length < 2 ? "Enter at least two characters." : null}
            hint="Recorded with the refund."
          />
          <Row gap={2} wrap>
            {REASONS.map((r) => (
              <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
            ))}
          </Row>
        </Stack>

        <Stack gap={2}>
          <Text variant="label" tone="muted">
            Refund to
          </Text>
          <Segmented label="Refund method" size="lg" value={method} onChange={setMethod} options={METHODS} />
        </Stack>

        <Row justify="space-between" align="flex-end">
          <Stack gap={0}>
            <Text variant="label" tone="muted">
              Refund total
            </Text>
            <Text variant="caption" tone="muted">
              {`${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            </Text>
          </Stack>
          <Money amount={total} currency={order.currency} variant="amount" />
        </Row>

        {failure ? <ErrorNote message={failure} /> : null}
      </Sheet>

      <ApprovalSheet
        visible={approvalOpen}
        action="refund"
        storeId={order.storeId}
        onClose={() => setApprovalOpen(false)}
        onApproved={(token) => {
          setApprovalOpen(false);
          refund.mutate(token);
        }}
      />
    </>
  );
}

function LinePick({ line, currency, pick, onChange }: { line: OrderLine; currency: string; pick: Pick; onChange: (patch: Partial<Pick>) => void }) {
  const t = useTokens();
  const max = refundableQuantity(line);
  const done = max === 0;
  const qty = Math.min(pick.quantity, max);
  const on = pick.on && !done;
  const identity = [line.sku, line.serialNumber].filter(Boolean).join(" · ");
  return (
    <View style={{ gap: t.space(2), paddingBottom: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={[line.name, line.serialNumber ? `serial ${line.serialNumber}` : null, done ? "already refunded" : `${max} of ${line.quantity} available to refund`].filter(Boolean).join(", ")}
        accessibilityState={{ checked: on, disabled: done }}
        disabled={done}
        onPress={() => onChange({ on: !pick.on, quantity: 1 })}
        style={({ focused, hovered }: { focused?: boolean; hovered?: boolean; pressed: boolean }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            gap: t.space(3),
            minHeight: t.hit,
            borderRadius: t.radius.md,
            opacity: done ? 0.6 : 1,
            backgroundColor: hovered && !done ? t.color.hover : "transparent",
            ...focusRing(t, focused),
          }) as ViewStyle
        }
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: on ? t.color.primary : t.color.borderStrong,
            backgroundColor: on ? t.color.primary : t.color.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {on ? <Check size={14} color={t.color.onPrimary} /> : null}
        </View>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" style={{ fontWeight: "600" }} numberOfLines={2}>
            {line.name}
          </Text>
          {identity ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {identity}
            </Text>
          ) : null}
        </Stack>
        {done ? <Badge label="Refunded" /> : <Money amount={on ? lineRefundAmount(line, qty) : line.total} currency={currency} variant="label" />}
      </Pressable>

      {on ? (
        <View style={{ gap: t.space(2), paddingLeft: 34 }}>
          <Row gap={3}>
            <IconButton size="sm" label={`Fewer ${line.name}`} disabled={qty <= 1} onPress={() => onChange({ quantity: qty - 1 })}>
              <Minus size={16} color={t.color.text} />
            </IconButton>
            <Text variant="label" style={{ minWidth: 72, textAlign: "center", fontVariant: ["tabular-nums"] }}>
              {`${qty} of ${max}`}
            </Text>
            <IconButton size="sm" label={`More ${line.name}`} disabled={qty >= max} onPress={() => onChange({ quantity: qty + 1 })}>
              <Plus size={16} color={t.color.text} />
            </IconButton>
          </Row>
          <Switch label="Return to stock" value={pick.restock} onChange={(restock) => onChange({ restock })} />
        </View>
      ) : null}
    </View>
  );
}
