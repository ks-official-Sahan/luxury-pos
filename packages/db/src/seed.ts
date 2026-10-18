import { hashPassword } from "@sahan-sac/auth-kit/password";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { uuidv7, type LoyaltyProgram } from "@luxury-pos/core";
import { PRESETS } from "@luxury-pos/theme";
import { createDb, withSystem, type Db } from "./index";
import { customers, devices, memberships, products, roles, serialItems, stockLevels, stores, tenants, users, variants } from "./schema";

export const DEMO_LOYALTY: LoyaltyProgram = {
  pointsPerUnit: 1,
  pointValueMinor: 1,
  maxRedeemBps: 3000,
  expiryDays: 730,
  tiers: [
    { id: "member", name: "Member", threshold: 0, earnMultiplierBps: 10_000 },
    { id: "gold", name: "Gold", threshold: 1_000_000, earnMultiplierBps: 12_500, perks: ["Private appointments"] },
    { id: "noir", name: "Noir", threshold: 5_000_000, earnMultiplierBps: 15_000, perks: ["Atelier access", "Complimentary engraving"] },
  ],
};

/** Demo business: one luxury maison with two boutiques, staff of three, a small catalogue. Idempotent by slug. */
export async function seedDemo(db: Db, opts: { password?: string; pin?: string; slug?: string } = {}) {
  const slug = opts.slug ?? "maison-aurelia";
  const password = await hashPassword(opts.password ?? "demo-password-123");
  const pinHash = await bcrypt.hash(opts.pin ?? "4826", 10);
  return withSystem(db, async (tx) => {
    await tx.insert(roles).values([
      { name: "PLATFORM_OWNER", label: "Platform owner", rank: 0, system: true },
      { name: "STAFF", label: "Staff", rank: 100, system: true },
    ]).onConflictDoNothing();
    const existing = await tx.execute<{ id: string }>(sql`select id from tenants where slug = ${slug}`);
    if (existing.rows[0]) return null;

    const [tenant] = await tx.insert(tenants).values({ name: "Maison Aurelia", slug, theme: PRESETS.maison, loyalty: DEMO_LOYALTY }).returning();
    const t = tenant!.id;
    const [paris, dubai] = await tx
      .insert(stores)
      .values([
        { tenantId: t, code: "PAR", name: "Paris — Rue Saint-Honoré", currency: "EUR", taxMode: "inclusive", timezone: "Europe/Paris", locale: "fr" },
        { tenantId: t, code: "DXB", name: "Dubai Mall", currency: "AED", taxMode: "exclusive", timezone: "Asia/Dubai" },
      ])
      .returning();

    const people = [
      { email: `owner@${slug}.test`, name: "Hélène Marchand", role: "OWNER", storeIds: null },
      { email: `manager@${slug}.test`, name: "Julien Roux", role: "MANAGER", storeIds: [paris!.id] },
      { email: `cashier@${slug}.test`, name: "Amira Haddad", role: "CASHIER", storeIds: [paris!.id] },
    ] as const;
    const staff = await tx
      .insert(users)
      .values(people.map((p) => ({ id: uuidv7(), email: p.email, name: p.name, passwordHash: password, role: "STAFF" as const })))
      .onConflictDoUpdate({ target: users.email, set: { name: sql`excluded.name` } })
      .returning({ id: users.id, email: users.email });
    await tx.insert(memberships).values(
      people.map((p) => ({ tenantId: t, userId: staff.find((s) => s.email === p.email)!.id, role: p.role, storeIds: p.storeIds ? [...p.storeIds] : null, pinHash })),
    );
    const [till] = await tx
      .insert(devices)
      .values([
        { id: uuidv7(), tenantId: t, storeId: paris!.id, code: "T1", name: "Salon till", platform: "ios" },
        { id: uuidv7(), tenantId: t, storeId: dubai!.id, code: "T1", name: "Front desk", platform: "windows" },
      ])
      .returning();

    const catalog = [
      { name: "Aurelia Tourbillon 41mm", brand: "Aurelia", taxRateBps: 2000, serialized: true, variants: [{ sku: "AUR-TB41-RG", options: { Metal: "Rose gold" }, price: 4_850_000, cost: 2_100_000 }] },
      { name: "Le Sac Plume", brand: "Aurelia", taxRateBps: 2000, serialized: false, variants: [
        { sku: "PLM-NOIR-M", options: { Colour: "Noir", Size: "M" }, price: 420_000, cost: 120_000 },
        { sku: "PLM-IVOI-M", options: { Colour: "Ivoire", Size: "M" }, price: 420_000, cost: 120_000 },
        { sku: "PLM-NOIR-S", options: { Colour: "Noir", Size: "S" }, price: 360_000, cost: 100_000 },
      ] },
      { name: "Silk Carré 90", brand: "Aurelia", taxRateBps: 2000, serialized: false, variants: [{ sku: "CAR-90-ORCH", options: { Print: "Orchidée" }, price: 52_000, cost: 9_000 }] },
      { name: "Eau de Parfum Ambre 100ml", brand: "Aurelia", taxRateBps: 2000, serialized: false, variants: [{ sku: "EDP-AMB-100", barcode: "3760000000017", options: {}, price: 24_500, cost: 4_000 }] },
    ];
    const created: { id: string; sku: string; serialized: boolean }[] = [];
    for (const p of catalog) {
      const [row] = await tx.insert(products).values({ tenantId: t, name: p.name, brand: p.brand, taxRateBps: p.taxRateBps, serialized: p.serialized }).returning({ id: products.id });
      const vs = await tx.insert(variants).values(p.variants.map((v) => ({ ...v, tenantId: t, productId: row!.id }))).returning({ id: variants.id, sku: variants.sku });
      created.push(...vs.map((v) => ({ ...v, serialized: p.serialized })));
    }
    await tx.insert(stockLevels).values(
      created.flatMap((v) => [paris!, dubai!].map((s) => ({ tenantId: t, storeId: s.id, variantId: v.id, onHand: v.serialized ? 2 : 12, reorderPoint: v.serialized ? 1 : 4 }))),
    );
    const watch = created.find((v) => v.serialized)!;
    await tx.insert(serialItems).values([
      { tenantId: t, variantId: watch.id, storeId: paris!.id, serial: "AUR-0001-PAR" },
      { tenantId: t, variantId: watch.id, storeId: paris!.id, serial: "AUR-0002-PAR" },
    ]);
    await tx.insert(customers).values({ tenantId: t, firstName: "Camille", lastName: "Laurent", email: "camille@example.com", preferences: { Size: "M", Colour: "Noir" }, notes: "Prefers private salon appointments.", marketingConsent: true });

    return { tenantId: t, stores: { paris: paris!.id, dubai: dubai!.id }, deviceId: till!.id, staff: Object.fromEntries(people.map((p) => [p.role, staff.find((s) => s.email === p.email)!.id])), variants: created };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, pool } = createDb(url, { max: 1 });
  const result = await seedDemo(db);
  console.log(result ? `seeded tenant ${result.tenantId}` : "demo tenant already exists");
  await pool.end();
}
