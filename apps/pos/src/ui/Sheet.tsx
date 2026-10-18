import { X } from "./icons";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokens } from "../theme/BrandProvider";
import { IconButton, Text, useLayout } from "./primitives";

/**
 * Secondary tasks open beside the work, not on top of it:
 * - wide screens: a drawer from the right edge (the register or list stays visible);
 * - phones: a bottom sheet in thumb reach;
 * - `dialog`: a small centred confirmation (approvals, destructive confirms).
 * Motion is transform/opacity only with an ease-out curve; none when reduced motion is on.
 */
export function Sheet({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "drawer",
  width,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "drawer" | "dialog";
  width?: number;
  scroll?: boolean;
}) {
  const t = useTokens();
  const { wide, height } = useLayout();
  const insets = useSafeAreaInsets();
  const p = useRef(new Animated.Value(0)).current;
  const dialog = variant === "dialog" && wide;
  const drawer = !dialog && wide;

  useEffect(() => {
    if (!visible) return;
    p.setValue(t.motion.enabled ? 0 : 1);
    if (t.motion.enabled) Animated.timing(p, { toValue: 1, duration: t.motion.base, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, [visible, t.motion.enabled, t.motion.base, p]);

  const offset = p.interpolate({ inputRange: [0, 1], outputRange: [drawer ? 48 : dialog ? 12 : 240, 0] });
  const w = width ?? (dialog ? 440 : 480);
  const body = scroll ? (
    <ScrollView contentContainerStyle={{ padding: t.space(5), gap: t.space(4) }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: t.space(5), gap: t.space(4) }}>{children}</View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, flexDirection: "row", justifyContent: drawer ? "flex-end" : "center", alignItems: drawer ? "stretch" : dialog ? "center" : "flex-end" }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: p }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: t.color.scrim }} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={title}
          style={{
            width: wide ? w : "100%",
            maxWidth: "100%",
            maxHeight: drawer ? undefined : dialog ? height * 0.86 : height * 0.92,
            backgroundColor: t.color.surface,
            borderTopLeftRadius: drawer ? 0 : t.radius.lg,
            borderTopRightRadius: drawer ? 0 : t.radius.lg,
            borderBottomLeftRadius: dialog ? t.radius.lg : 0,
            borderBottomRightRadius: dialog ? t.radius.lg : 0,
            borderLeftWidth: drawer ? 1 : 0,
            borderColor: t.color.border,
            paddingTop: drawer ? insets.top : 0,
            paddingBottom: dialog ? 0 : insets.bottom,
            opacity: p,
            transform: drawer ? [{ translateX: offset }] : [{ translateY: offset }],
            ...(Platform.OS === "web" ? ({ boxShadow: t.elevation.overlay } as object) : { elevation: 12 }),
          }}
        >
          {!wide ? <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: t.color.borderStrong, marginTop: 8 }} /> : null}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: t.space(3), paddingHorizontal: t.space(5), paddingTop: t.space(4), paddingBottom: t.space(1) }}>
            <View style={{ flex: 1, gap: 2, paddingTop: 6 }}>
              <Text variant="heading" accessibilityRole="header">
                {title}
              </Text>
              {description ? (
                <Text variant="label" tone="muted">
                  {description}
                </Text>
              ) : null}
            </View>
            <IconButton label="Close" onPress={onClose}>
              <X size={20} color={t.color.text} />
            </IconButton>
          </View>
          <View style={{ flex: drawer ? 1 : undefined, flexShrink: 1 }}>{body}</View>
          {footer ? <View style={{ padding: t.space(5), paddingTop: t.space(3), borderTopWidth: 1, borderTopColor: t.color.border, gap: t.space(2) }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
