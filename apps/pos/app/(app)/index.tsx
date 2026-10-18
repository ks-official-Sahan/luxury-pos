import { useState } from "react";
import { View } from "react-native";
import { CartPanel } from "@/features/sell/CartPanel";
import { CatalogGrid } from "@/features/sell/CatalogGrid";
import { CheckoutSheet, ClientSheet, DiscountSheet } from "@/features/sell/sheets";
import { useStore } from "@/lib/queries";
import { priceLines, useCart } from "@/state/cart";
import { useTokens } from "@/theme/BrandProvider";
import { Sheet } from "@/ui/Sheet";
import { Button, useLayout } from "@/ui/primitives";
import { formatMoney } from "@luxury-pos/core";

/** Register. Tablet/desktop: catalogue and sale side by side. Phone: catalogue with a floating sale button. */
export default function Sell() {
  const t = useTokens();
  const { wide } = useLayout();
  const store = useStore();
  const { lines, orderDiscount } = useCart();
  const [sheet, setSheet] = useState<null | "cart" | "pay" | "client" | "discount">(null);
  const close = () => setSheet(null);
  const panel = <CartPanel onPay={() => setSheet("pay")} onClient={() => setSheet("client")} onDiscount={() => setSheet("discount")} />;
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = store ? priceLines(lines, orderDiscount, store.currency, store.taxMode).total : 0;

  return (
    <View style={{ flex: 1, flexDirection: wide ? "row" : "column" }}>
      <CatalogGrid />
      {wide ? (
        <View style={{ width: 420, borderLeftWidth: 1, borderLeftColor: t.color.border }}>{panel}</View>
      ) : (
        <>
          {count > 0 && store ? (
            <View style={{ position: "absolute", left: t.space(4), right: t.space(4), bottom: t.space(4) }}>
              <Button size="lg" label={`Sale · ${count} · ${formatMoney(total, store.currency)}`} onPress={() => setSheet("cart")} />
            </View>
          ) : null}
          <Sheet visible={sheet === "cart"} onClose={close} title="Sale">
            <View style={{ height: 520, marginHorizontal: -t.space(5) }}>{panel}</View>
          </Sheet>
        </>
      )}
      <CheckoutSheet visible={sheet === "pay"} onClose={close} />
      <ClientSheet visible={sheet === "client"} onClose={() => setSheet(wide ? null : "cart")} />
      <DiscountSheet visible={sheet === "discount"} onClose={() => setSheet(wide ? null : "cart")} />
    </View>
  );
}
