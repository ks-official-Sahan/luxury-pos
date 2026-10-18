import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useMemo, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { PERMISSIONS, type Permission } from "@luxury-pos/core";
import { copyText } from "@/lib/clipboard";
import { API_URL } from "@/lib/config";
import { api } from "@/lib/api";
import { useCan, useMe, useStore } from "@/lib/queries";
import { useUi } from "@/shell/ui-state";
import { useOutbox, type OutboxItem } from "@/state/outbox";
import { useSession } from "@/state/session";
import { useTokens } from "@/theme/BrandProvider";
import { ArrowSquareOut, ArrowsClockwise, Code, Copy, Plus, Robot, Trash, Warning } from "@/ui/icons";
import { Badge, Button, Chip, EmptyState, ErrorNote, Field, IconButton, Panel, Row, SectionHeader, Segmented, Skeleton, Stack, Switch, Text, useLayout } from "@/ui/primitives";
import { Screen } from "@/ui/Screen";
import { DataList, type Column } from "@/ui/DataList";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";

/* ------------------------------------------------------------------ types and constants */

type TokenRow = { id: string; name: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; owner: string };
type DeviceRow = { id: string; code: string; name: string; platform: string; storeId: string; store: string; lastSeenAt: string | null; receiptSeq: number; status: "pending" | "approved" | "blocked"; lastIp: string | null; lastUser: string | null };
const DEVICE_STATUS: Record<DeviceRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  approved: { label: "Approved", tone: "success" },
  pending: { label: "Waiting for approval", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
};
type Preset = "analyst" | "manager" | "custom";
type Expiry = "30" | "90" | "365";

const PRESET_OPTIONS: { id: Preset; label: string }[] = [
  { id: "analyst", label: "Read-only analyst" },
  { id: "manager", label: "Store manager" },
  { id: "custom", label: "Custom" },
];

const PRESETS: Record<Exclude<Preset, "custom">, readonly Permission[]> = {
  analyst: ["reports.read", "inventory.read", "catalog.read", "customer.read", "ai.insights"],
  manager: ["reports.read", "inventory.read", "catalog.read", "customer.read", "ai.insights", "inventory.adjust", "inventory.transfer"],
};

/** Typed against Permission so a new permission cannot ship without a label. */
const LABELS: Record<Permission, string> = {
  "sale.create": "Create sales",
  "sale.discount": "Apply discounts",
  "sale.discount.override": "Discounts above the limit",
  "sale.void": "Void sales",
  "sale.refund": "Refund sales",
  "sale.price_override": "Override prices",
  "drawer.open": "Open the till drawer",
  "drawer.close": "Close the till drawer",
  "drawer.paid_in_out": "Paid in and paid out",
  "catalog.read": "View the catalogue",
  "catalog.write": "Edit the catalogue",
  "inventory.read": "View stock",
  "inventory.adjust": "Adjust stock",
  "inventory.transfer": "Transfer stock",
  "inventory.receive": "Receive stock",
  "customer.read": "View customers",
  "customer.write": "Edit customers",
  "customer.pii": "See full contact details",
  "loyalty.adjust": "Adjust loyalty points",
  "reports.read": "View reports",
  "reports.export": "Export reports",
  "ai.insights": "AI insights",
  "staff.manage": "Manage staff",
  "store.settings": "Store settings",
  "store.branding": "Store branding",
  "tenant.billing": "Billing",
  "mcp.access": "AI assistant access",
};

const GROUP_OF: Record<string, string> = {
  sale: "Sales",
  drawer: "Sales",
  catalog: "Catalogue",
  inventory: "Stock",
  customer: "Customers",
  loyalty: "Customers",
  reports: "Reports",
  ai: "Reports",
  staff: "Administration",
  store: "Administration",
  tenant: "Administration",
  mcp: "Administration",
};

const MINUTE = 60_000;

/* ------------------------------------------------------------------ helpers */

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");

/** "5 min ago" for recent activity, a date after a day. */
function ago(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / MINUTE);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return fmtDate(iso);
}

const copy = (text: string, what: string) => copyText(text, what).catch(() => toast.error("Could not copy. Select the text and copy it."));

function presetScopes(preset: Exclude<Preset, "custom">, held: ReadonlySet<Permission>): Set<Permission> {
  return new Set<Permission>(["mcp.access", ...PRESETS[preset].filter((p) => held.has(p))]);
}

function groupScopes(perms: Permission[]): [string, Permission[]][] {
  const groups = new Map<string, Permission[]>();
  for (const p of perms) {
    const group = GROUP_OF[p.split(".")[0] ?? ""] ?? "Other";
    groups.set(group, [...(groups.get(group) ?? []), p]);
  }
  return [...groups];
}

/* ------------------------------------------------------------------ layout */

/** Two columns on desktop, one stacked column on phones and tablets. */
function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  const t = useTokens();
  const { bp } = useLayout();
  if (bp !== "desktop")
    return (
      <Stack gap={5}>
        {left}
        {right}
      </Stack>
    );
  return (
    <View style={{ flexDirection: "row", gap: t.space(5), alignItems: "flex-start" }}>
      <View style={{ flex: 1, minWidth: 0, gap: t.space(5) }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0, gap: t.space(5) }}>{right}</View>
    </View>
  );
}

function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <SectionHeader title={title} description={description} actions={actions} />
      <Stack gap={4}>{children}</Stack>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  const t = useTokens();
  return (
    <Row justify="space-between" gap={3} style={{ paddingVertical: t.space(2), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{children}</View>
    </Row>
  );
}

/* ------------------------------------------------------------------ this till */

function TillSection() {
  const t = useTokens();
  const me = useMe();
  const store = useStore();
  const deviceId = useSession((s) => s.deviceId);
  const items = useOutbox((s) => s.items);
  const flushing = useOutbox((s) => s.flushing);
  const discard = useOutbox((s) => s.discard);
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);
  const refused = items.filter((i) => i.error?.permanent);
  const waiting = items.length - refused.length;

  return (
    <Section title="This till" description="The store and device this app works for.">
      <Stack gap={0}>
        <Fact label="Store">{me.isLoading ? <Skeleton width={140} height={16} /> : <Text variant="label">{store?.name ?? "Not set"}</Text>}</Fact>
        <Fact label="Till ID">
          {deviceId ? (
            <Row gap={2}>
              <Text variant="mono" selectable numberOfLines={1}>
                {deviceId}
              </Text>
              <IconButton label="Copy till ID" size="sm" onPress={() => void copy(deviceId, "Till ID copied")}>
                <Copy size={18} color={t.color.text} />
              </IconButton>
            </Row>
          ) : (
            <Text variant="caption" tone="muted">
              Registering this till
            </Text>
          )}
        </Fact>
        <Fact label="Platform">
          <Text variant="label">{Platform.OS}</Text>
        </Fact>
        <Fact label="App version">
          <Text variant="label">{Constants.expoConfig?.version ?? "Unknown"}</Text>
        </Fact>
      </Stack>

      <Stack gap={3}>
        <Text variant="label" style={{ fontWeight: "600" }}>
          Offline queue
        </Text>
        <Row gap={2} wrap>
          <Badge label={`${waiting} waiting to sync`} tone={waiting ? "info" : "neutral"} />
          <Badge label={`${refused.length} refused`} tone={refused.length ? "danger" : "neutral"} />
        </Row>
        {items.length === 0 ? (
          <Text variant="caption" tone="muted">
            Sales made while offline are kept here and sync automatically when the connection returns.
          </Text>
        ) : null}
        {refused.map((item) => (
          <Row key={item.id} gap={3} style={{ paddingVertical: t.space(2), borderTopWidth: 1, borderTopColor: t.color.border }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                {item.label}
              </Text>
              <Text variant="caption" tone="danger">
                {item.error?.message}
              </Text>
            </View>
            <Button kind="danger" size="sm" label="Discard" accessibilityHint={`Discards ${item.label}`} onPress={() => setDiscarding(item)} />
          </Row>
        ))}
        <Button kind="secondary" label={flushing ? "Syncing" : "Sync now"} icon={<ArrowsClockwise size={18} color={t.color.text} />} loading={flushing} disabled={waiting === 0 || flushing} onPress={() => void useOutbox.getState().flush()} style={{ alignSelf: "flex-start" }} />
      </Stack>

      <Sheet
        visible={discarding !== null}
        onClose={() => setDiscarding(null)}
        variant="dialog"
        title="Discard this sale?"
        description="It was refused by the server and will not be booked."
        footer={
          <Row gap={2}>
            <Button kind="secondary" label="Keep it" onPress={() => setDiscarding(null)} style={{ flex: 1 }} />
            <Button
              kind="danger"
              label="Discard sale"
              onPress={() => {
                if (discarding) discard(discarding.id);
                setDiscarding(null);
              }}
              style={{ flex: 1 }}
            />
          </Row>
        }
      >
        <Text variant="label" tone="muted">
          {discarding?.label}
        </Text>
      </Sheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ PIN */

/** Per-device: how long the till waits before locking behind the PIN. */
function AutoLock() {
  const minutes = useUi((s) => s.autoLockMinutes);
  const set = useUi((s) => s.set);
  return (
    <Stack gap={2}>
      <Text variant="label" tone="muted">
        Lock this till after no activity for
      </Text>
      <Segmented
        label="Auto-lock"
        value={String(minutes)}
        onChange={(v) => set({ autoLockMinutes: Number(v) })}
        options={[
          { value: "2", label: "2 min" },
          { value: "5", label: "5 min" },
          { value: "15", label: "15 min" },
          { value: "0", label: "Never" },
        ]}
      />
    </Stack>
  );
}

function PinSection() {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  const valid = /^\d{4,8}$/.test(pin) && pin === confirm;
  const mismatch = confirm.length > 0 && confirm !== pin;
  const save = useMutation({
    mutationFn: () => api<unknown>("/me/pin", { method: "PUT", json: { pin } }),
    onSuccess: () => {
      setPin("");
      setConfirm("");
      toast.success("Till PIN saved");
    },
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };

  return (
    <Section title="Your till PIN" description="Unlocks this till and approves overrides. Use 4 to 8 digits. Sequences like 1234 and repeats like 1111 are refused.">
      <AutoLock />
      <Field
        label="New PIN"
        value={pin}
        onChangeText={(v) => {
          setPin(digits(v));
          save.reset();
        }}
        secureTextEntry
        keyboardType="number-pad"
        autoComplete="off"
        hint="4 to 8 digits"
      />
      <Field
        label="Confirm PIN"
        value={confirm}
        onChangeText={(v) => {
          setConfirm(digits(v));
          save.reset();
        }}
        secureTextEntry
        keyboardType="number-pad"
        autoComplete="off"
        error={mismatch ? "The PINs do not match." : null}
        onSubmitEditing={submit}
      />
      {save.error ? <ErrorNote message={(save.error as Error).message} /> : null}
      <Button label="Save PIN" onPress={submit} disabled={!valid} loading={save.isPending} style={{ alignSelf: "flex-start" }} />
    </Section>
  );
}

/* ------------------------------------------------------------------ AI assistants (MCP) */

function CreateTokenSheet({ visible, held, onClose, onIssued }: { visible: boolean; held: ReadonlySet<Permission>; onClose: () => void; onIssued: (issued: { name: string; token: string }) => void }) {
  const t = useTokens();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [preset, setPreset] = useState<Preset>("analyst");
  const [scopes, setScopes] = useState<ReadonlySet<Permission>>(() => presetScopes("analyst", held));
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 80;
  const groups = useMemo(() => groupScopes(PERMISSIONS.filter((p) => held.has(p) && p !== "mcp.access")), [held]);

  const create = useMutation({
    mutationFn: () => api<{ id: string; token: string; expiresAt: string | null }>("/tokens", { method: "POST", json: { name: trimmed, scopes: [...scopes], expiresInDays: Number(expiry) } }),
    onSuccess: (res) => {
      onIssued({ name: trimmed, token: res.token });
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      reset();
    },
  });

  const reset = () => {
    setName("");
    setExpiry("90");
    setPreset("analyst");
    setScopes(presetScopes("analyst", held));
    create.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setScopes(presetScopes(p, held));
  };
  const toggle = (p: Permission, on: boolean) => {
    setPreset("custom");
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Create a token"
      description="One token per assistant or tool. You can revoke it at any time."
      footer={<Button label="Create token" size="lg" block disabled={!valid} loading={create.isPending} onPress={() => create.mutate()} icon={<Robot size={18} color={t.color.onPrimary} />} />}
    >
      <Field
        label="Token name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          create.reset();
        }}
        maxLength={80}
        placeholder="Weekly reports assistant"
        hint="Shown in the list so you remember what it is for."
        autoFocus
      />
      <Stack gap={2}>
        <Text variant="label" tone="muted">
          Expires after
        </Text>
        <Segmented
          label="Expires after"
          value={expiry}
          onChange={setExpiry}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "365", label: "365 days" },
          ]}
        />
      </Stack>
      <Stack gap={2}>
        <Text variant="label" tone="muted">
          Permissions
        </Text>
        <Row gap={2} wrap>
          {PRESET_OPTIONS.map((o) => (
            <Chip key={o.id} label={o.label} selected={preset === o.id} onPress={() => choosePreset(o.id)} />
          ))}
        </Row>
        {groups.map(([group, perms]) => (
          <Stack key={group} gap={1} style={{ paddingTop: t.space(2) }}>
            <Text variant="overline" tone="muted">
              {group}
            </Text>
            {perms.map((p) => (
              <Switch key={p} label={LABELS[p]} value={scopes.has(p)} onChange={(on) => toggle(p, on)} />
            ))}
          </Stack>
        ))}
        <Row gap={3} style={{ minHeight: t.hit, paddingTop: t.space(2) }}>
          <Text variant="label" style={{ flex: 1 }}>
            {LABELS["mcp.access"]}
          </Text>
          <Badge label="Always on" tone="primary" />
        </Row>
      </Stack>
      {create.error ? <ErrorNote message={(create.error as Error).message} /> : null}
    </Sheet>
  );
}

function IntegrationsSection() {
  const t = useTokens();
  const qc = useQueryClient();
  const can = useCan();
  const me = useMe();
  const canMcp = can("mcp.access");
  const held = useMemo(() => new Set<Permission>(me.data?.permissions ?? []), [me.data]);
  const endpoint = `${API_URL}/mcp`;
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);

  const tokens = useQuery({ queryKey: ["tokens"], queryFn: ({ signal }) => api<TokenRow[]>("/tokens", { signal }), enabled: canMcp, staleTime: 30_000 });
  const revoke = useMutation({
    mutationFn: (id: string) => api<unknown>(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRevoking(null);
      toast.success("Token revoked");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const columns: Column<TokenRow>[] = [
    { key: "name", header: "Name", flex: 2, render: (r) => <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>{r.name}</Text> },
    { key: "scopes", header: "Scopes", phone: true, render: (r) => <Badge label={`${r.scopes.length} ${r.scopes.length === 1 ? "scope" : "scopes"}`} /> },
    {
      key: "expires",
      header: "Expires",
      phone: true,
      render: (r) => <Text variant="caption" tone={r.expiresAt && new Date(r.expiresAt) < new Date() ? "danger" : "muted"}>{r.expiresAt && new Date(r.expiresAt) < new Date() ? `Expired ${fmtDate(r.expiresAt)}` : fmtDate(r.expiresAt)}</Text>,
    },
    { key: "used", header: "Last used", phone: true, render: (r) => <Text variant="caption" tone="muted">{ago(r.lastUsedAt)}</Text> },
    { key: "owner", header: "Owner", phone: true, render: (r) => <Text variant="caption" tone="muted" numberOfLines={1}>{r.owner}</Text> },
    {
      key: "revoke",
      header: "",
      align: "right",
      render: (r) => (
        <IconButton label={`Revoke ${r.name}`} tone="danger" onPress={() => setRevoking(r)}>
          <Trash size={18} color={t.color.danger} />
        </IconButton>
      ),
    },
  ];

  return (
    <Section
      title="AI assistants (MCP)"
      description="Connect an AI assistant to your store. It can read what its token allows and nothing more."
      actions={canMcp && me.data ? <Button kind="secondary" size="sm" label="Create token" icon={<Plus size={16} color={t.color.text} />} onPress={() => setCreating(true)} /> : null}
    >
      <Stack gap={2}>
        <Text variant="label" tone="muted">
          Endpoint
        </Text>
        <Row gap={2} style={{ paddingLeft: t.space(3), borderRadius: t.radius.md, backgroundColor: t.color.surfaceSunken }}>
          <Text variant="mono" selectable numberOfLines={1} style={{ flex: 1 }}>
            {endpoint}
          </Text>
          <IconButton label="Copy MCP endpoint" onPress={() => void copy(endpoint, "Endpoint copied")}>
            <Copy size={18} color={t.color.text} />
          </IconButton>
        </Row>
        <Text variant="caption" tone="muted">
          {"Add a remote MCP server with header Authorization: Bearer <token>"}
        </Text>
      </Stack>

      {canMcp ? (
        <>
          {tokens.error ? <ErrorNote message="Tokens could not load." onRetry={() => void tokens.refetch()} /> : null}
          <DataList
            inline
            label="AI assistant tokens"
            rows={tokens.data}
            columns={columns}
            keyOf={(r) => r.id}
            loading={tokens.isPending}
            empty={<EmptyState title="No tokens yet" body="Create a token to connect an assistant. Tokens are shown once and can be revoked at any time." />}
          />
        </>
      ) : (
        <EmptyState title="Assistant access is off for your role" body="Ask an owner or manager to create a token for you." />
      )}

      <CreateTokenSheet visible={creating} held={held} onClose={() => setCreating(false)} onIssued={(next) => { setCreating(false); setIssued(next); }} />

      {issued ? (
        <Sheet
          visible
          onClose={() => setIssued(null)}
          variant="dialog"
          title="Copy your token"
          description={`Token for ${issued.name}`}
          footer={<Button label="Done" block onPress={() => setIssued(null)} />}
        >
          <Row gap={2} style={{ padding: t.space(3), borderRadius: t.radius.md, backgroundColor: t.color.surfaceSunken }}>
            <Text variant="mono" selectable style={{ flex: 1 }}>
              {issued.token}
            </Text>
            <IconButton label="Copy token" onPress={() => void copy(issued.token, "Token copied")}>
              <Copy size={18} color={t.color.text} />
            </IconButton>
          </Row>
          <Row gap={2} align="flex-start">
            <Warning size={18} color={t.color.warning} />
            <Text variant="label" tone="warning" style={{ flex: 1 }}>
              Copy it now. It will not be shown again.
            </Text>
          </Row>
        </Sheet>
      ) : null}

      <Sheet
        visible={revoking !== null}
        onClose={() => setRevoking(null)}
        variant="dialog"
        title="Revoke this token?"
        description={revoking?.name}
        footer={
          <Row gap={2}>
            <Button kind="secondary" label="Keep token" onPress={() => setRevoking(null)} style={{ flex: 1 }} />
            <Button kind="danger" label="Revoke token" loading={revoke.isPending} onPress={() => revoking && revoke.mutate(revoking.id)} style={{ flex: 1 }} />
          </Row>
        }
      >
        <Text variant="label">Any assistant using this token loses access immediately. This cannot be undone.</Text>
        {revoke.error ? <ErrorNote message={(revoke.error as Error).message} /> : null}
      </Sheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ devices */

const DEVICE_COLUMNS: Column<DeviceRow>[] = [
  {
    key: "name",
    header: "Till",
    flex: 2,
    render: (r) => (
      <Stack gap={1}>
        <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
          {r.name}
        </Text>
        <Text variant="mono" tone="muted" numberOfLines={1}>
          {r.code}
        </Text>
      </Stack>
    ),
  },
  { key: "store", header: "Store", phone: true, render: (r) => <Text variant="caption" tone="muted" numberOfLines={1}>{r.store}</Text> },
  { key: "platform", header: "Platform", phone: true, render: (r) => <Text variant="caption" tone="muted">{r.platform}</Text> },
  { key: "status", header: "Status", phone: true, render: (r) => <Badge tone={DEVICE_STATUS[r.status].tone} label={DEVICE_STATUS[r.status].label} /> },
  {
    key: "seen",
    header: "Last seen",
    phone: true,
    render: (r) => (
      <Stack gap={0}>
        <Text variant="caption" tone="muted">
          {ago(r.lastSeenAt)}
        </Text>
        {r.lastUser || r.lastIp ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {[r.lastUser, r.lastIp].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </Stack>
    ),
  },
  {
    key: "receipts",
    header: "Receipts issued",
    align: "right",
    render: (r) => (
      <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
        {r.receiptSeq.toLocaleString()}
      </Text>
    ),
  },
];

function DevicesSection() {
  const deviceId = useSession((s) => s.deviceId);
  const can = useCan();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: ({ signal }) => api<DeviceRow[]>("/devices", { signal }), staleTime: 30_000 });
  const decide = useMutation({
    mutationFn: ({ id, to }: { id: string; to: "approve" | "block" }) => api(`/devices/${id}/${to}`, { method: "POST", json: {} }),
    onSuccess: (_r, v) => {
      toast.success(v.to === "approve" ? "Till approved. It can take sales now." : "Till blocked. It can no longer take sales.");
      void qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const columns: Column<DeviceRow>[] = can("store.settings")
    ? [
        ...DEVICE_COLUMNS,
        {
          key: "actions",
          header: "",
          align: "right",
          render: (r) =>
            r.status === "approved" ? (
              r.id === deviceId ? null : <Button kind="ghost" size="sm" label="Block" onPress={() => decide.mutate({ id: r.id, to: "block" })} />
            ) : (
              <Button kind={r.status === "pending" ? "primary" : "secondary"} size="sm" label={r.status === "pending" ? "Approve" : "Unblock"} onPress={() => decide.mutate({ id: r.id, to: "approve" })} />
            ),
        },
      ]
    : DEVICE_COLUMNS;
  const pending = devices.data?.filter((d) => d.status === "pending").length ?? 0;
  return (
    <Section title="Devices" description="Only approved tills can take sales, refunds, drawer and stock movements. Any signed-in device can still read reports.">
      {pending ? <Badge tone="warning" label={`${pending} till${pending > 1 ? "s" : ""} waiting for approval`} /> : null}
      {devices.error ? <ErrorNote message="Devices could not load." onRetry={() => void devices.refetch()} /> : null}
      <DataList
        inline
        label="Registered tills"
        rows={devices.data}
        columns={columns}
        keyOf={(r) => r.id}
        selectedKey={deviceId}
        loading={devices.isPending}
        empty={<EmptyState title="No tills yet" body="A till appears here the first time it signs in to a store." />}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ developers */

function DevelopersSection() {
  const t = useTokens();
  const openSpec = () => {
    Linking.openURL(`${API_URL}/api/openapi.json`).catch(() => toast.error("Could not open the API description."));
  };
  return (
    <Section title="Developers" description="Build on the same API the till uses.">
      <Button
        kind="ghost"
        label="OpenAPI specification"
        icon={<Code size={18} color={t.color.text} />}
        trailing={<ArrowSquareOut size={16} color={t.color.text} />}
        onPress={openSpec}
        accessibilityHint="Opens the API description"
        style={{ alignSelf: "flex-start" }}
      />
      <Text variant="caption" tone="muted">
        Domain events (sales, refunds, stock, clients) are published as CloudEvents to Kafka when your store has streaming enabled.
      </Text>
    </Section>
  );
}

/* ------------------------------------------------------------------ screen */

export default function Settings() {
  const can = useCan();
  return (
    <Screen title="Settings" subtitle="This till, your access, and connections to other tools.">
      <Columns
        left={
          <>
            <TillSection />
            <PinSection />
          </>
        }
        right={
          <>
            <IntegrationsSection />
            {can("store.settings") ? <DevicesSection /> : null}
            <DevelopersSection />
          </>
        }
      />
    </Screen>
  );
}
