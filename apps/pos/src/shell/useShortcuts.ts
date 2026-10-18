import { useEffect, useRef } from "react";
import { Platform } from "react-native";

type Handler = (e: KeyboardEvent) => void;

/**
 * Global keyboard shortcuts on web and Electron. Keys are like "mod+k", "mod+enter",
 * "escape", "/" ("mod" = ⌘ on macOS, Ctrl elsewhere). Single-key shortcuts are
 * ignored while typing in a field so search boxes keep working.
 */
export function useShortcuts(map: Record<string, Handler | false | undefined>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      const mod = e.metaKey || e.ctrlKey;
      const key = `${mod ? "mod+" : ""}${e.shiftKey && mod ? "shift+" : ""}${e.key.toLowerCase()}`;
      const handler = ref.current[key];
      if (!handler || (typing && !mod && key !== "escape")) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export const isMac = Platform.OS === "web" && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
