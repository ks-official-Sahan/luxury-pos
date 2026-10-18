import type { PaymentMethod } from "./types";

export interface SplitPartInput {
  method: PaymentMethod;
  /** Omit on at most one, final part to take the remainder. */
  amount?: number;
}

export interface SplitAllocation {
  method: PaymentMethod;
  /** Amount applied to the order (after change is removed). */
  amount: number;
  /** Cash only: amount handed over by the customer. */
  tendered?: number;
}

export interface SplitPlan {
  allocations: SplitAllocation[];
  /** Cash change owed; 0 unless cash was over-tendered. */
  change: number;
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

const isMinor = (n: number): boolean => Number.isSafeInteger(n) && n > 0;

/**
 * Plans a split tender. Rules: total and amounts are positive integers; only the LAST part may omit
 * `amount` (takes the remainder, which must be > 0); parts must sum to total, except that cash may exceed
 * it, with the excess returned as change and never more than the cash tendered.
 */
export function planSplit(total: number, parts: readonly SplitPartInput[]): SplitPlan {
  if (!isMinor(total)) throw new SplitError("total must be a positive integer");
  if (parts.length === 0) throw new SplitError("at least one part required");
  let sum = 0;
  const resolved: Array<{ method: PaymentMethod; amount: number | undefined }> = [];
  parts.forEach((p, i) => {
    if (p.amount === undefined) {
      if (i !== parts.length - 1) throw new SplitError("only the last part may omit amount");
    } else if (!isMinor(p.amount)) {
      throw new SplitError(`part ${i} amount must be a positive integer`);
    } else sum += p.amount;
    resolved.push({ method: p.method, amount: p.amount });
  });
  const last = resolved[resolved.length - 1];
  if (last && last.amount === undefined) {
    const remainder = total - sum;
    if (remainder <= 0) throw new SplitError("no remainder left for final part");
    last.amount = remainder;
    sum = total;
  }
  if (sum < total) throw new SplitError(`parts sum ${sum} is less than total ${total}`);
  const allocations: SplitAllocation[] = resolved.map((r) => ({ method: r.method, amount: r.amount ?? 0 }));
  let change = sum - total;
  if (change > 0) {
    const cashTendered = allocations.filter((a) => a.method === "cash").reduce((s, a) => s + a.amount, 0);
    if (change > cashTendered) throw new SplitError("overpayment must be covered by cash tendered");
    let left = change;
    for (let i = allocations.length - 1; i >= 0 && left > 0; i--) {
      const a = allocations[i];
      if (!a || a.method !== "cash") continue;
      a.tendered = a.amount;
      const cut = Math.min(a.amount, left);
      a.amount -= cut;
      left -= cut;
    }
    // A cash part fully absorbed by change would allocate 0; drop it from the plan.
    change = sum - total;
    return { allocations: allocations.filter((a) => a.amount > 0), change };
  }
  return { allocations, change: 0 };
}
