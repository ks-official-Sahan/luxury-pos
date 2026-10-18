import { z } from "zod";
import { PERMISSIONS, ROLES } from "@luxury-pos/core";
import { brandThemeSchema } from "@luxury-pos/theme";

const id = z.uuid();
const minor = z.number().int().safe();
const positiveInt = z.number().int().positive().max(100_000);

export const discountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), bps: z.number().min(0).max(10_000), reason: z.string().max(120).optional() }),
  z.object({ kind: z.literal("fixed"), amount: minor.nonnegative(), reason: z.string().max(120).optional() }),
]);

export const tenderSchema = z.object({
  method: z.enum(["cash", "card", "gift_card", "store_credit", "loyalty_points", "bank_transfer", "other"]),
  amount: minor.positive(),
  reference: z.string().max(120).optional(),
});

/**
 * An order made on a device (online or replayed from the offline outbox).
 * `id` is a client UUIDv7 and the idempotency key: replays return the same order.
 * Prices are recomputed on the server; `expectedTotal` lets it refuse silent drift.
 */
export const createOrderSchema = z.object({
  id,
  storeId: id,
  deviceId: id,
  drawerSessionId: id.optional(),
  customerId: id.optional(),
  createdAt: z.iso.datetime(),
  lines: z
    .array(
      z.object({
        variantId: id,
        quantity: positiveInt,
        /** Only with sale.price_override (or an override token). */
        priceOverride: minor.nonnegative().optional(),
        discount: discountSchema.optional(),
        serialNumber: z.string().max(80).optional(),
        note: z.string().max(280).optional(),
      }),
    )
    .min(1)
    .max(500),
  orderDiscount: discountSchema.optional(),
  redeemPoints: z.number().int().nonnegative().optional(),
  tenders: z.array(tenderSchema).min(1).max(10),
  expectedTotal: minor,
  /** Signed manager approval for actions beyond the cashier's role. */
  overrideToken: z.string().max(2048).optional(),
  note: z.string().max(500).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const refundSchema = z.object({
  id,
  orderId: id,
  lines: z.array(z.object({ orderLineId: id, quantity: positiveInt, restock: z.boolean().default(true) })).min(1),
  tenders: z.array(tenderSchema).min(1),
  reason: z.string().min(2).max(280),
  overrideToken: z.string().max(2048).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const productSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  categoryId: id.optional(),
  taxRateBps: z.number().min(0).max(10_000),
  serialized: z.boolean().default(false),
  attributes: z.record(z.string().max(40), z.string().max(200)).default({}),
  imageUrls: z.array(z.url()).max(20).default([]),
  variants: z
    .array(
      z.object({
        sku: z.string().min(1).max(64),
        barcode: z.string().max(64).optional(),
        options: z.record(z.string().max(40), z.string().max(60)).default({}),
        price: minor.nonnegative(),
        cost: minor.nonnegative().optional(),
        compareAt: minor.nonnegative().optional(),
      }),
    )
    .min(1)
    .max(250),
});
export type ProductInput = z.infer<typeof productSchema>;

export const stockAdjustSchema = z.object({
  id,
  storeId: id,
  variantId: id,
  type: z.enum(["receive", "adjust", "transfer_out", "transfer_in", "consign_in", "consign_out"]),
  quantity: z.number().int().refine((n) => n !== 0, "non-zero"),
  unitCost: minor.nonnegative().optional(),
  reason: z.string().max(280).optional(),
});

export const transferSchema = z.object({
  id,
  fromStoreId: id,
  toStoreId: id,
  lines: z.array(z.object({ variantId: id, quantity: positiveInt })).min(1).max(500),
  note: z.string().max(280).optional(),
});

export const customerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  email: z.email().max(254).optional(),
  phone: z.string().max(32).optional(),
  birthday: z.iso.date().optional(),
  preferences: z.record(z.string().max(40), z.string().max(200)).default({}),
  notes: z.string().max(2000).optional(),
  marketingConsent: z.boolean().default(false),
  assignedStaffId: z.string().optional(),
});

export const overrideRequestSchema = z.object({
  action: z.enum(["void", "refund", "discount", "price", "noSale"]),
  /** Manager signs in on the cashier's device with email + PIN. */
  managerEmail: z.email(),
  pin: z.string().regex(/^\d{4,8}$/),
  storeId: id,
  context: z.string().max(200).optional(),
});

export const drawerOpenSchema = z.object({ id, storeId: id, deviceId: id, openingFloat: minor.nonnegative() });
export const drawerCloseSchema = z.object({ countedCash: minor.nonnegative(), note: z.string().max(280).optional() });
export const drawerMovementSchema = z.object({ kind: z.enum(["paid_in", "paid_out"]), amount: minor.positive(), reason: z.string().min(2).max(200) });

export const themeUpdateSchema = brandThemeSchema;

export const membershipSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(120),
  role: z.enum(ROLES),
  storeIds: z.array(id).nullable().default(null),
});

export const apiTokenSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(PERMISSIONS)).min(1),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export const rangeQuerySchema = z.object({
  storeId: id.optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});

export const syncPullSchema = z.object({
  storeId: id,
  /** Opaque cursor from the previous pull (updated_at,id). */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const askSchema = z.object({ question: z.string().min(3).max(500), storeId: id.optional() });

export type ApiError = { error: { code: string; message: string; details?: unknown } };
export * from "./events";
