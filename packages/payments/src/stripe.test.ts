import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AdapterError, WebhookVerificationError } from "./adapter";
import { createStripeAdapter } from "./adapters/stripe";
import type { CreateInput } from "./types";

const NOW = 1_700_000_000_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mk = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => impl(String(url), init ?? {}));
  const adapter = createStripeAdapter({ secretKey: "sk_test_x", webhookSecret: "whsec_abc", fetch: fetchMock as unknown as typeof fetch, now: () => NOW });
  return { adapter, fetchMock };
};
const input = (over: Partial<CreateInput> = {}): CreateInput => ({
  idempotencyKey: "idem-1", tenantId: "t1", storeId: "s1", orderId: "o1", amount: 12_345, currency: "USD", method: "card_online", paymentToken: "pm_tok", metadata: {}, ...over,
});

describe("stripe create", () => {
  it("sends Idempotency-Key, bearer auth and form body", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "pi_1", status: "succeeded" }));
    const r = await adapter.create(input());
    expect(r).toEqual({ status: "captured", providerRef: "pi_1" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.stripe.com/v1/payment_intents");
    expect(init?.method).toBe("POST");
    const h = init?.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("idem-1");
    expect(h["Authorization"]).toBe("Bearer sk_test_x");
    expect(h["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("amount")).toBe("12345");
    expect(body.get("currency")).toBe("usd");
    expect(body.getAll("payment_method_types[]")).toEqual(["card"]);
    expect(body.get("payment_method")).toBe("pm_tok");
    expect(body.get("confirm")).toBe("true");
    expect(body.get("metadata[tenantId]")).toBe("t1");
    expect(body.get("metadata[orderId]")).toBe("o1");
  });
  it("card_present uses card_present, manual capture and returns terminal action", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "pi_2", status: "requires_payment_method", client_secret: "pi_2_secret" }));
    const r = await adapter.create(input({ method: "card_present", paymentToken: undefined, terminalRef: "tmr_1" }));
    expect(r).toEqual({ status: "requires_action", providerRef: "pi_2", action: { kind: "terminal", payload: "pi_2_secret" } });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.getAll("payment_method_types[]")).toEqual(["card_present"]);
    expect(body.get("capture_method")).toBe("manual");
    expect(body.get("confirm")).toBeNull();
    expect(body.get("metadata[terminalRef]")).toBe("tmr_1");
  });
  it("online without token fails locally without a request", async () => {
    const { adapter, fetchMock } = mk(() => json(200, {}));
    expect((await adapter.create(input({ paymentToken: undefined }))).failureCode).toBe("missing_payment_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("402 decline resolves as failed (not an error)", async () => {
    const { adapter } = mk(() => json(402, { error: { code: "card_declined", decline_code: "insufficient_funds", message: "no" } }));
    expect(await adapter.create(input())).toEqual({ status: "failed", failureCode: "insufficient_funds" });
  });
  it("503, 429 and transport errors throw retryable AdapterError", async () => {
    for (const impl of [() => json(503, {}), () => json(429, {}), () => { throw new TypeError("fetch failed"); }]) {
      const { adapter } = mk(impl);
      const err = await adapter.create(input()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).retryable).toBe(true);
    }
  });
  it("timeouts are retryable; 401 and other 4xx are not", async () => {
    const t = mk(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    expect(((await t.adapter.create(input()).catch((e: unknown) => e)) as AdapterError).kind).toBe("timeout");
    const a = mk(() => json(401, {}));
    expect(((await a.adapter.create(input()).catch((e: unknown) => e)) as AdapterError).retryable).toBe(false);
    const b = mk(() => json(400, { error: { message: "bad" } }));
    const e = (await b.adapter.create(input()).catch((x: unknown) => x)) as AdapterError;
    expect(e.kind).toBe("invalid_request");
    expect(e.retryable).toBe(false);
  });
  it("maps requires_action redirect, requires_capture and requires_payment_method with error", async () => {
    expect((await mk(() => json(200, { id: "p", status: "requires_action", next_action: { redirect_to_url: { url: "https://3ds" } } })).adapter.create(input())).action).toEqual({ kind: "redirect", payload: "https://3ds" });
    expect((await mk(() => json(200, { id: "p", status: "requires_capture" })).adapter.create(input())).status).toBe("authorized");
    expect(await mk(() => json(200, { id: "p", status: "requires_payment_method", last_payment_error: { code: "card_declined" } })).adapter.create(input())).toEqual({ status: "failed", providerRef: "p", failureCode: "card_declined" });
  });
});

describe("stripe capture / void / refund / status", () => {
  it("capture posts amount_to_capture with idempotency key", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "pi_1", status: "succeeded" }));
    expect((await adapter.capture?.("pi_1", 700, "cap-1"))?.status).toBe("captured");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.stripe.com/v1/payment_intents/pi_1/capture");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("cap-1");
    expect(new URLSearchParams(String(init?.body)).get("amount_to_capture")).toBe("700");
  });
  it("void cancels", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "pi_1", status: "canceled" }));
    expect((await adapter.void?.("pi_1", "v-1"))?.status).toBe("voided");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.stripe.com/v1/payment_intents/pi_1/cancel");
  });
  it("refund posts payment_intent and amount with idempotency key", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "re_1", status: "succeeded" }));
    expect(await adapter.refund("pi_1", 300, "r-1")).toEqual({ status: "succeeded", providerRef: "re_1" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.stripe.com/v1/refunds");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("r-1");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("payment_intent")).toBe("pi_1");
    expect(body.get("amount")).toBe("300");
  });
  it("refund pending and failed", async () => {
    expect((await mk(() => json(200, { id: "re", status: "pending" })).adapter.refund("p", 1, "k")).status).toBe("pending");
    expect((await mk(() => json(402, { error: { code: "charge_already_refunded" } })).adapter.refund("p", 1, "k")).status).toBe("failed");
  });
  it("status GETs without idempotency key", async () => {
    const { adapter, fetchMock } = mk(() => json(200, { id: "pi_1", status: "requires_capture" }));
    expect((await adapter.status?.("pi_1"))?.status).toBe("authorized");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });
});

describe("stripe webhook", () => {
  const sign = (t: number, body: string, secret = "whsec_abc") => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", data: { object: { id: "pi_9", amount: 5000, amount_received: 5000, currency: "usd" } } });
  const t = NOW / 1000;
  const { adapter } = mk(() => json(200, {}));

  it("accepts a valid signature", async () => {
    const evt = await adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${t},v1=${sign(t, body)}` });
    expect(evt).toEqual({ eventId: "evt_1", type: "captured", providerRef: "pi_9", amount: 5000, currency: "USD" });
  });
  it("accepts when one of several v1 values matches and header case differs", async () => {
    const evt = await adapter.verifyWebhook?.(body, { "stripe-signature": `t=${t},v1=${"0".repeat(64)},v1=${sign(t, body)}` });
    expect(evt?.providerRef).toBe("pi_9");
  });
  it("rejects wrong signature, wrong secret, tampered body", async () => {
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${t},v1=${"a".repeat(64)}` })).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${t},v1=${sign(t, body, "other")}` })).rejects.toThrow("signature mismatch");
    await expect(adapter.verifyWebhook?.(body + " ", { "Stripe-Signature": `t=${t},v1=${sign(t, body)}` })).rejects.toThrow("signature mismatch");
  });
  it("rejects expired and future timestamps beyond 5 minutes, accepts at the boundary", async () => {
    const old = t - 301;
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${old},v1=${sign(old, body)}` })).rejects.toThrow("tolerance");
    const future = t + 301;
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${future},v1=${sign(future, body)}` })).rejects.toThrow("tolerance");
    const edge = t - 300;
    expect(await adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=${edge},v1=${sign(edge, body)}` })).not.toBeNull();
  });
  it("rejects missing or malformed header", async () => {
    await expect(adapter.verifyWebhook?.(body, {})).rejects.toThrow("missing");
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": "garbage" })).rejects.toThrow("malformed");
    await expect(adapter.verifyWebhook?.(body, { "Stripe-Signature": `t=abc,v1=${sign(t, body)}` })).rejects.toThrow("malformed");
  });
  it("maps other event types and ignores unknown ones", async () => {
    const mkEvt = async (type: string, object: unknown) => {
      const b = JSON.stringify({ id: "evt_2", type, data: { object } });
      return adapter.verifyWebhook?.(b, { "Stripe-Signature": `t=${t},v1=${sign(t, b)}` });
    };
    expect((await mkEvt("charge.refunded", { payment_intent: "pi_9", amount_refunded: 200, currency: "usd" }))).toMatchObject({ type: "refunded", providerRef: "pi_9", amount: 200 });
    expect((await mkEvt("payment_intent.payment_failed", { id: "pi_9", amount: 1 }))?.type).toBe("failed");
    expect((await mkEvt("payment_intent.canceled", { id: "pi_9" }))?.type).toBe("voided");
    expect((await mkEvt("payment_intent.amount_capturable_updated", { id: "pi_9", amount_capturable: 5 }))?.type).toBe("authorized");
    expect(await mkEvt("customer.created", { id: "cus_1" })).toBeNull();
  });
});
