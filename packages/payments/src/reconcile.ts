import type { PaymentIntent, PaymentMethod } from "./types";

export interface SettlementLine {
  providerRef: string;
  /** Gross settled amount in minor units. */
  amount: number;
  currency: string;
  settledAt: number;
}

export interface ReconcileOptions {
  /** Max |settledAt - intent.createdAt|. Default 7 days. */
  windowMs?: number;
  /** Methods with no external settlement. Default ["cash"]. */
  skipMethods?: PaymentMethod[];
}

export interface AmountMismatch {
  intent: PaymentIntent;
  line: SettlementLine;
  reason: "amount" | "currency";
}

export interface ReconcileResult {
  matched: Array<{ intent: PaymentIntent; line: SettlementLine }>;
  missingInSettlement: PaymentIntent[];
  unexpected: SettlementLine[];
  amountMismatches: AmountMismatch[];
}

const DAY = 86_400_000;

/**
 * Matches captured intents to provider settlement lines by providerRef, then checks currency, amount
 * (intent.capturedAmount) and date window. Each line is consumed at most once. A line outside the window
 * is treated as not matching (intent missing, line unexpected). Intents with nothing captured are ignored.
 */
export function reconcile(
  intents: readonly PaymentIntent[],
  lines: readonly SettlementLine[],
  opts: ReconcileOptions = {},
): ReconcileResult {
  const windowMs = opts.windowMs ?? 7 * DAY;
  const skip = new Set<PaymentMethod>(opts.skipMethods ?? ["cash"]);
  const byRef = new Map<string, SettlementLine[]>();
  for (const l of lines) {
    const arr = byRef.get(l.providerRef);
    if (arr) arr.push(l);
    else byRef.set(l.providerRef, [l]);
  }
  const used = new Set<SettlementLine>();
  const out: ReconcileResult = { matched: [], missingInSettlement: [], unexpected: [], amountMismatches: [] };

  for (const intent of intents) {
    if (intent.capturedAmount <= 0 || skip.has(intent.method)) continue;
    const candidates = (intent.providerRef ? byRef.get(intent.providerRef) : undefined)?.filter(
      (l) => !used.has(l) && Math.abs(l.settledAt - intent.createdAt) <= windowMs,
    );
    const line = candidates?.find((l) => l.currency.toUpperCase() === intent.currency && l.amount === intent.capturedAmount) ?? candidates?.[0];
    if (!line) {
      out.missingInSettlement.push(intent);
      continue;
    }
    used.add(line);
    if (line.currency.toUpperCase() !== intent.currency) out.amountMismatches.push({ intent, line, reason: "currency" });
    else if (line.amount !== intent.capturedAmount) out.amountMismatches.push({ intent, line, reason: "amount" });
    else out.matched.push({ intent, line });
  }
  for (const l of lines) if (!used.has(l)) out.unexpected.push(l);
  return out;
}
