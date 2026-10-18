import { create } from "zustand";
import { priceCart, type Discount, type PricedCart, type TaxMode } from "@luxury-pos/core";

export interface CatalogItem {
  variantId: string;
  productId: string;
  name: string;
  brand: string | null;
  sku: string;
  options: Record<string, string>;
  price: number;
  taxRateBps: number;
  serialized: boolean;
  imageUrl: string | null;
  available?: number;
}

export interface CartLine {
  key: string;
  item: CatalogItem;
  quantity: number;
  discount?: Discount;
  priceOverride?: number;
  serialNumber?: string;
}

export interface CartClient {
  id: string;
  name: string;
  tierId: string | null;
  pointsBalance: number;
}

interface CartState {
  lines: CartLine[];
  orderDiscount?: Discount;
  client: CartClient | null;
  add: (item: CatalogItem) => void;
  setQuantity: (key: string, quantity: number) => void;
  update: (key: string, patch: Partial<Pick<CartLine, "discount" | "priceOverride" | "serialNumber">>) => void;
  remove: (key: string) => void;
  setOrderDiscount: (d?: Discount) => void;
  setClient: (c: CartClient | null) => void;
  clear: () => void;
}

export const useCart = create<CartState>()((set) => ({
  lines: [],
  client: null,
  add: (item) =>
    set((s) => {
      // Serialised pieces are always their own line; everything else stacks.
      const same = !item.serialized && s.lines.find((l) => l.item.variantId === item.variantId && !l.discount && l.priceOverride === undefined);
      if (same) return { lines: s.lines.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)) };
      return { lines: [...s.lines, { key: `${item.variantId}:${Date.now().toString(36)}`, item, quantity: 1 }] };
    }),
  setQuantity: (key, quantity) => set((s) => ({ lines: quantity <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) })),
  update: (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  setOrderDiscount: (orderDiscount) => set({ orderDiscount }),
  setClient: (client) => set({ client }),
  clear: () => set({ lines: [], orderDiscount: undefined, client: null }),
}));

/** Same pricing function the server runs: what the cashier sees is what gets charged. */
export function priceLines(lines: CartLine[], orderDiscount: Discount | undefined, currency: string, taxMode: TaxMode): PricedCart {
  return priceCart({
    currency,
    taxMode,
    lines: lines.map((l) => ({ id: l.key, unitPrice: l.priceOverride ?? l.item.price, quantity: l.quantity, taxRateBps: l.item.taxRateBps, discount: l.discount })),
    orderDiscount,
  });
}
