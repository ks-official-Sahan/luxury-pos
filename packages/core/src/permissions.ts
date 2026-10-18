/**
 * Tenant-scoped authorization. auth-kit authenticates the staff member;
 * a membership row gives them one role per tenant (optionally limited to stores),
 * and this catalogue decides what that role may do.
 */
export const PERMISSIONS = [
  "sale.create",
  "sale.discount",
  "sale.discount.override", // above the role's discount cap
  "sale.void",
  "sale.refund",
  "sale.price_override",
  "drawer.open",
  "drawer.close",
  "drawer.paid_in_out",
  "catalog.read",
  "catalog.write",
  "inventory.read",
  "inventory.adjust",
  "inventory.transfer",
  "inventory.receive",
  "customer.read",
  "customer.write",
  "customer.pii", // full contact details, not masked
  "loyalty.adjust",
  "reports.read",
  "reports.export",
  "ai.insights",
  "staff.manage",
  "store.settings",
  "store.branding",
  "tenant.billing",
  "mcp.access",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["OWNER", "ADMIN", "MANAGER", "SUPERVISOR", "ASSOCIATE", "CASHIER", "STOCK", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

const ALL = new Set<Permission>(PERMISSIONS);
const ASSOCIATE: Permission[] = ["sale.create", "sale.discount", "drawer.open", "catalog.read", "inventory.read", "customer.read", "customer.write"];

/** Defaults; a tenant can override the matrix per role (stored as rows). */
export const DEFAULT_MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: ALL,
  ADMIN: new Set(PERMISSIONS.filter((p) => p !== "tenant.billing")),
  MANAGER: new Set<Permission>([
    ...ASSOCIATE,
    "sale.discount.override",
    "sale.void",
    "sale.refund",
    "sale.price_override",
    "drawer.close",
    "drawer.paid_in_out",
    "catalog.write",
    "inventory.adjust",
    "inventory.transfer",
    "inventory.receive",
    "customer.pii",
    "loyalty.adjust",
    "reports.read",
    "reports.export",
    "ai.insights",
    "staff.manage",
    "store.settings",
    "mcp.access",
  ]),
  SUPERVISOR: new Set<Permission>([...ASSOCIATE, "sale.void", "sale.refund", "drawer.close", "drawer.paid_in_out", "reports.read", "inventory.receive"]),
  ASSOCIATE: new Set(ASSOCIATE),
  CASHIER: new Set<Permission>(["sale.create", "drawer.open", "catalog.read", "customer.read"]),
  STOCK: new Set<Permission>(["catalog.read", "inventory.read", "inventory.adjust", "inventory.transfer", "inventory.receive"]),
  AUDITOR: new Set<Permission>(["catalog.read", "inventory.read", "customer.read", "reports.read", "reports.export", "mcp.access"]),
};

/** Roles that can never be granted these, whatever the tenant matrix says. */
const NEVER: Partial<Record<Role, Permission[]>> = {
  CASHIER: ["staff.manage", "tenant.billing"],
  AUDITOR: ["sale.create", "sale.refund", "sale.void", "inventory.adjust"],
};

export type PermissionMatrix = Partial<Record<Role, ReadonlySet<Permission>>>;

export interface Membership {
  tenantId: string;
  role: Role;
  /** null = every store in the tenant. */
  storeIds: readonly string[] | null;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && ALL.has(value as Permission);
}

export function can(membership: Membership | null, permission: Permission, opts: { storeId?: string; matrix?: PermissionMatrix } = {}): boolean {
  if (!membership) return false;
  if (opts.storeId && membership.storeIds && !membership.storeIds.includes(opts.storeId)) return false;
  if (NEVER[membership.role]?.includes(permission)) return false;
  if (membership.role === "OWNER") return true;
  const grants = opts.matrix?.[membership.role] ?? DEFAULT_MATRIX[membership.role];
  return grants.has(permission);
}

/** Actions a cashier can complete only with a manager PIN (or remote approval). */
export const OVERRIDE_ACTIONS = {
  void: "sale.void",
  refund: "sale.refund",
  discount: "sale.discount.override",
  price: "sale.price_override",
  noSale: "drawer.paid_in_out",
} as const satisfies Record<string, Permission>;
export type OverrideAction = keyof typeof OVERRIDE_ACTIONS;

/** Roles a manager may assign: strictly lower in the list, never OWNER. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "OWNER") return [...ROLES];
  const rank = ROLES.indexOf(actor);
  return ROLES.filter((r, i) => i > rank && r !== "OWNER");
}
