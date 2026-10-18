import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { brandThemeSchema, contrastRatio, isHex, PRESETS, resolveTokens, type BrandTheme, type PresetId } from "@luxury-pos/theme";
import { api } from "@/lib/api";
import { useStore } from "@/lib/queries";
import { useBrand } from "@/theme/BrandProvider";
import { Screen } from "@/ui/Screen";
import { Button, Chip, Field, Money, Row, Stack, Surface, Text, useLayout } from "@/ui/primitives";

const COLOR_KEYS = ["primary", "accent", "background", "surface", "text"] as const;
const FONT_CHOICES = ["Cormorant Garamond", "Playfair Display", "Fraunces", "Manrope", "Plus Jakarta Sans", "DM Sans", "Jost", "System"];

/** Free typing, but only a valid hex reaches the theme (an invalid one would break token resolution). */
function ColorField({ label, value, border, onCommit }: { label: string; value: string; border: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const valid = isHex(text);
  return (
    <Row gap={3}>
      <View accessibilityElementsHidden style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: valid ? text : value, borderWidth: 1, borderColor: border }} />
      <Field
        label={label}
        value={text}
        autoCapitalize="none"
        style={{ flex: 1 }}
        error={valid ? null : "Use a hex colour like #A8834A"}
        onChangeText={(v) => {
          const next = v.startsWith("#") ? v : `#${v}`;
          setText(next);
          if (isHex(next)) onCommit(next);
        }}
      />
    </Row>
  );
}

/**
 * Brand studio: every change previews live across the whole app (BrandProvider.preview),
 * and the contrast meter shows what the token resolver will correct to stay WCAG AA.
 */
export default function Brand() {
  const { theme, preview } = useBrand();
  const { wide } = useLayout();
  const store = useStore();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BrandTheme>(theme);
  const [scope, setScope] = useState<"tenant" | "store">("tenant");

  useEffect(() => {
    preview(draft);
  }, [draft, preview]);
  useEffect(() => () => preview(null), [preview]);

  const save = useMutation({
    mutationFn: () => api<BrandTheme>(`/branding${scope === "store" && store ? `?storeId=${store.id}` : ""}`, { method: "PUT", json: brandThemeSchema.parse(draft) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const setColor = (k: (typeof COLOR_KEYS)[number], v: string) => setDraft((d) => ({ ...d, light: { ...d.light, [k]: v } }));
  const setFont = (slot: "display" | "body", family: string) =>
    setDraft((d) => ({ ...d, fonts: { ...d.fonts, [slot]: { family, source: family === "System" ? { kind: "system" } : { kind: "google" }, weights: slot === "display" ? [500, 600] : [400, 600] } } }));
  const resolved = resolveTokens(draft, "light");
  const ratio = contrastRatio(draft.light.text, draft.light.background);

  return (
    <Screen
      title="Make it yours"
      subtitle="Colours, type and feel for every till, receipt and email. Changes preview instantly."
      actions={
        <Row gap={2}>
          <Chip label="Whole business" selected={scope === "tenant"} onPress={() => setScope("tenant")} />
          <Chip label={store ? `Only ${store.code}` : "This store"} selected={scope === "store"} onPress={() => setScope("store")} />
          <Button label={save.isSuccess ? "Saved" : "Save brand"} loading={save.isPending} onPress={() => save.mutate()} />
        </Row>
      }
    >
      <View style={{ flexDirection: wide ? "row" : "column", gap: 24 }}>
        <Stack gap={5} style={{ flex: 1 }}>
          <Surface>
            <Stack gap={3}>
              <Text variant="heading">Start from a look</Text>
              <Row gap={2} wrap>
                {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                  <Chip key={id} label={PRESETS[id].name} selected={draft.name === PRESETS[id].name} onPress={() => setDraft(PRESETS[id])} />
                ))}
              </Row>
              <Field label="Brand name" value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))} />
            </Stack>
          </Surface>

          <Surface>
            <Stack gap={3}>
              <Text variant="heading">Colours</Text>
              {COLOR_KEYS.map((k) => (
                <ColorField key={`${draft.name}-${k}`} label={k[0]!.toUpperCase() + k.slice(1)} value={draft.light[k]} border={resolved.color.border} onCommit={(v) => setColor(k, v)} />
              ))}
              <Text variant="caption" tone={ratio >= 4.5 ? "success" : "danger"}>
                Text contrast {ratio.toFixed(1)}:1 {ratio >= 7 ? "· AAA" : ratio >= 4.5 ? "· AA" : "· below AA — text will be darkened automatically"}
              </Text>
            </Stack>
          </Surface>

          <Surface>
            <Stack gap={3}>
              <Text variant="heading">Typography</Text>
              {(["display", "body"] as const).map((slot) => (
                <Stack key={slot} gap={2}>
                  <Text variant="label" tone="muted">
                    {slot === "display" ? "Headlines and amounts" : "Body and controls"}
                  </Text>
                  <Row gap={2} wrap>
                    {FONT_CHOICES.map((f) => (
                      <Chip key={f} label={f} selected={draft.fonts[slot].family === f} onPress={() => setFont(slot, f)} />
                    ))}
                  </Row>
                </Stack>
              ))}
            </Stack>
          </Surface>

          <Surface>
            <Stack gap={3}>
              <Text variant="heading">Feel</Text>
              <Row gap={2} wrap>
                {(["none", "subtle", "soft", "round"] as const).map((r) => (
                  <Chip key={r} label={`Corners: ${r}`} selected={draft.radius === r} onPress={() => setDraft((d) => ({ ...d, radius: r }))} />
                ))}
              </Row>
              <Row gap={2} wrap>
                {(["compact", "comfortable", "spacious"] as const).map((v) => (
                  <Chip key={v} label={v[0]!.toUpperCase() + v.slice(1)} selected={draft.density === v} onPress={() => setDraft((d) => ({ ...d, density: v }))} />
                ))}
              </Row>
              <Row gap={2} wrap>
                {(["system", "light", "dark"] as const).map((v) => (
                  <Chip key={v} label={`Appearance: ${v}`} selected={draft.colorScheme === v} onPress={() => setDraft((d) => ({ ...d, colorScheme: v }))} />
                ))}
              </Row>
              <Field label="Say “Client” instead of “Customer”" value={draft.terminology.Customer ?? ""} onChangeText={(v) => setDraft((d) => ({ ...d, terminology: { ...d.terminology, Customer: v } }))} placeholder="Customer" />
              <Field label="Receipt footer" value={draft.receipt.footer} onChangeText={(footer) => setDraft((d) => ({ ...d, receipt: { ...d.receipt, footer } }))} multiline />
            </Stack>
          </Surface>
        </Stack>

        <Stack gap={4} style={{ width: wide ? 360 : "100%" }}>
          <Text variant="overline" tone="muted">
            Preview
          </Text>
          <Surface raised>
            <Stack gap={3}>
              <Text variant="overline" tone="muted">
                {draft.name}
              </Text>
              <Text variant="title">Le Sac Plume</Text>
              <Text tone="muted">Noir · M · Calfskin</Text>
              <Money amount={420_000} currency={store?.currency ?? "EUR"} variant="amount" />
              <Button label="Charge" size="lg" />
              <Pressable accessibilityRole="button">
                <Text variant="label" tone="primary">
                  Add to {draft.terminology.Customer ?? "Customer"} wish list
                </Text>
              </Pressable>
            </Stack>
          </Surface>
          {save.error ? <Text tone="danger">{(save.error as Error).message}</Text> : null}
        </Stack>
      </View>
    </Screen>
  );
}
