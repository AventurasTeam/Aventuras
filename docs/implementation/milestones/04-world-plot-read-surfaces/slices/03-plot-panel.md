# Slice 4.3 — Plot panel: threads + happenings

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** none for the build (day-one; the M1.5 thread and
  happening layers with the M3.3 happening cascade, the shipped
  shells, and seed rows are merged prerequisites). Two partial gates:
  from [Slice 4.1](./01-world-shell.md) the C1 row signals and the C6
  World deep link its link rows route to; from
  [Slice 4.2b](./02b-lore-history-delete.md) the C4 History module and
  the C3-hardened delete arms — History ships as a placeholder and
  `Delete …` ships disabled until then. Doc-as-contract pair with
  [Slice 4.2a](./02a-entity-detail.md) over C7 (save-session host), C8
  (pickers) and C11 (overflow menu), and with 4.1 over C6.
- **Blocks:** [Slice 4.5a](./05a-browse-rail.md) (thread and
  happening list modules — C2), [Slice 4.6](./06-import-export.md)
  (import and export hosts — partial)

## Goal

The Plot route on the shared shells: the Threads / Happenings segment
toggle driving both panes, status-tier and chapter-bucket grouping
with a chapterless fallback, the thread and happening detail panes
with the Involvements and Awareness editors, common-knowledge
interaction, manual creation, raw JSON, and the entry-ref picker (C8
half, this slice owns it) beside the kind-aware entity picker consumed
from 4.2a's shape. Threads data may be sparse until M5's chapter close
populates it; the surface ships now.

## Background

Plot is the monitor / audit half of the World / Plot split:
predominantly classifier-written rows the user reviews, occasionally
authors. Same shell decomposition as World, different kind selector
(a two-cell segment), row shapes, tab compositions and filter rules.
Happenings anchor to narrative time through `occurred_at_entry_id`
or to free-text `temporal`, never both — the CHECK constraint is the
floor and the Zod refine is the friendly surface. Awareness rows are
character memory; a `common_knowledge` happening skips them and the
tab says so. Every entry reference stores a branch-scoped entry id,
so the picker returns ids and the host derives `entry #n` at render.
Nothing opens a chapter before M5, so the chapter-keyed grouping is
real only against seed fixtures in this milestone.

## Required reading

- [`plot.md`](../../../../ui/screens/plot/plot.md) in full — in
  particular
  [`Layout`](../../../../ui/screens/plot/plot.md#layout),
  [`Implementation reuse`](../../../../ui/screens/plot/plot.md#implementation-reuse),
  [`Threads side`](../../../../ui/screens/plot/plot.md#threads-side),
  [`Happenings side`](../../../../ui/screens/plot/plot.md#happenings-side),
  [`Row indicators`](../../../../ui/screens/plot/plot.md#row-indicators),
  [`Manual creation + per-row import`](../../../../ui/screens/plot/plot.md#manual-creation--per-row-import),
  [`Detail pane — raw JSON viewer`](../../../../ui/screens/plot/plot.md#detail-pane--raw-json-viewer),
  [`Save session`](../../../../ui/screens/plot/plot.md#save-session),
  [`Top-bar`](../../../../ui/screens/plot/plot.md#top-bar),
  [`Mobile expression`](../../../../ui/screens/plot/plot.md#mobile-expression)
  and [`Screen-specific open questions`](../../../../ui/screens/plot/plot.md#screen-specific-open-questions).
- [`patterns/entity.md → Accordion grouping on "All" view`](../../../../ui/patterns/entity.md#accordion-grouping-on-all-view)
  and [`Recently-classified row accent`](../../../../ui/patterns/entity.md#recently-classified-row-accent).
- [`patterns/save-sessions.md`](../../../../ui/patterns/save-sessions.md)
  in full, and [`patterns/lists.md → Empty list / table state`](../../../../ui/patterns/lists.md#empty-list--table-state).
- [`patterns/forms.md → Select primitive`](../../../../ui/patterns/forms.md#select-primitive)
  and [`patterns/searchable-overlay-list.md`](../../../../ui/patterns/searchable-overlay-list.md)
  in full — the substrate the entry-ref picker most plausibly composes.
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  — the two-layer model, time-field exclusivity, entry refs as ids,
  awareness UNIQUE upsert, `decay_resistance`, `source`.
- [`data-model.md → Injection modes`](../../../../data-model.md#injection-modes--unified-enum--structural-invariant)
  — `injection_mode` on threads; why happenings carry none.
- [`memory/retrieval.md → Pinning — decay_resistance`](../../../../memory/retrieval.md#pinning--decay_resistance)
  — what the Awareness tab's numeric field means to the ranker.
- [`data-model.md → Chapters / memory system`](../../../../data-model.md#chapters--memory-system)
  — the open chapter the `This chapter` filter and `Current chapter`
  bucket key on.
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation),
  [`Universal in-story chrome`](../../../../ui/principles.md#universal-in-story-chrome)
  and [`Actions menu (contextual zone)`](../../../../ui/patterns/actions-menu.md#contextual-zone).
- [`collapse.md → Two-pane navigation surfaces`](../../../../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
- [Milestone contracts C1, C2, C3, C4, C6, C7, C8, C11](../milestone.md#slice-contracts).

## Scope: in

- **Route and chrome:** the Plot route from in-story chrome and the
  Actions menu's `GO TO` group (4.1 owns the group; Plot's entry is in
  it); `<title> / Plot` breadcrumb; the sub-header
  `[Threads|Happenings] / <name>`; contextual entries `Add thread…` /
  `Add happening…`; deep-link selection params mirroring 4.1's shape
  (C6 — whichever lands first fixes the names).
- **List pane:** the two-cell segment toggle (Select segment mode at
  every tier) with a `[+]` tooltip tracking the active side, in the
  trigger slot 4.1 adds to `EntityListPane`; **threads** — rows
  (glyph, title, status pill, category), status chips, status-tier
  sort and accordion (Active expanded), search; **happenings** — rows
  (glyph, title, when-marker as entry chip or `temporal`, category,
  `⊙` slot kept when unset), chips (`All` / `This chapter` /
  `Common knowledge` / `Out-of-narrative`), chronological sort with
  `temporal` rows pinned last, chapter-bucket accordion (Current
  expanded; Earlier flat; Out of narrative), search; per-side empty
  states with the classifier explainer.
- **Chapter rule:** Current chapter is the open region (anchor entry
  `chapter_id IS NULL`), Earlier chapters are closed-chapter anchors,
  Out of narrative is `temporal` or no anchor at all; empty buckets
  are omitted and `This chapter` is offered only once a chapter has
  closed — every real M4 story therefore shows Current chapter plus
  Out of narrative.
- **C2 modules — threads and happenings:** `ListModule` instances
  with queries, grouping keys, chip vocabularies, search-scope copy,
  empty and no-results copy, `ThreadRow` / `HappeningRow` renderers
  over `ListRow` (C1 signals as props, density prop).
- **Thread pane** on the C7 host: Overview (status, category, icon
  from the preset catalog, description, `injection_mode` with
  explanation, `triggered_at_entry_id` and `resolved_at_entry_id`
  read-only — the latter only when resolved / failed); History
  as a placeholder until C4 merges, then the shared `HistoryTab`.
  Tabs: strip on desktop and tablet, Select segment on phone.
- **Happening pane:** Overview (title, description, category, icon,
  `common_knowledge` toggle with its `⊙`, the mutually exclusive time
  anchor — entry-ref picker **or** `temporal`, refined at the form
  boundary); **Involvements** (rows with the C8 entity picker,
  kind-aware over all four kinds, free-form `role`; add / remove
  through the M1.5 arms); **Awareness** (rows with a character-only
  picker, `learned_at` entry-ref picker, `decay_resistance` `0..1`,
  free-form `source`; add / remove; the UNIQUE upsert through the M1.5
  arm; the common-knowledge notice replacing the body when the toggle
  is on); History as above. Link rows route to World via C6. Tabs:
  strip on desktop, Select dropdown on tablet and phone.
- **Entry-ref picker (C8 half):** the controlled primitive returning
  an entry id, rendering `entry #n` plus an excerpt, Popover / Sheet
  per tier, with a dangling-ref state when the id no longer resolves;
  two consuming fields wired (`occurred_at_entry_id`,
  `learned_at_entry_id`).
- **Manual creation:** `[+] Blank` for each side opens the pane in
  create mode; `From JSON file…` present-disabled until 4.6;
  `From Vault…` disabled.
- **C11 menu:** `View raw JSON` (happening merged with involvements
  and awareness summary; thread row alone); `Export … as JSON`
  disabled until 4.6; `Delete …` disabled until 4.2b (default
  assumption that Plot carries delete and export at all — see the
  milestone open question).
- **Row indicators mirrored in the detail head:** recently-classified
  badge, `⊙` beside the toggle, status on Overview.
- **Phone collapse:** list-first, detail route, `useMasterDetailBack`,
  segment switch firing the C7 `requestLeave` when dirty.
- **i18n:** new `plot` namespace. **Storybook:** both sides' list
  states, both panes, the CK notice, the pickers, the chapterless
  fallback.

## Scope: out

- Chapter close, chapter-numbered sub-grouping inside `Earlier
chapters` (deferred by canon), and `retrieval_count` review — M5.
- The C1 selectors, the C4 module and the C3 arms themselves — 4.1
  and 4.2b.
- The kind-aware entity picker's authorship — 4.2a (this slice
  consumes; if it lands first, it creates the picker at the pinned
  shape).
- Import and export — [Slice 4.6](./06-import-export.md).
- Bulk operations (parked); the visual icon set for categories
  (visual identity — placeholder glyphs).

## Acceptance criteria

- Over fixtures with closed chapters and an open region (the seed),
  happenings group into Current chapter (the open region's entry
  range), Earlier chapters, and Out of narrative (`temporal` set, or
  no anchor); `This chapter` flattens to the first group;
  `Out-of-narrative` to the third; with no closed chapter the view
  shows Current chapter plus Out of narrative and the `This chapter`
  chip is absent (vitest on the query and grouping; component test on
  the chip).
- Setting both `occurred_at_entry_id` and `temporal` on a happening
  is refused at the form (inline error) and, if forced through the
  arm, by the CHECK constraint (vitest on the schema refine and DB).
- Adding an involvement writes one `happening_involvements` row with
  the picked entity and role; removing it deletes exactly that row;
  both under one `action_id` (vitest on the arm; component test on the
  editor).
- Adding an awareness row for a character who already has one for
  that happening updates rather than duplicates; toggling
  `common_knowledge` on replaces the tab body with the notice and
  hides the add affordance; toggling off shows the surviving rows
  (component test plus vitest on the arm).
- The entry-ref picker returns an id whose `position` renders as
  `entry #n` in the field; after a rollback that removes that entry
  the field shows the dangling-ref state rather than a bare id
  (component test).
- Creating a thread via `[+] Blank` with `status = pending` shows it
  under Pending with the right pill; saving edits on Overview writes
  one `updateThread` delta under one `action_id` and CTRL-Z reverses
  it (E2E).
- The History tab, `Delete …`, `Export …` and the World links render
  present, disabled or placeholder, each with its deferral reason; the
  World links navigate (4.1 merged; component test).
- On phone, switching the segment with a dirty pane raises the guard;
  the happening pane's four tabs render through the Select dropdown
  (manual on Android; Storybook viewport).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: C2 thread and happening queries and grouping (with and
  without an open chapter), time-anchor refine, involvement and
  awareness arm paths, entry-ref position derivation.
- Component tests: both panes, CK interaction, pickers, segment
  guard, disabled and placeholder states.
- Storybook: the matrix above.
- E2E (desktop): create thread, edit happening awareness, undo.

## Implementation notes

- **Chapter bucket rule.** No separate chapterless-fallback shape: the
  rule keys entirely on the anchor entry's `chapter_id`, so a story
  with no closed chapter simply shows Current chapter plus Out of
  narrative under the one rule (now in Scope: in). Two edge cases the
  rule text doesn't spell out: a **dangling** anchor (a live id whose
  entry no longer resolves) stays in Current chapter; a happening with
  **neither** an anchor nor `temporal` — the classifier writes these
  when a turn handle doesn't resolve — buckets as Out of narrative,
  per
  [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)'s
  null-anchor-means-outside-narrative rule.
- **Store hydration.** Story open now hydrates threads, happenings,
  involvements, awareness and chapters alongside entities and lore —
  previously none of the five was hydrated outside tests, so
  classifier patches to them were silent no-ops. One working set now
  serves Plot and [Slice 4.5a](./05a-browse-rail.md). Awareness volume
  is a v1 projection, not an M4 reality; revisit with a lazy path if
  story open measurably slows.
- **Generic collapse store.** `lib/stores/ui/world-list.ts` (keyed on
  entity tier alone, so collapsing Staged on Characters also collapsed
  it on Locations) is gone. `lib/stores/ui/list-collapse.ts` replaces
  it: session-scoped, keyed `(kind, groupKey)`; World migrated onto it
  in this slice's PR 1.
- **Neutral list home.** `components/list/` (`list-module.ts`,
  `module-list.tsx`, `use-reveal-scroll.ts`, `reveal-plan.ts`) replaces
  the World-only home the C2 modules used to live in; `Signals` lost
  its entity default and `flagged` is optional. `reveal-plan.ts` lifts
  World's reveal planning unchanged. Plot's own `revealRow` handle only
  reveals within the current kind (an early return when the target
  row's kind doesn't match the pane's active side) — a rail reveal
  spanning World and Plot categories in
  [Slice 4.5a](./05a-browse-rail.md) needs to switch kind itself before
  calling it.
- **C7 / C8 / C11 shipped from this slice's PR 1, not from 4.2a.** 4.2a
  was unmerged when planning started, so PR 1 authored
  `useRowSaveSession` (`hooks/use-row-save-session.ts`), `PickerField` /
  `EntityPicker` (`components/compounds/`) and `OverflowMenu`
  (`components/compounds/overflow-menu.tsx`) at the milestone's pinned
  shapes. [Slice 4.2a](./02a-entity-detail.md) now adopts these shipped
  shapes rather than authoring them — see
  [its Implementation notes](./02a-entity-detail.md#implementation-notes).
- **Entity picker built on `SearchableOverlayList`, not
  `Autocomplete`.** The milestone's C8 text names an Autocomplete, but
  `Autocomplete` resolves by string and the branch can hold two
  identically-named entities; the shipped `EntityPicker` is the same
  field-trigger `SearchableOverlayList` shape as the entry-ref picker
  and returns an id.
- **`SearchableOverlayList.initialScrollRowId` implemented and
  unparked** (previously specified but parked) — both the entity and
  entry-ref pickers need scroll-into-view on open; see
  [`searchable-overlay-list.md → Filter, keyboard, focus & lifecycle`](../../../../ui/patterns/searchable-overlay-list.md#filter-keyboard-focus--lifecycle).
- **Awareness `learnedAtEntryId` merges on update only for
  user-originated sources.** The classifier resends it on every
  re-emit of an existing awareness row, and the first-learned anchor is
  what decay is measured from — merging on a classifier write would
  silently move it. A user edit merges normally.
- **Links diffed by natural key.** Involvement and awareness rows are
  diffed by entity / character id, not by draft row id, so a
  remove-then-re-add or a swap between two rows becomes an update
  rather than two writes to one row (the action-group runner rejects
  that). A stale dirty links array on Save can still overwrite a
  concurrent link write to the same row — parked as
  [a dirty links array on Save](../../../../parked.md#a-dirty-links-array-on-save-overwrites-concurrent-link-writes),
  unreachable in M4 because every writer linking an existing happening
  hard-gates the pane.
- **Entry index cache-key invariant.** `useEntryIndex`
  (`hooks/use-entry-index.ts`) keys its refetch on
  `generationStore.settleCount` plus the branch's tail entry id — every
  `story_entries` write path must settle a run/reversal or move the
  tail, or the index goes stale (an anchor then only shows falsely live
  or dangling, never re-points to a different entry). No write path
  violates this today; a future chapter-create or a direct entry delete
  outside a run would need to.
- **Create-mode edits typed during the save are dropped.** The row
  save session's row key switches from `create:<kind>:<seq>` to the new id
  once the create write resolves, which resets the form — a keystroke
  landing in that window is lost. Milliseconds for a thread, longer for
  a happening's grouped link write. The same limit applies to any
  future pane built on `useRowSaveSession`'s create path.
- **Save bar rides above the phone keyboard.**
  [`touch.md → Save bar on phone`](../../../../ui/foundations/mobile/touch.md#save-bar-on-phone)'s
  hide-while-open rule was reversed in M4.4; the Plot route wraps its
  layout in `KeyboardInsetColumn` (the Story Settings precedent) rather
  than changing `SaveBar` itself.
- **`plot.md`'s `tags` mentions were drift.** `threads` and
  `happenings` have no `tags` column in the frozen schema; removed from
  `plot.md` and this doc's Scope.
- **Icon catalog.** `components/plot/plot-icon.tsx` is a fixed
  string-keyed catalog; a key it doesn't recognize (a future catalog
  addition, or hand-authored data) is preserved on save and falls back
  to a per-kind glyph for display (`Diamond` thread, `Zap` happening —
  not `CircleDot`, which is the common-knowledge `⊙`).
- **Remaining canonical and implementer open questions resolved exactly
  as this slice's planning defaulted**, and are now specified in
  `plot.md` or shipped as described: entry-ref picker UX
  (`SearchableOverlayList` field trigger), `decay_resistance` control
  (numeric field with low / medium / high preset chips), the Plot `⋯`
  menu (mirrors World minus `Set as lead`), thread status pill tones
  ([`chips.md → Tag — tone vocabulary`](../../../../ui/patterns/chips.md#tag--tone-vocabulary)),
  the sub-header height (dropped `MasterDetailLayout`'s extra padding),
  filter-set shrinkage (a selected filter that disappears resets to
  All), and sizing (two stacked PRs by module layer, the 4.1 / 4.4
  shape).
- **The detail head no longer carries a kind line.** The developer cut
  the `[icon] kind` strip above the name as redundant against the
  breadcrumbs, and
  [`world.md → Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure)
  was amended with it — it had listed that strip as the head's first
  element. `DetailPane` no longer accepts `kindIcon` / `kindName`, so
  **4.2a's real World panes must not reintroduce it**; both wireframes
  and the `kindName` locale keys went too.
- **The top-bar breadcrumb is screen-level on every tier**, on Plot
  and World alike. Phone used to append the kind
  (`Story / Plot / Happenings`) while the sub-header already led with
  it, duplicating the label; removed from both routes and both screen
  docs, per
  [`principles.md → Master-detail sub-header`](../../../../ui/principles.md#master-detail-sub-header).
  Desktop was already correct.
- **Tab counts are parenthesised** in both the strip and its Select
  form. An inactive tab's label is already `fg-muted`, so a bare
  trailing number had no contrast against it and read as part of the
  name; the Select's rows can't style it at all without losing the
  primitive's selected checkmark.
- **`AccordionContent` has no exit animation.** It existed for a
  collapsing group but never showed on native, while a kind swap tore
  down every `AccordionItem` at once and painted the outgoing rows over
  the incoming list for ~230 ms. See
  [lessons-learned](../../../lessons-learned/layoutanimationconfig-skipexiting-gap.md)
  — `LayoutAnimationConfig skipExiting` does not suppress it. The
  item's animated frame now clips its content, so an expanding group
  no longer paints over the one below.
- **Seed anchors avoid multiples of 12.** Those hero entries are
  `system`, which the entry index excludes by design, so five awareness
  rows and two `lastSeenAt` were rendering as "Entry no longer exists".
  `seed-dataset.test.ts` now fails on any entry ref landing on one.
