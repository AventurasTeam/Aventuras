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
  C5 and transitioning in place.
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
  from any level.
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
  `reader-composer.md`. Resolved (developer, 2026-10-08): kept,
  read-only, nothing pressable; the thread body adds the non-default
  injection chip, and a common-knowledge happening reads
  `Common knowledge` in place of its aware count — see
  [`reader-composer.md → State-field composition — thread and happening peek`](../../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--thread-and-happening-peek).
- **Deep-linked selection isn't revealed.** A row selected via the
  deep link is selected but not revealed in the list (its tier stays
  collapsed, the list sits at the top) — call the list's `revealRow`
  once the story is hydrated. Resolved in planning (2026-10-08):
  World's mount arrival calls `revealRow`, as Plot's already did. On
  desktop and tablet the row's tier opens and the list scrolls to it.
  On phone the list sits under the detail with `display: none`, so the
  tier opens but the scroll is a no-op, and the first `←` shows the
  tier open with the list at the top (Plot behaves the same); filed in
  [`triage.md`](../../../triage.md).
- **Read the lead through `resolveLead`** (4.2b): a reversal can leave
  `leadEntityId` dangling, and the You badge / peek `Set as lead` must
  treat it as absent. Resolved in planning (2026-10-08): the peek
  reads the lead from the rail's data, which resolves it through
  `resolveLead`, so a dangling lead reads as absent and every active
  character offers `Set as lead`.
- **The branch-change reset is inherited.** The drawer reads
  `display.peek`, which `readerRailStore.enterBranch` clears on a branch
  change. The phone Sheet needs nothing: `RailSheet` resets to its opened
  state on every open, and a modal Sheet can't stay open across a branch
  change ([4.5a's notes](./05a-browse-rail.md#implementation-notes)).
  Resolved in planning (2026-10-08): inherited as described; nothing
  built.
- **The desktop drawer renders only under an expanded rail.** Render it
  when `!isRailCollapsed && peek`: a peek can survive under a collapsed
  rail if the stored preference flips another way, such as a settings
  import. Resolved in planning (2026-10-08): the drawer mounts on
  tablet and desktop only, and opens only while the reader is focused,
  the rail shows expanded and the peek names a row that still resolves;
  a peek found under a collapsed rail is also cleared, so the next
  expand doesn't bring it back.
- **A peek whose row is deleted while it is open.** Decide what the
  drawer does; nothing in 4.5a covers it. Resolved (developer,
  2026-10-08): see Implementation notes.
- **`Open in panel →` needs `ReaderBrowseChip`'s `setOpen`**, so
  `renderPeek` stays owned by `ReaderBrowseChip` rather than moving into
  `RailSheet`, which holds the peek state. Resolved in planning
  (2026-10-08): as stated; `Open in panel →` and an Overview region
  close the Sheet, then route, behind the Sheet's open guard, so a
  second press during the close routes nothing.
- **The lead label is derived in two places, and the peek would make
  three.** The mode to `LeadLabel` ternary lives in
  `app/world/[branchId].tsx` and
  `components/reader/rail/use-rail-data.ts`; the peek head would be a
  third copy. Add a `leadLabelFor(mode)` helper as part of this slice.
  Resolved in planning (2026-10-08): `leadLabelFor(mode)` in
  `lib/world/lead.ts`, which World and the rail call; the peek reads
  the rail's label rather than deriving its own.

## Implementation notes

Developer decisions that deviate from the brief or bind a later slice.
Canon carries the detail; each line points to it.

- **The desktop and tablet drawer is the blocking right `Sheet`**
  (developer, 2026-10-08): a scrim and a focus trap, and Esc, `×` or a
  click outside closes it, so the narrative and composer are inert
  while it is open. The reader's undo / redo and End keys stand down
  under any blocking overlay (`blockingOverlaysStore`). The
  wireframe's phone-only backdrop changed with it; see
  [`reader-composer.md → Layout`](../../../../ui/screens/reader-composer/reader-composer.md#layout)
  and [`layout.md → Sheet`](../../../../ui/foundations/mobile/layout.md#sheet).
- **Focus lands on the drawer when it opens** (developer, 2026-10-08),
  not on its first button, which for a non-lead character is
  `Set as lead`; it stays on the dialog through the swap and returns to
  the rail row on close unless the row has moved. Canon:
  [`reader-composer.md → Peek drawer — peek implies rail open`](../../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--peek-implies-rail-open).
  The dialog takes focus by ref in `onOpenAutoFocus`, since Radix's
  `event.currentTarget` there is its unnamed wrapper. After a
  successful `Set as lead` the row moves, so that close drops focus to
  `<body>` (see [triage](../../../triage.md#inbox)).
- **Thread and happening peeks are read-only summaries** (developer,
  2026-10-08); see
  [`reader-composer.md → State-field composition — thread and happening peek`](../../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--thread-and-happening-peek).
- **A peeked row deleted while it is open closes the peek** (developer,
  2026-10-08), with no toast; canon in the same section as the focus
  rule above. The store drops the id: keeping it would let an undo that
  restores the row reopen it, per
  [lessons-learned → No "harmless" id leaks](../../../lessons-learned/no-harmless-id-leaks.md).
- **The portrait is the body's, not the head's** (developer,
  2026-10-08): an entity peek's portrait is the Overview's own
  `peek`-variant slot, so Scope: in dropped the head's thumbnail; see
  [`reader-composer.md → Peek drawer — lead affordance for characters`](../../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
  and
  [`entity.md → Why portrait lives only on Overview`](../../../../ui/patterns/entity.md#why-portrait-lives-only-on-overview).
- **The phone `←` returns to the list where it was left** (developer,
  2026-10-09, option c): a gap the plan missed, since `←` reset the
  list to the top. `RailSheet` keeps the list level mounted, hidden,
  under the peek, and `renderPeek` (C10) is unchanged for its callers;
  canon in
  [`reader-composer.md → Mobile expression`](../../../../ui/screens/reader-composer/reader-composer.md#mobile-expression).

Implementer choices worth keeping:

- **The peek's `Set as lead` shows no toast on success**, unlike
  World's `⋯ → Set as lead`: the reader's re-anchor is the feedback
  canon names. A refusal toasts its reason; a throw, or a press
  before the reader has its story id, logs
  `reader.peek_set_lead_failed` (see
  [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory))
  and toasts the generic failure. It gates on the reader's own
  generation gate, through native `disabled` (disabled controls aren't
  focusable, per
  [`color.md → Disabled`](../../../../ui/foundations/color.md#disabled)).
- **The phone head holds the 44 px touch floor** on its name group, so
  it keeps one height across lead states
  ([`touch.md`](../../../../ui/foundations/mobile/touch.md#touch-target-floor-on-phone));
  `Set as lead` and the foot link carry web focus rings.
- **The slice's component tests are Storybook plays**, the Component
  layer of
  [`testing.md → Test taxonomy`](../../../../testing.md#test-taxonomy);
  vitest covers the peek model, the body selection with its
  component-identity check, `useSetLead` with `usePeekLeadControl`,
  `useRailPeek` with `useOpenRailPeek`, and `usePeekView`.
- **The drawer reads its view above the right Sheet's Portal** and
  hands it to `PeekContent` as props, since rn-primitives' native
  Portal drops custom contexts
  ([lessons-learned](../../../lessons-learned/rn-primitives-portal-context.md)).
- **One lead badge and one injection chip**: `LeadTag` and
  `InjectionModeChip` are extracted, so the rail row, World's Overview
  and the peek render the same components.
- **The hidden list keeps its height cap through `←`**, dropped only on
  reopen and suspended while the window height differs (it reapplies
  when the height returns): releasing it relayouts the list while the
  Sheet settles, and gorhom's scroll lock then resets an end-of-list
  offset to 0 on Android.
- **The rail Sheet pins `keyboardBehavior="interactive"`** for both
  detents: the size-derived value flipped on the peek's morph and the
  peek body stopped scrolling on Android; see
  [lessons-learned](../../../lessons-learned/keyboard-resize-mode-must-be-claimed.md#a-keyboardbehavior-that-changes-while-open-kills-the-content-scroll).
- **Rail rows no longer route out** on any tier; the C6 link lives on
  the peek's foot and its Overview regions. `RailSheet` keeps its
  `onRowPress` mode, which only its bare stories use.
- **Review findings outside the slice** (web focus on disabled
  controls, focus-ring drift, trigger-less overlay focus return, Plot
  row semantics, the phone deep-link reveal, a toast under a modal
  Sheet) are in [`triage.md`](../../../triage.md).
- **4.5b debt left unrefactored:** the foot's 44 px touch class repeats
  two others; see [`triage.md`](../../../triage.md#inbox), "The 44 px
  touch class is written out three times".

Peek quick-edits stay parked; the entry now names six docs in conflict,
`entity.md`, `layout.md` and `overlays.md` added in 4.5b; see
[`parked.md → Peek quick-edits`](../../../../parked.md#peek-quick-edits).
