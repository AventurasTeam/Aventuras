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

- **World and Plot's pill Cancel misses a sibling branch's run.** The
  pill's foreground kind is story-keyed
  (`selectStorySettingsGenerationRunKind`, `generation-run.ts:25`), but
  `onCancel` passes the route's branch to `awaitRunTerminal`
  (`app/world/[branchId].tsx:448`, `app/plot/[branchId].tsx:372`),
  which matches kind and branch. A foreground run on a sibling branch
  shows in the pill, and its Cancel does nothing. Not reachable through
  shipped navigation until M6 branch switching; in dev a
  `/world/<other branch>` link reaches it, since `useColdOpenStory`
  opens the branch without checking for a run. Revisit trigger: M6
  planning.

- **Whether `updating-memory` blocks branch switching.**
  [`branch-navigator.md → During generation`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked)
  pauses switch, delete and create while the pill is active ("any
  pipeline phase", line 116) and sends the user to wait or cancel from
  `Send → Cancel` (lines 120-123). Its phase list doesn't name the
  periodic classifier's `updating-memory`, which the pill now shows and
  which can't be cancelled, so the rule either parks switching behind
  an uncancellable pass or doesn't cover it. Not reachable until M6
  ships switching. Revisit trigger: M6 planning.

- **Reconciliation matches against the pass's snapshot.** Namesakes
  come from the entity snapshot the pass read before its model call
  (`reconcile.ts:54-57`, read at `periodic-classifier.ts:146`), so a
  character the user creates in World mid-pass is invisible to it. If
  the pass's prose introduces the same name, it creates a second row
  with `nameCollisionFlag` 0 (`buildClassifierActions`'s create path),
  and World's collision
  review lists flagged rows only (`collisions.ts:27`), so nobody is
  asked about the duplicate. Reachable today: World create is gated
  only by `hard-gate` runs.

- **A reversal can still drop a later user edit.** Reversing a machine
  write skips each column a later `user_edit` outside the reversed set
  wrote
  ([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)),
  with two gaps left. Reversing a classifier `create` deletes the row,
  and a user edit made to it since goes with it, its delta left
  pointing at nothing. A prose edit reverses a happening's create
  (`isReversible` in `story-entries/classifier-facts.ts` spares only
  entities'), and a failed pass's `abortRun` or boot recovery reverses
  both kinds. Reachable today: edit in Plot a happening the head
  turn's pass created, then edit that turn's prose. And a schema-backed
  column (`entities.state`, `story_entries.metadata`) still restores
  the sub-fields its delta changed over a later user write to the same
  sub-field. That one is latent: only hard-gated runs write either
  column, so no user edit lands while such a run can abort, and a
  rollback or regenerate that reverses their deltas later sweeps the
  user's edits after them too.

- **A recurring classifier failure reaches `failed-persistent`
  invisibly.** The backoff
  ([`classifier.md → Auto-retry policy`](../memory/classifier.md#auto-retry-policy))
  exhausts in about 7.5 minutes (30s + 2m + 5m) against a repeating
  apply-time rejection, and `failed-persistent` survives a restart —
  boot recovery (`resetStuckClassifierRunState`) resets only
  `'running'`. Nothing in `app/`, `components/` or `hooks/` reads
  classifier status or calls `runNow` (`scheduler.ts:85`) today, so a
  branch can stop updating memory with no visible signal until M7.2
  builds Settings → Memory's `[Retry]` / `[Run classifier now]`
  ([`story-settings.md → Classifier`](../ui/screens/story-settings/story-settings.md#classifier)).
  Revisit trigger: M7.2 planning.

- **A blank happening title or new-character name still reaches a
  row.** `classifierExtractionSchema` gives both `happening.title` and
  `newCharacters[].name` a bare `z.string()` (`schema.ts:20`, `:58`),
  and neither `happeningWriteObject` nor `entityWriteSchema` adds the
  `.min(1)` that `characterRelationshipWriteSchema` gives `kind`, so
  the write layer accepts an empty string. `plan.ts` routes neither
  field through `nonBlank`, only through `clampEmbedded` (a length
  cap, not a blank check), contradicting the "a blank never reaches a
  row" comment at `plan.ts:40` — true only for the fields the planner
  does route through `nonBlank`. Revisit trigger: a happening or
  character surfacing with an empty name/title in World or Plot.

- **The classifier prompt has no token budget beyond
  `classifierWindowMaxEntries`.** That knob bounds only the turns
  block; the entity, happening and relationship lists grow unbounded
  with the branch, and `generateStructured` (`lib/ai/generate.ts`)
  passes the rendered prompt straight to the provider with no length
  guard. Revisit trigger: the first long-story prompt-size or cost
  signal.
