import { useState } from "react";
import { ScrollView, View } from "react-native";
import { contrastRatio, PRESETS, type PresetId } from "@luxury-pos/theme";
import { BrandProvider, useTokens } from "@/theme/BrandProvider";
import { CreditCard, Money as Cash, Plus, Tag } from "@/ui/icons";
import { Badge, Button, Chip, EmptyState, ErrorNote, Field, Money, Panel, Row, SectionHeader, Segmented, Skeleton, Stack, Switch, Text, type ButtonKind, type TextVariant } from "@/ui/primitives";

/**
 * Design system gallery at /design: every primitive, in every state, under any
 * preset and colour scheme. Use it to build a component in isolation and to check
 * a store's brand before saving it. No data, no sign-in.
 */
export default function DesignGallery() {
  const [preset, setPreset] = useState<PresetId>("maison");
  const [scheme, setScheme] = useState<"light" | "dark">("dark");
  return (
    <BrandProvider theme={{ ...PRESETS[preset], colorScheme: scheme }}>
      <Gallery preset={preset} setPreset={setPreset} scheme={scheme} setScheme={setScheme} />
    </BrandProvider>
  );
}

function Swatch({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  const t = useTokens();
  const ratio = contrastRatio(fg, bg);
  return (
    <View style={{ width: 168, borderRadius: t.radius.md, overflow: "hidden", borderWidth: 1, borderColor: t.color.border }}>
      <View style={{ height: 56, backgroundColor: bg, padding: t.space(2), justifyContent: "flex-end" }}>
        <Text variant="label" style={{ color: fg, fontWeight: "600" }}>
          Aa {ratio.toFixed(1)}:1
        </Text>
      </View>
      <View style={{ padding: t.space(2), backgroundColor: t.color.surface }}>
        <Text variant="caption">{name}</Text>
        <Text variant="caption" tone="muted">
          {bg}
        </Text>
      </View>
    </View>
  );
}

function Gallery({ preset, setPreset, scheme, setScheme }: { preset: PresetId; setPreset: (p: PresetId) => void; scheme: "light" | "dark"; setScheme: (s: "light" | "dark") => void }) {
  const t = useTokens();
  const c = t.color;
  const [field, setField] = useState("");
  const [on, setOn] = useState(true);
  const [method, setMethod] = useState("card");
  const variants: TextVariant[] = ["title", "heading", "subheading", "body", "label", "caption", "mono"];
  const kinds: ButtonKind[] = ["primary", "secondary", "soft", "ghost", "danger"];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: t.space(8), gap: t.space(8), maxWidth: 1200, width: "100%", alignSelf: "center" }}>
      <Stack gap={3}>
        <Text variant="title" accessibilityRole="header">
          Design system
        </Text>
        <Text tone="muted">Every primitive under {PRESETS[preset].name}. Switch presets and schemes to check that any brand stays legible.</Text>
        <Row gap={3} wrap>
          <Segmented label="Preset" value={preset} onChange={setPreset} options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: PRESETS[id].name }))} />
          <Segmented label="Scheme" value={scheme} onChange={setScheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Row>
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Colour roles" description="Ratios are text on fill; the resolver keeps body text at 4.5:1 or more whatever the brand picks." />
        <Row gap={3} wrap align="flex-start">
          <Swatch name="background / text" bg={c.background} fg={c.text} />
          <Swatch name="surface / muted" bg={c.surface} fg={c.textMuted} />
          <Swatch name="sunken / muted" bg={c.surfaceSunken} fg={c.textMuted} />
          <Swatch name="primary" bg={c.primary} fg={c.onPrimary} />
          <Swatch name="primary soft" bg={c.primarySoft} fg={c.onPrimarySoft} />
          <Swatch name="success" bg={c.successSoft} fg={c.success} />
          <Swatch name="warning" bg={c.warningSoft} fg={c.warning} />
          <Swatch name="danger" bg={c.dangerSoft} fg={c.danger} />
        </Row>
        <Row gap={2}>
          {t.chart.map((h) => (
            <View key={h} accessibilityLabel={`Chart colour ${h}`} style={{ width: 40, height: 16, borderRadius: t.radius.sm, backgroundColor: h }} />
          ))}
        </Row>
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Type" description="Display face for titles only; amounts use the body face with tabular figures." />
        {variants.map((v) => (
          <Row key={v} gap={4} align="baseline">
            <Text variant="caption" tone="muted" style={{ width: 96 }}>
              {v}
            </Text>
            <Text variant={v}>Le Sac Plume, Noir</Text>
          </Row>
        ))}
        <Row gap={4} align="baseline">
          <Text variant="caption" tone="muted" style={{ width: 96 }}>
            amount
          </Text>
          <Money amount={1_284_550} currency="EUR" variant="amount" />
          <Money amount={1_284_550} currency="EUR" variant="amountLg" />
        </Row>
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Buttons" description="Verb + object labels. One primary per area." />
        {kinds.map((k) => (
          <Row key={k} gap={3} wrap>
            <Text variant="caption" tone="muted" style={{ width: 96 }}>
              {k}
            </Text>
            <Button kind={k} size="sm" label="Add item" icon={<Plus size={16} color={k === "primary" || k === "danger" ? c.onPrimary : c.text} />} />
            <Button kind={k} label="Save changes" />
            <Button kind={k} size="lg" label="Loading" loading />
            <Button kind={k} label="Disabled" disabled />
          </Row>
        ))}
        <Button size="xl" label="Charge" trailing={<Money amount={842_000} currency="EUR" variant="subheading" tone="onPrimary" />} style={{ maxWidth: 420 }} />
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Choice and status" />
        <Segmented
          label="Payment method"
          value={method}
          onChange={setMethod}
          options={[
            { value: "card", label: "Card", icon: <CreditCard size={18} color={c.text} /> },
            { value: "cash", label: "Cash", icon: <Cash size={18} color={c.text} /> },
          ]}
        />
        <Row gap={2} wrap>
          <Chip label="All" selected />
          <Chip label="Completed" count={128} />
          <Chip label="Refunded" icon={<Tag size={14} color={c.text} />} />
        </Row>
        <Row gap={2} wrap>
          {(["neutral", "primary", "success", "warning", "danger", "info"] as const).map((tone) => (
            <Badge key={tone} tone={tone} label={tone} />
          ))}
        </Row>
        <View style={{ maxWidth: 420 }}>
          <Switch value={on} onChange={setOn} label="Email receipts" description="Clients with an email get their receipt automatically." />
        </View>
      </Stack>

      <Stack gap={3}>
        <SectionHeader title="Inputs and feedback" />
        <Row gap={4} wrap align="flex-start">
          <Field label="Client email" placeholder="name@example.com" value={field} onChangeText={setField} hint="Used for receipts only" style={{ width: 280 }} />
          <Field label="Unit price" value="12,50x" error="Enter an amount like 1250.00" style={{ width: 280 }} onChangeText={() => {}} />
        </Row>
        <View style={{ maxWidth: 560 }}>
          <ErrorNote message="The numbers could not load. They will retry automatically." onRetry={() => {}} />
        </View>
        <Row gap={4} align="flex-start" wrap>
          <Panel style={{ width: 360 }}>
            <Stack gap={2}>
              <Skeleton width="60%" height={18} />
              <Skeleton />
              <Skeleton width="80%" />
            </Stack>
          </Panel>
          <Panel style={{ width: 360 }} padded={false}>
            <EmptyState title="Nothing needs you right now" body="Low stock and unusual activity show up here first." />
          </Panel>
        </Row>
      </Stack>
    </ScrollView>
  );
}
