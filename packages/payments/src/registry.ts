import { classifyError, type AdapterResult, type PaymentAdapter } from "./adapter";
import type { CreateInput, PaymentMethod } from "./types";

export type BreakerState = "closed" | "open" | "half_open";

export interface Attempt {
  adapterId: string;
  outcome: "success" | "declined" | "retryable_error" | "fatal_error" | "skipped_open_circuit";
  error?: string;
}

export type CreateOutcome =
  | { ok: true; adapterId: string; result: AdapterResult; attempts: Attempt[] }
  | { ok: false; error: string; attempts: Attempt[] };

export interface RouterConfig {
  now: () => number;
  /** Consecutive retryable failures before a breaker opens. Default 3. */
  failureThreshold?: number;
  /** Open duration before a half-open probe is allowed. Default 30000. */
  cooldownMs?: number;
}

interface Breaker {
  failures: number;
  openedAt: number | null;
  probing: boolean;
}

/**
 * Routes payments to adapters in priority order with per-adapter circuit breakers.
 * Failover happens ONLY on retryable faults (network/timeout/5xx/429); declines (`failed` results) and
 * fatal errors stop immediately, since retrying elsewhere could double-charge or mask a real decline.
 * Half-open admits exactly one probe; success closes the breaker, failure reopens it.
 */
export class PaymentRouter {
  private readonly adapters: PaymentAdapter[] = [];
  private readonly routes = new Map<string, string[]>();
  private readonly breakers = new Map<string, Breaker>();
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(private readonly cfg: RouterConfig) {
    this.threshold = cfg.failureThreshold ?? 3;
    this.cooldownMs = cfg.cooldownMs ?? 30_000;
  }

  register(adapter: PaymentAdapter): this {
    if (this.adapters.some((a) => a.id === adapter.id)) throw new Error(`adapter ${adapter.id} already registered`);
    this.adapters.push(adapter);
    return this;
  }

  /** Pins adapter order for a method and currency ("*" = any currency). Exact currency wins over "*". */
  setRoute(method: PaymentMethod, currency: string, adapterIds: string[]): this {
    for (const id of adapterIds) if (!this.adapters.some((a) => a.id === id)) throw new Error(`unknown adapter ${id}`);
    this.routes.set(`${method}:${currency === "*" ? "*" : currency.toUpperCase()}`, [...adapterIds]);
    return this;
  }

  /** Candidates in priority order, excluding adapters whose breaker is open and not yet probe-eligible. */
  route(method: PaymentMethod, currency: string): PaymentAdapter[] {
    const cur = currency.toUpperCase();
    const pinned = this.routes.get(`${method}:${cur}`) ?? this.routes.get(`${method}:*`);
    const ordered = pinned
      ? pinned.map((id) => this.adapters.find((a) => a.id === id)).filter((a): a is PaymentAdapter => a !== undefined)
      : this.adapters;
    return ordered.filter((a) => a.methods.includes(method) && a.supportsCurrency(cur) && this.state(a.id) !== "open");
  }

  breakerState(adapterId: string): BreakerState {
    return this.state(adapterId);
  }

  async createWithFailover(input: CreateInput): Promise<CreateOutcome> {
    const attempts: Attempt[] = [];
    const candidates = this.route(input.method, input.currency);
    if (candidates.length === 0) {
      return { ok: false, error: `no available adapter for ${input.method}/${input.currency}`, attempts };
    }
    let lastError = "all adapters failed";
    for (const adapter of candidates) {
      if (!this.acquire(adapter.id)) {
        attempts.push({ adapterId: adapter.id, outcome: "skipped_open_circuit" });
        continue;
      }
      try {
        const result = await adapter.create(input);
        this.onSuccess(adapter.id);
        attempts.push({ adapterId: adapter.id, outcome: result.status === "failed" ? "declined" : "success" });
        return { ok: true, adapterId: adapter.id, result, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        if (classifyError(err) === "retryable") {
          this.onFailure(adapter.id);
          attempts.push({ adapterId: adapter.id, outcome: "retryable_error", error: message });
          continue;
        }
        this.release(adapter.id);
        attempts.push({ adapterId: adapter.id, outcome: "fatal_error", error: message });
        return { ok: false, error: message, attempts };
      }
    }
    return { ok: false, error: lastError, attempts };
  }

  private breaker(id: string): Breaker {
    let b = this.breakers.get(id);
    if (!b) {
      b = { failures: 0, openedAt: null, probing: false };
      this.breakers.set(id, b);
    }
    return b;
  }

  private state(id: string): BreakerState {
    const b = this.breakers.get(id);
    if (!b || b.openedAt === null) return "closed";
    if (this.cfg.now() - b.openedAt < this.cooldownMs) return "open";
    return b.probing ? "open" : "half_open";
  }

  /** Takes permission to call. In half-open this claims the single probe slot. */
  private acquire(id: string): boolean {
    const s = this.state(id);
    if (s === "open") return false;
    if (s === "half_open") this.breaker(id).probing = true;
    return true;
  }

  /** Frees a probe slot after a non-health-related outcome (fatal request error). */
  private release(id: string): void {
    this.breaker(id).probing = false;
  }

  private onSuccess(id: string): void {
    const b = this.breaker(id);
    b.failures = 0;
    b.openedAt = null;
    b.probing = false;
  }

  private onFailure(id: string): void {
    const b = this.breaker(id);
    if (b.probing || b.openedAt !== null) {
      b.openedAt = this.cfg.now();
      b.probing = false;
      return;
    }
    b.failures += 1;
    if (b.failures >= this.threshold) b.openedAt = this.cfg.now();
  }
}
