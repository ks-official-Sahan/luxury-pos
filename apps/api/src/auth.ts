import { expo } from "@better-auth/expo";
import { createAuthorize, createMfa } from "@sahan-sac/auth-kit";
import { createAuthKitBetterAuth, readBetterAuthSession, type BetterAuthSessionApi } from "@sahan-sac/auth-kit/better-auth";
import { createDrizzleAuthAdapter } from "@sahan-sac/auth-kit/drizzle";
import { createSessionStore } from "@sahan-sac/auth-kit/session/core";
import { renderEmail } from "@sahan-sac/email-kit/layout";
import { authSchema } from "@luxury-pos/db";
import type { Infra } from "./infra";

/**
 * auth-kit on the Better Auth engine: email + password with lockout, emailed
 * MFA codes, hashed session tokens, audit events. Expo apps keep the cookie in
 * SecureStore; the web and Electron apps use the httpOnly cookie.
 */
export async function createAuth(infra: Infra) {
  const { env, db, kv, limit, mail } = infra;
  const adapter = createDrizzleAuthAdapter(db, authSchema);
  const sessionStore = createSessionStore({ adapter, kv, authSecret: env.AUTH_SECRET });

  const sendEmail = async (message: { to: string; subject: string; html: string; text: string }) => {
    const result = await mail.send({ ...message, category: "mfa" });
    return { ok: result.ok };
  };

  const audit = async (event: { action: string }) => {
    if (!infra.production) console.info("[auth]", event.action);
  };

  const mfa = createMfa({
    adapter,
    authSecret: env.AUTH_SECRET,
    limit,
    sendEmail,
    audit,
    renderMfaCode: ({ name, code, minutes }) => {
      const r = renderEmail(
        "Your sign-in code",
        {
          preheader: `Code ${code}`,
          heading: `Hello${name ? ` ${name}` : ""}`,
          paragraphs: [`Your verification code is ${code}.`, `It expires in ${minutes} minutes. If you did not try to sign in, change your password.`],
        },
        { brand: "Luxury POS" },
      );
      return { subject: r.subject, html: r.html, text: r.text };
    },
    claimOnce: async (key, ttl) => kv.set(`once:${key}`, "1", { nx: true, ttlSeconds: ttl }),
  });

  const authorize = createAuthorize({
    adapter,
    authSecret: env.AUTH_SECRET,
    keyPrefix: "lpos:",
    sessionStore,
    mfa,
    bootstrap: async () => {},
    loginFailureWindowSeconds: 900,
    loginFailureMaxAttempts: 5,
    limit,
    failures: {
      reserve: async (key, windowSeconds) => kv.incr(`fail:${key}`, windowSeconds),
      clear: async (key) => void (await kv.del(`fail:${key}`)),
    },
    audit,
    warn: (message, fields) => console.warn(`[auth] ${message}`, fields ?? {}),
    after: (fn) => void Promise.resolve().then(fn),
    sendKnownDeviceEmail: async ({ email, name, ip, browser, os }) => {
      const r = renderEmail(
        "New sign-in to your POS account",
        {
          preheader: "A new device signed in",
          heading: `Hello${name ? ` ${name}` : ""}`,
          paragraphs: ["Your account was used to sign in from a new device. If this was not you, contact your store manager."],
          details: [
            ["IP", ip ?? "unknown"],
            ["Browser", browser ?? "unknown"],
            ["System", os ?? "unknown"],
          ],
        },
        { brand: "Luxury POS" },
      );
      await mail.send({ to: email, subject: r.subject, html: r.html, text: r.text, category: "security" });
    },
  });

  const origins = [env.SITE_URL, ...env.APP_ORIGINS, ...env.NATIVE_ORIGINS];
  const auth = await createAuthKitBetterAuth({
    database: { drizzle: db },
    authorize,
    secret: env.AUTH_SECRET,
    origins,
    production: infra.production,
    revokeSession: (sessionId, userId) => sessionStore.revokeSession(sessionId, { userId, reason: "sign_out" }),
    plugins: [expo()],
  });

  return {
    auth,
    adapter,
    sessionStore,
    // The runtime session carries every field; the declared instance type is narrower.
    readSession: (headers: Headers) => readBetterAuthSession(auth as unknown as BetterAuthSessionApi, headers, "STAFF"),
  };
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
