import { outbox, type Tx } from "@luxury-pos/db";
import { EVENT_PAYLOADS, type CloudEvent, type EventPayload, type EventType } from "@luxury-pos/contracts";
import { uuidv7 } from "@luxury-pos/core";

export const EVENT_TOPIC_PREFIX = "event:";

/**
 * Records a domain event in the transactional outbox, inside the caller's
 * transaction: if the business change rolls back, the event never existed; if it
 * commits, the worker relays it at least once (consumers dedupe on `id`).
 */
export async function emit<T extends EventType>(tx: Tx, tenantId: string, type: T, data: EventPayload<T>, source?: { storeId?: string | null }) {
  const event: CloudEvent<T> = {
    specversion: "1.0",
    id: uuidv7(),
    source: source?.storeId ? `/tenants/${tenantId}/stores/${source.storeId}` : `/tenants/${tenantId}`,
    type,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    subject: tenantId,
    data: EVENT_PAYLOADS[type].parse(data) as EventPayload<T>,
  };
  await tx.insert(outbox).values({ tenantId, topic: `${EVENT_TOPIC_PREFIX}${type}`, payload: event as unknown as Record<string, unknown> });
}
