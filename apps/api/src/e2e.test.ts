/**
 * End-to-end against a real Postgres (scripts/dev-db.sh) as the non-superuser
 * app role, so RLS is enforced. Skipped when TEST_DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { priceCart, uuidv7, type Role } from "@luxury-pos/core";
import { dailySales, memberships, orderLines, orders, stockLevels, customers, withTenant } from "@luxury-pos/db";
import { seedDemo } from "@luxury-pos/db/seed";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createInfra, type Infra } from "./infra";
import type { Actor } from "./lib/context";
import { AppError } from "./lib/errors";
import { createApiToken, verifyPin } from "./services/admin";
import { createOrder, refundOrder } from "./services/orders";
import { requestOverride } from "./services/overrides";
import { availableSerials, lowStock } from "./services/inventory";
import { setDeviceStatus } from "./services/devices";
import { salesSummary } from "./services/reports";
import { listAudit, listOrders, orderDetail, publicBrand, roleMatrix, setRolePermissions } from "./services/backoffice";
import { outbox } from "@luxury-pos/db";
import { sql } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("POS end to end", () => {
  let infra: Infra;
  let slug = "";
  let seed: NonNullable<Awaited<ReturnType<typeof seedDemo>>>;
  const actorFor = (role: Role, storeIds: string[] | null): Actor => ({
    userId: seed.staff[role]!,
    email: `${role.toLowerCase()}@test`,
    name: role,
    tenantId: seed.tenantId,
    membershipId: "n/a",
    membership: { tenantId: seed.tenantId, role, storeIds },
    matrix: {},
    scopes: null,
    via: "session",
  });

  beforeAll(async () => {
    infra = createInfra(loadEnv({ ...process.env, DATABASE_URL: url!, AUTH_SECRET: "x".repeat(40), SITE_URL: "http://localhost:8787", NODE_ENV: "test" }));
    slug = `e2e-${Date.now().toString(36)}`;
    seed = (await seedDemo(infra.db, { slug, pin: "4826" }))!;
  });
  afterAll(async () => infra?.pool.end());

  const bag = () => seed.variants.find((v) => v.sku === "PLM-NOIR-M")!.id;
  const scarf = () => seed.variants.find((v) => v.sku === "CAR-90-ORCH")!.id;

  it("sells, is idempotent on replay, decrements stock, rolls up and earns points", async () => {
    const cashier = actorFor("CASHIER", [seed.stores.paris]);
    const [client] = await withTenant(infra.db, seed.tenantId, (tx) => tx.select().from(customers).limit(1));
    const expected = priceCart({
      currency: "EUR",
      taxMode: "inclusive",
      lines: [
        { id: "0", unitPrice: 420_000, quantity: 1, taxRateBps: 2000 },
        { id: "1", unitPrice: 52_000, quantity: 2, taxRateBps: 2000 },
      ],
    }).total;
    const input = {
      id: uuidv7(),
      storeId: seed.stores.paris,
      deviceId: seed.deviceId,
      customerId: client!.id,
      createdAt: new Date().toISOString(),
      lines: [
        { variantId: bag(), quantity: 1 },
        { variantId: scarf(), quantity: 2 },
      ],
      tenders: [{ method: "card" as const, amount: expected, reference: "auth-123" }],
      expectedTotal: expected,
    };
    const first = await createOrder(infra, cashier, input);
    expect(first.replayed).toBe(false);
    expect(first.total).toBe(524_000);
    expect(first.receiptNo).toBe("PAR-T1-000001");
    const again = await createOrder(infra, cashier, input);
    expect(again).toMatchObject({ replayed: true, id: first.id });

    await withTenant(infra.db, seed.tenantId, async (tx) => {
      const [level] = await tx.select().from(stockLevels).where(and(eq(stockLevels.variantId, bag()), eq(stockLevels.storeId, seed.stores.paris)));
      expect(level!.onHand).toBe(11);
      const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, first.id));
      expect(lines.reduce((s, l) => s + l.tax, 0)).toBe(Math.round(524_000 - 524_000 / 1.2));
      const [day] = await tx.select().from(dailySales).where(eq(dailySales.storeId, seed.stores.paris));
      expect(day!.orders).toBe(1);
      const [c] = await tx.select().from(customers).where(eq(customers.id, client!.id));
      expect(c!.pointsBalance).toBe(4366); // 4366.66 EUR net → floor, member tier 1x
    });
  });

  it("redeems points from the soonest-expiring lots", async () => {
    const cashier = actorFor("CASHIER", [seed.stores.paris]);
    const [client] = await withTenant(infra.db, seed.tenantId, (tx) => tx.select().from(customers).limit(1));
    const total = 52_000;
    const result = await createOrder(infra, cashier, {
      id: uuidv7(),
      storeId: seed.stores.paris,
      deviceId: seed.deviceId,
      customerId: client!.id,
      createdAt: new Date().toISOString(),
      lines: [{ variantId: scarf(), quantity: 1 }],
      redeemPoints: 1_000,
      tenders: [
        { method: "loyalty_points", amount: 1_000 },
        { method: "card", amount: total - 1_000 },
      ],
      expectedTotal: total,
    });
    if (result.replayed) throw new Error("unexpected replay");
    const [c] = await withTenant(infra.db, seed.tenantId, (tx) => tx.select().from(customers).where(eq(customers.id, client!.id)));
    expect(c!.pointsBalance).toBe(4366 - 1_000 + result.pointsEarned);
  });

  it("refuses a stale total and an unpaid order", async () => {
    const cashier = actorFor("CASHIER", [seed.stores.paris]);
    const base = { id: uuidv7(), storeId: seed.stores.paris, deviceId: seed.deviceId, createdAt: new Date().toISOString(), lines: [{ variantId: scarf(), quantity: 1 }] };
    await expect(createOrder(infra, cashier, { ...base, tenders: [{ method: "cash", amount: 1 }], expectedTotal: 1 })).rejects.toMatchObject({ code: "price_changed" });
    await expect(createOrder(infra, cashier, { ...base, tenders: [{ method: "card", amount: 100 }], expectedTotal: 52_000 })).rejects.toMatchObject({ code: "unpaid" });
  });

  it("needs a manager PIN for a cashier's price override, bound to that cashier", async () => {
    const cashier = actorFor("CASHIER", [seed.stores.paris]);
    const order = () => ({
      id: uuidv7(),
      storeId: seed.stores.paris,
      deviceId: seed.deviceId,
      createdAt: new Date().toISOString(),
      lines: [{ variantId: scarf(), quantity: 1, priceOverride: 40_000 }],
      tenders: [{ method: "cash" as const, amount: 50_000 }],
      expectedTotal: 40_000,
    });
    await expect(createOrder(infra, cashier, order())).rejects.toMatchObject({ code: "override_required" });
    await expect(requestOverride(infra, cashier, { action: "price", managerEmail: `manager@${"x"}.test`, pin: "4826", storeId: seed.stores.paris })).rejects.toBeInstanceOf(AppError);
    const managerEmail = (await withTenant(infra.db, seed.tenantId, (tx) => tx.query.users.findFirst({ where: (u, { eq }) => eq(u.id, seed.staff.MANAGER!) })))!.email;
    await expect(requestOverride(infra, cashier, { action: "price", managerEmail, pin: "0000", storeId: seed.stores.paris })).rejects.toMatchObject({ code: "override_denied" });
    const { token } = await requestOverride(infra, cashier, { action: "price", managerEmail, pin: "4826", storeId: seed.stores.paris });
    const done = await createOrder(infra, cashier, { ...order(), overrideToken: token });
    expect(done).toMatchObject({ replayed: false, changeDue: 10_000 });
    // Same token, other action: refused.
    await expect(createOrder(infra, cashier, { ...order(), lines: [{ variantId: scarf(), quantity: 1, discount: { kind: "percent", bps: 5000 } }], expectedTotal: 26_000, tenders: [{ method: "card", amount: 26_000 }], overrideToken: token })).rejects.toMatchObject({ code: "override_required" });
  });

  it("refunds part of an order exactly once, restocking", async () => {
    const manager = actorFor("MANAGER", [seed.stores.paris]);
    const [order] = await withTenant(infra.db, seed.tenantId, (tx) => tx.select().from(orders).where(eq(orders.receiptNo, "PAR-T1-000001")));
    const lines = await withTenant(infra.db, seed.tenantId, (tx) => tx.select().from(orderLines).where(eq(orderLines.orderId, order!.id)));
    const scarfLine = lines.find((l) => l.sku === "CAR-90-ORCH")!;
    const refund = { id: uuidv7(), orderId: order!.id, lines: [{ orderLineId: scarfLine.id, quantity: 1, restock: true }], tenders: [{ method: "card" as const, amount: 52_000 }], reason: "Gift duplicate" };
    expect(await refundOrder(infra, manager, refund)).toMatchObject({ total: 52_000, replayed: false });
    expect(await refundOrder(infra, manager, refund)).toMatchObject({ replayed: true });
    await expect(refundOrder(infra, manager, { ...refund, id: uuidv7(), lines: [{ orderLineId: scarfLine.id, quantity: 2, restock: true }], tenders: [{ method: "card", amount: 104_000 }] })).rejects.toMatchObject({ code: "over_refund" });
  });

  it("scopes reports to the actor and isolates tenants", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const owner = actorFor("OWNER", null);
    const summary = await salesSummary(infra, owner, { from: today, to: today });
    expect(summary.totals.orders).toBe(3);
    const manager = actorFor("MANAGER", [seed.stores.paris]);
    await expect(salesSummary(infra, manager, { from: today, to: today, storeId: seed.stores.dubai })).rejects.toMatchObject({ code: "forbidden" });
    const stranger: Actor = { ...owner, tenantId: "00000000-0000-4000-8000-000000000000", membership: { ...owner.membership, tenantId: "00000000-0000-4000-8000-000000000000" } };
    expect((await salesSummary(infra, stranger, { from: today, to: today })).totals.orders).toBe(0);
    expect((await lowStock(infra, owner, seed.stores.paris)).length).toBeGreaterThanOrEqual(0);
  });

  it("serves the MCP endpoint to a scoped personal access token", async () => {
    const app = createApp(infra, await createAuth(infra));
    const manager = actorFor("MANAGER", [seed.stores.paris]);
    const { token } = await createApiToken(infra, manager, { name: "Claude", scopes: ["mcp.access", "reports.read", "inventory.read"], expiresInDays: 7 });
    const call = (body: unknown, auth = `Bearer ${token}`) =>
      app.fetch(new Request("http://localhost:8787/mcp", { method: "POST", headers: { authorization: auth, "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://localhost:8787" }, body: JSON.stringify(body) }));

    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer nope")).status).toBe(401);
    const init = await call({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.status).toBe(200);
    const list = (await (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("sales_summary");
    const res = (await (await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sales_summary", arguments: { storeId: seed.stores.paris } } })).json()) as {
      result: { structuredContent: { totals: { orders: number } } };
    };
    expect(res.result.structuredContent.totals.orders).toBe(3);
    // Token scopes exclude customer.read even though the manager role has it.
    const denied = (await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_client", arguments: { query: "Camille" } } })).json()) as { result: { isError: boolean } };
    expect(denied.result.isError).toBe(true);
  });

  it("pages orders by keyset, shows detail, and records domain events in the outbox", async () => {
    const owner = actorFor("OWNER", null);
    const first = await listOrders(infra, owner, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await listOrders(infra, owner, { limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const detail = await orderDetail(infra, owner, first.items[0]!.id);
    expect(detail.lines.length).toBeGreaterThan(0);
    const events = await withTenant(infra.db, seed.tenantId, (tx) => tx.select({ topic: outbox.topic, payload: outbox.payload }).from(outbox).where(sql`${outbox.topic} like 'event:%'`));
    expect(events.some((e) => e.topic === "event:pos.order.created.v1" && (e.payload as { specversion: string }).specversion === "1.0")).toBe(true);
    // Someone scoped to another store cannot read it.
    const other = actorFor("MANAGER", [seed.stores.paris === first.items[0]!.storeId ? seed.stores.dubai : seed.stores.paris]);
    await expect(orderDetail(infra, other, first.items[0]!.id)).rejects.toBeInstanceOf(AppError);
  });

  it("edits the role matrix without privilege escalation, audited", async () => {
    const manager = actorFor("MANAGER", null);
    await expect(setRolePermissions(infra, manager, "ADMIN", { permissions: ["sale.create"] })).rejects.toBeInstanceOf(AppError);
    await expect(setRolePermissions(infra, manager, "CASHIER", { permissions: ["tenant.billing"] })).rejects.toBeInstanceOf(AppError);
    const owner = actorFor("OWNER", null);
    const m = await setRolePermissions(infra, owner, "CASHIER", { permissions: ["sale.create", "catalog.read"] });
    expect(m.roles.find((r) => r.role === "CASHIER")).toMatchObject({ customized: true, permissions: ["sale.create", "catalog.read"] });
    await setRolePermissions(infra, owner, "CASHIER", { reset: true });
    expect((await roleMatrix(infra, owner)).roles.find((r) => r.role === "CASHIER")!.customized).toBe(false);
    const audit = await listAudit(infra, owner, { limit: 10, action: "roles." });
    expect(audit.items.length).toBe(2);
  });

  it("serves only name and theme publicly", async () => {
    const brand = await publicBrand(infra, slug);
    expect(Object.keys(brand).sort()).toEqual(["name", "theme"]);
  });
  it("unlocks a till with the person's own PIN only, and lists serials in stock", async () => {
    const [m] = await withTenant(infra.db, seed.tenantId, (tx) => tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, seed.staff.CASHIER!)));
    const cashier = { ...actorFor("CASHIER", [seed.stores.paris]), membershipId: m!.id };
    await expect(verifyPin(infra, cashier, "0000")).rejects.toMatchObject({ code: "wrong_pin" });
    expect(await verifyPin(infra, cashier, "4826")).toEqual({ ok: true });
    const watch = seed.variants.find((v) => v.serialized)!;
    const serials = await availableSerials(infra, cashier, seed.stores.paris, watch.id);
    expect(serials.map((x) => x.serial)).toContain("AUR-0001-PAR");
    await expect(availableSerials(infra, cashier, seed.stores.dubai, watch.id)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("lets only approved tills take sales, while any signed-in device can read", async () => {
    const app = createApp(infra, await createAuth(infra));
    const origin = "http://localhost:8787";
    const email = (await withTenant(infra.db, seed.tenantId, (tx) => tx.query.users.findFirst({ where: (u, { eq }) => eq(u.id, seed.staff.CASHIER!) })))!.email;
    const signIn = await app.fetch(new Request(`${origin}/api/auth/auth-kit/sign-in`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email, password: "demo-password-123" }) }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const call = (path: string, init: { method?: string; json?: unknown; device?: string } = {}) =>
      app.fetch(
        new Request(`${origin}/api${path}`, {
          method: init.method ?? "GET",
          headers: { cookie, origin, "x-tenant-id": seed.tenantId, "content-type": "application/json", ...(init.device ? { "x-device-id": init.device } : {}) },
          body: init.json === undefined ? undefined : JSON.stringify(init.json),
        }),
      );

    const deviceId = uuidv7();
    const reg = await call("/devices", { method: "POST", json: { id: deviceId, storeId: seed.stores.paris, name: "Pop-up iPad", platform: "ios" } });
    expect(reg.status).toBe(201);
    expect(((await reg.json()) as { status: string }).status).toBe("pending");

    const scarfId = seed.variants.find((v) => v.sku === "CAR-90-ORCH")!.id;
    const sale = () => ({ id: uuidv7(), storeId: seed.stores.paris, deviceId, createdAt: new Date().toISOString(), lines: [{ variantId: scarfId, quantity: 1 }], tenders: [{ method: "card", amount: 52_000 }], expectedTotal: 52_000 });
    const code = async (r: Response) => ((await r.json()) as { error?: { code: string } }).error?.code;

    expect(await code(await call("/orders", { method: "POST", json: sale() }))).toBe("device_required");
    expect(await code(await call("/orders", { method: "POST", json: sale(), device: deviceId }))).toBe("device_pending");
    expect((await call("/me")).status).toBe(200); // reading still works on a pending device

    const owner = actorFor("OWNER", null);
    await setDeviceStatus(infra, owner, deviceId, "approved");
    const ok = await call("/orders", { method: "POST", json: sale(), device: deviceId });
    expect(ok.status).toBe(201);
    expect(await code(await call("/orders", { method: "POST", json: { ...sale(), deviceId: seed.deviceId }, device: deviceId }))).toBe("device_mismatch");

    await setDeviceStatus(infra, owner, deviceId, "blocked", "Lost on the shop floor");
    expect(await code(await call("/orders", { method: "POST", json: sale(), device: deviceId }))).toBe("device_blocked");
  });
});
