import { type ReactElement, type ReactNode } from "react";
import { FlatList, Pressable, View, type ViewStyle } from "react-native";
import { useTokens } from "../theme/BrandProvider";
import { focusRing, Skeleton, Text, useLayout } from "./primitives";

/**
 * One component for every back-office list: a dense table with a sticky header
 * on wide screens, stacked rows on phones (primary column on top, the rest as a
 * caption line). Virtualised, keyset-paged via `onEndReached`.
 */
export interface Column<T> {
  key: string;
  header: string;
  /** Flex weight on wide screens. */
  flex?: number;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Shown in the phone caption line; omit to hide on phones. */
  phone?: boolean;
}

export function DataList<T>({
  rows,
  columns,
  keyOf,
  onPress,
  selectedKey,
  loading,
  empty,
  onEndReached,
  footer,
  label,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  keyOf: (row: T) => string;
  onPress?: (row: T) => void;
  selectedKey?: string | null;
  loading?: boolean;
  empty: ReactElement;
  onEndReached?: () => void;
  footer?: ReactElement | null;
  label: string;
}) {
  const t = useTokens();
  const { wide } = useLayout();
  const [first, ...rest] = columns;

  const header = wide ? (
    <View accessibilityRole="header" style={{ flexDirection: "row", gap: t.space(3), paddingHorizontal: t.space(4), paddingVertical: t.space(2), borderBottomWidth: 1, borderBottomColor: t.color.border, backgroundColor: t.color.surface }}>
      {columns.map((c) => (
        <Text key={c.key} variant="caption" tone="muted" style={{ flex: c.flex ?? 1, textAlign: c.align === "right" ? "right" : "left", fontWeight: "600" }}>
          {c.header}
        </Text>
      ))}
    </View>
  ) : null;

  if (loading && !rows?.length)
    return (
      <View style={{ padding: t.space(4), gap: t.space(4) }} accessibilityLabel={`Loading ${label}`}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={18} width={`${90 - (i % 3) * 15}%`} />
        ))}
      </View>
    );

  return (
    <FlatList
      accessibilityLabel={label}
      data={rows ?? []}
      keyExtractor={keyOf}
      ListHeaderComponent={header ?? undefined}
      stickyHeaderIndices={wide ? [0] : undefined}
      ListEmptyComponent={empty}
      ListFooterComponent={footer ?? undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={20}
      windowSize={9}
      renderItem={({ item }) => {
        const selected = selectedKey === keyOf(item);
        const content = wide ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.space(3) }}>
            {columns.map((c) => (
              <View key={c.key} style={{ flex: c.flex ?? 1, alignItems: c.align === "right" ? "flex-end" : "flex-start" }}>
                {c.render(item)}
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: t.space(3) }}>
              <View style={{ flex: 1 }}>{first!.render(item)}</View>
              {rest.filter((c) => c.align === "right" && c.phone !== false).slice(-1).map((c) => <View key={c.key}>{c.render(item)}</View>)}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(3) }}>
              {rest.filter((c) => c.phone && c.align !== "right").map((c) => <View key={c.key}>{c.render(item)}</View>)}
            </View>
          </View>
        );
        const style = ({ hovered, focused }: { hovered?: boolean; focused?: boolean; pressed: boolean }) =>
          ({
            paddingHorizontal: t.space(4),
            paddingVertical: wide ? t.space(3) : t.space(3),
            minHeight: t.hit,
            justifyContent: "center",
            borderBottomWidth: 1,
            borderBottomColor: t.color.border,
            backgroundColor: selected ? t.color.primarySoft : hovered && onPress ? t.color.hover : "transparent",
            ...focusRing(t, focused),
          }) as ViewStyle;
        return onPress ? (
          <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onPress(item)} style={style}>
            {content}
          </Pressable>
        ) : (
          <View style={style({ pressed: false })}>{content}</View>
        );
      }}
    />
  );
}
