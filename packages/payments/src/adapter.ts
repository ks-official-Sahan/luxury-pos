import type { CreateInput, PaymentMethod } from "./types";

export type AdapterStatus = "authorized" | "captured" | "requires_action" | "voided" | "failed";

export interface AdapterAction {
  kind: "qr" | "redirect" | "terminal";
  payload: string;
}

export interface AdapterResult {
  status: AdapterStatus;
  providerRef?: string;
  action?: AdapterAction;
  /** Provider decline/failure code. A `failed` result is a business outcome and never triggers failover. */
  failureCode?: string;
  /** Non-sensitive extras (last4, brand, approval code). */
  metadata?: Record<string, string>;
}

export interface RefundResult {
  status: "succeeded" | "pending" | "failed";
  providerRef?: string;
  failureCode?: string;
}

export type WebhookEventType = "authorized" | "captured" | "failed" | "voided" | "refunded";

export interface WebhookEvent {
  /** Provider event id, for de-duplication by the caller. */
  eventId: string;
  type: WebhookEventType;
  providerRef: string;
  amount?: number;
  currency?: string;
}

/**
 * Gateway adapter contract. Invariants:
 * - Every mutating call receives an idempotency key and must forward it to the provider.
 * - Declines resolve as `{status:"failed"}`; infrastructure faults throw `AdapterError`.
 * - Adapters never read process.env and never see card data.
 */
export interface PaymentAdapter {
  id: string;
  methods: PaymentMethod[];
  supportsCurrency(currency: string): boolean;
  create(input: CreateInput): Promise<AdapterResult>;
  capture?(ref: string, amount: number, idempotencyKey: string): Promise<AdapterResult>;
  void?(ref: string, idempotencyKey: string): Promise<AdapterResult>;
  refund(ref: string, amount: number, idempotencyKey: string): Promise<RefundResult>;
  status?(ref: string): Promise<AdapterResult>;
  /** Returns null for ignored event types; throws WebhookVerificationError on bad signature. */
  verifyWebhook?(rawBody: string, headers: Record<string, string>): Promise<WebhookEvent | null>;
}

export type AdapterErrorKind =
  | "network"
  | "timeout"
  | "server"
  | "rate_limited"
  | "auth"
  | "invalid_request"
  | "unsupported";

/** Infrastructure fault from an adapter. network/timeout/server/rate_limited are retryable. */
export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.kind === "server" || this.kind === "rate_limited";
  }
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/** Classifies a thrown value. Only transport/5xx/timeout faults are retryable; declines never reach here. */
export function classifyError(err: unknown): "retryable" | "fatal" {
  if (err instanceof AdapterError) return err.retryable ? "retryable" : "fatal";
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError) return "retryable";
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status >= 500) return "retryable";
  }
  return "fatal";
}
