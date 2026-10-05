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

- **The fallback classifier can re-apply stackable transfers the
  narrative fold already wrote.** The fold applies whatever the tagged
  block parsed even when another field failed
  (`lib/pipeline/definitions/per-turn.ts`), and any parse failure fires
  the fallback, whose schema asks for transfers again. Item moves and
  visual changes overwrite, so a repeat is harmless; stackable amounts
  add, so a transfer both layers report lands twice. Read, not
  reproduced (2026-10-04, raised by the post-4.2b triage pass).
- **The composer's Send-blocked tooltip copy isn't principle-owned.**
  While suggestions refresh, Send's reason reads
  `reader:actions.blockedWhileGenerating` ("Unavailable while
  generating."), but disabled-control tooltip copy is principle-owned
  ([`principles.md → Affordance loci`](../ui/principles.md#affordance-loci))
  and its table has rows for per-turn and chapter-close only. Add a
  suggestion-refresh row and cite it, or reuse the per-turn copy
  (2026-10-04, raised by the post-4.2b triage pass).
- **`createTranslation`'s live-target check holds no key lock between
  its read and its commit.** The link writers take their family's per-branch
  key, which an entity or happening delete also holds, so a concurrent
  delete of an end serialises with the write (canon:
  [`generation-pipeline.md`](../generation-pipeline.md#atomicity-per-action),
  [`cadence.md`](../memory/cadence.md#concurrency));
  `missingRef` in `lib/actions/translations/register.ts` reads the
  target and the write commits later, so a concurrent `deleteEntity`
  could land between them. Latent: nothing writes translations. A fix
  needs a key per target table, and lore, thread and chapter deletes
  take no key today (`lib/actions/happenings/register-happenings.ts`
  already notes translations aren't locked). Raised by the Task 1
  review of the reversal-integrity PR (2026-10-05).
- **Deleting a relationship pair directly leaves its translations
  dangling.** `deleteHandler` and the upsert-to-null delete branch in
  `lib/actions/relationships/register.ts` delete the pair without
  cascading its `character_relationship` translations; only the entity
  cascade cleans them up. Latent: nothing writes translations. Raised
  by the Task 1 review of the reversal-integrity PR (2026-10-05).
  Reversing a relationship's create can strand them too: the
  closure's `userKeptCreates` in `lib/actions/delta/row-closure.ts`
  drops the planner's "still non-null" half (a plan decision), so a
  create whose user-written view was later cleared counts as kept and
  the closure leaves the row and its referrers unremoved, while the
  planner deletes the row (`lib/actions/delta/reverse-replay.ts`, the
  create arm's `rowKeepingColumns` branch). Revisit both when
  translations get a writer. Raised by the Task 3 review of the same
  PR (2026-10-05).
- **A parallel group's straggler can commit around a no-gate run's
  abort.** `runParallelGroup` in `lib/pipeline/runtime/orchestrator.ts`
  uses `Promise.all`, which rejects on the first throwing branch
  without waiting for siblings. A straggler that first emits before
  the run leaves txState (during the reversal or the exception hook)
  passes the registered-run check in `handleEvent` and commits under
  the run's actionId unreversed, and boot recovery never reverses it.
  If the reversal throws something that isn't a `DeltaReplayError`,
  `abortRun` rethrows before `generationStore.abortRun`, the run stays
  registered forever, and a later straggler passes the check and takes
  a hold nobody releases (this needs both latent conditions at once).
  Latent: no definition under `lib/pipeline/definitions/` uses a
  parallel group. The obvious fix, having `runParallelGroup` wait for
  every sibling to settle before the run aborts, changes canon's run
  state, "no drain: a parallel sibling still running is not awaited"
  (`generation-pipeline.md`, run state transitions), so it needs a
  canon edit first. Raised by the Task 9 review of the
  reversal-integrity PR (2026-10-05).

- **`abortCauseOf` may misread an embed timeout as a cancel on
  Android.** `lib/abort.ts` (`abortCauseOf`, `BOUNDED_SIGNAL_EXPIRED`)
  tells an expiry from a stop by `signal.reason`, but React Native's
  `setUpXHR.js` replaces the global `AbortController` with
  `abort-controller@3.0.0`, whose `abort()` drops its argument. On
  Android `lib/embedder/local/runtime.native.ts` (the abort checks near
  lines 201 and 214) would then report a timeout as a cancel, the
  misreading `lib/embedder/local/cancel.ts` warns about. Not verified
  on a device. Raised by the Task 9 review of the reversal-integrity
  PR (2026-10-05).

- **The reversal closure doesn't follow id references inside
  `entities.state`.** `REF_COLUMNS` in `lib/actions/delta/live-refs.ts`
  registers only link-table columns, so `selectReversalSet` in
  `lib/actions/delta/row-closure.ts` never reaches the ids
  [`data-model.md`](../data-model.md#branch-model) says `state` holds
  (`current_location_id`, `faction_id`, `parent_location_id` and
  `at_location_id` in `lib/db/entities/entity-state-schema.ts`). A
  reversal removing an entity could leave another entity's `state`
  naming it if a user write outside the set put the reference there.
  Unverified whether reachable: the argument canon gives for its
  write-back refusal, that an entity's create is never reversed while
  a delete holds it
  ([`generation-pipeline.md`](../generation-pipeline.md#reverse-replay)),
  may extend to this. Separately, `data-model.md` lists `equipped_by`
  as a `state` reference, but the schema has no such field: doc/schema
  drift to resolve. Raised by the Task 5 review of the
  reversal-integrity PR (2026-10-05).

- **The rollback preview selects its set outside the bracket and any
  lock.** `getRollbackCounts` runs `selectReversalSet` unguarded;
  `closeOver` (`lib/actions/delta/row-closure.ts`) reads live
  referrers in one round and their creates in the next, so a
  periodic-classifier abort between the two reads could make the
  preview throw `no-create`. The user would see a transient "Couldn't
  roll back" plus an error-level `action_layer.reversal_refused`
  that misreports a race as an integrity fault; a second tap clears
  it. Possible fix: take the branch write lock shared around the
  preview's selection. Reasoned, not reproduced. Raised by the Task 6
  review of the reversal-integrity PR (2026-10-05).

- **The reader's rollback and edit handlers have no try/catch.**
  `confirmRollback` and `handleCommitEdit` in
  `app/reader-composer/[branchId].tsx` await `rollbackToEntry` and
  `updateStoryEntryContent` bare, so a non-integrity `DeltaReplayError`
  (a store-sync failure after the commit, say) escapes as an unhandled
  rejection. The preview handler above them already catches and logs.
  Raised by the Task 6 review of the reversal-integrity PR
  (2026-10-05).

- **Rollback and edit rejection copy always says "Please try again."**
  `reader:rollbackFailed` and `reader:editFailed`
  (`locales/en/reader.json`) cover every rejection code, including the
  persistent ones (`delta-failed` from an integrity refusal, `notFound`,
  `rollbackFloor`), which a retry cannot clear. Regenerate avoids the
  loop only for its dispatch result, through `REGENERATE_REJECTION_COPY`
  in `app/reader-composer/[branchId].tsx`; its preview rejection in
  `handleRequestRegenerate` still toasts `reader:regenerateFailed`
  ("…Please try again."). Raised by the Task 6 review of the
  reversal-integrity PR (2026-10-05).

- **Every seeded hero rollback reverses chapter 1's create.**
  `delta_hero_3` in `lib/db/devtools/seed-dataset.ts` (the
  `chap_hero_1` create) has a null `entryId` and is logged after every
  entry create, so it falls inside every hero rollback window; a probe
  showed `chapters: 1` even for a rollback to position 70. Raised by the
  Task 6 review of the reversal-integrity PR (2026-10-05).

- **`resolveRedoInvalidation`'s sweep looks always empty.** The
  docblock in `lib/actions/story-entries/undo.ts` calls the case
  reachable "through a retry timer firing between the undo and the
  redo", but `applyDeltaAction` clears the redo stack after every
  delta-logged write whatever its source, so a pass that wrote anything
  leaves nothing to redo. Fix the comment, or drop the sweep from redo
  if nothing else reaches it. Confirmed by reading, not reproduced.
  Raised by the Task 7 review of the reversal-integrity PR (2026-10-05).

- **No test sends an uncommitted `DeltaReplayError` through
  `undoLastAction`.** The `e.committed` check before the redo push in
  `undoBracketed` is pinned only for the committed case; an uncommitted
  one must leave the redo stack alone. Raised by the Task 7 review of
  the reversal-integrity PR (2026-10-05).

- **Redo re-inserts newest-first, so a link lands before its parent.**
  `applyRedoLocked` in `lib/actions/delta/redo.ts` walks the snapshots
  newest-first and a link's create precedes its parent entity's. It is
  safe only because link ends (`entity_id`, `character_id`, and the like)
  carry no foreign key; adding one breaks redo of a closed group. Record
  the constraint where link tables are declared. Raised by the Task 7
  review of the reversal-integrity PR (2026-10-05).

- **A kept (re-owned) create in `redoRows` fails redo with a raw SQLite
  error.** It is unreachable today only because no non-periodic machine
  source creates relationships and CTRL-Z skips periodic groups. If one
  is reached, redo's plain INSERT hits a primary-key error rather than a
  refusal and the redo stays pending. Add a guard or refusal before any
  non-periodic machine source creates relationships. Raised by the Task
  7 review of the reversal-integrity PR (2026-10-05).
