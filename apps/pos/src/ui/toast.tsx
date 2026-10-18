import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { useTokens } from "../theme/BrandProvider";
import { CheckCircle, Info, WarningCircle } from "./icons";
import { Text } from "./primitives";

type Toast = { id: number; tone: "success" | "info" | "danger"; message: string; action?: { label: string; run: () => void } };

/** Non-blocking confirmations ("Sale saved", "Token copied"). Never used for errors that need a decision. */
export const useToasts = create<{ items: Toast[]; push: (tone: Toast["tone"], message: string, action?: Toast["action"]) => void; dismiss: (id: number) => void }>()((set, get) => ({
  items: [],
  push: (tone, message, action) => {
    const id = Date.now() + Math.random();
    set({ items: [...get().items.slice(-2), { id, tone, message, action }] });
    // Toasts with an action stay longer: people need time to reach for Undo.
    setTimeout(() => get().dismiss(id), action ? 6000 : 3600);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (m: string) => useToasts.getState().push("success", m),
  info: (m: string) => useToasts.getState().push("info", m),
  error: (m: string) => useToasts.getState().push("danger", m),
  /** A reversible action happened: say so and offer to take it back instead of asking "are you sure?" first. */
  undo: (m: string, run: () => void) => useToasts.getState().push("info", m, { label: "Undo", run }),
};

function Item({ item }: { item: Toast }) {
  const t = useTokens();
  const p = useRef(new Animated.Value(t.motion.enabled ? 0 : 1)).current;
  useEffect(() => {
    if (t.motion.enabled) Animated.timing(p, { toValue: 1, duration: t.motion.base, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, [p, t.motion.enabled, t.motion.base]);
  const Icon = item.tone === "success" ? CheckCircle : item.tone === "danger" ? WarningCircle : Info;
  const color = item.tone === "success" ? t.color.success : item.tone === "danger" ? t.color.danger : t.color.info;
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: t.space(2),
        paddingVertical: t.space(3),
        paddingHorizontal: t.space(4),
        borderRadius: t.radius.md,
        backgroundColor: t.color.surfaceRaised,
        borderWidth: 1,
        borderColor: t.color.border,
        opacity: p,
        transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        ...(Platform.OS === "web" ? ({ boxShadow: t.elevation.overlay } as object) : { elevation: 8 }),
      }}
    >
      <Icon size={20} color={color} weight="fill" />
      <Text variant="label">{item.message}</Text>
      {item.action ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            item.action!.run();
            useToasts.getState().dismiss(item.id);
          }}
          hitSlop={8}
          style={{ marginLeft: t.space(2), paddingHorizontal: t.space(2), minHeight: 32, justifyContent: "center", borderRadius: t.radius.sm }}
        >
          <Text variant="label" tone="primary" style={{ fontWeight: "600" }}>
            {item.action.label}
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function Toaster() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const items = useToasts((s) => s.items);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + t.space(20), alignItems: "center", gap: t.space(2), zIndex: t.z.toast }}>
      {items.map((i) => (
        <Item key={i.id} item={i} />
      ))}
    </View>
  );
}
