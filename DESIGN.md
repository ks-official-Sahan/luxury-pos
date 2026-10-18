# Design

The visual system for every till, dashboard, receipt and email. It is a **frame** that each store fills with its own brand: the store picks colours, fonts, words and register layout; the system guarantees legibility, target sizes, state colours and consistency. Strategy and principles: [PRODUCT.md](PRODUCT.md). Component usage rules: [docs/UI_CONVENTIONS.md](docs/UI_CONVENTIONS.md).

## Scene

An associate on a boutique floor, standing, iPad in one hand, a client beside them looking at the screen under gallery spotlights. A cashier at a counter till with a scanner and a queue. A manager at a laptop after closing. Hence: the default theme is dark-first (spotlit floors, screen angled toward the client, no glare), every number uses tabular figures, primary actions are large and live in the thumb zone, and the back office is dense but calm.

## Token tiers

```
BrandTheme (stored per tenant or per store, edited in Brand studio)
  palette: primary, accent, background, surface, text (+ optional dark palette)
  fonts: display, body, mono · type: base size, ratio · radius · density · motion
  neutrals: brand-tinted | pure · layout (register) · terminology · logo · receipt
        │  resolveTokens()  (packages/theme, pure, runs on every platform)
        ▼
Semantic tokens (what components read)
  color: background, chrome, surface, surfaceRaised, surfaceSunken, scrim,
         text, textMuted, border, borderStrong, focus, hover, pressed,
         primary/onPrimary, primarySoft/onPrimarySoft, accent/onAccent,
         success|warning|danger|info + *Soft
  chart[6] · size (UI scale) · display (brand scale) · space(n) · radius · hit
  motion { fast 140, base 200, slow 320, ease-out-quint } · elevation · z
        │
        ▼
Components (src/ui) never see raw brand values
```

- **Contrast is enforced, not hoped for.** Text targets 7:1 on the background, secondary text 4.5:1 on sunken surfaces, controls 3:1 (WCAG 1.4.11), status colours 4.5:1 on surfaces. A failing brand colour is moved in lightness only, so the hue stays the brand's. Tests run every preset in light and dark.
- **OKLCH for derivation.** Neutral layers (chrome, sunken, raised) move in OKLCH lightness from the store's own background, tinted toward the primary hue unless the store chooses pure greys. Dark palettes are derived the same way when a brand gives none. Chart series rotate around the brand hue at fixed lightness and chroma so they are equally prominent.
- **Exports:** CSS variables (web, Electron, receipts, emails) and W3C Design Tokens (DTCG 2025.10) JSON from Brand studio, for Figma or Style Dictionary round-trips.

## Colour strategy

Restrained by default: tinted neutrals plus the brand primary for actions, selection and state only. The sign-in brand panel is the one deliberately "committed" surface (the store's primary fills half the screen). Status colours always come with a word or icon.

Presets (all pass AA in both schemes): **Maison Noir** (dark-first, champagne on near-black), **Atelier Oxblood**, **Modern Retail**, **Terracotta Café**, **System**. None uses a cream or parchment background.

## Typography

- Body face for everything people read and tap, display face only for screen titles and brand moments (sign-in, receipt header).
- UI scale uses the brand's ratio capped at 1.2 (dense product screens); the display scale uses the brand's full ratio.
- Amounts: body face, semibold, `tabular-nums`. Serif old-style figures are never used for prices.
- Variants: `title`, `heading`, `subheading`, `body`, `label`, `caption`, `overline` (rare), `mono`, `amount`, `amountLg`.

## Layout

| Breakpoint | Navigation | Register | Back office |
| --- | --- | --- | --- |
| Phone < 768 | Floor tab bar (4) + More sheet | Catalogue with a sticky sale bar → full-screen sale → full-screen payment | Stacked sections; detail opens in a bottom sheet |
| Tablet 768 to 1179 | 84 px rail with labels | Catalogue and sale side by side | Master-detail where it fits |
| Desktop ≥ 1180 | 248 px grouped sidebar, collapsible, ⌘/Ctrl + 1..8 | Catalogue, sale 400 to 440 px; side is a brand setting | Weighted columns (2:1, 3:2), never identical card grids |

Secondary tasks open in a right-edge drawer on wide screens and a bottom sheet on phones; confirmations use a small dialog. Modals never stack.

## Components

Every interactive component implements default, hover (web), focus-visible ring, pressed, disabled, loading and error. Buttons use `radius.md` (pills are reserved for chips). In-flow containers use one hairline and tone, no drop shadows; shadows are for floating layers only (drawer, palette, toast).

## Register flow

1. Scan or search (the field is the scanner input; Enter adds an exact SKU; `/` focuses it).
2. Tap tiles; quantities stack except serialized pieces.
3. Client strip at the top of the sale: tier and points visible before payment.
4. **Charge** shows the total on the button (⌘/Ctrl+Enter).
5. Payment replaces the catalogue, the sale stays visible. Method segmented control, terminal-style keypad (digits shift in from the right), quick cash amounts, one press takes the full balance and finishes. Split tenders, points and change are inline.
6. Done state: change due in a large warm panel, receipt number, print, **New sale** (Enter). Offline: "Saved on this till", never an error.

## Motion

Ease-out quint, 140 to 320 ms, transform and opacity only. Motion shows state changes (sheet enter, press feedback, toast); nothing decorative, no page-load choreography. `motion: reduced | none` in the brand and the OS reduced-motion setting both turn it off.

## Accessibility

WCAG 2.2 AA floor. Targets 44/48/56 px by density (small icon buttons get hit slop to 44). Focus rings on every pressable (accent colour, 2 px, offset). Every chart has a text summary and per-point labels. Live regions for sync status, payment balance and toasts. Text scales to 160% without clipping.
