import { topicFor, type CloudEvent, type EventType } from "@luxury-pos/contracts";
import type { Env } from "../env";

/** Where the outbox worker relays domain events. Swappable without touching producers. */
export interface EventSink {
  readonly name: string;
  publish(events: CloudEvent[]): Promise<void>;
  close(): Promise<void>;
}

/** Default when no broker is configured: events stay in the outbox history only. */
export const noopSink: EventSink = { name: "none", publish: async () => {}, close: async () => {} };

/**
 * Kafka via Confluent's librdkafka client (KafkaJS-compatible API), loaded lazily
 * so installs without a broker never need the native module. Idempotent producer +
 * tenant-id keys = per-tenant ordering without duplicates on producer retries.
 */
export async function kafkaSink(env: Env): Promise<EventSink> {
  const mod = (await import("@confluentinc/kafka-javascript").catch(() => {
    throw new Error("KAFKA_BROKERS is set but @confluentinc/kafka-javascript is not installed");
  })) as typeof import("@confluentinc/kafka-javascript");
  const { Kafka } = mod.KafkaJS;
  const sasl = env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD ? { mechanism: env.KAFKA_SASL_MECHANISM, username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD } : undefined;
  const kafka = new Kafka({ kafkaJS: { clientId: env.KAFKA_CLIENT_ID, brokers: env.KAFKA_BROKERS, ssl: env.KAFKA_SSL, ...(sasl ? { sasl: sasl as never } : {}) } });
  const producer = kafka.producer({ kafkaJS: { idempotent: true, acks: -1 } });
  await producer.connect();
  return {
    name: "kafka",
    async publish(events) {
      const byTopic = new Map<string, CloudEvent[]>();
      for (const e of events) {
        const topic = topicFor(e.type as EventType, env.EVENTS_TOPIC_PREFIX);
        byTopic.set(topic, [...(byTopic.get(topic) ?? []), e]);
      }
      await producer.sendBatch({
        topicMessages: [...byTopic].map(([topic, list]) => ({
          topic,
          messages: list.map((e) => ({ key: e.subject, value: JSON.stringify(e), headers: { "ce_type": e.type, "ce_id": e.id, "content-type": "application/cloudevents+json" } })),
        })),
      });
    },
    close: () => producer.disconnect(),
  };
}

export function createEventSink(env: Env): Promise<EventSink> {
  return env.KAFKA_BROKERS.length ? kafkaSink(env) : Promise.resolve(noopSink);
}
