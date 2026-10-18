import type { Href } from "expo-router";
import type { ComponentType } from "react";
import type { Permission } from "@luxury-pos/core";
import { ChartLineUp, Gear, Package, Palette, Receipt, ShoppingBag, UsersThree, IdentificationBadge } from "@/ui/icons";

export type IconType = ComponentType<{ size?: number; color?: string; weight?: "light" | "regular" | "bold" | "fill" }>;

export interface NavItem {
  href: Href;
  /** Base word; store terminology may rename it ("Customer" → "Client"). */
  label: string;
  plural?: boolean;
  icon: IconType;
  permission: Permission | null;
  /** Desktop shortcut: ⌘/Ctrl + this digit. */
  shortcut?: string;
  keywords?: string;
}

/** Floor = selling tasks (phone tab bar). Manage = back office. One list drives sidebar, rail, tabs and the command palette. */
export const NAV: { group: "Floor" | "Manage"; items: NavItem[] }[] = [
  {
    group: "Floor",
    items: [
      { href: "/", label: "Register", icon: ShoppingBag, permission: "sale.create", shortcut: "1", keywords: "sell sale checkout till" },
      { href: "/orders", label: "Orders", icon: Receipt, permission: "reports.read", shortcut: "2", keywords: "receipts refunds returns history" },
      { href: "/clients", label: "Customer", plural: true, icon: UsersThree, permission: "customer.read", shortcut: "3", keywords: "clients customers clienteling loyalty" },
      { href: "/inventory", label: "Stock", icon: Package, permission: "inventory.read", shortcut: "4", keywords: "inventory low stock transfer receive count" },
    ],
  },
  {
    group: "Manage",
    items: [
      { href: "/dashboard", label: "Overview", icon: ChartLineUp, permission: "reports.read", shortcut: "5", keywords: "dashboard analytics reports insights ai" },
      { href: "/team", label: "Team", icon: IdentificationBadge, permission: "staff.manage", shortcut: "6", keywords: "staff roles permissions audit" },
      { href: "/brand", label: "Brand", icon: Palette, permission: "store.branding", shortcut: "7", keywords: "theme colours fonts layout customise" },
      { href: "/settings", label: "Settings", icon: Gear, permission: null, shortcut: "8", keywords: "devices integrations mcp tokens pin account" },
    ],
  },
];

export const isActive = (href: Href, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(String(href)));
