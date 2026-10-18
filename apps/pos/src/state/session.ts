import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Which business, store and till this device works for. Survives restarts; cleared on sign-out. */
interface SessionState {
  tenantId: string | null;
  storeId: string | null;
  deviceId: string | null;
  drawerSessionId: string | null;
  set: (patch: Partial<Omit<SessionState, "set" | "clear">>) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      tenantId: null,
      storeId: null,
      deviceId: null,
      drawerSessionId: null,
      set: (patch) => set(patch),
      clear: () => set({ tenantId: null, storeId: null, drawerSessionId: null }),
    }),
    { name: "lpos.session", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
