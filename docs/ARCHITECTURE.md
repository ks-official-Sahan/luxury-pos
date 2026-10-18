# Architecture

A universal, white-label POS: one codebase for iOS, Android, web, Windows, macOS and Linux, one multi-tenant API, and a staff MCP endpoint for AI assistants. Market research and the feature roadmap are in [RESEARCH.md](./RESEARCH.md).

## Overview

```
apps/pos (Expo Router, React Native + RN Web)        apps/desktop (Electron)
  iOS · Android · Web  ──────────────┐                 bundled web build on https://pos.local
                                     │                 main-process /api proxy + receipt printing
                                     ▼                          │
                          apps/api (Hono on Node) ◄─────────────┘
   auth-kit (Better Auth engine) · RBAC per tenant · REST · /mcp (Streamable HTTP)
   ai-core · email-kit · media-kit · analytics-kit · outbox worker
                                     │
                     Postgres (Neon or any PG 15+) with row-level security
                     Upstash Redis (rate limits, session cache)  — optional in dev

packages/core       pure domain: money, pricing/tax, tenders, loyalty, inventory, permissions, UUIDv7
packages/theme      brand theme schema, presets, WCAG contrast guard, token resolver
packages/contracts  zod contracts shared by API, apps and MCP
packages/db         Drizzle schema, migrations, RLS policies, tenant-scoped transactions, seed
```

## Key decisions

| Decision | Why |
| --- | --- |
| **Expo for iOS/Android/web, Electron for desktop**, both on the same Expo web build | One UI codebase. Electron adds what a browser can't: silent receipt printing, kiosk mode, an offline-capable bundled UI. Expo's native apps get SecureStore and haptics. |
| **Pricing runs on both sides from `@luxury-pos/core`** | The till shows the exact total the server will charge, even offline. The server always recomputes and refuses drift (`price_changed`). |
| **Integer minor units, banker's rounding, largest-remainder allocation** | No float drift. Order discounts spread exactly across lines, so tax and partial refunds stay exact per line. |
| **Client UUIDv7 = idempotency key** | Sales made offline replay any number of times and are booked once. Time-ordered ids also index well. |
| **Row-level security on every tenant table** | Defense in depth: even a missed `WHERE tenant_id` can't leak across tenants. `withTenant()` sets a transaction-local `app.tenant_id`, so pooled connections never carry one tenant's context into another request. The API connects as a non-superuser role. |
| **Rollup tables (`daily_sales`, `daily_variant_sales`) written in the order transaction** | Dashboards, AI insights and MCP read O(days × stores) rows instead of scanning orders. They stay correct because they commit together with the sale. |
| **Transactional outbox + `FOR UPDATE SKIP LOCKED` worker** | Receipt emails and webhooks are never lost and never double-sent, and the worker scales horizontally. |
| **auth-kit authenticates; `memberships` authorizes** | auth-kit handles identity, lockout, MFA, hashed sessions and audit. Each person has one role per tenant, optionally limited to some stores. Tenants can adjust the role matrix in `tenant_role_permissions`. |
| **Manager overrides are short-lived HMAC tokens** | A manager approves on the cashier's device with email + PIN. The token is bound to one action, store and cashier, and expires in 2 minutes. Every grant and every denial is audited. |
| **Runtime brand theming** | A store's theme is data (`BrandTheme`), resolved at runtime into tokens. Colours are nudged to pass WCAG AA (text 7:1 target, controls 3:1). No per-brand rebuild. |
| **MCP inside the API, stateless Streamable HTTP** | Tools call the same services the apps use, so the same permission checks apply. A personal access token's scopes cap the tools, and it can never exceed its owner's role. No sticky sessions, so it scales like the rest of the API. |

## Data model (main tables)

- **Identity (auth-kit):** `users`, `user_sessions`, `roles`, `mfa_*`, `webauthn_credentials`, `audit_logs`
- **Tenancy:** `tenants` (theme, loyalty program), `stores` (currency, tax mode, timezone, settings, optional theme), `devices` (per-device receipt sequence), `memberships` (role, store scope, till PIN), `tenant_role_permissions`, `api_tokens`
- **Catalogue:** `categories`, `products` (tax rate, serialized flag, attributes, images), `variants` (SKU, barcode, options, price, cost)
- **Inventory:** `stock_movements` (immutable ledger), `stock_levels` (cached balance with avg cost and reorder point), `serial_items` (certificates, status)
- **Sales:** `orders`, `order_lines` (snapshot of name, price, cost, tax), `payments` (negative amounts for refunds), `refunds`, `drawer_sessions`, `drawer_movements`
- **Clients and loyalty:** `customers` (preferences, notes, consent, tier, balance), `point_lots` (FIFO by expiry), `point_ledger`
- **Ops:** `daily_sales`, `daily_variant_sales`, `pos_audit_events` (append-only), `outbox`

## Request flow: a sale

1. The till prices the cart with `priceCart()` and sends `POST /api/orders` with a UUIDv7 `id`, the lines, the tenders and `expectedTotal`.
2. `authenticate` resolves the session (or token) and the membership. That lookup is cached for 30 s per process.
3. `createOrder` opens one `withTenant` transaction:
   - replay check
   - variants loaded in one query
   - permissions, plus an override token where the cart needs one
   - recompute and compare to `expectedTotal`
   - loyalty check, settle the tenders, reserve serial numbers
   - insert the order, lines, payments and movements (one batched insert each)
   - one upsert for stock, drawer cash, loyalty lots and ledger, and the rollups
   - outbox and audit rows
4. If the network fails, the till queues the same body in the persisted outbox. It replays with backoff. Permanent refusals stay visible for a manager.

## Security

- **Sessions:** auth-kit on Better Auth. Lockout and rate limits, emailed MFA codes, session tokens stored as SHA-256 hashes, known-device emails. Expo keeps the cookie in SecureStore, browsers in an httpOnly cookie. Electron keeps it in the main process jar.
- **CSRF:** auth-kit `originGuard` with `SITE_URL`, `APP_ORIGINS` and `NATIVE_ORIGINS`. Plus `securityHeaders`, a body limit and strict CORS.
- **API tokens:** SHA-256 at rest, shown once, scoped, expiring, revocable, rate limited.
- **Data minimisation:** client contact details are masked without `customer.pii`. AI prompts only carry aggregates, fenced with `wrapUserData`.
- **Payments:** card data never touches the system. Tenders store a processor reference only, which keeps PCI DSS scope to semi-integrated or P2PE terminals.
- **Electron:** `contextIsolation`, `sandbox`, no Node in the renderer, a strict CSP, navigation and new windows blocked, all permission prompts denied, and a two-function preload bridge.

## Scaling

- **API:** stateless, so it scales horizontally. Rate limits and session cache move to Upstash Redis when it is configured.
- **Postgres:** pooled connections (Neon pooler or PgBouncer, transaction mode safe). Every hot path is index-backed: `(tenant, store, created_at)` for orders, keyset sync on `(tenant, updated_at, id)`, a partial index for low stock, GIN full-text search on products and customers.
- **No N+1 queries:** every list endpoint is one or two queries. Per-line writes are batched inserts, and per-variant stock is a single multi-row upsert.
- **Receipt numbers** come from a per-device row lock, so there is no global hot row.
- **The outbox worker** scales with `SKIP LOCKED`.
- **Next steps at scale:** read replicas for reports, partition `stock_movements`, `pos_audit_events` and `orders` by month, and move the rollups to a queue consumer if write contention appears.

## Customisation model

| Layer | What a store controls |
| --- | --- |
| Theme | Palette (light and optional dark), display/body/mono fonts (Google, uploaded URL or system), type scale, radius, density, motion, logo, receipt header and footer, paper width |
| Words | Terminology overrides ("Client", "Maison", "Purchase") |
| Rules | Tax mode, cash rounding, discount cap, receipt email, role matrix, store-scoped staff |
| Loyalty | Points per unit, point value, redemption cap, expiry, tiers with multipliers and perks |

## Running locally

See the [README](../README.md).
