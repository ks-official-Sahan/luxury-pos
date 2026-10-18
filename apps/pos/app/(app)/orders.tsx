import { keepPreviousData, useInfiniteQuery, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { RefundSheet, type OrderDetail, type OrderStatus } from "@/features/orders/RefundSheet";
import { api } from "@/lib/api";
import { useCan, useMe, useStore } from "@/lib/queries";
import { printReceipt, receiptHtml, type ReceiptData } from "@/lib/receipt";
import { useBrand, useTerm, useTokens } from "@/theme/BrandProvider";
import { DataList, type Column } from "@/ui/DataList";
import { ArrowCounterClockwise, MagnifyingGlass, Printer, X } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { Screen } from "@/ui/Screen";
import { Badge, Button, EmptyState, ErrorNote, Field, IconButton, Money, Panel, Row, SectionHeader, Segmented, Skeleton, Stack, Stat, Text, useLayout, type BadgeTone } from "@/ui/primitives";
import { toast } from "@/ui/toast";

type OrderRow = {
  id: string;
  receiptNo: string | null;
  createdAt: string;
  status: OrderStatus;
  total: number;
  refundedTotal: number;
  currency: string;
  storeId: string;
  store: string | null;
  staff: string | null;
  customer: string | null;
  items: number;
};
type OrderPage = { items: OrderRow[]; nextCursor: string | null };
type StatusFilter = "all" | "completed" | "partially_refunded" | "refunded";

const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: "Completed", tone: "success" },
  partially_refunded: { label: "Part refunded", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  voided: { label: "Voided", tone: "danger" },
};
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "partially_refunded", label: "Partial" },
  { value: "refunded", label: "Refunded" },
];
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  store_credit: "Store credit",
  gift_card: "Gift card",
  loyalty_points: "Loyalty points",
  bank_transfer: "Bank transfer",
  other: "Other",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const methodLabel = (m: string) => METHOD_LABEL[m] ?? m.replace(/_/g, " ");

function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS[status].tone} label={STATUS[status].label} />;
}

/** Sales are a manager's view: anyone without reports access sees why, not an empty list. */
export default function OrdersScreen() {
  const t = useTokens();
  const me = useMe();
  const can = useCan();

  if (!me.data)
    return (
      <Screen title="Orders" fill>
        {me.isError ? (
          <View style={{ padding: t.space(4) }}>
            <ErrorNote message="Your access could not load. Check the connection and try again." onRetry={() => void me.refetch()} />
          </View>
        ) : (
          <Stack gap={4} style={{ padding: t.space(4) }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={18} />
            ))}
          </Stack>
        )}
      </Screen>
    );

  if (!can("reports.read"))
    return (
      <Screen title="Orders" fill>
        <EmptyState title="Reports access needed" body="Your role does not include sales reports. A store manager can look up a sale for you." />
      </Screen>
    );

  return <OrdersView />;
}

function OrdersView() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const { wide } = useLayout();
  const store = useStore();
  const storeId = store?.id;
  const canRefund = can("sale.refund") || can("sale.create");

  const params = useLocalSearchParams<{ id?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(params.id ?? null);
  useEffect(() => {
    if (params.id) setSelectedId(params.id);
  }, [params.id]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const query = useDeferredValue(search.trim());
  const filtered = query !== "" || status !== "all";
  const [refundOpen, setRefundOpen] = useState(false);

  const orders = useInfiniteQuery({
    queryKey: ["orders", "list", { storeId, status, q: query }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ limit: "40" });
      if (pageParam) qs.set("cursor", pageParam);
      if (status !== "all") qs.set("status", status);
      if (query) qs.set("q", query);
      if (storeId) qs.set("storeId", storeId);
      return api<OrderPage>(`/orders?${qs.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => orders.data?.pages.flatMap((p) => p.items), [orders.data]);

  const detail: UseQueryResult<OrderDetail> = useQuery({
    queryKey: ["orders", "detail", selectedId],
    queryFn: ({ signal }) => api<OrderDetail>(`/orders/${encodeURIComponent(selectedId ?? "")}`, { signal }),
    enabled: !!selectedId,
  });

  const columns = useMemo<Column<OrderRow>[]>(
    () => [
      {
        key: "receipt",
        header: "Receipt",
        flex: 2,
        render: (r) => (
          <Stack gap={0}>
            <Text variant="label" style={{ fontWeight: "600" }} numberOfLines={1}>
              {r.receiptNo ?? "Pending sync"}
            </Text>
            <Text variant="caption" tone="muted">
              {`${when(r.createdAt)}${wide ? "" : ` · ${r.items} ${r.items === 1 ? "item" : "items"}`}`}
            </Text>
          </Stack>
        ),
      },
      {
        key: "customer",
        header: term("Customer"),
        flex: 2,
        phone: true,
        render: (r) => (
          <Text variant="label" tone={r.customer ? "text" : "muted"} numberOfLines={1}>
            {r.customer ?? "Walk-in"}
          </Text>
        ),
      },
      {
        key: "associate",
        header: "Associate",
        flex: 1.5,
        render: (r) => (
          <Text variant="label" tone="muted" numberOfLines={1}>
            {r.staff ?? "Former member"}
          </Text>
        ),
      },
      {
        key: "items",
        header: "Items",
        flex: 0.8,
        align: "right",
        render: (r) => (
          <Text variant="label" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
            {r.items}
          </Text>
        ),
      },
      {
        key: "total",
        header: "Total",
        flex: 1.3,
        align: "right",
        render: (r) => (
          <Stack gap={0} style={{ alignItems: "flex-end" }}>
            <Money amount={r.total} currency={r.currency} variant="label" style={{ fontWeight: "600" }} />
            {r.refundedTotal > 0 ? (
              <Text variant="caption" tone="danger">
                {`−${formatMoney(r.refundedTotal, r.currency)} refunded`}
              </Text>
            ) : null}
          </Stack>
        ),
      },
      {
        key: "status",
        header: "Status",
        flex: 1.4,
        phone: true,
        render: (r) => <StatusBadge status={r.status} />,
      },
    ],
    [term, wide],
  );

  const toolbar = (
    <Row gap={3} wrap>
      <Field
        label="Search receipt number"
        hideLabel
        placeholder="Search receipt number"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        leading={<MagnifyingGlass size={18} color={t.color.textMuted} />}
        trailing={
          search ? (
            <IconButton label="Clear search" size="sm" onPress={() => setSearch("")}>
              <X size={16} color={t.color.text} />
            </IconButton>
          ) : null
        }
        style={{ flexGrow: 1, minWidth: 220, maxWidth: 360 }}
      />
      <Segmented label="Sale status" value={status} onChange={setStatus} options={STATUS_FILTERS} />
    </Row>
  );

  const empty = orders.isError ? (
    <EmptyState
      title={`${term("Sale")}s did not load`}
      body="Check the connection and try again. Sales already booked on this till are safe."
      action={<Button kind="secondary" label="Try again" onPress={() => void orders.refetch()} />}
    />
  ) : filtered ? (
    <EmptyState title="No sales match" body="Check the receipt number or clear the filters." />
  ) : (
    <EmptyState title={`No ${term("Sale").toLowerCase()}s yet`} body="Sales from every till appear here as they happen, including ones booked offline." />
  );

  const list = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {orders.isError && rows?.length ? (
        <View style={{ padding: t.space(3) }}>
          <ErrorNote message="Newer sales could not load." onRetry={() => void orders.refetch()} />
        </View>
      ) : null}
      <DataList
        label={`${term("Sale")}s`}
        rows={rows}
        columns={columns}
        keyOf={(r) => r.id}
        selectedKey={selectedId}
        onPress={(r) => setSelectedId(r.id)}
        loading={orders.isPending}
        empty={empty}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        footer={orders.isFetchingNextPage ? <View style={{ padding: t.space(4) }}><Skeleton height={18} /></View> : null}
      />
    </View>
  );

  const detailBody = <SaleDetail detail={detail} canRefund={canRefund} onRefund={() => setRefundOpen(true)} />;

  return (
    <>
      <Screen title="Orders" subtitle={store ? `Sales at ${store.name}` : "Sales across your stores"} toolbar={toolbar} fill>
        {wide ? (
          <Row gap={5} align="stretch" style={{ flex: 1 }}>
            <Panel padded={false} style={{ flex: 1, minWidth: 0 }}>
              {list}
            </Panel>
            <Panel padded={false} style={{ width: 440, flexShrink: 0 }}>
              {selectedId ? (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: t.space(5) }}>
                  {detailBody}
                </ScrollView>
              ) : (
                <EmptyState title={`Pick a ${term("Sale").toLowerCase()}`} body="Its items, payments and refunds open here." />
              )}
            </Panel>
          </Row>
        ) : (
          <Panel padded={false} style={{ flex: 1 }}>
            {list}
          </Panel>
        )}
      </Screen>

      {!wide ? (
        <Sheet visible={!!selectedId} onClose={() => setSelectedId(null)} title={`${term("Sale")} details`}>
          {detailBody}
        </Sheet>
      ) : null}

      <RefundSheet order={detail.data ?? null} visible={refundOpen} onClose={() => setRefundOpen(false)} />
    </>
  );
}

const toReceipt = (o: OrderDetail): ReceiptData => ({
  receiptNo: o.receiptNo,
  storeName: o.store ?? "",
  currency: o.currency,
  lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, total: l.total })),
  subtotal: o.subtotal,
  discountTotal: o.discountTotal,
  taxTotal: o.taxTotal,
  total: o.total,
  changeDue: 0,
  createdAt: o.createdAt,
});

/** Content only: the caller supplies the scroll container (pane on wide, Sheet on phone). */
function SaleDetail({ detail, canRefund, onRefund }: { detail: UseQueryResult<OrderDetail>; canRefund: boolean; onRefund: () => void }) {
  const t = useTokens();
  const term = useTerm();
  const { theme } = useBrand();
  const [printing, setPrinting] = useState(false);
  const o = detail.data;

  if (!o) {
    if (detail.isError)
      return <ErrorNote message="This sale could not load." onRetry={() => void detail.refetch()} />;
    return (
      <Stack gap={3}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={18} />
        ))}
      </Stack>
    );
  }

  const print = async () => {
    setPrinting(true);
    try {
      const ok = await printReceipt(receiptHtml(toReceipt(o), theme));
      if (!ok) toast.error("Receipts print from the web or desktop till.");
    } catch {
      toast.error("The receipt could not print. Check the printer and try again.");
    } finally {
      setPrinting(false);
    }
  };

  const itemCount = o.lines.reduce((n, l) => n + l.quantity, 0);
  const refundable = canRefund && o.status !== "refunded" && o.status !== "voided";

  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <Row justify="space-between" align="flex-start" wrap>
          <Text variant="heading" accessibilityRole="header" selectable style={{ flexShrink: 1 }}>
            {o.receiptNo ?? "Pending sync"}
          </Text>
          <StatusBadge status={o.status} />
        </Row>
        <Text variant="label" tone="muted">
          {when(o.createdAt)}
        </Text>
      </Stack>

      <Stack gap={2}>
        <Stat label="Store" value={o.store ?? "Not recorded"} />
        <Stat label="Associate" value={o.staff ?? "Former member"} />
        <Stat label={term("Customer")} value={o.customer ?? "Walk-in"} />
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Items" description={`${itemCount} ${itemCount === 1 ? "item" : "items"}`} />
        {o.lines.map((l) => (
          <Row key={l.id} align="flex-start" gap={3} style={{ paddingBottom: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
            <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" style={{ fontWeight: "600" }}>
                {l.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {[l.sku, l.serialNumber].filter(Boolean).join(" · ")}
              </Text>
              <Text variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                {`${l.quantity} × ${formatMoney(l.unitPrice, o.currency)}`}
              </Text>
              {l.refundedQuantity > 0 ? <Badge tone="warning" label={`${l.refundedQuantity} refunded`} /> : null}
            </Stack>
            <Money amount={l.total} currency={o.currency} variant="label" style={{ fontWeight: "600" }} />
          </Row>
        ))}
      </Stack>

      <Stack gap={2}>
        <Stat label="Subtotal" value={formatMoney(o.subtotal, o.currency)} />
        <Stat label="Discounts" value={formatMoney(o.discountTotal, o.currency)} />
        <Stat label="Tax" value={formatMoney(o.taxTotal, o.currency)} />
        <Stat label="Total" value={formatMoney(o.total, o.currency)} strong />
        {o.refundedTotal > 0 ? <Stat label="Refunded" value={`−${formatMoney(o.refundedTotal, o.currency)}`} tone="danger" /> : null}
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Payments" />
        {o.payments.map((p, i) => (
          <Row key={`${p.createdAt}-${i}`} justify="space-between" align="flex-start" gap={3}>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label">{p.amount < 0 ? `Refund, ${methodLabel(p.method)}` : methodLabel(p.method)}</Text>
              {p.reference ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {p.reference}
                </Text>
              ) : null}
            </Stack>
            <Money amount={p.amount} currency={o.currency} variant="label" tone={p.amount < 0 ? "danger" : undefined} />
          </Row>
        ))}
      </Stack>

      {o.refunds.length ? (
        <Stack gap={3}>
          <SectionHeader title="Refunds" />
          {o.refunds.map((r) => (
            <Row key={r.id} justify="space-between" align="flex-start" gap={3}>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label">{r.reason ?? "No reason given"}</Text>
                <Text variant="caption" tone="muted">
                  {when(r.createdAt)}
                </Text>
              </Stack>
              <Text variant="label" tone="danger" style={{ fontVariant: ["tabular-nums"] }}>
                {`−${formatMoney(r.total, o.currency)}`}
              </Text>
            </Row>
          ))}
        </Stack>
      ) : null}

      <Row gap={2} wrap>
        <Button kind="secondary" label="Print receipt" icon={<Printer size={18} color={t.color.text} />} loading={printing} onPress={() => void print()} />
        {refundable ? <Button label="Refund items" icon={<ArrowCounterClockwise size={18} color={t.color.onPrimary} />} onPress={onRefund} /> : null}
      </Row>
    </Stack>
  );
}
