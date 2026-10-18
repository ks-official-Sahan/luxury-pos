import { expiryReport, parseIso } from "./lots";
import type { Lot } from "./lots";

const EPS = 1e-9;
const DAY_MS = 86_400_000;

/** Safety stock = ceil(z * demandStdDev * sqrt(leadTimeDays)), in base units. */
export function safetyStock(zScore: number, demandStdDev: number, leadTimeDays: number): number {
  if (zScore < 0 || demandStdDev < 0 || leadTimeDays < 0) throw new RangeError("negative input");
  return Math.ceil(zScore * demandStdDev * Math.sqrt(leadTimeDays) - EPS);
}

/** Reorder point = ceil(dailyDemand * leadTimeDays) + safetyStock. */
export function reorderPoint(p: { dailyDemand: number; leadTimeDays: number; safetyStock: number }): number {
  if (p.dailyDemand < 0 || p.leadTimeDays < 0 || p.safetyStock < 0) throw new RangeError("negative input");
  return Math.ceil(p.dailyDemand * p.leadTimeDays - EPS) + p.safetyStock;
}

export type ReplenishReason = "below_rop" | "expiring_soon_replace" | "stockout";

export interface ReplenishItem {
  productId: string;
  locationId?: string;
  /** Sellable base units on hand. */
  onHand: number;
  /** Base units already on purchase orders / inbound transfers. */
  onOrder: number;
  dailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  /** Supplier pack size in base units (default 1). Orders are whole packs. */
  packSize?: number;
  /** Minimum order quantity in base units (default 0). */
  minOrderQty?: number;
  /** Order-up-to level. Default: reorder point + ceil(dailyDemand * reviewDays). */
  maxStock?: number;
  /** Review/cover period used when maxStock is absent (default 0). */
  reviewDays?: number;
  /** Lots of this item/location used to detect stock that will expire before it sells. */
  lots?: Lot[];
  /** Lots expiring within this many days count as expiring (default 0 = none). */
  expiryWindowDays?: number;
}

export interface ReplenishSuggestion {
  productId: string;
  locationId?: string;
  /** Base units to order: multiple of packSize and >= minOrderQty. */
  quantity: number;
  reasons: ReplenishReason[];
  reorderPoint: number;
  /** onHand + onOrder - expiring stock. */
  position: number;
}

function expiringQty(item: ReplenishItem, now: Date): number {
  const window = item.expiryWindowDays ?? 0;
  if (!item.lots || window <= 0) return 0;
  const limit = now.getTime() + window * DAY_MS;
  let q = 0;
  for (const l of item.lots) {
    if (l.quantity <= 0 || l.status !== "available" || l.expiresAt === undefined) continue;
    const t = parseIso(l.expiresAt);
    if (t > now.getTime() && t <= limit) q += l.quantity;
  }
  return q;
}

/**
 * Suggests purchase quantities. Position = onHand + onOrder - expiring stock; an order is suggested when
 * position <= reorder point or onHand <= 0 and the order-up-to level exceeds position. Quantity is
 * max(need, minOrderQty) rounded UP to whole packs. Stockouts sort first, then by product id.
 */
export function suggestReplenishment(items: readonly ReplenishItem[], now: Date): ReplenishSuggestion[] {
  const out: ReplenishSuggestion[] = [];
  for (const it of items) {
    const pack = it.packSize ?? 1;
    if (!Number.isSafeInteger(pack) || pack < 1) throw new RangeError(`bad packSize for ${it.productId}`);
    const rop = reorderPoint(it);
    const expiring = expiringQty(it, now);
    const position = it.onHand + it.onOrder - expiring;
    const reasons: ReplenishReason[] = [];
    if (it.onHand <= 0) reasons.push("stockout");
    if (it.onHand + it.onOrder <= rop) reasons.push("below_rop");
    if (expiring > 0 && position <= rop) reasons.push("expiring_soon_replace");
    if (reasons.length === 0) continue;
    const upTo = it.maxStock ?? rop + Math.ceil(it.dailyDemand * (it.reviewDays ?? 0) - EPS);
    const need = upTo - position;
    if (need <= 0) continue;
    const qty = Math.ceil(Math.max(need, it.minOrderQty ?? 0) / pack) * pack;
    out.push({
      productId: it.productId,
      ...(it.locationId !== undefined ? { locationId: it.locationId } : {}),
      quantity: qty,
      reasons,
      reorderPoint: rop,
      position,
    });
  }
  const rank = (s: ReplenishSuggestion) => (s.reasons.includes("stockout") ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

export interface DeadStockItem {
  productId: string;
  locationId?: string;
  onHand: number;
  unitCost: number;
  receivedAt: string;
  lastSoldAt?: string;
}

export interface DeadStockResult {
  productId: string;
  locationId?: string;
  onHand: number;
  value: number;
  daysSinceSale: number;
}

/** Items with stock and no sale (or, if never sold, no receipt age) for more than `noSaleDays`. Sorted by value desc. */
export function deadStock(items: readonly DeadStockItem[], now: Date, noSaleDays: number): DeadStockResult[] {
  const out: DeadStockResult[] = [];
  for (const it of items) {
    if (it.onHand <= 0) continue;
    const since = parseIso(it.lastSoldAt ?? it.receivedAt);
    const days = Math.floor((now.getTime() - since) / DAY_MS);
    if (days > noSaleDays) {
      out.push({
        productId: it.productId,
        ...(it.locationId !== undefined ? { locationId: it.locationId } : {}),
        onHand: it.onHand,
        value: it.onHand * it.unitCost,
        daysSinceSale: days,
      });
    }
  }
  return out.sort((a, b) => b.value - a.value || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

export interface StockGapAlert {
  kind: "expired" | "stockout" | "low_stock" | "dead_stock";
  severity: "critical" | "warning" | "info";
  productId: string;
  locationId?: string;
  quantity: number;
  detail: string;
}

/** Combined alert feed: expired lots, stockouts/low stock, dead stock. Ordered critical, warning, info. */
export function stockGapAlerts(
  input: { lots: readonly Lot[]; items: readonly ReplenishItem[]; dead: readonly DeadStockItem[] },
  now: Date,
  opts: { warnDays: number; noSaleDays: number },
): StockGapAlert[] {
  const alerts: StockGapAlert[] = [];
  for (const lot of expiryReport(input.lots, now, opts.warnDays).expired) {
    alerts.push({ kind: "expired", severity: "critical", productId: lot.productId, locationId: lot.locationId, quantity: lot.quantity, detail: `lot ${lot.id} expired` });
  }
  for (const s of suggestReplenishment(input.items, now)) {
    const out = s.reasons.includes("stockout");
    alerts.push({
      kind: out ? "stockout" : "low_stock",
      severity: out ? "critical" : "warning",
      productId: s.productId,
      ...(s.locationId !== undefined ? { locationId: s.locationId } : {}),
      quantity: s.quantity,
      detail: `reorder ${s.quantity} (${s.reasons.join(", ")})`,
    });
  }
  for (const d of deadStock(input.dead, now, opts.noSaleDays)) {
    alerts.push({
      kind: "dead_stock",
      severity: "info",
      productId: d.productId,
      ...(d.locationId !== undefined ? { locationId: d.locationId } : {}),
      quantity: d.onHand,
      detail: `no sale for ${d.daysSinceSale} days`,
    });
  }
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
