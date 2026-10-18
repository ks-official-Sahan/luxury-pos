# Luxury POS

A universal, brand-customizable point of sale. Luxury retail is the flagship use case, but it adapts to any store. One codebase covers **iOS, Android, web, Windows, macOS and Linux**, backed by a multi-tenant API and a **staff MCP server** for AI-assisted management.

- **Research:** market, flaws in current POS systems, UI/UX findings, opportunities and roadmap → [docs/RESEARCH.md](docs/RESEARCH.md)
- **Product and design:** [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [docs/UI_CONVENTIONS.md](docs/UI_CONVENTIONS.md)
- **Architecture:** decisions, events and Kafka, edge gateway, Django and microservice readiness, data model, security, scaling → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Operations:** Docker, nginx, backups and restore drills → [docs/OPERATIONS.md](docs/OPERATIONS.md)
- **API contract:** [docs/openapi.json](docs/openapi.json) (also served at `/api/openapi.json`)
- **Kits:** how the `@sahan-sac/*` packages are used and what to fix upstream → [docs/SAHAN-KITS.md](docs/SAHAN-KITS.md)

## What's in the box

| Area | Highlights |
| --- | --- |
| Selling | Barcode/SKU search, serialized pieces, line and order discounts, split tender (card, cash with rounding and change, gift card, store credit, points), manager PIN approvals, refunds, receipts (silent print on desktop) |
| Offline | Same pricing engine on device and server; sales queue in a persisted outbox and replay idempotently |
| Clienteling | Client search, preferences, notes, tier, points history, purchase history; contact details masked without permission |
| Inventory | Immutable stock ledger, receive, count corrections, transfers, weighted-average cost, low stock with velocity-based reorder suggestions |
| Loyalty | Points, tiers with multipliers, redemption caps, FIFO expiring lots, refund claw-back |
| Management | Per-tenant roles (Owner → Auditor), store scope, tenant-editable permission matrix, drawer open/close with blind count and Z-report, audit trail, loss-prevention signals |
| Insights | Rollup-backed dashboards and an AI analyst (`@sahan-sac/ai-core`, free-first provider chain) |
| Branding | Brand studio per tenant or store: light and dark palettes (OKLCH-derived neutrals, contrast report), fonts and scale, radius, density, motion, register layout (sale side, tiles or list, tile size, photos, stock, quick cash), store vocabulary, logo, receipt. Live preview, W3C design token export |
| Back office | Overview dashboard (period comparison, best sellers, team, needs attention, AI analyst), orders with refunds, team with editable role matrix and audit trail, settings with offline queue, till PIN, devices, MCP tokens |
| Shell | Sidebar, rail or phone tab bar by screen size; store switcher re-themes the app; live sync status; ⌘/Ctrl+K command palette and keyboard shortcuts |
| MCP | `/mcp` Streamable HTTP endpoint with 18 tools (sales, best sellers, low stock, staff, loss prevention, products, clients, orders, order detail, team, role matrix, audit trail, AI analyst, previewed stock adjustment and transfer) and a daily briefing prompt. Scoped personal access tokens |
| Events | CloudEvents domain events via the transactional outbox, relayed to Kafka when configured |
| Edge | Cloudflare Worker gateway: static app, origin failover, per-context routing, edge cache, rate limits |

**@sahan-sac kits:**

- `auth-kit` + `auth-kit-client`: sessions, lockout, MFA, Hono guards, Expo client
- `ai-core`: insights
- `email-kit`: MFA codes and receipts with provider fallback
- `media-kit`: signed direct uploads to Cloudinary, S3 or R2
- `analytics-kit`: cookieless usage analytics

## Layout

```
apps/api       Hono API + MCP endpoint + outbox worker (events → Kafka)
apps/pos       Expo Router app (iOS, Android, web)
apps/desktop   Electron shell (Windows, macOS, Linux)
apps/edge      Cloudflare Worker edge gateway
docker/, infra/, scripts/   images, nginx, Postgres init, backup and restore
packages/core  domain logic (pure, tested)
packages/theme brand theming (pure, tested)
packages/contracts, packages/db
docs/          research and architecture
```

## Quick start

Requirements: Node 22+, pnpm 10, Postgres 15+.

```bash
pnpm install

# Local database: creates an owner role and a non-superuser app role (so RLS is enforced), then migrates
bash scripts/dev-db.sh
DATABASE_URL=postgres://app_user:app@localhost:5432/luxury_pos pnpm --filter @luxury-pos/db seed

# API (serves the web build too when WEB_DIST is set)
cp apps/api/.env.example apps/api/.env   # fill AUTH_SECRET etc.
pnpm --filter @luxury-pos/pos build:web
cd apps/api && set -a && . ./.env && set +a && WEB_DIST=../pos/dist pnpm start
# → http://localhost:8787  (demo: owner@maison-aurelia.test / demo-password-123, manager PIN 4826)
```

**Demo history** (realistic sales through the real order service, for dashboards and the AI analyst):

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm demo 45
```

**Everything in Docker** (Postgres, Redis, API, worker, nginx; add `--profile events` for Redpanda, `--profile ops` for scheduled backups):

```bash
cp .env.docker.example .env.docker && docker compose --env-file .env.docker up --build
# → http://localhost:8080
```

**Native and desktop:**

```bash
EXPO_PUBLIC_API_URL=https://api.your-store.com pnpm --filter @luxury-pos/pos dev   # Expo Go / dev client
pnpm --filter @luxury-pos/desktop dev -- --api=http://localhost:8787               # after `pnpm --filter @luxury-pos/desktop bundle:web`
pnpm --filter @luxury-pos/desktop dist:win|dist:mac|dist:linux                     # installers
```

## Connect an AI assistant (MCP)

1. Sign in as a manager.
2. Create a token with `POST /api/tokens`, for example `{"name":"Claude","scopes":["mcp.access","reports.read","inventory.read","customer.read","ai.insights"]}`. The token is shown once.
3. Add a remote MCP server at `https://<api>/mcp` with header `Authorization: Bearer lpos_…`.

Write tools (`adjust_stock`) preview first and only apply with `confirm=true`. Every change is audited under the token owner's name.

## Tests

```bash
pnpm test                      # unit tests: core money/pricing/loyalty/inventory/permissions, theme contrast
TEST_DATABASE_URL=postgres://app_user:app@localhost:5432/luxury_pos pnpm --filter @luxury-pos/api test   # end-to-end on Postgres with RLS
pnpm typecheck
```
