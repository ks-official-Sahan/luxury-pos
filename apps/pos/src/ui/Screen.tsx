import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useTokens } from "../theme/BrandProvider";
import { Text, useLayout } from "./primitives";

/**
 * Back-office page frame: title in the brand's display face, one supporting line,
 * actions on the right; content at a readable max width. `fill` gives the content
 * the full height (master-detail lists) instead of a scrolling page.
 */
export function Screen({ title, subtitle, actions, toolbar, children, fill, maxWidth = 1360 }: { title: string; subtitle?: string; actions?: ReactNode; toolbar?: ReactNode; children: ReactNode; fill?: boolean; maxWidth?: number }) {
  const t = useTokens();
  const { gutter, wide } = useLayout();
  const header = (
    <View style={{ gap: t.space(4), paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: t.space(4), width: "100%", maxWidth, alignSelf: "center" }}>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-end" : "flex-start", justifyContent: "space-between", gap: t.space(3) }}>
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="label" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={{ flexDirection: "row", gap: t.space(2), flexWrap: "wrap" }}>{actions}</View> : null}
      </View>
      {toolbar}
    </View>
  );
  if (fill)
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ flex: 1, width: "100%", maxWidth, alignSelf: "center", paddingHorizontal: wide ? gutter : 0, paddingBottom: wide ? gutter : 0 }}>{children}</View>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: t.space(16) }}>
      {header}
      <View style={{ width: "100%", maxWidth, alignSelf: "center", paddingHorizontal: gutter, gap: t.space(6) }}>{children}</View>
    </ScrollView>
  );
}
