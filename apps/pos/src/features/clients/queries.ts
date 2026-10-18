import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MIN_CLIENT_QUERY, type ClientProfile, type ClientSummary } from "./model";

/** Empty = recently served clients; otherwise search from two characters (the API rejects one). */
export function useClientSearch(term: string) {
  const q = term.trim();
  const active = q.length === 0 || q.length >= MIN_CLIENT_QUERY;
  return useQuery({
    queryKey: ["clients", q],
    queryFn: ({ signal }) => api<ClientSummary[]>(`/customers?${new URLSearchParams({ q })}`, { signal }),
    enabled: active,
    placeholderData: (prev) => (active ? prev : undefined),
    staleTime: 30_000,
  });
}

export function useClientProfile(id: string | null) {
  return useQuery({
    queryKey: ["client", id],
    queryFn: ({ signal }) => api<ClientProfile>(`/customers/${encodeURIComponent(id ?? "")}`, { signal }),
    enabled: !!id,
  });
}
