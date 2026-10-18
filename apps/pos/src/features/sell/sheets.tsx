import { useQuery } from "@tanstack/react-query";
import { Check, CloudArrowUp, CreditCard, Gift, Money as Cash, Sparkle } from "@/ui/icons";
import { useEffect, useState, type ComponentType } from "react";
import { Pressable, View } from "react-native";
import { currencyExponent, formatMoney, maxRedeemablePoints, parseMoney, settle, type Discount, type Tender, type TenderMethod } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { printReceipt, receiptHtml } from "@/lib/receipt";
import { useBrand } from "@/theme/BrandProvider";
import { useCart, type CartClient } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Sheet } from "@/ui/Sheet";
import { Button, Chip, Field, Money, Row, Stack, Surface, Text } from "@/ui/primitives";
import { requestApproval, useCheckout, type CheckoutResult } from "./checkout";

type IconType = ComponentType<{ size?: number; color?: string; weight?: "light" | "regular" }>;
const METHODS: { method: TenderMethod; label: string; icon: IconType }[] = [
  { method: "card", label: "Card", icon: CreditCard },
  { method: "cash", label: "Cash", icon: Cash },
  { method: "gift_card", label: "Gift card", icon: Gift },
  { method: "store_credit", label: "Store credit", icon: Sparkle },
];

/** Split tender: add payments until the balance is zero. Cash may exceed it (change is shown). */
export function CheckoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTokens();
  const { theme } = useBrand();
  const { store, priced, submit, client } = useCheckout();
  const me = useMe();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState<TenderMethod>("card");
  const [typed, setTyped] = useState("");
  const [points, setPoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [approval, setApproval] = useState<null | "price" | "discount">(null);

  useEffect(() => {
    if (visible) {
      setTenders([]);
      setTyped("");
      setPoints(0);
      setResult(null);
    }
  }, [visible]);

  if (!store || !priced) return null;
  const program = me.data?.tenant.loyalty;
  const pointsValue = program ? points * program.pointValueMinor : 0;
  const all: Tender[] = pointsValue > 0 ? [{ method: "loyalty_points", amount: pointsValue }, ...tenders] : tenders;
  const state = (() => {
    try {
      return settle(priced.total, all, store.settings.cashIncrement);
    } catch {
      return null;
    }
  })();
  const balance = state?.balance ?? priced.total;
  const amount = typed ? parseMoney(typed, store.currency) : balance;
  const canAdd = amount !== null && amount > 0 && (method === "cash" || amount <= balance);
  const redeemable = program && client ? maxRedeemablePoints(program, priced.total, client.pointsBalance) : 0;
  const quick = method === "cash" ? [balance, ...[2000, 5000, 10000, 20000].map((n) => Math.ceil(balance / n) * n)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4) : [];

  const complete = async (overrideToken?: string) => {
    setBusy(true);
    const r = await submit(all, { overrideToken, redeemPoints: points || undefined });
    setBusy(false);
    if (r.kind === "needs_approval") setApproval(r.action === "price" ? "price" : "discount");
    else setResult(r);
  };

  if (result && (result.kind === "done" || result.kind === "queued")) {
    return (
      <Sheet visible={visible} onClose={onClose} title={result.kind === "done" ? "Sale complete" : "Saved on this till"}>
        <Stack gap={4} style={{ alignItems: "center", paddingVertical: t.space(6) }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: t.color.surfaceRaised }}>
            {result.kind === "done" ? <Check size={36} color={t.color.success} weight="light" /> : <CloudArrowUp size={36} color={t.color.warning} weight="light" />}
          </View>
          {result.changeDue > 0 ? (
            <Stack gap={1} style={{ alignItems: "center" }}>
              <Text tone="muted">Change due</Text>
              <Money amount={result.changeDue} currency={store.currency} variant="display" />
            </Stack>
          ) : null}
          <Text tone="muted" style={{ textAlign: "center" }}>
            {result.kind === "done" ? `Receipt ${result.receiptNo}${result.pointsEarned ? ` · ${result.pointsEarned} points earned` : ""}` : "You are offline. The sale is safe and will sync automatically."}
          </Text>
          <Row gap={2} style={{ alignSelf: "stretch" }}>
            <Button kind="secondary" label="Print receipt" onPress={() => void printReceipt(receiptHtml(result.receipt, theme))} />
            <Button label="New sale" size="lg" onPress={onClose} style={{ flex: 1 }} />
          </Row>
        </Stack>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        visible={visible && !approval}
        onClose={onClose}
        title="Payment"
        footer={<Button label={state?.settled ? "Complete sale" : `Remaining ${formatMoney(balance, store.currency)}`} size="lg" disabled={!state?.settled} loading={busy} onPress={() => complete()} />}
      >
        <Surface padded inner={{ alignItems: "center", gap: 4 }}>
          <Text variant="eyebrow" tone="muted">
            {state?.settled ? "Paid" : "Balance"}
          </Text>
          <Money amount={state?.settled ? priced.total : balance} currency={store.currency} variant="display" />
        </Surface>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(2) }}>
          {METHODS.map(({ method: m, label, icon: Icon }) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: method === m }}
              onPress={() => setMethod(m)}
              style={{ flexGrow: 1, flexBasis: 110, minHeight: t.hit + 16, borderRadius: t.radius.md, borderWidth: 1, borderColor: method === m ? t.color.primary : t.color.border, backgroundColor: method === m ? t.color.surfaceRaised : "transparent", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <Icon size={22} weight="light" color={method === m ? t.color.primary : t.color.textMuted} />
              <Text variant="label">{label}</Text>
            </Pressable>
          ))}
        </View>

        {!state?.settled ? (
          <Stack gap={3}>
            <Field label={`Amount (${store.currency})`} placeholder={formatMoney(balance, store.currency)} value={typed} onChangeText={setTyped} keyboardType="decimal-pad" inputMode="decimal" error={typed && amount === null ? "Enter an amount like 120.50" : null} />
            {quick.length ? (
              <Row gap={2} wrap>
                {quick.map((q) => (
                  <Chip key={q} label={formatMoney(q, store.currency)} onPress={() => setTyped(String(q / 10 ** currencyExponent(store.currency)))} />
                ))}
              </Row>
            ) : null}
            <Button kind="secondary" label={`Add ${METHODS.find((m) => m.method === method)?.label.toLowerCase()} payment`} disabled={!canAdd} onPress={() => (setTenders((ts) => [...ts, { method, amount: amount! }]), setTyped(""))} />
          </Stack>
        ) : null}

        {redeemable > 0 ? (
          <Surface padded>
            <Row style={{ justifyContent: "space-between" }}>
              <Stack gap={1}>
                <Text variant="label">Use points</Text>
                <Text variant="caption" tone="muted">
                  {client!.pointsBalance} available · up to {redeemable}
                </Text>
              </Stack>
              <Chip label={points ? `${points} pts applied` : `Apply ${redeemable}`} selected={points > 0} onPress={() => setPoints(points ? 0 : redeemable)} />
            </Row>
          </Surface>
        ) : null}

        {all.length ? (
          <Stack gap={2}>
            {all.map((tn, i) => (
              <Row key={i} style={{ justifyContent: "space-between" }}>
                <Text tone="muted">{tn.method.replace("_", " ")}</Text>
                <Row gap={2}>
                  <Money amount={tn.amount} currency={store.currency} />
                  {tn.method !== "loyalty_points" ? <Chip label="Remove" onPress={() => setTenders((ts) => ts.filter((_, j) => j !== i - (pointsValue > 0 ? 1 : 0)))} /> : null}
                </Row>
              </Row>
            ))}
            {state && state.changeDue > 0 ? (
              <Row style={{ justifyContent: "space-between" }}>
                <Text variant="label">Change</Text>
                <Money amount={state.changeDue} currency={store.currency} variant="label" />
              </Row>
            ) : null}
          </Stack>
        ) : null}
        {result?.kind === "error" ? <Text tone="danger">{result.message}</Text> : null}
      </Sheet>
      <ApprovalSheet
        visible={!!approval}
        action={approval ?? "discount"}
        storeId={store.id}
        onClose={() => setApproval(null)}
        onApproved={(token) => {
          setApproval(null);
          void complete(token);
        }}
      />
    </>
  );
}

/** Manager types their email and till PIN on the cashier's device; the token covers this one action. */
export function ApprovalSheet({ visible, action, storeId, onClose, onApproved }: { visible: boolean; action: string; storeId: string; onClose: () => void; onApproved: (token: string) => void }) {
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
      setError("Approval refused. Check the email and PIN, or ask another manager.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Manager approval" width={420} footer={<Button label="Approve" size="lg" loading={busy} disabled={!email || pin.length < 4} onPress={go} />}>
      <Text tone="muted">This {action === "price" ? "price change" : "discount"} is above your limit. A manager can approve it here.</Text>
      <Field label="Manager email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))} secureTextEntry keyboardType="number-pad" error={error} />
    </Sheet>
  );
}

export function DiscountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTokens();
  const { orderDiscount, setOrderDiscount } = useCart();
  const [custom, setCustom] = useState("");
  const apply = (d?: Discount) => {
    setOrderDiscount(d);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Discount on the sale" width={420}>
      <Row gap={2} wrap>
        {[500, 1000, 1500, 2000].map((bps) => (
          <Chip key={bps} label={`${bps / 100}%`} selected={orderDiscount?.kind === "percent" && orderDiscount.bps === bps} onPress={() => apply({ kind: "percent", bps, reason: "Associate discount" })} />
        ))}
      </Row>
      <Field label="Other percentage" value={custom} onChangeText={setCustom} keyboardType="decimal-pad" placeholder="e.g. 12.5" />
      <Row gap={2}>
        <Button kind="secondary" label="Remove discount" onPress={() => apply(undefined)} />
        <Button label="Apply" disabled={!(Number(custom) > 0 && Number(custom) <= 100)} onPress={() => apply({ kind: "percent", bps: Math.round(Number(custom) * 100), reason: "Associate discount" })} style={{ flex: 1 }} />
      </Row>
      <Text variant="caption" tone="muted" style={{ marginTop: t.space(1) }}>
        Discounts above your limit ask for a manager’s approval at payment.
      </Text>
    </Sheet>
  );
}

type ClientRow = { id: string; firstName: string; lastName: string | null; email: string | null; tierId: string | null; pointsBalance: number };

export function ClientSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const term = useTerm();
  const setClient = useCart((s) => s.setClient);
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({ queryKey: ["clients", q], queryFn: () => api<ClientRow[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const pick = (c: ClientRow | null) => {
    setClient(c ? ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), tierId: c.tierId, pointsBalance: c.pointsBalance } satisfies CartClient) : null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`Find a ${term("Customer").toLowerCase()}`}>
      <Field label="Name, email or phone" value={q} onChangeText={setQ} autoFocus autoCapitalize="none" />
      {isFetching ? <Text tone="muted">Searching…</Text> : null}
      {data?.map((c) => (
        <Pressable key={c.id} accessibilityRole="button" onPress={() => pick(c)}>
          <Surface padded>
            <Row style={{ justifyContent: "space-between" }}>
              <Stack gap={1}>
                <Text variant="label">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</Text>
                <Text variant="caption" tone="muted">
                  {c.email ?? "—"}
                </Text>
              </Stack>
              <Text variant="caption" tone="primary">
                {(c.tierId ?? "member").toUpperCase()} · {c.pointsBalance} pts
              </Text>
            </Row>
          </Surface>
        </Pressable>
      ))}
      <Button kind="ghost" label={`Sell without a ${term("Customer").toLowerCase()}`} onPress={() => pick(null)} />
    </Sheet>
  );
}
