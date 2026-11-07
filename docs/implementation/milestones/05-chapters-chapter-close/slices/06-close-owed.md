# Slice 5.6 — A close owed: chain, Send, failure

## Metadata

- **Milestone:** [Milestone 5: Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.1](./01-token-measure.md) (`openRegionSeries`,
  `canEndChapter`), [Slice 5.2](./02-first-chapter.md) (the
  `chapter-close` pipeline, `pendingClose`, `startManualClose`)
- **Blocks:** [Slice 5.10](./10-two-starts.md),
  [Slice 5.12](./12-chapter-delete-rollback.md)
- **Contracts:** consumes
  [C2](../milestone.md#c2--pipeline-shape),
  [C5](../milestone.md#c5--token-reads-and-the-progress-hook),
  [C10](../milestone.md#c10--what-a-chapter-may-end-on) and
  [C14](../milestone.md#c14--the-manual-start-and-pendingclose); provides
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts)'s store field,
  mutator and labels, beside [Slice 5.5a](./05a-task-runner.md)'s event

## Goal

A close becomes work a branch owes, not a dev-route action. A turn that
crosses the threshold chains catch-up passes and a close on the no-model
boundary, Send runs any close owed before the turn, and a failed,
cancelled or interrupted close comes back at the next Send. CTRL-Z of the
turn interrupts a running close, and the banner, pill, toasts and system
entries say what happened.

## Background

[Slice 5.2](./02-first-chapter.md) leaves a close that runs when a dev
route starts it, on a branch with nothing to catch up. A close already
declares `interruptible: 'close'`, so `interruptMemoryRuns`, the deferral
record, `run_deferred` and its toast, the pill, the gate copy and crash
recovery work unchanged. What's missing is owing it: `closeOwed`, the
chain, and a Send that reads a whole chain where today it reads one run.
The failure surfaces all key on the pass and need a close's half. Canon's
`nextMemoryRun` can't be built as written, because its guard stops the
chain phase 0 needs; this slice moves the guard, and
[Open questions](#open-questions) names that and the other decisions
canon leaves open.

## Required reading

- [`generation-pipeline.md → chainsTo on predecessor`](../../../../generation-pipeline.md#chainsto-on-predecessor):
  `nextMemoryRun`, `closeOwed`, and Work deferred to the next Send.
- [`generation-pipeline.md → Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate):
  `deferred`, `pendingClose`, and who writes them.
- [`generation-pipeline.md → Chained transition`](../../../../generation-pipeline.md#chained-transition--no-user-edit-window):
  `startPipeline`'s `origin` and `chain`, and the one-tick swap.
- [`generation-pipeline.md → Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation):
  the surfacing rule for a close.
- [`generation-pipeline.md → Prose reversals and the interrupt`](../../../../generation-pipeline.md#prose-reversals-and-the-interrupt).
- [`memory/chapter-close.md → Phase 0`](../../../../memory/chapter-close.md#phase-0--catch-up-passes),
  [`Phase 1`](../../../../memory/chapter-close.md#phase-1--boundary-selection)
  (the fallback) and
  [`Failure modes`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback).
- [`memory/classifier.md → Failure policy`](../../../../memory/classifier.md#failure-policy)
  and [`Pipeline framing`](../../../../memory/classifier.md#pipeline-framing):
  the pass's surfaces, which a close mirrors.
- [`reader-composer.md → During a memory update`](../../../../ui/screens/reader-composer/reader-composer.md#during-a-memory-update),
  [`Transient pipeline failures`](../../../../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  and [`Custody of the turn's text`](../../../../ui/screens/reader-composer/reader-composer.md#custody-of-the-turns-text).
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation),
  with [`Affordance loci`](../../../../ui/principles.md#affordance-loci)
  for the banner.
- [`generation-status-pill.md → Memory phases`](../../../../ui/patterns/generation-status-pill.md#memory-phases).
- [`milestone.md → C2`](../milestone.md#c2--pipeline-shape),
  [`C5`](../milestone.md#c5--token-reads-and-the-progress-hook),
  [`C6`](../milestone.md#c6--what-the-banners-n-of-m-counts),
  [`C10`](../milestone.md#c10--what-a-chapter-may-end-on) and
  [`C14`](../milestone.md#c14--the-manual-start-and-pendingclose).
- [`lessons-learned/no-harmless-id-leaks.md`](../../../lessons-learned/no-harmless-id-leaks.md)
  for the records' prune.

## Scope: in

**Chain,** in `lib/pipeline/definitions/memory-chain.ts`.

- `closeOwed(branchId, story, ctx)`, exported: a pending record, else
  `chapterAutoClose` and one `openRegionSeries` read, taking the sum
  against `chapterTokenThreshold` and `.some(canEndChapter)`.
- `nextMemoryRun`'s close branch, returning the pass or the close kind.
  A held branch, its classifier status `running`, chains nothing in any
  arm, since a pass or a close would build on the held pass's unreversed
  writes. Otherwise, with a close owed: the pass while entries are
  unprocessed, the close once none are. With none owed, today's cadence
  rule. Canon's sample returns the close on a held branch, over
  unclassified prose, which
  [Phase 0](../../../../memory/chapter-close.md#phase-0--catch-up-passes)
  forbids.
- The `deferred` guard moves off `nextMemoryRun` onto per-turn's
  `chainsTo` (`per-turn.ts:582`), the one chain its reason applies to: a
  regenerated reply doesn't bring interrupted work straight back.
- The pass declares `chainsTo`: `nextMemoryRun` while a close is owed,
  nothing otherwise, and nothing when it was started alone.
- `runClassifierNow`, which serves Retry and Run now, starts the pass
  alone, with `inputs: { alone: true }`. `memory-chain.ts` exports the
  shape as `PassInputs` and reads it with `passStartedAlone(run)`.
  `alone` stays out of `PipelineInputMap`, whose entries would make
  every pass start pass `inputs`.

A chain can't spin. A pass over a non-empty window always advances the
watermark (`advanceWatermark` in `periodic-classifier.ts`), and `unprocessedEntryCount`
counts only rows a window holds, so no progress guard is needed.

**The end entry.**

- `fallbackChapterEnd(series)` in `lib/chapters`, pure, beside
  `canEndChapter`: the latest `ai_reply` before the head, else the head
  if it's an `ai_reply`, else null. 5.10's Phase 1 falls back to this
  same function.
- `boundary` takes the record's end when a record stands and the
  fallback otherwise, where 5.2 fails the phase. A record whose entry
  isn't an open-region reply still fails as `phase-logic`, and now
  drops, so the next Send owes nothing on it.

**Records.** `pendingClose` holds a manual pick only, typed
`{ endEntryId: string }`. Canon's `null` end goes, since no record
already means boundary selection. An auto close stays derived, read
fresh by `closeOwed` each time, so a rollback below the threshold
leaves nothing stale.

| Event                            | `pendingClose` | `deferred.close` |
| -------------------------------- | -------------- | ---------------- |
| Manual start                     | written        | unchanged        |
| A close commits                  | cleared        | cleared          |
| Close cancelled or interrupted   | stays          | recorded         |
| Close or catch-up pass fails     | stays          | unchanged        |
| `boundary` meets a stale record  | dropped        | unchanged        |
| Send reads no close owed         | none to clear  | cleared          |
| A reversal removes the end entry | dropped        | unchanged        |
| Restart                          | gone           | gone             |
| Story delete                     | dropped        | dropped          |

- 5.2's `finishRun` already drops the record at a close's commit, and a
  failed or aborted close keeps it. The rest of the table is this
  slice's.
- `bracketProseReversal` takes `ctx`. Once its body ends, thrown or not,
  it reads whether the record's entry still exists and drops the record
  when it doesn't. A failed read logs and keeps the record, and
  `boundary` catches what's left. Undo, redo, rollback, a head edit and
  regenerate all pass through it.
- Two store methods, neither driving a run:
  `clearDeferredClose(branchId)` clears a branch's `deferred.close` for
  Send, and `dropBranchRecords(branchId)` drops a branch's `deferred`
  and `pendingClose` for a delete.
- `setPendingClose`, `clearPendingClose`, `clearDeferredClose`,
  `dropBranchRecords` and `setCloseProgress` join the
  `no-restricted-properties` list in `eslint.config.js`. A block for the
  record writers (`lib/actions/chapters/**`, `boundary`,
  `memory-chain.ts` and `delete-story.ts`) lets them write records, but
  neither drive a run nor set a close's progress.
- `deleteStory` drops both records for each of the story's branches
  (`lib/actions/stories/delete-story.ts`). No branch-delete action exists
  yet, so that half lands with the action, on the same store method.

**Manual start,** in `lib/actions/chapters/`.

- `startManualClose` drops its unprocessed refusal and keeps the others.
  It reads `settleCount` first, then `held`, its end and the unprocessed
  count, then runs 5.2's tail: the swap and busy checks, a check that
  `settleCount` hasn't moved, the record's write and the start, with no
  await between them. The start is a pass when entries are unprocessed,
  the close otherwise. A start while a turn is in flight refuses
  `story-busy`, and so does one whose reads a run's settle overtook: a
  pass that turned held between the held read and the tail, its
  reversal not yet committed, would otherwise get a pass or a close
  started over its writes.
- The reads, the tail and the start live in `startCloseChain`
  (`lib/actions/chapters/close-chain.ts`), which a close entry's Retry
  shares. The manual start passes its end check as `validate`, run after
  the held check so the refusal order stands, and the record's write as
  `onReserved`.
- The tail calls `startPipeline` directly, after ensuring registration,
  never `runClassifierPass`. That starter awaits `isClassifierHeld`
  inside the tick (`classifier-pass.ts:21`), so a queued Send could
  read the record and start its pass, and this start's rejection would
  then remove the record under Send's chain and lose the pick.
- A second pick overwrites the first. A rejected start writes nothing,
  since the record is written only as the run reserves, so what stood
  before stays.
- The action resolves with the chain's end, per C14: the last run's
  `TxResult`, not the first pass's, or `RejectedStart`. 5.10 adds
  `{ outcome: 'preflight-failed', error }`.

**Send.**

- `owedPassAtSend` becomes `owedWorkAtSend`, returning `'held'`, `'pass'`,
  `'close'` or null. In order: held; on the open branch, `closeOwed`,
  clearing `deferred.close` when it reads false; `'pass'` for a deferred
  pass, a close owed with entries unprocessed, or the cadence; `'close'`
  for a close owed with none unprocessed. Off the open branch only a
  deferred pass counts, as today.
- `submitTurn` starts one chain, which reaches an owed close by itself,
  so Send's owed work runs at most one close before the turn. The
  turn's own chain may close again after it (see
  [Open questions](#open-questions)).
- `PipelineStart.chain` resolves to the chain's end and still never
  rejects: `ChainEnd`, `{ kind, result, cancelled }` for the last run
  that ran, the origin included, and null only when the origin was
  refused or threw. An unwound successor reads as failed with an
  `orchestrator` error. `cancelled` reports a run whose abort had fired
  by its end. `driveSuccessors` returns it.
- `runPipeline` stays as it is, returning the origin's result, which
  spares about 85 call sites. `submitTurn`, `startManualClose` and a
  close entry's Retry call `startPipeline` and read `.chain` beside
  `origin`, which still carries a refusal and rejects on a throw.
- `commitRun` in `orchestrator.ts` stops clearing `beforeTurn`, so a successor under
  Send is Send's: `findSendRun`, the composer's Cancel, the pill, the
  banner and `run_complete` all read it so.
- `SubmitTurnResult`'s owed arms carry `work: DeferredWorkKind`, from the
  run that ended the chain, and Send cancels or fails on any run of the
  chain, not only its origin. A Cancel landing after a run's last phase
  still ends the Send: the orchestrator commits that run, and Send reads
  a `completed` end with `cancelled` as aborted. `passRefusalOf` and the
  route's arms in `app/reader-composer/[branchId].tsx` read
  `work`.

**Interrupt and undo.**

- `undoLastAction`'s pre-check in `undo.ts` reads its target past the
  running close's rows, by the `actionId` of `selectMemoryRun`. The
  re-read in `undoBracketed` needs no change: the close has reversed by then,
  and a close whose reversal failed is still the head and refuses.
- One test pins the second interrupt order. No code changes: the race
  note is stale, since the abort and the swap each land in one tick.

**Banner and pill,** per C6.

- `RunState.closeProgress`, `{ task, part, index, total }`, set by a new
  `generationStore.setCloseProgress(runId, progress)`, which `handleEvent`
  calls by `run.runId` before forwarding `close_task_start`. It joins the
  restricted list in `eslint.config.js` (`CLOSE_PROGRESS_MUTATORS`) and
  `lib/stores/__tests__/generation-mutators-lint.test.ts`. The event joins
  `PhaseEmittedEvent` here if this slice lands before 5.5a.
- `useMemoryRunBanner` returns a banner for a close, from the run's
  `currentPhase` and `closeProgress`.

| Run                       | Label                                      |
| ------------------------- | ------------------------------------------ |
| `beforeTurn`, any phase   | `Closing chapter before your turn…`        |
| Phase `boundary`          | `Closing chapter: choosing where it ends…` |
| Phase `metadata`          | `Closing chapter: writing its summary…`    |
| Phase `agent`, no task    | `Closing chapter: reviewing the chapter…`  |
| Phase `agent`, task began | `Closing chapter: 3 of 7 — Identity…`      |
| Phase `report`            | `Closing chapter: finishing up…`           |
| No phase named yet        | `Closing chapter…`                         |

- Canon pins the count and before-turn labels; the rest are this slice's.
  All go in `locales/en/common.json` under `chrome.memoryBanner`, with a
  name for each of the seven tasks. Phase 0's passes keep the pass's
  labels, `Updating memory before your turn…` under Send.
- `phaseCopy` gains the before-turn arm at
  `generation-status-pill.tsx:66-73`, reading
  `closing chapter before your turn…`.
- The test at `memory-run-banner.test.tsx:112-123` flips.

**Failure.**

- `describeCloseFailure` and `toCloseFailureMeta` beside the pass's in
  `components/reader/system-entry-actions.tsx`, with `close: 'failed'` on
  the meta and the close's own wording per cause: provider, resolver
  through a `CLOSE_RESOLVER_COPY` record, `reply-cut-off`,
  `context-window`, and generic. `closeCutOffContent` and
  `closeContextWindowContent` join their files.
- `capabilityHintContent` gains a `'close'` surface, with
  `closeCapabilityHint` keys for `reasoning`, `structuredOutput` and
  `toolCalling`. The copy cites no tool badge, which is M7.1's.
- **A close that fails a Send** writes the entry with the pass's custody
  rules and `held: false`: the text goes back to an empty composer, else
  onto the entry.
- **Retry on a `close: 'failed'` entry** holds the dispatch until the
  chain ends. A held branch refuses first, as a Send does, so it never
  settles as nothing owed. With no close owed any more it settles as a commit.
  Otherwise it starts a pass or the close, as the manual start does, and
  it isn't alone. A commit clears the entry as a pass's Retry does, its
  notice `closeResolvedEntry` with `close: 'resolved'` and no Retry. A
  failure rewrites the entry, a failed catch-up pass as a memory entry. A
  cancel leaves it, and a refused start tells the user why.
- A close entry of kind `config-resolver` offers its fix, `Retry` and
  `Dismiss`, as a turn's and a pass's do. Canon's five broken-reference
  [rows](../../../../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  gain `Retry` after their fix: Retry after the fix is one click, and
  one before it fails again harmlessly.
- **Outside a Send,** a failed close shows `chrome.chapterCloseFailed` as
  a warning toast in `hooks/use-memory-run-toasts.ts`, reading
  `Chapter close failed. It runs again before your next turn.` It writes
  no entry, as a pass's failure doesn't: the next Send fails on the same
  cause and writes the entry, with its fix and the turn's text.

**Docs,** in the slice's PR.

- Flip `MemoryRunBanner`'s row in `docs/ui/component-inventory.md`.
- Canon, as [Open questions](#open-questions) settles:
  `generation-pipeline.md`'s guard, sample, `run_complete` and
  `beforeTurn` comments, the stale `records … or clears` line in Run
  state transitions, `startPipeline`'s `chain`, who clears `deferred`,
  `PendingClose`'s type, and Config pre-flight validation's Surfacing
  line, which with `chapter-close.md → Tool calling` raises a close's
  entry when it fails a Send or a click; C14's record line in
  `milestone.md`; a **Nothing left to close** on-Retry row in
  `reader-composer.md`, whose five broken-reference rows gain `Retry`
  after their fix; and `principles.md`'s exceptions to head reversals
  passing through, which name only a Retry's pass though the mark at
  `isHeadReversalBlocked` in `generation.ts` also refuses them during a Send's owed work,
  minutes long for a close. `generation-status-pill.md` already says a
  toast, and stays.
- `useConfigFixAction`'s comment: a config failure routes to settings
  and keeps Retry beside the fix.
- A `parked.md` entry under
  [UX (parked)](../../../../parked.md#the-deferral-toast-can-promise-a-close-that-never-runs): the deferral toast can
  promise a close that never runs, once the interrupting reversal
  removes a manual end entry or drops the region below the threshold.

## Scope: out

- The model boundary, Phase 1's candidates, the modal, the `toolCalling`
  flag, its click pre-flight and the hint's arm that needs the flag
  ([Slice 5.10](./10-two-starts.md)).
- `Close chapter…`, its availability predicate and `Ready to close`
  ([Slice 5.10](./10-two-starts.md)). A dirty pane is routed there too.
- `close_task_start`'s emission and the tasks behind `N of M`
  ([Slice 5.5a](./05a-task-runner.md),
  [Slice 5.8](./08-prose-tasks.md),
  [Slice 5.9](./09-chapter-wide-tasks.md)). Until 5.5a lands a close
  shows only the phase labels.
- `Chapter closed: <title>` and its stopped-early toast
  ([Slice 5.11](./11-review-window.md)).
- The rollback preview under a running close and regenerate's close arm
  ([Slice 5.12](./12-chapter-delete-rollback.md)).
- `openRegionSeries`, `useChapterProgress` and the strip
  ([Slice 5.1](./01-token-measure.md),
  [Slice 5.3](./03-reader-chapters.md)).
- The capability hint's keywords, its type and the turn and pass keys
  ([Slice 5.4](./04-tool-step.md)).
- `Set window` on a close's entries, the tool badge and the `lore-mgmt`
  warning (M7.1). A close's turn capture anchor (M7.3).
- A branch-delete action, with its prune call, which nothing has
  scheduled yet.
- `raiseSystemEntry`, a writer that patches `entriesStore`, with its
  first caller, the click pre-flight
  ([Slice 5.10](./10-two-starts.md)). No entry is written outside a
  Send here, so `run_complete` gains no `branchId`.
- Withdrawing a manual close, and the turn's chain skipping a close its
  Send ran: both open in
  [Slice 5.10's Open questions](./10-two-starts.md#open-questions).

## Acceptance criteria

**Chain,** in `lib/pipeline/definitions/memory-chain.test.ts` unless
named.

- `closeOwed` is true for a pending record with auto-close off, false
  over the threshold with auto-close off, false over the threshold on
  `[opening]` and `[opening, user_action]`, and true at exactly the
  threshold with a reply in the region.
- `nextMemoryRun` returns the pass, the close, null on a held branch
  with entries unprocessed and with none, and today's cadence result
  with no close owed.
- A pass holding its own `deferred.pass` chains on with a close owed, a
  `{ close: true }` record doesn't stop a catch-up pass, and per-turn
  chains nothing while either record stands.
- A close owed over a three-window backlog runs pass, pass, pass, close,
  each with its own `actionId`, in
  `lib/pipeline/__tests__/chained-and-parallel.test.ts`.
- A failed or cancelled catch-up pass starts no close, in the same file.
- A pass from `runClassifierNow` with a close owed chains nothing, in
  `lib/actions/classifier/run-now.test.ts`.

**End entry.**

- `fallbackChapterEnd` in a `lib/chapters` test: `[u5, r5]` after a
  closed chapter gives `r5`, `[r1, u2, u3]` gives `r1`, `[r1, u2, r2]`
  gives `r1`, and `[opening, u1]` gives null.
- A test beside `chapter-close-boundary.ts`: `boundary` takes a standing
  record over the fallback, takes the fallback with none, and a stale
  record drops and fails the close.

**Records.**

- `lib/stores/generation/generation.test.ts` covers the rows the store
  owns: a close's commit, abort, failure and unwind. It also tests the
  two store methods alone, and proves `setCloseProgress` publishes a new
  copy of the run to a store subscriber, as a `useGeneration` reader
  needs. The other rows are tested where they happen, below and under
  `boundary` above. A restart has nothing to observe, since both
  records are in memory.
- `lib/stores/__tests__/generation-mutators-lint.test.ts` flags the five
  record and progress mutators from a component, and lets a record
  writer write records but not drive a run.
- `lib/actions/story-entries/prose-reversal.test.ts`: a body removing the
  end entry drops the record, a body sparing it keeps the record, a body
  that throws after removing it still drops it, and a failed read keeps
  it.
- `lib/actions/stories/delete-story.test.ts`: no record survives for the
  deleted story's branches.
- A `lib/actions/chapters` test: a manual start with entries unprocessed
  runs a pass first and closes at the picked entry, a second pick
  overwrites, and a rejected start leaves what stood before. A Send
  racing the start leaves the pick in place. When a pass commits and the
  close behind it fails, the action resolves `failed`, with the close's
  `TxResult`. A start during an in-flight turn refuses `story-busy`, and
  a pass that turns held between the start's held read and its tail is
  refused `story-busy`, not started.

**Send,** in `lib/actions/turns/__tests__/deferred-send.test.ts`.

- A deferred close, a deferred pass and close, and a close owed with no
  record, as after a failed close, each run before the `user_action`.
- A close record with no close owed clears, runs nothing, and the turn
  lands.
- With the region still over the threshold after Send's close commits,
  exactly one close runs before the `user_action`. The turn's own chain
  may close again after it.
- A successor close that fails returns `outcome: 'failed'`,
  `beforeTurn: true`, `work: 'close'`, with no `user_action` written. A
  failed catch-up pass returns `work: 'pass'` and starts no close.
- A cancel of a successor returns `outcome: 'aborted'`, `beforeTurn: true`,
  and its record stands. A Cancel landing after a pass's last phase
  returns `aborted` too, with no `user_action`.
- After CTRL-Z of a committed auto close, the next Send runs the close
  again before the turn.
- `components/reader/send-run.test.ts`: `findSendRun` finds a successor
  under Send, and `cancelComposerRun` cancels it on the first press.
- `lib/pipeline/__tests__/chained-and-parallel.test.ts`: the three tests
  at `:256`, `:321` and `:346` flip. A chain that commits resolves to its
  last run, an origin alone to the origin, a refused origin to null, an
  unwound successor to a failed end, and a run committed after its abort
  fired reports `cancelled`. `runPipeline` still returns the origin's
  result.

**Interrupt and undo.**

- `lib/actions/story-entries/undo-classifier.test.ts`: CTRL-Z of the turn
  under a running close that has written deltas interrupts it, reverses
  it, records `deferred.close`, and reverses the turn. A close whose
  reversal failed refuses as `gated`.
- `lib/actions/story-entries/undo.test.ts`: a committed close stays the
  first undo target and the turn the second.
- `lib/pipeline/__tests__/chained-and-parallel.test.ts`: an interrupt
  landing after the swap aborts the close at `driveRun`'s top, skips
  pre-flight, and records `deferred.close`.

**Surfaces.**

- `components/compounds/memory-run-banner.test.tsx` covers each row of
  the label table, and the last task's label standing until `report`.
- `lib/pipeline/__tests__/orchestrator.happy.test.ts`: a phase yielding
  `close_task_start` sets `closeProgress` on the stored run and forwards
  the event.
- `generation-status-pill.stories.tsx` and `memory-run-banner.stories.tsx`
  show the close's before-turn labels.
- `hooks/use-memory-run-toasts.test.tsx`: a failed close toasts once
  outside a Send and stays quiet under one, a chained one included.
- `components/reader/system-entry-actions.test.tsx`: a close's copy for
  each cause; Retry's commit, failure, cancel, refusal and nothing-owed
  arms; Retry on a `config-resolver` close entry, none on a resolved
  one.
- `resolver-failure-copy.test.tsx`, `cut-off-copy.test.ts` and
  `context-window-copy.test.ts` cover the close's arms, the capability
  hint's `close` surface included.

**End to end,** `pnpm test:e2e -- chapter-close-owed`, asserting the DB:

- A turn over a lowered threshold chains a close whose failed metadata
  call shows the toast and leaves no `chapters` row. The next Send fails
  with its text back in an empty composer, `Retry` writes the row, and
  the entry clears.
- A Send cancelled during its owed close writes no `user_action` and
  puts back the entry it cleared.
- The banner's Cancel moves a held close to the next turn with its toast,
  and the next Send runs it first under the before-turn label.
- CTRL-Z of the turn during a held close leaves no `chapter_close` delta
  and no chapter.

**Hygiene.** `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm compiler:check`, `pnpm lint:docs` and `pnpm test:run` pass, and the
E2E suite stays green with auto-close now live. The inventory's
`MemoryRunBanner` row describes a close's banner and names no milestone.

## Tests

- **Vitest, unit project,** for everything under `lib/` and the pure
  reader helpers: the bulk of the slice. Chain and record tests use a
  stand-in close beside `lib/actions/turns/__tests__/stand-in-pass.ts`,
  since the close's content isn't this slice's.
- **Component tests** for the banner hook and the toast hook, as they
  stand today.
- **Storybook** for the banner's and pill's close labels, and the system
  entry's close variants in `entry-card.stories.tsx`.
- **E2E,** one file, `e2e/tests/chapter-close-owed.spec.ts`, on 5.2's
  metadata mock shape, with `holdNextStructured` for the interrupts and
  a seed helper lowering `chapterTokenThreshold`. Its groups follow
  the periodic classifier's gated pass and failure policy
  (`periodic-classifier-gated.spec.ts`,
  `periodic-classifier-failures.spec.ts`).
- **Mutation check** on `closeOwed`'s arms, the moved guard,
  `passStartedAlone`, the chain's end and the manual start's
  `settleCount` guard: a guard here can stay green while doing nothing.

## Open questions

Resolved at slice planning on 2026-11-07, except the two routed to
[Slice 5.10](./10-two-starts.md#open-questions). Canon follows each
answer in this slice's PR.

- **Can the chain guard stay in `nextMemoryRun`?**
  **Resolved (2026-11-07):** no. It moves to per-turn's `chainsTo`;
  Send starts a pass first, and the pass chains to the close.
- **Who clears a close record?**
  **Resolved (2026-11-07):** a commit, and Send through
  `clearDeferredClose` when `closeOwed` reads false.
- **What is a manual pick's lifecycle?**
  **Resolved (2026-11-07):** the [Records](#scope-in) table.
  `PendingClose` drops `null`, and canon's type and C14 follow.
- **Can the user withdraw a manual close?**
  **Routed (2026-11-07)** to Slice 5.10's Open questions. Cancel defers
  it, as canon says.
- **Do Retry and Run now chain a close?**
  **Resolved (2026-11-07):** no. Both start the pass alone, and the
  close stays owed for Send.
- **Is a Send's chain all Send's?**
  **Resolved (2026-11-07):** yes. `beforeTurn` carries to successors,
  which flips three tests and canon's comments.
- **Where does a close's failure show outside a Send?**
  **Resolved (2026-11-07):** a toast only, as for the pass.
  `raiseSystemEntry` moves to Slice 5.10, whose click pre-flight is its
  first caller, and canon raises a close's entry when it fails a Send
  or a click.
- **A turn's `config-resolver` entry offers Retry.**
  **Resolved (2026-11-07):** turn, pass and close entries keep `Retry`
  beside their fix, and canon's five broken-reference rows gain it.
- **What does a manual start hold?**
  **Resolved (2026-11-07):** no queue, mark or admission: 5.2's
  one-tick tail, with the `settleCount` guard.
- **Do the toasts promise too much?**
  **Resolved (2026-11-07):** canon's copy ships. The gap is parked under
  [`parked.md → The deferral toast can promise a close that never runs`](../../../../parked.md#the-deferral-toast-can-promise-a-close-that-never-runs) until a
  tester expects that close.
- **Should an undone close come back?**
  **Resolved (2026-11-07):** yes, at the next Send, pinned in
  `deferred-send.test.ts`.
- **How often can a close run?**
  **Routed (2026-11-07)** to Slice 5.10's Open questions. Send's owed
  work runs one close, and the turn's chain may run another.
- **Do `closeOwed`'s fixtures hold real counts?**
  **Resolved (2026-11-07):** a threshold-bound test seeds real counts
  through `openCloseFixture` or sets `contentTokens`. The three
  fixtures stay as Slice 5.1 left them.
- **Should writes to `pendingClose` be restricted?**
  **Resolved (2026-11-07):** yes. The five record and progress mutators
  join `no-restricted-properties`, exempt only in their writer files.
- **Does the manual start re-check held and a turn in flight in its
  tail?**
  **Resolved (2026-11-07):** a turn in flight refuses `story-busy`, and
  a `settleCount` read before the held read refuses `story-busy` in the
  tail when a run settled in between.

## Implementation notes

- **A Cancel during a Send's owed work (developer decision,
  2026-11-07).** Once any of the Send's owed work has committed, a
  Cancel leaves the failure entry the Send cleared dropped; only a
  Cancel before anything committed puts it back. Both end the Send
  before its turn and hand its text back (an empty composer, else the
  draft-kept toast). That covers a Cancel landing after a run's last
  phase, which commits the run and chains nothing, and a Cancel of a
  chained close after its catch-up pass committed. The code is
  `committed` on `OwedWorkAborted`, set when the Send's first owed run
  completed (a chain continues only past a commit), read by
  `abortedBeforeTurn`. The planning default had put the entry back on
  every owed-work Cancel.
- **The resolved close notice reads "Nothing is left to close before
  your turn." (provisional, 2026-11-07).** One notice serves both a
  Retry whose close committed and one that found nothing owed, since
  "Chapter closed." is false in the second; a committed close is still
  announced by its `Chapter closed: <title>` toast. **Provisional:**
  the alternative left open is two notices, "Chapter closed." when the
  Retry's own close committed and "Nothing left to close." when none
  was owed.
- **The manual start resolves the chain end's `TxResult` (C14), a
  completed catch-up pass included (2026-11-07).** A late Cancel after
  the pass's last phase, or the open story leaving the branch, ends
  the chain on the pass with no close run and the pick still owed.
  5.10's host reads no run result, so nothing reads it today; it is
  carried to [Slice 5.10](./10-two-starts.md)'s Open questions as a
  fact for its planner.
- **A close entry's Retry refuses as held before it asks whether a
  close is owed (2026-11-07).** `runOwedClose` checks the hold first,
  as Send does, so a held branch with nothing owed reads as held, not
  as "nothing to close".
- **The close's task names are `lib/db`'s `CLOSE_TASKS` and `CloseTask`
  (C4, 2026-11-07).** The plan's separate `lib/chapters` list was a
  duplicate and was dropped.
- **Send re-checks the hold right before it starts its owed work
  (2026-11-07),** the check `runClassifierPass` used to make before its
  reserve, so a pass that turns held during Send's reads refuses the
  Send instead of building over unreversed writes.
- **The orchestrator keeps one piece of module state (2026-11-07):** a
  `WeakMap` of the errors `unwindRun` reported, so a successor that
  fails its start ends the chain with the same error its `run_complete`
  carried.
- **E2E (2026-11-07).** `chapter-close-owed.spec.ts` adds a Retry
  whose close fails again, the route's close rewrite. Its CTRL-Z and
  banner-Cancel cases hold the close at its metadata call, before any
  write, so they can't show a written close rolling back; the rollback
  is unit-tested in `undo-classifier.test.ts`, and the question of a
  post-write hold point is carried to 5.10's Open questions.
- **Seven review deferrals went to the triage inbox (2026-11-07),**
  in [`triage.md`](../../../triage.md): the run marker after a failed
  close reversal, an unbounded undo read, a pick stamped by redo, a late
  Cancel announcing nothing, the flat before-turn label, the banner's
  announcement rate, and raw refusal codes in Retry toasts.
