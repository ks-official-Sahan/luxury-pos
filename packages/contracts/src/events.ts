import { z } from "zod";

/**
 * Domain events, carried in a CloudEvents 1.0 envelope (JSON structured mode).
 * The same envelope goes to Kafka, webhooks, or a future Django/Celery consumer:
 * any service can subscribe without importing this codebase.
 *
 * Versioning: a breaking payload change gets a new `type` (`….v2`); consumers
 * ignore types they don't know. Partition key is always the tenant id, so one
 * tenant's events stay ordered while tenants spread across partitions.
 */
const id = z.uuid();
const minor = z.number().int().safe();

export const EVENT_PAYLOADS = {
  "pos.order.created.v1": z.object({ orderId: id, storeId: id, receiptNo: z.string(), total: minor, currency: z.string().length(3), customerId: id.nullable(), cashierId: id, lines: z.number().int() }),
  "pos.order.refunded.v1": z.object({ refundId: id, orderId: id, storeId: id, total: minor, currency: z.string().length(3) }),
  "pos.stock.adjusted.v1": z.object({ storeId: id, reason: z.string(), changes: z.array(z.object({ variantId: id, delta: z.number().int() })).max(500) }),
  "pos.customer.upserted.v1": z.object({ customerId: id }),
  "pos.branding.updated.v1": z.object({ storeId: id.nullable() }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

export interface CloudEvent<T extends EventType = EventType> {
  specversion: "1.0";
  id: string;
  /** URI-reference of the producer, e.g. `/tenants/<id>/stores/<id>`. */
  source: string;
  type: T;
  time: string;
  datacontenttype: "application/json";
  /** Tenant id; also the Kafka partition key. */
  subject: string;
  data: EventPayload<T>;
}

export const cloudEventSchema = z.object({
  specversion: z.literal("1.0"),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z.string().min(1),
  time: z.iso.datetime(),
  datacontenttype: z.literal("application/json"),
  subject: z.string().min(1),
  data: z.unknown(),
});

/** Kafka topic for an event type: `<prefix>pos.order` (entity-level topics keep partitions meaningful). */
export function topicFor(type: EventType, prefix = ""): string {
  return `${prefix}${type.split(".").slice(0, 2).join(".")}`;
}
