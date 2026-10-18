import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { useOutbox } from "@/state/outbox";
import { useCan, useMe } from "@/lib/queries";
import { fillDays, periods, RANGES, useReport, type Anomaly, type RangeKey, type StaffRow, type Summary, type TopProduct } from "@/lib/reports";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { AreaChart, Delta, Meter, ShareBar } from "@/ui/charts";
import { ArrowRight, Sparkle, Warning } from "@/ui/icons";
import { Badge, Button, Chip, EmptyState, ErrorNote, Field, Money, Panel, Row, SectionHeader, Segmented, Skeleton, Stack, Text, useLayout } from "@/ui/primitives";
import { Screen } from "@/ui/Screen";

type LowStock = { variantId: string; name: string; sku: string; options: Record<string, string>; available: number; reorderPoint: number; sold28: number; suggested?: number }[];

/** Two-up on wide screens, stacked on phones. Columns are weighted, not identical cards. */
function Columns({ children, weights }: { children: React.ReactNode[]; weights: number[] }) {
  const t = useTokens();
  const { bp } = useLayout();
  if (bp !== "desktop") return <Stack gap={5}>{children}</Stack>;
  return (
    <View style={{ flexDirection: "row", gap: t.space(5), alignItems: "stretch" }}>
      {children.map((c, i) => (
        <View key={i} style={{ flex: weights[i] ?? 1, minWidth: 0 }}>
          {c}
        </View>
      ))}
    </View>
  );
}

function Figure({ label, value, current, previous, invert }: { label: string; value: string; current?: number; previous?: number; invert?: boolean }) {
  const t = useTokens();
  return (
    <View style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border, gap: 2 }}>
      <Row justify="space-between" align="baseline">
        <Text variant="label" tone="muted">
          {label}
        </Text>
        <Text variant="subheading" style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
      </Row>
      {current !== undefined && previous !== undefined ? (
        <View style={{ alignItems: "flex-end" }}>
          <Delta current={current} previous={previous} invert={invert} quietWhenEmpty />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Overview: what happened, compared with what usually happens, and what to do
 * about it. Every figure comes from the same rollups the MCP server and AI analyst
 * read, and links to the orders behind it.
 */
export default function Dashboard() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const router = useRouter();
  const me = useMe();
  const [range, setRange] = useState<RangeKey>("7d");
  const [chosen, setStoreId] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState("");
  const f = useFormat();
  const queued = useOutbox((o) => o.items.length);
  const days = RANGES.find((r) => r.value === range)!.days;
  const { current, previous } = periods(days);
  const stores = me.data?.stores ?? [];
  // Amounts in different currencies never add up: a combined view only exists when every store shares one.
  const oneCurrency = new Set(stores.map((x) => x.currency)).size <= 1;
  const storeId = chosen ?? (oneCurrency ? undefined : stores[0]?.id);
  const currency = (storeId ? stores.find((s) => s.id === storeId)?.currency : stores[0]?.currency) ?? "EUR";
  const money = (v: number) => formatMoney(v, currency);

  const summary = useReport<Summary>("summary", current, storeId);
  const before = useReport<Summary>("summary", previous, storeId);
  const top = useReport<TopProduct[]>("top-products", current, storeId);
  const staff = useReport<StaffRow[]>("staff", current, storeId);
  const anomalies = useReport<Anomaly[]>("anomalies", current, storeId, can("staff.manage") || can("reports.read"));
  const lowStore = storeId ?? stores[0]?.id;
  const low = useQuery({ queryKey: ["low-stock", lowStore], queryFn: () => api<LowStock>(`/stores/${lowStore}/low-stock`), enabled: !!lowStore && can("inventory.read"), staleTime: 120_000 });
  const ask = useMutation({ mutationFn: (q: string) => api<{ answer: string }>("/insights/ask", { method: "POST", json: { question: q, storeId, currency } }) });

  const s = summary.data?.totals;
  const p = before.data?.totals;
  const series = summary.data ? fillDays(summary.data.series, current.from, current.to) : [];
  const compare = before.data ? fillDays(before.data.series, previous.from, previous.to).map((d) => d.y) : undefined;
  const flagged = (anomalies.data ?? []).filter((a) => a.flagged);
  const maxRevenue = Math.max(1, ...(top.data ?? []).map((r) => r.revenue));

  return (
    <Screen
      title="Overview"
      subtitle={`${storeId ? stores.find((x) => x.id === storeId)?.name : "All stores"} · ${current.from === current.to ? "Today" : f.range(current.from, current.to)}`}
      toolbar={
        <Row gap={3} wrap>
          <Segmented label="Period" value={range} onChange={setRange} options={RANGES} />
          {stores.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
              {oneCurrency ? <Chip label="All stores" selected={!storeId} onPress={() => setStoreId(undefined)} /> : null}
              {stores.map((st) => (
                <Chip key={st.id} label={oneCurrency ? st.name : `${st.name} · ${st.currency}`} selected={storeId === st.id} onPress={() => setStoreId(st.id)} />
              ))}
            </ScrollView>
          ) : null}
        </Row>
      }
    >
      {summary.error ? <ErrorNote message="The numbers could not load. They will retry automatically." onRetry={() => void summary.refetch()} /> : null}

      {/* Lead with what someone can act on; the figures follow. */}
      {(low.data?.length ?? 0) + flagged.length + queued > 0 ? (
        <View accessibilityRole="summary" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(2) }}>
          {low.data?.length ? (
            <Button kind="soft" size="sm" icon={<Warning size={16} color={t.color.onPrimarySoft} />} label={`${low.data.length} item${low.data.length > 1 ? "s" : ""} running low`} trailing={<ArrowRight size={14} color={t.color.onPrimarySoft} />} onPress={() => router.navigate("/inventory")} />
          ) : null}
          {flagged.length ? (
            <Button kind="soft" size="sm" icon={<Warning size={16} color={t.color.onPrimarySoft} />} label={`${flagged.length} unusual activit${flagged.length > 1 ? "ies" : "y"} to review`} trailing={<ArrowRight size={14} color={t.color.onPrimarySoft} />} onPress={() => router.navigate("/team")} />
          ) : null}
          {queued ? <Button kind="soft" size="sm" label={`${queued} sale${queued > 1 ? "s" : ""} waiting to sync`} trailing={<ArrowRight size={14} color={t.color.onPrimarySoft} />} onPress={() => router.navigate("/settings")} /> : null}
        </View>
      ) : null}

      <Columns weights={[2, 1]}>
        <Panel>
          <Row justify="space-between" align="flex-start" wrap>
            <Stack gap={1}>
              <Text variant="label" tone="muted">
                Net sales
              </Text>
              {s ? <Money amount={s.net} currency={currency} variant="amount" style={{ fontSize: t.display.xl, lineHeight: Math.round(t.display.xl * 1.15) }} /> : <Skeleton width={200} height={32} />}
              {s && p ? <Delta current={s.net} previous={p.net} /> : null}
            </Stack>
            <Button kind="ghost" size="sm" label="See orders" trailing={<ArrowRight size={16} color={t.color.text} />} onPress={() => router.navigate("/orders")} />
          </Row>
          <View style={{ marginTop: t.space(5) }}>{summary.isLoading ? <Skeleton height={180} /> : <AreaChart series={series} compare={compare} format={money} formatX={(x) => f.date(x)} tickX={(x) => f.tick(x)} label="Net sales per day, dashed line is the previous period" />}</View>
        </Panel>
        <Panel>
          <SectionHeader title="Key figures" description="Against the previous period of the same length" />
          {s ? (
            <View>
              <Figure label={`${term("Sale")}s`} value={s.orders.toLocaleString()} current={s.orders} previous={p?.orders} />
              <Figure label="Average ticket" value={money(s.averageOrder)} current={s.averageOrder} previous={p?.averageOrder} />
              <Figure label="Units sold" value={s.items.toLocaleString()} current={s.items} previous={p?.items} />
              <Figure label="Gross margin" value={`${(s.marginBps / 100).toFixed(1)}%`} current={s.marginBps} previous={p?.marginBps} />
              <Figure label="Discounts given" value={money(s.discounts)} current={s.discounts} previous={p?.discounts} invert />
              <Figure label="Refunds" value={money(s.refunds)} current={s.refunds} previous={p?.refunds} invert />
            </View>
          ) : (
            <Stack gap={4}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={18} />
              ))}
            </Stack>
          )}
        </Panel>
      </Columns>

      <Columns weights={[3, 2]}>
        <Panel>
          <SectionHeader title="Best sellers" description="By revenue before tax" />
          {top.data && !top.data.length ? <EmptyState title="No sales in this period" body="Best sellers appear as soon as the first sale is booked." /> : null}
          <View style={{ gap: t.space(3) }}>
            {(top.data ?? []).slice(0, 8).map((r, i) => (
              <View key={r.variantId} style={{ gap: 6 }}>
                <Row gap={3}>
                  <Text variant="label" tone="muted" style={{ width: 20, fontVariant: ["tabular-nums"] }}>
                    {i + 1}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                      {r.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {[...Object.values(r.options ?? {}), r.sku].join(" · ")}
                    </Text>
                  </View>
                  <Text variant="label" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                    {r.quantity} sold
                  </Text>
                  <Money amount={r.revenue} currency={currency} variant="label" style={{ minWidth: 96, textAlign: "right", fontWeight: "600" }} />
                </Row>
                <View style={{ marginLeft: 20 + t.space(3) }}>
                  <Meter value={r.revenue} max={maxRevenue} />
                </View>
              </View>
            ))}
          </View>
        </Panel>
        <Panel>
          <SectionHeader title="Team" description="Net sales per associate" />
          {staff.data && !staff.data.length ? <EmptyState title="No sales yet" body="Associates appear here after their first sale in the period." /> : null}
          <View>
            {(staff.data ?? []).map((r) => (
              <Row key={r.staffId} justify="space-between" style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                    {r.name ?? "Former member"}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {r.orders} {term("Sale").toLowerCase()}s{r.approvals ? ` · ${r.approvals} approvals` : ""}
                  </Text>
                </View>
                <Money amount={r.net} currency={currency} variant="label" style={{ fontWeight: "600" }} />
              </Row>
            ))}
          </View>
        </Panel>
      </Columns>

      <Columns weights={[1, 1]}>
        <Panel>
          <SectionHeader title="Needs attention" description={lowStore ? `Stock at ${stores.find((x) => x.id === lowStore)?.name ?? "this store"} and unusual activity` : undefined} />
          {low.data?.length || flagged.length ? (
            <View style={{ gap: t.space(1) }}>
              {flagged.map((a) => (
                <Row key={a.actorId ?? "unknown"} gap={3} style={{ paddingVertical: t.space(2) }}>
                  <Warning size={18} color={t.color.danger} weight="fill" />
                  <Text variant="label" style={{ flex: 1 }}>
                    Unusual activity: {Object.entries(a.counts).map(([k, v]) => `${v} × ${k.replace(".", " ")}`).join(", ")}
                  </Text>
                  <Badge tone="danger" label="Review" />
                </Row>
              ))}
              {(low.data ?? []).slice(0, 6).map((r) => (
                <Row key={r.variantId} gap={3} style={{ paddingVertical: t.space(2) }}>
                  <Warning size={18} color={t.color.warning} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="label" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {[...Object.values(r.options ?? {}), r.sku].join(" · ")} · {r.sold28} sold in 28 days
                    </Text>
                  </View>
                  <Badge tone={r.available <= 0 ? "danger" : "warning"} label={r.available <= 0 ? "Out" : `${r.available} left`} />
                </Row>
              ))}
              <Button kind="ghost" size="sm" label="Open stock" trailing={<ArrowRight size={16} color={t.color.text} />} onPress={() => router.navigate("/inventory")} style={{ alignSelf: "flex-start", marginTop: t.space(2) }} />
            </View>
          ) : (
            <EmptyState title="Nothing needs you right now" body="Low stock and unusual activity show up here first." />
          )}
        </Panel>
        {can("ai.insights") ? (
          <Panel>
            <SectionHeader title="Ask about your sales" description="Answers come from the last 30 days of aggregated data; no client details leave the store." />
            <Stack gap={3}>
              <Field
                label="Question"
                hideLabel
                value={question}
                onChangeText={setQuestion}
                placeholder="Which pieces should I reorder before the weekend?"
                onSubmitEditing={() => question.trim().length >= 3 && ask.mutate(question)}
                leading={<Sparkle size={18} color={t.color.primary} />}
              />
              <Row gap={2} wrap>
                {["What sold best this week?", "Which associate gives the most discounts?", "What is running low?"].map((q) => (
                  <Chip key={q} label={q} onPress={() => (setQuestion(q), ask.mutate(q))} />
                ))}
              </Row>
              {ask.isPending ? (
                <Stack gap={2}>
                  <Skeleton />
                  <Skeleton width="80%" />
                </Stack>
              ) : null}
              {ask.data ? (
                <Panel tone="sunken">
                  <Text selectable>{ask.data.answer}</Text>
                </Panel>
              ) : null}
              {ask.error ? <ErrorNote message={(ask.error as Error).message} /> : null}
            </Stack>
          </Panel>
        ) : (
          <View />
        )}
      </Columns>

      {!storeId && (summary.data?.byStore.length ?? 0) > 1 ? (
        <Panel>
          <SectionHeader title="By store" />
          <ShareBar parts={summary.data!.byStore.map((b) => ({ label: b.name, value: b.net }))} format={money} />
        </Panel>
      ) : null}
    </Screen>
  );
}
