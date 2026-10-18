# Research: Universal, Brand-Customizable, Multi-Tenant POS

Date: 2026-10-18. Scope: iOS/Android/Web/Windows/macOS/Linux POS + staff-facing MCP server. Flagship vertical: luxury retail; must adapt to any store type.

**Evidence legend:** [V] verified in a fetched source this session; [G] general industry knowledge / training data, verify before relying; [?] conflicting or thin sources. Many pricing/review pages are affiliate or competitor-authored; treat as anecdote.

---

## 0. TL;DR (what to build and why)

1. Incumbents split into two camps: cheap SMB POS (Square/Shopify/Clover/Lightspeed) with rigid UI, processor lock-in and tier-gated features; and heavy enterprise suites (Oracle, SAP, Cegid, Salesforce) with long implementations. The gap: **enterprise-grade clienteling, serialized inventory and brand theming at SMB-friendly setup**, processor-agnostic.
2. Differentiators: offline-first with a deterministic ledger, per-tenant white-label theming + plugin SDK, payment-processor-agnostic via semi-integrated terminals (PCI scope stays tiny), MCP server for agentic management with RBAC + approval gates, anomaly detection on voids/refunds.
3. Architecture default: Postgres shared-schema + RLS multi-tenancy, append-only stock/cash/loyalty ledgers, idempotency keys + transactional outbox, outbox-based device sync (server authoritative; CRDT-style counters only where it pays).
4. Vertical = configuration, not code: "vertical packs" (luxury, jewelry, cafe, salon, electronics) toggle modules (serials, appointments, modifiers, tipping, IMEI, repairs).

---

## 1. Market Landscape

### 1.1 Vendor notes

| Vendor | Notes (source quality) |
|---|---|
| Shopify POS | Lite free with plan; Pro ~$89/location/mo needed for staff roles, inventory counts, retail analytics, omnichannel [V: [ringly review](https://www.ringly.io/blog/shopify-pos-reviews)]. In-person ~2.4-2.6% + 10c [V, aggregator]. App Store rating ~2.9-3.0/5 vs Capterra ~4.6 [?: [App Store reviews](https://apps.shopify.com/shopify-pos/reviews)]. |
| Square | $0 base POS; in-person 2.6% + 15c; paid tiers up to ~$149/mo [V aggregator: [NerdWallet](https://www.nerdwallet.com/business/software/learn/square-vs-shopify)]. Offline mode exists but trust issues (see 6). |
| Lightspeed Retail | Tiers ~$89 / $149 / $289 per mo billed yearly, Enterprise custom [V aggregator: [CostBench](https://costbench.com/compare/lightspeed-retail-vs-shopify-pos/)]. Reviews cite glitches/slowdowns, restrictive payment options, iPad cache issues [V: [Capterra](https://www.capterra.com/p/120491/Lightspeed-Retail/reviews?page=4)]. |
| Toast | Restaurant-first; closed ecosystem [G]. Not a retail fit. |
| Clover (Fiserv) | Hardware typically locked to the selling processor; resellers often require 36-month terms with termination fees; surprise-fee complaints [V, competitor-authored: [Toast blog](https://pos.toasttab.com/blog/clover-pos-reviews); [Capterra](https://www.capterra.com/p/226864/Clover/reviews/?page=8)]. |
| Oracle Xstore / Simphony | Xstore = tier-1 retail POS; reviewers cite weaker ease of use (G2 8.0), reporting, hardware compatibility, little customer focus [V: [Gartner](https://www.gartner.com/reviews/market/unified-commerce-platforms-anchored-by-pos-for-tier-1-retailers/vendor/oracle), [G2](https://www.g2.com/compare/oracle-retail-xstore-point-of-service-vs-square-point-of-sale)]. Simphony = hospitality [G]. Few public reviews. |
| SAP Customer Checkout | SAP-ecosystem retail/small store POS [G]; no review data retrieved. |
| Salesforce Commerce / Tulip | Tulip: cloud clienteling, assisted online selling, mobile POS for specialty apparel/accessories/hard goods [V: [CB Insights](https://www.cbinsights.com/company/tulip-retail/alternatives-competitors)]. Salesforce retail clienteling not verified. |
| NewStore | Omnichannel POS + shopper apps, OMS, inventory, clienteling, loyalty [V: [CB Insights](https://www.cbinsights.com/company/mercaux/alternatives-competitors)]. Targets fashion/luxury [G]. |
| Teamwork Commerce | Mobile POS, OMS, inventory, CRM, analytics; apparel/footwear/stadium [V: CB Insights above]. GetApp 3.4/5 on 6 reviews [V weak: [GetApp](https://www.getapp.ca/compare/104419/107185/teamwork-retail/vs/cegid-retail-pos)]. |
| Cegid Retail | Cloud unified commerce; specialty and luxury; 360 customer view, click-and-collect, endless aisle [V: [cegid.com](https://www.cegid.com/fr/?p=58301)]. GetApp 4.4/5 on 34 reviews, from EUR159 [V weak]. |
| Apption | Not found in searches; [G] a luxury/fashion POS-clienteling vendor. Verify. |
| Retail Pro | Legacy on-prem-origin retail POS (Retail Pro Prism) [G]; not researched. |

### 1.2 Comparison table (segments/pricing from sources above where [V]; other cells [G], verify)

| Vendor | Target segment | Platforms | Offline mode | Multi-store | Customization | Loyalty | Clienteling | Pricing model | Key weaknesses |
|---|---|---|---|---|---|---|---|---|---|
| Shopify POS | SMB to mid retail, omnichannel | iOS, Android | Limited offline card (Shopify Payments) | Yes (Pro per location) | Apps, Hydrogen/UI extensions; POS UI branding rigid | Apps / native basic | Basic notes, apps | Plan + per-location + card % | Reader drops, payout holds, features gated to Pro, Shopify-Payments dependence, outages |
| Square | Micro/SMB | iOS, Android, web | Yes, with caveats | Basic-moderate | API; limited UI | Native (basic) | Minimal | Free + card % (+ tiers) | Account holds, reader reliability, weak serialized inventory, outage trust |
| Lightspeed Retail | SMB to mid | iPad, web, Windows (legacy) | Partial | Yes | Moderate | Add-on | Limited | Subscription tiers + processing | Glitches, payment restrictions, add-on creep, fragmented reports |
| Toast | Restaurants | Android | Yes | Yes | Moderate | Native | n/a | Subscription + processing + hardware | Not retail; lock-in |
| Clover | SMB | Proprietary Android | Limited | Basic | App market | Apps | Minimal | Reseller-set rates, leases | Processor/hardware lock-in, contracts, fees |
| Oracle Xstore | Tier-1 retail | Windows, tablets | Strong (store server) | Strong | Heavy services | Via Oracle suite | Via suite | Enterprise license + SI | Cost, UX, long implementations |
| SAP CCO | SAP shops, mid | Windows | Yes | Via SAP | SAP-side | Via SAP | Minimal | License | Ecosystem dependency |
| Salesforce / Tulip | Specialty/luxury | iOS, web | Weak/partial | Yes | Platform-level | Salesforce Loyalty | Strong | Enterprise subscription | Cost, POS depth varies |
| NewStore | Fashion/luxury | iOS/Android | Yes (claimed) | Yes | Moderate | Native | Strong | Enterprise subscription | Enterprise-only, price |
| Teamwork Commerce | Apparel, specialty | iOS/Android/Windows | Yes | Yes | Moderate | Native | Moderate | Enterprise subscription | Mixed review signals |
| Cegid | Specialty, luxury (EU) | Windows, tablets, web | Yes | Strong | Moderate-heavy | Native | Strong | Subscription (from EUR159 [V]) | Complexity, EU-centric |
| Retail Pro | Specialty retail | Windows | Yes | Yes | Moderate | Add-on | Basic | License | Aging stack |

**Takeaway:** no one offers (a) all six platforms, (b) SMB onboarding, (c) luxury-grade clienteling/serials, (d) real white-label, (e) processor agnosticism, (f) an agent-native API. That is our wedge.

---

## 2. Luxury & High-Value Retail Specifics

### 2.1 Clienteling
- **Customer 360:** identity, contact prefs/consent (GDPR, marketing opt-in per channel), sizes, preferred brands/colors/materials, anniversaries, household links, assigned associate(s), notes (rich + private), purchase history across channels, wishlists, appointments, communications log.
- **Wish lists / saved items:** shareable between associate and client; availability alerts across stores.
- **Appointments:** private shopping, repairs, fittings; calendar sync (ICS/Google/Microsoft), reminders, resources (room/stylist).
- **VIP tiers:** spend-based plus discretionary (manual) tiers; perks (early access, free alterations, lounge).
- **Next-best-action:** replenishment due, anniversary upcoming, new arrival matching taste, lapsed VIP. [G]
- **Associate attribution:** every sale/clienteling-influenced online sale credited to associate (commission, section 4).
- Reference vendor positioning: Tulip, NewStore, Cegid (section 1).

### 2.2 Serialized inventory, certificates, provenance
- Unit-level item (one row per physical piece): serial/IMEI/watch reference number, cost, appraisal value, status (in-stock, reserved, sold, consigned, in repair, on loan, in transit), location, history of events. A jewelry-POS vendor describes exactly this model: per-piece cost, appraisal value, history, repair logs, layaway [V: [Oliver POS](https://oliverpos.com/jewelry-store-pos/)].
- **Certificates:** attach documents (GIA/IGI grading, authenticity card, warranty) to the item; issue a digital certificate/warranty at sale with QR; store hash for tamper evidence. [G]
- **Gemstone/precious metals:** weight, karat, spot-price-linked pricing (price rule recomputed daily), melt value. [G]
- **Provenance & DPP:** see section 7.7.

### 2.3 Consignment
- Consignor entity, agreement terms (split %, minimum price, term, markdown schedule), items received into "consigned" ownership (no inventory asset on our books), sale triggers payable to consignor, statements and payouts, unsold return workflow. [G]

### 2.4 Repairs / after-sales
- Repair ticket: item (serial), intake condition photos, estimate, deposit, workshop assignment (internal/external), status timeline, customer notifications, pickup, warranty claims, loaner item tracking. Link to original sale for warranty validity.

### 2.5 High-value payments
- **Split tender:** multiple cards + cash + gift card + store credit + bank transfer/wire (mark as pending until cleared) in one sale. [G]
- **Deposits / layaway / special orders:** deposit liability account, payment schedule, reservation of unit, auto-release/forfeiture rules, receipts per installment. [G]
- **Limits & compliance:** cash-transaction reporting thresholds and AML/KYC for high-value goods (varies by jurisdiction; EU AMLD thresholds for high-value dealers, US Form 8300 > $10k cash) [G, verify per market]. Capture ID details for the transaction where required.
- **Tax-free shopping / VAT refund:** POS checks eligibility with Global Blue, submits issuing request to generate tax-free form; needs card-present integration mapping card token and tax-free data; Global Blue (now part of Shift4) earns a share of refund/DCC [V: [Shift4 docs](https://docs.shift4.com/guides/advanced-concepts/tax-free-shopping), [PAX](https://paxtechnology.com/blog/global-blue-tax-free), [XY Retail](https://docs.xyretail.com/docs/xy-stylist/global-blue-tax-free/)]. Planet is the other major provider [G]. Design a `TaxRefundProvider` plugin interface (eligibility, issue, void, reporting) so both can plug in; store passport/country, receipt, customs stamp status.
- **Dynamic currency conversion (DCC):** offered on terminal; regulatory disclosure rules apply [G].

### 2.6 Omnichannel
- **Endless aisle:** order out-of-stock item to ship to customer/store from any location; show network-wide ATP.
- **Ship-from-store / click-and-collect / BOPIS:** store as fulfilment node; pick-pack-ship UI; carrier label APIs; reservations.
- **Digital receipts ("white-glove"):** branded email/WhatsApp/wallet pass with item story, care guide, warranty, QR for DPP; no paper default. Receipt template is per-brand.
- **Mobile/tablet assisted selling:** floor-based checkout, scanning, size/stock lookup, "send to fitting room", pay-anywhere via Bluetooth/NFC terminal.
- **Gifting/engraving:** gift wrap options, messages, hide-price receipts, engraving/personalization as order-line properties with workshop routing and production lead time; non-returnable flags. [G]

---

## 3. Inventory Management Best Practices

| Topic | Recommendation |
|---|---|
| Ledger | **Perpetual, append-only stock movement ledger** (`stock_movements`: item/variant, location, qty delta, reason, ref doc, actor, cost). On-hand = sum of movements; cached snapshot table updated in same tx. Never UPDATE quantity directly. |
| Multi-location | Location types: store, backroom, warehouse, consignment-out, in-transit, workshop, damaged, quarantine. Per-location on-hand, reserved, available (ATP). |
| Transfers | Documented states: draft -> shipped (in-transit location) -> received (partial allowed) -> reconciled w/ discrepancies. In-transit stock still owned/valued. |
| Cycle counts | Rolling ABC-based counts (A items monthly, C items yearly); blind count; variance threshold requiring manager approval; adjustments posted as ledger entries with reason code. |
| RFID | EPC mapped to item/serial; handheld reader import for counts; exit-gate/sale reconciliation; typical benefit is high count accuracy (vendor claims ~95-99% accuracy) [G]. Treat as a plugin with import API; do not hard-depend. |
| Reorder | Reorder point = lead-time demand + safety stock; min/max by location; forecast-based suggestions (section 7); PO generation; supplier lead-time and MOQ. |
| Variants | Product -> option axes (size/color/material) -> variants with barcode/SKU each; matrix editor; shared images per option value; prices inheritable with overrides. Max option axes configurable. |
| Lot/serial | Tracking mode per product: none / lot (expiry, batch; for cafe, cosmetics) / serial (unit). FEFO picking for perishables. |
| Landed cost | Allocate freight, duty, insurance to receipt lines (by value/weight/qty); store per-receipt-layer unit cost. Multi-currency PO with FX at receipt. |
| Valuation | Support **FIFO layers**, **weighted average**, and **specific identification** (mandatory fit for serialized luxury goods). Per tenant/product-category policy. COGS posted per sale. LIFO unsupported under IFRS [G]. |
| Reservations | Soft reserve (cart/quote, TTL), hard reserve (deposit/layaway/online order). Reservations reduce ATP, not on-hand; release by TTL, cancellation or fulfilment. |
| Oversell | Allow configurable negative stock offline; resolve on sync with review queue (pattern also used by offline-POS plugins [V: [Ecosire](https://ecosire.com/apps/woocommerce/woocommerce-offline-pos)]). |
| Shrink | Reason codes (theft, damage, expiry, sample), photo evidence, anomaly alerts. |
| Audit | Every movement links to originating document; immutable; period-close snapshots. |

---

## 4. User Management, Security & Cash Control

### 4.1 RBAC model
- **Entities:** Tenant -> Organization(s) -> Stores/Locations; Users have role assignments scoped to (tenant | region | store).
- **Roles (defaults, editable):** Owner, Admin, Regional Manager, Store Manager, Assistant Manager, Sales Associate/Stylist, Cashier, Stockroom, Accountant (read-only finance), Auditor, API/Integration, AI Agent (MCP).
- **Permissions:** fine-grained verbs (`sale.create`, `sale.void`, `refund.create`, `discount.override`, `price.override`, `stock.adjust`, `cash.drawer.open`, `report.view.financial`, `customer.export`). Roles = permission bundles; allow deny-overrides and per-user temporary grants (expiring).
- **Field-level:** hide cost/margin from associates; mask customer PII by role.
- **SSO/MFA:** passkeys (WebAuthn) for back office; staff PIN + badge/NFC for floor login; SAML/OIDC for enterprise [G].

### 4.2 Overrides and approvals
- Policy engine: thresholds per role/store (e.g., discount > 10% needs manager; refund > X or without receipt needs manager; void after tender needs manager; price override always logged).
- **Manager PIN / badge tap approval** on device; remote approval push to manager phone when manager is not on floor; approvals recorded with approver, reason code, device, timestamp.
- Offline: approvals validated against cached hashed PINs + signed policy bundle; synced to audit log.

### 4.3 Shifts and cash drawers
- Clock-in/out with break tracking; geofence/device binding optional; timesheet export (payroll).
- **Drawer session:** open with counted float -> transactions attributed -> paid-in/paid-out/safe drops (with reasons) -> close with **blind count** (cashier enters counted cash without seeing expected) -> variance computed -> manager sign-off over threshold -> Z-report. One drawer session per staff or shared drawer, configurable.
- Cash ledger entries append-only; deposits to bank logged.

### 4.4 Audit trail
- Immutable, append-only `audit_log` (actor, tenant, store, device, action, entity, before/after hash/diff, IP, reason code, request id). Hash-chained for tamper evidence. Exportable; retention policy per tenant/jurisdiction. Fiscal compliance (e.g., fiscalization/signature requirements in DE KassenSichV, FR NF525, IT, PT, etc.) as pluggable fiscal modules [G].

### 4.5 Commission tracking
- Rule types: flat %, tiered by attainment, product/brand/category-specific, team split, spiff campaigns, clawback on returns, attribution windows for online sales assisted by associate. Calculated from ledger events (sale, return) into `commission_entries`; period statements; approvals; payroll export.

---

## 5. Rewards & Loyalty

| Mechanism | Design notes |
|---|---|
| Points | Earn rules by spend/category/campaign multipliers; redemption rate; points ledger (append-only, with lot/expiry per earn). |
| Tiers | Qualification window (rolling 12m vs calendar), spend or visits, soft landing on downgrade, manual VIP override (luxury), tier benefits as config (discount %, free services, early access). |
| Cashback | Percent returned as store credit or points; cap rules. |
| Punch cards | N-th purchase free; generic "stamp" counters for cafe/salon. |
| Referral | Referral code/link; reward both on first qualifying purchase after return window; fraud limits. |
| Expiry | Rolling or fixed expiry; notifications 30/7 days before; legal limits vary (some jurisdictions restrict gift card expiry; US CARD Act: min 5 years for gift cards [G]). |
| Gift cards | Physical + digital; unique codes; balance ledger; fraud velocity checks; liability account; escheat/unclaimed-property rules in US states [G]. |
| Store credit | From returns/goodwill; tender type; ledger; optionally per-customer wallet. |
| Coalition | Cross-tenant shared program (mall/brand collective) -> requires consent, settlement ledger between participants; v2+. |
| Personalization | Offers by segment/next-best-action; birthday/anniversary perks; non-monetary rewards (events, engraving) -- the luxury norm over discounts. |

**Accounting:** under ASC 606 / IFRS 15, points that grant a material right are a separate performance obligation: part of the sale price is deferred (allocated by relative standalone selling price) and recognized on redemption/expiry; breakage estimated where reliable [V (secondary): [Exchange Solutions](https://exchangesolutions.com/glossary/points-liability/), [Growave](https://www.growave.io/blog/how-to-account-for-customer-loyalty-programmes), [Beancount](https://beancount.io/blog/2026/07/01/accounting-for-customer-loyalty-rewards-programs-asc-606-points-liability-deferred-revenue-breakage-guide); confirm vs standards]. Product requirement: **liability report** (outstanding points x value, expected breakage, deferred revenue roll-forward) and journal export; separate liabilities for gift cards, store credit, deposits, loyalty.

---

## 6. Pain Points & Flaws in Current POS Systems

| # | Pain point | Evidence | Our response |
|---|---|---|---|
| 1 | **Outages stop selling** | Shopify Cyber Monday 2025 login/auth bug blocked POS and admin ([TechCrunch](https://techcrunch.com/2025/12/01/shopify-resolves-outage-disrupting-merchants-on-cyber-monday), [ChannelNews](https://www.channelnews.com.au/shopify-suffers-worldwide-outage-disrupting-retailers-on-busiest-shopping-period/)); Shopify POS card-reader disruption 2h on Mar 4 2026 from a Stripe-side change, and a broader Mar 12 2026 outage ([StatusGator history](https://statusgator.com/services/shopify/outage-history?page=3)) [V via search summary]. Square multi-day / full-day outages ([Vixio](https://vixio.com/insights/pc-squares-four-day-outage-sparks-debate-pos-contingency-planning), [SmartCompany](https://www.smartcompany.com.au/finance/square-outage-response-tech-communications-offline-mode/), [American Banker](https://americanbanker.com/payments/news/square-outage-shows-even-a-short-disruption-can-cause-chaos)). | Offline-first; auth must not be a single point of failure (cached signed credentials, local PIN). |
| 2 | **Offline mode unreliable/untrusted** | Square merchants: offline mode rarely triggers automatically, unclear if funds reached bank, offline payments showing failed, later declines risk ([Seller Community](https://sellercommunity.com/t5/Troubleshooting/How-did-people-get-Offline-Mode-to-work-thru-the-outage/m-p/681639)). | Explicit offline status UI, risk limits per tender, store-and-forward semantics documented, per-tender policy. |
| 3 | **Payment processor lock-in** | Shopify POS tied to Shopify Payments for some users; Clover hardware/processor locked, 36-month terms, termination fees ([Shopify community](https://community.shopify.com/t/is-shopify-pos-a-reliable-option-for-uk-based-stores/275704), [Capterra Clover](https://www.capterra.com/p/226864/Clover/reviews/?page=8)). | Semi-integrated, processor-agnostic adapter interface. |
| 4 | **Payout holds / account freezes** | App Store reviewers describe whole-company payments held without clear reason ([App Store reviews](https://apps.shopify.com/shopify-pos/reviews)). | Not our liability if processor-agnostic; document multi-acquirer failover. |
| 5 | **High/opaque fees, add-on creep** | Clover reps quote cheapest tier then charge more; Lightspeed processing "more costly and slower" than expected; Shopify Pro $89/location required for staff roles/inventory counts ([ringly](https://www.ringly.io/blog/shopify-pos-reviews), [Capterra](https://www.capterra.com/p/120491/Lightspeed-Retail/reviews?page=4)). | Transparent pricing; core features (roles, counts, multi-store) not gated. |
| 6 | **Hardware reliability & lock-in** | Shopify readers disconnect, printers/scanners drop daily, hardware not sold in some countries (Mexico) ([ringly](https://www.ringly.io/blog/shopify-pos-reviews), [App Store reviews](https://apps.shopify.com/shopify-pos/reviews)). | Hardware abstraction layer (ESC/POS, Star, Epson ePOS, Bluetooth/USB/network), BYO-hardware list, self-diagnostics screen. |
| 7 | **Poor support** | Repeated in Capterra (Clover), Shopify reviews, Lightspeed ("management level incredibly slow") [V]. | In-app diagnostics bundle + SLA tiers. |
| 8 | **Fragmented/slow reporting** | Lightspeed "pull 3-4 reports"; Clover multi-month reports take days ([Capterra](https://www.capterra.com/p/226864/Clover/reviews/?page=8)); Xstore reporting criticized [V]. | Unified analytics, real-time multi-store dashboards, NL query via MCP. |
| 9 | **Forced updates / bugs; app cache bloat** | Shopify "forced updates cause more bugs"; Lightspeed iPad cache requires reinstall [V]. | Staged rollouts, version pinning per tenant/store, local DB maintenance. |
| 10 | **Rigid UI / branding** | Mainstream POS offer limited theming [G]. | Per-tenant design tokens, layout configurability, custom screens via plugins. |
| 11 | **Weak API/extension; data export difficulty** | [G] common complaint; not quantified in sources retrieved. | Full REST/GraphQL API parity with UI, webhooks, bulk export (CSV/Parquet), documented schema. |
| 12 | **Security / PCI incidents** | Not researched in detail this session [?]. Known class: POS malware at retailers (Target 2013, Home Depot 2014) [G]. | Tokenized terminals, no PAN in our systems, encrypted local DB, signed updates. |
| 13 | **Unsuited to luxury/vertical needs** | SMB tools lack serials, certificates, consignment, repairs; enterprise tools are heavy [G, synthesis of section 1]. | Vertical packs. |
| 14 | **Duplicate charges in outages** | Clover reviewer reports duplicate charges during an outage [V: Capterra]. | Idempotency keys end-to-end (section 8). |

---

## 7. Opportunities, Improvements, New Features

### 7.1 Offline-first sync
- **Model:** server authoritative; each device has a local SQLite (or encrypted equivalent) replica of the needed slice (catalog, prices, customers for the store, open orders, policy bundle) plus an **outbox of intents** with client-generated UUIDv7 ids and idempotency keys. Replay must be idempotent: "set" operations are safe, "increment" operations require dedup via operation ids ([V guidance: [Back4app](https://www.back4app.com/glossary/offline-first-data-sync/)]).
- **Where CRDTs help:** PN-counters for stock deltas, OR-sets for tags/wishlists, LWW registers for low-risk profile fields, text CRDT for notes. Inventory quantities are better modeled as **ledger of deltas** (commutative) than LWW. Vendor CRDT pitches (e.g., [Ditto](https://www.ditto.com/blog/how-to-build-robust-offline-first-apps-a-technical-guide-to-conflict-resolution-with-crdts-and-ditto)) are marketing; validate.
- **Not CRDT-able:** payments/tenders, gift card balances, unique serials -> need server arbitration; offline policy: limits (e.g., gift card redemption offline capped or disabled), store-and-forward card auth limited by terminal floor limits.
- **LAN peer sync:** store hub/leader election via mDNS so multiple tills in one store keep working during WAN loss (desktop/Android hub). v1.
- **Sync UX:** per-device sync status, queue depth, conflict inbox for managers, "stale data" banners with timestamps.
- **Platform stack candidates:** SQLite everywhere (Flutter/Drift, Kotlin/SwiftUI native, or Tauri/Electron + web via OPFS SQLite WASM); evaluate cross-platform UI choice early (single codebase for six platforms: Flutter or React Native + Tauri/Electron; PWA for web).

### 7.2 AI features
| Feature | Notes |
|---|---|
| Demand forecasting | Per SKU-location weekly; seasonality, promos, weather, events; hierarchical models; explain reorder suggestions. |
| NL analytics | "Which stores had the highest refund rate last week?" -> safe SQL/semantic layer via MCP tools, not raw SQL; show query + provenance. |
| Smart reorder | Forecast + lead time + MOQ -> draft POs for approval. |
| Fraud / anomaly | Void/refund/discount rate per employee vs peers, after-hours transactions, refund-without-receipt clusters, drawer variance patterns, gift card cash-out; rules first, ML later; case-management queue. |
| Product copy | Generate descriptions, multilingual translations, SEO, tone-of-voice per brand; human review. |
| Clienteling NBA | Suggest outreach with draft message in brand voice; consent-aware. |
| Guardrails | Tenant-isolated retrieval, no PII to model without DPA/zero-retention config, human approval for writes. |

### 7.3 MCP / agentic management (staff-facing)
- **Spec:** MCP authorization uses OAuth 2.1; MCP server = resource server; HTTP transports follow it, STDIO takes creds from environment; Client ID Metadata Documents recommended; 2026-07-28 revision is current and reportedly removes protocol-level sessions [V: [MCP spec 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [PPC Land](https://ppc.land/mcp-forces-ad-tech-to-rebuild-agent-servers-as-sessions-disappear/); details of the 2026 changes not retrieved, verify]. Design stateless tools.
- **Server shape:** remote streamable-HTTP MCP server per region; tenant derived from token; scopes map to RBAC permissions (agent acts "as" a staff user or a dedicated agent principal with least privilege).
- **Tool taxonomy:**
  - Read: `sales_summary`, `inventory_levels`, `low_stock`, `customer_lookup`, `employee_performance`, `refund_anomalies`, `cash_variance`, `loyalty_liability`, `forecast`.
  - Write (gated): `create_purchase_order_draft`, `adjust_price_draft`, `schedule_promotion_draft`, `transfer_stock_draft`, `send_clienteling_message_draft`.
  - Pattern: **propose -> human approve -> execute.** Writes create "drafts" visible in back office; execution requires user approval (MCP elicitation or approval inbox). Destructive tools (refund, void, delete) not exposed.
- **Resources:** schema docs, store directory, policy docs, report definitions. **Prompts:** "weekly store review", "close-of-day exceptions".
- **Safety:** rate limits, per-tool audit (agent id, prompt hash, params), PII redaction option, tool output treated as untrusted (prompt injection via customer notes/product text), read-only sandbox mode, cost/row limits.

### 7.4 White-label theming & customization
- Per-tenant (and per-store override) design tokens: colors, typography (custom font upload), radii, density, logo, motion, sounds, receipt/label templates, language packs, terminology renaming ("Client" vs "Customer", "Maison" vs "Store").
- Layout builder: configurable home grid, quick keys, checkout flow steps (skip/require customer, add engraving step).
- Customer-facing displays and email/wallet receipts themed from same tokens. Contrast/accessibility validation when saving theme (WCAG AA check).
- Branded app distribution: build pipeline for white-label store listings (MDM / Apple Business Manager custom apps) at enterprise tier [G].

### 7.5 Plugin / extension system
- Extension points: UI slots (cart line, customer profile tab, checkout step), event hooks (`order.completed`, `stock.low`), custom fields/entities (typed, validated), payment adapter, tax adapter, fiscal module, hardware driver, report widget.
- Runtime: sandboxed (WASM or iframe/webview with postMessage + capability tokens); server-side via webhooks/functions; manifest with permissions; marketplace review; semver + migration contract. Versioned public API with deprecation policy.

### 7.6 Payment-processor agnostic
- Adapter interface: `authorize/capture/refund/void`, terminal discovery/pairing, receipt data, tokenization, reconciliation file import, payout matching. Start with a semi-integrated adapter (e.g., Adyen, Stripe Terminal, Worldline/Nexo-based) [G]; support external "manual" tender for unsupported terminals. Smart routing/failover across acquirers v2.

### 7.7 Compliance and sustainability
- **EU Digital Product Passport (ESPR, Regulation (EU) 2024/1781):** in force 2024; product-group delegated acts set data fields/carriers; textiles/apparel/footwear on the early priority list; delegated acts for textiles were still draft as of April 2026; timeline sources conflict (2027 vs 2028) and no jewelry mention found [V/?: [Cosh](https://cosh.eco/en/articles/eu-digital-product-passport-espr-explained-fashion-textiles), [Renoon](https://www.renoon.com/blog/the-timeline-of-digital-product-passport-regulation-in-eu-espr-from-product-groups-to-rollout-schedule), [BPMA](https://bpma.co.uk/?p=12910)]. Plan: per-item "passport" record (materials, origin, care, repair, recycling, ownership transfer), QR/NFC carrier, resale/repair events, API publish; keep data model flexible until delegated acts final.
- **Sustainability:** repair/resale (trade-in, certified pre-owned) flows, carbon-per-item field, material origin, "digital receipt only" metrics.
- **Tax/i18n:** multi-currency with FX rate snapshots, multi-tax (VAT/GST/sales tax by jurisdiction, tax-inclusive/exclusive display, rounding rules, tax-exempt customers), tax engine adapter (e.g., Avalara/Vertex/TaxJar) [G], RTL support, locale-aware formats, pluralization, time zones; fiscal printers/e-invoicing (Peppol, SDI, etc.) as modules.
- **Accessibility:** WCAG 2.2 AA, screen reader labels on all POS controls, large-text mode, high-contrast theme, switch/keyboard-only operation, haptic/audio confirmation; legal drivers (EAA in the EU, effective June 2025, covers e-commerce and POS-type self-service terminals) [G].
- **Passkeys:** WebAuthn for back office and manager approval; NFC badge login on floor.

### 7.8 Unified commerce & real-time ops
- Single catalog, customer, inventory, promotions across store, web, marketplace; connectors (Shopify, WooCommerce, Magento, BigCommerce, marketplaces) as plugins; our own storefront optional.
- Real-time dashboards: sales vs target per store/hour, live basket, drawer status, stock alerts via event stream (SSE/WebSocket).

---

## 8. Scalability & Reliability Architecture

### 8.1 Multi-tenancy
| Pattern | Isolation | Ops cost | Use |
|---|---|---|---|
| Shared schema + `tenant_id` + Postgres RLS | Logical (row) | One migration | **Default**; scales to millions of rows; most SaaS guides recommend as the starting point ([Makerkit](https://makerkit.dev/blog/md/tutorials/multi-tenant-saas-architecture)) |
| Schema-per-tenant | Namespace | N migrations | Hundreds of tenants; mid-market compliance |
| DB-per-tenant | Strong | Highest | <~20 strictly regulated enterprise tenants ([TabNews](https://www.tabnews.com.br/mrmsoares/multitenancy-com-prisma-e-postgresql-row-level-security-vs-schema-por-tenant)) |

Recommendation: **RLS by default + dedicated-database tier for enterprise / data-residency tenants** (same code, routing by tenant config).
RLS implementation notes: policy on `current_setting('app.tenant_id')`; set it per transaction (`SET LOCAL`) -- with PgBouncer transaction pooling, session-level settings leak or vanish [G]; app DB role must not be table owner/BYPASSRLS; composite PKs/FKs include `tenant_id`; index leading with `tenant_id`; tests that attempt cross-tenant reads in CI; partition large ledgers by tenant hash or time.

### 8.2 Correctness primitives
- **Idempotency keys** on all mutating APIs: client-generated key in `Idempotency-Key` header, stored with request fingerprint + response in a DB table inside the same transaction as the business write (preferable to Redis for financial data), TTL ~24h+, scoped per tenant; reject mismatched payload reuse [V (secondary): [techinterview](https://www.techinterview.org/post/3233473028/lld-idempotency-patterns/), [Gravitee](https://gravitee.io/corpus/gen-1019/online-transaction-processing/idempotency-keys-and-exactly-once-semantics-for-online-transaction-processing-apis.html); Stripe docs primary]. POS: key = device_id + local sequence / UUIDv7 order id, so offline retries never double-charge or double-create.
- **Transactional outbox:** write domain change + event row in one tx; relay publishes to broker; consumers dedupe by event id ([V: same sources]). Idempotency key alone does not cover a crash between side effect and key store.
- **Event sourcing, selectively:** ledgers (stock, cash, loyalty, gift card) are event-sourced by nature; orders/customers can be CRUD + audit log. Avoid full ES for everything.
- **Money:** integer minor units + currency; rounding policy per tax regime; no floats.
- **Order numbering:** per-store gapless sequences where fiscal law requires; device-prefix ranges allocated for offline.
- **Sagas** for split tender, deposits and ship-from-store (compensating actions).

### 8.3 Performance & peak load
- Read model/caching: catalog + price lists cached at edge/CDN and on device (versioned snapshots + deltas); write path hits primary Postgres; read replicas for reporting; separate OLAP store (ClickHouse/DuckDB/BigQuery) fed by CDC for dashboards and MCP analytics.
- Peak (Black Friday): autoscale stateless API, queue for non-critical work (emails, loyalty recalcs, webhooks), backpressure + per-tenant rate limits and quotas, pre-scale before known events, load tests at 10x, graceful degradation (disable recommendations first). Store tills must not depend on the cloud for the sale path.
- Observability: per-tenant SLOs, tracing with tenant tag, synthetic transactions per region, public status page, incident runbooks. Auth outage lesson from Shopify (identity layer took POS down) [V]: keep cached offline auth.
- DR: multi-AZ, PITR backups, tested restores, RPO/RTO targets stated; per-tenant export/restore.

### 8.4 PCI DSS 4.0, security & privacy
- **Scope reduction:** card data never touches our servers or POS app: card-present via **semi-integrated PTS-certified terminals**; best reduction when terminal is part of a **PCI-listed P2PE solution**; eligibility for the P2PE SAQ depends on acquirer/brand; vendor "90% scope reduction" claims are marketing [V: [PCI SSC FAQ](https://www.pcisecuritystandards.org/faqs/1301/), [Ampcus](https://www.ampcuscyber.com/blogs/how-p2pe-reduces-pci-dss-scope-for-merchants/), [Ingenico](https://cdn.ingenico.com/binaries/content/assets/us-website/library/brochures/semi-integrated/ing-tetra-semiint-brochure-v3.pdf)]. Card-not-present: hosted fields/redirect (SAQ A). Store only token + last4 + brand + expiry. Confirm with QSA.
- **Platform security:** encrypt at rest (SQLCipher on devices, KMS-managed keys per tenant optional), TLS 1.3, device attestation (App Attest / Play Integrity), remote wipe, signed update channel, secrets in HSM/KMS, dependency/SBOM scanning, pen tests, SOC 2 Type II (target), ISO 27001 optional.
- **GDPR/data residency:** region-pinned tenants (EU/US/APAC), DPA & sub-processor list, consent records, DSAR export/erasure tooling (erasure vs fiscal retention conflict -> pseudonymize), retention schedules, breach notification process (72h), cross-border transfer mechanism. Customer PII encrypted fields where feasible; MCP/AI redaction.

---

## 9. Prioritized Feature List

### MVP (sell in one store, offline-safe)
- Multi-tenant core: tenant, org, stores, devices, RLS, region config.
- Auth: staff PIN login, email+passkey back office, RBAC with default roles, per-store scope.
- Catalog: products, variants matrix, barcodes, categories, images, price lists, tax rules (multi-tax).
- Checkout: cart, line/order discounts, returns/exchanges, split tender (cash, external card, gift card, store credit), parked sales, receipts (print + email).
- Payments: one semi-integrated adapter + manual tender; idempotent payment flow.
- Offline-first local DB, outbox sync, idempotent replay, sync status UI.
- Inventory: stock movement ledger, receiving, adjustments, single/multi-location counts, low-stock alerts.
- Customers: profile, notes, purchase history, consent flags, search.
- Cash drawer: open/close with blind count, paid in/out, Z-report.
- Manager PIN overrides for void/discount/refund + audit log.
- Brand theming v1: logo, colors, fonts, receipt template, terminology overrides.
- Hardware: receipt printer, barcode scanner, cash drawer, card terminal abstraction.
- Reports: daily sales, by product/staff/tender, stock on hand.
- Platforms in MVP: Web (PWA) + one native tablet (iPad or Android) + Windows/Desktop via shared codebase if feasible.
- Read-only MCP server (sales, inventory, low stock) with OAuth scopes and audit.

### v1 (multi-store luxury-ready)
- Serialized items + certificates/documents, specific-identification costing, FIFO/weighted average.
- Clienteling: wish lists, preferences/sizes, appointments, associate assignment, VIP tiers, outreach tasks.
- Deposits/layaway/special orders; reservations; repairs/after-sales tickets; consignment.
- Tax-free/VAT refund provider interface + first integration (Global Blue/Planet).
- Transfers, in-transit, cycle counts with ABC schedule; reorder points + PO management; landed cost.
- Loyalty: points, tiers, gift cards, store credit, expiry, liability report.
- Shifts/clock-in, commission rules, approval policies with remote manager approval.
- Endless aisle, click-and-collect, ship-from-store; Shopify/WooCommerce connector.
- Plugin SDK v1 (events, custom fields, UI slots), webhooks, public REST API + bulk export.
- LAN hub sync for multi-till stores; native apps for iOS, Android, Windows, macOS; Linux build.
- Real-time multi-store dashboards; branded digital receipts (email/WhatsApp/wallet).
- MCP write tools with propose->approve flow; NL analytics.
- Anomaly detection (rules) for voids/refunds/drawer variance.
- i18n: multi-currency, RTL, localized receipts; accessibility AA audit.

### v2 (differentiation & scale)
- Demand forecasting + auto-draft POs; ML fraud detection; AI product copy; clienteling next-best-action.
- RFID support; DPP/passport records + QR/NFC; resale/trade-in/certified pre-owned flows.
- Coalition loyalty, referral program, personalized offers engine.
- Marketplace of third-party plugins (sandboxed WASM), theme marketplace, white-label branded app builds (MDM).
- Multi-acquirer routing/failover, DCC, BNPL, crypto/bank-transfer tenders for high-value.
- Fiscal modules (DE, FR, IT, PT, etc.), e-invoicing (Peppol).
- Dedicated-DB / BYO-cloud tier, customer-managed keys, SOC 2/ISO certification extensions.
- Vertical packs: salon (staff scheduling, services/commissions), cafe (modifiers, KDS, tips), electronics (IMEI, trade-in, warranties).
- Self-checkout / customer-facing app, endless-aisle video clienteling.

---

## 10. Open Questions / To Verify
- Apption, SAP Customer Checkout, Retail Pro, Salesforce clienteling: no data retrieved.
- Security breaches/PCI incidents at POS vendors (e.g., recent vendor breaches): not researched.
- Exact 2026 MCP spec auth changes; EU DPP delegated-act dates and whether jewelry is covered.
- Jurisdiction-specific high-value cash/AML thresholds, gift card and unclaimed-property rules.
- Tax-free providers: Planet API terms, country coverage (Shift4 doc page listed only DE/ES, likely outdated).
- Cross-platform UI framework choice (Flutter vs React Native + Tauri vs native) via a prototype spike on offline SQLite + hardware SDKs.

## 11. UI/UX research (October 2026) and how the redesign answers it

Sources are secondary (review aggregators, vendor changelogs and help centres); treat ratings as indicative.

### 11.1 What users of current systems complain about

| Product | Praised for | Complained about |
| --- | --- | --- |
| Square POS / Retail | fast setup, simple first sale | slow item adding at checkout, outages, fund holds, hard-to-reach support ([Nasdaq](https://www.nasdaq.com/articles/square-review), [Capterra](https://www.capterra.com/p/275802/Square-Point-of-Sale/reviews/)) |
| Shopify POS | keyboard navigation on iPad (⌘K search, ⌘↵ checkout, ⌘1-9) ([changelog](https://changelog.shopify.com/posts/keyboard-shortcuts-and-navigation-in-shopify-pos)) | 2026 tablet regression hid the cart item count; reader and printer disconnects; repeated sign-ins; weak real-time reporting ([App Store reviews](https://apps.shopify.com/shopify-pos/reviews)) |
| Toast | restaurant depth | offline mode cannot close checks, reconcile or clock out until resync ([Toast help](https://support.toasttab.com/en/article/Offline-Mode-Using-Toast-During-a-Local-Network-Outage)); contracts and fees |
| Lightspeed Retail | support | cache problems needing reinstall, reports that do not reconcile |
| Clover, SumUp | simple pricing (SumUp) | fees, holds, bot support, hardware replacement |
| Tulip + Salesfloor (merged March 2026) | 360° client view, client books, follow-ups for luxury associates ([Tulip](https://www.tulip.com/press/tulip-offers-turnkey-edition-clienteling-platform/)) | separate from the POS, so the associate switches apps at the moment of sale |

### 11.2 Fifteen UX flaws and the fix built into this product

| Flaw | Fix here |
| --- | --- |
| Slow item adding | Scanner-first search field (Enter adds an exact SKU, `/` focuses it), tiles or list per store, command palette adds items |
| Count and total hidden | The sale panel with count, total and Charge is always on screen (tablet/desktop) or a sticky bar (phone) |
| Modal on modal | Payment replaces the catalogue in place; secondary tasks open in one drawer; never stacked |
| Tiny targets | 44/48/56 px by density, hit slop on small icon buttons |
| Offline blocks the floor | Offline sales are final on the till, queued with UUIDv7 ids and replayed exactly once |
| Silent sync failures | Live sync status in the shell; refused sales listed in Settings to resolve or discard |
| One-tap refunds | Refund drawer: pick lines and quantities, restock choice, reason required, manager approval above the cashier's rights |
| Hidden facts on refunds and fees | Order detail shows lines, tenders (refunds as negatives) and refund history together |
| Exact-match search | Full-text search on name, SKU and barcode; clients by name, email or phone |
| Hardware loops | Electron prints silently; receipts are HTML so any printer works; errors are banners, not blocking dialogs |
| Repeated re-auth | Sessions persist per device; manager approvals use email + PIN on the cashier's device |
| Keyboard-blind | ⌘/Ctrl+K palette, ⌘/Ctrl+1..8 navigation, ⌘/Ctrl+Enter to charge, digits type into the keypad, Esc goes back |
| Unclear totals | Line discounts as negatives, tax label follows the store's tax mode, tabular figures everywhere |
| Support dead ends | Every error says what happened and what to do next; machine-readable codes in the API |
| Reports that do not reconcile | Dashboards, AI analyst and MCP tools read the same rollups, written in the sale's own transaction; every figure links to its orders |

### 11.3 Trends adopted, and ones deliberately not

Adopted: command palettes, keyboard-first flows, dense tables with tabular numerals, OKLCH-derived palettes, W3C design tokens (DTCG 2025.10, exported from the Brand studio), bento-style dashboards only where hierarchy is real (weighted 2:1 and 3:2 columns, one hero chart), live data badges and auto-refresh.

Not adopted: glass effects on content (Apple's Liquid Glass guidance limits glass to the navigation layer; on a till it costs legibility), gradient hero metrics, decorative motion. Material 3 Expressive and Liquid Glass specifics should be re-checked against the official guidelines before a native-chrome pass.

### 11.4 White-label theming practice

Three tiers (brand primitives → semantic roles → components), contrast checked when tokens resolve (not at design time), lightness-only correction so the brand hue survives, every preset tested in light and dark, and brands override primitives only, never component tokens.
