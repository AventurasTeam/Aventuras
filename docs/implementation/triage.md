# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **What a user edit should do to an item's other position.** World's
  Carrying and Connections editors (Slice 4.2a) write only the row being
  edited, so linking an item that lies `at` a location into a character's
  Carrying, or into a second character's, leaves the item in two places;
  the panes show both facts rather than fixing either. Canon specifies
  transfers only for classifier writes, and
  [`data-model.md → ItemState`](../data-model.md#itemstate-shape) has no
  user-edit rule. Revisit trigger: users hitting double-positioned items,
  or the prompt context rendering one item as both loose and held.

- **Classifier parent-cycle refusals aren't a recoverable error yet.**
  [`data-model.md → LocationState`](../data-model.md#locationstate-shape)
  says a refused classifier write surfaces as a phase-level
  `recoverable_error`, but `orchestrator.ts` treats every non-noop
  rejection as `ActionRejectedError`, failing the run instead.
  Unreachable today — the classifier writes no location parents.
  Revisit trigger: the classifier gains parent writes.

- **Stackable writer hygiene.** The piggyback path stores stackable
  keys verbatim (mixed case, blank) and accepts non-integer/negative
  counts; the state-patch handlers never validate the merged state.
  The World draft stays strict, so a legacy row refuses Save with an
  issue (duplicate key) the user must resolve. Revisit trigger: users
  hitting duplicate-key issues on untouched quantities.

- **Retired/staged characters in derived lists.** World's Overview
  ("Characters here", Members) and Connections list retired and staged
  characters unfiltered, while
  [`data-model.md → Character-to-character relationships`](../data-model.md#character-to-character-relationships)
  says the UI dims or badges retired participants. Revisit trigger: a
  dead character counted as present.

- **Involvement row names.** World's Involvements rows are named by
  the happening title only; titles can repeat, and the role (the
  distinguishing part) sits in the description. A `ListRow` label
  override would fix it. Revisit trigger: two involvements in
  happenings with the same title.

- **C5 lead mutator follow-ups for M7.2.** "Current branch" is
  `stories.currentBranchId` (written only at create) while World shows
  the route's `[branchId]`; `rehydrateStories` is unchecked (Story
  Settings reads the stories-store row); and the whole-blob
  `definition` write should become `json_set` once M7 adds a
  concurrent definition writer. Revisit trigger: M7.2 planning.

- **i18n composition in World copy.** `overview.lastSeen` and
  `connections.ago` splice a pluralised span into "… ago" (breaks case
  in e.g. German), and `overview.within` is a joiner fragment. Per-tier
  whole-sentence keys fix it. Revisit trigger: the first non-English
  locale.
