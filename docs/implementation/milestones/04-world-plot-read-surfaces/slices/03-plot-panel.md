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
- **Chapterless fallback:** while the branch has no open chapter —
  every real M4 story — the happenings All view renders one implicit
  narrative bucket plus Out of narrative, and the `This chapter` chip
  is hidden; the chapter-keyed shape engages when an open chapter
  exists (seed fixtures now, M5 later).
- **C2 modules — threads and happenings:** `ListModule` instances
  with queries, grouping keys, chip vocabularies, search-scope copy,
  empty and no-results copy, `ThreadRow` / `HappeningRow` renderers
  over `ListRow` (C1 signals as props, density prop).
- **Thread pane** on the C7 host: Overview (status, category, icon
  from the preset catalog, description, `injection_mode` with
  explanation, `triggered_at_entry_id` and `resolved_at_entry_id`
  read-only — the latter only when resolved / failed, tags); History
  as a placeholder until C4 merges, then the shared `HistoryTab`.
  Tabs: strip on desktop and tablet, Select segment on phone.
- **Happening pane:** Overview (title, description, category, icon,
  `common_knowledge` toggle with its `⊙`, the mutually exclusive time
  anchor — entry-ref picker **or** `temporal`, refined at the form
  boundary, tags); **Involvements** (rows with the C8 entity picker,
  kind-aware over all four kinds, free-form `role`; add / remove
  through the M1.5 arms); **Awareness** (rows with a character-only
  picker, `learned_at` entry-ref picker, `decay_resistance` `0..1`,
  free-form `source`; add / remove; the UNIQUE upsert through the M1.5
  arm; the common-knowledge notice replacing the body when the toggle
  is on); History as above. Link rows route to World via C6, inert
  with a "lands in Slice 4.1" reason until that route exists. Tabs:
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

- Over fixtures with one open and one closed chapter, happenings group
  into Current chapter (the open chapter's entry range), Earlier
  chapters, and Out of narrative (`temporal` set); `This chapter`
  flattens to the first group; `Out-of-narrative` to the third; with
  no open chapter the view collapses to the implicit narrative bucket
  plus Out of narrative and the `This chapter` chip is absent (vitest
  on the query and grouping; component test on the chip).
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
  present, disabled or placeholder, each with its deferral reason
  (component test).
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

## Open questions

- **Entry-ref picker UX** — canonical open question. Default
  assumption: `SearchableOverlayList` over the branch's entries,
  newest first, row = `entry #n · kind · first ~80 chars`, search over
  content; amend `plot.md` with the choice, and reconcile its
  open-question wording (four picker fields) with `Threads side` (two
  thread refs read-only) in the same PR.
- **`decay_resistance` control** — canonical open question. Default
  assumption: numeric `0..1` input with three preset chips (low /
  medium / high → 0.2 / 0.5 / 0.8) above it; amend `plot.md`.
- **Plot `⋯` Delete and Export entries** — canon silent; default
  mirrors World minus `Set as lead` (milestone open question).
- **Chapterless fallback** — confirm the single-bucket shape at
  planning and note it in `plot.md` beside the chapter-bucket rule.
- **Sizing.** If planning runs long, split at the segment boundary:
  4.3a shell and threads (with the entry-ref picker), 4.3b happenings.
- **Thread `icon` catalog.** The "string key from a preset catalog"
  has no shipped catalog; pick the smallest honest set (a few Lucide
  names) and let visual identity revise.
- **`ModuleList` / `useRevealScroll` reuse.** Both (`components/world/`)
  are reusable as-is for Threads and Happenings; the reveal planning
  inside World's `revealRow` (is the row visible, which group to
  expand, whether to widen) is entity/World-typed — lift it into a
  generic helper next to `ModuleList` if Plot needs deep-link reveal.
  API edges to settle then: `flagged` is required (Plot would pass an
  empty set), `ModuleList` hard-codes `'all'` as the unfiltered value,
  and the `⚠ N` collision badge lives inside the generic list.
- **Filter-set shrinkage.** A kind's `filters(signals)` set can shrink
  (e.g. `This chapter` hidden when no chapter is open) — the surface
  must reset a selected filter that is no longer offered; return
  stable module-level arrays.
- **World sub-header height.** `MasterDetailLayout`'s sub-header
  wrapper pads on top of Breadcrumb's own box, so World's sub-header
  renders taller than its top bar (~52 / 60 px desktop, ~65 px phone)
  — Plot inherits the same shell. Decide whether to shrink the
  wrapper's padding here or leave it.
- **Thread status pills in the Plot wireframe.** `plot.html` colours
  them Active green, Pending neutral, Resolved grey and Failed amber;
  [`chips.md → Tag — tone vocabulary`](../../../../ui/patterns/chips.md#tag--tone-vocabulary)
  assigns Active `default`, Pending `warning`, Resolved `success` and
  Failed `danger`. Settle which one moves when the panel is built.
  Filed by the 2026-09-13 triage pass.
- **`ListModule`'s entity-typed home.** The C2 type lives in
  `components/entity/list-module.ts`; its `Signals` parameter defaults
  to `EntityListSignals`, and `RowSignals` ties `collision` to
  `CollisionListRowProps`, so Plot's modules would import from the
  entity folder and inherit entity assumptions. Decide when Plot
  lands: move the type to a neutral home, and drop the entity default.
- **Collapsed-tier state is keyed by tier only, not per kind.**
  (2026-09-12) `lib/stores/ui/world-list.ts` keys collapse on
  `EntityTier` alone, so collapsing Staged on Characters also
  collapses it on Locations. Canon doesn't say whether collapse should
  be per kind. Needs a design call. There is a third option beside
  per-kind and global: reset to the defaults on a category switch,
  which World's `selectCategory` already does for filter and search.
  The store is typed to `EntityTier`, so Plot's thread tiers and
  chapter buckets need their own or a generic collapse store — decide
  once for both panels.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
