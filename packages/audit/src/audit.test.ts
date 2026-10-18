import { describe, expect, it } from "vitest";
import {
  anchor, appendEntry, canonicalJson, deriveDeviceSecret, diff, glassBreakAuditDraft, isGlassBreakActive, merkleRoot,
  requestGlassBreak, signRequest, signTransaction, verifyChain, verifyRequest, verifyTransaction,
} from "./index";
import type { AuditDraft, AuditEntry } from "./index";

const draft = (n: number, after: unknown = { total: n }): AuditDraft => ({
  tenantId: "t1", at: `2026-01-01T0${n}:00:00.000Z`, actor: { userId: "u1" }, action: "bill.edit", entity: "bill", entityId: "b1", before: { total: 0 }, after,
});
async function build(n: number): Promise<AuditEntry[]> {
  const out: AuditEntry[] = [];
  for (let i = 1; i <= n; i++) out.push(await appendEntry(out[out.length - 1] ?? null, draft(i)));
  return out;
}

describe("canonicalJson", () => {
  it("is order independent and compact", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("handles Date, undefined members, rejects non-finite", () => {
    expect(canonicalJson({ d: new Date("2026-01-01T00:00:00Z"), u: undefined })).toBe('{"d":"2026-01-01T00:00:00.000Z"}');
    expect(() => canonicalJson({ n: NaN })).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
  });
});

describe("chain", () => {
  it("appends and verifies", async () => {
    const c = await build(4);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(c[0]!.prevHash).toBe("0".repeat(64));
    expect(await verifyChain(c)).toEqual({ ok: true });
  });
  it("detects tampering at seq", async () => {
    const c = await build(4);
    c[2] = { ...c[2]!, after: { total: 999 } };
    expect(await verifyChain(c)).toEqual({ ok: false, brokenAt: 3, reason: "hash_mismatch" });
  });
  it("detects removal as seq gap", async () => {
    const c = await build(4);
    expect(await verifyChain([c[0]!, c[2]!, c[3]!])).toEqual({ ok: false, brokenAt: 3, reason: "seq_gap" });
  });
  it("detects rehashed forgery via prev mismatch", async () => {
    const c = await build(3);
    const forged = await appendEntry(c[0]!, draft(2, { total: 5 }));
    expect(await verifyChain([c[0]!, forged, c[2]!])).toEqual({ ok: false, brokenAt: 3, reason: "prev_mismatch" });
  });
  it("merkle root and anchor stable, change on tamper", async () => {
    const c = await build(5);
    const r1 = await merkleRoot(c.map((e) => e.hash));
    expect(await merkleRoot(c.map((e) => e.hash))).toBe(r1);
    const t = [...c]; t[1] = await appendEntry(c[0]!, draft(2, { total: 7 }));
    expect(await merkleRoot(t.map((e) => e.hash))).not.toBe(r1);
    const a = await anchor(c, "2026-01-01");
    expect(a).toMatchObject({ count: 5, firstSeq: 1, lastSeq: 5, root: r1 });
    expect(await anchor(c, "2025-12-31")).toBeNull();
  });
});

describe("diff", () => {
  it("lists changed paths", () => {
    expect(diff({ a: 1, b: { c: 2, d: [1, 2] }, e: 1 }, { a: 1, b: { c: 3, d: [1, 5, 6] }, f: 2 })).toEqual(["b.c", "b.d[1]", "b.d[2]", "e", "f"]);
    expect(diff({ x: 1 }, { x: 1 })).toEqual([]);
  });
});

describe("signing", () => {
  it("transaction sign and verify", async () => {
    const p = { id: "tx1", total: 1000, lines: [{ sku: "a", qty: 1 }] };
    const s = await signTransaction("secret", p);
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyTransaction("secret", { lines: [{ qty: 1, sku: "a" }], total: 1000, id: "tx1" }, s)).toBe(true);
    expect(await verifyTransaction("secret", { ...p, total: 1001 }, s)).toBe(false);
    expect(await verifyTransaction("other", p, s)).toBe(false);
  });
  const base = { secret: "dev-secret", method: "post", path: "/v1/sync", body: '{"a":1}', timestamp: 1_000_000, nonce: "n1" };
  it("request ok, skew, replay, bad signature", async () => {
    const signature = await signRequest(base);
    const seen = new Set<string>();
    const seenNonce = (n: string) => { const had = seen.has(n); seen.add(n); return had; };
    const v = { ...base, signature, now: 1_000_500, seenNonce };
    expect(await verifyRequest(v)).toEqual({ ok: true });
    expect(await verifyRequest(v)).toEqual({ ok: false, reason: "replay" });
    expect(await verifyRequest({ ...v, nonce: "n2" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyRequest({ ...v, body: "x", seenNonce: async () => false })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyRequest({ ...v, now: 1_000_000 + 300_001, seenNonce: async () => false })).toEqual({ ok: false, reason: "skew" });
  });
  it("HKDF deterministic, per device", async () => {
    const a = await deriveDeviceSecret("master", "dev1");
    expect(await deriveDeviceSecret("master", "dev1")).toBe(a);
    expect(await deriveDeviceSecret("master", "dev2")).not.toBe(a);
    expect(await deriveDeviceSecret("master2", "dev1")).not.toBe(a);
  });
});

describe("glass break", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const mk = () => requestGlassBreak({ id: "g1", userId: "u1", reason: "Server outage, need refund override", scopes: ["refund.override"], now, durationMs: 3_600_000, approvedBy: "u2" });
  it("validates request", () => {
    expect(() => requestGlassBreak({ id: "g", userId: "u1", reason: "short", scopes: ["x"], now, durationMs: 1000 })).toThrow(/reason/);
    expect(() => requestGlassBreak({ id: "g", userId: "u1", reason: "long enough reason here", scopes: ["x"], now, durationMs: 5 * 3_600_000 })).toThrow(/duration/);
    expect(() => requestGlassBreak({ id: "g", userId: "u1", reason: "long enough reason here", scopes: [], now, durationMs: 1000 })).toThrow(/scope/);
    expect(() => requestGlassBreak({ id: "g", userId: "u1", reason: "long enough reason here", scopes: ["x"], now, durationMs: 1000, approvedBy: "u1" })).toThrow(/self/);
  });
  it("expiry and scope", () => {
    const g = mk();
    expect(isGlassBreakActive(g, new Date("2026-01-01T10:30:00Z"), "refund.override")).toBe(true);
    expect(isGlassBreakActive(g, new Date("2026-01-01T10:30:00Z"), "other")).toBe(false);
    expect(isGlassBreakActive(g, new Date("2026-01-01T11:00:00Z"), "refund.override")).toBe(false);
    expect(isGlassBreakActive(g, new Date("2026-01-01T09:59:59Z"), "refund.override")).toBe(false);
  });
  it("audit draft chains", async () => {
    const d = glassBreakAuditDraft(mk(), { tenantId: "t1", action: "refund.override", at: now });
    const e = await appendEntry(null, d);
    expect(e.action).toBe("glass_break:refund.override");
    expect(e.actor.userId).toBe("u1");
    expect(await verifyChain([e])).toEqual({ ok: true });
  });
});
