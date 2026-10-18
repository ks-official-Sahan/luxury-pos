# Architecture

A universal, white-label POS: one codebase for iOS, Android, web, Windows, macOS and Linux, one multi-tenant API, and a staff MCP endpoint for AI assistants. Market research and the feature roadmap are in [RESEARCH.md](./RESEARCH.md); the design system in [../DESIGN.md](../DESIGN.md); operations in [OPERATIONS.md](./OPERATIONS.md); the kits we build on in [SAHAN-KITS.md](./SAHAN-KITS.md).

## Overview

```
                    Cloudflare edge (apps/edge, optional)          or   nginx (infra/nginx)
   static web app · rate limits · edge cache for public reads          static app · proxy_cache · limit_req
   origin failover · per-context routing (strangler fig)               primary + backup upstream
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
          apps/api (Node, Hono)           future: Django / split services
          REST + /mcp + /api/openapi.json  serving the same OpenAPI contract
                    │
          Postgres (RLS)  ── outbox ──► worker ──► Kafka topics (CloudEvents)
                                              └──► email, webhooks
```

Inside the API:

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

## Events and streaming

- **Domain events** (`pos.order.created.v1`, `pos.order.refunded.v1`, `pos.stock.adjusted.v1`, `pos.customer.upserted.v1`, `pos.branding.updated.v1`) are CloudEvents 1.0 envelopes validated by zod (`packages/contracts/src/events.ts`). Services call `emit(tx, …)` inside the business transaction, so an event exists if and only if the change committed (transactional outbox).
- **Relay:** the outbox worker batches `event:*` rows and publishes them to Kafka when `KAFKA_BROKERS` is set (Confluent's librdkafka client, idempotent producer, `acks=all`). Topic per entity (`pos.order`, `pos.stock`, …) with an optional prefix; the partition key is the tenant id, so one tenant's events stay ordered. Delivery is at least once; consumers dedupe on the event `id` (a UUIDv7).
- **Why outbox and not "write to Kafka in the request":** no dual-write, no lost events on a broker outage, sales keep working when Kafka is down, and the worker scales with `FOR UPDATE SKIP LOCKED`.
- **Consumers this enables:** a warehouse loader, a search indexer, a loyalty or marketing service, webhooks, or a Django/Celery service, none of which need to import this codebase.

## Backend-agnostic by contract (Django-ready)

- **One contract:** `packages/contracts` (zod) generates the OpenAPI 3.1 document (`pnpm --filter @luxury-pos/contracts openapi` → `docs/openapi.json`, also served at `/api/openapi.json`). Each route carries its required permission (`x-permission`). Any backend that serves this contract, the same error shape (`{ error: { code, message, details } }`) and the same idempotency rule (client UUIDv7 ids) is a drop-in replacement.
- **Routing without a big-bang rewrite:** the edge gateway's `ROUTE_RULES` sends one bounded context at a time (for example `/api/insights` for a Django service with its own agents and LLMs) to the fallback origin, and fails over between origins for reads and UUID-keyed writes. nginx offers the same with a `backup` upstream.
- **Shared database rules a second backend must keep:** connect as the non-superuser role, call `set_config('app.tenant_id', …, true)` per transaction (RLS), write audit rows and outbox events in the same transaction.
- **MCP:** the staff MCP server is stateless Streamable HTTP and only calls services, so a Python MCP server (or several, split by domain) can serve the same tools against the same contract.

## Service boundaries (microservice-ready, not microservices yet)

The API is a modular monolith: each folder in `apps/api/src/services` is a bounded context with no cross-imports of internals (they share only `@luxury-pos/db` tables, `lib/context` and `events/emit`).

| Context | Owns | Publishes | Split-out trigger |
| --- | --- | --- | --- |
| Sales (`orders`, `drawer`, `overrides`) | orders, payments, refunds, drawers | `pos.order.*` | write throughput per tenant |
| Catalogue and stock (`catalog`, `inventory`) | products, variants, stock ledger | `pos.stock.*` | warehouse/e-commerce sync load |
| Clients and loyalty (`customers`) | customers, points | `pos.customer.*` | marketing integrations |
| Reporting and AI (`reports`, `insights`) | rollups (read side) | none | AI cost or heavy analytics; first candidate for Django |
| Administration (`admin`, `backoffice`) | tenants, stores, staff, roles, tokens, branding | `pos.branding.*` | rarely |

Splitting one out means: move the folder behind its own process, give it the tables it owns, route its prefix at the edge, and let the others read its events instead of its tables.

## Deployment

| Piece | Runs on |
| --- | --- |
| API, worker | `docker/api.Dockerfile` (one image, worker by command), any container host; scale both horizontally |
| Web app | `docker/web.Dockerfile` (nginx), Cloudflare Workers static assets (`apps/edge`), or the API's `WEB_DIST` |
| Desktop | electron-builder installers per OS from `.github/workflows/desktop.yml` |
| Mobile | EAS builds (`.github/workflows/mobile.yml`, `apps/pos/eas.json`) |
| Database | Neon or any Postgres 15+; pooled URL for the API, owner URL for migrations and backups |
| Events | Kafka, Redpanda (compose profile `events`) or Confluent Cloud |

CI (`.github/workflows`): typecheck, unit tests, Postgres end-to-end with RLS, web build, edge tests and a Wrangler dry run, Docker builds on PRs; on `main`, multi-arch images to GHCR with SBOM and provenance, a Trivy scan, and the edge deploy; CodeQL weekly; Dependabot.

## Data protection

- Logical backups (`scripts/backup.sh`): `pg_dump -Fc`, verified with `pg_restore --list`, optional `age` encryption, SHA-256 sidecar, off-site copy to S3 or R2, local retention. Scheduled by the compose `backup` service or `.github/workflows/backup.yml`. `scripts/restore.sh` refuses to overwrite a database not named `*_restore` unless forced, so restore drills cannot clobber production.
- Neon point-in-time restore covers the minutes-ago case; logical dumps cover provider loss and portability.

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
- **Ids:** UUIDv7 with a monotonic counter (RFC 9562 method 1), generated on the device; B-tree appends, sortable, and the idempotency key for offline replay.
- **Back-office lists** use keyset pagination on `(created_at, id)` with matching indexes (`orders_tenant_created_id`), so deep pages cost the same as the first.
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
