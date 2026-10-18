/**
 * Demo history: books realistic past sales through the real order service (same
 * pricing, stock, loyalty, rollups and events as the till), so dashboards, the AI
 * analyst and MCP tools have something to show. Development only.
 *
 *   DATABASE_URL=… AUTH_SECRET=… SITE_URL=… pnpm --filter @luxury-pos/api demo [days]
 */
import { and, eq, sql } from "drizzle-orm";
import { priceCart, uuidv7, type Role } from "@luxury-pos/core";
import { customers, devices, memberships, products, stores, tenants, variants, withSystem, withTenant } from "@luxury-pos/db";
import { loadEnv } from "./env";
import { createInfra } from "./infra";
import type { Actor } from "./lib/context";
import { adjustStock } from "./services/inventory";
import { createOrder } from "./services/orders";

const days = Number(process.argv[2] ?? 45);
const slug = process.env.DEMO_SLUG ?? "maison-aurelia";
const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("demo data is for development databases only");
const infra = createInfra(env);

// Deterministic pseudo-random so reruns look alike.
let seed = 42;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

const [tenant] = await withSystem(infra.db, (tx) => tx.select().from(tenants).where(eq(tenants.slug, slug)));
if (!tenant) throw new Error(`no tenant ${slug}; run the seed first`);
const t = tenant.id;

const { storeRows, staff, items, deviceRows, clientIds } = await withTenant(infra.db, t, async (tx) => ({
  storeRows: await tx.select().from(stores),
  staff: await tx.select({ userId: memberships.userId, role: memberships.role, storeIds: memberships.storeIds }).from(memberships),
  items: await tx
    .select({ id: variants.id, price: variants.price, taxRateBps: products.taxRateBps })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(products.serialized, false), eq(variants.active, true))),
  deviceRows: await tx.select().from(devices),
  clientIds: (await tx.select({ id: customers.id }).from(customers)).map((c) => c.id),
}));

const actorFor = (userId: string, role: string): Actor => ({ userId, email: "demo@local", name: "demo", tenantId: t, membershipId: "demo", membership: { tenantId: t, role: role as Role, storeIds: null }, matrix: {}, scopes: null, via: "session" });
const owner = staff.find((s) => s.role === "OWNER")!;

// A few more clients so clienteling and loyalty have history.
if (clientIds.length < 6) {
  const more = await withTenant(infra.db, t, (tx) =>
    tx
      .insert(customers)
      .values(["Sofia Marchetti", "Omar Al-Fayed", "Yuki Tanaka", "Margaux Dubois", "James Whitfield"].map((n) => ({ tenantId: t, firstName: n.split(" ")[0]!, lastName: n.split(" ")[1]!, email: `${n.split(" ")[0]!.toLowerCase()}@example.com`, marketingConsent: true })))
      .onConflictDoNothing()
      .returning({ id: customers.id }),
  );
  clientIds.push(...more.map((m) => m.id));
}

let booked = 0;
for (const store of storeRows) {
  const device = deviceRows.find((d) => d.storeId === store.id);
  if (!device) continue;
  // Enough stock for the period, received as a real movement.
  for (const v of items) await adjustStock(infra, actorFor(owner.userId, "OWNER"), { id: uuidv7(), storeId: store.id, variantId: v.id, type: "receive", quantity: days * 3, unitCost: Math.round(v.price * 0.3), reason: "demo stock" });
  const sellers = staff.filter((s) => !s.storeIds || s.storeIds.includes(store.id));
  for (let d = days; d >= 1; d--) {
    const weekend = [5, 6].includes(new Date(Date.now() - d * 86_400_000).getUTCDay());
    const count = Math.round((weekend ? 9 : 5) * (0.6 + rand() * 0.8));
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.now() - d * 86_400_000 + (10 + rand() * 9) * 3_600_000);
      const lines = Array.from({ length: 1 + Math.floor(rand() * 2.4) }, () => ({ variantId: pick(items).id, quantity: rand() < 0.8 ? 1 : 2 }));
      const priced = priceCart({ currency: store.currency, taxMode: store.taxMode, lines: lines.map((l, j) => { const v = items.find((x) => x.id === l.variantId)!; return { id: String(j), unitPrice: v.price, quantity: l.quantity, taxRateBps: v.taxRateBps }; }) });
      const seller = pick(sellers);
      await createOrder(infra, actorFor(seller.userId, seller.role), {
        id: uuidv7(at.getTime()),
        storeId: store.id,
        deviceId: device.id,
        customerId: rand() < 0.45 && clientIds.length ? pick(clientIds) : undefined,
        createdAt: at.toISOString(),
        lines,
        tenders: [{ method: rand() < 0.7 ? "card" : "cash", amount: priced.total }],
        expectedTotal: priced.total,
      }).catch((e) => console.warn("[demo] skipped a sale:", e.message));
      booked++;
    }
  }
}
console.log(`[demo] booked ${booked} sales over ${days} days`);
await withSystem(infra.db, (tx) => tx.execute(sql`select 1`));
await infra.pool.end();
