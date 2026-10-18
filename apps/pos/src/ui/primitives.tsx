import * as Haptics from "expo-haptics";
import { useMemo, useRef, type ReactNode } from "react";
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

/* ------------------------------------------------------------------ layout */

export type Breakpoint = "phone" | "tablet" | "desktop";

/** Phone < 768 ≤ tablet < 1180 ≤ desktop. Every screen adapts from this one hook. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const bp: Breakpoint = width >= 1180 ? "desktop" : width >= 768 ? "tablet" : "phone";
  return { width, height, bp, wide: bp !== "phone", gutter: bp === "phone" ? 16 : bp === "tablet" ? 24 : 32 };
}

/* -------------------------------------------------------------------- text */

type Variant = "display" | "title" | "heading" | "body" | "label" | "caption" | "eyebrow" | "mono" | "amount";

export function Text({ variant = "body", tone = "text", style, children, numberOfLines, ...rest }: { variant?: Variant; tone?: "text" | "muted" | "primary" | "danger" | "success" | "onPrimary"; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; accessibilityRole?: "header" | "text" }) {
  const { tokens: t, theme, fontsReady } = useBrand();
  const s = useMemo<TextStyle>(() => {
    const color = tone === "muted" ? t.color.textMuted : tone === "primary" ? t.color.primary : tone === "danger" ? t.color.danger : tone === "success" ? t.color.success : tone === "onPrimary" ? t.color.onPrimary : t.color.text;
    // Amounts use the body face: display serifs often have old-style figures that are hard to scan at a till.
    const display = variant === "display" || variant === "title";
    const spec = display ? theme.fonts.display : variant === "mono" ? (theme.fonts.mono ?? theme.fonts.body) : theme.fonts.body;
    const wanted = variant === "heading" || variant === "label" || variant === "amount" ? 600 : variant === "eyebrow" ? 500 : display ? (spec.weights.at(-1) ?? 500) : 400;
    const weight = spec.weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), spec.weights[0] ?? 400);
    const family = spec.source.kind === "system" ? undefined : Platform.OS === "web" ? (display ? t.font.display : variant === "mono" ? t.font.mono : t.font.body) : fontsReady ? nativeFamily(spec.family, weight) : undefined;
    const size = { display: t.size["4xl"], title: t.size["2xl"], heading: t.size.lg, body: t.size.base, label: t.size.sm, caption: t.size.xs, eyebrow: Math.max(11, t.size.xs - 1), mono: t.size.sm, amount: t.size["3xl"] }[variant];
    return {
      color,
      fontFamily: family,
      fontWeight: Platform.OS === "web" || !family ? (String(weight) as TextStyle["fontWeight"]) : undefined,
      fontSize: size,
      lineHeight: Math.round(size * (display || variant === "amount" ? 1.12 : 1.45)),
      letterSpacing: variant === "eyebrow" ? 2 : display || variant === "amount" ? -0.4 : 0,
      textTransform: variant === "eyebrow" ? "uppercase" : undefined,
      fontVariant: variant === "amount" || variant === "mono" ? ["tabular-nums"] : undefined,
    };
  }, [t, theme.fonts, fontsReady, variant, tone]);
  return (
    <RNText style={[s, style]} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.6} {...rest}>
      {children}
    </RNText>
  );
}

export function Money({ amount, currency, variant = "body", tone, style }: { amount: number; currency: string; variant?: Variant; tone?: "text" | "muted" | "primary" | "danger" | "success"; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant={variant} tone={tone} style={[{ fontVariant: ["tabular-nums"] }, style]}>
      {formatMoney(amount, currency)}
    </Text>
  );
}

/* ---------------------------------------------------------------- surfaces */

/**
 * Two nested shapes with concentric radii: a hairline tray and the panel sitting in it.
 * Depth comes from tone, not from heavy shadows.
 */
export function Surface({ children, style, inner, padded = true, raised = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; inner?: StyleProp<ViewStyle>; padded?: boolean; raised?: boolean }) {
  const t = useTokens();
  const gap = 5;
  return (
    <View style={[{ backgroundColor: t.scheme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.05)", borderRadius: t.radius.lg + gap, padding: gap, borderWidth: 1, borderColor: t.scheme === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)" }, style]}>
      <View
        style={[
          {
            backgroundColor: raised ? t.color.surfaceRaised : t.color.surface,
            borderRadius: t.radius.lg,
            padding: padded ? t.space(5) : 0,
            overflow: "hidden",
            ...(Platform.OS === "web" ? { boxShadow: t.scheme === "light" ? "inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px -24px rgba(20,16,10,0.18)" : "inset 0 1px 0 rgba(255,255,255,0.06)" } : {}),
          },
          inner,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function Divider() {
  const t = useTokens();
  return <View style={{ height: 1, backgroundColor: t.color.border, opacity: 0.7, marginVertical: t.space(3) }} />;
}

export function Row({ children, gap = 3, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  const t = useTokens();
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: t.space(gap), flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Stack({ children, gap = 3, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return <View style={[{ gap: t.space(gap) }, style]}>{children}</View>;
}

/* ----------------------------------------------------------------- buttons */

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

/** Spring press feedback; scale only, so it stays on the GPU. Respects reduced motion. */
function usePress() {
  const t = useTokens();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => t.motion.enabled && Animated.spring(scale, { toValue: v, useNativeDriver: Platform.OS !== "web", speed: 40, bounciness: 6 }).start();
  return { scale, onPressIn: () => to(0.97), onPressOut: () => to(1) };
}

export function Button({
  label,
  onPress,
  kind = "primary",
  icon,
  trailing,
  loading,
  disabled,
  size = "md",
  style,
  accessibilityHint,
}: {
  label: string;
  onPress?: PressableProps["onPress"];
  kind?: ButtonKind;
  icon?: ReactNode;
  /** Trailing glyph shown in its own round well, flush with the pill's edge. */
  trailing?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const t = useTokens();
  const press = usePress();
  const bg = kind === "primary" ? t.color.primary : kind === "danger" ? t.color.danger : kind === "secondary" ? t.color.surfaceRaised : "transparent";
  const fg = kind === "primary" ? "onPrimary" : kind === "danger" ? "onPrimary" : "text";
  const height = size === "lg" ? t.hit + 12 : t.hit;
  return (
    <Animated.View style={[{ transform: [{ scale: press.scale }], opacity: disabled ? 0.45 : 1 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        disabled={disabled || loading}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={(e) => {
          if (Platform.OS !== "web") void Haptics.selectionAsync();
          onPress?.(e);
        }}
        style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) => ({
          minHeight: height,
          borderRadius: t.radius.pill,
          backgroundColor: bg,
          paddingLeft: t.space(6),
          paddingRight: trailing ? 6 : t.space(6),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: t.space(2),
          borderWidth: kind === "secondary" || kind === "ghost" ? 1 : 0,
          borderColor: t.color.border,
          outlineStyle: focused ? "solid" : undefined,
          outlineWidth: focused ? 2 : 0,
          outlineColor: t.color.focus,
          outlineOffset: 2,
          filter: hovered && kind !== "ghost" ? "brightness(1.06)" : undefined,
        } as ViewStyle)}
      >
        {loading ? <ActivityIndicator color={kind === "primary" || kind === "danger" ? t.color.onPrimary : t.color.text} /> : icon}
        <Text variant="label" tone={fg} style={{ fontSize: size === "lg" ? t.size.base : t.size.sm }}>
          {label}
        </Text>
        {trailing ? (
          <View style={{ width: height - 12, height: height - 12, borderRadius: t.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: kind === "primary" ? "rgba(255,255,255,0.14)" : t.scheme === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)" }}>{trailing}</View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({ label, onPress, children, selected }: { label: string; onPress?: () => void; children: ReactNode; selected?: boolean }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={6}
      style={{ width: t.hit, height: t.hit, borderRadius: t.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: selected ? t.color.primary : "transparent" }}
    >
      {children}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{ minHeight: 36, paddingHorizontal: t.space(4), borderRadius: t.radius.pill, justifyContent: "center", borderWidth: 1, borderColor: selected ? t.color.primary : t.color.border, backgroundColor: selected ? t.color.primary : "transparent" }}
    >
      <Text variant="label" tone={selected ? "onPrimary" : "text"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Eyebrow({ children }: { children: string }) {
  const t = useTokens();
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: t.space(3), paddingVertical: 4, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.color.border }}>
      <Text variant="eyebrow" tone="muted">
        {children}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field({ label, error, style, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const t = useTokens();
  return (
    <View style={[{ gap: 6 }, style as StyleProp<ViewStyle>]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.color.textMuted}
        style={{
          minHeight: t.hit,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: error ? t.color.danger : t.color.border,
          backgroundColor: t.color.surfaceRaised,
          color: t.color.text,
          paddingHorizontal: t.space(4),
          fontSize: t.size.base,
          fontFamily: Platform.OS === "web" ? t.font.body : undefined,
        }}
        {...props}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="text">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: t.space(10), gap: t.space(3) }}>
      <Text variant="heading">{title}</Text>
      <Text tone="muted" style={{ textAlign: "center", maxWidth: 420 }}>
        {body}
      </Text>
      {action}
    </View>
  );
}
