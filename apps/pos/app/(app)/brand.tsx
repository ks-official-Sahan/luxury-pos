import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, View, type ViewStyle } from "react-native";
import { brandThemeSchema, contrastRatio, deriveDark, isHex, PRESETS, resolveTokens, toDesignTokens, type BrandTheme, type Palette, type PresetId, type ThemeTokens } from "@luxury-pos/theme";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useCan, useStore } from "@/lib/queries";
import { useBrand } from "@/theme/BrandProvider";
import { Check, Copy } from "@/ui/icons";
import { Badge, Button, Chip, ErrorNote, Field, focusRing, Panel, Row, SectionHeader, Segmented, Stack, Switch, Text, useLayout } from "@/ui/primitives";
import { Screen } from "@/ui/Screen";
import { toast } from "@/ui/toast";

const COLOR_KEYS = [
  ["primary", "Primary", "Main actions and selection"],
  ["accent", "Accent", "Focus rings and highlights"],
  ["background", "Background", "Behind everything"],
  ["surface", "Surface", "Panels, tiles and the sale"],
  ["text", "Text", "Body copy and figures"],
] as const;
const DISPLAY_FONTS = ["Cormorant Garamond", "Playfair Display", "Fraunces", "Libre Caslon Text", "Plus Jakarta Sans", "Manrope", "System"];
const BODY_FONTS = ["Manrope", "Inter", "Plus Jakarta Sans", "DM Sans", "Nunito Sans", "IBM Plex Sans", "System"];
const WORDS = [
  ["Customer", "Client, Guest, Member"],
  ["Sale", "Purchase, Order, Ticket"],
  ["Store", "Maison, Boutique, Branch"],
  ["Product", "Piece, Item, Dish"],
] as const;

/** A swatch plus a hex field; on web the swatch opens the system colour picker. Only valid hex reaches the theme. */
function ColorField({ label, hint, value, onCommit }: { label: string; hint: string; value: string; onCommit: (hex: string) => void }) {
  const { tokens: t } = useBrand();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isHex(text);
  const swatch = { width: 44, height: 44, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.borderStrong, backgroundColor: valid ? text : value } as const;
  return (
    <Row gap={3} align="flex-start">
      {Platform.OS === "web" ? (
        <label style={{ ...swatch, display: "block", cursor: "pointer", position: "relative", marginTop: 26 }} aria-label={`Pick ${label}`}>
          {React.createElement("input", {
            type: "color",
            value: valid && text.length === 7 ? text : value.length === 7 ? value : "#000000",
            onChange: (e: { target: { value: string } }) => (setText(e.target.value), onCommit(e.target.value)),
            style: { opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" },
          })}
        </label>
      ) : (
        <View accessibilityElementsHidden style={[swatch, { marginTop: 26 }]} />
      )}
      <Field
        label={label}
        hint={hint}
        value={text}
        autoCapitalize="none"
        autoCorrect={false}
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

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Panel>
      <SectionHeader title={title} description={description} />
      <Stack gap={4}>{children}</Stack>
    </Panel>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/** Contrast report: what the store chose, and what the resolver will actually draw to stay readable. */
function ContrastReport({ draft, tokens }: { draft: Palette; tokens: ThemeTokens }) {
  const rows: [string, string, string, string, number][] = [
    ["Body text", draft.text, tokens.color.text, tokens.color.background, 7],
    ["Button label", tokens.color.onPrimary, tokens.color.onPrimary, tokens.color.primary, 4.5],
    ["Primary on background", draft.primary, tokens.color.primary, tokens.color.background, 3],
    ["Secondary text", tokens.color.textMuted, tokens.color.textMuted, tokens.color.surface, 4.5],
  ];
  return (
    <Stack gap={2}>
      {rows.map(([name, chosen, drawn, bg, target]) => {
        const ratio = contrastRatio(drawn, bg);
        const adjusted = chosen.toLowerCase() !== drawn.toLowerCase();
        return (
          <Row key={name} justify="space-between">
            <Text variant="label">{name}</Text>
            <Row gap={2}>
              <Text variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                {ratio.toFixed(1)}:1
              </Text>
              {adjusted ? <Badge tone="info" label="Adjusted" /> : <Badge tone={ratio >= target ? "success" : "warning"} label={ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "UI" : "Low"} />}
            </Row>
          </Row>
        );
      })}
    </Stack>
  );
}

/** A small register drawn with the draft's own tokens, independent of the app chrome around it. */
function Preview({ theme, scheme }: { theme: BrandTheme; scheme: "light" | "dark" }) {
  const tk = useMemo(() => resolveTokens({ ...theme, colorScheme: scheme }, scheme), [theme, scheme]);
  const c = tk.color;
  const font = (display?: boolean) => (Platform.OS === "web" ? { fontFamily: display ? tk.font.display : tk.font.body } : {});
  const txt = (s: string, o: { size?: number; color?: string; weight?: "400" | "500" | "600"; display?: boolean } = {}) => (
    <Text style={{ fontSize: o.size ?? tk.size.sm, color: o.color ?? c.text, fontWeight: o.weight ?? "400", ...font(o.display), fontVariant: ["tabular-nums"] }}>{s}</Text>
  );
  const word = (w: string) => theme.terminology[w] || w;
  const tile = (name: string, price: string) => (
    <View style={{ flex: 1, padding: tk.space(3), borderRadius: tk.radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 4 }}>
      {txt("Aurelia", { size: tk.size.xs, color: c.textMuted })}
      {txt(name, { weight: "600" })}
      {txt(price, { weight: "600" })}
    </View>
  );
  const ticket = (
    <View style={{ width: 200, padding: tk.space(3), backgroundColor: c.surface, gap: tk.space(2), borderColor: c.border, [theme.layout.ticketSide === "right" ? "borderLeftWidth" : "borderRightWidth"]: 1 }}>
      {txt(word("Sale"), { size: tk.size.base, weight: "600" })}
      <View style={{ padding: tk.space(2), borderRadius: tk.radius.md, backgroundColor: c.primarySoft }}>{txt(`${word("Customer")} · Camille L.`, { color: c.onPrimarySoft, weight: "500" })}</View>
      <Row justify="space-between">
        {txt("Le Sac Plume")}
        {txt("4,200.00")}
      </Row>
      <Row justify="space-between">
        {txt("Silk Carré 90")}
        {txt("520.00")}
      </Row>
      <View style={{ height: 1, backgroundColor: c.border }} />
      <Row justify="space-between">
        {txt("Total", { weight: "600" })}
        {txt("4,720.00", { size: tk.size.lg, weight: "600" })}
      </Row>
      <View style={{ minHeight: 40, borderRadius: tk.radius.md, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>{txt("Charge 4,720.00", { color: c.onPrimary, weight: "600" })}</View>
    </View>
  );
  return (
    <View accessibilityLabel={`Preview of ${theme.name} in ${scheme} appearance`} style={{ borderRadius: tk.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}>
      <View style={{ flexDirection: "row", minHeight: 260 }}>
        {theme.layout.ticketSide === "left" ? ticket : null}
        <View style={{ flex: 1, padding: tk.space(3), gap: tk.space(3) }}>
          {txt(theme.name, { size: tk.display.lg, display: true, weight: "500" })}
          <View style={{ minHeight: 34, borderRadius: tk.radius.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface, justifyContent: "center", paddingHorizontal: tk.space(2) }}>{txt("Search name, SKU or scan", { color: c.textMuted })}</View>
          <Row gap={2} align="stretch">
            {tile("Le Sac Plume", "4,200.00")}
            {tile("Silk Carré 90", "520.00")}
          </Row>
          <Row gap={2}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: tk.radius.sm, backgroundColor: c.successSoft }}>{txt("In stock", { size: tk.size.xs, color: c.success, weight: "600" })}</View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: tk.radius.sm, backgroundColor: c.warningSoft }}>{txt("2 left", { size: tk.size.xs, color: c.warning, weight: "600" })}</View>
          </Row>
          <Row gap={1}>
            {tk.chart.map((col) => (
              <View key={col} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: col }} />
            ))}
          </Row>
        </View>
        {theme.layout.ticketSide === "right" ? ticket : null}
      </View>
    </View>
  );
}

const clone = (t: BrandTheme): BrandTheme => JSON.parse(JSON.stringify(t)) as BrandTheme;

/**
 * Brand studio. Everything a store can make its own: colours (light and dark),
 * type, shape, density, motion, the register layout, its vocabulary and receipts.
 * The whole app previews the draft live; the resolver still guarantees contrast.
 */
export default function Brand() {
  const { tokens: t, theme, preview } = useBrand();
  const { bp } = useLayout();
  const store = useStore();
  const can = useCan();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BrandTheme>(() => clone(theme));
  const [saved, setSaved] = useState<BrandTheme>(() => clone(theme));
  const [scope, setScope] = useState<"tenant" | "store">("tenant");
  const [editing, setEditing] = useState<"light" | "dark">("light");
  const [previewScheme, setPreviewScheme] = useState<"light" | "dark">(theme.colorScheme === "dark" ? "dark" : "light");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => preview(draft), [draft, preview]);
  useEffect(() => () => preview(null), [preview]);

  const save = useMutation({
    mutationFn: () => api<BrandTheme>(`/branding${scope === "store" && store ? `?storeId=${store.id}` : ""}`, { method: "PUT", json: brandThemeSchema.parse(draft) }),
    onSuccess: (next) => {
      setSaved(clone(next));
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(scope === "store" ? `Saved for ${store?.name ?? "this store"}` : "Saved for every store");
    },
  });

  if (!can("store.branding")) return <Screen title="Brand" subtitle="Ask an owner or admin to change how your stores look.">{null}</Screen>;

  const set = <K extends keyof BrandTheme>(key: K, value: BrandTheme[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const palette: Palette = editing === "dark" ? (draft.dark ?? deriveDark(draft.light)) : draft.light;
  const setColor = (k: keyof Palette, v: string) => setDraft((d) => (editing === "dark" ? { ...d, dark: { ...(d.dark ?? deriveDark(d.light)), [k]: v } } : { ...d, light: { ...d.light, [k]: v } }));
  const setFont = (slot: "display" | "body", family: string) =>
    setDraft((d) => ({ ...d, fonts: { ...d.fonts, [slot]: { family, source: family === "System" ? { kind: "system" } : { kind: "google" }, weights: slot === "display" ? [500, 600] : [400, 500, 600] } } }));
  const setLayout = <K extends keyof BrandTheme["layout"]>(k: K, v: BrandTheme["layout"][K]) => setDraft((d) => ({ ...d, layout: { ...d.layout, [k]: v } }));
  const resolved = resolveTokens({ ...draft, colorScheme: editing }, editing);

  const controls = (
    <Stack gap={5}>
      <Group title="Start from a look" description="A preset fills everything below; adjust from there.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(3) }}>
          {(Object.keys(PRESETS) as PresetId[]).map((id) => {
            const p = PRESETS[id];
            const on = draft.name === p.name;
            const pal = p.colorScheme === "dark" && p.dark ? p.dark : p.light;
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.name}
                onPress={() => setDraft(clone(p))}
                style={({ focused }: { focused?: boolean; pressed: boolean }) => ({ width: 148, padding: t.space(2), gap: t.space(2), borderRadius: t.radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? t.color.primary : t.color.border, ...focusRing(t, focused) }) as ViewStyle}
              >
                <View style={{ height: 48, borderRadius: t.radius.md, backgroundColor: pal.background, flexDirection: "row", alignItems: "flex-end", padding: 6, gap: 4, borderWidth: 1, borderColor: t.color.border }}>
                  <View style={{ width: 28, height: 14, borderRadius: 3, backgroundColor: pal.primary }} />
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: pal.accent }} />
                  <View style={{ flex: 1, height: 22, borderRadius: 3, backgroundColor: pal.surface }} />
                </View>
                <Row justify="space-between">
                  <Text variant="caption" style={{ fontWeight: "600" }} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {on ? <Check size={14} color={t.color.primary} /> : null}
                </Row>
              </Pressable>
            );
          })}
        </View>
        <Field label="Theme name" value={draft.name} onChangeText={(name) => set("name", name)} />
      </Group>

      <Group title="Colours" description="Pick your brand colours. Text and controls are nudged only as far as needed to stay readable (WCAG AA).">
        <Segmented
          label="Edit colours for"
          value={editing}
          onChange={(v) => (setEditing(v), setPreviewScheme(v))}
          options={[
            { value: "light", label: "Light appearance" },
            { value: "dark", label: "Dark appearance" },
          ]}
        />
        {editing === "dark" ? (
          <Switch
            value={!!draft.dark}
            onChange={(on) => set("dark", on ? deriveDark(draft.light) : undefined)}
            label="Custom dark colours"
            description={draft.dark ? "Using the colours below." : "Derived from the light colours automatically; switch on to fine-tune."}
          />
        ) : null}
        {editing === "light" || draft.dark
          ? COLOR_KEYS.map(([k, l, hint]) => <ColorField key={`${editing}-${k}`} label={l} hint={hint} value={palette[k]} onCommit={(v) => setColor(k, v)} />)
          : null}
        <Labelled label="Greys">
          <Segmented
            label="Greys"
            value={draft.neutrals}
            onChange={(v) => set("neutrals", v)}
            options={[
              { value: "brand", label: "Tinted with your colour" },
              { value: "pure", label: "Pure grey" },
            ]}
          />
        </Labelled>
        <Labelled label="Appearance on tills">
          <Segmented
            label="Appearance"
            value={draft.colorScheme}
            onChange={(v) => set("colorScheme", v)}
            options={[
              { value: "system", label: "Follow device" },
              { value: "light", label: "Always light" },
              { value: "dark", label: "Always dark" },
            ]}
          />
        </Labelled>
        <Panel tone="sunken">
          <ContrastReport draft={palette} tokens={resolved} />
        </Panel>
      </Group>

      <Group title="Typography" description="Display face for titles and brand moments; body face for everything people read and tap.">
        <Labelled label="Display">
          <Row gap={2} wrap>
            {DISPLAY_FONTS.map((f) => (
              <Chip key={f} label={f} selected={draft.fonts.display.family === f} onPress={() => setFont("display", f)} />
            ))}
          </Row>
        </Labelled>
        <Labelled label="Body">
          <Row gap={2} wrap>
            {BODY_FONTS.map((f) => (
              <Chip key={f} label={f} selected={draft.fonts.body.family === f} onPress={() => setFont("body", f)} />
            ))}
          </Row>
        </Labelled>
        <Field label="Another Google font for titles" placeholder="e.g. Bodoni Moda" hint="Exact family name from fonts.google.com" onSubmitEditing={(e) => e.nativeEvent.text.trim() && setFont("display", e.nativeEvent.text.trim())} />
        <Labelled label="Text size">
          <Segmented label="Base text size" value={String(draft.type.base)} onChange={(v) => set("type", { ...draft.type, base: Number(v) })} options={["14", "15", "16", "17", "18"].map((v) => ({ value: v, label: `${v}px` }))} />
        </Labelled>
        <Labelled label="Title contrast">
          <Segmented
            label="Type scale"
            value={String(draft.type.ratio)}
            onChange={(v) => set("type", { ...draft.type, ratio: Number(v) })}
            options={[
              { value: "1.2", label: "Quiet" },
              { value: "1.25", label: "Balanced" },
              { value: "1.333", label: "Editorial" },
              { value: "1.414", label: "Dramatic" },
            ]}
          />
        </Labelled>
      </Group>

      <Group title="Shape and feel">
        <Labelled label="Corners">
          <Segmented label="Corners" value={draft.radius} onChange={(v) => set("radius", v)} options={(["none", "subtle", "soft", "round"] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} />
        </Labelled>
        <Labelled label="Density">
          <Segmented label="Density" value={draft.density} onChange={(v) => set("density", v)} options={(["compact", "comfortable", "spacious"] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} />
        </Labelled>
        <Labelled label="Motion">
          <Segmented
            label="Motion"
            value={draft.motion}
            onChange={(v) => set("motion", v)}
            options={[
              { value: "full", label: "Full" },
              { value: "reduced", label: "Reduced" },
              { value: "none", label: "None" },
            ]}
          />
        </Labelled>
      </Group>

      <Group title="Register layout" description="Arrange the till for your counter and your team.">
        <Labelled label="Sale panel">
          <Segmented
            label="Sale panel side"
            value={draft.layout.ticketSide}
            onChange={(v) => setLayout("ticketSide", v)}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
          />
        </Labelled>
        <Labelled label="Catalogue">
          <Row gap={3} wrap>
            <Segmented
              label="Catalogue view"
              value={draft.layout.catalog}
              onChange={(v) => setLayout("catalog", v)}
              options={[
                { value: "grid", label: "Tiles" },
                { value: "list", label: "List" },
              ]}
            />
            <Segmented
              label="Tile size"
              value={draft.layout.tileSize}
              onChange={(v) => setLayout("tileSize", v)}
              options={[
                { value: "s", label: "Small" },
                { value: "m", label: "Medium" },
                { value: "l", label: "Large" },
              ]}
            />
          </Row>
        </Labelled>
        <Switch value={draft.layout.showImages} onChange={(v) => setLayout("showImages", v)} label="Show product photos" description="Off suits fast counters with few, well-known items." />
        <Switch value={draft.layout.showStock} onChange={(v) => setLayout("showStock", v)} label="Show stock on tiles" />
        <Field
          label="Quick cash amounts"
          hint="Whole amounts, separated by commas. Leave empty to suggest them from the total."
          defaultValue={draft.layout.quickCash.join(", ")}
          keyboardType="numbers-and-punctuation"
          onEndEditing={(e) =>
            setLayout(
              "quickCash",
              e.nativeEvent.text
                .split(/[\s,]+/)
                .map(Number)
                .filter((n) => Number.isInteger(n) && n > 0)
                .slice(0, 6),
            )
          }
        />
      </Group>

      <Group title="Your words" description="The till speaks your store's language.">
        {WORDS.map(([w, examples]) => (
          <Field key={w} label={`Instead of “${w}”`} placeholder={examples} value={draft.terminology[w] ?? ""} onChangeText={(v) => set("terminology", { ...draft.terminology, [w]: v })} />
        ))}
      </Group>

      <Group title="Logo and receipt">
        <Field label="Logo for light backgrounds (URL)" value={draft.logo.light ?? ""} autoCapitalize="none" onChangeText={(v) => set("logo", { ...draft.logo, light: v || undefined })} />
        <Field label="Logo for dark backgrounds (URL)" value={draft.logo.dark ?? ""} autoCapitalize="none" onChangeText={(v) => set("logo", { ...draft.logo, dark: v || undefined })} />
        <Field label="Square mark (URL)" hint="Shown in the sidebar and on small screens." value={draft.logo.mark ?? ""} autoCapitalize="none" onChangeText={(v) => set("logo", { ...draft.logo, mark: v || undefined })} />
        <Field label="Receipt header" value={draft.receipt.header} multiline onChangeText={(header) => set("receipt", { ...draft.receipt, header })} />
        <Field label="Receipt footer" value={draft.receipt.footer} multiline onChangeText={(footer) => set("receipt", { ...draft.receipt, footer })} placeholder="Returns within 30 days with this receipt." />
        <Row gap={3} wrap>
          <Segmented
            label="Paper width"
            value={String(draft.receipt.paperWidthMm)}
            onChange={(v) => set("receipt", { ...draft.receipt, paperWidthMm: Number(v) as 58 | 80 })}
            options={[
              { value: "58", label: "58 mm" },
              { value: "80", label: "80 mm" },
            ]}
          />
          <View style={{ flex: 1, minWidth: 200 }}>
            <Switch value={draft.receipt.showLogo} onChange={(showLogo) => set("receipt", { ...draft.receipt, showLogo })} label="Logo on receipts" />
          </View>
        </Row>
      </Group>
    </Stack>
  );

  const side = (
    <Stack gap={4}>
      <Row justify="space-between">
        <Text variant="subheading">Preview</Text>
        <Segmented
          label="Preview appearance"
          value={previewScheme}
          onChange={setPreviewScheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Row>
      <Preview theme={draft} scheme={previewScheme} />
      <Text variant="caption" tone="muted">
        The whole app is showing this draft right now. Leave the page without saving to go back.
      </Text>
      <Button kind="ghost" size="sm" label="Copy design tokens (W3C format)" icon={<Copy size={16} color={t.color.text} />} onPress={() => void copyText(JSON.stringify(toDesignTokens(resolved), null, 2), "Design tokens copied")} />
    </Stack>
  );

  return (
    <Screen
      title="Brand"
      subtitle="How every till, receipt and email looks and speaks."
      actions={
        <>
          <Segmented
            label="Apply to"
            value={scope}
            onChange={setScope}
            options={[
              { value: "tenant", label: "Every store" },
              { value: "store", label: store ? `Only ${store.name}` : "This store" },
            ]}
          />
          {dirty ? <Button kind="secondary" label="Discard changes" onPress={() => setDraft(clone(saved))} /> : null}
          <Button label={dirty ? "Save brand" : "Saved"} disabled={!dirty} loading={save.isPending} onPress={() => save.mutate()} />
        </>
      }
    >
      {save.error ? <ErrorNote message={(save.error as Error).message} /> : null}
      {bp === "desktop" ? (
        <View style={{ flexDirection: "row", gap: t.space(6), alignItems: "flex-start" }}>
          <View style={{ flex: 1, maxWidth: 640 }}>{controls}</View>
          <View style={{ flex: 1, ...(Platform.OS === "web" ? ({ position: "sticky", top: t.space(4) } as object) : {}) }}>{side}</View>
        </View>
      ) : (
        <Stack gap={5}>
          {side}
          {controls}
        </Stack>
      )}
    </Screen>
  );
}

