# Slice 5.13 — Re-running a close

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.10](./10-two-starts.md) (the whole close, its
  pre-flight with `toolCalling`, and the modal host on C7's store),
  [Slice 5.11](./11-review-window.md) (the review window,
  `chapterOverlaysStore`, `ChapterOverlaysHost`, the commit banner's done
  state on `closeResult`, `loadCloseDeltas`),
  [Slice 5.12](./12-chapter-delete-rollback.md) (`removeChapter` and its
  close-groups read, `getChapterDeletePreview` under
  `withBranchWriteShared`, the async `rollbackCountsOf`, the delete arms
  of the round-trip suite). Through them,
  [Slice 5.8](./08-prose-tasks.md) and
  [Slice 5.9](./09-chapter-wide-tasks.md), whose tasks a re-run runs again.
  And the undo-own-write substrate, built by a plan-mode followup (PR #746):
  one yield rule for every reversal, with no `yieldTo` mode, and the
  survivor rewrites the journal captures, which the reversal's plan lists
  as `survivorRewrites`
  ([`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  "An undo reverts only its own write";
  [C13](../milestone.md#c13--chapter-delete), "Later writes win").
- **Blocks:** none. M5's last slice.

## Goal

The user re-runs the latest chapter's lore work from its Timeline card or
its review window, and CTRL-Z while the re-run is the latest action,
Cancel, a failed call or a crash brings back the close it replaced. This
delivers the `reversal_journals` table, the journaled reversal and its
write-back on every path that reverses a re-run's group, the close
pipeline's re-run arms with a `reversal` phase, `pendingRerun`,
`startCloseRerun` with its rollback shortcut, the held head reversals, and
the confirm on the card and in the review window.

## Background

A re-run reverses what the chapter's close did to the world, as a delete
does, then runs the lore tasks again under one new group; the chapter row,
its stamps, title and summary stay. Undoing it can't replay that reversal,
so the reversal journals the before-image of everything it touches, and
whichever way the re-run's group later reverses (CTRL-Z, an abort, crash
recovery), the same transaction writes the journal back. That is exact
only while nothing else touched what the journal covers: a sweep from
below the re-run drops the journal, the write-back checks first, and
without it the re-run's reversal undoes the chapter's close altogether. A
re-run runs before the next turn, rolling later turns back first when the
user confirms. The design record, with the rejected logged reversal and
its adversarial pass, is
[the re-run exploration](../../../../explorations/2026-11-13-chapter-close-rerun.md);
canon wins where they differ.

## Required reading

- [`chapter-close.md → Re-running a close`](../../../../memory/chapter-close.md#re-running-a-close)
  in full, then
  [`Deleting a chapter`](../../../../memory/chapter-close.md#deleting-a-chapter),
  [`Review`](../../../../memory/chapter-close.md#review),
  [`Phase 0 — catch-up passes`](../../../../memory/chapter-close.md#phase-0--catch-up-passes),
  [`Run order`](../../../../memory/chapter-close.md#run-order) and
  [`Logs and anchors`](../../../../memory/chapter-close.md#logs-and-anchors).
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  from "An undo reverts only its own write" through the two "A close's
  re-run journals its reversal" paragraphs.
- [`generation-pipeline.md → Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate),
  [`chainsTo on predecessor`](../../../../generation-pipeline.md#chainsto-on-predecessor),
  [`Run state transitions`](../../../../generation-pipeline.md#run-state-transitions),
  [`Crash recovery via pipeline_runs marker table`](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  with its
  [`Startup recovery pass`](../../../../generation-pipeline.md#startup-recovery-pass),
  [`Recovery modal`](../../../../generation-pipeline.md#recovery-modal)
  and
  [`Recovery-failure policy`](../../../../generation-pipeline.md#recovery-failure-policy),
  [`Gate derivation as a selector`](../../../../generation-pipeline.md#gate-derivation-as-a-selector),
  which the held predicates extend,
  [`Pipeline fields`](../../../../generation-pipeline.md#pipeline-fields)
  (the `interruptible` prose),
  [`Prose reversals and the interrupt`](../../../../generation-pipeline.md#prose-reversals-and-the-interrupt)
  and
  [`Branch write lock`](../../../../generation-pipeline.md#branch-write-lock).
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  (the CTRL-Z algorithm and the redo paragraph), the `reversal_journals`
  entity in the [ER diagram](../../../../data-model.md#diagram),
  [`Branch model`](../../../../data-model.md#branch-model) (the
  branch-copy manifest's row),
  [`Story deletion`](../../../../data-model.md#story-deletion) and
  [`Backup & export format`](../../../../data-model.md#backup--export-format)
  (the export manifest's row).
- [`chapter-timeline.md → Re-run a close`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#re-run-a-close),
  [`Per-card actions`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#per-card-actions),
  [`Review window`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#review-window)
  and
  [`Mobile expression`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#mobile-expression),
  with the re-run confirm, the card's action row and the review footer in
  [`chapter-timeline.html`](../../../../ui/screens/chapter-timeline/chapter-timeline.html).
- [`reader-composer.md → Regenerate confirmation`](../../../../ui/screens/reader-composer/reader-composer.md#regenerate-confirmation)
  and
  [`During a memory update`](../../../../ui/screens/reader-composer/reader-composer.md#during-a-memory-update).
- [`rollback-confirm.md → Confirmation modal`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#confirmation-modal--post-click)
  (and the re-run bullet above it),
  [`Counts`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#counts)
  and
  [`Edge cases`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#edge-cases).
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation),
  its re-run paragraph and its tooltip table's re-run row, and
  [`Affordance loci`](../../../../ui/principles.md#affordance-loci).
- [`alert-dialog.md → Copy contract`](../../../../ui/patterns/alert-dialog.md#copy-contract),
  [`toast.md → Severity`](../../../../ui/patterns/toast.md#severity) (the
  re-run's notices; its Used-by list names them) and
  [`layout.md → Stacking`](../../../../ui/foundations/mobile/layout.md#stacking)
  (canon's confirm over the review window's Sheet, which the default under
  [Open questions](#open-questions) replaces).
- [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory),
  for the events this slice adds.
- [`testing.md → Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive),
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Mock LLM`](../../../../testing.md#mock-llm) and
  [`Selector strategy`](../../../../testing.md#selector-strategy).
- [`dev-environment.md → Measuring on a release build`](../../../../dev-environment.md#measuring-on-a-release-build),
  [5.2's Close measure](./02-first-chapter.md#close-measure) and
  [5.5a's Write-burst measure](./05a-task-runner.md#write-burst-measure),
  for the Android bar.
- Milestone contracts:
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C4](../milestone.md#c4--close_report-v1),
  [C5](../milestone.md#c5--token-reads-and-the-progress-hook) (the
  migration rule, `useChapterProgress`),
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts) (the
  `reversal` label),
  [C7](../milestone.md#c7--chapter-overlays),
  [C8](../milestone.md#c8--seed-stability) (the E2E's seeded chapters),
  [C9](../milestone.md#c9--the-round-trip-rule),
  [C10](../milestone.md#c10--what-a-chapter-may-end-on) (`close-owed` and
  the held reversals),
  [C11](../milestone.md#c11--tool-results),
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means),
  [C13](../milestone.md#c13--chapter-delete),
  [C14](../milestone.md#c14--the-manual-start-and-pendingclose) and
  [C16](../milestone.md#c16--flip-rule). This slice provides C4's
  `firstLogPosition?: number` and C7's `openRerunConfirm`, and consumes the
  rest; and the
  [Definition of done](../milestone.md#definition-of-done)'s Re-run line,
  whose "owe nothing" means the re-run itself: a catch-up pass of its chain
  that is cancelled still defers as a pass.
- Lessons:
  [staleness flags are cleared by the drain](../../../lessons-learned/staleness-flags-are-cleared-by-the-drain.md#how-to-apply),
  [Drizzle drops unknown keys](../../../lessons-learned/drizzle-drops-unknown-keys.md#how-to-apply),
  [no harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md#how-to-apply),
  [rn-primitives' Portal drops custom contexts](../../../lessons-learned/rn-primitives-portal-context.md#two-patterns-that-work),
  [a Portal owner stays mounted](../../../lessons-learned/portal-owner-mount-is-not-open.md#how-to-apply),
  [the seeded tip moves at the first Send](../../../lessons-learned/seed-tip-position-shifts-at-first-send.md#how-to-apply).

## Scope: in

Canon names the journal's contents and its write-back. This slice adds
the floor the journal records, and builds on a default for four things
canon leaves open or that its code can't meet, each marked here and listed
under [Open questions](#open-questions): how the review bounds a re-run's
group, what "the group is whole" means, the suggestion strip's ⟳ during a
re-run, and how `Re-run…` meets the surface guard from the review window.

**The journal table.**

- `reversalJournals` in `lib/db/system/system.table.ts`, beside `deltas`,
  per the ER: `action_id`, `branch_id` (FK to `branches`), `journal`
  (JSON), `created_at`, primary key `(branch_id, action_id)`. In `dbSchema`
  and exported from `lib/db`. Its migration follows C5's rule: generated on
  the rebased tree, never renamed.
- `BRANCH_SCOPED` in `lib/actions/stories/delete-story.ts` gains it; the
  schema-wide test there fails without it. No story export or branch fork
  code exists in `lib/` yet, so nothing else registers it. Canon's export
  and branch-copy manifests already list the table, and the fork's copy is
  M6.1's.
- The journal JSON holds the chapter's id and its number
  (`sequence_number`, for the fallback's toast once the row is gone), the
  **floor**, and the before-images: each row the plan writes, by table and id, whole or
  absent; each delta row it prunes or edits, whole, a survivor whose prior
  value it rewrites among them; each earlier journal row
  it drops, whole. Only the write-back reads the before-images; the
  planner's checks read the chapter id and floor without parsing them in
  JS.
- **The floor** is the highest `log_position` the reversal leaves on the
  branch. Under the gate the re-run's own writes start at floor plus one, and
  every check below measures from it.

**The journaled reversal** (`lib/actions/delta/rerun-journal.ts`).

- `ReversePlan` (`lib/actions/delta/reverse-replay.ts:89`) gains what the
  journal needs and doesn't expose today: the ids of the delta rows its
  `pruneOps` remove or re-own (the set's rows, `prunedHolders` and
  `strandedWrites`), the held-delete holders whose payload its `ops`
  rewrite (`settleHeldCopies`' `rewritten`), and the survivors whose prior
  value its `ops` rewrite. Every other caller ignores them.
- `reverseCloseForRerun({ branchId, chapterId, actionId }, ctx)`, in order:
  1. The seed: the chapter's close groups (5.12's close-groups read, C13)
     less their deltas on `chapters` and `story_entries`, the complement of
     a divider-only removal's seed, through `selectReversalSet`.
  2. `buildReverseAndPrunePlan(set, ctx, { keepRedoExact: false })`.
  3. The before-images, read before the transaction: a whole row per
     `(table, id)` in the plan's `patches` (`readCurrentRow` in
     `lib/actions/delta/redo.ts:127` reads one; it was `currentRow`,
     module-private, and gains an export), the delta rows by the ids
     above, and any journal row the plan drops. `runInTransaction` takes
     `SqlOp[]` and returns nothing (`lib/db/types.ts`), so no read can
     happen inside it; the reads are safe because the run holds the gate
     and the phase holds the branch exclusive.
  4. The floor, before the transaction: `MAX(log_position)` over the
     branch's deltas whose ids the plan doesn't prune. A plain
     `MAX(log_position)` read before the transaction counts a top delta the
     plan prunes, such as a user edit on a close-created row above the
     close's report: it reads one too high, and a bound taken from it would
     skip the re-run's first write.
  5. One transaction: the plan's ops, its prunes and the journal insert.
     Its patches are emitted after the commit as `reverseAndPruneDeltaRows`
     emits a plan's.

  It returns the floor. A close that changed nothing in the world still
  gets a journal, empty but for its chapter id and floor, so an abort can
  tell "reversed nothing" from "never reversed".

- `DeltaActionPort` (`lib/pipeline/runtime/action-port.ts`) gains it,
  wired in `lib/boot/bootstrap.ts`.

**The planner drops a journal.** `buildReverseAndPrunePlan` reads the
branch's journals and adds the delete of a re-run's journal row when its
set:

- takes any of that re-run's deltas outside `chapters` and
  `story_entries`, whole (a rollback into the chapter, a delete, a later
  re-run's own reversal) or in part (a rollback past E whose closure
  reaches a row created after E that the re-run wrote);
- prunes or edits a delta at or below that journal's floor that is
  neither a delta on the chapter's own `chapters` row, whatever its
  source, nor a `chapter_close` stamp (a rollback or regenerate of a turn
  between the chapter's end and the re-run); or
- takes the group's last remaining delta: at least one of its deltas,
  leaving none. A report-only re-run after a divider-only removal would
  otherwise leave a journal no CTRL-Z reaches; a group already empty
  mid-run, between the reversal and its first write, matches nothing,
  since no set takes from it.

A divider-only removal takes only the chapter row's deltas and the stamps,
so the journal stays, as canon keeps it, unless it takes the group's last
delta (a re-run that wrote only its report). Its closure takes every write to
the removed row whatever its source (`writesTo`,
`lib/actions/delta/row-closure.ts:96-120`), a card Save's `user_edit`
`updateChapter` included (`lib/chapters/chapter-draft.ts:86`), which is why
the exemption covers the row's every delta: the journal never covers the
`chapters` row, so pruning them can't make the write-back inexact. One rule in the shared
planner covers every reversal: CTRL-Z, `rollbackToEntry`, `sweepFrom`'s
direct `reverseAndPruneDeltaRows` (`lib/actions/turns/regenerate-turn.ts`),
`removeChapter`, an abort, recovery and a re-run's own reversal. The plan
lists the journal rows it drops, so a later re-run journals them as
before-images, and a group's own write-back reads its journal before the
transaction that drops it.

**The write-back** (same module): `rerunWriteBack(actionId, ctx)` returns
`{ ops, patches, outcome }` for its caller's transaction.

- Found by `actionId`, even when the group logged no delta of its own,
  as when a re-run stops between its reversal and its first write. A
  journal-less group with no delta has nothing to restore: its reversal
  never committed.
- **The check,** before any op (default under
  [Open questions](#open-questions)): the journal row is present; no delta
  outside the group sits above its floor; and the group's deltas fill every
  position from floor plus one to its highest. A divider-only removal prunes
  only the report update, the group's highest delta, so the rest stay
  consecutive and the write-back restores the first close's lore without
  a divider, as kept work does.
- **The ops,** after the group's own reversal and prunes in the same
  transaction (`reverseAndPruneDeltaRows` runs `extraOps` after its
  `pruneOps`, `reverse-replay.ts:917`):
  - delete each row whose before-image is absent, and sweep its vectors
    (`vecSweepIdsOps`);
  - upsert each other row whole, with `embedding_stale = 1` on every
    embedded-table row, as redo's `redoRow` sets it: the drain runs on every
    `run_complete` once no run is active (`lib/boot/bootstrap.ts`), so it
    has re-embedded the reverted text before any CTRL-Z;
  - re-insert each pruned delta row whole at its own `log_position` (the
    group's own prunes freed any position its deltas took), and upsert
    each edited one;
  - restore each earlier journal row it holds, and delete this one.
- **The patches,** emitted after the group's own under the same
  `store-sync` stage: `delete` for each row it deletes, a whole-row `create`
  with the forced stale flag for each upsert. In a re-merge the group's
  undo emits `create` of the loser and the write-back then its `delete`, so
  the store ends as the DB does. Recovery emits none: no branch is loaded at
  boot.
- **Without the journal, or on a failed check,** the caller's set becomes
  the group plus the chapter's other close groups (C13's read), through
  `selectReversalSet`, undoing the close as
  `removeChapter`'s `'whole'` mode does, with the journal row's delete
  when one exists, so no orphaned journal stays, and the outcome is
  `undone` with
  the chapter's number, from the journal, else from the row read before
  the reversal. A group with no chapter
  row left (a divider-only removal took it, then a sweep dropped the
  journal) reverses alone. A re-run's group is recognised by its journal,
  else by its shape: a `chapter_close` group holding no `chapters` create,
  which every close's group holds (C1), its chapter the one ending on the
  group's anchor.

**The paths that reverse a re-run's group.**

- **An abort.** `reverseReplayDeltas` (`reverse-replay.ts:945`) calls the
  write-back; its zero-delta early return doesn't apply when a journal is
  found. `abortRun` already holds the branch exclusive for any truthy
  `interruptible` (`orchestrator.ts`). Its return type changes, here and on
  `DeltaActionPort` (`lib/pipeline/runtime/action-port.ts`), from
  `Promise<number>` to the delta count with the journal's outcome
  (`'restored'`, `'undone'` or none), and a re-run's abort `TxResult`
  carries `closeUndone: true` for `'undone'`. A failed call takes the same
  path; its `onPhaseException` hook runs after this reversal, as for any
  close. `submitTurn`'s turn never has a journal.
- **Crash recovery** (`lib/pipeline/runtime/recovery.ts`):
  - orphans newest first (`desc(pipelineRuns.startedAt)`), so a re-run's
    write-back runs before any older orphan it journaled, as canon's
    `recoverInFlightRuns` now orders them;
  - a write-back counts as a reversed orphan: the marker is set
    `recovered` and the run reported, never deleted as a zero-delta orphan.
    Recovery's `settleOps(deltaCount)` deletes the marker at a count of 0
    today, so its contract changes: it is told whether anything was
    reversed, a write-back included;
  - `RecoveredRun` gains `closeUndone?: true`, and `formatRun`
    (`lib/recovery/copy.ts`) adds canon's line after the close's:
    `The chapter's earlier close couldn't be restored, so its close was undone.`
  - the re-run's marker carries `rerun_chapter_id` from its reversal's
    transaction, so recovery knows a re-run exactly: with no journal (a
    failed abort's write-back, then a sweep that dropped it) it takes the
    fallback and reports `closeUndone`, or reverses the group alone with
    no chapter row left.
- **CTRL-Z** (`lib/actions/story-entries/undo.ts`). A re-run's group is a
  `group` target, as a close's, recognised as the write-back recognises
  one.
  - `undoBracketed` takes no `prepareUndo` snapshot for it: it reverses
    through `reverseAndPruneDeltaRows` with `keepRedoExact: false` and the
    write-back as `extraOps`, or the fallback set.
  - It calls `undoRedoStore.clear()` after the commit, also when only the
    store sync failed, as `commitNewAction` does. A later edit's redo
    snapshot can hold the re-run's values, and redo writes an update's whole
    `rowBeforeUndo` back (`redo.ts:329-333`), which would resurrect them
    with no delta behind them.
  - `UndoResult`'s `ok` arm gains `closeUndone?: { chapterNumber }`, and
    the reader's undo handler (`app/reader-composer/[branchId].tsx`) raises
    canon's warning toast,
    `Chapter <N>'s earlier close couldn't be restored, so its close was undone.`,
    on the button and the keyboard path alike.
- **A later re-run** drops this one's journal through the planner and
  journals it; that re-run's CTRL-Z restores it with the lore.

**`pendingRerun` and the `'rerun'` slot** (`lib/stores/generation/generation.ts`).

- `TxState.pendingRerun: ReadonlyMap<string, { chapterId: string }>`, with
  `setPendingRerun` and `clearPendingRerun`, both in
  `RERUN_RECORD_MUTATORS` in `eslint.config.js`, owned by
  `close-rerun.ts` alone.
- `RunState.interruptible` widens to `DeferredWorkKind | 'rerun' | null`.
  `newRunState` (`orchestrator.ts`) sets `'rerun'` for a `chapter-close`
  run reserved while `pendingRerun` holds its branch, a chained successor
  included, since `commitRun` builds successors through it. A catch-up pass
  keeps `'pass'` and defers as any pass.
- `abortRun` records no deferral and returns null for `'rerun'`, so no
  `run_deferred` fires; `finishRun` clears no `deferred` slot and leaves
  `pendingClose`. `withDeferral` and the `DeferredWorkKind` maps never see
  `'rerun'`.
- `selectMemoryRun`, `interruptMemoryRuns`, `isHeadReversalBlocked` and
  the pill already test truthiness, so a reversal that spares the chapter
  and Cancel interrupt a re-run with no change.
- `run_complete` gains `rerun?: true`, set from the run's slot in
  `emitRunComplete`.

**The chain** (`lib/pipeline/definitions/memory-chain.ts`, `lib/actions/chapters/close-chain.ts`).

- `unprocessedThroughChapter(chapterId, processedThrough, ctx)`: the
  unprocessed entries through the chapter's end entry only, not the
  branch's whole backlog.
- `memoryRunOn` (through `nextMemoryRun`) and `passChainsTo` check
  `pendingRerun` first, as canon's `nextMemoryRun` does: a pass while an
  entry through the chapter's end is unprocessed, else `chapter-close`.
  The close declares no `chainsTo`, so the re-run chains nothing.
- `startCloseChain` picks its first run the same way under `pendingRerun`.

**The close pipeline under a re-run** (C2).

- `reversal`, a new member of `CLOSE_PHASE`
  (`lib/pipeline/definitions/intermediates.ts:25`), listed between
  `metadata` and `agent` in `chapter-close.ts`, its phase in
  `chapter-close-reversal.ts`. On a close it returns `completed` at once.
  Under a re-run it holds the branch write lock exclusive under the run's
  `actionId` through the port (`holdBranchWriteExclusive`, released in a
  `finally`), as `abortRun` does, checks the abort signal once the hold is
  granted, so a Cancel that landed while the hold queued costs no
  reversal, calls `reverseCloseForRerun`, and parks the floor in a new
  `close-intermediates.ts` accessor. A user write dispatched before the run
  reserved has already settled: `driveOrigin` awaits `settleUserWrites`
  after `beginRun` for every hard-gate origin (`orchestrator.ts:670`),
  and the gate holds across a chained successor's handoff. A throw fails
  the run, and its abort finds the journal or none. `generation-pipeline.md → Branch write lock`
  names it as a third exclusive holder, so a rollback preview's reads never
  straddle it.
- `boundary` (`chapter-close-boundary.ts`), under `pendingRerun`: the range
  `{ chapterId, startEntryId, endEntryId }` from the chapter row, never
  `pendingClose`. It fails the run (`phase-logic`) when the chapter isn't
  the branch's highest `sequence_number` or has no close group.
- `metadata` (`chapter-close-metadata.ts`), under `pendingRerun`: cuts the
  parts from the chapter's own entries (`readCloseRangeEntries` over the
  range, their `content_tokens` as the series' tokens) for the current
  model's window and sets them, making no call and writing nothing.
- `agent` and `report` run as a close's. The report records the review's
  lower bound (below). Awareness reads the chapter's existing summary with
  no change: 5.9 reads `chapters.summary` by the close range's `chapterId`,
  which `boundary` parks for a re-run too. Re-check it against 5.9 as it
  lands.
- `closingChapterId` (`closing-chapter.ts`) skips a `'rerun'` run, so the
  Timeline doesn't expand the chapter as a fresh close.
- The banner (`closeBannerLabel` in
  `components/compounds/use-memory-run-banner.ts`) gains
  `chrome.memoryBanner.closingReversal`, shown for `reversal` only when the
  run's slot is `'rerun'`. `runNode` sets the phase on every close
  (`orchestrator.ts:323`), so a close keeps the metadata label through its
  no-op `reversal`. Under a re-run, `boundary` and `metadata` show the plain
  `Closing chapter…`, since neither chooses an end nor writes a summary
  then. A re-run is never before a turn. C6 names the label.

**The review** (C4, C7). As 5.11 ships them (its
[Implementation notes](./11-review-window.md#implementation-notes) record
the decisions; its plan, `.impl-plans/M05-11-review-window.md`, is a
git-ignored pointer only):

- `chapterOverlaysStore` holds the open window's chapter id, 5.10's
  modal request, and `closeResult`, the commit banner's done state, typed
  `CloseResult = { branchId, chapterId, stoppedTasks }` and written by
  `showCloseResult` and `clearCloseResult`.
- `ChapterOverlaysHost` clears the window's id and `closeResult` by one
  rule: the chapter is absent, its `hasCloseReport` is false, or another
  branch is open.
- `loadCloseDeltas(db, branchId, chapterId, actionId)` reads a close's
  group from the lowest to the highest position of the chapter row's
  deltas under the action (the `create` and the report update, C1),
  skipping `story_entries`, in log order.
- `ReviewWindow` is a props-in view whose footer holds `Done`.

This slice extends them:

- The chapters store row carries `closeReportActionId` beside
  `hasCloseReport` as one union,
  `{ hasCloseReport: false; closeReportActionId: null } | { hasCloseReport: true; closeReportActionId: string }`,
  built by `closeReportFields` in
  `lib/stores/chapters/chapter-store-projection.ts`: on create, and on an
  update only when `closeReport` is a key of `columns`. The hydrate select
  (`lib/actions/stories/operational.ts`) reads the action only where
  `json_type(close_report, '$.actionId')` is `'text'`, and derives the
  flag from it. A stored report whose action isn't a string reads as
  none: no writer stores one and the report schema refuses it. C4's store
  test walks a re-run's commit and its CTRL-Z too.
- `loadCloseDeltas` (`lib/history/close-read.ts`) gains a lower bound and
  reads a re-run's group from it to its report update, so its changes keep
  their old values. The default under [Open questions](#open-questions):
  the report records C4's `firstLogPosition`, the floor plus one, from the
  intermediate the `reversal` phase parks; a close's report has none and
  keeps the range above.
- `ChapterOverlaysHost` keeps the `closeReportActionId` the window opened
  on and closes the window when the row's changes, on a re-run's commit or
  its CTRL-Z. `CloseResult` gains `actionId` and `rerun`, and the host
  clears it by the same rule, so a re-run's done state replaces a close's
  and its CTRL-Z clears it.
- `ReviewWindow` stays mounted with `open={false}` through the phone
  Sheet's exit, its reads off, and the host unmounts it once the exit
  ends (`onExited`), in one rework with the prune and the remembered
  window's reopen. Above phone the Dialog has no exit animation, so it
  unmounts as it closes.
- **While a re-run runs,** the window shows the first close's report: the
  row's report and `closeReportActionId` don't change until the re-run
  commits, and the window closes then. Once the `reversal` phase has
  committed, that close's old values sit in the journal, not the log, so a
  window opened mid-run shows its changes with new values only, and a row
  the reversal removed doesn't press; an abort's write-back brings them
  back at the next settle.

**The notices,** against canon as 5.11 leaves it:
[`reader-composer.md → During a memory update`](../../../../ui/screens/reader-composer/reader-composer.md#during-a-memory-update)
and
[`principles.md → Affordance loci`](../../../../ui/principles.md#affordance-loci)
give a close's commit, and a re-run's, the memory banner's done state
instead of a toast, and keep the re-run's cancel and failure as toasts.
As 5.11 ships it (as `useMemoryRunToasts`, renamed in the 2026-11-14 triage pass), the commit handler lives in `useMemoryRunOutcomes`
(`hooks/use-memory-run-outcomes.ts`): on a completed `chapter-close`
`run_complete` it reads the branch's latest report and, when its
`actionId` is the event's, calls `showCloseResult`, so the banner reads
`Chapter closed: <title> [Review] [×]`. It shows a re-run's commit as a
close's until this slice.

- That commit arm holds a `rerun` event's result with its `actionId` and
  `rerun: true`, and the banner reads `Chapter <N>'s close re-ran [Review] [×]`,
  in the warning tone when tasks stopped early, under a new
  `chrome.closeResult.rerun` key.
- The hook's failure arm skips a `rerun` event, so a re-run never shows
  `Chapter close failed. It runs again…`. A re-run records no deferral, so
  its deferral arm never sees one. The commit arm doesn't skip it.
- The host that started the re-run holds its chapter number from the
  preview and toasts on the chain's end when that end is the re-run's,
  with no action: aborted, info,
  `Re-run cancelled. Chapter <N>'s close is as it was.`; failed, warning,
  `Re-run failed. Chapter <N>'s close is as it was.` with the reason as
  5.6's failure copy gives one; either with `closeUndone`, warning,
  `Chapter <N>'s earlier close couldn't be restored, so its close was undone.`
  instead, and either whose undo didn't commit (`unreversed`), error,
  the restart line (Implementation notes). A catch-up pass that ends the
  chain raises its own pass toast, as today.

**The action** (`lib/actions/chapters/close-rerun.ts`, exported from
`lib/actions`).

- `getCloseRerunPreview(branchId, chapterId, story, ctx)` reads everything
  under one `withBranchWriteShared` hold, as `getChapterDeletePreview`
  does, and returns a `CloseRerunPreview` or the refusal:
  - **Refusals:** `not-found`, `not-latest`, `no-close` and `integrity`,
    as 5.12's preview gives them (never `in-flight`: `Re-run close`
    disables while the gate is closed), and `close-owed` on the region
    the shortcut
    would leave: a pending manual close whose end entry survives it, or,
    with auto-close on, that region at the threshold with a reply (C10).
  - **Turns since:** a `story_entries` create above the first log
    position of the chapter's latest close group, the close's or a
    re-run's, is a turn's: system entries log no delta and passes create
    no entries. The shortcut's target is the first such turn, whole: its
    `user_action`, even when only the reply was regenerated since and the
    action's create sits below the group.
  - **The shortcut's counts,** through `resolveSweep` and 5.12's
    `rollbackCountsOf` inside the same hold. Never `getRollbackCounts`,
    whose own shared hold would nest: the lock isn't reentrant
    (`lib/actions/delta/branch-write-lock.ts:1-2`), and an exclusive
    request queued between the two holds deadlocks them.
  - **The reversal's counts,** as 5.12's preview counts its set
    (`createdLore`, `otherChanges`, `your edits included`), taken as after
    the shortcut's rollback: only the deltas both the re-run's set and
    the shortcut's set hold are left out, by delta id and not by row, so
    the confirm never counts a change twice; survivors and ref clears are
    judged with the shortcut's deltas treated as reversed, and a
    close-created lore row whose delete the shortcut reverses counts. The
    closure-side cases the confirm still reads before the shortcut are
    parked
    ([`parked.md → A re-run confirm's counts read before its shortcut`](../../../../parked.md#a-re-run-confirms-counts-read-before-its-shortcut)).
  - **Cost:** `tokens`, the `content_tokens` sum over the chapter's
    non-system entries, which is what the parts read; `model`, what
    `lore-mgmt` resolves to for the story, the story's override included.
  - The shape:
    `{ chapterNumber, model, tokens, reversal: { createdLore, userEdited, otherChanges }, shortcut: { targetEntryId, turns, entries: { count, first, last }, counts } | null }`,
    with `turns` the replies the shortcut removes.
- **A delete's and a re-run's preview after a re-run.** 5.12's
  `getChapterDeletePreview` counts across the chapter's close groups
  (C13), not the group holding the `create`: after a re-run every lore
  create still in the log sits in the re-run's group, since its reversal
  pruned the close's into the journal. So a delete after a re-run, and a
  second re-run, count the re-run's lore creates whose rows still
  stand.
- `startCloseRerun(branchId, chapterId, expected, ctx)`, shaped as
  `regenerateTurn` is: one admission, and a pending mark
  (`generationStore.bracketPendingTurn`) held from before the shortcut
  until the chain reserves, so no start lands between the shortcut and
  the reserve. Nothing commits before step 4:
  1. The manual close's start refusals, read up front as
     `startCloseChain` reads them: the branch not open, a pending
     embedder swap, a busy story (`story-busy`) and a held branch, and
     a branch held until restart (`rerun-held`).
  2. 5.10's pre-flight over the chain's snapshot; a failure resolves
     `{ outcome: 'preflight-failed', error }`, which the host toasts.
  3. Under the mark, the preview's refusals, then `counts-changed`
     against `expected` (the shortcut's target and counts, the
     reversal's counts), carrying the fresh preview, then the memory
     pass's pre-flight when a catch-up pass will run.
  4. With turns since, the rollback's sweep (`sweepToEntry`) with the
     confirm's counts, in its own prose-reversal bracket inside the
     mark; a refusal ends the start.
  5. `setPendingRerun` under the mark, then `startCloseChain` handed
     the mark the bracket gave its body (`pendingMark`), which its busy
     check skips (no other mark on the branch) and which it ends at the
     reserve, before the caller's `onReserved`; with the pre-flight
     again. The store clears
     `pendingRerun` in the update that ends the chain's last run; a
     `finally` here is the backstop for a refused start.

  It resolves with the chain's end and its kind (`ChainEnd`), or the
  refusal, so the host can tell a re-run's end from a catch-up pass's.

**Held head reversals.**

- A pure `rerunHoldsReversal(txState, branchId, target)` in
  `lib/stores/generation`: a `'rerun'` run holds the branch and the target
  entry has a `chapter_id`. The re-run's chapter is the latest, so a
  stamped target sits at or before its end entry, and a rollback to it, or
  a regenerate of the end reply, would remove that entry. A reply in the
  open region regenerates from its `user_action`, which C10 keeps in the
  open region too, so it spares the chapter.
- `rollbackToEntry` (`lib/actions/story-entries/operational.ts`) and
  `regenerateTurn` refuse such a target with their `in-flight` rejection,
  read before the bracket and re-checked synchronously with it, as
  `regenerateTurn` re-checks the gate. A reversal that spares the chapter
  interrupts the re-run, whose abort writes the journal back before the
  sweep reads the log. If the journal held a write that sparing rollback's
  closure would take, its commit refuses `counts-changed` and re-opens on
  fresh counts, as any recount does.
- The reader's ↻ and × disable per entry with the re-run's tooltip,
  `Re-running the chapter's close. Cancel to edit.`
  (`generationGate.chapterCloseRerun`). The gate selectors in
  `components/story-settings/generation-run.ts` tell a re-run from a close
  by its slot, so every disabled control names it.
- CTRL-Z stays refused while a re-run runs: `undoLastAction`'s gated pass
  skips the running run and refuses any target but a turn (`undo.ts:135-144`),
  and the head under a re-run is never a turn. Since every press is
  refused, the reader's Undo entry (`undoGate.blocked`,
  `app/reader-composer/[branchId].tsx:1727`) disables while a `'rerun'` run
  holds the branch, with the re-run's tooltip, as principles has a blocked
  control do.
- **The suggestion strip's ⟳**: one pure predicate,
  `refreshHeldByRerun(txState, branchId)` in `lib/stores/generation`
  beside `rerunHoldsReversal`, exported from `lib/stores`, true while
  `pendingRerun` holds the branch, the re-run's catch-up pass included:
  a refresh started beside the pass would run on into the re-run, since
  chained successors skip admission. Only ⟳ disables, through the
  strip's `canRefresh` and a `refreshDisabledReason` tooltip with the
  re-run's copy; chip taps, which write nothing, stay live.
  `refreshSuggestions` (`lib/actions/suggestions/refresh-suggestions.ts`)
  refuses with a rejected start, never a throw, logging no delta.
  Otherwise a refresh's chip delta would sit above the floor and turn the
  re-run's CTRL-Z into an undone close; the refresh's `blockedBy` lets
  it start beside a close.

**The confirm and its entry points.**

- `CloseRerunConfirm` in `components/chapters/close-rerun-confirm.tsx`: an
  AlertDialog per canon's sketch, props in and no store reads, so stories
  run without a database. Title, framing with the model, the count lines
  or `The close changed nothing in the world.`, the shortcut's block when
  turns followed, the cost line with the token count, the CTRL-Z line. A
  count line at zero is left out, as the delete confirm leaves it. With
  no turns since, the footer is `Cancel` and `Re-run close` (default
  CTA). When turns followed it is canon's three buttons: `Cancel`,
  `Roll back & re-run` (destructive, the shortcut) and
  `Re-run on new branch`, rendered disabled with its lands-later tooltip
  until M6.3 (C16); the block leaves out the fork's sentence and keeps
  the line that the turns go for good. The confirm actions disable while
  the gate is closed. Copy goes in the `chapters` namespace.
- `useCloseRerunConfirm` in `components/chapters/` holds the preview and
  re-reads it when `settleCount` moves, through `useSettleReread` in
  `hooks/`, the settle effect alone it shares with
  `useLiveRollbackCounts` and `useChapterDeleteConfirm`; each keeps its
  own skip, refusal handling and log events. It drops a stale read, and
  closes the confirm with the refusal's toast on a refused re-read.
- **The host.** `openRerunConfirm({ branchId, chapterId, fromReview? })` in
  `chapterOverlaysStore` (C7, provided here) runs the registered surface's
  guard before the confirm opens, as `openCloseModal` does, since a re-run
  starts a close run
  ([`save-sessions.md`'s intercept categories](../../../../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept),
  which 5.10 extends for starting a close). Per the default under
  [Open questions](#open-questions), it never stacks over the review
  window:
  - from the card, the guard, then the confirm;
  - from the review window, it closes the window first and remembers it,
    then the guard, then the confirm alone. The confirm's `Cancel`
    reopens the window it closed, and confirming leaves it closed. The
    guard's Cancel leaves the window closed, as 5.11's row press does, so
    the guard's dialog never sits over the window.

  Confirming hands `startCloseRerun`'s promise to the host. A refused
  preview toasts and opens nothing. `counts-changed` re-opens the
  confirm on the fresh preview with rollback's toast,
  `The counts changed while this was open. Check them before confirming.`;
  `not-latest` toasts `This is no longer the latest chapter.` and closes;
  a refusal for a run in flight toasts `Unavailable while generating.`
  and keeps the confirm open with its actions disabled, as the delete and
  the reader's rollback confirms do; the disabled actions carry the
  blocking run's tooltip, falling back to that string only once no gate
  reason remains (`chapter-overlays-host.tsx`'s `rerunReason ?? held`);
  `close-owed` toasts `Close the open chapter first.`, an embedder swap
  or a held branch the manual close's copy, `rerun-held` the restart
  line, a catch-up pass's pre-flight the memory pass's settings copy,
  and other refusals a failure,
  each closing it. A refused or failed first preview read from the
  review window reopens the window.

- **The card.** `Re-run close…` in `chapter-card.tsx`'s `moreActions`,
  between `Review changes` and `Delete…`, on the latest chapter's card when
  `hasCloseReport` holds: inline at tablet and desktop, in the phone's `⋯`.
  It disables with the gate's reason in flight, and with
  `Close the open chapter first.` while a close is owed, read by a pure
  `isCloseOwed(progress, autoClose, manualPending)` in `lib/chapters` over
  the route's `useChapterProgress` return and `pendingClose`. `closeOwed`
  (`memory-chain.ts`) calls it, and 5.12's `closeAfterDelete` takes its
  `closes-next-send` arm from it, which today restates the same rule, so
  the rule keeps one copy. From the phone's `⋯` it opens its guard and
  confirm at once, as `Delete…` does, over the menu's dismissing Sheet:
  5.11's late-dismiss path is for an entry that opens a Sheet of its own.
  `ChapterCard` stays props-only.
- **The review window.** `Re-run…` beside `Done` in the `ReviewWindow`
  footer, on the latest chapter's window only, with the card's disabled
  rules and tooltips, calling `openRerunConfirm` as above. On phone the
  window's Sheet starts its slide-out before the guard and the confirm,
  which may open over it while it exits, never on it.
- Neither button flips (C16): both land on hosts already on main, live.

**Canon, in the same commits.**

- `generation-pipeline.md → Branch write lock`: the re-run's reversal
  phase as a third exclusive holder.
- `generation-pipeline.md → Reverse-replay` and the ER's `journal`
  description in `data-model.md`: the floor and the chapter's id and number in
  the journal,
  the check's consecutive positions, and the planner's rule with
  divider-only's exemption, as settled at planning.
- The ⟳ hold, if kept: the in-flight edit restrictions in
  `principles.md`, where a refresh may otherwise run beside a close, and
  the suggestion strip's lines in `reader-composer.md`.
- `docs/observability.md → Subsystem emission inventory`: every new event
  name, such as the journal's write and a fallback.
- `component-inventory.md`: a shipped row for `CloseRerunConfirm`, and
  the `ChapterCard`, `ReviewWindow` and `MemoryRunBanner` rows.
- The review-window flow, if the default holds:
  `chapter-timeline.md → Re-run a close` and `Review window` (canon's
  "stacks over the window" and "`Cancel` returns to the review"), the
  stacking line in its `Mobile expression`, and the re-run confirm's
  comment and stacking in `chapter-timeline.html`. The wireframe already
  shows the confirm, the card's action and the footer button.
- `generation-pipeline.md → Writes`: the `reversal` phase's carve-out;
  `Crash recovery via pipeline_runs marker table`: `rerun_chapter_id`,
  recovery's order and its settle.
- `data-model.md → Entry mutability & rollback`: the write-back beside
  redo as restoring a log position.
- `rollback-confirm.md → Edge cases`: the in-flight keep-open, which the
  delete and re-run confirms share.
- `alert-dialog.md`'s Used-by line for the re-run confirm.
- The milestone's C7 line, C16's flip row and Sizes.

**Tests and the measure.** The round-trip arms (C9), the unit and
component tests, the E2E and the Android measure, as
[Acceptance criteria](#acceptance-criteria) and [Tests](#tests) list them.

## Scope: out

- Re-running one task, steering a re-run, a previous-run view and a later
  restore: parked
  ([`parked.md → Re-running one close task`](../../../../parked.md#re-running-one-close-task),
  [`Steering a re-run`](../../../../parked.md#steering-a-re-run),
  [`Comparing close runs and trading one back later`](../../../../parked.md#comparing-close-runs-and-trading-one-back-later)).
- Re-running on a fork, and a fork carrying `reversal_journals` with its
  group: M6
  ([`chapter-close.md → Re-running a close`](../../../../memory/chapter-close.md#re-running-a-close)).
- A branch delete dropping `pendingRerun` with `deferred` and
  `pendingClose`: M6.3, as the roadmap's item says. A re-run's chain clears
  its own record.
- Redo of a re-run: canon has none.
- A recovery line for a re-run whose journal was written back: the close's
  copy stays true. Only the fallback adds a line (above).
- Export code: none exists, and canon's manifest already lists the table.
- `Regenerate summary` and the metadata a re-run keeps (M7.2), and a
  close's display translation slot (M8.1).
- The delete set, `removeChapter`, its preview and confirm,
  `rollbackCountsOf`'s chapter fields and regenerate's close arm:
  [Slice 5.12](./12-chapter-delete-rollback.md).
- The review window, its host and store, `registerSurface`, the commit
  banner and a close's `loadCloseDeltas` range:
  [Slice 5.11](./11-review-window.md).
- The close modal, `runPreflight` and `toolCalling`:
  [Slice 5.10](./10-two-starts.md).
- `pendingClose`'s lifecycle, `closeOwed`, phase 0 and the close's own
  failure surfaces: [Slice 5.6](./06-close-owed.md).
- The tasks and their tools: [Slice 5.5b](./05b-identity-threads.md),
  [Slice 5.8](./08-prose-tasks.md) and
  [Slice 5.9](./09-chapter-wide-tasks.md). A re-run runs them unchanged.

## Acceptance criteria

Unit paths run with `pnpm vitest run --project unit <path>`.

**The journal and its write-back.**

1. `lib/actions/delta/rerun-journal.test.ts`, on a close group built with
   5.12's `lib/actions/chapters/__tests__/chapter-delete-fixture.ts` and a
   `merge_happenings` helper lifted from the round trip's `seedInnPair`,
   with a lore create, an entity
   update, a `merge_happenings` that deleted a loser with its involvements,
   and a later `user_edit` on the created lore row: after
   `reverseCloseForRerun`, the lore row is gone, the entity field and the
   loser are back, those deltas and the user edit are gone from the log,
   the chapter row, its report and stamps are untouched, and one
   `reversal_journals` row's before-images equal the rows and delta rows
   read before it, beside the chapter's id and number.
2. The same file: the write-back after the group's own reversal leaves
   every row and every delta row deep-equal to the snapshot taken before
   the re-run, each delta at its own `log_position`, and no
   `reversal_journals` row. A row the re-run merged again is absent from
   its table and from its vec0 table.
3. The same file: with the drain run by hand between the commit and the
   write-back, clearing the flag, every restored embedded row reads
   `embedding_stale = 1` after the write-back. No drain runs after it in the
   test, per the drain lesson.
4. The same file: the patches emit the group's own first, then the
   write-back's, and after a re-merge the loser is absent from its store.
5. The same file, the floor: with a user edit above the close's report
   that the closure prunes, the returned floor is the report's position,
   and the re-run's first own write lands at floor plus one.
6. The same file, the check: a delta outside the group above the floor
   gives `undone`, with the chapter row gone and `chapter_id` null across
   the range; a gap in the group's positions gives `undone`; after a
   divider-only removal the write-back restores the first close's lore,
   with no chapter row; and a fallback after a divider-only removal
   reports the chapter's number from the journal.
7. The same file, the planner: the journal row is gone after a rollback
   past E whose closure takes one of the re-run's deltas, after a rollback
   of a turn between E and the re-run, and after a regenerate through
   `sweepFrom`. It stays after a divider-only removal, also when a card
   Save renamed the chapter between the close and the re-run, which the
   removal's closure prunes below the floor. A second re-run's reversal
   drops the first's journal and holds it, and that re-run's CTRL-Z
   restores it.
8. `lib/actions/stories/delete-story.test.ts`'s schema test passes with
   the table in `BRANCH_SCOPED`, and fails with it removed.

**The paths.**

9. `lib/pipeline/__tests__/rerun-abort.test.ts`: an abort after the
   `reversal` phase and before any own write, one after the first own
   write, and a scripted tool step that fails after the first own write
   each leave the close's state and log as before the re-run, mark the run
   `aborted` or `failed`, record no deferral and emit no `run_deferred`. An
   abort before `reversal` writes nothing and finds no journal.
10. `lib/pipeline/__tests__/recovery.test.ts`: an orphaned re-run in each
    of those windows is restored, reported in `reversed` and marked
    `recovered`. Two orphans, a pass whose commit marker failed and a
    re-run that journaled its deltas, recover newest first and leave the
    pass reversed whole. A re-run whose check fails is reported with
    `closeUndone: true`, and so is a marker carrying `rerun_chapter_id`
    with neither journal nor delta, which takes the fallback.
11. `lib/recovery/copy.test.ts`: a `closeUndone` run adds the fallback
    line after the close's; a restored one doesn't.
12. `lib/actions/story-entries/undo-rerun.test.ts`: after a re-run, CTRL-Z
    leaves `undoRedoStore` empty, also when a mocked store sync throws
    after the commit; a re-run, an edit, CTRL-Z, CTRL-Z, then redo returns
    `nothing-to-apply` and the edit's value is absent; the fallback
    returns `closeUndone` with the chapter's number. CTRL-Z during a
    re-run, after its `reversal` commits, returns `gated` with the log
    unchanged, in `lib/pipeline/__tests__/rerun-chain.test.ts`, which
    holds a live chain.

**The round trip (C9).**

13. `lib/pipeline/__tests__/close-round-trip.test.ts`: every re-run arm
    under [Tests](#tests) passes for every case on main, each against the
    expectation listed there, and the table test that names only real arms
    holds.

**The run.**

14. `lib/stores/generation/generation.test.ts`: `setPendingRerun` and
    `clearPendingRerun` write and drop the record; `abortRun` of a
    `'rerun'` run returns null and leaves `deferred` alone; `finishRun`
    leaves `deferred` and `pendingClose`.
15. `lib/pipeline/__tests__/rerun-chain.test.ts`: under `pendingRerun`, a
    `chapter-close` run reserves as `'rerun'` and a pass as `'pass'`; its
    `run_complete` carries `rerun: true`; with an unprocessed entry at or
    before E the chain starts a pass, then the re-run; with unprocessed
    entries only after E it starts the re-run; the re-run chains nothing.
16. `lib/actions/chapters/close-rerun-start.test.ts`: `pendingRerun` is absent
    after each end: a refused start, a catch-up pass that fails, one
    cancelled, one interrupted, and the re-run committing, aborting and
    failing.
17. `lib/pipeline/definitions/chapter-close-boundary.test.ts`,
    `chapter-close-metadata.test.ts`, `chapter-close-reversal.test.ts`
    and `closing-chapter.test.ts`: under a re-run, boundary parks the
    chapter's own range and fails on a chapter no longer latest or with no
    close; metadata sets parts from the chapter's entries with no model call
    and no delta; `reversal` is a no-op on a close and holds the branch
    exclusive under a re-run, so a preview's shared hold requested during
    it returns after the commit; a Cancel that lands while the phase's hold
    is queued commits no reversal and writes no journal; `closingChapterId`
    reads null for a re-run.
18. `components/compounds/memory-run-banner.test.tsx`: a re-run's
    `reversal` shows its label, and its `boundary` and `metadata` show
    `Closing chapter…`; a close's `reversal` keeps the metadata label.

**The action.**

19. `lib/actions/chapters/close-rerun-start.test.ts`, refusals before the
    shortcut, each leaving the `story_entries` count and the log as they
    were: `story-busy` for a busy story, `not-latest`, `no-close`,
    `close-owed` (a pending
    manual close, and auto-close at the threshold after the shortcut),
    `preflight-failed` with `toolCalling` off, and `counts-changed`
    carrying the fresh preview.
20. `lib/actions/chapters/close-rerun.test.ts`: a reply regenerated since the close makes its
    `user_action` the target; the shortcut's counts equal, as literal
    numbers, those `getRollbackCounts` reads at that target outside any
    hold; the reversal's counts leave out a delta both sets hold,
    counting it once on the shortcut's line; an
    exclusive hold requested during the preview takes the lock after the
    preview returns.
21. The same file: after a re-run whose Lore task created two lore rows,
    5.12's `getChapterDeletePreview` and a second re-run's preview each
    read `createdLore: 2`, as literal numbers.

**Held reversals and the ⟳ hold.**

22. `lib/stores/generation/rerun-holds.test.ts`, a literal table: a
    stamped target under a `'rerun'` run is held; an unstamped one isn't;
    a stamped one under a close or a pass isn't. `refreshHeldByRerun` reads
    true while `pendingRerun` holds the branch, a catch-up pass of the
    re-run's chain included, and false under a close, a pass with no
    record, or a record on another branch.
23. `lib/actions/story-entries/operational.test.ts` and
    `lib/actions/turns/regenerate-turn.test.ts`: during a re-run,
    `rollbackToEntry` to a stamped entry and `regenerateTurn` of the end
    reply after a manual close on the latest reply return `in-flight`,
    with the re-run still running and the log unchanged; a rollback to an
    open-region entry interrupts the re-run, whose abort restores the
    close, then lands.
24. `lib/actions/suggestions/refresh-suggestions.test.ts`: during a
    re-run, and during its catch-up pass, `refreshSuggestions` resolves a
    rejected start, starts no run and logs no delta; during a close it
    starts.
25. `components/story-settings/generation-run.test.tsx`: a re-run's gate
    reason is `Re-running the chapter's close. Cancel to edit.` and a
    close's keeps its own. The strip's ⟳ (`canRefresh`) and the reader's
    Undo entry read the re-run's hold: both disable during a re-run, with
    that reason, chip taps stay live, and both stay enabled during a
    close (the pure helpers the route reads); each row's ↻ and × disable
    on a stamped entry under a re-run.

**The review and notices.**

26. `lib/actions/chapters/close-report-store.test.ts`:
    `closeReportActionId` follows commit, a re-run's commit, its CTRL-Z, a
    title save and its undo, as `hasCloseReport` does; and the story-open
    hydrate after a re-run reads the re-run's `actionId`.
27. `lib/history/close-read.test.ts`: after a re-run that updated a field
    the close also wrote, `loadCloseDeltas` for the re-run returns that
    field's delta with the value from before any close, and none of the
    close's.
28. `hooks/use-memory-run-outcomes.test.tsx`: a completed `rerun` event whose
    latest report's `actionId` matches holds a `closeResult` with that
    `actionId` and `rerun: true`; a failed `rerun` event holds nothing and
    toasts nothing.
29. 5.11's host test (`components/chapters/chapter-overlays-host.test.tsx`,
    the first item) and `components/chapters/chapter-overlays-host-rerun.test.tsx`
    (the rest):
    - a re-run's commit closes an open window and replaces a close's done
      state with `Chapter <N>'s close re-ran`, in the warning tone when the
      report holds a stopped task; its CTRL-Z clears it;
    - the host toasts each of the three re-run notices from a scripted
      chain end, and none for a catch-up pass's end;
    - a `counts-changed` start re-opens the confirm on the fresh preview
      with the counts-changed toast, and `not-latest` closes it with its own;
    - over a dirty surface, `Re-run…` closes the window before the guard
      raises its dialog; the guard's Cancel leaves the window closed and no
      confirm; Discard opens the confirm alone; the confirm's `Cancel`
      reopens the window; from the card the guard runs, then the confirm.

**UI.**

30. `components/chapters/close-rerun-confirm.stories.tsx`, play: with turns
    since (the block and its counts; `Cancel`, `Roll back & re-run`, and
    `Re-run on new branch` disabled with its tooltip), without (no block;
    `Cancel` and `Re-run close`), the close changed nothing (the one
    line), and `Blocked` with the confirm actions disabled;
    `Re-run close` and `Roll back & re-run` fire the start.
31. `components/chapters/use-close-rerun-confirm.test.tsx`: a settle
    re-reads the preview, a stale read is dropped, and a refused re-read
    closes the confirm with its toast.
32. `components/chapters/chapter-card.stories.tsx`, play: the latest card
    shows five actions and an earlier one three; `Re-run close…` is hidden
    on a chapter no close wrote, and disabled with
    `Close the open chapter first.` while a close is owed and with the gate's
    reason in flight; the phone `⋯` lists it. The review window's stories
    show `Re-run…` on the latest chapter's window only, with the same
    disabled states.
33. `e2e/tests/chapter-close-rerun.spec.ts`, on a story with a closed
    latest chapter whose close wrote a seeded change, driving the UI and
    asserting the DB:
    - from the card with turns since: the confirm shows the shortcut's
      block and three buttons, `Re-run on new branch` disabled;
      `Roll back & re-run` removes those entries, and the re-run's scripted
      tool write lands under a new `action_id` with the report's
      `actionId` equal to it; the banner then reads
      `Chapter <N>'s close re-ran`;
    - CTRL-Z then restores the first close: its report's `actionId`, its
      deltas at their `log_position`s and the seeded change's value, with no
      `reversal_journals` row;
    - from the review window's `Re-run…` with no turns since: the window
      closes and the confirm opens alone, with no block and two buttons;
      its `Cancel`
      reopens the window; `Re-run…` again and confirming commits the
      re-run, and CTRL-Z restores the close the same way.

**Measure and gates.**

34. The journaled reversal's commit and the re-run's CTRL-Z, timed on the
    Fold's release build: the `reversal` phase's commit behind a
    temporary mark, and the CTRL-Z, the group's own reversal with the
    write-back, through `timedReversal`. The group is
    `pnpm db:seed:dataset`'s close (224 deltas, 89 outside `chapters` and
    `story_entries`). Implementation notes record the times beside 5.10's
    399 ms CTRL-Z and 5.2's 1.1 s stamp burst, with the seed's delta count
    and the journal's size in bytes, and neither stalls the JS thread over
    500 ms.
35. `pnpm lint`, `pnpm typecheck`, `tsc -p electron/tsconfig.json`,
    `pnpm lint:docs`, `pnpm format:check`, `pnpm compiler:check` and
    `pnpm test:run` pass, and `pnpm test:e2e -- chapter-close-rerun` passes
    after `pnpm build:web`. Desktop smoke through the `electron-app` MCP;
    on the Android dev client at phone width, the card's `⋯`, the confirm,
    and `Re-run…` from the review's Sheet, which dismisses before the
    confirm opens.

## Tests

- **Round trip** (`lib/pipeline/__tests__/close-round-trip.test.ts`, C9).
  The re-run joins as data, so every tool on main runs each arm, and a
  tool landing later does by joining the table. Arms, each with the
  expectation it pins:
  - CTRL-Z of a re-run: the first close's state and log, positions
    included, and an empty redo stack;
  - an abort before the re-run's first own write, and one after it: the
    first close's;
  - crash recovery in both windows (the marker left open, then
    `recoverInFlightRuns`): the first close's;
  - a rollback to E after a re-run: before any close; a rollback past E:
    the re-run's;
  - a rollback of a turn between E and the re-run, then CTRL-Z: the
    journal gone, then the close undone altogether;
  - a pass above the re-run (`Run now`), then CTRL-Z: the close undone the
    same way;
  - both delete modes after a re-run: `'whole'` before any close;
    `'divider-only'`, then CTRL-Z, the first close's lore with no chapter
    row;
  - a card Save renaming the chapter, a re-run, `'divider-only'`, then
    CTRL-Z: the first close's lore with no chapter row, the rename's
    `user_edit` pruned by the removal below the floor without dropping the
    journal;
  - a second re-run, then CTRL-Z twice: the first re-run's, then the
    first close's;
  - re-running after `merge_threads` and after `merge_happenings` with the
    same tool calls, re-merging the same rows, then CTRL-Z: the first
    close's, with no `held-in-redo` refusal.
- **Unit, `--project unit`.** The files the
  [Acceptance criteria](#acceptance-criteria) name. Every `RunState`
  literal in tests stays valid with the widened `interruptible`; the
  existing reversal suites stay green untouched, which is the proof that a
  reversal with no journal on its branch didn't move.
- **Storybook, browser project.** The confirm, the card's action row and
  the review window's footer.
- **E2E.** `e2e/tests/chapter-close-rerun.spec.ts`, on the seeded hero
  story or a harness-built close, by chapter title and ids read from the
  DB (C8), with the re-run's tool steps scripted on the mock LLM as
  5.10's `chapter-close-auto.spec.ts` scripts them. Read the seed's log
  order first: whether the entries after the latest chapter count as turns
  since depends on their creates sitting above its close group, and the
  seeded tip moves at the first Send. The shortcut case runs first and
  leaves the no-turns case behind it.
- **Mutation check.** Most likely to pass vacuously: the planner's drop on
  a sweep from below (remove it and the turn-between arm must fail), the
  redo clear, newest-first recovery, the forced stale flag, the vec sweep
  on a deleted row, the floor taken from the plan rather than a `MAX` read
  before the transaction, the `'rerun'` guard in `abortRun`, the held
  predicate, the planner's exemption for the chapter row's every delta
  (narrow it to `chapter_close` and the rename arm must fail),
  `refreshSuggestions`' refusal (remove it and leave the strip's disable:
  AC 24 must fail), the commit arm's `rerun` result, and the
  consecutive-positions check. Break each once. Never derive an expected
  count from the code under test.

## Open questions

Each has a default this doc builds on. Slice planning confirms it, and any
change amends the scope above.

- **How does the review bound a re-run's group?** 5.11's
  `loadCloseDeltas` takes a close's range from its `chapters` create to its
  report update, and `deltas` has no `action_id` index. Default: the report
  records `firstLogPosition`, the floor plus one, from the intermediate the
  `reversal` phase parks, and the loader bounds a re-run's group from it.
  C4 lets the report grow, and no migration touches `deltas`. The other
  option: an index on `(branch_id, action_id)` in this slice's migration,
  which reads any group with no bound to get wrong and speeds
  `reverseReplayDeltas` and CTRL-Z's group read, at an index write per
  delta on every burst.

  Settled at planning (2026-11-21): the default, with no index.

- **What bar does the Android measure hold?** Default: 5.5a's hard bar, no
  JS-thread stall over 500 ms, for the reversal's commit and for the
  write-back each, on the Fold's release build, with wall time reported
  beside 5.10's full-group CTRL-Z. 5.2's 1.1 s is the miss that bar
  replaced, so it is the reference, not the bar. A miss reopens how the
  before-images are read and built, not the journal.

  Settled at planning (2026-11-21): no JS-thread stall over 500 ms for the reversal's commit and for the re-run's CTRL-Z, on the dataset seed's close.

- **What does "the group is whole" mean?** Canon has the write-back check
  that the group is whole, and keeps the journal after a divider-only
  removal, which prunes the re-run's report update. Reading "whole" as
  "the report update is present" would refuse every write-back after one,
  leaving a journal no path can use and undoing the close instead of
  restoring its lore. Default: the planner drops the journal on any take of
  the group's other deltas, and the check reads the group's deltas as
  consecutive from the floor with nothing foreign above it. Canon's
  Reverse-replay gains that reading.

  Settled at planning (2026-11-21): the default, with a third drop clause for the group's last remaining delta, and the fallback deletes the journal row.

- **Does a suggestion refresh run during a re-run?** Canon lets one run
  beside a close, and the strip's ⟳ stays enabled while an interruptible run
  holds the gate (`disabled={headReversalBlocked}` in the reader route). Its
  chip delta is `ai_classifier`, logged above the floor, so a ⟳ during a
  minutes-long re-run makes its CTRL-Z undo the close altogether. Default:
  hold ⟳ while a re-run runs, through `refreshHeldByRerun`, which the
  strip and `refreshSuggestions` both read, and canon says so. The other
  option narrows the check to deltas on what the journal covers and to the
  positions it re-inserts, which keeps ⟳ at the cost of a harder check.

  Settled at planning (2026-11-21): no; ⟳ alone is held while `pendingRerun` holds the branch, the catch-up pass included.

- **How does `Re-run…` meet the surface guard from the review window?**
  Canon has the confirm stack over the window, with its `Cancel` returning
  to the review
  ([`chapter-timeline.md → Re-run a close`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#re-run-a-close),
  `Review window`, the stacking line in `Mobile expression`, and the
  wireframe). But a re-run starts a close run, so it goes through the
  registered surface's guard, and the window can be open over a dirty
  pane: `Review changes` is never disabled, and the banner's `Review` opens
  it from any in-story route. The guard's dialog lives in the route's
  tree, and 5.11 keeps it from ever sitting over the window by closing the
  window first on a row press. Default: from the review window, `Re-run…`
  closes the window first, runs the guard, then opens the confirm alone;
  the confirm's `Cancel` reopens the window, and the guard's Cancel leaves
  it closed. From the card, the guard, then the confirm, as `openCloseModal`
  does. If the default holds, this slice's PR edits those canon lines and
  the wireframe. The other option keeps the window open and has the host
  render the guard's dialog, which no slice has designed.

  Settled at planning (2026-11-21): the default; canon and the wireframe are amended.

- **Does the close resolve its model once?** The metadata phase cuts the
  parts from its own settings snapshot (`chapter-close-metadata-call.ts`)
  and the agent phase reads a later one (`chapter-close-agent.ts`), and
  App Settings → Providers (Quick wire, Fetch models) isn't gated during a
  close. A reassignment, or a smaller detected window, between the two
  leaves parts sized for the old window. Parts are at most half that
  window, so only a new window under about half the old one fails, and
  then the first task call fails the close, which rolls back; the next
  run cuts afresh. This slice's re-run arm cuts parts in `metadata` before
  `agent` runs too. Default: `metadata` resolves `CLOSE_TARGET` once and
  parks it beside the parts, and the agent phase reads that. The other
  option accepts the failed close as today. Raised in 5.8's task and slice
  reviews; routed from triage 2026-11-14, whose pass made the target one
  `CLOSE_TARGET`.

  Settled at planning (2026-11-21): the default.

- **What can't be restored?** A re-run whose abort left its reversal
  uncommitted drops the gate (`abortRun`), and a later reversal can then
  drop its journal. If the re-run had written nothing, recovery has no
  journal and no delta to recognise it by, and the first close's report
  stands over lore that's gone. Default: accept it, since it needs a failed
  transaction and then a sweep from below the re-run before the next boot.
  The other option keeps a dropped journal as a void row, which keeps the
  group recognisable at the cost of a canon change to "drops".

  Settled at planning (2026-11-21): nothing silently; a nullable `pipeline_runs.rerun_chapter_id`, written in the reversal's transaction, lets recovery take the fallback.

- **Where does the reversal plumbing live once the re-run calls it?**
  `lib/actions/chapters` imports `commitNewAction` and
  `logReversalRefused` from `../story-entries/operational`, and the
  re-run's reversal would be their third caller. Both are generic
  reversal plumbing. Default: move them under `lib/actions/delta/` in
  this slice, which drops the chapters-on-story-entries dependency.
  Raised in Slice 5.12's final review.

  Settled at planning (2026-11-21): the default.

- **Does the commit arm hold the result at `delta_emitted`, not re-read on
  `run_complete`?** 5.11 re-reads the branch's latest report on
  `run_complete`. The report phase's `delta_emitted` carries `branchId`,
  the chapter id and the report, and arrives after the store patch while
  the run is still registered. Default: keep 5.11's re-read, which the
  arms above build on. The other option holds the result at
  `delta_emitted`. It removes the run, nothing, done gap on the banner
  (about two DB round trips, during which the bar collapses), the
  failed-read fallback's guess and the open-branch guess (`run_complete`
  carries no `branchId`, `lib/pipeline/types.ts:93-103`), at a cost: it
  relies on C4's `close_report`-last write, it replaces the old result
  just before commit, the `actionId` and failed-read tests are rewritten,
  and undo and redo don't emit on that bus. Raised in 5.11's review.

  Settled at planning (2026-11-21): no, the re-read stays; `run_complete` gains `rerun?: true`.

- **What do this slice's re-run arms meet from 5.9?** Two things 5.9
  shipped. First, the later-bump case in
  `lib/pipeline/__tests__/close-round-trip.test.ts` overrides `armExpect`
  and `armLog` for its rollback arms. The undo-own-write substrate (PR
  #746) made a count a counter
  ([`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay)),
  so a rollback past E leaves the reset's 0 and that arm's state override
  went. Its `armLog` override stays, since the bump's undo lowers the
  held copy's count and the merge's prior count, and the rollback to E
  keeps its own, since the turns' bumps go with it. So the re-run arms on
  that case expect canon's counter outcome, and the test's key-list pins
  widen with them. Second, the phase-writes
  rule in
  [`generation-pipeline.md → Writes`](../../../../generation-pipeline.md#writes)
  ("Never: delta-loggable writes outside those two events, delta-log
  appends, …") has no exception for this slice's `reversal` phase, which
  prunes deltas and writes `reversal_journals`. Default: the Writes rule
  gains a carve-out for the `reversal` phase (the other option routes the
  reversal through an event). Raised in 5.9's slice review; routed from
  triage 2026-11-14; the count half reframed 2026-11-15 by the
  undo-own-write design, which retired 3d's count-bump edge.

  Settled at planning (2026-11-21): the default; `FLAG_CASE`'s key pin widens too.

- **What does a confirm say for an `in-flight` refusal?** `removeChapter`'s
  `in-flight` refusal (a run started between the last enabled render and
  the press) closes the chapter-delete confirm with the generic
  `Couldn't delete the chapter.`, where a blocked-while-generating copy,
  or keeping the confirm open, would say what happened; the re-run
  confirm gets the same refusal and is specced to toast a failure and
  close. Default: one answer for both confirms, keeping the confirm open
  with `reader:actions.blockedWhileGenerating` as its message. Raised in
  Slice 5.12's review of Task 12 and its final review (the same entry's
  log-naming edge was fixed in the 2026-11-14 triage pass); routed from
  triage 2026-11-14.

  Settled at planning (2026-11-21): the delete, re-run and reader rollback confirms all stay open on an in-flight refusal, toasting `reader:actions.blockedWhileGenerating` while their confirm action stays disabled with the blocking run's tooltip; only the re-run confirm falls back to that string once no gate reason remains.

- **Does the re-run confirm share the settle re-read?** The re-read effect
  in `components/chapters/use-chapter-delete-confirm.ts` repeats
  `components/reader/use-live-rollback-counts.ts`'s shape: a
  `settleCount` subscription, a ref holding the host's callbacks, a guard
  on the counted settle and a `live` flag. They differ in the skip while a
  removal runs, in how a refusal lands (close with a toast, or keep and
  log) and in their log events, so a shared hook would take each as a
  parameter, and would need a home outside both domain folders. This
  slice's `useCloseRerunConfirm` is specced as a third copy. Default:
  extract the shared hook into `hooks/` with the third copy. Raised in
  Slice 5.12's slice review (the simplifier pass); routed from triage
  2026-11-14.

  Settled at planning (2026-11-21): only the shared settle effect is extracted, as `useSettleReread` in `hooks/`.

- **Does the review window animate its close?** `ChapterOverlaysHost`
  unmounts `ReviewWindow` as soon as the review id clears, so the Sheet on
  phone vanishes in one frame, skipping its slide-out (the web Dialog has
  no exit animation at all, so desktop is unchanged either way). A fix
  keeps the window mounted with `open={false}` through its exit, which has
  to agree with the host's prune of a chapter that no longer holds; this
  slice reworks that host's close-and-reopen lifecycle. Default: keep it
  mounted through the Sheet's exit as part of that rework. Raised in
  5.11's review; routed from triage 2026-11-14.

  Settled at planning (2026-11-21): yes, here.

- **Does `regenerateTurn` require its expected counts?**
  `regenerateTurn(…, opts?: { expectedCounts?: RollbackCounts })`
  (`lib/actions/turns/regenerate-turn.ts`) predates Slice 5.12, which
  made the reader route pass counts on every call, so a close committing
  as the interrupt lands is refused rather than reversed unconfirmed. A
  new caller that leaves them out still compiles and sweeps with no
  consent check. Requiring them fits
  [Type design](../../../../code-conventions.md#type-design), as
  `rollbackToEntry` already does; the internal follow-up sweep
  (`sweepFrom(…, origin.id, ctx)`) legitimately has none. This slice
  edits `regenerateTurn`. Default: require them, the 33 test calls
  reading counts from the preview first (some are concurrency tests, so
  each needs its interleaving checked). Raised in Slice 5.12's slice
  review; routed from triage 2026-11-14.

  Settled at planning (2026-11-21): its opts become required as `{ expectedCounts: RollbackCounts | undefined }`, an explicit `undefined` opting out, after `startCloseChain`'s overload.

## Implementation notes

- **The confirm's counts are taken as after the shortcut (developer
  decisions at PR 2's review).** The preview leaves out only the deltas
  both the re-run's set and the shortcut's set hold (by delta id, not
  row), judges survivors and ref clears with the shortcut's deltas
  treated as reversed (an optional `reversedFirst` input that only the
  preview passes), and counts a close-created lore row whose delete the
  shortcut reverses. The closure's own reads stay on the state before
  the shortcut; that gap is parked
  ([`parked.md → A re-run confirm's counts read before its shortcut`](../../../../parked.md#a-re-run-confirms-counts-read-before-its-shortcut)).
- **Recovery's order stays as canon has it (developer decision at PR
  1's review).** When a newer orphan's reversal fails without
  committing, an older re-run on its branch can lose its close for
  good, or an older pass's work can come back on a later boot; that is
  parked with its fix
  ([`parked.md → Recovery order after an orphan's failure on a re-run's branch`](../../../../parked.md#recovery-order-after-an-orphans-failure-on-a-re-runs-branch)).
- **The abort's outcome rides a new port member.** Abort and recovery
  call `reverseRunGroup` (`lib/actions/delta/rerun-journal.ts`), which
  reads the run's group, writes the journal back or takes the fallback,
  and reverses any other group as `reverseReplayDeltas` does; it returns
  the delta count with the journal's outcome and hands `settleOps` a
  boolean. `reverseReplayDeltas` keeps `Promise<number>` and no
  write-back, for `submitTurn` (the Scope's abort bullet, which names it,
  predates the split).
- **A committed reversal whose store sync fails keeps its outcome.**
  CTRL-Z of a re-run whose close was undone shows the close-undone
  warning even when only the store sync failed, and a recovery failure
  whose reversal committed with the close undone renders as the
  reversed close does (canon's chapter-close line plus the close-undone
  line; provisional).
- **The planner reads a journal's group only when the set takes from
  it,** so a branch holding a journal doesn't scan its log on every
  reversal; reads by `action_id` still scan, filed to triage.
- **The review window's phone Sheet holds a reopen until its exit
  ends (provisional).** The shared `Sheet` drops a `present()` sent
  while it is still dismissing, so the confirm's `Cancel` during the
  slide-out reopens the window only once `onDismissed` fires; the host
  marks an exit only for a Sheet that presented. The primitive's gap
  is in triage for its other users.
- **For M6.1:** recovery finds a journal by `action_id` alone, and the
  run-group read has no branch filter; both are unique in M5 and need
  `(branch_id, id)` scoping once a fork copies journals with their
  groups. The `reversal_journals` fork row in `data-model.md` still
  keys on the group's first log position; the shipped write-back
  measures from the floor (the first position is the floor plus one).
- **Redo stays one stack until M6.** Canon now rules a stack per
  branch; a re-run's CTRL-Z clears today's single stack.
- **Monitors.** The planner's drop clause (b) never dropped a journal a
  round-trip arm keeps, so it stays as planned. The round trip grew
  from 264 to 610 tests (about 6 s to 18 s locally); CI's unit shards
  stayed inside main's recent range, so the file is not split.
- **The Android measure (AC 34) is pending:** no Fold was attached
  during the run. The functional smoke ran on a slot emulator. When it
  runs it adds a many-journals case (developer decision at the slice
  review): every reversal reads each journal row on its branch
  (`reverse-replay.ts`, `journalHeadsOf`), so it also times a reversal
  on a branch holding 30, then 100, committed re-run journals the size
  of the dataset close's, beside the review's desktop benchmark (30
  journals of 230 KB: 5.8 ms a reversal; 100: 18.5 ms; 30 of 920 KB:
  29.9 ms). The schema keeps no `chapter_id` or `floor` column until
  that measure asks for one.
- **A re-run whose own undo fails holds its branch until restart
  (developer decision at the slice review).** A Cancel, failed call or
  interrupting head reversal whose reversal doesn't commit leaves the
  re-run's writes, journal and open marker for boot recovery, and any
  write to the branch before then could turn the write-back into an
  undone close. The run's end sets `heldBranches` in the generation
  store (in memory, so the restart drops it), and the edit gate, head
  reversals, every run start, a reversal past its interrupt, Send and
  the re-run's start all refuse; the branch's controls and the notice
  (`chapters:rerunNotice.unreversed`) say a restart restores the close.
  A pass's or a close's failed abort still lifts its gate, and a failed
  completed-marker write stays as triage files it.
- **The re-run's CTRL-Z confirm names an undone close (same review).**
  `readUndoImpact` runs the write-back's own decision (`closeUndoneBy`,
  the read-only half of `rerunWriteBack`) and the confirm adds a line
  when the earlier close can't be restored; the warning after the undo
  stays for a state that changes past the confirm.
- **The start pre-flights a catch-up pass (same review).** Under the
  mark and before the sweep, when an entry through the chapter's end is
  unprocessed (`unprocessedThroughChapter`, the chain's own count), the
  memory pass's pre-flight runs, and its failure resolves
  `preflight-failed`; the host toasts the memory pass's settings copy,
  since the close's names the lore agent.
