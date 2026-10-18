import { parseMoney, uuidv7 } from "@luxury-pos/core";
import type { MutableRefObject } from "react";
import type { CatalogItem } from "@/state/cart";

export const MIN_STOCK_QUERY = 2;

/** One row of GET /stores/:storeId/low-stock. `suggest` is the server's reorder suggestion. */
export interface LowStockRow {
  variantId: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  onHand: number;
  available: number;
  reorderPoint: number;
  sold28: number;
  suggest: number;
}

/** What the adjust and transfer sheets need, from a catalog hit or a low-stock row. */
export interface StockTarget {
  variantId: string;
  name: string;
  sku: string;
  options: Record<string, string>;
  available: number;
}

export const targetFromItem = (i: CatalogItem): StockTarget => ({ variantId: i.variantId, name: i.name, sku: i.sku, options: i.options, available: i.available ?? 0 });
export const targetFromRow = (r: LowStockRow): StockTarget => ({ variantId: r.variantId, name: r.name, sku: r.sku, options: r.options, available: r.available });

export function optionsCaption(options: Record<string, string>, sku: string): string {
  return [...Object.values(options), sku].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------ adjustments */

/** The three things a person does to stock. Only `receive` is additive by intent; the API stores `count` and `damage` as `adjust`. */
export type AdjustMode = "receive" | "count" | "damage";

export const ADJUST_LABEL: Record<AdjustMode, string> = {
  receive: "Receive",
  count: "Count correction",
  damage: "Damage or shrink",
};

export const ADJUST_HINT: Record<AdjustMode, string> = {
  receive: "Adds stock that arrived. Enter the units received.",
  count: "Changes stock by the difference found in a count. Use + or -.",
  damage: "Removes stock that is broken, lost or missing. The reason is recorded with the change.",
};

export const ADJUST_SUBMIT: Record<AdjustMode, string> = {
  receive: "Receive stock",
  count: "Save count",
  damage: "Record write-off",
};

const REASON_PLACEHOLDER: Record<AdjustMode, string> = {
  receive: "Supplier delivery note",
  count: "Cycle count",
  damage: "Broken clasp, lost in transit",
};

export function reasonPlaceholder(mode: AdjustMode): string {
  return REASON_PLACEHOLDER[mode];
}

/** Whole number with an optional sign. Anything else (decimals, words, empty) is null. */
export function parseQuantity(text: string): number | null {
  const s = text.trim();
  return /^[+-]?\d{1,6}$/.test(s) ? Number(s) : null;
}

/** Stepper: moves by one; a count correction skips zero, other modes never go below one. */
export function stepQuantity(text: string, delta: 1 | -1, mode: AdjustMode): string {
  let next = (parseQuantity(text) ?? 0) + delta;
  if (mode === "count") {
    if (next === 0) next = delta;
  } else {
    next = Math.max(1, next);
  }
  return String(next);
}

export type AdjustField = "quantity" | "unitCost" | "reason";

export interface AdjustPlan {
  type: "receive" | "adjust";
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  /** Minor units of the store currency. */
  unitCost?: number;
  reason?: string;
}

export type AdjustResult = { ok: true; plan: AdjustPlan } | { ok: false; errors: Partial<Record<AdjustField, string>> };

export interface AdjustInput {
  mode: AdjustMode;
  quantity: string;
  unitCost: string;
  reason: string;
  currency: string;
  available: number;
}

/** Turns the form into the exact movement the API expects. Pure, so it can be tested without the UI. */
export function planAdjust(input: AdjustInput): AdjustResult {
  const errors: Partial<Record<AdjustField, string>> = {};
  const reason = input.reason.trim();
  const n = parseQuantity(input.quantity);
  let quantity = 0;

  if (n === null) {
    errors.quantity = "Enter a whole number.";
  } else if (input.mode === "receive") {
    if (n > 0) quantity = n;
    else errors.quantity = "Enter how many units arrived.";
  } else if (input.mode === "damage") {
    const max = Math.max(0, input.available);
    if (n <= 0) errors.quantity = "Enter how many units were damaged or lost.";
    else if (n > max) errors.quantity = `Only ${max} available to write off.`;
    else quantity = -n;
  } else if (n === 0) {
    errors.quantity = "Enter a change such as 2 or -1.";
  } else {
    quantity = n;
  }

  let unitCost: number | undefined;
  if (input.mode === "receive" && input.unitCost.trim()) {
    const parsed = parseMoney(input.unitCost, input.currency);
    if (parsed === null || parsed < 0) errors.unitCost = "Enter a price, for example 12.50.";
    else unitCost = parsed;
  }

  if (input.mode !== "receive" && reason.length < 2) {
    errors.reason = input.mode === "damage" ? "Say what happened, for example broken clasp." : "Add a reason, for example cycle count.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, plan: { type: input.mode === "receive" ? "receive" : "adjust", quantity, unitCost, reason: reason || undefined } };
}

/* ------------------------------------------------------------ idempotency */

export interface IdempotencyKey {
  key: string;
  id: string;
}

/**
 * Same payload, same id: a retry after a dropped response replays on the server instead of
 * double-counting. A changed payload gets a fresh id, so a corrected entry is never swallowed.
 */
export function idempotentId(ref: MutableRefObject<IdempotencyKey | null>, payload: unknown): string {
  const key = JSON.stringify(payload);
  const current = ref.current;
  if (current && current.key === key) return current.id;
  const next = { key, id: uuidv7() };
  ref.current = next;
  return next.id;
}
