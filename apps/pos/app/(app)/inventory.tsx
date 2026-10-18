import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { uuidv7 } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useCan, useCatalogSearch, useStore } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { Sheet } from "@/ui/Sheet";
import { Screen } from "@/ui/Screen";
import { Button, Chip, EmptyState, Field, Row, Stack, Surface, Text } from "@/ui/primitives";

type Low = { variantId: string; sku: string; name: string; options: Record<string, string>; available: number; sold28: number; reorderPoint: number; suggest: number };

/** Stock at this store: what is running low (with a reorder suggestion) and quick counts or receipts. */
export default function Inventory() {
  const t = useTokens();
  const store = useStore();
  const can = useCan();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<{ variantId: string; name: string } | null>(null);
  const [mode, setMode] = useState<"receive" | "adjust">("adjust");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const low = useQuery({ queryKey: ["low", store?.id], queryFn: () => api<Low[]>(`/stores/${store!.id}/low-stock`), enabled: !!store });
  const search = useCatalogSearch(q);
  const save = useMutation({
    mutationFn: () => api("/stock/movements", { method: "POST", json: { id: uuidv7(), storeId: store!.id, variantId: target!.variantId, type: mode, quantity: Number(qty), reason: reason || undefined } }),
    onSuccess: () => {
      setTarget(null);
      setQty("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["low"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  const valid = Number.isInteger(Number(qty)) && Number(qty) !== 0 && (mode === "adjust" || Number(qty) > 0);

  return (
    <Screen eyebrow={store?.name ?? ""} title="Stock" subtitle="Running low, suggested reorders and quick corrections.">
      <Stack gap={5}>
        <Surface>
          <Stack gap={3}>
            <Text variant="heading">Running low</Text>
            {low.data?.length ? (
              low.data.map((l) => (
                <Row key={l.variantId} style={{ justifyContent: "space-between" }}>
                  <Stack gap={1} style={{ flex: 1 }}>
                    <Text variant="label">{l.name}</Text>
                    <Text variant="caption" tone="muted">
                      {[...Object.values(l.options), l.sku].join(" · ")} · sold {l.sold28} in 28 days
                    </Text>
                  </Stack>
                  <Stack gap={1} style={{ alignItems: "flex-end" }}>
                    <Text variant="label" tone={l.available <= 0 ? "danger" : "text"}>
                      {l.available} left
                    </Text>
                    {l.suggest ? <Text variant="caption" tone="primary">Reorder {l.suggest}</Text> : null}
                  </Stack>
                </Row>
              ))
            ) : (
              <EmptyState title="All well stocked" body="Nothing is below its reorder point." />
            )}
          </Stack>
        </Surface>

        <Surface>
          <Stack gap={3}>
            <Text variant="heading">Find an item</Text>
            <Field label="Name, SKU or barcode" value={q} onChangeText={setQ} autoCapitalize="none" />
            {search.data?.slice(0, 20).map((i) => (
              <Row key={i.variantId} style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{i.name}</Text>
                  <Text variant="caption" tone="muted">
                    {[...Object.values(i.options), i.sku].join(" · ")} · {i.available ?? 0} available
                  </Text>
                </View>
                {can("inventory.adjust") || can("inventory.receive") ? <Chip label="Update" onPress={() => setTarget({ variantId: i.variantId, name: i.name })} /> : null}
              </Row>
            ))}
          </Stack>
        </Surface>
      </Stack>

      <Sheet visible={!!target} onClose={() => setTarget(null)} title={target?.name ?? ""} width={440} footer={<Button label="Record" size="lg" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} />}>
        <Row gap={2}>
          {can("inventory.adjust") ? <Chip label="Count correction" selected={mode === "adjust"} onPress={() => setMode("adjust")} /> : null}
          {can("inventory.receive") ? <Chip label="Receive delivery" selected={mode === "receive"} onPress={() => setMode("receive")} /> : null}
        </Row>
        <Field label={mode === "adjust" ? "Change (+/−)" : "Units received"} value={qty} onChangeText={setQty} keyboardType="numbers-and-punctuation" placeholder={mode === "adjust" ? "-1" : "6"} />
        <Field label="Reason" value={reason} onChangeText={setReason} placeholder={mode === "adjust" ? "Cycle count, damaged…" : "Supplier delivery note"} />
        {save.error ? <Text tone="danger">{(save.error as Error).message}</Text> : null}
        <Text variant="caption" tone="muted" style={{ marginTop: t.space(1) }}>
          Every change is recorded in the stock ledger with your name.
        </Text>
      </Sheet>
    </Screen>
  );
}
