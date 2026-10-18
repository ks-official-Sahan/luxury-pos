import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WebhookVerificationError } from "./adapter";
import { createGenericWebhookAdapter } from "./adapters/generic-webhook";

const mk = (res: Response | (() => Response)) => {
  const f = vi.fn(async () => (typeof res === "function" ? res() : res));
  const adapter = createGenericWebhookAdapter({
    id: "payhere", methods: ["card_online", "wallet"], currencies: ["LKR"], baseUrl: "https://gw.example", apiKey: "key",
    fetch: f as unknown as typeof fetch, signatureHeader: "X-Signature", webhookSecret: "sek", signaturePrefix: "sha256=",
    statusMap: { PAID: "captured", AUTH: "authorized", PENDING: "requires_action", FAIL: "failed", CANCELLED: "voided" },
  });
  return { adapter, f };
};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const input = { idempotencyKey: "k1", tenantId: "t", storeId: "s", amount: 500, currency: "LKR", method: "card_online" as const, paymentToken: "tok", metadata: {} };

describe("generic webhook gateway", () => {
  it("create posts JSON with idempotency key and maps status", async () => {
    const { adapter, f } = mk(j(200, { id: "g1", status: "PENDING", redirect_url: "https://pay" }));
    expect(await adapter.create(input)).toEqual({ status: "requires_action", providerRef: "g1", action: { kind: "redirect", payload: "https://pay" } });
    const calls = f.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("https://gw.example/payments");
    expect((calls[0]?.[1].headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(String(calls[0]?.[1].body))).toMatchObject({ reference: "k1", amount: 500, currency: "LKR", token: "tok" });
  });
  it("maps 4xx to failed and 5xx to a retryable throw", async () => {
    expect((await mk(j(400, { failure_code: "bad_card" })).adapter.create(input)).failureCode).toBe("bad_card");
    await expect(mk(j(502, {})).adapter.create(input)).rejects.toMatchObject({ retryable: true });
  });
  it("capture, void and refund use templated paths", async () => {
    const { adapter, f } = mk(() => j(200, { id: "r1", status: "PAID" }));
    await adapter.capture?.("g 1", 10, "c1");
    await adapter.void?.("g1", "v1");
    expect(await adapter.refund("g1", 10, "r1")).toEqual({ status: "succeeded", providerRef: "r1" });
    expect((f.mock.calls as unknown as Array<[string]>).map((c) => c[0])).toEqual([
      "https://gw.example/payments/g%201/capture", "https://gw.example/payments/g1/void", "https://gw.example/payments/g1/refunds",
    ]);
  });
  it("verifies webhook HMAC with prefix", async () => {
    const { adapter } = mk(j(200, {}));
    const body = JSON.stringify({ id: "g1", event_id: "e1", status: "PAID", amount: 500, currency: "lkr" });
    const sig = `sha256=${createHmac("sha256", "sek").update(body).digest("hex")}`;
    expect(await adapter.verifyWebhook?.(body, { "x-signature": sig })).toEqual({ eventId: "e1", type: "captured", providerRef: "g1", amount: 500, currency: "LKR" });
    await expect(adapter.verifyWebhook?.(body, { "X-Signature": "sha256=" + "0".repeat(64) })).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(adapter.verifyWebhook?.(body, {})).rejects.toBeInstanceOf(WebhookVerificationError);
  });
  it("returns refunded events and ignores non-terminal statuses", async () => {
    const { adapter } = mk(j(200, {}));
    const sign = (b: string) => ({ "X-Signature": `sha256=${createHmac("sha256", "sek").update(b).digest("hex")}` });
    const r = JSON.stringify({ id: "g1", event_id: "e2", status: "refunded", amount: 100 });
    expect((await adapter.verifyWebhook?.(r, sign(r)))?.type).toBe("refunded");
    const p = JSON.stringify({ id: "g1", event_id: "e3", status: "PENDING" });
    expect(await adapter.verifyWebhook?.(p, sign(p))).toBeNull();
  });
  it("currency support", () => {
    const { adapter } = mk(j(200, {}));
    expect(adapter.supportsCurrency("lkr")).toBe(true);
    expect(adapter.supportsCurrency("USD")).toBe(false);
  });
});
