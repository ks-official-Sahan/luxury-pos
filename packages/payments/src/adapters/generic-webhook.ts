import {
  WebhookVerificationError,
  type AdapterResult,
  type AdapterStatus,
  type PaymentAdapter,
  type RefundResult,
  type WebhookEvent,
  type WebhookEventType,
} from "../adapter";
import { header, hmacSha256Hex, timingSafeEqual } from "../crypto";
import { num, obj, send, str } from "../http";
import type { CreateInput, PaymentMethod } from "../types";

export interface GenericGatewayConfig {
  id: string;
  methods: PaymentMethod[];
  currencies?: string[];
  baseUrl: string;
  apiKey: string;
  /** Paths relative to baseUrl. Defaults: /payments, /payments/{ref}/capture, /payments/{ref}/void, /payments/{ref}/refunds. */
  paths?: { create?: string; capture?: string; void?: string; refund?: string };
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Webhook HMAC-SHA256 hex signature header and shared secret. */
  signatureHeader: string;
  webhookSecret: string;
  /** Optional prefix before the hex digest, e.g. "sha256=". */
  signaturePrefix?: string;
  /** Provider status string to our status. Unknown values map to requires_action. */
  statusMap: Record<string, AdapterStatus>;
  /** JSON field names (top-level) in responses/webhooks. */
  fields?: { ref?: string; status?: string; redirectUrl?: string; failureCode?: string; eventId?: string; amount?: string; currency?: string };
}

const EVENT_TYPE: Partial<Record<AdapterStatus, WebhookEventType>> = {
  authorized: "authorized",
  captured: "captured",
  failed: "failed",
  voided: "voided",
};

/**
 * Config-driven HMAC-signed gateway (PayHere/Razorpay style): new local providers need config, not code.
 * Requests are JSON with Bearer auth and Idempotency-Key. Webhooks: hex HMAC-SHA256 of the raw body.
 * A webhook whose raw status is the literal "refunded" yields a refunded event regardless of statusMap.
 */
export function createGenericWebhookAdapter(cfg: GenericGatewayConfig): PaymentAdapter {
  const timeout = cfg.timeoutMs ?? 15_000;
  const f = { ref: "id", status: "status", redirectUrl: "redirect_url", failureCode: "failure_code", eventId: "event_id", amount: "amount", currency: "currency", ...cfg.fields };
  const currencies = new Set((cfg.currencies ?? []).map((c) => c.toUpperCase()));
  const path = (kind: "create" | "capture" | "void" | "refund", ref?: string): string => {
    const defaults = {
      create: "/payments",
      capture: "/payments/{ref}/capture",
      void: "/payments/{ref}/void",
      refund: "/payments/{ref}/refunds",
    };
    return `${cfg.baseUrl}${(cfg.paths?.[kind] ?? defaults[kind]).replace("{ref}", encodeURIComponent(ref ?? ""))}`;
  };
  const call = (url: string, body: Record<string, unknown>, key: string) =>
    send(
      cfg.fetch,
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      timeout,
    );
  const map = (status: number, body: Record<string, unknown>): AdapterResult => {
    const ref = str(body[f.ref]);
    const code = str(body[f.failureCode]);
    if (status >= 400) return { status: "failed", failureCode: code ?? `http_${status}` };
    const mapped = cfg.statusMap[str(body[f.status]) ?? ""] ?? "requires_action";
    const out: AdapterResult = { status: mapped };
    if (ref) out.providerRef = ref;
    if (code && mapped === "failed") out.failureCode = code;
    const url = str(body[f.redirectUrl]);
    if (url && mapped === "requires_action") out.action = { kind: "redirect", payload: url };
    return out;
  };

  return {
    id: cfg.id,
    methods: cfg.methods,
    supportsCurrency: (c) => currencies.size === 0 || currencies.has(c.toUpperCase()),
    async create(input: CreateInput): Promise<AdapterResult> {
      const res = await call(
        path("create"),
        {
          reference: input.idempotencyKey,
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          method: input.method,
          ...(input.paymentToken ? { token: input.paymentToken } : {}),
          metadata: { tenantId: input.tenantId, storeId: input.storeId, ...(input.orderId ? { orderId: input.orderId } : {}) },
        },
        input.idempotencyKey,
      );
      return map(res.status, res.body);
    },
    async capture(ref, amount, key): Promise<AdapterResult> {
      const res = await call(path("capture", ref), { amount }, key);
      return map(res.status, res.body);
    },
    async void(ref, key): Promise<AdapterResult> {
      const res = await call(path("void", ref), {}, key);
      return map(res.status, res.body);
    },
    async refund(ref, amount, key): Promise<RefundResult> {
      const res = await call(path("refund", ref), { amount }, key);
      if (res.status >= 400) return { status: "failed", failureCode: str(res.body[f.failureCode]) ?? `http_${res.status}` };
      const id = str(res.body[f.ref]);
      const mapped = cfg.statusMap[str(res.body[f.status]) ?? ""];
      const out: RefundResult = { status: mapped === "failed" ? "failed" : mapped === "requires_action" ? "pending" : "succeeded" };
      if (id) out.providerRef = id;
      return out;
    },
    async verifyWebhook(rawBody, hdrs): Promise<WebhookEvent | null> {
      const sig = header(hdrs, cfg.signatureHeader);
      if (!sig) throw new WebhookVerificationError(`missing ${cfg.signatureHeader}`);
      const prefix = cfg.signaturePrefix ?? "";
      const given = (prefix && sig.startsWith(prefix) ? sig.slice(prefix.length) : sig).toLowerCase();
      if (!timingSafeEqual(await hmacSha256Hex(cfg.webhookSecret, rawBody), given)) {
        throw new WebhookVerificationError("signature mismatch");
      }
      let body: Record<string, unknown>;
      try {
        body = obj(JSON.parse(rawBody));
      } catch {
        throw new WebhookVerificationError("invalid JSON body");
      }
      const raw = str(body[f.status]) ?? "";
      const providerRef = str(body[f.ref]);
      const eventId = str(body[f.eventId]);
      if (!providerRef || !eventId) return null;
      const type: WebhookEventType | undefined = raw === "refunded"
        ? "refunded"
        : EVENT_TYPE[cfg.statusMap[raw] ?? "requires_action"];
      if (!type) return null;
      const evt: WebhookEvent = { eventId, type, providerRef };
      const amount = num(body[f.amount]);
      if (amount !== undefined) evt.amount = amount;
      const cur = str(body[f.currency]);
      if (cur) evt.currency = cur.toUpperCase();
      return evt;
    },
  };
}
