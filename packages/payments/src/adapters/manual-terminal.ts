import type { AdapterResult, PaymentAdapter, RefundResult } from "../adapter";
import type { CreateInput } from "../types";

export interface ManualTerminalConfig {
  /** Adapter id, e.g. "terminal-hnb". */
  id?: string;
  currencies?: string[];
}

/**
 * Standalone card terminal: staff keys the sale on the terminal and records the approval code.
 * Required metadata: `approvalCode` (4-12 alphanumerics). Optional: `last4` (4 digits), `brand`.
 * Only last4/brand/approval code are retained; no card data is accepted.
 */
export function createManualTerminalAdapter(config: ManualTerminalConfig = {}): PaymentAdapter {
  const currencies = new Set((config.currencies ?? []).map((c) => c.toUpperCase()));
  const id = config.id ?? "manual-terminal";
  return {
    id,
    methods: ["card_present"],
    supportsCurrency: (c) => currencies.size === 0 || currencies.has(c.toUpperCase()),
    async create(input: CreateInput): Promise<AdapterResult> {
      const code = (input.metadata["approvalCode"] ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) return { status: "failed", failureCode: "missing_approval_code" };
      const last4 = input.metadata["last4"];
      if (last4 !== undefined && !/^\d{4}$/.test(last4)) return { status: "failed", failureCode: "invalid_last4" };
      const metadata: Record<string, string> = { approvalCode: code };
      if (last4 !== undefined) metadata["last4"] = last4;
      const brand = input.metadata["brand"]?.trim().toLowerCase();
      if (brand) metadata["brand"] = brand;
      return { status: "captured", providerRef: `${id}:${code}`, metadata };
    },
    async refund(ref: string, _amount: number, idempotencyKey: string): Promise<RefundResult> {
      // Refund is performed on the physical terminal by staff; recorded here.
      return { status: "succeeded", providerRef: `${ref}:refund:${idempotencyKey}` };
    },
  };
}
