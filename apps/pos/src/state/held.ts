import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartSnapshot } from "./cart";

/**
 * Sales put aside ("Hold") while a client keeps browsing or steps out, and picked
 * up again from the ticket. Kept on this till only and survive a restart.
 */
export interface HeldSale extends CartSnapshot {
  id: string;
  at: number;
  storeId: string;
}

interface HeldState {
  items: HeldSale[];
  hold: (sale: HeldSale) => void;
  take: (id: string) => HeldSale | undefined;
}

export const useHeld = create<HeldState>()(
  persist(
    (set, get) => ({
      items: [],
      hold: (sale) => set((s) => ({ items: [sale, ...s.items].slice(0, 20) })),
      take: (id) => {
        const sale = get().items.find((i) => i.id === id);
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
        return sale;
      },
    }),
    { name: "lpos.held", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
