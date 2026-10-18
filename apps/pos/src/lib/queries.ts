import { useQuery } from "@tanstack/react-query";
import type { LoyaltyProgram, Permission, Role, TaxMode } from "@luxury-pos/core";
import type { BrandTheme } from "@luxury-pos/theme";
import { useSession } from "../state/session";
import { api } from "./api";
import type { CatalogItem } from "../state/cart";

export interface StoreInfo {
  id: string;
  code: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  taxMode: TaxMode;
  settings: { cashIncrement: number; maxDiscountBps: number };
  theme: BrandTheme;
}

export interface Bootstrap {
  tenant: { id: string; name: string; slug: string; loyalty: LoyaltyProgram | null };
  me: { userId: string; name: string | null; email: string; role: Role };
  permissions: Permission[];
  stores: StoreInfo[];
}

export function useMe(enabled = true) {
  const tenantId = useSession((s) => s.tenantId);
  return useQuery({ queryKey: ["me", tenantId], queryFn: () => api<Bootstrap>("/me"), enabled: enabled && !!tenantId, staleTime: 5 * 60_000 });
}

/** The active store (falls back to the first one the person may use). */
export function useStore(): StoreInfo | null {
  const { data } = useMe();
  const storeId = useSession((s) => s.storeId);
  return data?.stores.find((s) => s.id === storeId) ?? data?.stores[0] ?? null;
}

export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (p: Permission) => set.has(p);
}

export function useCatalogSearch(query: string) {
  const storeId = useSession((s) => s.storeId);
  return useQuery({
    queryKey: ["catalog", storeId, query],
    queryFn: ({ signal }) => api<CatalogItem[]>(`/catalog/search?${new URLSearchParams({ q: query, ...(storeId ? { storeId } : {}), limit: "60" })}`, { signal }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
