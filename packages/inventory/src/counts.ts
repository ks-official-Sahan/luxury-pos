export interface CountLine {
  productId: string;
  lotId?: string;
  expected: number;
  counted?: number;
  countedBy?: string;
  recount?: number;
}

export interface CountSession {
  id: string;
  locationId: string;
  scope: "full" | "cycle" | "spot";
  /** Blind counts hide `expected` from counters; see blindView. */
  blind: boolean;
  startedAt: string;
  lines: CountLine[];
}

export type VarianceStatus = "match" | "short" | "over" | "uncounted" | "needs_recount";

export interface VarianceOptions {
  /** Absolute unit difference above which an un-recounted line needs a recount. Default 10. */
  thresholdUnits?: number;
  /** Percent of expected above which an un-recounted line needs a recount. Default 10. Expected 0 with any diff exceeds. */
  thresholdPct?: number;
}

export interface LineVariance {
  line: CountLine;
  /** Effective count (recount if present, else counted) minus expected; 0 when uncounted. */
  diff: number;
  /** diff * unit cost, minor units. */
  valueDiff: number;
  status: VarianceStatus;
}

export interface VarianceSummary {
  shrinkUnits: number;
  shrinkValue: number;
  overUnits: number;
  overValue: number;
  needsRecount: number;
  uncounted: number;
  /** Matching lines / counted lines * 100, 2 decimals; 100 when nothing counted. */
  accuracyPct: number;
}

/** Strips expected quantities so a blind counter cannot see them. */
export function blindView(session: CountSession): CountSession {
  return { ...session, lines: session.lines.map((l) => ({ productId: l.productId, ...(l.lotId !== undefined ? { lotId: l.lotId } : {}), expected: 0 })) };
}

function evaluate(line: CountLine, o: VarianceOptions): { diff: number; status: VarianceStatus } {
  if (line.counted === undefined && line.recount === undefined) return { diff: 0, status: "uncounted" };
  const effective = line.recount ?? line.counted ?? 0;
  const diff = effective - line.expected;
  if (diff === 0) return { diff, status: "match" };
  if (line.recount === undefined) {
    const units = o.thresholdUnits ?? 10;
    const pct = o.thresholdPct ?? 10;
    const abs = Math.abs(diff);
    const overPct = line.expected === 0 ? true : (abs / line.expected) * 100 > pct;
    if (abs > units || overPct) return { diff, status: "needs_recount" };
  }
  return { diff, status: diff < 0 ? "short" : "over" };
}

function costOf(line: CountLine, unitCosts: Readonly<Record<string, number>>): number {
  const c = (line.lotId !== undefined ? unitCosts[line.lotId] : undefined) ?? unitCosts[line.productId];
  if (c === undefined) throw new RangeError(`no unit cost for ${line.lotId ?? line.productId}`);
  return c;
}

/**
 * Per-line variance. Unit cost lookup: lotId first, then productId; throws if neither exists.
 * A recount supersedes the first count and is final (never needs_recount). Shrink/over totals only include
 * resolved lines (short/over); needs_recount lines are excluded until recounted.
 */
export function variance(
  session: CountSession,
  unitCosts: Readonly<Record<string, number>>,
  opts: VarianceOptions = {},
): { lines: LineVariance[]; summary: VarianceSummary } {
  const lines: LineVariance[] = session.lines.map((line) => {
    const { diff, status } = evaluate(line, opts);
    return { line, diff, valueDiff: diff * costOf(line, unitCosts), status };
  });
  const s: VarianceSummary = { shrinkUnits: 0, shrinkValue: 0, overUnits: 0, overValue: 0, needsRecount: 0, uncounted: 0, accuracyPct: 100 };
  let counted = 0;
  let matched = 0;
  for (const l of lines) {
    if (l.status === "uncounted") s.uncounted++;
    else counted++;
    if (l.status === "match") matched++;
    else if (l.status === "short") {
      s.shrinkUnits += -l.diff;
      s.shrinkValue += -l.valueDiff;
    } else if (l.status === "over") {
      s.overUnits += l.diff;
      s.overValue += l.valueDiff;
    } else if (l.status === "needs_recount") s.needsRecount++;
  }
  s.accuracyPct = counted === 0 ? 100 : Math.round((matched / counted) * 10000) / 100;
  return { lines, summary: s };
}

export interface MisplacementSuggestion {
  productId: string;
  lotId?: string;
  /** Location that is short: the stock probably belongs here. */
  shortLocationId: string;
  /** Location that is over: the stock is probably sitting here. */
  overLocationId: string;
  quantity: number;
}

export interface MisplacementResult {
  suggestions: MisplacementSuggestion[];
  /** Shortfalls left after matching: genuine shrink candidates. */
  unmatchedShort: { productId: string; lotId?: string; locationId: string; quantity: number }[];
  unmatchedOver: { productId: string; lotId?: string; locationId: string; quantity: number }[];
}

/**
 * Pairs shorts with overs of the same product/lot in different locations before anything is written off.
 * Greedy, largest first, ties by location id; only resolved (short/over) lines participate.
 */
export function suggestMisplacement(
  sessions: readonly CountSession[],
  opts: VarianceOptions = {},
): MisplacementResult {
  type Side = { productId: string; lotId?: string; locationId: string; quantity: number };
  const groups = new Map<string, { shorts: Side[]; overs: Side[] }>();
  for (const s of sessions) {
    for (const line of s.lines) {
      const { diff, status } = evaluate(line, opts);
      if (status !== "short" && status !== "over") continue;
      const key = `${line.productId}\u0000${line.lotId ?? ""}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { shorts: [], overs: [] }));
      const side: Side = { productId: line.productId, ...(line.lotId !== undefined ? { lotId: line.lotId } : {}), locationId: s.locationId, quantity: Math.abs(diff) };
      (status === "short" ? g.shorts : g.overs).push(side);
    }
  }
  const byQty = (a: Side, b: Side) => b.quantity - a.quantity || (a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0);
  const out: MisplacementResult = { suggestions: [], unmatchedShort: [], unmatchedOver: [] };
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    g.shorts.sort(byQty);
    g.overs.sort(byQty);
    for (const sh of g.shorts) {
      for (const ov of g.overs) {
        if (sh.quantity === 0) break;
        if (ov.quantity === 0 || ov.locationId === sh.locationId) continue;
        const q = Math.min(sh.quantity, ov.quantity);
        out.suggestions.push({
          productId: sh.productId,
          ...(sh.lotId !== undefined ? { lotId: sh.lotId } : {}),
          shortLocationId: sh.locationId,
          overLocationId: ov.locationId,
          quantity: q,
        });
        sh.quantity -= q;
        ov.quantity -= q;
      }
    }
    out.unmatchedShort.push(...g.shorts.filter((x) => x.quantity > 0));
    out.unmatchedOver.push(...g.overs.filter((x) => x.quantity > 0));
  }
  return out;
}

export type AdjustmentReason = "count_shrink" | "count_found" | "misplaced" | "damaged" | "expired" | "theft";

export interface CountAdjustment {
  sessionId: string;
  locationId: string;
  productId: string;
  lotId?: string;
  /** Signed base-unit delta to apply to on-hand. */
  delta: number;
  reason: AdjustmentReason;
}

/**
 * Stock adjustments that bring the system to the count. Only resolved lines produce adjustments
 * (needs_recount and uncounted are skipped). Short lines use `reasonDefault`; over lines are "count_found".
 */
export function adjustmentsFromCount(
  session: CountSession,
  reasonDefault: AdjustmentReason = "count_shrink",
  opts: VarianceOptions = {},
): CountAdjustment[] {
  const out: CountAdjustment[] = [];
  for (const line of session.lines) {
    const { diff, status } = evaluate(line, opts);
    if (status !== "short" && status !== "over") continue;
    out.push({
      sessionId: session.id,
      locationId: session.locationId,
      productId: line.productId,
      ...(line.lotId !== undefined ? { lotId: line.lotId } : {}),
      delta: diff,
      reason: status === "short" ? reasonDefault : "count_found",
    });
  }
  return out;
}

export type AbcClass = "A" | "B" | "C";

export interface AbcItem {
  id: string;
  annualValue: number;
}

export interface AbcResult extends AbcItem {
  class: AbcClass;
  /** Share of total value including this item, 0..1. */
  cumulativeShare: number;
}

/**
 * Pareto classification by annual value. Sorted by value desc (id tie-break). An item is A while the value
 * accumulated BEFORE it is below cutoffs[0] of the total, B below cutoffs[1], else C, so the item crossing a
 * boundary stays in the higher class. Zero total value makes everything C.
 */
export function abcClassify(items: readonly AbcItem[], cutoffs: readonly [number, number] = [0.8, 0.95]): AbcResult[] {
  const sorted = [...items].sort((a, b) => b.annualValue - a.annualValue || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = sorted.reduce((s, i) => s + i.annualValue, 0);
  let acc = 0;
  return sorted.map((i) => {
    const cls: AbcClass = total <= 0 ? "C" : acc < cutoffs[0] * total ? "A" : acc < cutoffs[1] * total ? "B" : "C";
    acc += i.annualValue;
    return { ...i, class: cls, cumulativeShare: total <= 0 ? 0 : acc / total };
  });
}

export interface CycleEntry {
  id: string;
  class: AbcClass;
  intervalDays: number;
  /** Day within the interval on which the item is counted. */
  offset: number;
}

/**
 * Spreads each class's items evenly over its interval (item k of a class gets offset k mod interval) so daily
 * workload is level. Intervals are positive integer days, e.g. { A: 30, B: 90, C: 180 }.
 */
export function cycleSchedule(classified: readonly AbcResult[], daysPerClass: Readonly<Record<AbcClass, number>>): CycleEntry[] {
  const idx: Record<AbcClass, number> = { A: 0, B: 0, C: 0 };
  return classified.map((r) => {
    const intervalDays = daysPerClass[r.class];
    if (!Number.isSafeInteger(intervalDays) || intervalDays < 1) throw new RangeError(`bad interval for class ${r.class}`);
    const k = idx[r.class]++;
    return { id: r.id, class: r.class, intervalDays, offset: k % intervalDays };
  });
}

/** Item ids due for counting on integer day number `day` (day 0 = schedule start). */
export function dueOnDay(schedule: readonly CycleEntry[], day: number): string[] {
  return schedule.filter((e) => day % e.intervalDays === e.offset).map((e) => e.id);
}
