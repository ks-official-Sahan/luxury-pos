import { useEffect, useState, type ComponentType } from "react";
import { Platform, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { currencyExponent, formatMoney, maxRedeemablePoints, settle, type Tender, type TenderMethod } from "@luxury-pos/core";
import { useMe } from "@/lib/queries";
import { printReceipt, receiptHtml } from "@/lib/receipt";
import { useShortcuts } from "@/shell/useShortcuts";
import { useBrand } from "@/theme/BrandProvider";
import { ArrowLeft, Backspace, CheckCircle, CloudArrowUp, CreditCard, Gift, Money as Cash, Printer, Sparkle, X } from "@/ui/icons";
import { Button, ErrorNote, focusRing, IconButton, Kbd, Money, Row, Segmented, Stack, Switch, Text, useLayout } from "@/ui/primitives";
import { useCheckout, type CheckoutResult } from "./checkout";
import { ApprovalSheet } from "./sheets";

type IconType = ComponentType<{ size?: number; color?: string; weight?: "light" | "regular" | "fill" }>;
const METHODS: { value: TenderMethod; label: string; icon: IconType }[] = [
  { value: "card", label: "Card", icon: CreditCard },
  { value: "cash", label: "Cash", icon: Cash },
  { value: "gift_card", label: "Gift card", icon: Gift },
  { value: "store_credit", label: "Credit", icon: Sparkle },
];
const label = (m: TenderMethod) => METHODS.find((x) => x.value === m)?.label ?? m.replace("_", " ");

/** Terminal-style amount entry: digits shift in from the right (1-2-0-0 → 12.00), so there is never a decimal key to miss. */
function Keypad({ onDigit, onBack, disabled }: { onDigit: (d: string) => void; onBack: () => void; disabled?: boolean }) {
  const { tokens: t } = useBrand();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];
  return (
    <View accessibilityLabel="Amount keypad" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(2) }}>
      {keys.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === "back" ? "Delete last digit" : k}
          disabled={disabled}
          onPress={() => (k === "back" ? onBack() : onDigit(k))}
          style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) =>
            ({
              flexBasis: "30%",
              flexGrow: 1,
              height: t.hit + 12,
              borderRadius: t.radius.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? t.color.pressed : hovered ? t.color.hover : t.color.surfaceSunken,
              opacity: disabled ? 0.5 : 1,
              ...focusRing(t, focused),
            }) as ViewStyle
          }
        >
          {k === "back" ? <Backspace size={24} color={t.color.text} /> : <Text variant="amount">{k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Payment, in place of the catalogue (the sale stays visible beside it). One tap
 * takes the full balance; split tenders, cash change and points are inline, never
 * a modal on a modal. Physical keyboards type digits straight into the amount.
 */
export function TenderPanel({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { tokens: t, theme } = useBrand();
  const { wide } = useLayout();
  const { store, priced, submit, client } = useCheckout();
  const me = useMe();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState<TenderMethod>("card");
  const [digits, setDigits] = useState("");
  const [usePoints, setUsePoints] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [approval, setApproval] = useState<null | "price" | "discount">(null);
  // Card, gift card and credit almost always take the whole balance in one tap;
  // the keypad appears only for cash (amount tendered) or when splitting.
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    setDigits("");
    setCustom(false);
  }, [method]);

  const program = me.data?.tenant.loyalty;
  const redeemable = program && client && priced ? maxRedeemablePoints(program, priced.total, client.pointsBalance) : 0;
  const points = usePoints ? redeemable : 0;
  const pointsValue = program ? points * program.pointValueMinor : 0;
  const all: Tender[] = pointsValue > 0 ? [{ method: "loyalty_points", amount: pointsValue }, ...tenders] : tenders;
  const state = (() => {
    if (!store || !priced) return null;
    try {
      return settle(priced.total, all, store.settings.cashIncrement);
    } catch {
      return null;
    }
  })();
  const balance = state?.balance ?? priced?.total ?? 0;
  const amount = digits ? Number(digits) : balance;
  const valid = amount > 0 && (method === "cash" || amount <= balance);
  const finishing = !!state && !state.settled && amount >= balance && valid;
  const keypad = method === "cash" || custom;
  const verb = method === "card" ? "Charge" : "Take";
  const methodWord = method === "card" ? "card" : method === "cash" ? "cash" : label(method).toLowerCase();
  const actionLabel = state?.settled
    ? "Complete sale"
    : finishing
      ? method === "cash" && amount > balance
        ? `Take ${formatMoney(amount, store?.currency ?? "USD")} cash · change ${formatMoney(amount - balance, store?.currency ?? "USD")}`
        : method === "card"
          ? `Charge ${formatMoney(amount, store?.currency ?? "USD")} to card`
          : `${verb} ${formatMoney(amount, store?.currency ?? "USD")} ${methodWord}`
      : `Add ${formatMoney(amount, store?.currency ?? "USD")} ${methodWord} · ${formatMoney(balance - amount, store?.currency ?? "USD")} left`;

  const complete = async (list: Tender[], overrideToken?: string) => {
    setBusy(true);
    const r = await submit(list, { overrideToken, redeemPoints: points || undefined });
    setBusy(false);
    if (r.kind === "needs_approval") setApproval(r.action === "price" ? "price" : "discount");
    else setResult(r);
  };

  const take = () => {
    if (state?.settled) return void complete(all);
    if (!valid) return;
    const next = [...tenders, { method, amount }];
    setTenders(next);
    setDigits("");
    const after = pointsValue > 0 ? [{ method: "loyalty_points" as const, amount: pointsValue }, ...next] : next;
    if (store && priced && settle(priced.total, after, store.settings.cashIncrement).settled) void complete(after);
  };

  const done = result && (result.kind === "done" || result.kind === "queued") ? result : null;
  const digit = (d: string) => setDigits((v) => (v + d).replace(/^0+/, "").slice(0, 10));
  const keys: Record<string, () => void> = { escape: done ? onDone : onBack, enter: done ? onDone : take, "mod+enter": done ? onDone : take, backspace: () => setDigits((v) => v.slice(0, -1)) };
  for (const d of "0123456789")
    keys[d] = () => {
      if (done) return;
      setCustom(true); // typing digits on a physical keyboard means "a specific amount"
      digit(d);
    };
  useShortcuts(keys);

  if (!store || !priced) return null;
  const quickCash = (() => {
    if (method !== "cash") return [];
    const unit = 10 ** currencyExponent(store.currency);
    const configured = theme.layout.quickCash.map((v) => v * unit).filter((v) => v >= balance);
    const derived = [5, 10, 20, 50, 100].map((n) => Math.ceil(balance / (n * unit)) * n * unit);
    return [...new Set([balance, ...(configured.length ? configured : derived)])].filter((v) => v > 0).slice(0, 4);
  })();

  /* ------------------------------------------------------------ completed */
  if (done) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: t.space(6), gap: t.space(5) }}>
        {done.kind === "done" ? <CheckCircle size={56} color={t.color.success} weight="fill" /> : <CloudArrowUp size={56} color={t.color.info} weight="fill" />}
        <Stack gap={1} style={{ alignItems: "center" }}>
          <Text variant="title" accessibilityRole="header">
            {done.kind === "done" ? "Sale complete" : "Saved on this till"}
          </Text>
          <Text variant="label" tone="muted" style={{ textAlign: "center" }}>
            {done.kind === "done" ? `Receipt ${done.receiptNo}${done.pointsEarned ? ` · ${done.pointsEarned} points earned` : ""}` : "No connection right now. The sale is final and will sync by itself."}
          </Text>
        </Stack>
        {done.changeDue > 0 ? (
          <View style={{ alignItems: "center", gap: 4, paddingVertical: t.space(4), paddingHorizontal: t.space(8), borderRadius: t.radius.lg, backgroundColor: t.color.warningSoft }} accessibilityRole="summary" accessibilityLabel={`Change due ${formatMoney(done.changeDue, store.currency)}`}>
            <Text variant="label" tone="warning" style={{ fontWeight: "600" }}>
              Change due
            </Text>
            <Money amount={done.changeDue} currency={store.currency} variant="amountLg" />
          </View>
        ) : null}
        <Row gap={2} wrap style={{ justifyContent: "center" }}>
          <Button kind="secondary" size="lg" label="Print receipt" icon={<Printer size={18} color={t.color.text} />} onPress={() => void printReceipt(receiptHtml(done.receipt, theme))} />
          <Button size="lg" label="New sale" trailing={<Kbd>↵</Kbd>} onPress={onDone} style={{ minWidth: 200 }} />
        </Row>
      </View>
    );
  }

  /* --------------------------------------------------------------- paying */
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ paddingHorizontal: t.space(4), paddingTop: t.space(3) }} gap={2}>
        <IconButton label="Back to items" onPress={onBack}>
          {wide ? <ArrowLeft size={20} color={t.color.text} /> : <X size={20} color={t.color.text} />}
        </IconButton>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Payment
        </Text>
        <Kbd>Esc</Kbd>
      </Row>
      <ScrollView contentContainerStyle={{ padding: t.space(5), gap: t.space(5), maxWidth: 560, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: 2 }}>
          <Text variant="label" tone="muted">
            {state?.settled ? "Paid in full" : tenders.length || pointsValue ? "Left to pay" : "To pay"}
          </Text>
          <Money amount={state?.settled ? priced.total : balance} currency={store.currency} variant="amountLg" />
        </View>

        <Segmented label="Payment method" size="lg" value={method} onChange={setMethod} options={METHODS.map(({ value, label: l, icon: Icon }) => ({ value, label: l, icon: <Icon size={18} color={method === value ? t.color.text : t.color.textMuted} /> }))} />

        {!state?.settled && keypad ? (
          <Stack gap={3}>
            <Row justify="space-between" style={{ paddingHorizontal: t.space(1) }}>
              <Text variant="label" tone="muted">
                {method === "cash" ? "Cash received" : `${label(method)} amount`}
              </Text>
              <Money amount={amount} currency={store.currency} variant="amount" tone={digits ? "text" : "muted"} />
            </Row>
            {quickCash.length ? (
              <Row gap={2} wrap>
                {quickCash.map((q) => (
                  <Button key={q} kind={q === amount ? "soft" : "secondary"} size="md" label={q === balance ? "Exact" : formatMoney(q, store.currency)} onPress={() => setDigits(String(q))} style={{ flexGrow: 1 }} />
                ))}
              </Row>
            ) : null}
            <Keypad onDigit={digit} onBack={() => setDigits((v) => v.slice(0, -1))} />
            {method !== "cash" && amount > balance ? <Text variant="caption" tone="danger">Only cash can be more than the balance.</Text> : null}
            {custom ? <Button kind="ghost" size="sm" label={`Charge the full ${formatMoney(balance, store.currency)} instead`} onPress={() => (setCustom(false), setDigits(""))} style={{ alignSelf: "center" }} /> : null}
          </Stack>
        ) : null}

        {!state?.settled && !keypad ? (
          <View style={{ alignItems: "center", gap: t.space(2), paddingVertical: t.space(2) }}>
            <Text variant="label" tone="muted" style={{ textAlign: "center", maxWidth: 360 }}>
              {method === "card" ? "Present the terminal to the client, then confirm here once it is approved." : `The full balance goes on ${methodWord}.`}
            </Text>
            <Button kind="ghost" size="sm" label="Split or pay part" onPress={() => setCustom(true)} />
          </View>
        ) : null}

        {redeemable > 0 ? <Switch value={usePoints} onChange={setUsePoints} label={`Use ${redeemable.toLocaleString()} points`} description={`${client!.pointsBalance.toLocaleString()} available · worth ${formatMoney(redeemable * program!.pointValueMinor, store.currency)}`} /> : null}

        {all.length ? (
          <Stack gap={1}>
            {all.map((tn, i) => (
              <Row key={i} justify="space-between" style={{ minHeight: 36 }}>
                <Text variant="label">{tn.method === "loyalty_points" ? "Points" : label(tn.method)}</Text>
                <Row gap={1}>
                  <Money amount={tn.amount} currency={store.currency} variant="label" />
                  {tn.method !== "loyalty_points" ? (
                    <IconButton size="sm" label={`Remove ${label(tn.method)} payment`} onPress={() => setTenders((ts) => ts.filter((_, j) => j !== i - (pointsValue > 0 ? 1 : 0)))}>
                      <X size={14} color={t.color.textMuted} />
                    </IconButton>
                  ) : null}
                </Row>
              </Row>
            ))}
          </Stack>
        ) : null}
        {result?.kind === "error" ? <ErrorNote message={result.message} /> : null}
      </ScrollView>
      <View style={{ padding: t.space(4), borderTopWidth: 1, borderTopColor: t.color.border, maxWidth: 560 + t.space(8), width: "100%", alignSelf: "center" }}>
        <Button
          size="xl"
          block
          loading={busy}
          disabled={!state?.settled && !valid}
          label={actionLabel}
          trailing={Platform.OS === "web" ? <Kbd>↵</Kbd> : undefined}
          onPress={take}
        />
      </View>
      <ApprovalSheet
        visible={!!approval}
        action={approval ?? "discount"}
        storeId={store.id}
        onClose={() => setApproval(null)}
        onApproved={(token) => {
          setApproval(null);
          void complete(all, token);
        }}
      />
    </View>
  );
}

