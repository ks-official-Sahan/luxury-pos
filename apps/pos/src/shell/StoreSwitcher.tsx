import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Pressable, View, type ViewStyle } from "react-native";
import { useMe, useStore } from "@/lib/queries";
import { useCart } from "@/state/cart";
import { useSession } from "@/state/session";
import { useBrand } from "@/theme/BrandProvider";
import { CaretDown, Check } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { focusRing, Text } from "@/ui/primitives";
import { toast } from "@/ui/toast";

/** Brand mark: the store's logo mark, or its initial on the primary colour. */
export function BrandMark({ size = 32 }: { size?: number }) {
  const { tokens: t, theme } = useBrand();
  const me = useMe();
  const store = useStore();
  const uri = theme.logo.mark ?? (t.scheme === "dark" ? theme.logo.dark : theme.logo.light);
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: t.radius.sm }} accessibilityIgnoresInvertColors accessibilityLabel={`${me.data?.tenant.name ?? store?.name ?? "Store"} logo`} />;
  return (
    <View style={{ width: size, height: size, borderRadius: t.radius.sm, backgroundColor: t.color.primary, alignItems: "center", justifyContent: "center" }}>
      <Text variant="subheading" tone="onPrimary" style={{ fontSize: size * 0.5, lineHeight: size * 0.6 }}>
        {(me.data?.tenant.name ?? store?.name ?? "·").slice(0, 1)}
      </Text>
    </View>
  );
}

/** Switching store re-themes the whole app (each store can have its own look) and clears the open sale. */
export function StoreSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { tokens: t } = useBrand();
  const me = useMe();
  const store = useStore();
  const setSession = useSession((s) => s.set);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const stores = me.data?.stores ?? [];
  const many = stores.length > 1;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${me.data?.tenant.name ?? ""}, ${store?.name ?? ""}${many ? ". Switch store" : ""}`}
        disabled={!many}
        onPress={() => setOpen(true)}
        style={({ hovered, focused }: { hovered?: boolean; focused?: boolean; pressed: boolean }) =>
          ({ flexDirection: "row", alignItems: "center", gap: t.space(3), padding: t.space(2), borderRadius: t.radius.md, backgroundColor: hovered && many ? t.color.hover : "transparent", ...focusRing(t, focused) }) as ViewStyle
        }
      >
        <BrandMark />
        {collapsed ? null : (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                {me.data?.tenant.name ?? " "}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {store?.name ?? " "}
              </Text>
            </View>
            {many ? <CaretDown size={16} color={t.color.textMuted} /> : null}
          </>
        )}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch store" description="The open sale is cleared when you switch." variant="dialog">
        {stores.map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: s.id === store?.id }}
            onPress={() => {
              if (s.id !== store?.id) {
                useCart.getState().clear();
                setSession({ storeId: s.id, deviceId: null, drawerSessionId: null });
                void qc.invalidateQueries();
                toast.info(`Now selling at ${s.name}`);
              }
              setOpen(false);
            }}
            style={({ hovered }: { hovered?: boolean; pressed: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: t.space(3), minHeight: t.hit, paddingHorizontal: t.space(3), borderRadius: t.radius.md, backgroundColor: hovered ? t.color.hover : "transparent" }) as ViewStyle}
          >
            <View style={{ flex: 1 }}>
              <Text variant="label">{s.name}</Text>
              <Text variant="caption" tone="muted">
                {s.code} · {s.currency} · {s.timezone}
              </Text>
            </View>
            {s.id === store?.id ? <Check size={18} color={t.color.primary} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}
