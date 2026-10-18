import { useMemo, useState } from "react";
import { View } from "react-native";
import type { StoreInfo } from "@/lib/queries";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { DataList, type Column } from "@/ui/DataList";
import { Chip, EmptyState, ErrorNote, Money, Panel, Row, Skeleton, Stack, Text, useLayout } from "@/ui/primitives";
import { humanize, withTerms } from "./labels";
import { useAuditLog, type AuditItem } from "./queries";

/** Filter value is sent as the `action` query: a full action or a dotted prefix. */
const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "order.", label: "Sales" },
  { value: "order.refunded", label: "Refunds" },
  { value: "override.", label: "Overrides" },
  { value: "stock.", label: "Stock" },
  { value: "staff.", label: "Team" },
  { value: "roles.", label: "Roles" },
  { value: "branding.", label: "Brand" },
];

/** Known actions read as sentences; anything else falls back to its own name. */
const KNOWN: Record<string, string> = {
  "order.created": "{Sale}",
  "order.refunded": "Refund",
  "order.voided": "{Sale} voided",
  "override.approved": "Manager approval",
  "staff.created": "Team member added",
  "staff.updated": "Team member changed",
  "roles.updated": "Role permissions changed",
  "roles.reset": "Role reset to default",
  "branding.updated": "Brand updated",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ActivityTab({ stores }: { stores: readonly StoreInfo[] }) {
  const t = useTokens();
  const term = useTerm();
  const { bp, gutter } = useLayout();
  const [filter, setFilter] = useState("");
  const log = useAuditLog(filter);
  const rows = useMemo(() => log.data?.pages.flatMap((p) => p.items), [log.data]);
  const byId = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const fallbackCurrency = stores[0]?.currency ?? "EUR";

  const columns = useMemo<Column<AuditItem>[]>(
    () => [
      {
        key: "what",
        header: "What",
        flex: 3,
        render: (r) => {
          const text = withTerms(KNOWN[r.action] ?? humanize(r.action), term);
          const total = r.data?.total;
          const currency = (r.storeId ? byId.get(r.storeId)?.currency : undefined) ?? fallbackCurrency;
          return (
            <Row gap={2} wrap>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: "600", flexShrink: 1 }}>
                {text}
              </Text>
              {typeof total === "number" ? <Money amount={total} currency={currency} variant="label" /> : null}
            </Row>
          );
        },
      },
      {
        key: "when",
        header: "When",
        flex: 1.4,
        phone: true,
        render: (r) => (
          <Text variant="label" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
            {when(r.createdAt)}
          </Text>
        ),
      },
      {
        key: "who",
        header: "Who",
        flex: 1.4,
        phone: true,
        render: (r) => (
          <Text variant="label" numberOfLines={1}>
            {r.actor ?? "System"}
          </Text>
        ),
      },
      {
        key: "store",
        header: "Store",
        flex: 1.4,
        phone: true,
        render: (r) => (
          <Text variant="label" tone="muted" numberOfLines={1}>
            {r.storeId ? (byId.get(r.storeId)?.name ?? "Unknown store") : "All stores"}
          </Text>
        ),
      },
    ],
    [term, byId, fallbackCurrency],
  );

  const px = bp === "phone" ? gutter : 0;
  return (
    <View style={{ flex: 1, paddingHorizontal: px, paddingBottom: bp === "phone" ? gutter : 0, gap: t.space(3) }}>
      <Row gap={2} wrap>
        {FILTERS.map((f) => (
          <Chip key={f.value || "all"} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </Row>
      <Panel padded={false} style={{ flex: 1, minHeight: 0 }}>
        <DataList
          label="Activity"
          rows={rows}
          columns={columns}
          keyOf={(r) => r.id}
          loading={log.isPending}
          onEndReached={() => {
            if (log.hasNextPage && !log.isFetchingNextPage) void log.fetchNextPage();
          }}
          empty={
            log.error ? (
              <View style={{ padding: t.space(4) }}>
                <ErrorNote message="Activity could not load." onRetry={() => void log.refetch()} />
              </View>
            ) : (
              <EmptyState title="No activity yet" body="Sales, refunds, overrides, stock moves and team changes appear here as they happen." />
            )
          }
          footer={
            log.isFetchingNextPage ? (
              <Stack gap={2} style={{ padding: t.space(4) }}>
                <Skeleton height={14} width="40%" />
              </Stack>
            ) : null
          }
        />
      </Panel>
    </View>
  );
}
