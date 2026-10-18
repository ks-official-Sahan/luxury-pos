import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isoDay } from "./queries";

export type RangeKey = "today" | "7d" | "30d" | "90d";
export const RANGES: { value: RangeKey; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
];

export interface Summary {
  totals: { orders: number; items: number; gross: number; net: number; discounts: number; refunds: number; tax: number; cost: number; averageOrder: number; marginBps: number };
  series: { day: string; net: number; orders: number }[];
  byStore: { storeId: string; name: string; currency: string; net: number; orders: number }[];
}
export type TopProduct = { variantId: string; name: string; sku: string; options: Record<string, string>; quantity: number; revenue: number };
export type StaffRow = { staffId: string; name: string | null; orders: number; net: number; discounts: number; approvals: number };
export type Anomaly = { actorId: string | null; counts: Record<string, number>; flagged: boolean };

/** Current and previous period of equal length, so every number can show its change. */
export function periods(days: number, now = new Date()) {
  const day = 86_400_000;
  const from = new Date(now.getTime() - (days - 1) * day);
  const prevTo = new Date(from.getTime() - day);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * day);
  return { current: { from: isoDay(from), to: isoDay(now) }, previous: { from: isoDay(prevFrom), to: isoDay(prevTo) } };
}

/** Rollups only hold days with sales; charts need every day, with zeros. */
export function fillDays(series: { day: string; net: number }[], from: string, to: string) {
  const byDay = new Map(series.map((d) => [String(d.day).slice(0, 10), d.net]));
  const out: { x: string; y: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); isoDay(d) <= to; d = new Date(d.getTime() + 86_400_000)) out.push({ x: isoDay(d), y: byDay.get(isoDay(d)) ?? 0 });
  return out;
}

/** Report reads are rollup-backed and cheap; refresh every two minutes while a dashboard is open. */
export function useReport<T>(path: string, range: { from: string; to: string }, storeId?: string, enabled = true) {
  const qs = new URLSearchParams({ ...range, ...(storeId ? { storeId } : {}) }).toString();
  return useQuery({ queryKey: ["report", path, qs], queryFn: ({ signal }) => api<T>(`/reports/${path}?${qs}`, { signal }), enabled, staleTime: 60_000, refetchInterval: 120_000 });
}
