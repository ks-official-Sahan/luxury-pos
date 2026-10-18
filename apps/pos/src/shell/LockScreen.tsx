import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiRequestError } from "@/lib/api";
import { useMe, useStore } from "@/lib/queries";
import { useBrand } from "@/theme/BrandProvider";
import { Backspace, Lock } from "@/ui/icons";
import { Avatar, Button, focusRing, Text } from "@/ui/primitives";
import { useShortcuts } from "./useShortcuts";
import { useUi } from "./ui-state";

/**
 * Locks the till after `autoLockMinutes` without a touch or key press, and when the
 * app comes back after being away that long. The sale in progress stays as it was.
 * Returns a callback the root view calls on native touches (native has no window events).
 */
export function useIdleLock() {
  const minutes = useUi((s) => s.autoLockMinutes);
  const last = useRef(Date.now());
  useEffect(() => {
    if (!minutes) return;
    const ms = minutes * 60_000;
    const bump = () => (last.current = Date.now());
    const check = () => {
      if (!useUi.getState().locked && Date.now() - last.current > ms) useUi.getState().set({ locked: true });
    };
    const timer = setInterval(check, 15_000);
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? check() : bump()));
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const web = Platform.OS === "web" && typeof window !== "undefined";
    if (web) for (const e of events) window.addEventListener(e, bump, { passive: true, capture: true });
    return () => {
      clearInterval(timer);
      sub.remove();
      if (web) for (const e of events) window.removeEventListener(e, bump, { capture: true });
    };
  }, [minutes]);
  return () => {
    last.current = Date.now();
  };
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

/** PIN unlock over the whole app. "Switch person" signs out so a colleague can sign in. */
export function LockScreen({ onSignOut }: { onSignOut: () => void }) {
  const { tokens: t, theme } = useBrand();
  const insets = useSafeAreaInsets();
  const locked = useUi((s) => s.locked);
  const set = useUi((s) => s.set);
  const me = useMe();
  const store = useStore();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noPin, setNoPin] = useState(false);

  useEffect(() => {
    if (!locked) {
      setPin("");
      setError(null);
    }
  }, [locked]);

  const submit = async (value: string) => {
    setBusy(true);
    try {
      await api("/me/pin/verify", { method: "POST", json: { pin: value } });
      set({ locked: false });
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : "network";
      setPin("");
      if (code === "no_pin") setNoPin(true);
      else if (code === "rate_limited") setError("Too many tries. Sign in again with your password.");
      else if (code === "network") setError("No connection. Check the network and try again.");
      else setError("That PIN is not right.");
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (busy) return;
    setError(null);
    if (k === "back") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p + k).slice(0, 8));
  };

  const keys: Record<string, () => void> = { backspace: () => press("back"), enter: () => pin.length >= 4 && void submit(pin) };
  for (const d of "0123456789") keys[d] = () => press(d);
  useShortcuts(locked ? keys : {});

  if (!locked) return null;
  const name = me.data?.me.name ?? me.data?.me.email ?? "";
  return (
    <View
      accessibilityViewIsModal
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: t.z.tooltip + 1, backgroundColor: t.color.background, alignItems: "center", justifyContent: "center", paddingTop: insets.top + t.space(6), paddingBottom: insets.bottom + t.space(6), paddingHorizontal: t.space(6) }}
    >
      <View style={{ width: "100%", maxWidth: 340, alignItems: "center", gap: t.space(6) }}>
        <View style={{ alignItems: "center", gap: t.space(2) }}>
          <Avatar name={name || "?"} size={56} />
          <Text variant="heading" accessibilityRole="header">
            {name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Lock size={14} color={t.color.textMuted} />
            <Text variant="label" tone="muted">
              {store?.name ?? theme.name} · locked
            </Text>
          </View>
        </View>

        {noPin ? (
          <View style={{ alignItems: "center", gap: t.space(4) }}>
            <Text tone="muted" style={{ textAlign: "center" }}>
              You have no till PIN yet. Sign in with your password, then set one in Settings for quick unlocking.
            </Text>
            <Button label="Sign in with password" onPress={onSignOut} block />
          </View>
        ) : (
          <>
            <View accessibilityLabel={`${pin.length} digits entered`} accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: t.space(3), minHeight: 20, alignItems: "center" }}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: error ? t.color.danger : t.color.borderStrong, backgroundColor: i < pin.length ? t.color.text : "transparent" }} />
              ))}
            </View>
            <Text variant="label" tone={error ? "danger" : "muted"} accessibilityRole={error ? "alert" : "text"} style={{ minHeight: 20, textAlign: "center" }}>
              {error ?? "Enter your till PIN"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(3), justifyContent: "center", maxWidth: 3 * 76 + 2 * t.space(3) }}>
              {KEYS.map((k, i) =>
                k === "" ? (
                  <View key={i} style={{ width: 76, height: 64 }} />
                ) : (
                  <Pressable
                    key={k}
                    accessibilityRole="button"
                    accessibilityLabel={k === "back" ? "Delete last digit" : k}
                    onPress={() => press(k)}
                    style={({ pressed, hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) =>
                      ({ width: 76, height: 64, borderRadius: t.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.color.pressed : hovered ? t.color.hover : t.color.surfaceSunken, ...focusRing(t, focused) }) as ViewStyle
                    }
                  >
                    {k === "back" ? <Backspace size={22} color={t.color.text} /> : <Text variant="amount">{k}</Text>}
                  </Pressable>
                ),
              )}
            </View>
            <Button label="Unlock" size="lg" block loading={busy} disabled={pin.length < 4} onPress={() => void submit(pin)} />
          </>
        )}
        <Button kind="ghost" size="sm" label={`Not ${name.split(" ")[0] || "you"}? Switch person`} onPress={onSignOut} />
      </View>
    </View>
  );
}
