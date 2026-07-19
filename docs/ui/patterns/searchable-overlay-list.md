# SearchableOverlayList

The shared substrate for searchable overlays: a trigger that opens a
per-tier overlay — anchored Popover on desktop/tablet, bottom Sheet
on phone — hosting a search field and a virtualized,
optionally-sectioned result list with keyboard navigation. Three
patterns reduce to a search-and-pick-from-an-overlay interaction;
this primitive is the part they share.

Sister patterns: [`forms.md`](./forms.md) (the Input primitive the
search field is built on; `Select`, a pick-a-value sibling that is
**not** a consumer — see [below](#not-a-consumer--select)),
[`overlays.md`](./overlays.md) (Popover and Sheet — the per-tier
surfaces this dispatches between).

Used by:

- [`Autocomplete-with-create`](./forms.md#autocomplete-with-create-primitive)
  — `searchPlacement: 'as-trigger'`. A typeahead form field with a
  tail-create row.
- [`provider-model-picker`](./provider-model-picker.md) —
  `searchPlacement: 'in-overlay'`. A grouped, rich-row model picker
  with a sticky-footer custom-add composer.
- [`Actions menu`](./actions-menu.md) — `searchPlacement: 'in-overlay'`.
  A two-zone command menu opened by `⚲` / `Cmd-K`.

## Identity & boundary

The component has exactly one structural mode, `searchPlacement`,
with two values:

- **`'as-trigger'`** — the substrate renders the trigger, and the
  trigger is the search input. The combobox idiom: you type into the
  field itself. Autocomplete uses this.
- **`'in-overlay'`** — the consumer supplies the trigger; the search
  field lives inside the opened overlay. The provider-model-picker
  and the Actions menu use this.

Everything else divides cleanly into substrate-owned and
consumer-owned:

| Concern                                     | Owner                                            |
| ------------------------------------------- | ------------------------------------------------ |
| Trigger element (visual)                    | `as-trigger`: substrate · `in-overlay`: consumer |
| Per-tier overlay dispatch (Popover ↔ Sheet) | substrate                                        |
| Search input and `query` state              | substrate                                        |
| Filter predicate (`query` → results)        | consumer                                         |
| Result data (`sections`), row rendering     | consumer                                         |
| Virtualized list, highlight, `Enter`/`Esc`  | substrate                                        |
| No-results state                            | substrate (renders the consumer's `renderEmpty`) |
| Sticky footer                               | consumer (`renderFooter`)                        |
| Activation and the domain commit shape      | consumer (`onActivate`)                          |
| Open/close lifecycle, close-on-activate     | substrate                                        |
| ARIA shape                                  | substrate                                        |

The substrate has **no "create" concept**. Autocomplete's
`+ Add new` row is the last `Row` in its `sections` data; the
picker's custom-add composer is the `renderFooter` slot. Create is
entirely a consumer concern expressed through two generic slots.

Likewise the substrate never filters: it owns the `query` string and
emits `onQueryChange`, the consumer recomputes `sections`. The
picker's capability-keyword matching, Autocomplete's casing
normalization, and the Actions menu's zone collapse all stay
consumer-side.

## API surface

`Row` carries an opaque consumer payload under `data` — the
substrate only ever reads `id` and `disabled`. The payload is nested
rather than intersected so a consumer whose natural identity is not
globally unique (two provider instances can serve the same
`modelId`) can still supply a distinct, composite `id`.

```ts
type Row<T> = {
  id: string // globally unique within the picker; highlight key + React key
  disabled?: boolean // non-interactive; skipped by ↓/↑ highlight nav
  data: T // opaque consumer payload, returned to renderRow + onActivate
}

type Section<T> = {
  id: string
  header?: ReactNode // omit → flat (headerless) section
  sticky?: boolean // pin header while the section scrolls; default false
  rows: Row<T>[]
}

type TriggerProps = {
  // passed to renderTrigger in 'in-overlay' mode
  ref: Ref<unknown>
  onPress: () => void
  open: boolean
  // + aria-haspopup / aria-expanded / aria-controls to spread onto the child
}

type SearchableOverlayListProps<T> = {
  // — mode (required) —
  searchPlacement: 'as-trigger' | 'in-overlay'

  // — open lifecycle —
  open?: boolean // controlled; omit → uncontrolled
  onOpenChange?: (open: boolean) => void

  // — search + data —
  searchPlaceholder?: string
  onQueryChange: (query: string) => void // consumer filters → recomputes sections
  sections: Section<T>[] // POST-filter, in display order
  renderRow: (row: Row<T>, state: { highlighted: boolean; selected: boolean }) => ReactNode
  renderEmpty?: (query: string) => ReactNode // shown when sections flatten to 0 rows
  renderFooter?: () => ReactNode // sticky, inside the overlay, every tier
  selectedRowIds?: readonly string[] // see "Selected rows" below

  // — activation —
  onActivate: (row: Row<T>) => void // row-body press / Enter; substrate closes first

  // — behavior —
  autofocusSearch?: 'always' | 'web-only' // default 'always'
  escClearsQueryFirst?: boolean // default false (Esc closes)
  sheetSize?: 'short' | 'medium' | 'tall' // phone Sheet height; default 'tall'
  initialScrollRowId?: string // row scrolled into view (mid-viewport) on open

  // — 'in-overlay' mode —
  renderTrigger?: (p: TriggerProps) => ReactNode // required when searchPlacement='in-overlay'

  // — 'as-trigger' mode (substrate renders the trigger-as-input) —
  valueLabel?: string // committed value shown when idle
  disabled?: boolean
  disabledReason?: string // web title-tooltip, parity with Input
  'aria-invalid'?: boolean | 'true' | 'false'

  // — a11y + styling —
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
}
```

Fully controlled where it matters — `sections` is always the
post-filter result the consumer hands back; the substrate keeps no
selection state. The same convention as `Select`, `Autocomplete`,
and the picker.

The `Cmd-K`-style global keybind some consumers want is **not** a
substrate concern: the consumer owns the keybind and drives the
controlled `open` prop. The substrate only needs to support
controlled `open`.

## Structure & ARIA

`searchPlacement` and the viewport tier together produce two
rendered shapes:

| `searchPlacement` | desktop / tablet | phone   |
| ----------------- | ---------------- | ------- |
| `as-trigger`      | **Shape 1**      | Shape 2 |
| `in-overlay`      | Shape 2          | Shape 2 |

Shape 1 occupies exactly one quadrant; Shape 2 covers the other
three.

### Shape 1 — combobox with a listbox popup

`as-trigger` on desktop/tablet.

```
[ Reiwa▕                  ]   ← combobox input = trigger
 ┌────────────────────────┐
 │ Reiwa                  │   ← listbox; popover = positioning only
 │ Heisei                 │
 │ Shōwa                  │
 └────────────────────────┘
```

- The trigger is the substrate's text input at the consumer site:
  `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`,
  `aria-controls` pointing at the listbox. It opens on focus or
  typing.
- A [`Popover`](./overlays.md) anchored to the input; the popover
  wrapper is presentational (positioning only), holding a
  `role="listbox"` region.
- Focus stays in the input; `↓`/`↑` move `aria-activedescendant`
  over the `role="option"` rows. **No focus trap** — Tab leaves the
  field and closes the popover.

### Shape 2 — dialog wrapping a combobox and listbox

`in-overlay` at any tier, and `as-trigger` on phone.

```
[ ⚲ ]   ← trigger (consumer renderTrigger, or as-trigger tap-proxy)
 ┌────────────────────────┐   role="dialog"
 │ 🔍 Search…           × │   combobox, pinned top
 ├────────────────────────┤
 │ GO TO                  │   role="listbox"
 │   Open World           │
 │   Open Plot            │
 ├────────────────────────┤
 │ [ footer slot ]        │   sticky (optional)
 └────────────────────────┘
```

- The trigger is the consumer's `renderTrigger` element (or, for
  `as-trigger` on phone, the substrate's tap-proxy — see below).
- desktop/tablet → a [`Popover`](./overlays.md) anchored to the
  trigger; phone → a [`Sheet`](./overlays.md) bottom-anchored. Both
  render `role="dialog"` containing the search input
  (`role="combobox"`) pinned at the top, a `role="listbox"` results
  region, and the optional sticky footer.
- The search input holds DOM focus; `↓`/`↑` move
  `aria-activedescendant`. **Focus trap on** — the substrate opts
  its Popover into the trap (the content-rich opt-in described in
  [`overlays.md → Popover — ARIA contract`](./overlays.md#popover--aria-contract));
  the Sheet traps by default. Tab cycles the search field and the
  footer fields.

### The `as-trigger`-on-phone tap-proxy

A live inline combobox is not a phone idiom. In `as-trigger` mode on
phone the substrate renders a field-shaped tap-proxy showing
`valueLabel`; tapping it opens a Shape-2 Sheet with the real search
input pinned and autofocused. The consumer passes identical props —
the substrate switches on `useTier()`.

### Per-tier dispatch

In-component `useTier()` — the established pattern;
[`overlays.md`](./overlays.md) settled the responsive-switch
question in favor of in-component dispatch rather than a separate
helper primitive. Because the Actions menu opens its Popover
programmatically (`Cmd-K`), the substrate implements the
`useRootContext` bridge that
[`overlays.md → Popover — API surface`](./overlays.md#popover--api-surface)
describes, so its controlled `open` works on the desktop Popover
branch.

### The two shapes differ in only three switches

Both shapes share the rest: the search input is `role="combobox"`,
keeps DOM focus, and `↓`/`↑` drive `aria-activedescendant` over the
`role="option"` rows. The entire delta, switched deterministically
off `searchPlacement` and the tier:

| Delta              | Shape 1                             | Shape 2                              |
| ------------------ | ----------------------------------- | ------------------------------------ |
| Outer overlay role | presentational (popover = position) | `role="dialog"`                      |
| Focus trap         | none (Tab exits, closes)            | trapped (Tab cycles search ↔ footer) |
| Trigger identity   | the combobox input itself           | a separate element                   |

Web `role=` and native best-effort role mapping follow the approach
[`actions-menu.md → Keyboard & ARIA`](./actions-menu.md#keyboard--aria)
already commits to.

## Filter, keyboard, focus & lifecycle

**Filter loop.** A keystroke updates the substrate's internal
`query`, which fires `onQueryChange`; the consumer recomputes
`sections` and hands them back; the substrate re-renders. The
substrate never filters. Filtering is synchronous — every consumer
filters an in-memory list. (Remote/async search is a non-goal; a
consumer that needed it could debounce its own `onQueryChange` and
render a loading row, with no substrate change.)

**Search input dressing.** The substrate-rendered search input
carries a `×` clear affordance whenever it is non-empty, in both
modes. The `🔍` lead glyph appears in `in-overlay` mode only — a
search bar — and is absent in `as-trigger` mode, where the input is
a form field. Deterministic off `searchPlacement`.

**Keyboard highlight.** A single index over the flattened,
non-disabled rows of `sections`.

- **Auto-highlight rule:** a non-empty query auto-highlights the
  first non-disabled row; an empty query highlights nothing. This
  one rule covers Autocomplete's "Enter picks the first match," the
  Actions menu's "first result highlighted when a query is active,"
  and the `+ Add new`-on-no-match case (it is then the only row).
- `↓`/`↑` move the highlight to the next/previous non-disabled row,
  clamped at the ends (no wrap). The highlighted row scrolls into
  view.
- `Enter` activates the highlighted row; it is a no-op when nothing
  is highlighted. `Space` types a literal space — the search input
  has focus, so keyboard activation is `Enter` only.
- `Esc` — with `escClearsQueryFirst` false (the default) it closes
  in one press; with it true, a non-empty query is cleared first
  and a second `Esc` closes.

**Activation and close.** A row-body press or `Enter` closes the
overlay first, then calls `onActivate(row)` — closing first
satisfies the Actions menu's "close the menu before acting" contract
and is harmless for commit-style consumers. Two exemptions: nested
interactive elements inside `renderRow` (a row's favorite toggle,
say) own their press and stop propagation — no activation, no close;
the sticky footer sits outside the listbox, so interacting with it
never activates or closes.

**Open/close behavior.** On close, focus returns to the trigger and
`query` resets to the empty string — the overlay always opens fresh.
On open, behavior keys off `searchPlacement`: `in-overlay` opens
with an empty query (a pure picker browses the full list);
`as-trigger` seeds `query` from `valueLabel`, text-selected and
editable, because a combobox field must open showing its committed
value, not blank. When `valueLabel` is empty the `as-trigger` field
opens empty too.

**`initialScrollRowId`.** On open, the substrate scrolls that row
into view, mid-viewport. This keeps three concepts separate:
_selection_ (the consumer's committed value, surfaced via
`selectedRowIds` — see below), _highlight_ (the substrate's keyboard
cursor, empty on open), and _initial scroll_.

**`renderRow` width convention.** The substrate's row Pressable is
`w-full flex-row`; a consumer's row root needs `w-full` (or
`flex-1`) too so its own children — particularly trailing-aligned
cells — get redistributed across the full row instead of clustering
around the auto-sized content width. `flex-1` inside the consumer
only works once the consumer's root has claimed a width.

**Single-element output.** The substrate always emits exactly one
React element to its parent — `Shape1Inline`'s outer wrapper, the
phone-tier wrap inside `Shape2Dialog`, and `Shape2Dialog`'s
desktop `PopoverPrimitive.Root` each satisfy this. Consumers can
drop the menu into any flex container without an intermediary
wrapping View. The phone wrap is the load-bearing one:
`@rn-primitives/dialog`'s Root renders a default `View` on native,
so a Fragment-return would leak two layout siblings (trigger plus
the invisible Sheet Root). The substrate honors the `className`
prop on the phone wrap so consumers can still pin layout (max
width, self-alignment) from one familiar lever.

**`selectedRowIds` — committed-value affordance.** Consumers that
have a notion of "current selection" (a model picker, a single-select
list) pass the row ids that mirror that value. The substrate paints
each with `bg-bg-sunken` — the convention shared with Select's
customContent rows — so consumers don't re-implement the
selected-row visual. Multiple ids let one logical selection surface
in multiple sections (the picker tints the same model in both the
Favorites strip and its provider section). Suppresses `bg-tint-hover`
on selected rows so the selection signal isn't muddled by hover.
Distinct from highlight: highlight is the keyboard cursor, selected
is the committed value. Consumers without a selection concept
(Autocomplete, ActionsMenu) omit the prop and the substrate stays in
highlight-only mode. Enabled rows also carry the pointer twin —
`hover:bg-tint-hover`, same tint, same suppress-on-selected rule —
so mouse users get row feedback without the keyboard cursor moving;
hover and cursor may momentarily tint two rows, which is accepted.

**In-flight gating.** A consumer can flip `Row.disabled` reactively
while the overlay is open — disabled rows render non-interactive and
are skipped by highlight navigation. If the currently-highlighted
row becomes disabled, the substrate advances the highlight to the
nearest still-enabled row, or clears it if none remain. In
`as-trigger` mode the whole control honors the
[edit-restrictions principle](../principles.md#edit-restrictions-during-in-flight-generation)
via `disabled` / `disabledReason`.

## Not a consumer — Select

`Select` is **not** a consumer. Its dropdown surface uses
`@rn-primitives/select`'s own Portal / Overlay / Content machinery
rather than this codebase's Popover primitive, so it cannot share
this dispatch — see
[`forms.md → Select — implementation contract`](./forms.md#select--implementation-contract).
The [calendar picker](./calendar-picker.md) rides `Select` and is
therefore not a substrate consumer either.

## Implementation notes

- **Virtualization is always on**, regardless of source-list size:
  `@tanstack/react-virtual` on web, `SectionList` (the sectioned
  member of the `FlatList` family, for native sticky section
  headers) on native. The shipped `Autocomplete` (`autocomplete.tsx`)
  is the reference implementation for the virtualization this
  substrate generalizes.
- **The hardest build surface** is virtualization combined with
  sticky section headers, `initialScrollRowId`, and
  highlight-scroll-into-view at once. Both libraries support it —
  `SectionList` natively, `@tanstack/react-virtual` via a sticky
  `rangeExtractor` — but the build pass should budget for it.
- **Zero user-facing strings.** Every visible string —
  `searchPlaceholder`, `renderEmpty`, `renderRow` content,
  `Section.header` — is consumer-supplied. Consumers route their own
  copy through the translation surface; the substrate has nothing to
  translate.
- **Baseline:** composed from the existing `Popover`, `Sheet`, and
  `Input` primitives plus the virtualizer — no react-native-reusables
  scaffold of its own. Per
  [`components.md`](../components.md), it lives in `components/ui/`
  as a primitive.

## Storybook

Per the [`components.md` axes-driven rule](../components.md#storybook-story-conventions):

- **Default** — `in-overlay` mode, sectioned content, open.
- **Modes** — `as-trigger` (combobox, Shape 1) · `in-overlay`
  (Shape 2).
- **States** — closed · open · no-results (`renderEmpty`) ·
  with-sticky-footer · disabled (`as-trigger`) ·
  long-list-virtualized (200+ rows, sticky headers).
- **ThemeMatrix**.

The MDX page cites this file as canonical and embeds the component
stories — no prose duplication.
