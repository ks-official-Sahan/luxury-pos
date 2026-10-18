import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import type { Discount } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useCart, type CartClient } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { MagnifyingGlass, ShieldCheck } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { Avatar, Badge, Button, Chip, EmptyState, ErrorNote, Field, focusRing, Row, Skeleton, Stack, Text } from "@/ui/primitives";
import { requestApproval } from "./checkout";

/** Manager types their email and till PIN on the cashier's device; the token covers this one action. */
export function ApprovalSheet({ visible, action, storeId, onClose, onApproved }: { visible: boolean; action: string; storeId: string; onClose: () => void; onApproved: (token: string) => void }) {
  const t = useTokens();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await requestApproval({ action, managerEmail: email.trim(), pin, storeId });
      setPin("");
      onApproved(token);
    } catch {
      setError("Not approved. Check the email and PIN, or ask another manager.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      variant="dialog"
      title="Manager approval"
      description={action === "void" ? "Taking items off a sale needs a manager. They can approve it here; it is recorded either way." : `This ${action === "price" ? "price change" : action === "refund" ? "refund" : "discount"} is above your limit. A manager can approve it here.`}
      footer={<Button label="Approve" size="lg" block loading={busy} disabled={!email || pin.length < 4} onPress={go} icon={<ShieldCheck size={18} color={t.color.onPrimary} />} />}
    >
      <Field label="Manager email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Till PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))} secureTextEntry keyboardType="number-pad" onSubmitEditing={go} />
      {error ? <ErrorNote message={error} /> : null}
      <Text variant="caption" tone="muted">
        The approval is valid for this one action for two minutes and is recorded in the audit trail.
      </Text>
    </Sheet>
  );
}

export function DiscountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { orderDiscount, setOrderDiscount } = useCart();
  const term = useTerm();
  const [custom, setCustom] = useState("");
  const apply = (d?: Discount) => {
    setOrderDiscount(d);
    setCustom("");
    onClose();
  };
  const pct = Number(custom.replace(",", "."));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      variant="dialog"
      title={`Discount the ${term("Sale").toLowerCase()}`}
      description="Spread across every line so tax and refunds stay exact."
      footer={
        <Row gap={2}>
          {orderDiscount ? <Button kind="secondary" label="Remove discount" onPress={() => apply(undefined)} /> : null}
          <Button label={pct > 0 ? `Apply ${pct}%` : "Apply"} disabled={!(pct > 0 && pct <= 100)} onPress={() => apply({ kind: "percent", bps: Math.round(pct * 100), reason: "Associate discount" })} style={{ flex: 1 }} />
        </Row>
      }
    >
      <Row gap={2} wrap>
        {[500, 1000, 1500, 2000].map((bps) => (
          <Chip key={bps} label={`${bps / 100}%`} selected={orderDiscount?.kind === "percent" && orderDiscount.bps === bps} onPress={() => apply({ kind: "percent", bps, reason: "Associate discount" })} />
        ))}
      </Row>
      <Field label="Other percentage" value={custom} onChangeText={setCustom} keyboardType="decimal-pad" placeholder="12.5" hint="Above your limit, a manager approves at payment." />
    </Sheet>
  );
}

type ClientRow = { id: string; firstName: string; lastName: string | null; email: string | null; phone?: string | null; tierId: string | null; pointsBalance: number };

export function ClientSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTokens();
  const term = useTerm();
  const setClient = useCart((s) => s.setClient);
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const { data, isFetching, error } = useQuery({ queryKey: ["clients", deferred], queryFn: ({ signal }) => api<ClientRow[]>(`/customers?q=${encodeURIComponent(deferred)}`, { signal }), enabled: deferred.length >= 2 });
  const pick = (c: ClientRow | null) => {
    setClient(c ? ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), tierId: c.tierId, pointsBalance: c.pointsBalance } satisfies CartClient) : null);
    setQ("");
    onClose();
  };
  const noun = term("Customer").toLowerCase();
  return (
    <Sheet visible={visible} onClose={onClose} title={`Find a ${noun}`} footer={<Button kind="ghost" label={`Continue without a ${noun}`} onPress={() => pick(null)} />}>
      <Field label="Name, email or phone" hideLabel placeholder="Name, email or phone" value={q} onChangeText={setQ} autoFocus autoCapitalize="none" leading={<MagnifyingGlass size={18} color={t.color.textMuted} />} />
      {error ? <ErrorNote message="Search is unavailable offline. You can attach the client later from the order." /> : null}
      {isFetching && !data ? (
        <Stack gap={3}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={44} />
          ))}
        </Stack>
      ) : null}
      {data && !data.length ? <EmptyState title="No match" body={`Check the spelling, or create the ${noun} from the ${term("Customer")}s page.`} /> : null}
      <View style={{ gap: 2 }}>
        {data?.map((c) => {
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
          return (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${c.pointsBalance} points`}
              onPress={() => pick(c)}
              style={({ hovered, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: t.space(3), minHeight: t.hit + 8, paddingHorizontal: t.space(2), borderRadius: t.radius.md, backgroundColor: hovered ? t.color.hover : "transparent", ...focusRing(t, focused) }) as ViewStyle}
            >
              <Avatar name={name} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" style={{ fontWeight: "600" }} numberOfLines={1}>
                  {name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {c.email ?? c.phone ?? "No contact on file"}
                </Text>
              </View>
              <Badge tone="primary" label={`${(c.tierId ?? "member").replace(/^./, (x) => x.toUpperCase())} · ${c.pointsBalance.toLocaleString()} pts`} />
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
