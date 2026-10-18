import { z } from "zod";
import { aiEnvSchema } from "@sahan-sac/ai-core/env";
import { mediaEnvSchema } from "@sahan-sac/media-kit/env";

const list = z
  .string()
  .default("")
  .transform((s) => s.split(/[\s,]+/).filter(Boolean));

const schema = z.object({
  ...aiEnvSchema.shape,
  ...mediaEnvSchema.shape,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 random characters"),
  /** Canonical public origin of the API / web app. */
  SITE_URL: z.url(),
  /** Extra web origins (Electron's app://, preview deploys). */
  APP_ORIGINS: list,
  /** Native schemes that send `expo-origin`. */
  NATIVE_ORIGINS: list.default(["luxurypos://"]),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  /** Directory of the exported web app (apps/pos/dist) to serve on the same origin. */
  WEB_DIST: z.string().optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}
