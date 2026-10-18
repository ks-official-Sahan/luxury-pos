import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkle } from "@/ui/icons";
import { useState } from "react";
import { View } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { isoDay, useCan, useStore } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { Screen } from "@/ui/Screen";
import { Button, Chip, Field, Money, Row, Stack, Surface, Text, useLayout } from "@/ui/primitives";

type Summary = {
  totals: { orders: number; items: number; net: number; discounts: number; refunds: number; averageOrder: number; marginBps: number };
  series: { day: string; net: number; orders: number }[];
  byStore: { storeId: string; name: string; currency: string; net: number; orders: number }[];
};
type Top = { variantId: string; name: string; sku: string; quantity: number; revenue: number }[];

const RANGES = [7, 30, 90] as const;

/** Bars as plain views: no chart dependency, scales to the container, readable by screen readers as a list. */
function Bars({ series, currency }: { series: Summary["series"]; currency: string }) {
  const t = useTokens();
  const max = Math.max(1, ...series.map((d) => d.net));
  return (
    <View accessibilityRole="list" accessibilityLabel="Net sales per day" style={{ flexDirection: "row", alignItems: "flex-end", height: 160, gap: 3 }}>
      {series.map((d) => (
        <View key={d.day} accessibilityRole="text" accessibilityLabel={`${d.day}: ${formatMoney(d.net, currency)}`} style={{ flex: 1, height: `${Math.max(2, (d.net / max) * 100)}%`, backgroundColor: t.color.primary, borderTopLeftRadius: t.radius.sm, borderTopRightRadius: t.radius.sm, opacity: 0.85 }} />
      ))}
    </View>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Surface style={{ flexGrow: 1, flexBasis: 200 }}>
      <Stack gap={1}>
        <Text variant="eyebrow" tone="muted">
          {label}
        </Text>
        <Text variant="title">{value}</Text>
        {hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
      </Stack>
    </Surface>
  );
}

export default function Insights() {
  const t = useTokens();
  const { wide } = useLayout();
  const store = useStore();
  const can = useCan();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [question, setQuestion] = useState("");
  const range = { from: isoDay(new Date(Date.now() - (days - 1) * 86_400_000)), to: isoDay(new Date()), ...(store ? { storeId: store.id } : {}) };
  const qs = new URLSearchParams(range).toString();
  const summary = useQuery({ queryKey: ["summary", qs], queryFn: () => api<Summary>(`/reports/summary?${qs}`) });
  const top = useQuery({ queryKey: ["top", qs], queryFn: () => api<Top>(`/reports/top-products?${qs}`) });
  const ask = useMutation({ mutationFn: (q: string) => api<{ answer: string }>("/insights/ask", { method: "POST", json: { question: q, storeId: store?.id } }) });
  const cur = store?.currency ?? "USD";
  const s = summary.data?.totals;

  return (
    <Screen
      eyebrow={store?.name ?? "All stores"}
      title="Insights"
      subtitle="Sales, best sellers and an analyst you can ask in plain language."
      actions={
        <Row gap={2}>
          {RANGES.map((d) => (
            <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />
          ))}
        </Row>
      }
    >
      <Stack gap={5}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(4) }}>
          <Kpi label="Net sales" value={s ? formatMoney(s.net, cur) : "—"} hint={s ? `${s.orders} orders` : undefined} />
          <Kpi label="Average order" value={s ? formatMoney(s.averageOrder, cur) : "—"} />
          <Kpi label="Gross margin" value={s ? `${(s.marginBps / 100).toFixed(1)}%` : "—"} />
          <Kpi label="Refunds" value={s ? formatMoney(s.refunds, cur) : "—"} hint={s ? `Discounts ${formatMoney(s.discounts, cur)}` : undefined} />
        </View>

        <View style={{ flexDirection: wide ? "row" : "column", gap: t.space(4) }}>
          <Surface style={{ flex: 2 }}>
            <Stack gap={4}>
              <Text variant="heading">Net sales by day</Text>
              {summary.data ? <Bars series={summary.data.series} currency={cur} /> : <Text tone="muted">Loading…</Text>}
            </Stack>
          </Surface>
          <Surface style={{ flex: 1 }}>
            <Stack gap={3}>
              <Text variant="heading">Best sellers</Text>
              {top.data?.map((p, i) => (
                <Row key={p.variantId} style={{ justifyContent: "space-between" }}>
                  <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                    {i + 1}. {p.name}
                  </Text>
                  <Money amount={p.revenue} currency={cur} variant="label" tone="muted" />
                </Row>
              ))}
              {top.data && !top.data.length ? <Text tone="muted">No sales in this period yet.</Text> : null}
            </Stack>
          </Surface>
        </View>

        {can("ai.insights") ? (
          <Surface raised>
            <Stack gap={3}>
              <Row gap={2}>
                <Sparkle size={20} weight="light" color={t.color.accent} />
                <Text variant="heading">Ask the analyst</Text>
              </Row>
              <Field label="Question" value={question} onChangeText={setQuestion} placeholder="Which items should I reorder before the weekend?" onSubmitEditing={() => question && ask.mutate(question)} />
              <Button label="Ask" loading={ask.isPending} disabled={question.trim().length < 3} onPress={() => ask.mutate(question)} style={{ alignSelf: "flex-start" }} />
              {ask.data ? <Text>{ask.data.answer}</Text> : null}
              {ask.error ? <Text tone="danger">{(ask.error as Error).message}</Text> : null}
            </Stack>
          </Surface>
        ) : null}
      </Stack>
    </Screen>
  );
}
