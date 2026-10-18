import { ROLES, type Permission, type Role } from "@luxury-pos/core";

/** Role title for display: "AUDITOR" becomes "Auditor". */
export function roleTitle(role: Role): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function roleOrder(a: Role, b: Role): number {
  return ROLES.indexOf(a) - ROLES.indexOf(b);
}

/**
 * Replaces store-vocabulary placeholders with the store's own words.
 * "{Customer}s" gives "Clients"; "{sale}" lowercases the mapped word.
 */
export function withTerms(text: string, term: (word: string) => string): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
    const word = term(key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
    return key.charAt(0) === key.charAt(0).toLowerCase() ? word.toLowerCase() : word;
  });
}

export function humanize(action: string): string {
  return action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Plain-language label for every permission. Placeholders are filled by withTerms. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "sale.create": "Create a {sale}",
  "sale.discount": "Give a discount",
  "sale.discount.override": "Discount above the role's limit",
  "sale.void": "Void a {sale}",
  "sale.refund": "Refund a {sale}",
  "sale.price_override": "Change a price at the till",
  "drawer.open": "Open the cash drawer",
  "drawer.close": "Close the cash drawer",
  "drawer.paid_in_out": "Paid in and paid out",
  "catalog.read": "View products",
  "catalog.write": "Edit products",
  "inventory.read": "View stock",
  "inventory.adjust": "Adjust stock counts",
  "inventory.transfer": "Move stock between {Store}s",
  "inventory.receive": "Receive deliveries",
  "customer.read": "View {customer}s",
  "customer.write": "Create and edit {customer}s",
  "customer.pii": "See full contact details",
  "loyalty.adjust": "Adjust loyalty points",
  "reports.read": "View reports",
  "reports.export": "Export reports",
  "ai.insights": "Ask the AI analyst",
  "staff.manage": "Manage team and roles",
  "store.settings": "Change store settings",
  "store.branding": "Change brand and theme",
  "tenant.billing": "Manage billing",
  "mcp.access": "Connect AI assistants (MCP)",
};

const GROUP_TITLES: Record<string, string> = {
  sale: "Selling",
  drawer: "Cash drawer",
  catalog: "Catalogue",
  inventory: "Stock",
  customer: "{Customer}s",
  loyalty: "Loyalty",
  reports: "Reports",
  ai: "AI",
  staff: "Team",
  store: "Store",
  tenant: "Billing",
  mcp: "Integrations",
};

export type PermissionGroup = { key: string; title: string; items: Permission[] };

/** Groups by the prefix before the first dot, in the catalogue's display order. */
export function groupPermissions(perms: readonly Permission[], term: (word: string) => string): PermissionGroup[] {
  const by = new Map<string, Permission[]>();
  for (const p of perms) {
    const key = p.split(".")[0] ?? p;
    const list = by.get(key);
    if (list) list.push(p);
    else by.set(key, [p]);
  }
  const known = Object.keys(GROUP_TITLES).filter((k) => by.has(k));
  const unknown = [...by.keys()].filter((k) => !(k in GROUP_TITLES));
  return [...known, ...unknown].map((key) => ({
    key,
    title: withTerms(GROUP_TITLES[key] ?? key, term),
    items: by.get(key) ?? [],
  }));
}

export function labelFor(p: Permission, term: (word: string) => string): string {
  return withTerms(PERMISSION_LABELS[p], term);
}

/** Order-insensitive equality for permission sets, store id lists and similar. */
export function sameMembers(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}

/** Store scope: null means every store. */
export function sameScope(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return sameMembers(a, b);
}

export function storesLabel(ids: string[] | null, names: ReadonlyMap<string, string>): string {
  if (ids === null) return "All stores";
  const list = ids.map((id) => names.get(id)).filter((n): n is string => !!n);
  return list.length ? list.join(", ") : "No stores";
}
