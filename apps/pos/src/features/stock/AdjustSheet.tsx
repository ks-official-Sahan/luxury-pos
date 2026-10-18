import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { useCan, type StoreInfo } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { Minus, Plus } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";
import { Button, EmptyState, ErrorNote, Field, IconButton, Panel, Row, Segmented, Text } from "@/ui/primitives";
import { ItemSearch } from "./ItemSearch";
import { ADJUST_HINT, ADJUST_LABEL, ADJUST_SUBMIT, idempotentId, optionsCaption, planAdjust, reasonPlaceholder, stepQuantity, targetFromItem, type AdjustField, type AdjustMode, type IdempotencyKey, type StockTarget } from "./model";

interface AdjustSheetProps {
  store: StoreInfo;
  /** null opens with the item search first (Receive stock from the header). */
  initialTarget: StockTarget | null;
  initialMode: AdjustMode;
  onClose: () => void;
}

interface MovementBody {
  variantId: string;
  type: "receive" | "adjust";
  quantity: number;
  unitCost?: number;
  reason?: string;
}

/** Records one stock movement at one store. Mount it per open; it starts from the props it receives. */
export function AdjustSheet({ store, initialTarget, initialMode, onClose }: AdjustSheetProps) {
  const t = useTokens();
  const can = useCan();
  const qc = useQueryClient();
  const modes = (["receive", "count", "damage"] as const).filter((m) => (m === "receive" ? can("inventory.receive") : can("inventory.adjust")));

  const [target, setTarget] = useState<StockTarget | null>(initialTarget);
  const [mode, setMode] = useState<AdjustMode>(modes.includes(initialMode) ? initialMode : (modes[0] ?? "count"));
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const idem = useRef<IdempotencyKey | null>(null);

  const result = target ? planAdjust({ mode, quantity, unitCost, reason, currency: store.currency, available: target.available }) : null;
  const errors: Partial<Record<AdjustField, string>> = result && !result.ok ? result.errors : {};
  const shown = (field: AdjustField): string | null => (attempted ? (errors[field] ?? null) : null);

  const save = useMutation({
    mutationFn: ({ id, movement }: { id: string; movement: MovementBody }) => api<unknown>("/stock/movements", { method: "POST", json: { id, storeId: store.id, ...movement } }),
    onSuccess: (_data, { movement }) => {
      void qc.invalidateQueries({ queryKey: ["low-stock"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(`${movement.type === "receive" ? "Received" : "Adjusted"} ${target?.name ?? "item"}`);
      onClose();
    },
  });

  const submit = () => {
    setAttempted(true);
    if (!target || !result || !result.ok) return;
    const movement: MovementBody = { variantId: target.variantId, ...result.plan };
    save.mutate({ id: idempotentId(idem, { storeId: store.id, ...movement }), movement });
  };

  const failure = save.error instanceof Error ? save.error.message : "Please try again.";

  return (
    <Sheet
      visible
      onClose={onClose}
      title={mode === "receive" ? "Receive stock" : "Adjust stock"}
      description={target ? undefined : "Choose the item first."}
      width={480}
      footer={<Button label={ADJUST_SUBMIT[mode]} size="lg" block disabled={!target || save.isPending} loading={save.isPending} onPress={submit} />}
    >
      {target ? (
        <Panel tone="sunken">
          <Row justify="space-between" align="flex-start" gap={3}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="label" numberOfLines={2} style={{ fontWeight: "600" }}>
                {target.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {`${optionsCaption(target.options, target.sku)} · ${target.available} available at ${store.name}`}
              </Text>
            </View>
            <Button kind="ghost" size="sm" label="Change item" onPress={() => setTarget(null)} />
          </Row>
        </Panel>
      ) : (
        <ItemSearch storeId={store.id} actionLabel="Choose" onPick={(item) => setTarget(targetFromItem(item))} />
      )}

      {target && modes.length === 0 ? <EmptyState title="Stock is view only" body="Your role can see stock but not change it." /> : null}

      {target && modes.length > 0 ? (
        <>
          {modes.length > 1 ? (
            <Segmented<AdjustMode> label="Adjustment type" value={mode} onChange={setMode} size="lg" options={modes.map((m) => ({ value: m, label: ADJUST_LABEL[m] }))} />
          ) : null}
          <Text variant="caption" tone="muted">
            {ADJUST_HINT[mode]}
          </Text>

          <Field
            label={mode === "count" ? "Change in units (+ or -)" : mode === "receive" ? "Units received" : "Units damaged or lost"}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numbers-and-punctuation"
            maxLength={7}
            error={shown("quantity")}
            hint={mode === "damage" ? `${target.available} available now` : undefined}
            leading={
              <IconButton label="Decrease quantity" size="sm" onPress={() => setQuantity(stepQuantity(quantity, -1, mode))}>
                <Minus size={18} color={t.color.text} />
              </IconButton>
            }
            trailing={
              <IconButton label="Increase quantity" size="sm" onPress={() => setQuantity(stepQuantity(quantity, 1, mode))}>
                <Plus size={18} color={t.color.text} />
              </IconButton>
            }
          />

          {mode === "receive" ? (
            <Field
              label={`Unit cost in ${store.currency}, optional`}
              value={unitCost}
              onChangeText={setUnitCost}
              keyboardType="decimal-pad"
              placeholder="0.00"
              hint="Updates the average cost of this item."
              error={shown("unitCost")}
            />
          ) : null}

          <Field
            label={mode === "receive" ? "Reason (optional)" : "Reason"}
            value={reason}
            onChangeText={setReason}
            maxLength={280}
            placeholder={reasonPlaceholder(mode)}
            error={shown("reason")}
          />

          <Text variant="caption" tone="muted">
            Every change is recorded in the stock ledger with your name.
          </Text>
        </>
      ) : null}

      {save.error ? <ErrorNote message={`Not recorded. ${failure}`} /> : null}
    </Sheet>
  );
}
