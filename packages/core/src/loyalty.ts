import type { Minor } from "./money";

export interface LoyaltyTier {
  id: string;
  name: string;
  /** Rolling 12-month spend (minor units) needed to hold the tier. */
  threshold: Minor;
  /** Earn multiplier in basis points (10_000 = 1x, 15_000 = 1.5x). */
  earnMultiplierBps: number;
  perks?: string[];
}

export interface LoyaltyProgram {
  /** Points per one major currency unit spent, before the tier multiplier. */
  pointsPerUnit: number;
  /** Minor units one point is worth on redemption. */
  pointValueMinor: number;
  /** Max share of an order payable in points (bps). */
  maxRedeemBps: number;
  /** Points expire this many days after they are earned (0 = never). */
  expiryDays: number;
  tiers: readonly LoyaltyTier[];
}

/** Highest tier whose threshold the rolling spend meets. Tiers may come in any order. */
export function tierFor(program: LoyaltyProgram, rollingSpend: Minor): LoyaltyTier | null {
  let best: LoyaltyTier | null = null;
  for (const tier of program.tiers) if (rollingSpend >= tier.threshold && (!best || tier.threshold > best.threshold)) best = tier;
  return best;
}

/** Points earned on an eligible amount (tax excluded, after discounts). Floors so the program never over-issues. */
export function pointsEarned(program: LoyaltyProgram, eligible: Minor, currencyExponent: number, tier: LoyaltyTier | null): number {
  if (eligible <= 0) return 0;
  const multiplier = tier?.earnMultiplierBps ?? 10_000;
  return Math.floor((eligible * program.pointsPerUnit * multiplier) / (10 ** currencyExponent * 10_000));
}

/** Largest number of points redeemable on an order, bounded by balance and the redeem cap. */
export function maxRedeemablePoints(program: LoyaltyProgram, orderTotal: Minor, balance: number): number {
  if (program.pointValueMinor <= 0) return 0;
  const capMinor = Math.floor((orderTotal * program.maxRedeemBps) / 10_000);
  return Math.max(0, Math.min(balance, Math.floor(capMinor / program.pointValueMinor)));
}

export interface PointLot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
}

/**
 * Consumes points from the lots expiring soonest (FIFO by expiry, never-expiring last).
 * Returns per-lot deductions; throws when the live balance is short.
 */
export function consumeLots(lots: readonly PointLot[], points: number, now = new Date()): { lotId: string; points: number }[] {
  const live = lots
    .filter((l) => l.remaining > 0 && (!l.expiresAt || l.expiresAt > now))
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  const out: { lotId: string; points: number }[] = [];
  let left = points;
  for (const lot of live) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, points: take });
    left -= take;
  }
  if (left > 0) throw new RangeError("insufficient points");
  return out;
}

export function lotExpiry(program: LoyaltyProgram, earnedAt: Date): Date | null {
  return program.expiryDays > 0 ? new Date(earnedAt.getTime() + program.expiryDays * 86_400_000) : null;
}
