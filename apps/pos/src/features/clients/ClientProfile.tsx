import { type ReactNode } from "react";
import { View } from "react-native";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { EnvelopeSimple, Lock, PencilSimple, Phone } from "@/ui/icons";
import { Avatar, Badge, Button, Chip, Money, Panel, Row, Stack, Stat, Text, type BadgeTone } from "@/ui/primitives";
import { clientName, formatDay, isMasked, tierLabel, type ClientProfile, type Purchase, type PurchaseStatus } from "./model";

const STATUS: Record<Exclude<PurchaseStatus, "completed">, { label: string; tone: BadgeTone }> = {
  partially_refunded: { label: "Partly refunded", tone: "warning" },
  refunded: { label: "Refunded", tone: "danger" },
  voided: { label: "Voided", tone: "neutral" },
};

interface ClientProfileViewProps {
  profile: ClientProfile;
  currency: string;
  locale: string;
  canSell: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onStartSale: () => void;
}

/** Clienteling profile: who the client is, what they buy, and what to remember. Scrolls inside its host. */
export function ClientProfileView({ profile, currency, locale, canSell, canWrite, onEdit, onStartSale }: ClientProfileViewProps) {
  const t = useTokens();
  const term = useTerm();
  const { customer: c, recent } = profile;
  const name = clientName(c);
  const masked = isMasked(c.email) || isMasked(c.phone);
  const prefs = Object.entries(c.preferences);
  const notes = c.notes?.trim() ?? "";

  return (
    <Stack gap={5}>
      <Row gap={4}>
        <Avatar name={name} size={64} />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" accessibilityRole="header" numberOfLines={2}>
            {name}
          </Text>
          <Row gap={2} wrap>
            <Badge tone="primary" label={tierLabel(c.tierId)} />
            <Text variant="label" tone="muted">
              {`${c.pointsBalance.toLocaleString()} points`}
            </Text>
          </Row>
        </Stack>
      </Row>

      {canSell || canWrite ? (
        <Row gap={2} wrap>
          {canSell ? <Button label={`Start a ${term("Sale").toLowerCase()}`} onPress={onStartSale} /> : null}
          {canWrite ? <Button kind="secondary" label="Edit" icon={<PencilSimple size={18} color={t.color.text} />} onPress={onEdit} /> : null}
        </Row>
      ) : null}

      <Panel>
        <Stack gap={3}>
          <Stat label="Lifetime spend" value={<Money amount={c.lifetimeSpend} currency={currency} variant="label" />} />
          <Stat label="Points balance" value={c.pointsBalance.toLocaleString()} />
          <Stat label="Member since" value={formatDay(c.createdAt, locale) ?? "Not recorded"} />
          <Stat label="Marketing consent" value={c.marketingConsent ? "Yes" : "No"} />
        </Stack>
      </Panel>

      <Section title="Contact">
        {c.email || c.phone ? (
          <Stack gap={2}>
            {c.email ? <IconLine icon={<EnvelopeSimple size={18} color={t.color.textMuted} />} text={c.email} /> : null}
            {c.phone ? <IconLine icon={<Phone size={18} color={t.color.textMuted} />} text={c.phone} /> : null}
          </Stack>
        ) : (
          <Text tone="muted">No contact details on file.</Text>
        )}
        {masked ? (
          <Row gap={2} align="flex-start">
            <Lock size={16} color={t.color.textMuted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              Full details need the client contact permission
            </Text>
          </Row>
        ) : null}
        {c.birthday ? <Stat label="Birthday" value={c.birthday} /> : null}
      </Section>

      <Section title="Preferences">
        {prefs.length ? (
          <Row gap={2} wrap>
            {prefs.map(([k, v]) => (
              <Chip key={k} label={`${k}: ${v}`} />
            ))}
          </Row>
        ) : (
          <Text tone="muted">No preferences saved.</Text>
        )}
      </Section>

      <Section title="Notes">
        <Panel tone="sunken">
          <Text tone={notes ? "text" : "muted"} selectable>
            {notes || "No notes yet."}
          </Text>
        </Panel>
      </Section>

      <Section title="Purchase history" caption="Most recent first">
        {recent.length ? (
          <Stack gap={0}>
            {recent.map((p) => (
              <PurchaseRow key={p.id} purchase={p} currency={currency} locale={locale} />
            ))}
          </Stack>
        ) : (
          <Text tone="muted">No purchases yet.</Text>
        )}
      </Section>
    </Stack>
  );
}

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text variant="subheading" accessibilityRole="header">
          {title}
        </Text>
        {caption ? (
          <Text variant="caption" tone="muted">
            {caption}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}

function IconLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Row gap={2}>
      {icon}
      <Text selectable style={{ flex: 1, minWidth: 0 }}>
        {text}
      </Text>
    </Row>
  );
}

function PurchaseRow({ purchase: p, currency, locale }: { purchase: Purchase; currency: string; locale: string }) {
  const t = useTokens();
  const badge = p.status === "completed" ? null : STATUS[p.status];
  return (
    <Row align="flex-start" justify="space-between" gap={3} style={{ paddingVertical: t.space(3), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" style={{ fontWeight: "600" }}>
          {`${formatDay(p.createdAt, locale) ?? "Date unknown"} · ${p.receiptNo}`}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {p.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}
        </Text>
        {badge ? <Badge tone={badge.tone} label={badge.label} /> : null}
      </Stack>
      <Money amount={p.total} currency={currency} variant="label" />
    </Row>
  );
}
