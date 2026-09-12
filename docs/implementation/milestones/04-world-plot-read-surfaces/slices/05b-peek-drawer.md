# Slice 4.5b — Peek drawer

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.5a](./05a-browse-rail.md) (the rail hosts
  the peek and owns the Sheet morph seam, C10; C1 and C6 reach this
  slice through 4.5a's gates) and [Slice 4.2a](./02a-entity-detail.md)
  (the peek body is the Overview component in its `peek` variant;
  `Set as lead` calls C5)
- **Blocks:** none

## Goal

Clicking a rail row opens the peek drawer — a ~440 px right Sheet on
desktop and tablet, the rail Sheet morphed to its tall detent on phone
— whose body is the World panel's Overview component for entities, the
read-only Body-plus-signals projection for lore, and a summary for
threads and happenings; whose head carries the `You` / `Protagonist`
badge or the `Set as lead` action for characters; and whose foot link
`Open in [World|Plot] panel →` lands the panel with the row
pre-selected (C6).

## Background

Peek is level two of entity surfacing: summary plus escalation. Canon
insists on one design, two surfaces — the peek body **is** the
Overview tab rendered narrower, including the non-default injection
chip — so this slice renders 4.2a's exported component with its `peek`
variant rather than restating it. Lore has no Overview, so its peek is
its own read-only composition. The lead-character mutation is the only
inline write on the peek; no confirm, the reader's `You` anchor
re-anchoring is the feedback. Peek implies rail open: collapsing the
rail closes the peek, and on phone the peek is the `peek` content
state of the rail Sheet with an icon-only `←` rather than a second
Sheet.

## Required reading

- [`reader-composer.md → Peek drawer — lead affordance for characters`](../../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters),
  [`State-field composition — same as World panel Overview`](../../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--same-as-world-panel-overview),
  [`State-field composition — lore peek`](../../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--lore-peek),
  [`Peek drawer — peek implies rail open`](../../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--peek-implies-rail-open)
  and the peek bullets of
  [`Mobile expression`](../../../../ui/screens/reader-composer/reader-composer.md#mobile-expression).
- [`world.md → Overview — glance summary, read-mostly`](../../../../ui/screens/world/world.md#overview--glance-summary-read-mostly)
  — the component being projected.
- [`patterns/entity.md → Entity surfacing`](../../../../ui/patterns/entity.md#entity-surfacing--three-levels-same-data).
- [`patterns/save-sessions.md → Quick-edit exception — peek drawer`](../../../../ui/patterns/save-sessions.md#quick-edit-exception--peek-drawer)
  — the exception this slice does **not** build; see Scope: out.
- [`principles.md → Mode, lead, and narration`](../../../../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts).
- [`layout.md → Surface bindings`](../../../../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)
  (the Peek drawer row) and
  [`Mapping — desktop to mobile`](../../../../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile).
- [`navigation.md → Cross-surface navigation model`](../../../../ui/foundations/mobile/navigation.md#cross-surface-navigation-model)
  and [`collapse.md → Two-pane navigation surfaces`](../../../../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings)
  — the pre-selected deep link on both tiers.
- [Milestone contracts C1, C5, C6, C10](../milestone.md#slice-contracts).

## Scope: in

- **Drawer host:** desktop / tablet right Sheet (~440 px) sliding
  over rail and narrative; `×` and Esc close; opening on rail-row
  click only (replacing 4.5a's interim route-to-panel); closing when
  the rail collapses (manual or viewport-forced).
- **Peek head:** kind icon, name, the C1 recently-classified badge;
  for characters the `You` / `Protagonist` badge (mode-dependent copy)
  when lead, otherwise the inline `Set as lead` text-action calling
  C5 and transitioning in place; portrait thumbnail slot (placeholder
  until the asset link exists).
- **Peek body:** entities — 4.2a's Overview in its `peek` variant at
  440 px, with `onRegionPress(tab)` routing to the World panel via C6's
  `tab` param; lore — chip row (injection chip when non-default,
  category chip), body truncated at ~10 lines, tags; threads — status,
  category, description; happenings — when-marker, `⊙` if common
  knowledge, description, involvement and awareness counts.
- **Foot link:** `Open in World panel →` / `Open in Plot panel →`
  routing with `{ kind, id }` (C6); on phone the destination mounts in
  detail state.
- **Phone content:** fills C10's `peek` slot — row tap inside the
  rail Sheet swaps content and grows to the tall detent; icon-only `←`
  returns to the list; drag-down and backdrop dismiss the whole Sheet
  from either state.
- **Reader hooks:** the `You` anchor and narration re-anchor after
  `Set as lead` (already store-driven; assert it).
- **Storybook:** peek per kind at 440 px, lead / not-lead heads,
  phone content states.

## Scope: out

- Pencil quick-edits on peek text fields.
  [`reader-composer.md → State-field composition`](../../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--same-as-world-panel-overview)
  makes the lead mutation the peek's only inline write, while
  `save-sessions.md` and `collapse.md` still spec the blur-commit
  exception; M4 follows the reader doc and the edits are filed in
  [`parked.md → Peek quick-edits`](../../../../parked.md#peek-quick-edits)
  with the canon conflict noted.
- The rail and the Sheet host — [Slice 4.5a](./05a-browse-rail.md).
- Overview composition — [Slice 4.2a](./02a-entity-detail.md).

## Acceptance criteria

- A vitest asserts the peek body for an entity and the World panel's
  Overview tab resolve to the same exported component reference;
  clicking a character row opens the peek showing the same regions the
  panel shows for that row (Storybook side by side at 440 px).
- `Set as lead` on a non-lead character writes
  `definition.leadEntityId`, the head switches to the badge without a
  confirm, and the reader's `You` badge moves (E2E on desktop).
- The action is absent on every non-character kind; on the current
  lead the badge reads `You` in adventure mode and `Protagonist` in
  creative (component test).
- Collapsing the rail while a peek is open closes both; the peek
  cannot be opened while collapsed (component test).
- `Open in World panel →` lands World with the row selected on
  desktop; pressing the Overview's visual line lands World on the
  Identity tab; `Open in Plot panel →` from a happening peek lands Plot
  with that row selected; on phone each lands in the detail state with
  the first `←` returning to the list (E2E on desktop; manual on
  Android).
- On phone, a row tap morphs the Sheet to the peek at the tall
  detent, `←` returns to the list, drag-down dismisses from the peek
  state (component test on the C10 state machine; manual on Android).
- Lore peek truncates a 40-line body at ~10 lines with an ellipsis and
  hides `priority` (Storybook plus component test).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: peek state machine (open / close / rail-collapse / phone
  content swap), per-kind body selection, component-reference
  identity.
- Component tests: heads per lead state, foot routing, lore
  truncation.
- Storybook: the matrix above.
- E2E (desktop): rail row → peek → Set as lead → Open in panel (both
  panels).

## Open questions

- **Thread / happening peek content.** Canon says the peek-head is
  unchanged for those kinds and defines no body; the summaries above
  are the default assumption — confirm and, if kept, add a line to
  `reader-composer.md`.
- **Deep-link stack matching ignores params.** `hooks/use-surface-navigate.ts`
  matches stack entries on the path only, so `/world/<branch>?kind=…&id=…`
  pops back to an existing World screen and drops the selection — and
  does nothing at all when that World screen is already on top,
  dropping the selection the same way. Decide: match on path plus
  params, or `setParams` when the params differ.
- **Deep-linked selection isn't revealed.** A row selected via the
  deep link is selected but not revealed in the list (its tier stays
  collapsed, the list sits at the top) — call the list's `revealRow`
  once the story is hydrated.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
