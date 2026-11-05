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
  With a close owed: the pass while entries are unprocessed, null if the
  branch is also held, the close once none are. With none owed, today's
  cadence rule. Canon's sample returns the close on a held branch, over
  unclassified prose, which
  [Phase 0](../../../../memory/chapter-close.md#phase-0--catch-up-passes)
  forbids.
- The `deferred` guard moves off `nextMemoryRun` onto per-turn's
  `chainsTo` (`per-turn.ts:579`), the one chain its reason applies to: a
  regenerated reply doesn't bring interrupted work straight back.
- The pass declares `chainsTo`: `nextMemoryRun` while a close is owed,
  nothing otherwise, and nothing when it was started alone.
- `runClassifierNow`, which serves Retry and Run now, starts the pass
  alone, with `inputs: { alone: true }` read off `run.inputs`.

A chain can't spin. A pass over a non-empty window always advances the
watermark (`periodic-classifier.ts:462`), and `unprocessedEntryCount`
counts only rows a window holds, so no progress guard is needed.

**The end entry.**

- `fallbackChapterEnd(series)` in `lib/chapters`, pure, beside
  `canEndChapter`: the latest `ai_reply` before the head, else the head
  if it's an `ai_reply`, else null. 5.10's Phase 1 falls back to this
  same function.
- `boundary` takes the record's end when a record stands and the
  fallback otherwise, where 5.2 fails the phase. A null end reads as no
  record. A record whose entry isn't an open-region reply still fails as
  `phase-logic`, and now drops, so the next Send owes nothing on it.

**Records.** `pendingClose` holds a manual pick only. An auto close stays
derived, read fresh by `closeOwed` each time, so a rollback below the
threshold leaves nothing stale.

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
- Two store methods, neither driving a run: one clears a branch's
  `deferred.close` for Send, one drops a branch's `deferred` and
  `pendingClose` for a delete.
- `deleteStory` drops both records for each of the story's branches
  (`lib/actions/stories/delete-story.ts`). No branch-delete action exists
  yet, so that half lands with the action, on the same store method.

**Manual start,** in `lib/actions/chapters/`.

- `startManualClose` drops its unprocessed refusal and keeps the others.
  It reads `held` and the unprocessed count first, then runs 5.2's tail:
  the swap and busy checks, the record's write and the start, with no
  await between them. The start is a pass when entries are unprocessed,
  the close otherwise.
- The tail calls `startPipeline` directly, after ensuring registration,
  never `runClassifierPass`. That starter awaits `isClassifierHeld`
  inside the tick (`classifier-pass.ts:19-21`), so a queued Send could
  read the record and start its pass, and this start's rejection would
  then remove the record under Send's chain and lose the pick.
- A second pick overwrites the first, and a rejected start puts back what
  stood before.
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
  so a Send runs at most one close.
- `PipelineStart.chain` resolves to the chain's end and still never
  rejects: `{ kind, result }` for the last successor that ran, null when
  none did, an unwound successor reading as failed with an `orchestrator`
  error. `driveSuccessors` returns it.
- `runPipeline` stays as it is, returning the origin's result, which
  spares about 85 call sites. `submitTurn`, `startManualClose` and a
  close entry's Retry call `startPipeline` and read `.chain` beside
  `origin`, which still carries a refusal and rejects on a throw.
- `orchestrator.ts:329` stops clearing `beforeTurn`, so a successor under
  Send is Send's: `findSendRun`, the composer's Cancel, the pill, the
  banner and `run_complete` all read it so.
- `run_complete` gains `branchId`.
- `SubmitTurnResult`'s owed arms carry `work: DeferredWorkKind`, from the
  run that ended the chain, and Send cancels or fails on any run of the
  chain, not only its origin. `passRefusalOf` and the route's arms at
  `app/reader-composer/[branchId].tsx:749-763` read `work`.

**Interrupt and undo.**

- `undoLastAction`'s pre-check at `undo.ts:66` reads its target past the
  running close's rows, by the `actionId` of `selectMemoryRun`. The
  re-read at `:92-95` needs no change: the close has reversed by then,
  and a close whose reversal failed is still the head and refuses.
- One test pins the second interrupt order. No code changes: the race
  note is stale, since the abort and the swap each land in one tick.

**Banner and pill,** per C6.

- `RunState.closeProgress`, `{ task, part, index, total }`, set by a new
  `generationStore.setCloseProgress(runId, progress)`, which `handleEvent`
  calls by `run.runId` before forwarding `close_task_start`. It joins the
  restricted list at `eslint.config.js:82-97` and
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
  `generation-status-pill.tsx:66-69`, reading
  `closing chapter before your turn…`.
- The test at `memory-run-banner.test.tsx:94-101` flips.

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
  chain ends. With no close owed any more it settles as a commit.
  Otherwise it starts a pass or the close, as the manual start does, and
  it isn't alone. A commit clears the entry as a pass's Retry does, its
  notice `closeResolvedEntry` with `close: 'resolved'` and no Retry. A
  failure rewrites the entry, a failed catch-up pass as a memory entry. A
  cancel leaves it, and a refused start tells the user why.
- A close entry of kind `config-resolver` offers no Retry, per
  [the rows](../../../../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  for a provider or profile gone.
- **Outside a Send,** a failed close shows `chrome.chapterCloseFailed` as
  a warning toast in `hooks/use-memory-run-toasts.ts`, reading
  `Chapter close failed. It runs again before your next turn.` A
  `config-resolver` failure also writes its system entry.
- **The writer.** `raiseSystemEntry` in
  `lib/actions/story-entries/system-entry.ts`, exported from
  `lib/actions`, carries a standing entry's `submission` across, writes,
  and patches `entriesStore`, where `writeSystemEntry` leaves the store
  to its route's `reload`. A listener mounted beside `useMemoryRunToasts`
  calls it, since `lib/pipeline` can't import `lib/actions`
  (`lib/boot/bootstrap.ts:65`). 5.10's click pre-flight calls it too.

**Docs,** in the slice's PR.

- Flip `MemoryRunBanner`'s row at `docs/ui/component-inventory.md:141`.
- Canon, as [Open questions](#open-questions) settles:
  `generation-pipeline.md`'s guard, sample, `run_complete` and
  `beforeTurn` comments, the stale `records … or clears` line in Run
  state transitions, `startPipeline`'s `chain`, and who clears `deferred`;
  `generation-status-pill.md`'s pre-flight sentence; a **Chapter closed**
  on-Retry row in `reader-composer.md`; and `principles.md`'s exceptions
  to head reversals passing through, which name only a Retry's pass
  though the mark at `generation.ts:58` also refuses them during a Send's
  owed work, minutes long for a close.

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

## Acceptance criteria

**Chain,** in `lib/pipeline/definitions/memory-chain.test.ts` unless
named.

- `closeOwed` is true for a pending record with auto-close off, false
  over the threshold with auto-close off, false over the threshold on
  `[opening]` and `[opening, user_action]`, and true at exactly the
  threshold with a reply in the region.
- `nextMemoryRun` returns the pass, the close, null on a held branch with
  entries unprocessed, and today's cadence result with no close owed.
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
  owns: a close's commit, abort and failure. It also tests the two store
  methods alone, and proves `setCloseProgress` publishes to a
  `useGeneration` reader. The other rows are tested where they happen,
  below and under `boundary` above. A restart has nothing to observe,
  since both records are in memory.
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
  `TxResult`.

**Send,** in `lib/actions/turns/__tests__/deferred-send.test.ts`.

- A deferred close, a deferred pass and close, and a close owed with no
  record, as after a failed close, each run before the `user_action`.
- A close record with no close owed clears, runs nothing, and the turn
  lands.
- A Send runs at most one close with the region still over the threshold
  after it commits.
- A successor close that fails returns `outcome: 'failed'`,
  `beforeTurn: true`, `work: 'close'`, with no `user_action` written. A
  failed catch-up pass returns `work: 'pass'` and starts no close.
- A cancel of a successor returns `outcome: 'aborted'`, `beforeTurn: true`,
  and its record stands.
- After CTRL-Z of a committed auto close, the next Send runs the close
  again before the turn.
- `components/reader/send-run.test.ts`: `findSendRun` finds a successor
  under Send, and `cancelComposerRun` cancels it on the first press.
- `lib/pipeline/__tests__/chained-and-parallel.test.ts`: the three tests
  at `:246`, `:311` and `:334` flip. A chain that commits resolves to its
  last run, an unwound successor to a failed end, and `runPipeline` still
  returns the origin's result.
- `lib/pipeline/__tests__/orchestrator.happy.test.ts`: `run_complete`
  names the run's `branchId`.

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
  the event. `lib/stores/__tests__/generation-mutators-lint.test.ts`
  flags `setCloseProgress` from a component.
- `generation-status-pill.stories.tsx` and `memory-run-banner.stories.tsx`
  show the close's before-turn labels.
- `hooks/use-memory-run-toasts.test.tsx`: a failed close toasts once
  outside a Send and stays quiet under one, a chained one included. A
  `config-resolver` failure outside a Send writes its entry on the
  event's branch, and one under a Send doesn't.
- `components/reader/system-entry-actions.test.tsx`: a close's copy for
  each cause; Retry's commit, failure, cancel, refusal and nothing-owed
  arms; no Retry on a `config-resolver` entry or a resolved one.
- `resolver-failure-copy.test.tsx`, `cut-off-copy.test.ts` and
  `context-window-copy.test.ts` cover the close's arms, the capability
  hint's `close` surface included.
- `lib/actions/story-entries/system-entry.test.ts`: the writer keeps a
  standing entry's `submission` and patches a loaded branch's store.

**End to end,** `pnpm test:e2e -- chapter-close-owed`, asserting the DB:

- A turn over a lowered threshold chains a close whose failed metadata
  call shows the toast and leaves no `chapters` row. The next Send fails
  with its text kept, `Retry` writes the row, and the entry clears.
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
  `periodic-classifier.spec.ts`'s gated pass and failure policy.
- **Mutation check** on `closeOwed`'s arms, the moved guard and the
  chain's end: a guard here can stay green while doing nothing.

## Open questions

Each states the route this doc's scope takes, for the developer to
confirm at slice planning. Canon follows the answer.

- **Can the chain guard stay in `nextMemoryRun`?** Canon opens it with
  `deferred.has`, and the pass's `chainsTo` calls it, but `chainsTo` runs
  before a run's own record clears (`orchestrator.ts:311` against `:332`).
  So a deferred pass chains nothing, a `close` record stops every
  catch-up pass, and phase 0 ends after one pass. Canon also says a
  deferred close "chains its own catch-up passes", and a close has no
  `chainsTo`. The scope moves the guard to per-turn and has Send start a
  pass first. The alternative is Send looping by itself.
- **Who clears a close record?**
  [Multi-run txState](../../../../generation-pipeline.md#multi-run-txstate)
  says only a commit;
  [chainsTo on predecessor](../../../../generation-pipeline.md#chainsto-on-predecessor)
  says Send, when no close is owed. The scope follows the second, with a
  store method Send calls.
- **What is a manual pick's lifecycle?** Canon doesn't say who writes a
  null end, what clears the record at a commit, whether a second pick
  overwrites, or what a rollback below the threshold does. The scope
  writes no null, since an auto close stays derived, clears at commit,
  and overwrites. Canon's type keeps `null` per C14.
- **Can the user withdraw a manual close?** As scoped, no. Cancel defers
  it, as canon says, and during phase 0 the toast names only the memory
  update. So a close the user cancelled still runs at the next Send, and
  one whose cause isn't transient stops the branch's turns until a
  restart or a new pick. Should Cancel of a manual close drop it?
- **Do Retry and Run now chain a close?** Canon says Retry runs the pass
  alone, but the pass's `chainsTo` would chain the close under Retry's
  hold, and `retryPassEntry` reads only the origin. The scope runs both
  alone and leaves the close owed for Send. Run now has no caller but
  Retry yet.
- **Is a Send's chain all Send's?** Canon pins `beforeTurn` false for a
  chained successor, yet says Cancel cancels the whole Send and the
  banner reads before-your-turn for that work. The scope carries it. That
  flips three tests and a canon comment.
- **Where does a close's failure show outside a Send?**
  `generation-pipeline.md` and `chapter-close.md` want a system entry for
  a close's pre-flight failure, `generation-status-pill.md` says a toast,
  and nothing outside the reader writes an entry. The scope shows both
  for a `config-resolver` failure and a toast alone for the rest. Such
  an entry offers `Fix` and `Dismiss` by canon's rows, though a pass's
  keeps `Retry` beside its fix (`system-entry-actions.test.tsx:838`). The
  listener writes after the gate lifts, so a Send in that gap leaves the
  entry standing until the next Send's tail drop.
- **A turn's `config-resolver` entry offers Retry.**
  `useSystemEntryActions` (`components/reader/system-entry-actions.tsx`)
  returns `onRetry` unless the pass is `held` or `resolved`, where
  [`reader-composer.md`](../../../../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  lists `Fix profile · Dismiss` for a missing provider. Existing drift
  beside the gate this slice edits. Raised 2026-11-01 by the M5
  promotion. Routed from triage 2026-11-04.
- **What does a manual start hold?** Branch queue, pending mark,
  `withTurnAdmission`, `isStorySwapPending`. The scope keeps 5.2's shape:
  the swap and busy refusals, the record's write and the start land in
  one tick, with no queue, mark or admission. A queue held past the
  reservation would make a head reversal wait, and a mark would refuse
  the head reversals canon lets through. A chained close holds no
  admission past its turn either, so whether 3e's embed needs more is
  [Slice 5.9](./09-chapter-wide-tasks.md)'s to surface.
- **Do the toasts promise too much?** The deferral toast's "moved to
  your next turn" is false when the interrupting reversal removes a
  manual end entry or drops the region below the threshold, and it fires
  before the sweep. The scope ships canon's copy unchanged. The options
  are a follow-up toast when the record drops, or holding the deferral
  toast until the bracket ends.
- **Should an undone close come back?** After CTRL-Z of an auto close,
  `closeOwed` still reads true, so one redo window later the next Send
  runs it again at full cost. The scope leaves that, matching chapter
  delete's [What follows](../../../../memory/chapter-close.md#deleting-a-chapter),
  and pins it in `deferred-send.test.ts`.
- **How often can a close run?** Canon says one close per turn when
  auto-close turns on late. Send plus the turn's chain gives one before
  the turn and one after. It can't show until 5.10's candidates cap a
  chapter's size, since the fallback closes nearly the whole region. The
  scope leaves the chain alone; the alternative is the turn's chain
  skipping a close when its Send ran one.
- **Do `closeOwed`'s fixtures hold real counts?**
  `lib/pipeline/definitions/__tests__/phase-db.ts`,
  `e2e/harness/seed.ts` and `bench/fixture.ts` insert entries with no
  `content_tokens`, so those rows read 0, which
  [Slice 5.1](./01-token-measure.md) leaves on purpose. A "below the
  threshold, owes nothing" case seeded through them passes for the wrong
  reason, so a test of that bound needs a real count on its rows.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
