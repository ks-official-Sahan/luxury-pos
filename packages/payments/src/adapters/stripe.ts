import {
  AdapterError,
  WebhookVerificationError,
  type AdapterResult,
  type PaymentAdapter,
  type RefundResult,
  type WebhookEvent,
} from "../adapter";
import { header, hmacSha256Hex, timingSafeEqual } from "../crypto";
import { formEncode, num, obj, send, str } from "../http";
import type { CreateInput } from "../types";

export interface StripeConfig {
  secretKey: string;
  /** Endpoint signing secret (whsec_...). Required for verifyWebhook. */
  webhookSecret?: string;
  fetch: typeof fetch;
  now: () => number;
  baseUrl?: string;
  timeoutMs?: number;
  /** Webhook timestamp tolerance in seconds. Default 300. */
  toleranceSec?: number;
  /** Supported currencies (upper case). Omitted accepts any. */
  currencies?: string[];
}

/**
 * Stripe PaymentIntents over REST. Amounts are Stripe smallest units, which equal our minor units.
 * Idempotency-Key is always the caller's key. 402 declines resolve as `failed`; 5xx/429/transport throw retryable.
 */
export function createStripeAdapter(config: StripeConfig): PaymentAdapter {
  const base = config.baseUrl ?? "https://api.stripe.com";
  const timeout = config.timeoutMs ?? 15_000;
  const tolerance = config.toleranceSec ?? 300;
  const currencies = new Set((config.currencies ?? []).map((c) => c.toUpperCase()));

  const headers = (key?: string): Record<string, string> => {
    const h: Record<string, string> = {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (key) h["Idempotency-Key"] = key;
    return h;
  };

  const post = (path: string, fields: Array<[string, string | number | undefined]>, key: string) =>
    send(config.fetch, `${base}${path}`, { method: "POST", headers: headers(key), body: formEncode(fields) }, timeout);

  /** Maps a Stripe error body (402 decline or 4xx) to a result or a fatal error. */
  const failure = (status: number, body: Record<string, unknown>): AdapterResult => {
    const err = obj(body["error"]);
    const code = str(err["decline_code"]) ?? str(err["code"]) ?? "card_declined";
    if (status === 402) return { status: "failed", failureCode: code };
    throw new AdapterError("invalid_request", str(err["message"]) ?? `stripe ${status}`, status);
  };

  const mapIntent = (pi: Record<string, unknown>, method?: string): AdapterResult => {
    const providerRef = str(pi["id"]);
    const withRef = (r: AdapterResult): AdapterResult => (providerRef ? { ...r, providerRef } : r);
    switch (str(pi["status"])) {
      case "succeeded":
        return withRef({ status: "captured" });
      case "requires_capture":
        return withRef({ status: "authorized" });
      case "canceled":
        return withRef({ status: "voided" });
      case "requires_action": {
        const url = str(obj(obj(pi["next_action"])["redirect_to_url"])["url"]);
        return withRef(url ? { status: "requires_action", action: { kind: "redirect", payload: url } } : { status: "requires_action" });
      }
      case "requires_payment_method": {
        const lastErr = obj(pi["last_payment_error"]);
        if (Object.keys(lastErr).length > 0) {
          return withRef({ status: "failed", failureCode: str(lastErr["decline_code"]) ?? str(lastErr["code"]) ?? "card_declined" });
        }
        const secret = str(pi["client_secret"]);
        if (method === "card_present" && secret) {
          return withRef({ status: "requires_action", action: { kind: "terminal", payload: secret } });
        }
        return withRef({ status: "requires_action" });
      }
      default:
        return withRef({ status: "requires_action" });
    }
  };

  return {
    id: "stripe",
    methods: ["card_online", "card_present"],
    supportsCurrency: (c) => currencies.size === 0 || currencies.has(c.toUpperCase()),

    async create(input: CreateInput): Promise<AdapterResult> {
      const present = input.method === "card_present";
      if (!present && !input.paymentToken) return { status: "failed", failureCode: "missing_payment_token" };
      const fields: Array<[string, string | number | undefined]> = [
        ["amount", input.amount],
        ["currency", input.currency.toLowerCase()],
        ["payment_method_types[]", present ? "card_present" : "card"],
        // card_present must be manual capture; the terminal confirms, then we capture.
        ["capture_method", present ? "manual" : (input.captureMethod ?? "automatic")],
        ["metadata[tenantId]", input.tenantId],
        ["metadata[storeId]", input.storeId],
        ["metadata[orderId]", input.orderId],
        ["metadata[intentId]", input.idempotencyKey],
      ];
      if (!present) {
        fields.push(["payment_method", input.paymentToken], ["confirm", "true"]);
      }
      if (present && input.terminalRef) fields.push(["metadata[terminalRef]", input.terminalRef]);
      const res = await post("/v1/payment_intents", fields, input.idempotencyKey);
      if (res.status >= 400) return failure(res.status, res.body);
      return mapIntent(res.body, input.method);
    },

    async capture(ref, amount, idempotencyKey): Promise<AdapterResult> {
      const res = await post(`/v1/payment_intents/${encodeURIComponent(ref)}/capture`, [["amount_to_capture", amount]], idempotencyKey);
      if (res.status >= 400) return failure(res.status, res.body);
      return mapIntent(res.body);
    },

    async void(ref, idempotencyKey): Promise<AdapterResult> {
      const res = await post(`/v1/payment_intents/${encodeURIComponent(ref)}/cancel`, [], idempotencyKey);
      if (res.status >= 400) return failure(res.status, res.body);
      return mapIntent(res.body);
    },

    async refund(ref, amount, idempotencyKey): Promise<RefundResult> {
      const res = await post("/v1/refunds", [["payment_intent", ref], ["amount", amount]], idempotencyKey);
      if (res.status >= 400) {
        const r = failure(res.status, res.body);
        return { status: "failed", failureCode: r.failureCode ?? "refund_failed" };
      }
      const id = str(res.body["id"]);
      const out: RefundResult = { status: "succeeded" };
      if (id) out.providerRef = id;
      switch (str(res.body["status"])) {
        case "failed":
        case "canceled":
          return { ...out, status: "failed", failureCode: str(res.body["failure_reason"]) ?? "refund_failed" };
        case "pending":
        case "requires_action":
          return { ...out, status: "pending" };
        default:
          return out;
      }
    },

    async status(ref): Promise<AdapterResult> {
      const res = await send(
        config.fetch,
        `${base}/v1/payment_intents/${encodeURIComponent(ref)}`,
        { method: "GET", headers: headers() },
        timeout,
      );
      if (res.status >= 400) return failure(res.status, res.body);
      return mapIntent(res.body);
    },

    async verifyWebhook(rawBody, hdrs): Promise<WebhookEvent | null> {
      const secret = config.webhookSecret;
      if (!secret) throw new WebhookVerificationError("webhook secret not configured");
      const sig = header(hdrs, "stripe-signature");
      if (!sig) throw new WebhookVerificationError("missing Stripe-Signature");
      let t: string | undefined;
      const v1: string[] = [];
      for (const part of sig.split(",")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k === "t") t = v;
        else if (k === "v1") v1.push(v);
      }
      const ts = t !== undefined && /^\d+$/.test(t) ? Number(t) : NaN;
      if (!Number.isFinite(ts) || v1.length === 0) throw new WebhookVerificationError("malformed Stripe-Signature");
      const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
      // Evaluate every candidate to keep timing independent of which matches.
      let ok = false;
      for (const cand of v1) if (timingSafeEqual(expected, cand.toLowerCase())) ok = true;
      if (!ok) throw new WebhookVerificationError("signature mismatch");
      if (Math.abs(config.now() / 1000 - ts) > tolerance) throw new WebhookVerificationError("timestamp outside tolerance");

      let evt: Record<string, unknown>;
      try {
        evt = obj(JSON.parse(rawBody));
      } catch {
        throw new WebhookVerificationError("invalid JSON body");
      }
      const eventId = str(evt["id"]);
      const data = obj(obj(evt["data"])["object"]);
      const currency = str(data["currency"])?.toUpperCase();
      const make = (type: WebhookEvent["type"], providerRef: string | undefined, amount: number | undefined): WebhookEvent | null => {
        if (!eventId || !providerRef) return null;
        const e: WebhookEvent = { eventId, type, providerRef };
        if (amount !== undefined) e.amount = amount;
        if (currency) e.currency = currency;
        return e;
      };
      switch (str(evt["type"])) {
        case "payment_intent.succeeded":
          return make("captured", str(data["id"]), num(data["amount_received"]) ?? num(data["amount"]));
        case "payment_intent.amount_capturable_updated":
          return make("authorized", str(data["id"]), num(data["amount_capturable"]) ?? num(data["amount"]));
        case "payment_intent.payment_failed":
          return make("failed", str(data["id"]), num(data["amount"]));
        case "payment_intent.canceled":
          return make("voided", str(data["id"]), num(data["amount"]));
        case "charge.refunded":
          return make("refunded", str(data["payment_intent"]), num(data["amount_refunded"]));
        default:
          return null;
      }
    },
  };
}
