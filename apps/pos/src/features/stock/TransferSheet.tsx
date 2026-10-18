import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import type { StoreInfo } from "@/lib/queries";
import type { CatalogItem } from "@/state/cart";
import { useTokens } from "@/theme/BrandProvider";
import { Minus, Plus, Trash } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";
import { Button, Chip, EmptyState, ErrorNote, Field, IconButton, Row, Stack, Text } from "@/ui/primitives";
import { ItemSearch } from "./ItemSearch";
import { idempotentId, optionsCaption, type IdempotencyKey } from "./model";

interface TransferLine {
  item: CatalogItem;
  quantity: number;
}

interface TransferBody {
  fromStoreId: string;
  toStoreId: string;
  lines: { variantId: string; quantity: number }[];
  note?: string;
}

interface TransferRequest {
  id: string;
  body: TransferBody;
  toName: string;
}

interface TransferSheetProps {
  from: StoreInfo;
  destinations: StoreInfo[];
  onClose: () => void;
}

/** Moves stock from this store to another in one request: both sides change or neither does. */
export function TransferSheet({ from, destinations, onClose }: TransferSheetProps) {
  const t = useTokens();
  const qc = useQueryClient();
  const [toId, setToId] = useState(destinations[0]?.id ?? "");
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [note, setNote] = useState("");
  const idem = useRef<IdempotencyKey | null>(null);
  const to = destinations.find((d) => d.id === toId) ?? null;
  const picked = useMemo(() => new Set(lines.map((l) => l.item.variantId)), [lines]);
  const problem = lines.length === 0 ? "Add at least one item to send." : !to ? "Choose the store to send to." : null;

  const add = (item: CatalogItem) => setLines((prev) => (prev.some((l) => l.item.variantId === item.variantId) ? prev : [...prev, { item, quantity: 1 }]));
  const setQuantity = (variantId: string, quantity: number) => setLines((prev) => prev.map((l) => (l.item.variantId === variantId ? { ...l, quantity } : l)));
  const remove = (variantId: string) => setLines((prev) => prev.filter((l) => l.item.variantId !== variantId));

  const save = useMutation({
    mutationFn: ({ id, body }: TransferRequest) => api<unknown>("/stock/transfers", { method: "POST", json: { id, ...body } }),
    onSuccess: (_data, { toName, body }) => {
      void qc.invalidateQueries({ queryKey: ["low-stock"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(`${body.lines.length} ${body.lines.length === 1 ? "item" : "items"} sent to ${toName}`);
      onClose();
    },
  });

  const submit = () => {
    if (problem || !to) return;
    const body: TransferBody = {
      fromStoreId: from.id,
      toStoreId: to.id,
      lines: lines.map((l) => ({ variantId: l.item.variantId, quantity: l.quantity })),
      note: note.trim() || undefined,
    };
    save.mutate({ id: idempotentId(idem, body), body, toName: to.name });
  };

  const failure = save.error instanceof Error ? save.error.message : "Please try again.";

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Transfer stock"
      description={`From ${from.name}. Choose where the stock goes.`}
      footer={
        <Stack gap={2}>
          <Button label="Send transfer" size="lg" block disabled={!!problem || save.isPending} loading={save.isPending} onPress={submit} />
          {problem ? (
            <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
              {problem}
            </Text>
          ) : null}
        </Stack>
      }
    >
      <Stack gap={2}>
        <Text variant="label" tone="muted">
          Send to
        </Text>
        <Row gap={2} wrap>
          {destinations.map((d) => (
            <Chip key={d.id} label={d.name} selected={d.id === toId} onPress={() => setToId(d.id)} />
          ))}
        </Row>
      </Stack>

      <Stack gap={3}>
        <Text variant="subheading" accessibilityRole="header">
          Items
        </Text>
        <ItemSearch
          storeId={from.id}
          actionLabel="Add"
          onPick={add}
          isPicked={(item) => picked.has(item.variantId)}
          isDisabled={(item) => (item.available ?? 0) <= 0}
        />
        {lines.length === 0 ? <EmptyState title="No items yet" body="Search above and add the items to send." /> : null}
        {lines.map((line) => {
          const max = line.item.available ?? 0;
          return (
            <Row key={line.item.variantId} gap={3} style={{ paddingVertical: t.space(2), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                  {line.item.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {`${optionsCaption(line.item.options, line.item.sku)} · ${max} at ${from.name}`}
                </Text>
              </View>
              <Stepper name={line.item.name} value={line.quantity} max={Math.max(1, max)} onChange={(q) => setQuantity(line.item.variantId, q)} />
              <IconButton label={`Remove ${line.item.name}`} size="sm" onPress={() => remove(line.item.variantId)}>
                <Trash size={18} color={t.color.text} />
              </IconButton>
            </Row>
          );
        })}
      </Stack>

      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={280} placeholder="Reason for the transfer" />

      {save.error ? <ErrorNote message={`Not sent. ${failure}`} /> : null}
    </Sheet>
  );
}

function Stepper({ name, value, max, onChange }: { name: string; value: number; max: number; onChange: (v: number) => void }) {
  const t = useTokens();
  return (
    <Row gap={1}>
      <IconButton label={`Decrease quantity of ${name}`} size="sm" disabled={value <= 1} onPress={() => onChange(value - 1)}>
        <Minus size={18} color={t.color.text} />
      </IconButton>
      <Text variant="label" accessibilityLabel={`${value} units`} style={{ minWidth: 28, textAlign: "center", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <IconButton label={`Increase quantity of ${name}`} size="sm" disabled={value >= max} onPress={() => onChange(value + 1)}>
        <Plus size={18} color={t.color.text} />
      </IconButton>
    </Row>
  );
}
