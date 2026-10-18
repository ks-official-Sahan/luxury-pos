import type { CreateInput, PaymentIntent, PaymentStatus } from "./types";

/** Thrown for any illegal transition or invalid amount. */
export class PaymentStateError extends Error {
  constructor(
    message: string,
    readonly from: PaymentStatus,
    readonly event: string,
  ) {
    super(message);
    this.name = "PaymentStateError";
  }
}

export type PaymentEvent =
  | { type: "authorize"; providerRef?: string }
  | { type: "require_action"; providerRef?: string }
  | { type: "capture"; amount?: number; providerRef?: string }
  | { type: "void" }
  | { type: "refund"; amount: number }
  | { type: "fail"; code: string }
  | { type: "expire" };

/** Builds a fresh `created` intent. The input idempotency key becomes the intent id. */
export function newIntent(input: CreateInput, provider: string, now: number): PaymentIntent {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new PaymentStateError("amount must be a positive integer of minor units", "created", "create");
  }
  const intent: PaymentIntent = {
    id: input.idempotencyKey,
    tenantId: input.tenantId,
    storeId: input.storeId,
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    method: input.method,
    status: "created",
    provider,
    createdAt: now,
    updatedAt: now,
    capturedAmount: 0,
    refundedAmount: 0,
    metadata: { ...input.metadata },
  };
  if (input.orderId !== undefined) intent.orderId = input.orderId;
  return intent;
}

const PRE_CAPTURE: ReadonlySet<PaymentStatus> = new Set(["created", "requires_action", "authorized"]);

/**
 * Pure state machine. Returns a NEW intent; never mutates the input.
 * Legal moves:
 *  authorize:      created|requires_action -> authorized
 *  require_action: created -> requires_action
 *  capture:        created|requires_action|authorized -> captured (amount <= intent.amount; single capture)
 *  void:           created|requires_action|authorized -> voided
 *  refund:         captured|partially_refunded -> partially_refunded|refunded (cumulative <= captured)
 *  fail:           created|requires_action|authorized -> failed
 *  expire:         created|requires_action|authorized -> expired
 * `at` stamps updatedAt; defaults to the previous updatedAt so the function stays deterministic.
 */
export function transition(intent: PaymentIntent, event: PaymentEvent, at: number = intent.updatedAt): PaymentIntent {
  const from = intent.status;
  const illegal = (why: string): never => {
    throw new PaymentStateError(`${event.type}: ${why} (status ${from})`, from, event.type);
  };
  const next = (patch: Partial<PaymentIntent>): PaymentIntent => {
    const out: PaymentIntent = { ...intent, metadata: { ...intent.metadata }, ...patch, updatedAt: at };
    if ("providerRef" in event && event.providerRef !== undefined) out.providerRef = event.providerRef;
    return out;
  };

  switch (event.type) {
    case "authorize":
      if (from !== "created" && from !== "requires_action") return illegal("cannot authorize");
      return next({ status: "authorized" });
    case "require_action":
      if (from !== "created") return illegal("cannot require action");
      return next({ status: "requires_action" });
    case "capture": {
      if (!PRE_CAPTURE.has(from)) return illegal("cannot capture");
      const amount = event.amount ?? intent.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0) return illegal("capture amount must be a positive integer");
      if (amount > intent.amount) return illegal(`capture ${amount} exceeds authorized ${intent.amount}`);
      return next({ status: "captured", capturedAmount: amount });
    }
    case "void":
      if (!PRE_CAPTURE.has(from)) return illegal("cannot void");
      return next({ status: "voided" });
    case "refund": {
      if (from !== "captured" && from !== "partially_refunded") return illegal("cannot refund before capture");
      if (!Number.isSafeInteger(event.amount) || event.amount <= 0) return illegal("refund amount must be a positive integer");
      const total = intent.refundedAmount + event.amount;
      if (total > intent.capturedAmount) {
        return illegal(`refund total ${total} exceeds captured ${intent.capturedAmount}`);
      }
      return next({
        refundedAmount: total,
        status: total === intent.capturedAmount ? "refunded" : "partially_refunded",
      });
    }
    case "fail":
      if (!PRE_CAPTURE.has(from)) return illegal("cannot fail");
      return next({ status: "failed", failureCode: event.code });
    case "expire":
      if (!PRE_CAPTURE.has(from)) return illegal("cannot expire");
      return next({ status: "expired" });
  }
}
