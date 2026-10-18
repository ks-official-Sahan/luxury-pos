import { canonicalJson } from "./canonical";
import { sha256Hex } from "./webcrypto";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditActor { userId: string; deviceId?: string; ip?: string; sessionId?: string }

export interface AuditEntry {
  seq: number;
  tenantId: string;
  at: string;
  actor: AuditActor;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  prevHash: string;
  hash: string;
}

export type AuditDraft = Omit<AuditEntry, "seq" | "prevHash" | "hash">;

type Unhashed = Omit<AuditEntry, "hash">;

export function hashEntry(e: Unhashed): Promise<string> {
  return sha256Hex(canonicalJson(e));
}

/** Append-only: seq = prev.seq + 1 (first is 1), prevHash = prev.hash (genesis zeros), hash covers every other field. */
export async function appendEntry(prev: AuditEntry | null, draft: AuditDraft): Promise<AuditEntry> {
  const body: Unhashed = { ...draft, seq: prev ? prev.seq + 1 : 1, prevHash: prev ? prev.hash : GENESIS_HASH };
  return { ...body, hash: await hashEntry(body) };
}

export interface ChainVerification {
  ok: boolean;
  brokenAt?: number;
  reason?: "hash_mismatch" | "seq_gap" | "prev_mismatch";
}

/**
 * Verifies a contiguous slice. The first entry may start at any seq; its prevHash is trusted
 * only if seq is 1 (must be genesis). Truncating the tail is undetectable here: compare against an anchor.
 */
export async function verifyChain(entries: readonly AuditEntry[]): Promise<ChainVerification> {
  let prev: AuditEntry | null = null;
  for (const e of entries) {
    if (prev === null) {
      if (e.seq === 1 && e.prevHash !== GENESIS_HASH) return { ok: false, brokenAt: e.seq, reason: "prev_mismatch" };
    } else {
      if (e.seq !== prev.seq + 1) return { ok: false, brokenAt: e.seq, reason: "seq_gap" };
      if (e.prevHash !== prev.hash) return { ok: false, brokenAt: e.seq, reason: "prev_mismatch" };
    }
    const { hash, ...rest } = e;
    if ((await hashEntry(rest)) !== hash) return { ok: false, brokenAt: e.seq, reason: "hash_mismatch" };
    prev = e;
  }
  return { ok: true };
}

/** Merkle root (hex). Odd nodes are promoted by pairing with themselves; leaves and nodes are domain separated. Empty -> hash of "". */
export async function merkleRoot(hashes: readonly string[]): Promise<string> {
  if (hashes.length === 0) return sha256Hex("");
  let level = await Promise.all(hashes.map((h) => sha256Hex("leaf:" + h)));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await sha256Hex("node:" + level[i]! + (level[i + 1] ?? level[i]!)));
    }
    level = next;
  }
  return level[0]!;
}

export interface DailyAnchor { day: string; count: number; firstSeq: number; lastSeq: number; lastHash: string; root: string }

/** Anchor for entries whose `at` starts with `day` (YYYY-MM-DD, UTC). Publish `root` externally. Returns null if none. */
export async function anchor(entries: readonly AuditEntry[], day: string): Promise<DailyAnchor | null> {
  const todays = entries.filter((e) => e.at.startsWith(day));
  const first = todays[0];
  const last = todays[todays.length - 1];
  if (!first || !last) return null;
  return {
    day, count: todays.length, firstSeq: first.seq, lastSeq: last.seq, lastHash: last.hash,
    root: await merkleRoot(todays.map((e) => e.hash)),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Changed leaf paths (dot notation, array index as [i]) between two values, sorted. Arrays of differing length report each differing index. */
export function diff(before: unknown, after: unknown): string[] {
  const out: string[] = [];
  walk(before, after, "", out);
  return out.sort();
}

function walk(a: unknown, b: unknown, path: string, out: string[]): void {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a === b) return;
  if (a instanceof Date && b instanceof Date && a.getTime() === b.getTime()) return;
  out.push(path || "$");
}
