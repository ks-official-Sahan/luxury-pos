import type { Plan } from "./catalog";
import type { Subscription } from "./subscription";

export interface UsageEvent { tenantId: string; storeId?: string; meter: string; quantity: number; at: string }

export type UsageTotals = Record<string, number>;

/** Sums quantities per meter for events with periodStart <= at < periodEnd (half open). */
export function aggregateUsage(events: readonly UsageEvent[], periodStart: Date, periodEnd: Date): UsageTotals {
  const s = periodStart.getTime();
  const e = periodEnd.getTime();
  const out: UsageTotals = {};
  for (const ev of events) {
    const t = Date.parse(ev.at);
    if (t < s || t >= e) continue;
    out[ev.meter] = (out[ev.meter] ?? 0) + ev.quantity;
  }
  return out;
}

export interface LineItem { meter: string; quantity: number; unitPriceMinor: number; amountMinor: number }

/** One line per metered usage that has a PAYG price. Nothing is charged when PAYG is disabled. Integer minor units. */
export function paygCharges(sub: Subscription, usage: UsageTotals): LineItem[] {
  if (!sub.payg?.enabled) return [];
  const items: LineItem[] = [];
  for (const meter of Object.keys(usage).sort()) {
    const price = sub.payg.meters[meter];
    const quantity = usage[meter] ?? 0;
    if (!price || quantity <= 0) continue;
    items.push({ meter, quantity, unitPriceMinor: price.unitPriceMinor, amountMinor: quantity * price.unitPriceMinor });
  }
  return items;
}

export interface Proration {
  /** Credit for the unused part of the old plan (positive integer). */
  creditMinor: number;
  /** Charge for the remaining part of the new plan. */
  chargeMinor: number;
  /** charge - credit; negative means the tenant is owed money. */
  netMinor: number;
  daysRemaining: number;
  daysInPeriod: number;
}

const DAY_MS = 86_400_000;

/**
 * Day-based proration. Remaining days = ceil((periodEnd - changeAt) / day), clamped to [0, total].
 * credit = floor(price * remaining / total) using integer math; credit floors and charge ceils so rounding never favours the tenant.
 */
export function prorate(oldPlan: Plan, newPlan: Plan, periodStart: Date, periodEnd: Date, changeAt: Date): Proration {
  const total = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS));
  const rem = Math.min(total, Math.max(0, Math.ceil((periodEnd.getTime() - changeAt.getTime()) / DAY_MS)));
  const creditMinor = Math.floor((oldPlan.priceMinor * rem) / total);
  const chargeMinor = Math.ceil((newPlan.priceMinor * rem) / total);
  return { creditMinor, chargeMinor, netMinor: chargeMinor - creditMinor, daysRemaining: rem, daysInPeriod: total };
}
