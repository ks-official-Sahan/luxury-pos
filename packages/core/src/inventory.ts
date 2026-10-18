import { roundHalfEven, type Minor } from "./money";

/**
 * Stock is a ledger: every change is an immutable movement; on-hand is the sum.
 * A cached `stock_levels` row is updated in the same transaction as each movement.
 */
export type MovementType =
  | "receive" // purchase order receipt (+)
  | "sale" // (-)
  | "return" // customer return to sellable stock (+)
  | "transfer_out" // (-)
  | "transfer_in" // (+)
  | "adjust" // cycle count / damage / shrink (±)
  | "consign_in" // consignment received (+), cost owned by consignor
  | "consign_out"; // returned to consignor (-)

const SIGN: Record<MovementType, 1 | -1 | 0> = {
  receive: 1,
  sale: -1,
  return: 1,
  transfer_out: -1,
  transfer_in: 1,
  adjust: 0,
  consign_in: 1,
  consign_out: -1,
};

/** Signed quantity for a movement; `adjust` carries its own sign. */
export function signedQuantity(type: MovementType, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity === 0) throw new RangeError("movement quantity must be a non-zero integer");
  const sign = SIGN[type];
  if (sign === 0) return quantity;
  if (quantity < 0) throw new RangeError(`${type} quantity must be positive`);
  return sign * quantity;
}

export interface StockLevel {
  onHand: number;
  reserved: number;
}

export function available(level: StockLevel): number {
  return level.onHand - level.reserved;
}

/** Weighted-average unit cost after receiving `qty` at `unitCost`. */
export function weightedAverageCost(current: { onHand: number; avgCost: Minor }, qty: number, unitCost: Minor): Minor {
  const base = Math.max(current.onHand, 0);
  if (base + qty <= 0) return unitCost;
  return roundHalfEven((base * current.avgCost + qty * unitCost) / (base + qty));
}

export interface ReorderInput {
  available: number;
  /** Average units sold per day over the lookback window. */
  dailyVelocity: number;
  leadTimeDays: number;
  safetyDays: number;
  /** Supplier pack size; suggestions round up to it. */
  packSize?: number;
  maxStock?: number;
}

/** Reorder point = velocity × (lead + safety). Suggest enough to cover one more cycle. */
export function reorderSuggestion(input: ReorderInput): { reorderPoint: number; suggest: number } {
  const reorderPoint = Math.ceil(input.dailyVelocity * (input.leadTimeDays + input.safetyDays));
  if (input.available > reorderPoint) return { reorderPoint, suggest: 0 };
  const target = Math.min(input.maxStock ?? Infinity, reorderPoint * 2);
  let suggest = Math.max(0, Math.ceil(target - input.available));
  const pack = input.packSize ?? 1;
  if (pack > 1) suggest = Math.ceil(suggest / pack) * pack;
  return { reorderPoint, suggest };
}
