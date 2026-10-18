/**
 * Core payment types. Invariants:
 * - All amounts are integer minor units (never floats).
 * - No PAN/CVV/track data ever appears here: only tokens, terminal refs, last4/brand metadata.
 * - `PaymentIntent.id` is a client-generated UUID and doubles as the idempotency key.
 */

export type PaymentMethod =
  | "cash"
  | "card_present"
  | "card_online"
  | "qr"
  | "bank_transfer"
  | "wallet"
  | "gift_card"
  | "store_credit"
  | "pay_later";

export type PaymentStatus =
  | "created"
  | "requires_action"
  | "authorized"
  | "captured"
  | "partially_refunded"
  | "refunded"
  | "voided"
  | "failed"
  | "expired";

export interface PaymentIntent {
  /** Client UUID; the idempotency key for every provider call about this intent. */
  id: string;
  tenantId: string;
  storeId: string;
  orderId?: string;
  /** Authorized/target amount in minor units. */
  amount: number;
  /** ISO 4217 alphabetic code, upper case. */
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /** Adapter id that owns this intent. */
  provider: string;
  providerRef?: string;
  createdAt: number;
  updatedAt: number;
  /** Minor units captured so far. Invariant: 0 <= refundedAmount <= capturedAmount <= amount. */
  capturedAmount: number;
  refundedAmount: number;
  failureCode?: string;
  metadata: Record<string, string>;
}

/** Input to create a payment at an adapter. `idempotencyKey` is the intent id. */
export interface CreateInput {
  idempotencyKey: string;
  tenantId: string;
  storeId: string;
  orderId?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  /** Opaque provider token (e.g. Stripe payment method id). Never a PAN. */
  paymentToken?: string;
  /** Terminal/reader reference for card-present flows. */
  terminalRef?: string;
  /** "manual" authorizes only; capture happens later. Default "automatic". */
  captureMethod?: "automatic" | "manual";
  metadata: Record<string, string>;
}
