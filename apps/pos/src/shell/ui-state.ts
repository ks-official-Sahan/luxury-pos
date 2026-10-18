import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface UiPrefs {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  /** Till locked behind the PIN. Persisted, so a reload or app restart stays locked. */
  locked: boolean;
  /** Minutes without a touch or key before the till locks itself; 0 = never. */
  autoLockMinutes: number;
}

/** Per-device UI preferences (not brand settings): survive restarts, never synced. */
export const useUi = create<UiPrefs & { set: (p: Partial<UiPrefs>) => void }>()(
  persist((set) => ({ sidebarCollapsed: false, paletteOpen: false, locked: false, autoLockMinutes: 5, set }), {
    name: "lpos.ui",
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, locked: s.locked, autoLockMinutes: s.autoLockMinutes }),
  }),
);
