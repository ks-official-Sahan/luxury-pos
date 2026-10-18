import { Redis } from "@upstash/redis";
import { createDb } from "@luxury-pos/db";
import { MemoryKv, RedisKv, createRateLimit, type Kv } from "@sahan-sac/auth-kit/cache";
import { createEmailService, emailConfigFromEnv, parseEmailEnv, providerOrder } from "@sahan-sac/email-kit";
import { createResendProvider } from "@sahan-sac/email-kit/providers/resend";
import { createAiService, realProviders, sharedAiHealth } from "@sahan-sac/ai-core/providers";
import { textAiConfigured } from "@sahan-sac/ai-core/availability";
import { createAnalyticsStore } from "@sahan-sac/analytics-kit/store";
import { storageAccountsFromEnv } from "@sahan-sac/media-kit/accounts";
import type { Env } from "./env";

export const LIMITS = {
  "login:ip": { windowSeconds: 600, max: 10, failMode: "closed" },
  "login:acct": { windowSeconds: 900, max: 5, failMode: "closed" },
  "mfa:send:user": { windowSeconds: 600, max: 3, failMode: "closed" },
  "mfa:verify:user": { windowSeconds: 600, max: 10, failMode: "closed" },
  "pin:user": { windowSeconds: 300, max: 5, failMode: "closed" },
  "api:token": { windowSeconds: 60, max: 600, failMode: "open" },
  "ai:tenant": { windowSeconds: 3600, max: 120, failMode: "closed" },
  "write:device": { windowSeconds: 60, max: 300, failMode: "open" },
} as const;
export type LimitName = keyof typeof LIMITS;

/** Every long-lived dependency, built once per process and passed down explicitly. */
export function createInfra(env: Env) {
  const production = env.NODE_ENV === "production";
  const { db, pool } = createDb(env.DATABASE_URL);

  const redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;
  if (production && !redis) console.warn("[infra] Upstash Redis not configured: rate limits and session cache are per-process only");

  const kv: Kv = redis ? new RedisKv(redis, "lpos:") : new MemoryKv();
  const limiter = createRateLimit(LIMITS, { redis, keyPrefix: "lpos:rl:" });
  const limit = async (bucket: string, key: string) => {
    const { ok, resetSeconds } = await limiter.limit(bucket as LimitName, key);
    return { ok, resetSeconds };
  };

  const emailEnv = parseEmailEnv(process.env);
  const emailConfig = emailConfigFromEnv(emailEnv);
  const providers = providerOrder(emailConfig, production).flatMap((name) =>
    name === "resend" && emailConfig.resend ? [createResendProvider(emailConfig.resend)] : [],
  );
  const mail = createEmailService({
    providers,
    audit: async (event) => {
      if (event.action === "email.failed") console.warn("[email] send failed", event.meta);
    },
  });

  const ai = textAiConfigured(env, "chat")
    ? createAiService({ providers: realProviders(env, "chat"), health: sharedAiHealth, timeoutMs: 15_000, deadlineMs: 30_000 })
    : null;

  const analytics = createAnalyticsStore({ redis: () => redis, prefix: "lpos:", log: console });
  const media = storageAccountsFromEnv(process.env);

  return { env, production, db, pool, redis, kv, limit, mail, ai, analytics, media };
}

export type Infra = ReturnType<typeof createInfra>;
