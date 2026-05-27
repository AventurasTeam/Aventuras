# Toolbar pattern

List-pane chrome compound: search, filter chips, and conditional
sort, with a cross-tier overflow rule that wraps cleanly from
desktop single-row to narrow stacked-rows.

Sister patterns:

- [`lists.md`](./lists.md) — search-bar-scope contract that
  `Toolbar.Search` composes; large-list rendering rules
  downstream.
- [`chips.md`](./chips.md) — Chip primitive; `Toolbar.FilterChips`
  is a layout container for Chip children, host owns
  selection semantics.
- [`forms.md → Select primitive`](./forms.md#select-primitive) —
  `Toolbar.Sort` is a Select forced to dropdown mode.

Used by:

- [Story List](../screens/story-list/story-list.md#toolbar) — search,
  filter chips (`All` / `Favorited` / `Archived`), sort dropdown.
- [World list pane](../screens/world/world.md#list-pane--search-scope) —
  search, filter chips. Host wraps Toolbar with a 5-way kind-selector.
- [World history tab](../screens/world/world.md#history-tab) — search,
  op-filter chips, sort dropdown.
- [Plot list pane](../screens/plot/plot.md#mobile-expression) —
  search, filter chips. Host wraps Toolbar with a 2-way Plot
  threads/happenings segment.
- [Plot history tab](../screens/plot/plot.md#mobile-expression) —
  search, op-filter chips, sort dropdown.
- [Reader Browse rail](../screens/reader-composer/reader-composer.md#browse-rail--search-scope) —
  search, filter chips. Host wraps Toolbar with a 7-way kind-selector
  coupled to the rail-collapse mode.
- [Diagnostics Hub · Logs tab](../screens/diagnostics/diagnostics.md#filters--toolbar-composition) —
  Kind free-text (Toolbar.Search), Level filter chips, Subsystem
  [MultiSelect](./multi-select.md) trigger as secondary chrome.
  First consumer adopting a MultiSelect alongside Chip in the
  secondary cluster.

## What's in scope

- Bar wrapper (border, density-aware padding, layout grid).
- Three slots: search, filter chips, sort.
- Cross-tier overflow rule (search-on-own-row at narrow tiers,
  single horizontal row at desktop).

## What's NOT in scope

- **Kind-selector.** Mode-setter for the entire surface chrome
  (changes search placeholder, scope, filter choices, row shape).
  Surfaces with kind-coupling wrap Toolbar with their own selector.
  Lives outside the compound.
- **Overflow menu (`⋯`).** Belongs on detail-heads, not list-pane
  tops. Toolbar stays slot-visible at every tier.
- **Footer affordance (`+ New`).** Lives below the list, not in
  the toolbar bar.
- **Search primitive itself.** `Toolbar.Search` composes the
  existing [search-bar-scope pattern](./lists.md#search-bar-scope)
  without redefining it.

## Compound API

```tsx
<Toolbar>
  <Toolbar.Search
    value={query}
    onChange={setQuery}
    placeholder="Search title, description…"
    scope={['title', 'description', 'definition.genre.label', 'tags']}
  />
  <Toolbar.FilterChips>
    <Chip selected={filter === 'all'} onPress={() => setFilter('all')}>
      All
    </Chip>
    <Chip selected={filter === 'favorited'} onPress={() => setFilter('favorited')}>
      Favorited
    </Chip>
  </Toolbar.FilterChips>
  <Toolbar.Sort
    value={sortKey}
    onChange={setSortKey}
    label="Sort"
    options={[
      { value: 'last-opened', label: 'Last opened' },
      { value: 'created', label: 'Created' },
      { value: 'title', label: 'Title' },
    ]}
  />
</Toolbar>
```

Composition-via-children with sub-components, matching SaveBar /
JSONViewer / FormRow conventions. Slot order is fixed: search →
chips → sort. Unknown children pass through as-is (escape hatch
for surface-specific extras), but the canonical three are the
named ones.

### `<Toolbar>`

Bar wrapper. Owns layout, density-aware padding, the cross-tier
overflow rule. No additional props beyond `className`.

### `<Toolbar.Search>`

Wraps the [search-bar-scope pattern](./lists.md#search-bar-scope)
into a single sub-component.

Props:

- `value: string`
- `onChange: (value: string) => void`
- `placeholder: string` — short, truncation-safe under ~25
  characters per the scope pattern.
- `scope: string[]` — the searchable field names; surfaces as
  the focus-tooltip content (web) and the ⓘ help-popover content.
- `disabled?: boolean`, `disabledReason?: string` — uniform with
  Input and other gated controls.

Internally renders `<Input leading={<Icon as={Search}/>}
trailing={<ScopeHelpPopoverTrigger scope={...}/>}/>`. Trailing
icon opens a Popover on every tier showing the scope as a
labeled list — Sheet would be overkill for an info-tooltip-shaped
affordance (no decision to make, no list to scroll, just a few
fields to glance at). Web also gets a focus-tooltip below the
input fading after 2 s; native skips the focus-tooltip and
relies on the ⓘ trigger as the discovery affordance.

Default width: `flex-1` to fill available space at desktop, full
width at narrow tiers per the overflow rule. Consumers can
width-cap via `className="max-w-[360px]"` (Story List uses this).

### `<Toolbar.FilterChips>`

Layout container for `<Chip>` children. `flex-row flex-wrap
items-center gap-2`, density-aware. Single-select vs multi-select
semantics are host concern; the [Chip primitive](./chips.md#chip--square-toggleable)
supports both via `selected` boolean.

Props: `className?` only.

### `<Toolbar.Sort>`

`<Select>` forced to `mode="dropdown"` always — bypasses the
[Select cardinality cascade](./forms.md#auto-derivation-cascade)
so 3-option sorts don't render as segments. Visual consistency:
every surface's sort affordance is a chevron trigger with the
selected value visible.

Props:

- `value: string`
- `onChange: (value: string) => void`
- `options: Array<{ value: string; label: string }>`
- `label?: string` — prefix shown before the selected value
  (e.g., `Sort: Last opened ▾`).
- `disabled?: boolean`

Trigger renders compact: `[Sort: <selected.label> ▾]` if `label`
provided, else bare `[<selected.label> ▾]`. Hugs content;
right-aligned at desktop, wraps onto the second row at narrow
tiers.

Phone: opens via Sheet (short) per the existing tier-aware Select
binding. Tablet/desktop: anchored Popover.

## Height contract — primary input vs secondary chrome cluster

A Toolbar instance has two height roles, and consumers don't pick
the tier — the role does.

- **Primary input** — zero or more focal labeled controls consumers
  actively type into. In Toolbar today this is `Toolbar.Search`.
  Renders at `h-control-md` (44 px at regular density). HIG-clean on
  mobile by construction; visually taller signals "this is the focal
  interactive surface; the rest modify it."
- **Secondary chrome cluster** — labeled affordances that modify or
  filter the primary input's behavior. In Toolbar today:
  `Toolbar.FilterChips` (Chip children) and `Toolbar.Sort`. All
  render at `h-control-xs` (36 px at regular). Mutually
  height-uniform by construction — Chip is fixed at xs per
  [`chips.md → Height`](./chips.md#height); `Toolbar.Sort` uses
  `Select size="xs"` per
  [`forms.md → Trigger sizes`](./forms.md#trigger-sizes).

**Why two heights, not one.** The "same height feels right for
adjacent controls" rule applies **within** the secondary cluster
(Chip and Sort mutually align). It is **not** extended across
primary↔secondary — that would force Search below HIG
(36 px < 44 pt), which
[`spacing.md → Tap-target on native`](../foundations/spacing.md#tap-target-on-native)
explicitly preserves as a v1 invariant. Real-world chrome-row
designs (browser address bars dwarfing icon clusters; macOS
toolbars; Slack channel headers) all do this two-tier split. The
contract resolves the secondary-cluster mismatch without touching
primary-input sizing.

**Cross-tier composition** stacks with the
[overflow rule below](#cross-tier-overflow-rule):

- **Desktop (`≥ 1024 px`)** — single horizontal row, two heights —
  Search at md, Chips and Sort at xs. The 8 px height delta reads
  as visual hierarchy, not inconsistency.
- **Tablet / phone (`< 1024 px`)** — Search on its own row at md;
  Chips and Sort overflow into a secondary row, both at xs. The
  overflow row **is** the secondary cluster; everything in it is
  height-uniform.

**Out of scope of the contract.**

- **IconAction in Toolbar.** IconAction uses its own
  [`h-icon-action-*`](../foundations/spacing.md#component-internal-sizing-tokens--density-aware)
  token system (28 / 32 / 36 px at regular for sm / md / lg),
  intentionally smaller than control-h tokens. If a future Toolbar
  adds an IconAction to the chrome cluster (e.g., a "clear filters"
  trash icon), it doesn't height-align with the labeled controls —
  square icon buttons are shape-distinct by design. The contract
  applies only to labeled chrome controls.
- **Toolbar without a primary input.** Pure-chrome Toolbar (Chips
  and Sort, no Search) collapses to one height — the secondary
  cluster at xs. The rule simply has no primary role to apply.
- **Other chrome-row compounds.** Locally scoped to Toolbar for v1.
  Promote to [`principles.md`](../principles.md) when the next
  consumer (DeltaLogRow's badge-vs-controls adjacency, StoryCard's
  status-strip) needs the same rule.

## Cross-tier overflow rule

### Desktop (`≥ 1024 px`)

Single horizontal row.

```
[search……………………………………] [filter chips] [Sort: Last opened ▾]
```

### Tablet and phone (`< 1024 px`)

Search takes its own full-width row first; filter chips and sort
wrap beneath as a single chip-flow row.

```
[search……………………………………………………………………………………………]
[filter chips wrap…]                [Sort: Last opened ▾]
```

### Mechanism

- Toolbar wrapper uses `flex-row flex-wrap` at narrow tiers; the
  search slot has `flex-basis: 100%` to force its own row.
- Filter chips and sort live in the second row, naturally wrapping
  if chip count overflows.
- Container-keyed via `@container (max-width: 1023px)` on web;
  tier-keyed via `useTier()` on native
  (`tier === 'phone' || tier === 'tablet'`). Same dual-mechanism
  pattern [FormRow](./forms.md#form-rows--stacked-on-narrow-container)
  uses.

### Why container-keyed (not viewport-keyed) on web

The Toolbar can sit inside a narrow detail-pane on a wide viewport
(a tablet-landscape Plot history list inside a 600 px detail
container is mobile-narrow). Same trade-off the FormRow pattern
locked.

### Density coupling

- Phone: `min-h-control-lg` per row — meets the 44 px touch floor
  on the search input and sort trigger.
- Tablet/Desktop: `min-h-control-md`.
- Vertical gap between rows at narrow tier: `gap-2` (8 px) — enough
  to separate visually, tight enough that the toolbar doesn't
  dominate.

### No overflow menu

Toolbar deliberately doesn't collapse pieces into a `⋯` menu:

- Search must always be visible (blocking it behind a menu
  defeats the surface).
- Filter chips need at-a-glance state; menu collapse hides which
  filter is active.
- Sort being one slot means there's nothing meaningful to
  overflow-menu.
- Wrap-then-stack handles every viewport case the surfaces care
  about.

## Implementation flag

Slot detection iterates `React.Children` and type-checks each
child against the sub-component identity. `Toolbar.Search`,
`Toolbar.FilterChips`, and `Toolbar.Sort` need stable identity
(not arrow-function components defined inline) so the type-check
matches across renders.

## Storybook (Toolbar)

Live demos for: search-only (no chips, no sort), search and
chips, search-chips-sort full row, narrow-container layout (search
own row, chips and sort wrap below), disabled search, sort
forced-dropdown at 3 options. Belongs in
`Patterns/List-pane chrome/Toolbar` when component implementation
begins.

## What this design defers

- **Drag-reorder of filter chips, slot order rearrangement** —
  v2+. Slot order is fixed.
- **Compact / dense Toolbar variants** — no v1 surface needs a
  stripped-down toolbar.
- **Async-search debouncing, virtualized result counts** —
  search-side concerns, not toolbar concerns. The compound wires
  `value` and `onChange` straight through.
- **Standalone `<ScopeHelp>` micro-component** — if a second
  non-Toolbar consumer surfaces, the search-with-scope shape can
  graduate to its own export. Today, `Toolbar.Search` is the
  search-with-scope wrapper.
