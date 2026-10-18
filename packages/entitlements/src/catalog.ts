/** Feature and limit catalog plus default plans. Plans are data; resolution lives in subscription.ts. */

export const FEATURES = [
  "pos.core", "pos.offline", "pos.multi_device",
  "inventory.lots_expiry", "inventory.warehouses", "inventory.counts",
  "payments.online", "payments.qr", "multi_currency", "tax.advanced",
  "documents.quotations", "documents.invoices",
  "crm.loyalty", "crm.campaigns",
  "reports.advanced", "ai.insights", "mcp.access", "online_store",
  "integrations.accounting", "integrations.ecommerce", "api.access",
  "audit.export", "branding.custom", "sso",
] as const;
export type Feature = (typeof FEATURES)[number];

export const LIMITS = [
  "stores", "devices_per_store", "staff", "products",
  "orders_per_month", "storage_gb", "api_calls_per_day", "ai_queries_per_month",
] as const;
export type Limit = (typeof LIMITS)[number];

export type LimitValue = number | "unlimited";

export interface Plan {
  id: string;
  name: string;
  /** Integer minor units per interval. */
  priceMinor: number;
  currency: string;
  interval: "month" | "year";
  features: Feature[];
  limits: Partial<Record<Limit, LimitValue>>;
  trialDays?: number;
}

const STARTER_FEATURES: Feature[] = [
  "pos.core", "pos.offline", "inventory.counts", "payments.qr", "documents.invoices", "crm.loyalty",
];
const GROWTH_FEATURES: Feature[] = [
  ...STARTER_FEATURES, "pos.multi_device", "inventory.lots_expiry", "inventory.warehouses",
  "payments.online", "multi_currency", "tax.advanced", "documents.quotations", "crm.campaigns",
  "reports.advanced", "online_store", "integrations.accounting", "integrations.ecommerce",
  "api.access", "branding.custom", "ai.insights",
];

export const DEFAULT_PLANS: Plan[] = [
  {
    id: "trial", name: "Trial", priceMinor: 0, currency: "USD", interval: "month", trialDays: 14,
    features: GROWTH_FEATURES.filter((f) => f !== "integrations.accounting" && f !== "integrations.ecommerce"),
    limits: { stores: 1, devices_per_store: 2, staff: 5, products: 500, orders_per_month: 500, storage_gb: 1, api_calls_per_day: 1000, ai_queries_per_month: 50 },
  },
  {
    id: "starter", name: "Starter", priceMinor: 2900, currency: "USD", interval: "month",
    features: STARTER_FEATURES,
    limits: { stores: 1, devices_per_store: 2, staff: 5, products: 1000, orders_per_month: 1000, storage_gb: 2, api_calls_per_day: 0, ai_queries_per_month: 0 },
  },
  {
    id: "growth", name: "Growth", priceMinor: 9900, currency: "USD", interval: "month",
    features: GROWTH_FEATURES,
    limits: { stores: 5, devices_per_store: 5, staff: 25, products: 25000, orders_per_month: 20000, storage_gb: 25, api_calls_per_day: 50000, ai_queries_per_month: 500 },
  },
  {
    id: "enterprise", name: "Enterprise", priceMinor: 49900, currency: "USD", interval: "month",
    features: [...FEATURES],
    limits: {
      stores: "unlimited", devices_per_store: "unlimited", staff: "unlimited", products: "unlimited",
      orders_per_month: "unlimited", storage_gb: 500, api_calls_per_day: 1000000, ai_queries_per_month: 10000,
    },
  },
];
