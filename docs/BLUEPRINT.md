# Blueprint: from POS to system of systems

Where the product is, where it is going, and in what order. Status is stated plainly: **Live** (in the app and API, tested end to end), **Engine** (a tested domain package exists, not yet wired into the API and UI), **Planned** (phase noted). Read with [ARCHITECTURE.md](ARCHITECTURE.md), [../DESIGN.md](../DESIGN.md) and [RESEARCH.md](RESEARCH.md).

## 1. Systems we are building

| System | Purpose | Lives in |
| --- | --- | --- |
| **TPS** (transaction processing) | Sales, payments, refunds, returns, drawer, stock movements. Fast, atomic, offline-capable, audited. | Sales, Payments, Inventory contexts |
| **MIS** (management information) | Daily and period reports, stock, staff, tax, Z-reports, exports. | Reporting context (rollups) |
| **DSS** (decision support) | Reorder suggestions, expiry and dead stock, stock-gap analysis, what-if pricing, AI analyst. | Inventory engine, Insights |
| **EIS** (executive information) | Cross-store and cross-country KPIs in one currency, trends, exceptions. | Reporting + FX |
| **CRM** | Operational (clienteling, loyalty at the till), analytical (RFM, cohorts), collaborative (notes, assignments, tickets), strategic (tiers, campaigns, lifetime value). | Clients context |
| **Platform** | Tenants, subscriptions, entitlements, devices, support, integrations, billing. | Administration + platform console |

ERP later adds purchasing, AP/AR and a general ledger on the same event backbone (every TPS fact is already an event).

## 2. Architecture

### 2.1 Packages first, services when a trigger says so

Every domain is a **pure, framework-free package** (no database, no HTTP) with its own tests. The API, the apps, the MCP server and a future Django service all apply the same rules. A package becomes a **separate service** only when a measured trigger fires (write throughput, independent scaling, team ownership, a different runtime). Until then a modular monolith with strict boundaries is faster to change, cheaper to run and has fewer failure modes, while the boundaries and contracts keep extraction a move, not a rewrite.

| Package | Status | What it owns |
| --- | --- | --- |
| `@luxury-pos/core` | Live | Money, pricing, tenders, loyalty, permissions, UUIDv7 |
| `@luxury-pos/theme` | Live | Brand theming, WCAG-safe token resolver |
| `@luxury-pos/contracts` | Live | Zod contracts, OpenAPI 3.1, CloudEvents schemas |
| `@luxury-pos/db` | Live | Schema, RLS, migrations, seed |
| `@luxury-pos/fx` | Engine (22 tests) | ISO 4217, decimal-exact conversion, rate tables (as-of, inverse, triangulation, staleness), foreign cash tender with spread, denominations |
| `@luxury-pos/tax` | Engine (20 tests) | Jurisdictions, tax classes, compound and inclusive rates, exemptions, line vs invoice rounding with exact residual distribution, fees and surcharges |
| `@luxury-pos/payments` | Engine (81 tests) | Payment intent state machine, adapter port, cash, standalone terminal, Stripe (PaymentIntents, Terminal, signed webhooks), EMVCo QR, generic signed gateway, router with failover and circuit breaker, reconciliation, split |
| `@luxury-pos/inventory` | Engine (18 tests) | Units of measure, weight pricing, lots with cost, price and expiry, FEFO/FIFO/LIFO/specific allocation, valuation, warehouses, bins and transit, stock counts with variance and recounts, misplacement detection, ABC cycle counts, replenishment, dead stock |
| `@luxury-pos/barcode` | Engine (18 tests) | EAN/UPC/GTIN, GS1-128 and DataMatrix (lot, expiry, weight, price), in-store price and weight codes, internal codes, scanner vs keyboard detection, Code 128 and EAN-13 rendering, SVG, ZPL, ESC/POS |
| `@luxury-pos/entitlements` | Engine (13 tests) | Plans, features, limits, trials, grace, suspension (read-only export never blocked), add-ons, pay-as-you-go per store, overrides, metering, proration |
| `@luxury-pos/audit` | Engine (14 tests) | Canonical JSON, hash-chained log, Merkle anchoring, diff, transaction signing, device request signing with replay protection, HKDF per-device secrets, glass-break grants |
| `@luxury-pos/documents` | Engine (19 tests) | Quotations, invoices (immutable once issued: amend = credit note + replacement), returns/RMA, credit notes, numbering with custom prefixes and period resets, payment terms, aging, bill and invoice templates with letterhead, thermal and A4 rendering |
| `@sahan-sac/*` kits | Live | auth-kit (sessions, MFA, lockout, CSRF, CSP), ai-core, email-kit, media-kit, analytics-kit. Upgrade in the Sahan repo as needs grow (passkeys, SMS OTP, SSO). |

### 2.2 Bounded contexts and extraction order

| Context | Owns | Events | Extract when | Order |
| --- | --- | --- | --- | --- |
| Payments | payment intents, settlements | `pos.payment.*` | first external gateway in production, PCI review | 1 |
| Inventory | lots, locations, movements, counts, transfers | `pos.stock.*` | warehouses or e-commerce sync load | 2 |
| Reporting / DSS / EIS | rollups, read models | consumes all | heavy analytics or AI cost; Django candidate | 3 |
| Sales | orders, lines, refunds, drawers, documents | `pos.order.*`, `pos.document.*` | write throughput per tenant | 4 |
| Clients / CRM | customers, loyalty, cards, campaigns, tickets | `pos.customer.*` | marketing integrations | 5 |
| Platform | tenants, plans, subscriptions, devices, integrations | `platform.*` | separate operator team | 6 |

Extraction recipe (the edge gateway already supports it): move the folder behind its own process, give it only its tables, route its prefix at the edge, let the others consume its Kafka events instead of reading its tables.

### 2.3 Platforms

| Target | How | Status |
| --- | --- | --- |
| iOS, iPadOS, Android | Expo (React Native) | Live (device QA pending) |
| Web, PWA | Expo web build, served by the API or the edge | Live |
| Windows, macOS, Linux | Electron shell over the web build; silent printing, kiosk, offline UI | Live |
| HarmonyOS NEXT | Does not run Android APKs. Ship the PWA in ArkWeb now; a thin ArkTS shell around the web build when store distribution is needed. | Planned (P3) |
| Hardware | Keyboard-wedge scanners, ESC/POS and ZPL printers, cash drawer kick, scales (GS1 weight codes), customer display | Scanner and printing live; bridges P3 |

## 3. Cross-cutting guarantees

### 3.1 Transactions and correctness
- Every write is one database transaction: order, lines, payments, stock, loyalty, rollups, audit row and outbox event commit together or roll back together.
- Client UUIDv7 ids are idempotency keys: retries and offline replays book once.
- Row locks where contention is real (device receipt counter, drawer, stock level `FOR UPDATE`), keyset pagination, no N+1 (batched inserts, one multi-row upsert per table).
- Row-level security on every tenant table; the API connects as a non-superuser.
- Money as integer minor units; FX and tax in exact rational math with banker's rounding.

### 3.2 Security and audit
| Control | Status |
| --- | --- |
| Sessions, MFA codes, lockout, rate limits, CSRF origin guard, CSP, security headers (auth-kit) | Live |
| Cookies httpOnly, SameSite=Lax (Strict breaks email links into the app), Secure in production | Live |
| Device trust: register, manager approves, only approved tills move money or stock; block and unblock; last IP, user and time | **Live (this release)** |
| Voids (fewer units, remove a line, clear a sale) need `sale.void` or a manager PIN; every void audited, offline-safe | **Live (this release)** |
| Manager overrides bound to action, store and cashier, 2-minute tokens | Live |
| Till lock with PIN and idle auto-lock | Live |
| Scoped, expiring, revocable MCP tokens | Live |
| Hash-chained audit with daily Merkle anchors | Engine, P1 wiring |
| Signed device requests (HKDF per-device secret, nonce, skew window) | Engine, P1 wiring |
| Signed transactions (HMAC over the canonical order) printed on receipts | Engine, P1 wiring |
| Glass-break emergency access with reason, expiry and audit | Engine, P2 UI |
| Post-transaction edits: invoices immutable; corrections only by credit note + replacement, logged with a before/after diff | Engine, P1 wiring |

### 3.3 Offline and sync
- The till always prices locally with the server's rules and never blocks a sale on the network.
- Writes queue in a persisted outbox with backoff; permanent refusals stay visible for a manager, never silently dropped.
- P1 adds: catalog snapshot with delta sync (keyset cursor exists), offline limits per store (max offline sale value, max hours offline, card floor), device heartbeat and connection log, conflict policy per entity (sales and movements are append-only so they never conflict; catalog and clients are last-writer-wins with a server version check).

### 3.4 Performance budgets
| Interaction | Budget | How |
| --- | --- | --- |
| Scan to line on screen | < 50 ms | local catalog, no network |
| Tap to price update | < 16 ms | pure pricing in memory |
| Charge to receipt, online | < 1.5 s p95 | one transaction, indexed paths |
| Charge to receipt, offline | < 200 ms | outbox |
| Dashboard load | < 800 ms | rollup tables, React Query cache, Redis |

### 3.5 Subscriptions and entitlements
Plans (trial, starter, growth, enterprise) grant features and limits; add-ons and per-store pay-as-you-go extend them; operator overrides win. A lapsed subscription goes to grace, then suspended, where reports and export still work so owners are never locked out of their own data. P1 wires `assertCan(feature)` and `withinLimit` into API middleware and hides UI for features a plan lacks.

## 4. Roadmap

Each phase ships behind entitlements, with tests and migrations, and keeps the till fast.

### P1: Operations core (next)
1. **Inventory lots and locations:** lots, locations and counts tables; FEFO allocation inside `createOrder`; expiry and dead-stock alerts; transfers with in-transit; stock count sessions with blind counts, recounts and misplacement matching.
2. **Tax engine:** jurisdictions and tax classes replace the per-product rate; invoice rounding; fees and card surcharges.
3. **Multi-currency:** store base currency plus accepted currencies; rates table with source and as-of; foreign cash tender; EIS totals converted at a declared rate.
4. **Payments:** payment intents table, router configuration per store, Stripe and QR adapters live, webhook endpoint, daily reconciliation.
5. **Documents:** quotations to invoices, returns/RMA to credit notes, custom numbering per store, letterhead and bill templates in Brand studio.
6. **Audit chain, request signing, signed receipts.**
7. **Quick PIN switch** between staff on a till without a full sign-in; operator attribution on every line.
8. **Barcodes:** GS1 and in-store codes at the scanner; label printing (ZPL, ESC/POS) from Stock.

### P2: Back offices and data
1. **Owner admin:** stores, branches, warehouses, countries, time zones, invoice prefixes, devices, staff, roles, offline limits, plan and usage.
2. **Platform console** (SaaS operator): tenants, plans, trials, pay-as-you-go grants, feature flags, device fleet, support access through glass-break, support tickets.
3. **Import, export, backup:** CSV and XLSX for products, stock, clients and prices; full tenant export (JSON + CSV); scheduled self-service backups.
4. **Expenses, categories, suppliers, purchase orders, stock refill.**
5. **Notifications and realtime:** low stock, approvals, device requests, sync failures; server-sent events fed by Redis pub/sub from the event stream.
6. **CRM analytics:** RFM, cohorts, lifetime value; loyalty card designer and templates.

### P3: Channels and hardware
Online store and ordering (shared catalog and stock), reservations and click-and-collect, QR ordering; Shopify, WooCommerce, Xero and QuickBooks connectors on webhooks; hardware bridges (drawer, scale, customer display, label printer); HarmonyOS shell.

### P4: Decision and executive systems, ERP
Demand forecasting, anomaly detection on voids and refunds, executive dashboards across countries, purchasing, AP/AR and general ledger.

## 5. Definition of done for every feature
- Pure rules in a package with tests; API route with contract, permission and entitlement check; migration with RLS; audit row and outbox event in the same transaction.
- Works offline or degrades explicitly; idempotent writes.
- Phone, tablet and desktop layouts; keyboard shortcuts on desktop, thumb targets on touch; WCAG 2.2 AA; checked in `/design` under every preset.
- OpenAPI regenerated; end-to-end test against Postgres with RLS.
