import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { currencyExponent, formatMoney, parseMoney, type Discount } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useCan, useStore } from "@/lib/queries";
import { useCart, type CartLine } from "@/state/cart";
import { useTokens } from "@/theme/BrandProvider";
import { Check } from "@/ui/icons";
import { Button, Chip, Field, Row, Stack, Text } from "@/ui/primitives";

const DISCOUNTS = [0, 500, 1000, 1500, 2000] as const;

/**
 * Opens under a ticket line: serial number (required for serialized pieces),
 * line discount and price. Changes apply as they are made; "Done" only closes.
 * Anything above the associate's limit is approved by a manager at payment,
 * so the editor never blocks the sale.
 */
export function LineEditor({ line, onDone }: { line: CartLine; onDone: () => void }) {
  const t = useTokens();
  const store = useStore();
  const can = useCan();
  const update = useCart((s) => s.update);
  const [price, setPrice] = useState(line.priceOverride !== undefined && store ? String(line.priceOverride / 10 ** currencyExponent(store.currency)) : "");
  const [serialText, setSerialText] = useState(line.serialNumber ?? "");
  const serials = useQuery({
    queryKey: ["serials", store?.id, line.item.variantId],
    queryFn: () => api<{ serial: string }[]>(`/stores/${store!.id}/serials?variantId=${line.item.variantId}`),
    enabled: !!store && line.item.serialized,
    staleTime: 30_000,
  });
  if (!store) return null;

  const bps = line.discount?.kind === "percent" ? line.discount.bps : 0;
  const setDiscount = (v: number) => update(line.key, { discount: v ? ({ kind: "percent", bps: v, reason: "Line discount" } satisfies Discount) : undefined });
  const priceError = price.trim() && parseMoney(price, store.currency) === null ? "Enter an amount like 1250.00" : null;
  const commitPrice = (v: string) => {
    setPrice(v);
    const amount = v.trim() ? parseMoney(v, store.currency) : null;
    update(line.key, { priceOverride: amount === null || amount === line.item.price ? undefined : amount });
  };
  const chooseSerial = (s: string) => {
    setSerialText(s);
    update(line.key, { serialNumber: s.trim() || undefined });
  };

  return (
    <Stack gap={4} style={{ paddingTop: t.space(3), paddingBottom: t.space(1) }}>
      {line.item.serialized ? (
        <Stack gap={2}>
          <Text variant="label" tone={line.serialNumber ? "muted" : "warning"} style={{ fontWeight: "600" }}>
            {line.serialNumber ? "Serial number" : "Choose the serial number to sell"}
          </Text>
          {serials.data?.length ? (
            <Row gap={2} wrap>
              {serials.data.map((s) => (
                <Chip key={s.serial} label={s.serial} selected={line.serialNumber === s.serial} icon={line.serialNumber === s.serial ? <Check size={14} color={t.color.onPrimarySoft} /> : undefined} onPress={() => chooseSerial(s.serial)} />
              ))}
            </Row>
          ) : serials.isSuccess ? (
            <Text variant="caption" tone="muted">
              No serial numbers recorded in stock here. Type the one on the piece.
            </Text>
          ) : null}
          <Field label="Serial number" hideLabel placeholder="Or type or scan the serial" value={serialText} onChangeText={chooseSerial} autoCapitalize="characters" autoCorrect={false} />
        </Stack>
      ) : null}

      <Stack gap={2}>
        <Text variant="label" tone="muted">
          Discount on this line
        </Text>
        <Row gap={2} wrap>
          {DISCOUNTS.map((v) => (
            <Chip key={v} label={v ? `${v / 100}%` : "None"} selected={bps === v} onPress={() => setDiscount(v)} />
          ))}
        </Row>
      </Stack>

      <Field
        label="Unit price"
        placeholder={formatMoney(line.item.price, store.currency)}
        value={price}
        onChangeText={commitPrice}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={priceError}
        hint={can("sale.price_override") ? `List price ${formatMoney(line.item.price, store.currency)}` : "A different price needs a manager’s approval at payment."}
      />

      <View style={{ alignItems: "flex-end" }}>
        <Button kind="secondary" size="sm" label="Done" onPress={onDone} />
      </View>
    </Stack>
  );
}
