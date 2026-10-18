import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useTokens } from "../theme/BrandProvider";
import { Eyebrow, Stack, Text, useLayout } from "./primitives";

/** Page frame for back-office screens: editorial header, generous gutters, readable max width. */
export function Screen({ eyebrow, title, subtitle, actions, children, scroll = true }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; scroll?: boolean }) {
  const t = useTokens();
  const { gutter, wide } = useLayout();
  const header = (
    <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-end" : "flex-start", justifyContent: "space-between", gap: t.space(4), marginBottom: t.space(6) }}>
      <Stack gap={2} style={{ flex: 1 }}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
      </Stack>
      {actions}
    </View>
  );
  const body = (
    <View style={{ width: "100%", maxWidth: 1280, alignSelf: "center", padding: gutter, paddingTop: gutter + t.space(4) }}>
      {header}
      {children}
    </View>
  );
  return scroll ? <ScrollView contentContainerStyle={{ paddingBottom: t.space(16) }}>{body}</ScrollView> : <View style={{ flex: 1 }}>{body}</View>;
}
