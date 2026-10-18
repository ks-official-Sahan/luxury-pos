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

/** Everything needed to put a sale aside and bring it back exactly as it was. */
export interface CartSnapshot {
  lines: CartLine[];
  orderDiscount?: Discount;
  client: CartClient | null;
}

interface CartState extends CartSnapshot {
  /** Line whose editor is open (a serialized piece opens it to pick the serial number). */
  focusKey: string | null;
  focus: (key: string | null) => void;
  restore: (s: CartSnapshot) => void;
  add: (item: CatalogItem) => void;
  setQuantity: (key: string, quantity: number) => void;
  update: (key: string, patch: Partial<Pick<CartLine, "discount" | "priceOverride" | "serialNumber">>) => void;
  remove: (key: string) => void;
  setOrderDiscount: (d?: Discount) => void;
  setClient: (c: CartClient | null) => void;
  clear: () => void;
}

let seq = 0;

export const useCart = create<CartState>()((set) => ({
  lines: [],
  client: null,
  focusKey: null,
  focus: (focusKey) => set({ focusKey }),
  restore: ({ lines, orderDiscount, client }) => set({ lines, orderDiscount, client, focusKey: null }),
  add: (item) =>
    set((s) => {
      // Serialised pieces are always their own line; everything else stacks.
      const same = !item.serialized && s.lines.find((l) => l.item.variantId === item.variantId && !l.discount && l.priceOverride === undefined);
      if (same) return { lines: s.lines.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)) };
      const key = `${item.variantId}:${Date.now().toString(36)}${(seq++).toString(36)}`;
      return { lines: [...s.lines, { key, item, quantity: 1 }], focusKey: item.serialized ? key : s.focusKey };
    }),
  setQuantity: (key, quantity) => set((s) => ({ lines: quantity <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) })),
  update: (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  setOrderDiscount: (orderDiscount) => set({ orderDiscount }),
  setClient: (client) => set({ client }),
  clear: () => set({ lines: [], orderDiscount: undefined, client: null, focusKey: null }),
}));

/** Lines the server would refuse: a serialized piece without its serial number. */
export const missingSerials = (lines: readonly CartLine[]) => lines.filter((l) => l.item.serialized && !l.serialNumber);

/** Same pricing function the server runs: what the cashier sees is what gets charged. */
export function priceLines(lines: CartLine[], orderDiscount: Discount | undefined, currency: string, taxMode: TaxMode): PricedCart {
  return priceCart({
    currency,
    taxMode,
    lines: lines.map((l) => ({ id: l.key, unitPrice: l.priceOverride ?? l.item.price, quantity: l.quantity, taxRateBps: l.item.taxRateBps, discount: l.discount })),
    orderDiscount,
  });
}
