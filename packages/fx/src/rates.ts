import { parseDecimalRatio, ratioToDecimal, type Ratio } from "./bigmath";

export interface Rate {
  base: string;
  quote: string;
  /** Decimal string: units of `quote` per 1 `base`, e.g. "1.0842". */
  rate: string;
  source: string;
  /** ISO timestamp the rate was valid from. */
  asOf: string;
}

export interface ResolvedRate {
  rate: string;
  path: string[];
  /** Oldest asOf among the legs used, so staleness checks stay conservative. */
  asOf: string;
  source: string;
  derived: boolean;
}

interface Entry {
  t: number;
  ratio: Ratio;
  rate: Rate;
}

interface Leg {
  ratio: Ratio;
  t: number;
  asOf: string;
  source: string;
  inverted: boolean;
}

const EPOCH = new Date(0).toISOString();

/**
 * Immutable rate book. Direct quotes win; otherwise the inverse quote, otherwise
 * a triangulation through the pivot. Derived rates are rendered at 18 decimals
 * (half-even) because 1/x is rarely finite; the error is far below one minor unit.
 */
export class RateTable {
  private readonly book = new Map<string, Entry[]>();
  readonly pivot: string;

  constructor(rates: readonly Rate[], opts: { pivot?: string } = {}) {
    this.pivot = opts.pivot ?? "USD";
    for (const rate of rates) {
      const t = Date.parse(rate.asOf);
      if (Number.isNaN(t)) throw new RangeError(`invalid asOf "${rate.asOf}"`);
      const key = `${rate.base}>${rate.quote}`;
      const list = this.book.get(key) ?? [];
      list.push({ t, ratio: parseDecimalRatio(rate.rate), rate });
      this.book.set(key, list);
    }
    // Stable sort: for equal timestamps the later input wins.
    for (const list of this.book.values()) list.sort((a, b) => a.t - b.t);
  }

  private pick(base: string, quote: string, at: number | undefined): Entry | null {
    const list = this.book.get(`${base}>${quote}`);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e && (at === undefined || e.t <= at)) return e;
    }
    return null;
  }

  private leg(base: string, quote: string, at: number | undefined): Leg | null {
    const d = this.pick(base, quote, at);
    if (d) return { ratio: d.ratio, t: d.t, asOf: d.rate.asOf, source: d.rate.source, inverted: false };
    const i = this.pick(quote, base, at);
    if (i) return { ratio: { num: i.ratio.den, den: i.ratio.num }, t: i.t, asOf: i.rate.asOf, source: i.rate.source, inverted: true };
    return null;
  }

  /** Latest rate at or before `at` (or the latest overall). Null when no path exists. */
  get(base: string, quote: string, at?: Date): ResolvedRate | null {
    const t = at?.getTime();
    if (base === quote) return { rate: "1", path: [base], asOf: at ? at.toISOString() : EPOCH, source: "identity", derived: false };

    const direct = this.pick(base, quote, t);
    if (direct) return { rate: direct.rate.rate, path: [base, quote], asOf: direct.rate.asOf, source: direct.rate.source, derived: false };

    const legs: Leg[] = [];
    let path: string[];
    const single = this.leg(base, quote, t);
    if (single) {
      legs.push(single);
      path = [base, quote];
    } else {
      if (base === this.pivot || quote === this.pivot) return null;
      const a = this.leg(base, this.pivot, t);
      const b = this.leg(this.pivot, quote, t);
      if (!a || !b) return null;
      legs.push(a, b);
      path = [base, this.pivot, quote];
    }
    const ratio = legs.reduce<Ratio>((acc, l) => ({ num: acc.num * l.ratio.num, den: acc.den * l.ratio.den }), { num: 1n, den: 1n });
    const oldest = legs.reduce((m, l) => (l.t < m.t ? l : m));
    return {
      rate: ratioToDecimal(ratio),
      path,
      asOf: oldest.asOf,
      source: [...new Set(legs.map((l) => l.source))].join("+"),
      derived: true,
    };
  }
}

/** True when the rate is older than `maxAgeMs` at `now`. Unparseable timestamps count as stale; future ones do not. */
export function isStale(rate: { asOf: string }, now: Date, maxAgeMs: number): boolean {
  const t = Date.parse(rate.asOf);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > maxAgeMs;
}
