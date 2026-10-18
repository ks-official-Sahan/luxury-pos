import { assertMinor, divHalfEven, floorDiv, lcm, toSafe } from "./math";
import type { BreakdownEntry, Exemptions, RoundingScope, TaxEntry, TaxGroup, TaxInput, TaxRate, TaxResult, TaxedLine } from "./model";

const PPM = 1_000_000n;
/** k factors carry ppm squared. */
const D = PPM * PPM;

/** A rate prepared for one line. Hidden = exempt inclusive: still extracted from the price, never charged. */
export interface PreparedRate {
  rate: TaxRate;
  charged: boolean;
}

export interface CoreLine {
  id: string;
  groupId: string;
  amount: number;
  rates: PreparedRate[];
}

/** Drop exempt rates. Exempt inclusive rates stay (hidden) because the sticker price still contains them. */
export function prepareRates(group: TaxGroup, ex?: Exemptions): PreparedRate[] {
  const ids = ex?.taxRateIds;
  const all = Boolean(ex?.certificate) && !ids;
  const out: PreparedRate[] = [];
  for (const rate of group.rates) {
    if (!Number.isInteger(rate.ratePpm) || rate.ratePpm < 0) throw new RangeError(`rate ${rate.id}: ratePpm must be a non-negative integer`);
    const exempt = all || (ids?.includes(rate.id) ?? false);
    if (exempt && !rate.inclusive) continue;
    out.push({ rate, charged: !exempt });
  }
  return out;
}

interface Factors {
  /** Tax per unit of net, scaled by D. */
  k: bigint[];
  /** Denominator of every exact tax value: D plus inclusive factors. */
  den: bigint;
}

/**
 * tax_i = net * k_i / D, and amount = net * (D + sum inclusive k) / D, so
 * tax_i = amount * k_i / den exactly. Compound rates see only preceding non-compound taxes.
 */
function factors(rates: PreparedRate[]): Factors {
  let sumNonCompound = 0n;
  let inc = 0n;
  const k = rates.map(({ rate }) => {
    const r = BigInt(rate.ratePpm);
    const ki = rate.compound ? r * (PPM + sumNonCompound) : r * PPM;
    if (!rate.compound) sumNonCompound += r;
    if (rate.inclusive) inc += ki;
    return ki;
  });
  return { k, den: D + inc };
}

/** Integer amount of each prepared rate per line, rounded per `scope`. Rows align with `lines`. */
function allocate(lines: CoreLine[], fac: Factors[], scope: RoundingScope): bigint[][] {
  const exact = lines.map((l, i) => fac[i]!.k.map((k) => BigInt(l.amount) * k));
  if (scope === "line") return exact.map((row, i) => row.map((n) => divHalfEven(n, fac[i]!.den)));

  const result: bigint[][] = lines.map((l) => l.rates.map(() => 0n));
  const byRate = new Map<string, { li: number; ri: number }[]>();
  lines.forEach((l, li) => l.rates.forEach((p, ri) => {
    const list = byRate.get(p.rate.id) ?? [];
    list.push({ li, ri });
    byRate.set(p.rate.id, list);
  }));

  for (const cells of byRate.values()) {
    const common = cells.reduce((acc, c) => lcm(acc, fac[c.li]!.den), 1n);
    const scaled = cells.map((c) => exact[c.li]![c.ri]! * (common / fac[c.li]!.den));
    const total = divHalfEven(scaled.reduce((a, b) => a + b, 0n), common);
    const floors = scaled.map((s) => floorDiv(s, common));
    const rems = scaled.map((s, i) => s - floors[i]! * common);
    let residual = total - floors.reduce((a, b) => a + b, 0n);
    // Largest remainder, ties to the earliest line, so lines always sum to the single rounded total.
    const order = rems.map((r, i) => ({ r, i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? 1 : -1));
    const bump = new Set<number>();
    for (const { i } of order) {
      if (residual <= 0n) break;
      bump.add(i);
      residual -= 1n;
    }
    cells.forEach((c, i) => {
      result[c.li]![c.ri] = floors[i]! + (bump.has(i) ? 1n : 0n);
    });
  }
  return result;
}

export interface CoreResult {
  lines: TaxedLine[];
  breakdown: Record<string, BreakdownEntry>;
  totals: { net: number; tax: number; gross: number };
}

/**
 * Shared engine for order lines and fee lines. Invariants: per line
 * net + sum(inclusive taxes) = amount and gross = net + charged taxes; totals are
 * exact sums of lines, so rounding can never leave a penny unaccounted for.
 */
export function runCore(lines: CoreLine[], scope: RoundingScope): CoreResult {
  const seen = new Set<string>();
  for (const l of lines) {
    assertMinor(l.amount, `line ${l.id} amount`);
    if (seen.has(l.id)) throw new Error(`duplicate line id "${l.id}"`);
    seen.add(l.id);
  }
  const fac = lines.map((l) => factors(l.rates));
  const amounts = allocate(lines, fac, scope);

  const breakdown: Record<string, BreakdownEntry> = {};
  let net = 0n;
  let tax = 0n;
  let gross = 0n;
  const out = lines.map((l, li): TaxedLine => {
    const a = amounts[li]!;
    const A = BigInt(l.amount);
    let inclusive = 0n;
    let charged = 0n;
    let nonCompoundBefore = 0n;
    const entries: { p: PreparedRate; amt: bigint; base: bigint }[] = [];
    l.rates.forEach((p, ri) => {
      if (p.rate.inclusive) inclusive += a[ri]!;
      entries.push({ p, amt: a[ri]!, base: nonCompoundBefore });
      if (!p.rate.compound) nonCompoundBefore += a[ri]!;
    });
    const lineNet = A - inclusive;
    const taxes: TaxEntry[] = [];
    for (const e of entries) {
      if (!e.p.charged) continue;
      charged += e.amt;
      taxes.push({ rateId: e.p.rate.id, name: e.p.rate.name, amount: toSafe(e.amt, "tax") });
      const taxable = lineNet + (e.p.rate.compound ? e.base : 0n);
      const b = (breakdown[e.p.rate.id] ??= { name: e.p.rate.name, ratePpm: e.p.rate.ratePpm, inclusive: Boolean(e.p.rate.inclusive), taxable: 0, tax: 0 });
      b.taxable = toSafe(BigInt(b.taxable) + taxable, "taxable");
      b.tax = toSafe(BigInt(b.tax) + e.amt, "tax");
    }
    net += lineNet;
    tax += charged;
    gross += lineNet + charged;
    return { id: l.id, groupId: l.groupId, net: toSafe(lineNet, "net"), taxes, gross: toSafe(lineNet + charged, "gross") };
  });
  return { lines: out, breakdown, totals: { net: toSafe(net, "net"), tax: toSafe(tax, "tax"), gross: toSafe(gross, "gross") } };
}

/**
 * Compute taxes for an order. Group resolution: jurisdiction.classes[taxClass], else
 * defaultGroupId. "invoice" rounding rounds each rate once over all lines, then spreads
 * the result back to lines by largest remainder.
 */
export function computeTaxes(input: TaxInput): TaxResult {
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const lines = input.lines.map((l): CoreLine => {
    if (!Number.isInteger(l.quantity) || l.quantity < 0) throw new RangeError(`line ${l.id}: quantity must be a non-negative integer`);
    const groupId = input.jurisdiction.classes[l.taxClass] ?? input.jurisdiction.defaultGroupId;
    const group = groups.get(groupId);
    if (!group) throw new Error(`unknown tax group "${groupId}" for line ${l.id}`);
    return { id: l.id, groupId, amount: l.amount, rates: prepareRates(group, input.exemptions) };
  });
  const core = runCore(lines, input.rounding);
  const result: TaxResult = { currency: input.currency, rounding: input.rounding, lines: core.lines, totals: core.totals, breakdown: core.breakdown };
  if (input.exemptions?.certificate) result.exemptionCertificate = input.exemptions.certificate;
  return result;
}
