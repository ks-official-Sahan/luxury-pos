import { divRound } from "./units";

export type LotStatus = "available" | "quarantine" | "expired" | "recalled";

/** A batch of one product at one location. Quantity is integer base units; costs/prices integer minor units per base unit. */
export interface Lot {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  unitCost: number;
  unitPrice?: number;
  receivedAt: string;
  expiresAt?: string;
  status: LotStatus;
}

export type AllocStrategy = "FEFO" | "FIFO" | "LIFO" | "SPECIFIC";

export interface AllocOptions {
  strategy: AllocStrategy;
  now: Date;
  /** When true, lots past expiry (or status "expired") may be picked. Quarantine and recalled never are. */
  allowExpired?: boolean;
  /** Required order and filter for SPECIFIC; ignored otherwise. */
  lotIds?: string[];
  locationId?: string;
}

export interface LotPick {
  lotId: string;
  quantity: number;
  unitCost: number;
}

export interface Allocation {
  picks: LotPick[];
  cost: number;
  shortfall: number;
}

/** Parses an ISO date/time string; throws on invalid input. */
export function parseIso(s: string): number {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new RangeError(`invalid date: ${s}`);
  return t;
}

/** A lot is past expiry when expiresAt <= now (expiry instant is exclusive). */
export function isPastExpiry(lot: Lot, now: Date): boolean {
  return lot.expiresAt !== undefined && parseIso(lot.expiresAt) <= now.getTime();
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function eligible(lot: Lot, o: AllocOptions): boolean {
  if (lot.quantity <= 0) return false;
  if (o.locationId !== undefined && lot.locationId !== o.locationId) return false;
  if (lot.status === "quarantine" || lot.status === "recalled") return false;
  const expired = lot.status === "expired" || isPastExpiry(lot, o.now);
  return !expired || o.allowExpired === true;
}

function order(lots: Lot[], o: AllocOptions): Lot[] {
  if (o.strategy === "SPECIFIC") {
    const ids = o.lotIds ?? [];
    const byId = new Map(lots.map((l) => [l.id, l]));
    const out: Lot[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const l = byId.get(id);
      if (l && !seen.has(id)) {
        seen.add(id);
        out.push(l);
      }
    }
    return out;
  }
  const recv = (l: Lot) => parseIso(l.receivedAt);
  const fifo = (a: Lot, b: Lot) => recv(a) - recv(b) || cmpStr(a.id, b.id);
  const copy = [...lots];
  if (o.strategy === "FIFO") return copy.sort(fifo);
  if (o.strategy === "LIFO") return copy.sort((a, b) => recv(b) - recv(a) || cmpStr(a.id, b.id));
  return copy.sort((a, b) => {
    const ea = a.expiresAt === undefined ? Infinity : parseIso(a.expiresAt);
    const eb = b.expiresAt === undefined ? Infinity : parseIso(b.expiresAt);
    if (ea !== eb) return ea < eb ? -1 : 1;
    return fifo(a, b);
  });
}

/**
 * Allocates `qty` base units from lots. Deterministic: ties break by lot id.
 * FEFO = earliest expiry first (no expiry last), then FIFO. Quarantine/recalled lots are never picked;
 * expired lots only with allowExpired. `shortfall` is the unfilled remainder (>= 0). Input is not mutated.
 */
export function allocate(lots: readonly Lot[], qty: number, o: AllocOptions): Allocation {
  if (!Number.isSafeInteger(qty) || qty < 0) throw new RangeError("qty must be a non-negative integer");
  const picks: LotPick[] = [];
  let need = qty;
  let cost = 0;
  for (const lot of order(lots.filter((l) => eligible(l, o)), o)) {
    if (need === 0) break;
    const take = Math.min(need, lot.quantity);
    picks.push({ lotId: lot.id, quantity: take, unitCost: lot.unitCost });
    cost += take * lot.unitCost;
    need -= take;
  }
  return { picks, cost, shortfall: need };
}

/** Returns new lots with pick quantities deducted. Throws on unknown lot or over-pick. Zero-quantity lots are kept. */
export function applyPicks(lots: readonly Lot[], picks: readonly LotPick[]): Lot[] {
  const taken = new Map<string, number>();
  for (const p of picks) taken.set(p.lotId, (taken.get(p.lotId) ?? 0) + p.quantity);
  const ids = new Set(lots.map((l) => l.id));
  for (const id of taken.keys()) if (!ids.has(id)) throw new RangeError(`unknown lot ${id}`);
  return lots.map((l) => {
    const t = taken.get(l.id);
    if (t === undefined) return { ...l };
    if (t > l.quantity) throw new RangeError(`pick of ${t} exceeds lot ${l.id} quantity ${l.quantity}`);
    return { ...l, quantity: l.quantity - t };
  });
}

export type ValuationMethod = "FIFO" | "WEIGHTED_AVERAGE";

export interface Valuation {
  quantity: number;
  value: number;
  /** Average unit cost, banker's rounded. */
  averageCost: number;
}

/**
 * On-hand valuation. FIFO values each lot at its own cost (exact). WEIGHTED_AVERAGE values the stock at the
 * banker's-rounded average unit cost times quantity, so it can differ from FIFO by rounding.
 */
export function valuation(lots: readonly Lot[], method: ValuationMethod): Valuation {
  let quantity = 0;
  let total = 0;
  for (const l of lots) {
    quantity += l.quantity;
    total += l.quantity * l.unitCost;
  }
  const averageCost = quantity === 0 ? 0 : divRound(total, quantity);
  return { quantity, value: method === "FIFO" ? total : averageCost * quantity, averageCost };
}

/**
 * Cost of goods sold for `qty` units. FIFO consumes oldest received lots (id tie-break);
 * WEIGHTED_AVERAGE is banker's-rounded qty * total cost / total quantity. Status is ignored: pass eligible lots.
 */
export function cogs(
  lots: readonly Lot[],
  qty: number,
  method: ValuationMethod,
): { cost: number; shortfall: number } {
  if (!Number.isSafeInteger(qty) || qty < 0) throw new RangeError("qty must be a non-negative integer");
  const live = lots.filter((l) => l.quantity > 0);
  const onHand = live.reduce((s, l) => s + l.quantity, 0);
  const sold = Math.min(qty, onHand);
  const shortfall = qty - sold;
  if (method === "WEIGHTED_AVERAGE") {
    const total = live.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    return { cost: onHand === 0 ? 0 : divRound(sold * total, onHand), shortfall };
  }
  const sorted = [...live].sort((a, b) => parseIso(a.receivedAt) - parseIso(b.receivedAt) || cmpStr(a.id, b.id));
  let need = sold;
  let cost = 0;
  for (const l of sorted) {
    if (need === 0) break;
    const take = Math.min(need, l.quantity);
    cost += take * l.unitCost;
    need -= take;
  }
  return { cost, shortfall };
}

export interface ExpiryReport {
  expired: Lot[];
  expiringSoon: { lot: Lot; daysLeft: number }[];
  fine: Lot[];
}

const DAY_MS = 86_400_000;

/**
 * Buckets lots with stock. expired: status "expired" or expiresAt <= now. expiringSoon: daysLeft (ceil) <= warnDays,
 * sorted soonest first. Everything else (including no expiry) is fine.
 */
export function expiryReport(lots: readonly Lot[], now: Date, warnDays: number): ExpiryReport {
  const expired: Lot[] = [];
  const expiringSoon: { lot: Lot; daysLeft: number }[] = [];
  const fine: Lot[] = [];
  for (const lot of lots) {
    if (lot.quantity <= 0) continue;
    if (lot.status === "expired" || isPastExpiry(lot, now)) {
      expired.push(lot);
    } else if (lot.expiresAt !== undefined) {
      const daysLeft = Math.ceil((parseIso(lot.expiresAt) - now.getTime()) / DAY_MS);
      if (daysLeft <= warnDays) expiringSoon.push({ lot, daysLeft });
      else fine.push(lot);
    } else {
      fine.push(lot);
    }
  }
  expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft || cmpStr(a.lot.id, b.lot.id));
  return { expired, expiringSoon, fine };
}

/** Returns new lots where "available" lots past expiry become "expired". Other statuses are untouched. */
export function markExpired(lots: readonly Lot[], now: Date): Lot[] {
  return lots.map((l) => (l.status === "available" && isPastExpiry(l, now) ? { ...l, status: "expired" } : { ...l }));
}

export interface PricedPick {
  lotId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Sale lines for picks: lot.unitPrice when set, else `defaultUnitPrice` (mixed-price stock). Total is the line sum. */
export function pricedPicks(
  lots: readonly Lot[],
  picks: readonly LotPick[],
  defaultUnitPrice: number,
): { lines: PricedPick[]; total: number } {
  const byId = new Map(lots.map((l) => [l.id, l]));
  let total = 0;
  const lines = picks.map((p) => {
    const lot = byId.get(p.lotId);
    if (!lot) throw new RangeError(`unknown lot ${p.lotId}`);
    const unitPrice = lot.unitPrice ?? defaultUnitPrice;
    const lineTotal = unitPrice * p.quantity;
    total += lineTotal;
    return { lotId: p.lotId, quantity: p.quantity, unitPrice, lineTotal };
  });
  return { lines, total };
}
