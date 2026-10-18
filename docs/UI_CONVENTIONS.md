# UI conventions (apps/pos)

Read before adding a screen. The goal: every screen looks like it came from the same hand, works on phone, tablet and desktop, and renders correctly in any store's brand theme.

## Building blocks

| Need | Use | File |
| --- | --- | --- |
| Page frame | `Screen` (`fill` for master-detail lists, `toolbar` for filters) | `src/ui/Screen.tsx` |
| Text | `Text` variants: `title` (screen title, display font), `heading`, `subheading`, `body`, `label`, `caption`, `amount`, `amountLg`. Never set a font family yourself. | `src/ui/primitives.tsx` |
| Amounts | `Money` or `formatMoney(minor, currency)`; amounts are integer minor units | `@luxury-pos/core` |
| Actions | `Button` kinds `primary` (one per area), `secondary`, `soft`, `ghost`, `danger`; sizes `sm`..`xl`. Labels are verb + object ("Refund 2 items"). `IconButton` always has a `label`. | primitives |
| Choice | `Segmented` (2-5 views), `Chip` (filters), `Switch` | primitives |
| Containers | `Panel` (hairline, no shadow), `SectionHeader`, `Divider`, `Stat` (label/value rows) | primitives |
| Status | `Badge` with a word; colour never carries meaning alone | primitives |
| Lists and tables | `DataList` (table on wide, stacked rows on phone, virtualised, `onEndReached` for keyset pages) | `src/ui/DataList.tsx` |
| Secondary task | `Sheet` (drawer on wide, bottom sheet on phone); `variant="dialog"` for confirmations | `src/ui/Sheet.tsx` |
| Feedback | `toast.success()` after a write; `ErrorNote` inline for failures; `Skeleton` while loading; `EmptyState` that says what fills the place | `src/ui/toast.tsx`, primitives |
| Charts | `AreaChart`, `Sparkline`, `Meter`, `ShareBar`, `Delta` | `src/ui/charts.tsx` |
| Icons | Phosphor via deep imports only, re-exported from `src/ui/icons.ts` | |
| Dates | `useFormat()`: `date`, `dateTime` ("Today 14:05"), `range` ("12 – 18 Oct 2026"), `tick` for chart axes. Device language, store time zone. Never call `toLocale*String` in a screen. | `src/lib/format.ts` |

**See every primitive live at `/design`** (no sign-in): all variants and states under each preset, light and dark, with contrast ratios per colour role. Build new components against it and check a brand there before saving it.

## Rules

- **Tokens only.** Colours, radii, spacing and type come from `useTokens()` (`t.color.*`, `t.space(n)`, `t.radius.*`). No hex values, no `rgba(...)` in screens.
- **Store words.** `useTerm()` maps "Customer", "Sale", "Store" to the store's vocabulary ("Client", "Purchase", "Maison").
- **Permissions.** `useCan()(permission)` hides what a role cannot do (hide, do not disable). The API checks again; the UI check is for clarity.
- **Data.** TanStack Query: `useQuery` / `useInfiniteQuery` for reads (keyset `nextCursor`), `useMutation` + `queryClient.invalidateQueries` + `toast.success` for writes. Write ids come from `uuidv7()` (idempotency key).
- **Layout.** `useLayout()` gives `bp` (`phone` / `tablet` / `desktop`) and `wide`. Master-detail: list and detail side by side when `wide`, detail in a `Sheet` on phones. No fixed pixel widths except panes (360 to 480).
- **Accessibility.** `accessibilityRole` and `accessibilityLabel` on every pressable, `accessibilityRole="header"` on headings, targets at least `t.hit` (or `size="sm"` with hit slop), focus rings come from `focusRing()`.
- **Copy.** Plain and specific. No em dashes. Errors say what happened and what to do next.
- **Motion.** Only through primitives and `Sheet` (they respect reduced motion). No custom animations in screens.
- **Undo over confirm.** If an action can be reversed locally (clear a sale, remove a line), do it and call `toast.undo(message, restore)`. Keep confirmation dialogs for what cannot be undone (refunds, revoking a token).
- **Never a silent disabled button.** Prefer an enabled primary that explains what is missing on press (inline field errors) over a greyed-out one. Disable only while a request is in flight or when the reason is visible next to it.
- **Master-detail on wide screens opens the first record** instead of an empty "pick one" pane. Lists stay quiet: show a status badge only when it differs from the normal state.
- **Lead with what to act on.** Dashboards put actionable counts (running low, to review, waiting to sync) first as links, then the figures.
