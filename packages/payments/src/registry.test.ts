import { describe, expect, it, vi } from "vitest";
import { AdapterError, classifyError, type AdapterResult, type PaymentAdapter } from "./adapter";
import { createStripeAdapter } from "./adapters/stripe";
import { createCashAdapter } from "./adapters/cash";
import { PaymentRouter } from "./registry";
import type { CreateInput, PaymentMethod } from "./types";

const input = (over: Partial<CreateInput> = {}): CreateInput => ({
  idempotencyKey: "k", tenantId: "t", storeId: "s", amount: 1000, currency: "USD", method: "card_online", paymentToken: "pm", metadata: {}, ...over,
});
const fake = (id: string, create: () => Promise<AdapterResult>, methods: PaymentMethod[] = ["card_online"], cur: string[] = []): PaymentAdapter => ({
  id, methods, supportsCurrency: (c) => cur.length === 0 || cur.includes(c), create: vi.fn(create), refund: async () => ({ status: "succeeded" }),
});
const ok = async (): Promise<AdapterResult> => ({ status: "captured", providerRef: "x" });
const boom = (kind: AdapterError["kind"] = "server") => async (): Promise<AdapterResult> => { throw new AdapterError(kind, "down"); };

describe("classifyError", () => {
  it("classifies", () => {
    expect(classifyError(new AdapterError("server", "x"))).toBe("retryable");
    expect(classifyError(new AdapterError("network", "x"))).toBe("retryable");
    expect(classifyError(new AdapterError("timeout", "x"))).toBe("retryable");
    expect(classifyError(new AdapterError("invalid_request", "x"))).toBe("fatal");
    expect(classifyError(new AdapterError("auth", "x"))).toBe("fatal");
    expect(classifyError(new TypeError("fetch failed"))).toBe("retryable");
    expect(classifyError(Object.assign(new Error("e"), { status: 502 }))).toBe("retryable");
    expect(classifyError(new Error("logic"))).toBe("fatal");
    expect(classifyError("str")).toBe("fatal");
  });
});

describe("route", () => {
  it("filters by method and currency in registration order", () => {
    const r = new PaymentRouter({ now: () => 0 })
      .register(fake("a", ok, ["card_online"], ["EUR"]))
      .register(fake("b", ok, ["card_online"]))
      .register(fake("c", ok, ["qr"]));
    expect(r.route("card_online", "usd").map((a) => a.id)).toEqual(["b"]);
    expect(r.route("card_online", "EUR").map((a) => a.id)).toEqual(["a", "b"]);
    expect(r.route("cash", "USD")).toEqual([]);
  });
  it("pinned routes override order; exact currency beats wildcard", () => {
    const r = new PaymentRouter({ now: () => 0 }).register(fake("a", ok)).register(fake("b", ok)).register(fake("c", ok));
    r.setRoute("card_online", "*", ["c", "a"]).setRoute("card_online", "USD", ["b"]);
    expect(r.route("card_online", "USD").map((a) => a.id)).toEqual(["b"]);
    expect(r.route("card_online", "EUR").map((a) => a.id)).toEqual(["c", "a"]);
    expect(() => r.setRoute("qr", "*", ["zzz"])).toThrow();
    expect(() => r.register(fake("a", ok))).toThrow();
  });
});

describe("createWithFailover", () => {
  it("fails over on retryable error and logs attempts", async () => {
    const r = new PaymentRouter({ now: () => 0 }).register(fake("a", boom("network"))).register(fake("b", ok));
    const out = await r.createWithFailover(input());
    expect(out.ok && out.adapterId).toBe("b");
    expect(out.attempts.map((a) => a.outcome)).toEqual(["retryable_error", "success"]);
  });
  it("never fails over on declines", async () => {
    const b = fake("b", ok);
    const r = new PaymentRouter({ now: () => 0 }).register(fake("a", async () => ({ status: "failed", failureCode: "card_declined" }))).register(b);
    const out = await r.createWithFailover(input());
    expect(out.ok && out.result.failureCode).toBe("card_declined");
    expect(out.attempts.map((a) => a.outcome)).toEqual(["declined"]);
    expect(b.create).not.toHaveBeenCalled();
  });
  it("stops on fatal error", async () => {
    const b = fake("b", ok);
    const r = new PaymentRouter({ now: () => 0 }).register(fake("a", boom("invalid_request"))).register(b);
    const out = await r.createWithFailover(input());
    expect(out.ok).toBe(false);
    expect(b.create).not.toHaveBeenCalled();
    expect(out.attempts[0]?.outcome).toBe("fatal_error");
  });
  it("reports when all adapters fail or none exist", async () => {
    const r = new PaymentRouter({ now: () => 0 }).register(fake("a", boom())).register(fake("b", boom("timeout")));
    const out = await r.createWithFailover(input());
    expect(out.ok).toBe(false);
    expect(out.attempts).toHaveLength(2);
    const none = await r.createWithFailover(input({ method: "cash" }));
    expect(none.ok).toBe(false);
    expect(none.attempts).toEqual([]);
  });
  it("Stripe: 402 stays on Stripe, 503 fails over to the next adapter (mocked fetch)", async () => {
    const mkRouter = (status: number, body: unknown) => {
      const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
      const stripe = createStripeAdapter({ secretKey: "sk", fetch: f as unknown as typeof fetch, now: () => 0 });
      const backup = fake("backup", ok);
      return { router: new PaymentRouter({ now: () => 0 }).register(stripe).register(backup), backup, f };
    };
    const decl = mkRouter(402, { error: { code: "card_declined" } });
    const d = await decl.router.createWithFailover(input());
    expect(d.ok && d.adapterId).toBe("stripe");
    expect(d.ok && d.result.status).toBe("failed");
    expect(decl.backup.create).not.toHaveBeenCalled();

    const down = mkRouter(503, {});
    const o = await down.router.createWithFailover(input());
    expect(o.ok && o.adapterId).toBe("backup");
    expect(o.attempts.map((a) => a.adapterId)).toEqual(["stripe", "backup"]);
  });
  it("works with cash adapter", async () => {
    const r = new PaymentRouter({ now: () => 0 }).register(createCashAdapter());
    const out = await r.createWithFailover(input({ method: "cash" }));
    expect(out.ok && out.result.status).toBe("captured");
  });
});

describe("circuit breaker", () => {
  it("opens after N consecutive retryable failures, half-opens after cooldown, closes on probe success", async () => {
    let now = 0;
    let healthy = false;
    const a = fake("a", async () => (healthy ? ok() : boom()()));
    const b = fake("b", ok);
    const r = new PaymentRouter({ now: () => now, failureThreshold: 3, cooldownMs: 1000 }).register(a).register(b);

    for (let i = 0; i < 2; i++) await r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("closed");
    await r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("open");
    expect(r.route("card_online", "USD").map((x) => x.id)).toEqual(["b"]);

    const callsBefore = vi.mocked(a.create).mock.calls.length;
    await r.createWithFailover(input());
    expect(vi.mocked(a.create).mock.calls.length).toBe(callsBefore);

    now = 999;
    expect(r.breakerState("a")).toBe("open");
    now = 1000;
    expect(r.breakerState("a")).toBe("half_open");
    expect(r.route("card_online", "USD").map((x) => x.id)).toEqual(["a", "b"]);

    // failed probe reopens for a fresh cooldown
    await r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("open");
    now = 1999;
    expect(r.breakerState("a")).toBe("open");
    now = 2000;
    expect(r.breakerState("a")).toBe("half_open");

    healthy = true;
    const out = await r.createWithFailover(input());
    expect(out.ok && out.adapterId).toBe("a");
    expect(r.breakerState("a")).toBe("closed");
  });
  it("success and declines reset the consecutive count", async () => {
    let mode: "fail" | "ok" | "decline" = "fail";
    const a = fake("a", async () => (mode === "fail" ? boom()() : mode === "ok" ? ok() : { status: "failed", failureCode: "x" }));
    const r = new PaymentRouter({ now: () => 0, failureThreshold: 2 }).register(a);
    await r.createWithFailover(input());
    mode = "decline";
    await r.createWithFailover(input());
    mode = "fail";
    await r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("closed");
    await r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("open");
  });
  it("half-open admits a single probe at a time", async () => {
    let now = 0;
    let release: (v: AdapterResult) => void = () => {};
    let slow = false;
    const a = fake("a", () => (slow ? new Promise<AdapterResult>((res) => { release = res; }) : boom()()));
    const r = new PaymentRouter({ now: () => now, failureThreshold: 1, cooldownMs: 10 }).register(a);
    await r.createWithFailover(input());
    now = 10;
    slow = true;
    const first = r.createWithFailover(input());
    expect(r.breakerState("a")).toBe("open");
    const second = await r.createWithFailover(input());
    expect(second.ok).toBe(false);
    release({ status: "captured" });
    expect((await first).ok).toBe(true);
    expect(r.breakerState("a")).toBe("closed");
  });
});
