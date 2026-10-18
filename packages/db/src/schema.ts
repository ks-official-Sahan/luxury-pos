import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createAuthSchema } from "@sahan-sac/auth-kit/drizzle";
import type { BrandTheme } from "@luxury-pos/theme";
import type { LoyaltyProgram } from "@luxury-pos/core";

/**
 * auth-kit owns identity (users, sessions, MFA, passkeys, its audit log).
 * Its global role only separates the platform operator from everyone else;
 * what a person may do inside a tenant lives in `memberships`.
 */
export const authSchema = createAuthSchema({ roles: ["PLATFORM_OWNER", "STAFF"] as const, defaultRole: "STAFF" });
export const { mfaPurposeEnum, tokenPurposeEnum, roles, users, rolePermissions, userSessions, authTokens, mfaChallenges, mfaRecoveryCodes, webauthnCredentials, auditLogs } = authSchema;

/** Money columns are bigint minor units, read as JS numbers (safe up to 9e15). */
const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

export interface StoreSettings {
  /** Cash rounding increment in minor units (5 = 0.05). */
  cashIncrement: number;
  /** Discount share a role without sale.discount.override may give (bps). */
  maxDiscountBps: number;
  receiptEmail: boolean;
  requireCustomerForSale: boolean;
}

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("starter"),
  region: text("region").notNull().default("eu"),
  theme: jsonb("theme").$type<BrandTheme>(),
  loyalty: jsonb("loyalty").$type<LoyaltyProgram>(),
  createdAt: created(),
});

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("UTC"),
    taxMode: text("tax_mode", { enum: ["inclusive", "exclusive"] }).notNull(),
    address: jsonb("address").$type<Record<string, string>>().notNull().default({}),
    settings: jsonb("settings").$type<StoreSettings>().notNull().default({ cashIncrement: 1, maxDiscountBps: 1000, receiptEmail: true, requireCustomerForSale: false }),
    /** Store-level look; falls back to the tenant theme. */
    theme: jsonb("theme").$type<BrandTheme>(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("stores_tenant_code").on(t.tenantId, t.code)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    /** Last receipt sequence issued on this device; incremented under the row lock. */
    receiptSeq: integer("receipt_seq").notNull().default(0),
    lastSeenAt: ts("last_seen_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("devices_store_code").on(t.storeId, t.code)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** null = all stores. */
    storeIds: uuid("store_ids").array(),
    /** bcrypt of the 4-8 digit till PIN used for quick switch and manager overrides. */
    pinHash: text("pin_hash"),
    commissionBps: integer("commission_bps").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [uniqueIndex("memberships_tenant_user").on(t.tenantId, t.userId), index("memberships_user").on(t.userId)],
);

/** Tenant edits to the default permission matrix (core/permissions). */
export const tenantRolePermissions = pgTable(
  "tenant_role_permissions",
  { tenantId: tenantId(), role: text("role").notNull(), permission: text("permission").notNull() },
  (t) => [primaryKey({ columns: [t.tenantId, t.role, t.permission] })],
);

/** Personal access tokens for the MCP server and integrations. Only the SHA-256 is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: created(),
  },
  (t) => [index("api_tokens_tenant").on(t.tenantId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_tenant_slug").on(t.tenantId, t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    brand: text("brand"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    taxRateBps: numeric("tax_rate_bps", { precision: 8, scale: 2, mode: "number" }).notNull(),
    serialized: boolean("serialized").notNull().default(false),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("products_tenant_updated").on(t.tenantId, t.updatedAt, t.id),
    index("products_search").using("gin", sql`to_tsvector('simple', ${t.name} || ' ' || coalesce(${t.brand}, ''))`),
  ],
);

export const variants = pgTable(
  "variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    price: money("price"),
    cost: money("cost"),
    compareAt: bigint("compare_at", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("variants_tenant_sku").on(t.tenantId, t.sku),
    index("variants_tenant_barcode").on(t.tenantId, t.barcode),
    index("variants_product").on(t.productId),
    index("variants_tenant_updated").on(t.tenantId, t.updatedAt, t.id),
  ],
);

/** Cached balance per store × variant, updated in the same transaction as each movement. */
export const stockLevels = pgTable(
  "stock_levels",
  {
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    avgCost: money("avg_cost"),
    reorderPoint: integer("reorder_point").notNull().default(0),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.variantId] }),
    index("stock_levels_low").on(t.tenantId, t.storeId).where(sql`${t.onHand} - ${t.reserved} <= ${t.reorderPoint}`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey(),
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    type: text("type").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: bigint("unit_cost", { mode: "number" }),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    reason: text("reason"),
    actorId: text("actor_id"),
    createdAt: created(),
  },
  (t) => [index("stock_movements_variant").on(t.tenantId, t.storeId, t.variantId, t.createdAt)],
);

export const serialItems = pgTable(
  "serial_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    variantId: uuid("variant_id").notNull().references(() => variants.id),
    storeId: uuid("store_id").references(() => stores.id),
    serial: text("serial").notNull(),
    status: text("status", { enum: ["in_stock", "reserved", "sold", "consigned", "repair", "returned"] }).notNull().default("in_stock"),
    certificateUrl: text("certificate_url"),
    orderLineId: uuid("order_line_id"),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("serial_items_tenant_serial").on(t.tenantId, t.serial)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    birthday: date("birthday"),
    preferences: jsonb("preferences").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    assignedStaffId: text("assigned_staff_id"),
    tierId: text("tier_id"),
    pointsBalance: integer("points_balance").notNull().default(0),
    lifetimeSpend: money("lifetime_spend"),
    lastPurchaseAt: ts("last_purchase_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("customers_tenant_email").on(t.tenantId, sql`lower(${t.email})`),
    index("customers_tenant_phone").on(t.tenantId, t.phone),
    index("customers_search").using("gin", sql`to_tsvector('simple', ${t.firstName} || ' ' || coalesce(${t.lastName}, '') || ' ' || coalesce(${t.email}, ''))`),
    check("customers_points_nonneg", sql`${t.pointsBalance} >= 0`),
  ],
);

export const pointLots = pgTable(
  "point_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    points: integer("points").notNull(),
    remaining: integer("remaining").notNull(),
    expiresAt: ts("expires_at"),
    createdAt: created(),
  },
  (t) => [index("point_lots_live").on(t.customerId, t.expiresAt).where(sql`${t.remaining} > 0`)],
);

export const pointLedger = pgTable(
  "point_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    delta: integer("delta").notNull(),
    kind: text("kind", { enum: ["earn", "redeem", "expire", "adjust", "reverse"] }).notNull(),
    orderId: uuid("order_id"),
    actorId: text("actor_id"),
    createdAt: created(),
  },
  (t) => [index("point_ledger_customer").on(t.customerId, t.createdAt)],
);

export const drawerSessions = pgTable(
  "drawer_sessions",
  {
    id: uuid("id").primaryKey(),
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    deviceId: uuid("device_id").notNull(),
    openedBy: text("opened_by").notNull(),
    openingFloat: money("opening_float"),
    /** Float + cash sales − cash refunds ± paid in/out; maintained per order. */
    expectedCash: money("expected_cash"),
    countedCash: bigint("counted_cash", { mode: "number" }),
    variance: bigint("variance", { mode: "number" }),
    openedAt: created(),
    closedAt: ts("closed_at"),
    closedBy: text("closed_by"),
  },
  (t) => [uniqueIndex("drawer_one_open_per_device").on(t.deviceId).where(sql`${t.closedAt} is null`)],
);

export const drawerMovements = pgTable("drawer_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  sessionId: uuid("session_id").notNull().references(() => drawerSessions.id),
  kind: text("kind", { enum: ["paid_in", "paid_out"] }).notNull(),
  amount: money("amount"),
  reason: text("reason").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: created(),
});

export const orders = pgTable(
  "orders",
  {
    /** Client UUIDv7 = idempotency key. */
    id: uuid("id").primaryKey(),
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    deviceId: uuid("device_id").notNull(),
    drawerSessionId: uuid("drawer_session_id"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    staffId: text("staff_id").notNull(),
    receiptNo: text("receipt_no").notNull(),
    status: text("status", { enum: ["completed", "partially_refunded", "refunded", "voided"] }).notNull().default("completed"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal"),
    discountTotal: money("discount_total"),
    taxTotal: money("tax_total"),
    total: money("total"),
    refundedTotal: money("refunded_total"),
    pointsEarned: integer("points_earned").notNull().default(0),
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    approvedBy: text("approved_by"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_store_created").on(t.tenantId, t.storeId, t.createdAt),
    index("orders_tenant_created_id").on(t.tenantId, t.createdAt, t.id),
    index("orders_customer").on(t.customerId, t.createdAt),
    index("orders_staff").on(t.tenantId, t.staffId, t.createdAt),
    uniqueIndex("orders_receipt").on(t.tenantId, t.receiptNo),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price"),
    unitCost: money("unit_cost"),
    lineDiscount: money("line_discount"),
    orderDiscount: money("order_discount"),
    tax: money("tax"),
    total: money("total"),
    taxRateBps: numeric("tax_rate_bps", { precision: 8, scale: 2, mode: "number" }).notNull(),
    serialNumber: text("serial_number"),
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
  },
  (t) => [index("order_lines_order").on(t.orderId), check("order_lines_refund_le_qty", sql`${t.refundedQuantity} <= ${t.quantity}`)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    refundId: uuid("refund_id"),
    method: text("method").notNull(),
    /** Negative for refunds. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    reference: text("reference"),
    createdAt: created(),
  },
  (t) => [index("payments_order").on(t.orderId)],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  total: money("total"),
  reason: text("reason").notNull(),
  staffId: text("staff_id").notNull(),
  approvedBy: text("approved_by"),
  createdAt: created(),
});

/** Pre-aggregated sales per store per local day: dashboards and MCP answer from here, never by scanning orders. */
export const dailySales = pgTable(
  "daily_sales",
  {
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull(),
    day: date("day").notNull(),
    orders: integer("orders").notNull().default(0),
    items: integer("items").notNull().default(0),
    gross: money("gross"),
    discounts: money("discounts"),
    tax: money("tax"),
    net: money("net"),
    refunds: money("refunds"),
    cost: money("cost"),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.day] }), index("daily_sales_tenant_day").on(t.tenantId, t.day)],
);

export const dailyVariantSales = pgTable(
  "daily_variant_sales",
  {
    tenantId: tenantId(),
    storeId: uuid("store_id").notNull(),
    day: date("day").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull().default(0),
    revenue: money("revenue"),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.day, t.variantId] }), index("dvs_tenant_day").on(t.tenantId, t.day)],
);

/** Append-only POS audit trail (auth events live in auth-kit's audit_logs). */
export const posAuditEvents = pgTable(
  "pos_audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantId(),
    storeId: uuid("store_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
  },
  (t) => [index("pos_audit_tenant_created").on(t.tenantId, t.createdAt), index("pos_audit_action").on(t.tenantId, t.action, t.createdAt)],
);

/** Transactional outbox: written in the business transaction, delivered by the worker (emails, webhooks). */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantId(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: created(),
    processedAt: ts("processed_at"),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending").on(t.availableAt).where(sql`${t.processedAt} is null`)],
);

/** Tables RLS isolates by `app.tenant_id` (see migrations/rls.sql). */
export const TENANT_TABLES = [
  "stores",
  "devices",
  "memberships",
  "tenant_role_permissions",
  "api_tokens",
  "categories",
  "products",
  "variants",
  "stock_levels",
  "stock_movements",
  "serial_items",
  "customers",
  "point_lots",
  "point_ledger",
  "drawer_sessions",
  "drawer_movements",
  "orders",
  "order_lines",
  "payments",
  "refunds",
  "daily_sales",
  "daily_variant_sales",
  "pos_audit_events",
  "outbox",
] as const;
