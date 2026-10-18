import { and, asc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import type { ProductInput } from "@luxury-pos/contracts";
import { posAuditEvents, products, stockLevels, variants, withTenant } from "@luxury-pos/db";
import type { Infra } from "../infra";
import { assertCan, type Actor } from "../lib/context";
import { conflict, notFound } from "../lib/errors";

export async function createProduct(infra: Infra, actor: Actor, input: ProductInput) {
  assertCan(actor, "catalog.write");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const skus = input.variants.map((v) => v.sku);
    const taken = await tx.select({ sku: variants.sku }).from(variants).where(inArray(variants.sku, skus));
    if (taken.length) throw conflict("sku_taken", "SKU already in use", { skus: taken.map((t) => t.sku) });
    const { variants: vs, ...product } = input;
    const [p] = await tx.insert(products).values({ ...product, tenantId: actor.tenantId }).returning();
    const created = await tx.insert(variants).values(vs.map((v) => ({ ...v, tenantId: actor.tenantId, productId: p!.id }))).returning();
    await tx.insert(posAuditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: "product.created", entity: "product", entityId: p!.id, data: { skus } });
    return { ...p!, variants: created };
  });
}

export async function updateProduct(infra: Infra, actor: Actor, id: string, patch: Partial<Omit<ProductInput, "variants">>) {
  assertCan(actor, "catalog.write");
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const [p] = await tx.update(products).set({ ...patch, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if (!p) throw notFound("product");
    return p;
  });
}

/**
 * POS lookup: exact barcode/SKU first (scanner path, index hit), then full-text on name/brand.
 * Returns variants with stock at `storeId` in the same query — no per-row follow-ups.
 */
export async function searchCatalog(infra: Infra, actor: Actor, q: { query?: string; storeId?: string; limit: number }) {
  assertCan(actor, "catalog.read", q.storeId);
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const term = q.query?.trim() ?? "";
    const where = term
      ? or(
          eq(variants.barcode, term),
          eq(variants.sku, term),
          sql`to_tsvector('simple', ${products.name} || ' ' || coalesce(${products.brand}, '')) @@ plainto_tsquery('simple', ${term})`,
          ilike(products.name, `${term.replace(/[%_]/g, "")}%`),
        )
      : undefined;
    return tx
      .select({
        variantId: variants.id,
        productId: products.id,
        name: products.name,
        brand: products.brand,
        sku: variants.sku,
        barcode: variants.barcode,
        options: variants.options,
        price: variants.price,
        compareAt: variants.compareAt,
        taxRateBps: products.taxRateBps,
        serialized: products.serialized,
        imageUrl: sql<string | null>`${products.imageUrls}->>0`,
        onHand: sql<number>`coalesce(${stockLevels.onHand}, 0)`,
        available: sql<number>`coalesce(${stockLevels.onHand} - ${stockLevels.reserved}, 0)`,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .leftJoin(stockLevels, and(eq(stockLevels.variantId, variants.id), q.storeId ? eq(stockLevels.storeId, q.storeId) : sql`false`))
      .where(and(eq(variants.active, true), eq(products.active, true), where))
      .orderBy(asc(products.name), asc(variants.sku))
      .limit(q.limit);
  });
}

/**
 * Delta sync for offline devices: keyset pagination on (updated_at, id), so a
 * pull is an index range scan and never skips rows that share a timestamp.
 */
export async function pullCatalog(infra: Infra, actor: Actor, q: { cursor?: string; limit: number }) {
  assertCan(actor, "catalog.read");
  const [at, id] = q.cursor ? Buffer.from(q.cursor, "base64url").toString().split("|") : [];
  return withTenant(infra.db, actor.tenantId, async (tx) => {
    const after = at && id ? or(gt(variants.updatedAt, new Date(at)), and(eq(variants.updatedAt, new Date(at)), gt(variants.id, id))) : undefined;
    const rows = await tx
      .select({
        variantId: variants.id,
        productId: products.id,
        name: products.name,
        brand: products.brand,
        sku: variants.sku,
        barcode: variants.barcode,
        options: variants.options,
        price: variants.price,
        taxRateBps: products.taxRateBps,
        serialized: products.serialized,
        active: sql<boolean>`${variants.active} and ${products.active}`,
        imageUrl: sql<string | null>`${products.imageUrls}->>0`,
        updatedAt: variants.updatedAt,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(after)
      .orderBy(asc(variants.updatedAt), asc(variants.id))
      .limit(q.limit);
    const last = rows.at(-1);
    return { items: rows, cursor: last ? Buffer.from(`${last.updatedAt.toISOString()}|${last.variantId}`).toString("base64url") : (q.cursor ?? null), done: rows.length < q.limit };
  });
}
