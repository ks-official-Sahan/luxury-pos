import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney } from "@luxury-pos/core";
import { CatalogGrid } from "@/features/sell/CatalogGrid";
import { ClientSheet, DiscountSheet } from "@/features/sell/sheets";
import { TenderPanel } from "@/features/sell/TenderPanel";
import { Ticket } from "@/features/sell/Ticket";
import { api } from "@/lib/api";
import { useStore } from "@/lib/queries";
import { useSession } from "@/state/session";
import { useShortcuts } from "@/shell/useShortcuts";
import { priceLines, useCart } from "@/state/cart";
import { useBrand } from "@/theme/BrandProvider";
import { Badge, Button, Money, Row, Text, useLayout } from "@/ui/primitives";

/**
 * Device trust, said up front: a till waiting for approval (or blocked) shows it here,
 * rather than letting someone build a whole sale and fail at payment.
 */
function DeviceNotice() {
  const { tokens: t } = useBrand();
  const deviceId = useSession((s) => s.deviceId);
  const status = useQuery({ queryKey: ["device-status", deviceId], queryFn: () => api<{ status: "pending" | "approved" | "blocked"; code: string }>(`/devices/${deviceId}/status`), enabled: !!deviceId, refetchInterval: (q) => (q.state.data?.status === "approved" ? false : 15_000) });
  const s = status.data?.status;
  if (!s || s === "approved") return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: t.space(3), paddingHorizontal: t.space(4), paddingVertical: t.space(3), backgroundColor: s === "blocked" ? t.color.dangerSoft : t.color.warningSoft }}>
      <Badge tone={s === "blocked" ? "danger" : "warning"} label={s === "blocked" ? "Till blocked" : "Waiting for approval"} />
      <Text variant="label" tone={s === "blocked" ? "danger" : "warning"} style={{ flex: 1 }}>
        {s === "blocked" ? "A manager blocked this device. It can still look things up but cannot take sales." : `Ask a manager to approve till ${status.data?.code ?? ""} in Settings → Devices. You can browse in the meantime; sales unlock as soon as it is approved.`}
      </Text>
    </View>
  );
}

type Mode = "browse" | "ticket" | "tender";

/**
 * Register.
 * - Tablet/desktop: catalogue (or payment) beside the sale; the side is a brand setting
 *   (counter position, handedness).
 * - Phone: catalogue with a sticky sale bar in thumb reach → full-screen sale → payment.
 */
export default function Register() {
  const { tokens: t, theme } = useBrand();
  const { wide, width } = useLayout();
  const insets = useSafeAreaInsets();
  const store = useStore();
  const { lines, orderDiscount } = useCart();
  const [mode, setMode] = useState<Mode>("browse");
  const [sheet, setSheet] = useState<null | "client" | "discount">(null);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = store ? priceLines(lines, orderDiscount, store.currency, store.taxMode).total : 0;
  const pay = () => lines.length && setMode("tender");
  useShortcuts({ "mod+enter": mode === "browse" ? pay : undefined });

  const sheets = (
    <>
      <ClientSheet visible={sheet === "client"} onClose={() => setSheet(null)} />
      <DiscountSheet visible={sheet === "discount"} onClose={() => setSheet(null)} />
    </>
  );
  const ticket = (onClose?: () => void) => <Ticket tendering={mode === "tender"} onPay={pay} onClient={() => setSheet("client")} onDiscount={() => setSheet("discount")} onClose={onClose} />;
  const tender = <TenderPanel onBack={() => setMode(wide ? "browse" : "ticket")} onDone={() => setMode("browse")} />;

  if (wide) {
    const ticketWidth = width >= 1400 ? 440 : width >= 1180 ? 400 : 360;
    const side = (
      <View style={{ width: ticketWidth, borderColor: t.color.border, [theme.layout.ticketSide === "right" ? "borderLeftWidth" : "borderRightWidth"]: 1 }}>{ticket()}</View>
    );
    // Catalogue width = window minus sidebar/rail and ticket; used to fit tile columns.
    const nav = width >= 1180 ? 248 : 84;
    const main = <View style={{ flex: 1 }}>{mode === "tender" ? tender : <CatalogGrid width={width - nav - ticketWidth} />}</View>;
    return (
      <View style={{ flex: 1 }}>
        <DeviceNotice />
        <View style={{ flex: 1, flexDirection: "row" }}>
          {theme.layout.ticketSide === "left" ? side : null}
          {main}
          {theme.layout.ticketSide === "right" ? side : null}
          {sheets}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <DeviceNotice />
      <CatalogGrid width={width} />
      {count > 0 && store ? (
        <View style={{ position: "absolute", left: t.space(3), right: t.space(3), bottom: t.space(3) }}>
          <Button
            size="xl"
            block
            label={`${count} item${count > 1 ? "s" : ""}`}
            trailing={
              <Row gap={2}>
                <Money amount={total} currency={store.currency} variant="subheading" tone="onPrimary" />
                <Text variant="label" tone="onPrimary">
                  Review
                </Text>
              </Row>
            }
            accessibilityHint={`Opens the sale, total ${formatMoney(total, store.currency)}`}
            onPress={() => setMode("ticket")}
          />
        </View>
      ) : null}
      <Modal visible={mode !== "browse"} animationType={t.motion.enabled ? "slide" : "none"} onRequestClose={() => setMode(mode === "tender" ? "ticket" : "browse")} presentationStyle="fullScreen">
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.color.surface }}>{mode === "tender" ? tender : ticket(() => setMode("browse"))}</View>
        {sheets}
      </Modal>
      {mode === "browse" ? sheets : null}
    </View>
  );
}
