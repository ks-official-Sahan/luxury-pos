import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Per-device UI preferences (not brand settings): survive restarts, never synced. */
export const useUi = create<{ sidebarCollapsed: boolean; paletteOpen: boolean; set: (p: Partial<{ sidebarCollapsed: boolean; paletteOpen: boolean }>) => void }>()(
  persist((set) => ({ sidebarCollapsed: false, paletteOpen: false, set }), {
    name: "lpos.ui",
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
  }),
);
