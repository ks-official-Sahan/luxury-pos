import { roundToIncrement, type Minor } from "./money";

export type TenderMethod = "cash" | "card" | "gift_card" | "store_credit" | "loyalty_points" | "bank_transfer" | "other";

export interface Tender {
  method: TenderMethod;
  amount: Minor;
  /** Processor or voucher reference; never a card number. */
  reference?: string;
}

export interface Settlement {
  due: Minor;
  paid: Minor;
  /** Remaining balance; 0 when settled. */
  balance: Minor;
  changeDue: Minor;
  /** Difference introduced by cash rounding (positive = customer pays more). */
  rounding: Minor;
  settled: boolean;
}

/**
 * Applies tenders in order. Only cash can over-tender (change is given);
 * any other method is capped at the remaining balance. Cash rounding applies
 * when the final balance is settled in cash.
 */
export function settle(total: Minor, tenders: readonly Tender[], cashIncrement = 1): Settlement {
  let remaining = total;
  let paid = 0;
  let changeDue = 0;
  let rounding = 0;
  for (const tender of tenders) {
    if (!Number.isSafeInteger(tender.amount) || tender.amount <= 0) throw new RangeError("tender amount must be a positive integer");
    if (tender.method === "cash") {
      const roundedDue = roundToIncrement(remaining, cashIncrement);
      if (tender.amount >= roundedDue) {
        rounding += roundedDue - remaining;
        changeDue += tender.amount - roundedDue;
        paid += roundedDue;
        remaining = 0;
        continue;
      }
      paid += tender.amount;
      remaining -= tender.amount;
      continue;
    }
    if (tender.amount > remaining) throw new RangeError(`${tender.method} tender exceeds the balance`);
    paid += tender.amount;
    remaining -= tender.amount;
  }
  return { due: total + rounding, paid, balance: remaining, changeDue, rounding, settled: remaining <= 0 };
}
