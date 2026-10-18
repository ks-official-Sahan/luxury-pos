import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CatalogItem } from "@/state/cart";
import { MIN_STOCK_QUERY, type LowStockRow } from "./model";

export function useLowStock(storeId: string | null) {
  const sid = storeId ?? "";
  return useQuery({
    queryKey: ["low-stock", sid],
    queryFn: ({ signal }) => api<LowStockRow[]>(`/stores/${encodeURIComponent(sid)}/low-stock`, { signal }),
    enabled: sid !== "",
    staleTime: 30_000,
  });
}

/** Catalog search with on-hand counts for one store. Keyed under "catalog" so writes invalidate it with the register's cache. */
export function useStockSearch(storeId: string | null, term: string) {
  const sid = storeId ?? "";
  const q = term.trim();
  const active = sid !== "" && q.length >= MIN_STOCK_QUERY;
  return useQuery({
    queryKey: ["catalog", "stock", sid, q],
    queryFn: ({ signal }) => api<CatalogItem[]>(`/catalog/search?${new URLSearchParams({ q, storeId: sid, limit: "20" })}`, { signal }),
    enabled: active,
    placeholderData: (prev) => (active ? prev : undefined),
    staleTime: 30_000,
  });
}
