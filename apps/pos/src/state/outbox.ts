import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, ApiRequestError } from "../lib/api";

/**
 * Offline-first sales. Every write carries a client UUIDv7 that the server treats
 * as an idempotency key, so a sale queued offline can be replayed any number of
 * times and is booked exactly once. Retries back off; permanent refusals are kept
 * for a manager to resolve rather than silently dropped.
 */
export interface OutboxItem {
  id: string;
  path: string;
  body: unknown;
  label: string;
  attempts: number;
  nextAt: number;
  error?: { code: string; message: string; permanent: boolean };
  createdAt: number;
}

interface OutboxState {
  items: OutboxItem[];
  flushing: boolean;
  enqueue: (item: Pick<OutboxItem, "id" | "path" | "body" | "label">) => void;
  discard: (id: string) => void;
  flush: () => Promise<void>;
}

export const useOutbox = create<OutboxState>()(
  persist(
    (set, get) => ({
      items: [],
      flushing: false,
      enqueue: (item) => set((s) => (s.items.some((i) => i.id === item.id) ? s : { items: [...s.items, { ...item, attempts: 0, nextAt: 0, createdAt: Date.now() }] })),
      discard: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      flush: async () => {
        if (get().flushing) return;
        set({ flushing: true });
        try {
          // Oldest first: stock and receipts replay in the order they happened.
          for (const item of [...get().items].sort((a, b) => a.createdAt - b.createdAt)) {
            if (item.error?.permanent || item.nextAt > Date.now()) continue;
            try {
              await api(item.path, { method: "POST", json: item.body });
              set((s) => ({ items: s.items.filter((i) => i.id !== item.id) }));
            } catch (err) {
              const e = err instanceof ApiRequestError ? err : new ApiRequestError(0, "unknown", String(err));
              const attempts = item.attempts + 1;
              const patch: Partial<OutboxItem> = e.retryable
                ? { attempts, nextAt: Date.now() + Math.min(2 ** attempts * 1_000, 5 * 60_000), error: { code: e.code, message: e.message, permanent: false } }
                : { attempts, error: { code: e.code, message: e.message, permanent: true } };
              set((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)) }));
              if (e.status === 0) break; // still offline: stop for now
            }
          }
        } finally {
          set({ flushing: false });
        }
      },
    }),
    { name: "lpos.outbox", storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ items: s.items }) },
  ),
);
