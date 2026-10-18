import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatMoney, settle, uuidv7, type Tender } from "@luxury-pos/core";
import type { CreateOrderInput } from "@luxury-pos/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { useStore } from "@/lib/queries";
import { priceLines, useCart } from "@/state/cart";
import { useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";
import type { ReceiptData } from "@/lib/receipt";

export type CheckoutResult =
  | { kind: "done"; receiptNo: string; changeDue: number; pointsEarned: number; offline: false; receipt: ReceiptData }
  | { kind: "queued"; changeDue: number; offline: true; receipt: ReceiptData }
  | { kind: "needs_approval"; action: "price" | "discount" | "void" | "refund" | "noSale" }
  | { kind: "error"; message: string };

/**
 * Builds the order exactly as the server will price it, sends it, and falls back
 * to the offline outbox on network failure. The order id is created once per
 * attempt so retries (online or replayed) can never double-charge.
 */
export function useCheckout() {
  const qc = useQueryClient();
  const store = useStore();
  const { deviceId, drawerSessionId } = useSession();
  const cart = useCart();
  const [orderId, setOrderId] = useState(() => uuidv7());
  const priced = store ? priceLines(cart.lines, cart.orderDiscount, store.currency, store.taxMode) : null;

  const submit = async (tenders: Tender[], opts: { overrideToken?: string; redeemPoints?: number } = {}): Promise<CheckoutResult> => {
    if (!store || !priced || !deviceId) return { kind: "error", message: "This till is not set up for a store yet." };
    const settlement = settle(priced.total, tenders, store.settings.cashIncrement);
    if (!settlement.settled) return { kind: "error", message: "The payment does not cover the total yet." };
    const body: CreateOrderInput = {
      id: orderId,
      storeId: store.id,
      deviceId,
      drawerSessionId: drawerSessionId ?? undefined,
      customerId: cart.client?.id,
      createdAt: new Date().toISOString(),
      lines: cart.lines.map((l) => ({ variantId: l.item.variantId, quantity: l.quantity, discount: l.discount, priceOverride: l.priceOverride, serialNumber: l.serialNumber })),
      orderDiscount: cart.orderDiscount,
      redeemPoints: opts.redeemPoints,
      tenders,
      expectedTotal: priced.total,
      overrideToken: opts.overrideToken,
    };
    const receipt = (receiptNo: string | null): ReceiptData => ({
      receiptNo,
      storeName: store.name,
      currency: store.currency,
      lines: cart.lines.map((l, i) => ({ name: l.item.name, quantity: l.quantity, total: priced.lines[i]?.total ?? 0 })),
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      total: priced.total + settlement.rounding,
      changeDue: settlement.changeDue,
      createdAt: body.createdAt,
    });
    const finish = () => {
      cart.clear();
      setOrderId(uuidv7());
      void qc.invalidateQueries({ queryKey: ["catalog"] });
    };
    try {
      const res = await api<{ receiptNo: string; changeDue?: number; pointsEarned?: number }>("/orders", { method: "POST", json: body });
      const printable = receipt(res.receiptNo);
      finish();
      return { kind: "done", receiptNo: res.receiptNo, changeDue: res.changeDue ?? settlement.changeDue, pointsEarned: res.pointsEarned ?? 0, offline: false, receipt: printable };
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "override_required") {
        const action = (err.details as { action?: "price" | "discount" } | undefined)?.action ?? "discount";
        return { kind: "needs_approval", action };
      }
      if (err instanceof ApiRequestError && err.retryable) {
        // Offline: the sale is final on the till; the server books it on replay.
        useOutbox.getState().enqueue({ id: body.id, path: "/orders", body, label: `Sale ${formatMoney(priced.total, store.currency)}` });
        const printable = receipt(null);
        finish();
        return { kind: "queued", changeDue: settlement.changeDue, offline: true, receipt: printable };
      }
      return { kind: "error", message: err instanceof Error ? err.message : "The sale could not be completed." };
    }
  };

  return { store, priced, submit, client: cart.client };
}

export async function requestApproval(input: { action: string; managerEmail: string; pin: string; storeId: string }) {
  return api<{ token: string; approvedBy: string }>("/overrides", { method: "POST", json: input });
}
