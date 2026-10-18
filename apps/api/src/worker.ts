import { eq, inArray, sql } from "drizzle-orm";
import { formatMoney } from "@luxury-pos/core";
import { orderLines, orders, outbox, stores, tenants, withSystem } from "@luxury-pos/db";
import { renderEmail } from "@sahan-sac/email-kit/layout";
import { loadEnv } from "./env";
import { createInfra, type Infra } from "./infra";
import { EVENT_TOPIC_PREFIX } from "./events/emit";
import { createEventSink, type EventSink } from "./events/sink";
import type { CloudEvent } from "@luxury-pos/contracts";

/**
 * Outbox worker. `FOR UPDATE SKIP LOCKED` lets any number of workers run side by
 * side without double delivery; failures back off exponentially (max 8 tries).
 */
type Job = { id: number; tenantId: string; topic: string; payload: Record<string, unknown>; attempts: number };

async function deliverReceipt(infra: Infra, job: Job) {
  const { orderId, to } = job.payload as { orderId: string; to: string };
  await withSystem(infra.db, async (tx) => {
    const [order] = await tx
      .select({ receiptNo: orders.receiptNo, total: orders.total, tax: orders.taxTotal, currency: orders.currency, createdAt: orders.createdAt, store: stores.name, brand: tenants.name, footer: sql<string>`${stores.theme}->'receipt'->>'footer'` })
      .from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId))
      .innerJoin(tenants, eq(tenants.id, orders.tenantId))
      .where(eq(orders.id, orderId));
    if (!order) return;
    const lines = await tx.select({ name: orderLines.name, quantity: orderLines.quantity, total: orderLines.total }).from(orderLines).where(eq(orderLines.orderId, orderId));
    const m = (v: number) => formatMoney(v, order.currency);
    const r = renderEmail(
      `Your receipt from ${order.store}`,
      {
        preheader: `Receipt ${order.receiptNo} — ${m(order.total)}`,
        heading: "Thank you for your purchase",
        paragraphs: [`Receipt ${order.receiptNo}, ${order.createdAt.toUTCString()}.`],
        details: [...lines.map((l) => [`${l.quantity} × ${l.name}`, m(l.total)] as const), ["Tax", m(order.tax)], ["Total", m(order.total)]],
        footnote: order.footer ?? undefined,
      },
      { brand: order.brand },
    );
    // email-kit's categories are fixed; receipts travel as customer correspondence.
    const sent = await infra.mail.send({ to, subject: r.subject, html: r.html, text: r.text, category: "contact" });
    if (!sent.ok) throw new Error("email send failed");
  });
}

const handlers: Record<string, (infra: Infra, job: Job) => Promise<void>> = { "receipt.email": deliverReceipt };

async function tick(infra: Infra, sink: EventSink): Promise<number> {
  return withSystem(infra.db, async (tx) => {
    const jobs = (
      await tx.execute<Job>(sql`select id, tenant_id as "tenantId", topic, payload, attempts from ${outbox}
        where processed_at is null and available_at <= now() and attempts < 8
        order by id limit 200 for update skip locked`)
    ).rows;
    // Domain events go to the broker as one batch; on failure the whole batch retries (consumers dedupe on event id).
    const events = jobs.filter((j) => j.topic.startsWith(EVENT_TOPIC_PREFIX));
    if (events.length) {
      const ids = events.map((e) => e.id);
      try {
        await sink.publish(events.map((e) => e.payload as unknown as CloudEvent));
        await tx.update(outbox).set({ processedAt: new Date() }).where(inArray(outbox.id, ids));
      } catch (err) {
        const attempts = Math.max(...events.map((e) => e.attempts));
        await tx
          .update(outbox)
          .set({ attempts: sql`${outbox.attempts} + 1`, lastError: String(err).slice(0, 500), availableAt: sql`now() + make_interval(secs => ${2 ** attempts * 30})` })
          .where(inArray(outbox.id, ids));
      }
    }
    // Slow side effects (email, webhooks): a few per tick; the rest stay pending for the next tick or another worker.
    for (const job of jobs.filter((j) => !j.topic.startsWith(EVENT_TOPIC_PREFIX)).slice(0, 20)) {
      try {
        const handler = handlers[job.topic];
        if (!handler) throw new Error(`no handler for ${job.topic}`);
        await handler(infra, job);
        await tx.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.id, job.id));
      } catch (err) {
        const backoff = 2 ** job.attempts * 30;
        await tx
          .update(outbox)
          .set({ attempts: job.attempts + 1, lastError: String(err).slice(0, 500), availableAt: sql`now() + make_interval(secs => ${backoff})` })
          .where(eq(outbox.id, job.id));
      }
    }
    return jobs.length;
  });
}

const infra = createInfra(loadEnv());
const sink = await createEventSink(infra.env);
console.log(`[worker] event sink: ${sink.name}`);
let running = true;
process.on("SIGTERM", () => (running = false));
process.on("SIGINT", () => (running = false));
while (running) {
  const n = await tick(infra, sink).catch((err) => (console.error("[worker]", err), 0));
  if (n === 0) await new Promise((r) => setTimeout(r, 2_000));
}
await sink.close();
await infra.pool.end();
