# @sahan-sac kits: how the POS uses them, gaps found, and the upgrade path

The POS reuses the kits published from the `ks-official-sahan/sahan` monorepo (`packages/*`). This note records what we use, what the Sahan admin panel teaches, and the flaws worth fixing upstream as the POS grows. Paths below are in the Sahan repo.

## What the POS uses

| Kit | Version | Used for | Where in the POS |
| --- | --- | --- | --- |
| `auth-kit` | 0.12.1 | Better Auth engine, lockout, MFA, hashed sessions, password hashing, rate limits, Hono guards (`originGuard`, `securityHeaders`, `betterAuthRoute`), Redis/memory KV | `apps/api/src/auth.ts`, `infra.ts`, `app.ts` |
| `auth-kit-client` | 0.1.0 | Sign-in client, API fetch with the session, Expo SecureStore cookie | `apps/pos/src/lib/auth*.ts` |
| `ai-core` | 0.5.0 | Free-first provider chain with hedging and timeouts for the AI analyst | `apps/api/src/services/insights.ts` |
| `email-kit` | 0.4.0 | Receipts and MFA codes with provider fallback, escaped layout | `apps/api/src/worker.ts` |
| `media-kit` | 0.4.1 | Signed direct uploads (Cloudinary, S3, R2) | `apps/api/src/services/media.ts` |
| `analytics-kit` | 0.2.0 | Cookieless page analytics for the web app | `apps/api/src/app.ts`, POS layout |

## Lessons from the Sahan admin panel

Kept: permission-filtered navigation, server-side checks on every action (`authorizeAction`, `notFound()` instead of 403), audit rows written inside the mutation's transaction, cursor pagination for logs, lazy-loaded charts, dark mode.

Improved in the POS:

- **One component system.** Sahan's admin mixes a shadcn config, Mantine (media pages only) and custom components, plus two icon sets. The POS has one primitive layer on semantic tokens and one icon set.
- **Command palette and global search** (absent in Sahan's admin): ⌘/Ctrl+K reaches pages, items, clients and actions.
- **Finer permissions.** Sahan groups emails, webhooks and backups under one `manageSettings`. The POS has 27 permissions, a per-tenant editable matrix with escalation guards, and scoped personal access tokens.
- **Tokens, not CSS files.** Sahan keeps tokens in `style/globals.css` with `app/admin/admin.css` holding only overrides. The POS resolves tokens at runtime per store from data.

## Flaws found in the kits (and the fix)

| # | Finding | Impact on non-Next consumers | Proposed fix |
| --- | --- | --- | --- |
| 1 | `server-only` imported by pure modules (`ai-core` providers/vertex/image, `chat-kit` handler, `blog-kit` generate/helpers, `media-kit` cloudinary) | Node/Hono needs `--conditions=react-server`; Workers and Electron main need the same workaround | Keep `server-only` only in Next-specific entries; add a `"node"`/`"workerd"` export condition without it |
| 2 | `node:crypto` in `auth-kit` (16 files), `media-kit` sigv4/signature, `analytics-kit` store, `email-kit` tracking, `chat-kit` visitor cookie | Blocks Cloudflare Workers (without `nodejs_compat`) and React Native | Web Crypto (`crypto.subtle`) with an async constant-time compare; one shared helper instead of a copy per kit |
| 3 | `next` is a required peer of `auth-kit`; `next/headers` and `next/navigation` in `engines/better-auth.ts`, `unlock-request.ts`, `security/request-device.ts` | Every Hono/Electron/Django-adjacent consumer installs Next | Make `next`, `next-auth`, `nodemailer`, `pg`, `prisma` optional peers; move Next-only code behind `./next` subpaths |
| 4 | `ai-core` `sharedAiHealth` is a `globalThis` singleton | One tenant's provider failures cool down the provider for every tenant | Key health by tenant and provider, or inject the store |
| 5 | Store adapters (`chat-kit` ChatStore, `analytics-kit` store, `email-kit` recipients) have no tenant id | Multi-tenant apps must prefix keys themselves | Add an optional `tenantId` / namespace to every adapter and Redis key |
| 6 | `email-kit` categories are fixed to auth/CMS uses | Receipts travel as `contact` (see `apps/api/src/worker.ts`) | Add `receipt` and `notification` categories (prepared, see below) |
| 7 | `auth-kit-client` 0.1.0 has no injectable token storage and 5 tests | Electron renderer and RN rely on cookie plumbing | Injectable storage, bearer mode, an Expo test target |
| 8 | `auth-kit` README still describes 0.1.0 as unreleased and pins old next-auth betas | Wrong install guidance | Regenerate README tables from `package.json`; check it in `verify-package-artifacts.mjs` |
| 9 | Root `pnpm test` runs only `lib/**` tests; package tests run on prepack | Kit regressions surface late | Run package tests in CI; add Workers (vitest-pool-workers) and RN smoke tests |

### Upstream change prepared in this session

`@sahan-sac/email-kit`: `receipt` and `notification` added to `EMAIL_CATEGORIES` (additive, all 67 package tests pass) with a changeset for a minor release. Once published, `apps/api/src/worker.ts` switches the receipt mail from `contact` to `receipt`.

## Upgrade order

1. Runtime-neutral crypto and conditional exports (unblocks Workers and RN for every kit).
2. Optional peers and `./next` isolation in `auth-kit`.
3. Tenant namespaces in adapters and AI health.
4. `auth-kit-client` storage injection and tests.
5. MCP wrappers: expose `ai-core`, `media-kit` signing and `email-kit` health as MCP tools for the staff server.
