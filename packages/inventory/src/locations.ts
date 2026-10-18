import type { LotPick } from "./lots";

export type LocationKind = "warehouse" | "store" | "bin" | "transit";

export interface Location {
  id: string;
  kind: LocationKind;
  parentId?: string;
  name: string;
}

/** One stock movement of a lot between two locations. */
export interface Movement {
  transferId: string;
  lotId: string;
  quantity: number;
  unitCost: number;
  fromLocationId: string;
  toLocationId: string;
  leg: "dispatch" | "receive";
}

export interface TransferPlan {
  transferId: string;
  transitId: string;
  /** Per pick, in order: dispatch (from -> transit) then receive (transit -> to). Receive legs are expected, not yet done. */
  movements: Movement[];
}

export interface TransferOptions {
  transferId?: string;
  transitId?: string;
}

/** Ancestor chain of a location, nearest parent first. Throws on unknown parent or cycle. */
export function ancestors(id: string, all: readonly Location[]): Location[] {
  const byId = new Map(all.map((l) => [l.id, l]));
  const out: Location[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parentId;
  while (cur !== undefined) {
    if (seen.has(cur)) throw new RangeError(`location cycle at ${cur}`);
    seen.add(cur);
    const p = byId.get(cur);
    if (!p) throw new RangeError(`unknown location ${cur}`);
    out.push(p);
    cur = p.parentId;
  }
  return out;
}

/**
 * Plans a transfer through an in-transit leg so stock is never invisible: from -> transit, then transit -> to.
 * Endpoints must differ and must not be transit locations. Pick quantities must be positive integers.
 */
export function planTransfer(
  from: Location,
  to: Location,
  picks: readonly LotPick[],
  opts: TransferOptions = {},
): TransferPlan {
  if (from.id === to.id) throw new RangeError("transfer endpoints must differ");
  if (from.kind === "transit" || to.kind === "transit") throw new RangeError("endpoints cannot be transit locations");
  const transferId = opts.transferId ?? `xfer:${from.id}:${to.id}`;
  const transitId = opts.transitId ?? `transit:${from.id}:${to.id}`;
  const movements: Movement[] = [];
  for (const p of picks) {
    if (!Number.isSafeInteger(p.quantity) || p.quantity <= 0) throw new RangeError(`bad quantity for lot ${p.lotId}`);
    const base = { transferId, lotId: p.lotId, quantity: p.quantity, unitCost: p.unitCost };
    movements.push({ ...base, fromLocationId: from.id, toLocationId: transitId, leg: "dispatch" });
    movements.push({ ...base, fromLocationId: transitId, toLocationId: to.id, leg: "receive" });
  }
  return { transferId, transitId, movements };
}

export interface Discrepancy {
  lotId: string;
  expected: number;
  received: number;
  diff: number;
  /** short: less arrived. over: more than dispatched. unexpected: lot never dispatched. */
  kind: "short" | "over" | "unexpected";
}

export interface ReceiptResult {
  /** transit -> destination movements for accepted quantity (never more than dispatched). */
  movements: Movement[];
  discrepancies: Discrepancy[];
  /** Quantity still sitting in transit per lot (short receipts), to be received later, returned or written off. */
  remainingInTransit: { lotId: string; quantity: number }[];
}

/**
 * Receives a transfer, possibly partially. Accepts at most the dispatched quantity per lot; shortages stay in
 * transit; excess and unknown lots are reported as discrepancies and not moved. Duplicate lot lines are summed.
 */
export function receiveTransfer(
  plan: TransferPlan,
  received: readonly { lotId: string; quantity: number }[],
): ReceiptResult {
  const got = new Map<string, number>();
  for (const r of received) {
    if (!Number.isSafeInteger(r.quantity) || r.quantity < 0) throw new RangeError(`bad received quantity for ${r.lotId}`);
    got.set(r.lotId, (got.get(r.lotId) ?? 0) + r.quantity);
  }
  const movements: Movement[] = [];
  const discrepancies: Discrepancy[] = [];
  const remainingInTransit: { lotId: string; quantity: number }[] = [];
  const planned = new Set<string>();
  for (const m of plan.movements) {
    if (m.leg !== "receive") continue;
    planned.add(m.lotId);
    const qty = got.get(m.lotId) ?? 0;
    const accepted = Math.min(qty, m.quantity);
    if (accepted > 0) movements.push({ ...m, quantity: accepted });
    if (qty < m.quantity) {
      discrepancies.push({ lotId: m.lotId, expected: m.quantity, received: qty, diff: qty - m.quantity, kind: "short" });
      remainingInTransit.push({ lotId: m.lotId, quantity: m.quantity - qty });
    } else if (qty > m.quantity) {
      discrepancies.push({ lotId: m.lotId, expected: m.quantity, received: qty, diff: qty - m.quantity, kind: "over" });
    }
  }
  for (const [lotId, qty] of got) {
    if (!planned.has(lotId) && qty > 0) {
      discrepancies.push({ lotId, expected: 0, received: qty, diff: qty, kind: "unexpected" });
    }
  }
  return { movements, discrepancies, remainingInTransit };
}
