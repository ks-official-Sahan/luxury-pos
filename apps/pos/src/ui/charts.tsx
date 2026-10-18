import { useMemo, useState } from "react";
import { Platform, Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useTokens } from "../theme/BrandProvider";
import { Text } from "./primitives";

/*
 * Small, dependency-free charts drawn with react-native-svg on every platform.
 * Each one carries an accessible text summary; the visual is a supplement, the
 * numbers next to it are the source of truth.
 */

type Point = { x: string; y: number };

function scale(values: number[], height: number, pad = 4) {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  return (v: number) => pad + (height - pad * 2) * (1 - (v - min) / (max - min || 1));
}

function path(points: number[], width: number, y: (v: number) => number) {
  if (!points.length) return "";
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

export function Sparkline({ values, width = 96, height = 28, color, label }: { values: number[]; width?: number; height?: number; color?: string; label: string }) {
  const t = useTokens();
  const y = scale(values, height, 3);
  return (
    <View accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={width} height={height}>
        <Path d={path(values, width, y)} stroke={color ?? t.chart[0]} strokeWidth={1.75} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/**
 * Area chart for a daily series with an optional comparison series (previous
 * period) drawn as a quiet dashed line. Tap/hover a column to read its value.
 */
export function AreaChart({ series, compare, height = 180, format, label, formatX = (x) => x, tickX }: { series: Point[]; compare?: number[]; height?: number; format: (v: number) => string; label: string; formatX?: (x: string) => string; tickX?: (x: string) => string }) {
  const t = useTokens();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const values = series.map((p) => p.y);
  const y = useMemo(() => scale([...values, ...(compare ?? [])], height, 8), [values, compare, height]);
  const line = path(values, width, y);
  const area = line ? `${line} L${width},${height} L0,${height} Z` : "";
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const color = t.chart[0]!;
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const at = active ?? series.length - 1;
  const total = values.reduce((s, v) => s + v, 0);

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6, minHeight: 20 }}>
        <Text variant="caption" tone="muted">
          {series[at] ? formatX(series[at]!.x) : ""}
        </Text>
        <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {series[at] ? format(series[at]!.y) : ""}
          {compare?.[at] !== undefined ? `  ·  before ${format(compare[at]!)}` : ""}
        </Text>
      </View>
      <View onLayout={onLayout} style={{ height }} accessibilityRole="image" accessibilityLabel={`${label}. ${series.length} days, total ${format(total)}.`}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.22} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={t.color.border} strokeWidth={1} />
            ))}
            {compare?.length ? <Path d={path(compare, width, y)} stroke={t.color.textMuted} strokeOpacity={0.6} strokeDasharray="4 4" strokeWidth={1.25} fill="none" /> : null}
            <Path d={area} fill="url(#fill)" />
            <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {series[at] ? (
              <>
                <Line x1={at * step} x2={at * step} y1={0} y2={height} stroke={t.color.borderStrong} strokeWidth={1} />
                <Circle cx={at * step} cy={y(values[at]!)} r={4} fill={t.color.surface} stroke={color} strokeWidth={2} />
              </>
            ) : null}
          </Svg>
        ) : null}
        {/* Invisible hit columns: hover on web, tap on touch. */}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
          {series.map((p, i) => (
            <Pressable
              key={p.x}
              accessibilityLabel={`${formatX(p.x)}: ${format(p.y)}`}
              onPress={() => setActive(i)}
              {...(Platform.OS === "web" ? { onHoverIn: () => setActive(i), onHoverOut: () => setActive(null) } : {})}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
      {tickX && series.length > 1 ? (
        <View accessibilityElementsHidden style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          {[0, Math.floor((series.length - 1) / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
            <Text key={i} variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
              {tickX(series[i]!.x)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Inline proportion bar for ranked tables (share of the leader). */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const t = useTokens();
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.color.surfaceSunken, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color ?? t.chart[0] }} />
    </View>
  );
}

/** Stacked share bar (e.g. sales by store or tender mix) with a legend. */
export function ShareBar({ parts, format }: { parts: { label: string; value: number }[]; format: (v: number) => string }) {
  const t = useTokens();
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <View style={{ gap: t.space(3) }}>
      <View accessibilityElementsHidden style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 }}>
        {parts.map((p, i) => (
          <View key={p.label} style={{ flex: p.value / total, backgroundColor: t.chart[i % t.chart.length] }} />
        ))}
      </View>
      <View style={{ gap: t.space(2) }}>
        {parts.map((p, i) => (
          <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: t.space(2) }}>
            <Svg width={10} height={10}>
              <Rect width={10} height={10} rx={2} fill={t.chart[i % t.chart.length]} />
            </Svg>
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {p.label}
            </Text>
            <Text variant="label" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
              {Math.round((p.value / total) * 100)}%
            </Text>
            <Text variant="label" style={{ fontVariant: ["tabular-nums"], minWidth: 90, textAlign: "right" }}>
              {format(p.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Percent change with direction icon-free wording; colour only reinforces the sign. */
export function Delta({ current, previous, invert, quietWhenEmpty }: { current: number; previous: number; invert?: boolean; quietWhenEmpty?: boolean }) {
  if (!previous) return quietWhenEmpty ? null : <Text variant="caption" tone="muted">No earlier data to compare</Text>;
  const change = (current - previous) / Math.abs(previous);
  const good = invert ? change < 0 : change > 0;
  const pct = `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change * 100).toFixed(1)}%`;
  return (
    <Text variant="caption" tone={Math.abs(change) < 0.005 ? "muted" : good ? "success" : "danger"} style={{ fontVariant: ["tabular-nums"], fontWeight: "600" }} accessibilityLabel={`${pct} versus previous period`}>
      {pct} vs previous
    </Text>
  );
}
