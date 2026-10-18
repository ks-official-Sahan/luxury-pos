import type { AdapterResult, PaymentAdapter, RefundResult } from "../adapter";
import type { CreateInput } from "../types";

export interface CashAdapterConfig {
  /** Accepted currencies (upper case). Empty/omitted accepts any. */
  currencies?: string[];
}

/** Cash: no network, captured immediately. Refunds are paid out of the till and succeed synchronously. */
export function createCashAdapter(config: CashAdapterConfig = {}): PaymentAdapter {
  const currencies = new Set((config.currencies ?? []).map((c) => c.toUpperCase()));
  return {
    id: "cash",
    methods: ["cash"],
    supportsCurrency: (c) => currencies.size === 0 || currencies.has(c.toUpperCase()),
    async create(input: CreateInput): Promise<AdapterResult> {
      return { status: "captured", providerRef: `cash:${input.idempotencyKey}` };
    },
    async refund(ref: string, _amount: number, idempotencyKey: string): Promise<RefundResult> {
      return { status: "succeeded", providerRef: `${ref}:refund:${idempotencyKey}` };
    },
  };
}
