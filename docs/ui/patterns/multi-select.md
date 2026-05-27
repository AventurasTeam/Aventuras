# MultiSelect pattern

Dropdown-style multi-select for enumerable filter dimensions where
the candidate set is too large for a chip row but the cardinality
is bounded. Designed for filter contexts where the user toggles any
subset of N values on or off, and the trigger surfaces "what's
selected" as a state summary rather than as visible chips.

Sister patterns:

- [`forms.md → Select primitive`](./forms.md#select-primitive) —
  the single-value sibling. Same dropdown family; mutually exclusive
  by render mode (Select commits one value, MultiSelect maintains a
  set).
- [`chips.md → Chip`](./chips.md#chip--square-toggleable) — Chip
  row remains the canonical shape for small fixed enums (≤ ~4
  options, color-coded, frequent toggling). MultiSelect picks up
  where Chip row stops scaling.
- [`toolbar.md`](./toolbar.md) — MultiSelect slots into the Toolbar
  secondary chrome cluster height-uniform with Chip and Sort,
  inheriting Toolbar's
  [height contract](./toolbar.md#height-contract--primary-input-vs-secondary-chrome-cluster).

Used by:

- [Diagnostics Hub · Logs tab — Subsystem filter](../screens/diagnostics/diagnostics.md#filters--toolbar-composition) —
  first consumer. Subsystem multi-select against the open-ended
  `LogSubsystem` union.
- [Diagnostics Hub · Call log tab — Source + Status range filters](../screens/diagnostics/diagnostics.md#filters-call-log) —
  Source multi-select against provider/embedder enum; Status
  range multi-select against five HTTP status buckets
  (`1xx / 2xx / 3xx / 4xx / 5xx`). Status range adopts a
  per-row severity-color dot inside the overlay (consumer-side
  styling; primitive remains policy-neutral).
- [Diagnostics Hub · Delta log tab — Source + Target table filters](../screens/diagnostics/diagnostics.md#filters-delta-log) —
  Source multi-select against the deltas source enum
  (`classifier / lore_mgmt / user_edit / chapter_close / …`);
  Target table multi-select against the deltas target_table
  enum (`entities / lore / happenings / threads / translations /
…`).

## When to pick MultiSelect over Chip row

- **Cardinality**: ≥ 5 candidate values, OR an open-ended enum that
  grows over time. Chip rows visible-at-a-glance fail past ~5 items.
- **Selection cohort**: candidates carry equal weight visually
  (no severity-coded coloring per value). If individual values
  carry strong visual semantics — `warn`/`error`/`debug` are
  color-coded — Chip row keeps the per-value tone visible.
- **Default state**: typically all-selected. Users filter by
  exclusion. (If the typical default is none-selected with
  inclusion-only toggles, Select primitive's radio mode may fit
  better.)

Diagnostics Logs is the prototypical case: `LogSubsystem` is an
open-ended union (~8 today, grows with new subsystems), values
are visually equivalent (no severity coloring), default is all-on.

## Trigger

```
<prefix>: <state> ▾
```

Render at `xs` height (`h-control-xs` — 36px regular density),
matching the [Toolbar secondary chrome cluster](./toolbar.md#height-contract--primary-input-vs-secondary-chrome-cluster).
Caret on the right.

`<state>` auto-computes from the selection vs the option set:

- `all` — every option selected.
- `none` — zero options selected.
- `N of M` — partial selection (e.g., `4 of 8`).

The label prefix is the dimension name (`Subsystem`, `Source`,
`State`). Kept short to honor the trigger's compact width.

**The primitive is policy-neutral on selection state.** The
primitive renders `none` when the selection is empty; it does not
enforce a minimum selection. Consumers wanting "at least one
selected" enforce it at the host (disabling the last checkbox in
the overlay; intercepting the toggle). Consumers wanting visual
de-emphasis for the `all` state (a "filter not active" cue) override
the trigger's class via composition; the primitive ships one neutral
trigger style.

## Opening surface

Per-tier dispatch matches the rest of the project's overlay system
(see [`foundations/mobile/layout.md`](../foundations/mobile/layout.md)):

- **Desktop / tablet**: anchored Popover.
- **Phone**: Sheet (medium). Sheet's internal scroll handles
  list overflow.

Behind the scenes the trigger reads `useTier()` to pick the surface.

## Overlay content

Header row + list:

```
┌────────────────────────────────────┐
│  [Select all]   [Clear all]        │  ← header, h-control-xs
├────────────────────────────────────┤
│  ☑ classifier                      │
│  ☑ retrieval                       │
│  ☐ provider                        │
│  ☑ embedder                        │
│  ☐ pipeline                        │
│  …                                 │
└────────────────────────────────────┘
```

### Header — Select-all / Clear-all

Two text-link buttons, both rendered always, **disabled-when-moot**:

- `Select all` disabled when every option is already selected.
- `Clear all` disabled when no options are selected.

The disabled-when-moot rule doubles as state visualization:
both buttons enabled = mixed selection state; one enabled = at
an extreme.

Other affordances considered and ruled out for v1:

- **Master Checkbox with indeterminate state.** Would require
  extending the [Checkbox primitive](./forms.md#checkbox-primitive)
  with an indeterminate variant — a primitive surface change for
  marginal visual saving.
- **Segmented `[All | None]` toggle.** Segment is for committing a
  value pick, not for firing toggle-all actions. Semantically off.

### List rows — Checkbox + label, whole-row tappable

Each option renders as a row with the
[Checkbox primitive](./forms.md#checkbox-primitive) on the left
and a `<Text>` label on the right. The whole row is the tap target
(label + Checkbox both fire toggle), following the
[SwitchRow pattern](./forms.md#switchrow-pattern) precedent.

Row chrome:

- Density-aware row padding (`px-row-x-md py-row-y-md`).
- Hover (web) / active (every tier): `bg-bg-raised`.
- Disabled rows: `opacity-50`, taps blocked.

The MultiSelect host can pass per-option disabled state to gate
individual rows.

### Live-commit semantics

Each row toggle fires `onChange` immediately with the new selected
set. No "Apply" button — multi-select filters in the project are
live-applied universally (Story List `Favorited` chip, World filter
chips, etc.). The pattern stays consistent.

Closing the overlay (tap-outside, Esc, swipe-down on Sheet) is a
no-op for state — the user's last toggle is already committed.

## Source list ordering

Options render in source order — the order the host passes them
in. The primitive doesn't reorder, doesn't sort alphabetically,
doesn't float-selected-first. Reasoning:

- Stable order across openings (selected ones don't jump to top
  on re-open).
- Source order can encode meaning (union declaration order, source
  taxonomy order); the primitive doesn't second-guess it.
- "Selected-first" reorder is a notable UX pattern but introduces
  positional churn that confuses repeated-toggling users.

Hosts wanting a sort apply it before passing the options.

## What this defers

- **`searchable: true` prop.** Future opt-in to a search input
  inside the overlay (composing
  [`SearchableOverlayList`](./searchable-overlay-list.md) in
  `searchPlacement: 'within'` mode). Skipped in v1 — current Logs
  Subsystem has ~8 options, well below the threshold where search
  earns its weight. Re-evaluate when the first consumer crosses
  ~15 options or surfaces a long enum (see
  [`parked.md`](../../parked.md)).
- **Indeterminate master Checkbox.** Considered as the Select-all
  / Clear-all alternative; punted as a Checkbox-primitive extension
  not earned by the first consumer.
- **Group sub-headers.** Option lists today are flat. Grouped
  options with sub-headers (e.g., `Source: providers / sources /
backends` if a future consumer's enum partitions naturally) would
  require source-list shape changes; defer until needed.
- **Search-by-value type-ahead.** Distinct from the `searchable`
  prop — keyboard search where typing `r` jumps to the first
  option starting with `r`. Native dropdown convention but not yet
  consumer-needed.

## Compound API (informative; finalize at component implementation)

```tsx
<MultiSelect
  prefix="Subsystem"
  options={subsystemOptions} // string[] in source order
  selected={selectedSubsystems} // Set<string> | string[]
  onChange={(next) => setSubsystems(next)}
  disabled={false}
  triggerClassName="..." // for consumer styling overrides
/>
```

Props (sketch):

- `prefix: string` — label prefix on the trigger.
- `options: readonly Option[]` — source list in render order.
  `Option` = `{ value: string; label?: string; disabled?: boolean }`.
  Defaults `label = value`.
- `selected: ReadonlySet<string> | readonly string[]` — current
  selection. Accepts either shape; primitive normalizes internally.
- `onChange: (next: string[]) => void` — fires on every toggle and
  on Select-all / Clear-all activations.
- `disabled?: boolean` — whole-control disable.
- `disabledReason?: string` — title-tooltip parity with other
  gated controls (consistent with Input / Select).
- `triggerClassName?: string` — class override for the trigger
  (consumer customization for the `all` state, etc.).

## Implementation contract

- **Baseline source.** No direct rn-reusables baseline. Composes
  the existing Popover primitive (anchored, desktop/tablet) and
  Sheet primitive (medium, phone) per the
  [overlays mapping](./overlays.md), with Checkbox rows inside
  per [`forms.md → Checkbox`](./forms.md#checkbox-primitive).
- **Per-tier dispatch.** `useTier()` selects Popover vs Sheet at
  the trigger's open boundary — mirrors the Select primitive's
  phone-Sheet bridge.
- **Trigger.** A `Pressable` row with the auto-computed state
  label and a Chevron icon. Trigger styling lives in
  `components/ui/multi-select.tsx`; the overlay content lives
  in the same file (compound layout, not a separate file).
- **Keyboard handling.**
  - Desktop: trigger opens on Space/Enter; overlay closes on
    Esc; arrow keys move row focus; Space/Enter toggles focused
    row.
  - Phone: standard Sheet keyboard handling per
    [`overlays.md → Sheet — Keyboard handling`](./overlays.md#sheet--keyboard-handling).
- **Touch-target floor on phone.** Rows render at
  `min-h-control-lg` (44px) inside the Sheet to meet the touch
  floor, even though the Checkbox primitive itself is smaller —
  the row's tappable area meets the floor.

## Storybook

`Primitives/MultiSelect` — basic (all-selected default), partial
selection (`N of M`), none-selected, disabled control, per-option
disabled row, narrow-container phone variant, ThemeMatrix.
