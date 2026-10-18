import * as Haptics from "expo-haptics";
import React, { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { formatMoney } from "@luxury-pos/core";
import { useBrand, useTokens } from "../theme/BrandProvider";
import { nativeFamily } from "../theme/fonts";

/*
 * The component vocabulary. Every screen is built from these, and these read only
 * semantic tokens, so any brand theme renders correctly and every state
 * (hover, focus, pressed, disabled, loading, error) looks the same everywhere.
 */

const web = Platform.OS === "web";

/* ------------------------------------------------------------------ layout */

export type Breakpoint = "phone" | "tablet" | "desktop";

/** Phone < 768 ≤ tablet < 1180 ≤ desktop. Structure (nav, columns, panes) changes here; type does not. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const bp: Breakpoint = width >= 1180 ? "desktop" : width >= 768 ? "tablet" : "phone";
  return { width, height, bp, wide: bp !== "phone", gutter: bp === "phone" ? 16 : bp === "tablet" ? 24 : 32 };
}

export function Row({ children, gap = 3, style, wrap, align = "center", justify }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean; align?: ViewStyle["alignItems"]; justify?: ViewStyle["justifyContent"] }) {
  const t = useTokens();
  return <View style={[{ flexDirection: "row", alignItems: align, justifyContent: justify, gap: t.space(gap), flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Stack({ children, gap = 3, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return <View style={[{ gap: t.space(gap) }, style]}>{children}</View>;
}

export const Spacer = () => <View style={{ flex: 1 }} />;

/* -------------------------------------------------------------------- text */

export type TextVariant = "display" | "title" | "heading" | "subheading" | "body" | "label" | "caption" | "overline" | "mono" | "amount" | "amountLg";
export type Tone = "text" | "muted" | "primary" | "onPrimary" | "onPrimarySoft" | "danger" | "success" | "warning" | "info";

/**
 * Display face only for `display` and `title` (screen titles, brand moments).
 * Labels, data and amounts always use the body face with tabular figures:
 * old-style serif numerals are hard to scan at a till.
 */
export function Text({
  variant = "body",
  tone = "text",
  style,
  children,
  numberOfLines,
  selectable,
  ...rest
}: {
  variant?: TextVariant;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  selectable?: boolean;
  accessibilityRole?: "header" | "text" | "alert" | "summary";
  accessibilityLabel?: string;
  nativeID?: string;
}) {
  const { tokens: t, theme, fontsReady } = useBrand();
  const s = useMemo<TextStyle>(() => {
    const c = t.color;
    const color = { text: c.text, muted: c.textMuted, primary: c.primary, onPrimary: c.onPrimary, onPrimarySoft: c.onPrimarySoft, danger: c.danger, success: c.success, warning: c.warning, info: c.info }[tone];
    const display = variant === "display" || variant === "title";
    const spec = display ? theme.fonts.display : variant === "mono" ? (theme.fonts.mono ?? theme.fonts.body) : theme.fonts.body;
    const wanted = { display: 500, title: 500, heading: 600, subheading: 600, body: 400, label: 500, caption: 400, overline: 600, mono: 400, amount: 600, amountLg: 600 }[variant];
    const weight = spec.weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), spec.weights[0] ?? 400);
    const family = spec.source.kind === "system" ? undefined : web ? (display ? t.font.display : variant === "mono" ? t.font.mono : t.font.body) : fontsReady ? nativeFamily(spec.family, weight) : undefined;
    const size = {
      display: t.display["3xl"],
      title: t.display.xl,
      heading: t.size.lg,
      subheading: t.size.base,
      body: t.size.base,
      label: t.size.sm,
      caption: t.size.xs,
      overline: Math.max(11, t.size.xs - 1),
      mono: t.size.sm,
      amount: t.size.xl,
      amountLg: t.display["3xl"],
    }[variant];
    const tight = display || variant === "amount" || variant === "amountLg";
    return {
      color,
      fontFamily: family,
      fontWeight: web || !family ? (String(weight) as TextStyle["fontWeight"]) : undefined,
      fontSize: size,
      lineHeight: Math.round(size * (tight ? 1.15 : variant === "caption" || variant === "label" ? 1.35 : 1.5)),
      letterSpacing: variant === "overline" ? 0.8 : display ? -0.01 * size : variant === "amountLg" ? -0.02 * size : 0,
      textTransform: variant === "overline" ? "uppercase" : undefined,
      fontVariant: variant === "amount" || variant === "amountLg" || variant === "mono" ? ["tabular-nums"] : undefined,
      ...(web && display ? ({ textWrap: "balance" } as TextStyle) : null),
    };
  }, [t, theme.fonts, fontsReady, variant, tone]);
  return (
    <RNText style={[s, style]} numberOfLines={numberOfLines} selectable={selectable} maxFontSizeMultiplier={1.6} {...rest}>
      {children}
    </RNText>
  );
}

export function Money({ amount, currency, variant = "body", tone, style, signed }: { amount: number; currency: string; variant?: TextVariant; tone?: Tone; style?: StyleProp<TextStyle>; signed?: boolean }) {
  const text = formatMoney(amount, currency);
  return (
    <Text variant={variant} tone={tone} style={[{ fontVariant: ["tabular-nums"] }, style]}>
      {signed && amount > 0 ? `+${text}` : text}
    </Text>
  );
}

/* ------------------------------------------------------------- interaction */

/** Hover / pressed / focus as overlay layers, so they work on any background colour. */
function useInteractive(disabled?: boolean) {
  const t = useTokens();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => t.motion.enabled && !disabled && Animated.timing(scale, { toValue: v, duration: t.motion.fast, useNativeDriver: !web }).start();
  return { scale, onPressIn: () => to(0.98), onPressOut: () => to(1) };
}

export const focusRing = (t: ReturnType<typeof useTokens>, focused?: boolean): ViewStyle =>
  (web ? { outlineStyle: focused ? "solid" : "none", outlineWidth: focused ? 2 : 0, outlineColor: t.color.focus, outlineOffset: 2 } : {}) as ViewStyle;

export type ButtonKind = "primary" | "secondary" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export function Button({
  label,
  onPress,
  kind = "primary",
  size = "md",
  icon,
  trailing,
  loading,
  disabled,
  style,
  accessibilityHint,
  block,
}: {
  label: string;
  onPress?: PressableProps["onPress"];
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Right-aligned extra: an amount on "Charge", a keyboard hint on desktop. */
  trailing?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  block?: boolean;
}) {
  const t = useTokens();
  const press = useInteractive(disabled);
  const c = t.color;
  const bg = { primary: c.primary, secondary: c.surface, soft: c.primarySoft, ghost: "transparent", danger: c.danger }[kind];
  const fg: Tone = kind === "primary" ? "onPrimary" : kind === "danger" ? "onPrimary" : kind === "soft" ? "onPrimarySoft" : "text";
  const height = { sm: 36, md: t.hit, lg: t.hit + 8, xl: t.hit + 20 }[size];
  const pad = { sm: t.space(3), md: t.space(4), lg: t.space(5), xl: t.space(6) }[size];
  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }], opacity: disabled ? 0.45 : 1, alignSelf: block ? "stretch" : undefined }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        disabled={disabled || loading}
        hitSlop={size === "sm" ? 6 : 0}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={(e) => {
          if (!web) void Haptics.selectionAsync();
          onPress?.(e);
        }}
        style={({ hovered, focused, pressed }: { hovered?: boolean; focused?: boolean; pressed?: boolean }) =>
          ({
            minHeight: height,
            borderRadius: t.radius.md,
            paddingHorizontal: pad,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: trailing ? "space-between" : "center",
            gap: t.space(2),
            borderWidth: kind === "secondary" ? 1 : 0,
            borderColor: c.border,
            overflow: "hidden",
            ...focusRing(t, focused),
            ...(web ? { cursor: disabled ? "not-allowed" : "pointer", transitionProperty: "background-color, filter", transitionDuration: `${t.motion.fast}ms` } : {}),
            backgroundColor: (hovered || pressed) && (kind === "ghost" || kind === "secondary") ? (kind === "secondary" ? c.surfaceSunken : pressed ? c.pressed : c.hover) : bg,
            ...((hovered || pressed) && (kind === "primary" || kind === "danger" || kind === "soft") ? (web ? { filter: `brightness(${pressed ? 0.92 : 1.06})` } : { opacity: 0.88 }) : {}),
          }) as ViewStyle
        }
      >
        <Row gap={2}>
          {loading ? <ActivityIndicator size="small" color={kind === "primary" || kind === "danger" ? c.onPrimary : c.text} /> : icon}
          <Text variant="label" tone={fg} style={{ fontSize: size === "xl" ? t.size.lg : size === "lg" ? t.size.base : t.size.sm, fontWeight: "600" }} numberOfLines={1}>
            {label}
          </Text>
        </Row>
        {trailing}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({ label, onPress, children, selected, size = "md", disabled, tone }: { label: string; onPress?: () => void; children: ReactNode; selected?: boolean; size?: "sm" | "md"; disabled?: boolean; tone?: "danger" }) {
  const t = useTokens();
  const box = size === "sm" ? 36 : t.hit;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={size === "sm" ? Math.max(0, (44 - box) / 2) : 0}
      style={({ hovered, pressed, focused }: { hovered?: boolean; pressed?: boolean; focused?: boolean }) =>
        ({
          width: box,
          height: box,
          borderRadius: t.radius.md,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
          backgroundColor: selected ? t.color.primarySoft : pressed ? t.color.pressed : hovered ? (tone === "danger" ? t.color.dangerSoft : t.color.hover) : "transparent",
          ...focusRing(t, focused),
        }) as ViewStyle
      }
    >
      {children}
    </Pressable>
  );
}

/** Filter / choice chip. Pill-shaped by design: it reads as a token, not a button. */
export function Chip({ label, selected, onPress, icon, count }: { label: string; selected?: boolean; onPress?: () => void; icon?: ReactNode; count?: number }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={4}
      style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) =>
        ({
          minHeight: 36,
          paddingHorizontal: t.space(3),
          borderRadius: t.radius.pill,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: selected ? "transparent" : t.color.border,
          backgroundColor: selected ? t.color.primarySoft : hovered ? t.color.hover : "transparent",
          ...focusRing(t, focused),
        }) as ViewStyle
      }
    >
      {icon}
      <Text variant="label" tone={selected ? "onPrimarySoft" : "text"}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="caption" tone={selected ? "onPrimarySoft" : "muted"} style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Segmented control for 2–5 mutually exclusive views (range, tender method, layout). */
export function Segmented<T extends string>({ value, options, onChange, label, size = "md", iconOnly }: { value: T; options: readonly { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; label: string; size?: "md" | "lg"; iconOnly?: boolean }) {
  const t = useTokens();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", padding: 3, gap: 3, borderRadius: t.radius.md + 3, backgroundColor: t.color.surfaceSunken, alignSelf: size === "lg" ? "stretch" : "flex-start" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) =>
              ({
                minHeight: size === "lg" ? t.hit : 36,
                paddingHorizontal: t.space(size === "lg" ? 4 : 3),
                borderRadius: t.radius.md,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                flexGrow: size === "lg" ? 1 : 0,
                backgroundColor: on ? t.color.surface : hovered ? t.color.hover : "transparent",
                ...(on && web ? { boxShadow: t.elevation.float } : {}),
                ...focusRing(t, focused),
              }) as ViewStyle
            }
          >
            {o.icon}
            {iconOnly && o.icon ? null : (
              <Text variant="label" tone={on ? "text" : "muted"} style={{ fontWeight: on ? "600" : "500" }}>
                {o.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Switch({ value, onChange, label, description }: { value: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const t = useTokens();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={({ focused }: { focused?: boolean; pressed: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: t.space(3), minHeight: t.hit, ...focusRing(t, focused) }) as ViewStyle}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{label}</Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 44, height: 26, borderRadius: 13, padding: 3, backgroundColor: value ? t.color.primary : t.color.borderStrong, alignItems: value ? "flex-end" : "flex-start" }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: value ? t.color.onPrimary : t.color.surface }} />
      </View>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- surfaces */

/** In-flow container: one hairline and the surface tone. No drop shadow (shadows are for floating layers). */
export function Panel({ children, style, padded = true, tone = "surface" }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; tone?: "surface" | "sunken" | "raised" }) {
  const t = useTokens();
  const bg = tone === "sunken" ? t.color.surfaceSunken : tone === "raised" ? t.color.surfaceRaised : t.color.surface;
  return <View style={[{ backgroundColor: bg, borderRadius: t.radius.lg, borderWidth: tone === "sunken" ? 0 : 1, borderColor: t.color.border, padding: padded ? t.space(5) : 0, overflow: "hidden" }, style]}>{children}</View>;
}

/** @deprecated use Panel. Kept so older screens compile while they are redesigned. */
export const Surface = ({ children, style, inner, padded = true, raised }: { children: ReactNode; style?: StyleProp<ViewStyle>; inner?: StyleProp<ViewStyle>; padded?: boolean; raised?: boolean }) => (
  <Panel style={[style, inner]} padded={padded} tone={raised ? "raised" : "surface"}>
    {children}
  </Panel>
);

export function Divider({ inset = 0, vertical }: { inset?: number; vertical?: boolean }) {
  const t = useTokens();
  return vertical ? <View style={{ width: 1, alignSelf: "stretch", backgroundColor: t.color.border }} /> : <View style={{ height: 1, backgroundColor: t.color.border, marginVertical: t.space(inset) }} />;
}

/** Section title inside a screen: heading + optional supporting line + right-side actions. */
export function SectionHeader({ title, description, actions, id }: { title: string; description?: string; actions?: ReactNode; id?: string }) {
  const t = useTokens();
  return (
    <Row justify="space-between" align="flex-end" style={{ marginBottom: t.space(3) }} wrap>
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text variant="heading" accessibilityRole="header" nativeID={id}>
          {title}
        </Text>
        {description ? (
          <Text variant="label" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      {actions}
    </Row>
  );
}

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Status always pairs colour with a word (and usually an icon), never colour alone. */
export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: BadgeTone; icon?: ReactNode }) {
  const t = useTokens();
  const c = t.color;
  const map: Record<BadgeTone, [string, Tone]> = { neutral: [c.surfaceSunken, "muted"], primary: [c.primarySoft, "onPrimarySoft"], success: [c.successSoft, "success"], warning: [c.warningSoft, "warning"], danger: [c.dangerSoft, "danger"], info: [c.infoSoft, "info"] };
  const [bg, fg] = map[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: t.radius.sm, backgroundColor: bg }}>
      {icon}
      <Text variant="caption" tone={fg} style={{ fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  );
}

/** Keyboard hint, shown on web/desktop only. */
export function Kbd({ children }: { children: string }) {
  const t = useTokens();
  if (!web) return null;
  return (
    <View style={{ paddingHorizontal: 6, minWidth: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1, borderColor: t.color.border, alignItems: "center", justifyContent: "center", backgroundColor: t.color.surfaceSunken }}>
      <Text variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
        {children}
      </Text>
    </View>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const t = useTokens();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.color.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Text variant="caption" tone="onPrimarySoft" style={{ fontWeight: "600", fontSize: size * 0.38 }}>
        {initials || "?"}
      </Text>
    </View>
  );
}

/** Loading placeholder in the shape of the content (no spinners in the middle of a layout). */
export function Skeleton({ width = "100%", height = 14, radius, style }: { width?: ViewStyle["width"]; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (!t.motion.enabled) return;
    const loop = Animated.loop(
      Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: !web }), Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: !web })]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, t.motion.enabled]);
  return <Animated.View accessibilityElementsHidden style={[{ width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.color.surfaceSunken, opacity: pulse }, style]} />;
}

/** Empty states teach: what this place is for and the one action that fills it. */
export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: t.space(8), gap: t.space(2) }}>
      {icon ? <View style={{ marginBottom: t.space(2) }}>{icon}</View> : null}
      <Text variant="subheading" style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text variant="label" tone="muted" style={{ textAlign: "center", maxWidth: 360 }}>
        {body}
      </Text>
      {action ? <View style={{ marginTop: t.space(3) }}>{action}</View> : null}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTokens();
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: t.space(3), padding: t.space(3), borderRadius: t.radius.md, backgroundColor: t.color.dangerSoft }}>
      <Text variant="label" tone="danger" style={{ flex: 1 }}>
        {message}
      </Text>
      {onRetry ? <Button kind="ghost" size="sm" label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ inputs */

type FieldProps = TextInputProps & { label: string; error?: string | null; hint?: string; leading?: ReactNode; trailing?: ReactNode; hideLabel?: boolean; size?: "md" | "lg" };

export const Field = forwardRef<React.ComponentRef<typeof TextInput>, FieldProps>(function Field({ label, error, hint, leading, trailing, hideLabel, size = "md", style, ...props }, ref) {
  const t = useTokens();
  const [focused, setFocused] = useState(false);
  const id = useMemo(() => `f${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <View style={[{ gap: 6 }, style as StyleProp<ViewStyle>]}>
      {!hideLabel ? (
        <Text variant="label" tone="muted" nativeID={id}>
          {label}
        </Text>
      ) : null}
      <View
        style={
          {
            flexDirection: "row",
            alignItems: "center",
            gap: t.space(2),
            minHeight: size === "lg" ? t.hit + 8 : t.hit,
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: error ? t.color.danger : focused ? t.color.focus : t.color.borderStrong,
            backgroundColor: t.color.surface,
            paddingHorizontal: t.space(3),
            ...(focused && web ? { boxShadow: `0 0 0 3px ${t.color.primarySoft}` } : {}),
          } as ViewStyle
        }
      >
        {leading}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={hideLabel ? undefined : id}
          aria-invalid={!!error}
          placeholderTextColor={t.color.textMuted}
          onFocus={(e) => (setFocused(true), props.onFocus?.(e))}
          onBlur={(e) => (setFocused(false), props.onBlur?.(e))}
          style={{ flex: 1, alignSelf: "stretch", color: t.color.text, fontSize: size === "lg" ? t.size.lg : t.size.base, fontFamily: web ? t.font.body : undefined, ...(web ? ({ outlineStyle: "none" } as object) : {}) }}
          {...props}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/** Key-value line for totals and detail panes; values right-aligned with tabular figures. */
export function Stat({ label, value, tone, strong }: { label: string; value: ReactNode; tone?: Tone; strong?: boolean }) {
  return (
    <Row justify="space-between">
      <Text variant={strong ? "subheading" : "label"} tone={strong ? "text" : "muted"}>
        {label}
      </Text>
      {typeof value === "string" ? (
        <Text variant={strong ? "subheading" : "label"} tone={tone} style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Row>
  );
}

/** @deprecated small uppercase kicker; use sparingly (one per screen at most). */
export function Eyebrow({ children }: { children: string }) {
  return (
    <Text variant="overline" tone="muted">
      {children}
    </Text>
  );
}
