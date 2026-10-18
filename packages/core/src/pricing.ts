import { allocate, applyBps, assertMinor, roundHalfEven, type Minor } from "./money";

export type TaxMode = "inclusive" | "exclusive";

export type Discount =
  | { kind: "percent"; bps: number; reason?: string; approvedBy?: string }
  | { kind: "fixed"; amount: Minor; reason?: string; approvedBy?: string };

export interface PricingLineInput {
  id: string;
  unitPrice: Minor;
  quantity: number;
  /** Tax rate in basis points (2000 = 20%). */
  taxRateBps: number;
  discount?: Discount;
}

export interface PricingInput {
  currency: string;
  taxMode: TaxMode;
  lines: readonly PricingLineInput[];
  orderDiscount?: Discount;
}

export interface PricedLine {
  id: string;
  quantity: number;
  unitPrice: Minor;
  gross: Minor;
  lineDiscount: Minor;
  orderDiscount: Minor;
  /** What the customer pays for the line, tax included. */
  total: Minor;
  tax: Minor;
  /** Line total without tax. */
  net: Minor;
  taxRateBps: number;
}

export interface PricedCart {
  currency: string;
  taxMode: TaxMode;
  lines: PricedLine[];
  subtotal: Minor;
  discountTotal: Minor;
  taxTotal: Minor;
  total: Minor;
  taxBreakdown: { rateBps: number; taxable: Minor; tax: Minor }[];
}

function discountAmount(base: Minor, discount: Discount | undefined): Minor {
  if (!discount) return 0;
  const raw = discount.kind === "percent" ? applyBps(base, Math.min(Math.max(discount.bps, 0), 10_000)) : assertMinor(discount.amount, "discount");
  return Math.min(Math.max(raw, 0), base);
}

/**
 * Deterministic pricing. The client runs it offline for the display;
 * the server runs the same function as the authority before an order is accepted.
 * Order discounts are spread across lines (largest remainder) so tax and
 * partial refunds stay exact per line.
 */
export function priceCart(input: PricingInput): PricedCart {
  const staged = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new RangeError(`line ${line.id}: quantity must be a positive integer`);
    const gross = assertMinor(line.unitPrice * line.quantity, `line ${line.id} gross`);
    const lineDiscount = discountAmount(gross, line.discount);
    return { line, gross, lineDiscount, afterLine: gross - lineDiscount };
  });

  const afterLineTotal = staged.reduce((sum, s) => sum + s.afterLine, 0);
  const orderDiscountTotal = discountAmount(afterLineTotal, input.orderDiscount);
  const shares = allocate(orderDiscountTotal, staged.map((s) => s.afterLine));

  const breakdown = new Map<number, { taxable: Minor; tax: Minor }>();
  const lines: PricedLine[] = staged.map((s, i) => {
    const orderDiscount = shares[i] ?? 0;
    const discounted = s.afterLine - orderDiscount;
    const rate = s.line.taxRateBps;
    let net: Minor;
    let tax: Minor;
    if (input.taxMode === "exclusive") {
      net = discounted;
      tax = applyBps(net, rate);
    } else {
      net = roundHalfEven((discounted * 10_000) / (10_000 + rate));
      tax = discounted - net;
    }
    const bucket = breakdown.get(rate) ?? { taxable: 0, tax: 0 };
    bucket.taxable += net;
    bucket.tax += tax;
    breakdown.set(rate, bucket);
    return {
      id: s.line.id,
      quantity: s.line.quantity,
      unitPrice: s.line.unitPrice,
      gross: s.gross,
      lineDiscount: s.lineDiscount,
      orderDiscount,
      net,
      tax,
      total: net + tax,
      taxRateBps: rate,
    };
  });

  const subtotal = staged.reduce((sum, s) => sum + s.gross, 0);
  const discountTotal = lines.reduce((sum, l) => sum + l.lineDiscount + l.orderDiscount, 0);
  const taxTotal = lines.reduce((sum, l) => sum + l.tax, 0);
  const total = lines.reduce((sum, l) => sum + l.total, 0);

  return {
    currency: input.currency,
    taxMode: input.taxMode,
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    total,
    taxBreakdown: [...breakdown.entries()].sort(([a], [b]) => a - b).map(([rateBps, v]) => ({ rateBps, ...v })),
  };
}

/** Discount above this share of the gross needs a manager override. */
export function discountNeedsApproval(cart: PricedCart, maxDiscountBps: number): boolean {
  if (cart.subtotal === 0) return false;
  return cart.discountTotal * 10_000 > cart.subtotal * maxDiscountBps;
}
