import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { api } from "@/lib/api";
import { useCan, useStore } from "@/lib/queries";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Sheet } from "@/ui/Sheet";
import { Screen } from "@/ui/Screen";
import { Button, EmptyState, Field, Row, Stack, Surface, Text, useLayout } from "@/ui/primitives";

type Client = { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; tierId: string | null; pointsBalance: number; lifetimeSpend: number; lastPurchaseAt: string | null };
type Profile = {
  customer: Client & { preferences: Record<string, string>; notes: string | null; marketingConsent: boolean };
  recent: { id: string; receiptNo: string; total: number; createdAt: string; lines: { name: string; quantity: number }[] }[];
};

/** Clienteling: find a client, see preferences, notes and purchase history at a glance. */
export default function Clients() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const { wide } = useLayout();
  const store = useStore();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", notes: "" });
  const cur = store?.currency ?? "EUR";

  const list = useQuery({ queryKey: ["clients", q], queryFn: () => api<Client[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const profile = useQuery({ queryKey: ["client", selected], queryFn: () => api<Profile>(`/customers/${selected}`), enabled: !!selected });
  const create = useMutation({
    mutationFn: () => api<Client>("/customers", { method: "POST", json: { ...form, email: form.email || undefined, phone: form.phone || undefined, lastName: form.lastName || undefined, notes: form.notes || undefined } }),
    onSuccess: (c) => {
      setCreating(false);
      setSelected(c.id);
      void qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const detail = profile.data ? (
    <Surface raised style={{ flex: 1 }}>
      <Stack gap={4}>
        <Stack gap={1}>
          <Text variant="overline" tone="primary">
            {(profile.data.customer.tierId ?? "member").toUpperCase()} · {profile.data.customer.pointsBalance} points
          </Text>
          <Text variant="title">{[profile.data.customer.firstName, profile.data.customer.lastName].filter(Boolean).join(" ")}</Text>
          <Text tone="muted">{[profile.data.customer.email, profile.data.customer.phone].filter(Boolean).join(" · ") || "No contact details"}</Text>
        </Stack>
        <Row gap={6} wrap>
          <Stack gap={1}>
            <Text variant="caption" tone="muted">Lifetime</Text>
            <Text variant="heading">{formatMoney(profile.data.customer.lifetimeSpend, cur)}</Text>
          </Stack>
          {Object.entries(profile.data.customer.preferences).map(([k, v]) => (
            <Stack key={k} gap={1}>
              <Text variant="caption" tone="muted">{k}</Text>
              <Text variant="heading">{v}</Text>
            </Stack>
          ))}
        </Row>
        {profile.data.customer.notes ? <Text>{profile.data.customer.notes}</Text> : null}
        <Text variant="heading">Recent purchases</Text>
        {profile.data.recent.map((o) => (
          <Row key={o.id} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <Stack gap={1} style={{ flex: 1 }}>
              <Text variant="label">{o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}</Text>
              <Text variant="caption" tone="muted">
                {new Date(o.createdAt).toLocaleDateString()} · {o.receiptNo}
              </Text>
            </Stack>
            <Text variant="label">{formatMoney(o.total, cur)}</Text>
          </Row>
        ))}
        {!profile.data.recent.length ? <Text tone="muted">No purchases yet.</Text> : null}
      </Stack>
    </Surface>
  ) : (
    <Surface style={{ flex: 1 }}>
      <EmptyState title={`Choose a ${term("Customer").toLowerCase()}`} body="Search by name, email or phone to see preferences and history." />
    </Surface>
  );

  return (
    <Screen title={`${term("Customer")}s`} actions={can("customer.write") ? <Button label={`New ${term("Customer").toLowerCase()}`} onPress={() => setCreating(true)} /> : null}>
      <View style={{ flexDirection: wide ? "row" : "column", gap: t.space(5) }}>
        <Stack gap={3} style={{ width: wide ? 360 : "100%" }}>
          <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, email or phone" autoCapitalize="none" />
          {list.data?.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: selected === c.id }} onPress={() => setSelected(c.id)}>
              <View style={{ padding: t.space(4), borderRadius: t.radius.md, borderWidth: 1, borderColor: selected === c.id ? t.color.primary : t.color.border, backgroundColor: t.color.surface }}>
                <Text variant="label">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</Text>
                <Text variant="caption" tone="muted">
                  {c.email ?? c.phone ?? "—"} · {formatMoney(c.lifetimeSpend, cur)}
                </Text>
              </View>
            </Pressable>
          ))}
        </Stack>
        {detail}
      </View>

      <Sheet visible={creating} onClose={() => setCreating(false)} title={`New ${term("Customer").toLowerCase()}`} footer={<Button label="Save" size="lg" loading={create.isPending} disabled={!form.firstName} onPress={() => create.mutate()} />}>
        <Field label="First name" value={form.firstName} onChangeText={(firstName) => setForm((f) => ({ ...f, firstName }))} />
        <Field label="Last name" value={form.lastName} onChangeText={(lastName) => setForm((f) => ({ ...f, lastName }))} />
        <Field label="Email" value={form.email} onChangeText={(email) => setForm((f) => ({ ...f, email }))} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone" value={form.phone} onChangeText={(phone) => setForm((f) => ({ ...f, phone }))} keyboardType="phone-pad" />
        <Field label="Notes" value={form.notes} onChangeText={(notes) => setForm((f) => ({ ...f, notes }))} multiline />
        {create.error ? <Text tone="danger">{(create.error as Error).message}</Text> : null}
      </Sheet>
    </Screen>
  );
}
