import { useNetworkState } from "expo-network";
import { Platform, View } from "react-native";
import { useOutbox } from "@/state/outbox";
import { useTokens } from "@/theme/BrandProvider";
import { CloudArrowUp, CloudSlash, CheckCircle, WarningCircle } from "@/ui/icons";
import { Text } from "@/ui/primitives";

/**
 * Offline is a normal state: always show whether this till is online and how many
 * sales are waiting, never block the floor on it. Permanent refusals stand out.
 */
export function useSync() {
  const net = useNetworkState();
  const items = useOutbox((s) => s.items);
  const online = Platform.OS === "web" && typeof navigator !== "undefined" ? navigator.onLine !== false : net.isInternetReachable !== false;
  const failed = items.filter((i) => i.error?.permanent).length;
  return { online, pending: items.length - failed, failed };
}

export function SyncStatus({ compact }: { compact?: boolean }) {
  const t = useTokens();
  const { online, pending, failed } = useSync();
  const [Icon, color, label] = failed
    ? [WarningCircle, t.color.danger, `${failed} sale${failed > 1 ? "s" : ""} need attention`]
    : !online
      ? [CloudSlash, t.color.warning, pending ? `Offline · ${pending} queued` : "Offline · selling continues"]
      : pending
        ? [CloudArrowUp, t.color.info, `Syncing ${pending}`]
        : [CheckCircle, t.color.success, "All synced"];
  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}>
      <Icon size={18} color={color} weight={failed || !online ? "fill" : "regular"} />
      {compact ? null : (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}
