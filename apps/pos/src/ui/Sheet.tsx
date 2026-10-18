import { X } from "./icons";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokens } from "../theme/BrandProvider";
import { IconButton, Text, useLayout } from "./primitives";

/**
 * Bottom sheet on phones, centred dialog on tablets and desktops.
 * Enters with a spring on transform/opacity only; no motion when reduced motion is on.
 */
export function Sheet({ visible, onClose, title, children, footer, width = 520 }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const t = useTokens();
  const { wide, height } = useLayout();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    y.setValue(t.motion.enabled ? 1 : 0);
    if (t.motion.enabled) Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== "web", damping: 22, stiffness: 240, mass: 0.9 }).start();
  }, [visible, t.motion.enabled, y]);

  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [0, wide ? 24 : 320] });
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: wide ? "center" : "flex-end", alignItems: "center" }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(8,8,10,0.45)" } as never} />
        <Animated.View
          accessibilityViewIsModal
          style={{
            width: wide ? width : "100%",
            maxWidth: "100%",
            maxHeight: wide ? height * 0.88 : height * 0.92,
            backgroundColor: t.color.surface,
            borderRadius: t.radius.lg + 6,
            borderBottomLeftRadius: wide ? t.radius.lg + 6 : 0,
            borderBottomRightRadius: wide ? t.radius.lg + 6 : 0,
            paddingBottom: wide ? 0 : insets.bottom,
            transform: [{ translateY }],
            opacity: y.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          }}
        >
          {!wide ? <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.color.border, marginTop: 8 }} /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: t.space(5), paddingTop: t.space(4) }}>
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            <IconButton label="Close" onPress={onClose}>
              <X size={20} color={t.color.text} weight="light" />
            </IconButton>
          </View>
          <ScrollView contentContainerStyle={{ padding: t.space(5), gap: t.space(4) }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ padding: t.space(5), paddingTop: 0 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
