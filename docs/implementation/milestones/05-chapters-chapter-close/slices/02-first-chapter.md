# Slice 5.2 — First chapter: a close that only closes

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** none to start. Lands after
  [Slice 5.1](./01-token-measure.md), for `openRegionSeries`, the
  `content_tokens` behind `token_count` and the migration order
  ([C5](../milestone.md#c5--token-reads-and-the-progress-hook)).
- **Blocks:** [Slice 5.5a](./05a-task-runner.md),
  [Slice 5.6](./06-close-owed.md),
  [Slice 5.11](./11-review-window.md),
  [Slice 5.12](./12-chapter-delete-rollback.md)

## Goal

A real chapter from a real close: the `chapter-close` pipeline with its
four phases, metadata, stamps, `close_report` and an empty agent slot,
started by a manual pick from a dev route. Reversal and every chapter
read then run on real deltas for the first time, the seed stops pinning
the opposite of canon, and a real chapter of about 24k tokens exists for
the agent's measure.

## Background

A chapter exists only through a close, and this slice's close is whole
with no tasks: run order puts metadata and stamps before any task, and a
task with nothing to do doesn't fail. Every delta of a close shares one
`action_id`, `source = chapter_close` and the end entry as its anchor,
which is why a rollback past the end spares it and one into the chapter
takes all of it. Reversal should need no new code for this, so its tests
are the work, and the seed is where they would go wrong: its close
deltas anchor null, carry no stamps and end chapters on a `user_action`,
and a test pins that. Nothing owes a close yet. The only start is
`startManualClose` behind a dev route, and it refuses anywhere a close
couldn't run at once.

## Required reading

Contracts this slice provides or consumes, used exactly as pinned:

- [C1 — A close's delta shape](../milestone.md#c1--a-closes-delta-shape)
- [C2 — Pipeline shape](../milestone.md#c2--pipeline-shape)
- [C3 — The `chapter` context group](../milestone.md#c3--the-chapter-context-group)
- [C4 — `close_report` v1](../milestone.md#c4--close_report-v1)
- [C5 — Token reads and the progress hook](../milestone.md#c5--token-reads-and-the-progress-hook)
- [C8 — Seed stability](../milestone.md#c8--seed-stability)
- [C10 — What a chapter may end on](../milestone.md#c10--what-a-chapter-may-end-on)
- [C14 — The manual start and `pendingClose`](../milestone.md#c14--the-manual-start-and-pendingclose)

Canon:

- [`chapter-close.md → Run order`](../../../../memory/chapter-close.md#run-order),
  [`Logs and anchors`](../../../../memory/chapter-close.md#logs-and-anchors),
  [`Phase 2 — chapter metadata`](../../../../memory/chapter-close.md#phase-2--chapter-metadata),
  [`Failure modes and atomic rollback`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback),
  [`Review`](../../../../memory/chapter-close.md#review) and
  [`Manual user-triggered close`](../../../../memory/chapter-close.md#manual-user-triggered-close)
- [`generation-pipeline.md → V1 declarations`](../../../../generation-pipeline.md#v1-declarations),
  [`Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate),
  [`Writes`](../../../../generation-pipeline.md#writes),
  [`Abort`](../../../../generation-pipeline.md#abort),
  [`Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  [`Crash recovery via pipeline_runs marker table`](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table),
  [`Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation),
  [`Two retry tiers`](../../../../generation-pipeline.md#two-retry-tiers-both-at-phase-level) and
  [`Cut-off replies`](../../../../generation-pipeline.md#cut-off-replies)
- [`classifier.md → Failure policy`](../../../../memory/classifier.md#failure-policy)
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor),
  [`Chapters / memory system`](../../../../data-model.md#chapters--memory-system),
  [`Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback) and
  [`Backup & export format`](../../../../data-model.md#backup--export-format)
- [`architecture.md → Context groups`](../../../../architecture.md#context-groups)
  and [`System and user halves`](../../../../architecture.md#system-and-user-halves)
- [`cadence.md → Composition rule`](../../../../memory/cadence.md#composition-rule),
  [`retrieval.md → Chapter summaries pool`](../../../../memory/retrieval.md#chapter-summaries-pool),
  [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle) and
  [`plot.md → Happenings side`](../../../../ui/screens/plot/plot.md#happenings-side)
- [`testing.md → Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Embedder in E2E`](../../../../testing.md#embedder-in-e2e),
  [`Mock LLM`](../../../../testing.md#mock-llm) and
  [`Real-provider checks`](../../../../testing.md#real-provider-checks)

Lessons:

- [Drizzle drops keys the table has no column for → How to apply](../../../lessons-learned/drizzle-drops-unknown-keys.md#how-to-apply):
  `closeReport` missing from `fullRow` fails silently.
- [The seeded branch tip moves at the first Send → How to apply](../../../lessons-learned/seed-tip-position-shifts-at-first-send.md#how-to-apply):
  pick end entries by settled replies.
- [Staleness flags are cleared by the drain → How to apply](../../../lessons-learned/staleness-flags-are-cleared-by-the-drain.md#how-to-apply):
  assert the chapter's vector, never its flag.
- [Token-counting fixtures must be prose → How to apply](../../../lessons-learned/token-fixtures-need-real-prose.md#how-to-apply).

Code the contracts don't already point at:
`lib/pipeline/definitions/periodic-classifier.ts:251-470` is the shape of
a phase with one structured call, `lib/pipeline/definitions/classifier-pass.ts`
and `lib/actions/classifier/run-now.ts` of a start, and
`lib/db/devtools/seed-dataset.ts:1261-1275` of how hero deltas slot into
the log.

## Scope: in

**The pipeline ([C2](../milestone.md#c2--pipeline-shape)).**

- `lib/pipeline/definitions/chapter-close.ts` with
  `ensureChapterClosePipelineRegistered`, and one file per phase beside
  it: `chapter-close-boundary.ts`, `chapter-close-metadata.ts`,
  `chapter-close-agent.ts` and `chapter-close-report.ts`. Phases, their
  `resolves` and the declaration's fields are C2's.
- `CHAPTER_CLOSE_KIND` replaces the bare strings C2 lists. It lives in
  `lib/chapters` and `lib/pipeline` re-exports it, as
  `PERIODIC_CLASSIFIER_KIND` lives in `lib/classifier`: the definition
  imports the other kinds for `blockedBy`, so `per-turn.ts` and
  `periodic-classifier.ts` shouldn't import it back from there.
- Boot registers the kind beside the pass at
  `lib/boot/bootstrap.ts:110-111`, and the manual start ensures it, as
  `runClassifierPass` does.
- `CLOSE_RANGE_INTERMEDIATE_KEY` and `CLOSE_LEDGER_INTERMEDIATE_KEY` in
  `lib/pipeline/definitions/intermediates.ts`.
- `boundary` reads the branch's `pendingClose`, finds the end in
  `openRegionSeries`, checks `canEndChapter`, mints the chapter id with
  `generateId('chap')`, takes `startEntryId` from the series' first row
  and parks the range. No record, a null end, or an end that isn't an
  open-region reply fails the phase as `phase-logic`. The run holds the
  gate here, so this is the check that counts: the manual start's own
  read sits outside it.
- `closeAgentPhase(ctx)`, a no-op that returns `{ status: 'completed' }`.
- `report` builds a `CloseReport` from the ledger and writes it through
  `updateChapter`, anchored on the end entry. It is the last write. The
  ledger is `Pick<CloseReport, 'calls' | 'stopped' | 'noToolCalls'>`,
  which [Slice 5.5a](./05a-task-runner.md) parks, and `report` adds
  `version` and `actionId`. An absent ledger reads as
  `{ calls: [], stopped: [], noToolCalls: true }`, which is what this
  slice's close writes.
- The per-call bound keyed by agent id, if
  [Slice 5.4](./04-tool-step.md) hasn't landed it, under 5.4's names:
  `callTimeoutMs` and `CALL_TIMEOUT_DEFAULT_MS` in `lib/ai`, the profile's
  `timeout` else ten minutes. `passTimeoutMs` delegates with
  `'classifier'`, and `PASS_TIMEOUT_DEFAULT_MS` stays exported for
  `scripts/classifier-parse-probe.ts:42`. `passFailure`
  (`periodic-classifier.ts:139-172`) hard-codes `classifier` too, so its
  mapping takes the target and the phase name.

**Metadata
([Phase 2](../../../../memory/chapter-close.md#phase-2--chapter-metadata)).**

- One call for the whole chapter: `generateStructured('lore-mgmt', …)`
  under the bound, with `retriedAttemptEvents` and the pass's reading of
  `aborted` against expiry. A failed call, parse failures included,
  returns `{ status: 'failed', error }`.
- `chapterMetadataSchema`, exported from `lib/pipeline`: non-blank
  `title`, `summary` and `theme`, and `keywords` as a string array.
  Keywords pass `dedupeTerms` and stop at 8. A reply with too few is
  kept: a keyword count isn't worth a close.
- `TEMPLATE_IDS.chapterMetadata` in
  `lib/prompts/bundled/chapter-metadata.ts`, in the new `chapter` group
  ([C3](../milestone.md#c3--the-chapter-context-group)), with
  `VARIABLES.chapter` and `TEMPLATE_GROUPS`. Everything per-call sits in
  the user half: the range's entries through `promptProse` and
  `macro_story_entry`, the previous chapter's summary, and active thread
  titles and statuses. The prompt carries no ids, so it needs no
  placeholder map. The system half reads only what
  `STABLE_SYSTEM_VARIABLES` allows.
- The phase needs its branch loaded, as the pass does
  (`periodic-classifier.ts:231-240`), and fails the same way when it
  isn't.
- Mock shape `chapter-metadata` in `scripts/mock-llm/shapes.ts`, an
  `EXAMPLES` reply in `e2e/harness/mock-llm.ts` and a default lane in
  `scripts/mock-llm/state.ts`.
- The row: `sequenceNumber` one past the branch's highest, `startEntryId`
  and `endEntryId` from the range, `tokenCount` summed from the series
  through the end entry
  ([C5](../milestone.md#c5--token-reads-and-the-progress-hook)), `closedAt`
  at the write.

**Stamps ([C1](../milestone.md#c1--a-closes-delta-shape)).**

- `stampEntryChapter` in `lib/actions/story-entries/register.ts`, its
  `LOCK_KEY` entry `null` like its neighbours, since `story_entries`
  takes no row key and the gate serializes it. The handler reads the row
  for the prior value and writes only `chapterId`.
- `metadata` emits `createChapter`, then one stamp per series row through
  the end entry, in position order, each through `delta_emitted` with
  `entryId` the end entry and `source: 'chapter_close'`. It checks
  `abortSignal` before every stamp, the first included. The series
  already leaves `system` rows out.

**`close_report` ([C4](../milestone.md#c4--close_report-v1)).**

- The nullable JSON column and its migration, following C5's rule for a
  second lander.
- `lib/db/story-entries/close-report.ts` with the Zod schema and the
  `CloseTask`, `CloseReport` and `CloseReportCall` types, exported from
  `lib/db`. `chapterWriteSchema` validates the column with that schema,
  since `createInsertSchema` would otherwise take any JSON.
- `fullRow`, `UPDATABLE` and `ChapterUpdatePatch` in
  `lib/actions/chapters/register.ts`.
- `UPDATABLE` narrows to `title`, `summary`, `theme`, `keywords` and
  `closeReport`, per
  [Slice 5.1 → Implementation notes](./01-token-measure.md#implementation-notes).
  The `register.test.ts` cases on the other columns move to allowed
  ones, and one asserts a patch of only those columns is rejected.
- The projection at the `patcher`, the matching hydrate select at
  `lib/actions/stories/operational.ts:167`, and the store's row type, all
  as C4 pins them.
- The `chapters` row of the
  [export manifest](../../../../data-model.md#backup--export-format)
  names the column.

**The manual start ([C14](../milestone.md#c14--the-manual-start-and-pendingclose),
[C10](../milestone.md#c10--what-a-chapter-may-end-on)).**

- `pendingClose` on `TxState`, initialized in `emptyTxState`, with store
  mutators to set and clear it. `finishRun` drops the branch's record
  when a run with the `close` slot commits, in the same update as its
  deferral. A failed or aborted close leaves the record, and
  [Slice 5.6](./06-close-owed.md) settles the rest of its lifecycle.
- `startManualClose(branchId, endEntryId)`, with the action layer's
  trailing `ctx`, in `lib/actions/chapters/`, exported from
  `lib/actions`. It returns `TxResult | RejectedStart`, as
  `runClassifierNow` does. It refuses a branch that isn't open, an end
  that isn't an open-region entry passing `canEndChapter`, a held branch,
  unprocessed entries, a pending swap and a busy story. The swap and busy
  checks run last, with no await between them, the record's write and
  `runPipeline`, so nothing slips in before the run reserves. A start the
  orchestrator rejects puts back what stood before: a run on another
  story can block a close that `isStoryBusy` passed.
- `canEndChapter` comes from `lib/chapters`, where
  [Slice 5.1](./01-token-measure.md) creates it for `canClose`, since it
  lands first. This slice imports it and adds no copy, and neither the
  start nor `boundary` tests `kind` itself.
- `app/dev/chapter-close.tsx`, listed in `app/dev/index.tsx`, taking
  `branchId` as a route param and cold-opening the branch. It lists the
  open region's replies with a start on each and shows the result. Like
  `/dev/probe-captures` it has no `__DEV__` gate, because `__DEV__` is
  false under E2E, and it destroys nothing. It lives until
  [Slice 5.10](./10-two-starts.md)'s real starts replace it.

**The seed ([C8](../milestone.md#c8--seed-stability)).**

- `CHAP1_END = 29`, `CHAP2_END = 57`, chapter 2 starting at
  `CHAP1_END + 1`, entry 59 left open.
- `delta_hero_3` and `delta_hero_9` gain `entryId`, and each close gains a
  stamp delta per entry after its `chapters` create, with
  `{ chapterId: null }` as the undo payload and the end entry as anchor,
  so `heroDeltas` keeps C1's order.
- `'lore-mgmt': 'prof_classifier'` joins the dataset's `assignments`
  (`seed-dataset.ts:1766`). C2 declares `resolves` on that target, so
  without it every seeded close fails at pre-flight.
- `seed-dataset.test.ts:332-350` flips to canon, and the comment at
  `e2e/tests/plot.spec.ts:74` follows the new range.

**Reversal on a real chapter.** No change to `lib/actions/delta/` is
expected. The deliverable is proof: CTRL-Z, redo, rollback past and into
the chapter, abort and boot recovery on a close that ran, including the
atomic-unit test Slice 3.9 deferred here. A failure means a contract or
the walker is wrong: fix it and record that in this doc.

**Reads, run for the first time.** The prompt buffer, chapter pool,
chapter-match boost, Plot's buckets and the chapter's embedding, on a
close that ran. These should need no code, so a failure is a finding.

**The dataset chapter.**

- A script behind `pnpm dataset:chapter` takes a story text and shapes it
  into `user_action` and `ai_reply` turns of about 130 entries and about
  24k tokens.
- It runs them through the per-turn classifier and the periodic pass, on
  the dev model, into a saved branch. Every entry past the opening goes
  through the action layer, so each has its `story_entries` create delta:
  rollback refuses without one, and 5.5a's later-turn rule reads a turn's
  action from it. A raw-insert branch won't do.
- The result is an open region that ends on a reply, with its watermark
  at the tail, so `startManualClose` runs at once. It is a SQLite file
  reachable through `AVENTURAS_DB_PATH`, with the branch id printed, which
  `PROBE_BRANCH_ID` takes for `pnpm probe:close`
  ([Slice 5.5a](./05a-task-runner.md)).
- The forward burst and the reversal are measured on it, on desktop and
  Android.

**Stale comments.** `lib/db/story-entries/story-entries.table.ts:39-41`
stops promising placeholder content, which canon reversed, and
`lib/stores/generation/generation.ts:28` stops naming a chapter-close
drain, which canon doesn't have.

## Scope: out

- Chain, Send, auto close, `closeOwed`, `nextMemoryRun`'s close branch,
  the rest of `pendingClose`'s lifecycle, the no-model boundary, CTRL-Z of
  a running close at `undo.ts:66`, the banner and failure surfaces:
  [Slice 5.6](./06-close-owed.md). A cancelled dev-route close stops
  chaining on its branch until then, through `memory-chain.ts:90-91`,
  and its toast promises a next turn. Accepted.
- Model boundary, close modal, `STORY TOOLS`, `Close chapter here`,
  `toolCalling`, and removing the dev route, which takes
  `first-chapter.spec.ts` onto a real start:
  [Slice 5.10](./10-two-starts.md).
- `content_tokens`, `openRegionSeries`, `useChapterProgress`:
  [Slice 5.1](./01-token-measure.md).
- Agent tasks, driver, ledger writes, `delta_group_emitted`,
  `pnpm probe:close`, the round-trip suite:
  [Slice 5.5a](./05a-task-runner.md),
  [Slice 5.5b](./05b-identity-threads.md),
  [Slice 5.8](./08-prose-tasks.md) and
  [Slice 5.9](./09-chapter-wide-tasks.md). This slice's reversal tests run
  a close with no tasks and aren't that suite.
- `CLOSE_REPORT_VALUE_BOUND` and cutting values to it: 5.5a's ledger,
  sized by 5.5b's run. The schema doesn't enforce it.
- The system half's exemption for task templates: 5.5a. The metadata
  template follows the normal rule.
- Parts and the merge call: [Slice 5.8](./08-prose-tasks.md). Until then a
  chapter the window can't hold fails its metadata call as
  `context-window`. Accepted.
- `chaptersOld`, which stays 0: [Slice 5.9](./09-chapter-wide-tasks.md).
- Chapter delete, removing `deleteChapter`, the regenerate arm, rollback
  copy: [Slice 5.12](./12-chapter-delete-rollback.md).
- Chapter chips, popover, breaks: [Slice 5.3](./03-reader-chapters.md).
  Timeline: [Slice 5.7](./07-chapter-timeline.md). Review window:
  [Slice 5.11](./11-review-window.md).
- Retry after a timeout: the metadata call bounds as a pass does, and
  [`roadmap.md`](../../../roadmap.md#m7--app-settings--diagnostics--onboarding)
  files the fix under M7.1.
- A turn capture's anchor and the `ch. 3` summary (M7.3), display
  translation (M8.1), `closeConversation` and `closeTools` (M7.1).

## Acceptance criteria

**Pipeline and writes**

1. `lib/pipeline/definitions/chapter-close.test.ts` pins the phases in
   order, `resolves` on all but `report`, and every declaration field C2
   names. `lib/boot/bootstrap.test.ts` asserts the kind is registered
   after `runBootstrap`.
2. Searching `lib`, `components`, `hooks` and `app` for the quoted
   string, leaving out tests, stories and `__tests__` folders
   (`rg "'chapter-close'" lib components hooks app -g '!*.test.*' -g '!*.stories.*' -g '!**/__tests__/**'`),
   finds only the constant's definition and the comment at
   `lib/diagnostics/types.ts:42`.
3. A committed close over `n` non-system entries through the end leaves,
   by `log_position`, one `chapters` create, `n` `story_entries` updates
   and one `chapters` update, all under one `action_id`, with
   `source = 'chapter_close'` and `entry_id` the end entry, and
   `isContentEditDelta` false on every one
   (`lib/pipeline/definitions/chapter-close.test.ts`).
4. The row's `sequence_number`, `start_entry_id` and `end_entry_id` are
   right, entries past the end keep a null `chapter_id`, and a second
   close numbers 2 and starts after the first's end (same file).
   `token_count` is positive and equals a SQL sum of `content_tokens` over
   the range, on rows with non-zero counts, those past the end entry
   included, so the sum is seen to stop there. `hydrateEntries` can't
   build this case: it writes no `content_tokens`
   (`lib/pipeline/definitions/__tests__/phase-db.ts:43-45`), which reads
   as 0 and passes as 0 = 0.
5. An abort after the _k_-th stamp lands no later stamp and leaves the
   branch as it was, with `deferred.close` recorded. An abort during the
   call writes nothing (same file).
6. A failed call, a window refusal, a reply cut off short of a whole
   document (`reply-cut-off`) and an expiry each end the run `failed` with
   no `chapters` row. An unassigned `lore-mgmt` fails at
   pre-flight with no provider call. The expiry reads the `lore-mgmt`
   profile's `timeout`, not the classifier's (same file).
7. `lib/actions/chapters/start-manual-close.test.ts` has one case per
   refusal, each returning `{ outcome: 'rejected' }` with no run started
   and no record left, one for each of `user_action`, `opening` and
   `system` as the end, and one where the orchestrator rejects the start
   and the record reverts.
8. `rg "function canEndChapter|canEndChapter =" lib` finds one definition,
   and criterion 7's end cases pass through it.
9. `lib/stores/generation/generation.test.ts` shows `pendingClose` written
   and cleared, dropped by a close's commit, and kept through its failure
   and abort.

**`close_report`**

10. `lib/db/story-entries/close-report.test.ts` parses a full v1 report
    with every optional field and refuses an unknown `task` or `result`.
11. `lib/actions/chapters/close-report-store.test.ts` walks commit, a
    title save and its undo, CTRL-Z and redo. At every step no store row
    holds a `closeReport` key, `hasCloseReport` is a boolean, the title
    save leaves it alone, and it equals what a fresh hydrate reads, so a
    report undone to null reads false.
12. `pnpm db:check` and `pnpm db:check:format` pass on the rebased tree,
    the migration adds only `close_report`, it sorts after 5.1's, and
    `data-model.md`'s manifest row names the column.

**Prompt and mock**

13. `lib/prompts/bundled/system-half-stability.test.ts` passes with a
    `RENDER_CASES` entry for the template, and
    `lib/prompts/templateContextMap.test.ts` passes with the `chapter`
    group.
14. `scripts/mock-llm/shapes.test.ts` passes, and a close on `pnpm mock`
    is served from a named `chapter-metadata` lane.

**Seed**

15. `seed-dataset.test.ts` pins `chapters` in `getRollbackCounts` at
    `entry_hero_0029: 2`, `0030: 1`, `0057: 1` and `0058: 0`, plus the
    table's other rows by the same rule.
16. The same file shows every seeded chapter ending on an `ai_reply`, each
    stamped entry holding a delta anchored on its chapter's end, in C1's
    order, and `runPreflight` passing for `CHAPTER_CLOSE_KIND` on the
    seeded settings.
17. Its CTRL-Z walk from the hero head to the opening still returns
    `{ status: 'ok' }` at every press.
18. `pnpm test:e2e -- plot` passes, with `Vorne’s pact` still in
    `Current chapter`.

**Reversal** (`lib/actions/chapters/close-reversal.test.ts`, on a close
that ran)

19. CTRL-Z selects `kind: 'group'` and reverses the row, the report and
    every stamp in one press, leaving `processedThrough` alone. The next
    press reverses the turn. Redo gives back the turn, then the close,
    whole and at its own log positions.
20. A rollback to the entry after the end spares the close, with
    `chapters: 0` in the preview.
21. A rollback to the end entry, and one inside the chapter, take all of
    it: no row, a null `chapter_id` on every surviving entry, and the
    watermark clamped below the target. Stamps add nothing to `entries`
    in the preview.
22. A Cancel and a head reversal during the burst leave no stamp and no
    row.
23. `recoverInFlightRuns` over a marker left open mid-burst reverses it,
    closes the marker as `recovered`, and `formatRecoveryReport` uses the
    close's copy.

**Reads**

24. After a close, `readPromptBuffer` follows
    [`Composition rule`](../../../../memory/cadence.md#composition-rule),
    `readRecentEntryIds` with no reach-back starts at the new open
    region's first entry, and `loadChapterRanges`, the boost's input,
    returns every stamped entry of the range
    (`lib/actions/chapters/close-reads.test.ts`).
25. `pnpm test:e2e -- first-chapter` drives the dev route on the seeded
    hero branch to a close at a reply past entry 59, then asserts through
    the database and the UI:
    - the chapter and its deltas landed;
    - `Vorne’s pact` moved to `Earlier chapters`;
    - once quiescent, the chapter's vector exists;
    - the next turn's prompt carries the chapter's title under
      `# Earlier chapters`, the mock's metadata reply written to match
      that turn's action.

**The dataset chapter**

26. `pnpm dataset:chapter` produces a branch whose open region sums to
    22k-26k `content_tokens` over about 130 entries, ending on a reply,
    with `processedThrough` at the tail. Every entry past the opening has
    its `story_entries` create delta, entries carry scene data, and the
    branch holds classifier-written entities, happenings and threads.
27. `startManualClose` at its last reply, from the dev route, commits on
    the dev model with a real metadata reply. The branch, the model and
    the title returned go in this doc's Implementation notes.
28. The forward burst and a CTRL-Z of it, at about 132 stamps, are
    measured on desktop and on Android, with the numbers in this doc's
    Implementation notes.

**Hygiene**

29. `rg "placeholder content on LLM failure|chapter-close drain" lib`
    finds nothing.
30. The dev route closes a chapter on `pnpm desktop` against `pnpm mock`,
    and on an Android dev client.
31. `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
    `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, unit project.** Everything above that names a `lib/` or
  `scripts/` file. Fake the model at `generateStructured`, as
  `lib/pipeline/definitions/suggestion-refresh.test.ts` does, and run the
  close through `startManualClose` so the reversal tests read deltas a
  real run wrote, never hand-written ones. A test registering a subset of
  domains must include `chapters`: `undoTargetOf` throws on an
  unregistered table. Metadata prompts in fixtures use prose
  ([token fixtures → How to apply](../../../lessons-learned/token-fixtures-need-real-prose.md#how-to-apply)).
- **Mutation checks.** A green run proves little here. Confirm each of
  these goes red: a stamp anchored on its own entry (criterion 21), the
  burst's abort check removed (5), the sum not stopped at the end entry
  (4), the `columns` guard in the projection removed (11), and
  `closeReport` dropped from `fullRow` (11).
- **E2E.** `e2e/tests/first-chapter.spec.ts` with the real embedder and
  the mock LLM, locators in `e2e/locators/`, asserting the database first.
  It reaches the dev route by URL, as
  `e2e/tests/story-open-failure.spec.ts:40` does, and
  `app/dev/_layout.tsx` adds no gate. Slice 5.10 moves it off the dev
  route.
- **Storybook.** None. This slice ships no compound.
- **Manual.** The dev route on desktop and Android, then the dataset run
  and its measure.

## Open questions

- **Which dataset, and can it sit in the repo?** The chapter has to read
  like a played story at about 24k tokens. If the text's license allows,
  it can land with the script. If not, the script and shaping rules land
  and the text stays out. Also open: where the `user_action` turns come
  from, since a narration has no player, and how far a synthesized action
  can go before Identity's measure says more about the fixture than the
  agent.
- **How do the classifiers run over it, and where does the result live?**
  Two routes. Real Sends against `pnpm mock`, with the narrative lane
  scripted from the dataset and the structured lanes on passthrough to
  the dev model, exercises the whole turn and needs a driver. A headless
  script on a `node:sqlite` file, as `scripts/classifier-parse-probe.ts`
  runs, is cheaper to drive, and `@/lib/actions` and `@/lib/pipeline`
  import under Node (checked with a scratch run), but a turn's retrieval
  needs an embedder there. Either way, a saved SQLite file can't go in git
  ([`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract)),
  so the command rebuilds it. The branch also has to reach an Android
  device, for this slice's measure and for 5.5b's. 5.5b needs the chapter
  to fit half the served model's window, so read that window before
  fixing the size.
- **Does the close's measure run once with the reader grown?** Criterion
  28 measures the stamp burst on Android. With the reader holding a grown
  window, each update re-sends the whole window
  ([followup](../../../../followups.md#ux), "Native reader rows rerender per
  emission"). This slice's dataset is one chapter of about 132 entries,
  so a grown case at 20-chapter scale would need `pnpm db:seed:long`.
  Should it also run one close with the reader grown, or leave the grown
  case to that followup's slice?
- **What number reopens the stamp burst?** The milestone says a bad number
  reopens the approach and names none. Set the bar at planning, for the
  forward burst and for a CTRL-Z. A move to one group comes after 5.5a's
  group seam lands
  ([C1](../milestone.md#c1--a-closes-delta-shape)).
- **What should the strip and Plot show while a close runs?** Stamps land
  during `metadata`, so the database moves mid-run. `useChapterProgress`
  and `useEntryIndex` refetch on `settleCount` and the tail, so a mounted
  surface holds its number until the run ends. A surface mounting
  mid-burst reads a partial range. Plot's `This chapter` chip appears when
  the row lands (`app/plot/[branchId].tsx:125-130`) while its buckets
  still file everything under `Current chapter`. Canon is silent. Reading
  the code, this resolves itself at settle, so accepting it may be right.
- **Does the seed's close need more than C8 gives it?** C8 gives it
  anchors, stamps and reply ends, and
  [Slice 5.11](./11-review-window.md) adds `chap_hero_2`'s report. Its
  hand-set `tokenCount`s of 12400 and 13850 become sums over 5.1's
  `contentTokens`, one line each, since the Timeline's cards print them.
- **Does the metadata call take an output bound when the profile sets
  none?** Canon's 8k default is stated for a tool step.
  [Slice 5.4](./04-tool-step.md) applies it there and leaves this call's
  answer to this slice, and boundary's to
  [Slice 5.10](./10-two-starts.md). `generateStructured` takes no
  override and a story override sends no limit, so a reasoning model can
  spend its window on one structured call. The small route is an optional
  output default on `StructuredCallOptions`, which boundary can share. The
  other is leaving it to the server. Decide at planning.
- **Does the headless route open a story under `tsx`?** The import check
  above stops short of an open: `loadAndPublish` calls
  `requestIdleCallback` for the encoder warm with no fallback, and plain
  Node has no such global, so `loadOpenStory` throws after `publish`. This
  slice lands before [Slice 5.5a](./05a-task-runner.md#open-questions),
  which asks the same for `pnpm probe:close`, so a `pnpm dataset:chapter`
  that opens a story meets it first. Starting answer: the script sets a
  no-op before its first open, as `vitest.setup.ts` does.

## Implementation notes

- **The dataset is _Treasure Island_, chapters I to IX (developer
  decision, 2026-11-05).** It is public domain and rich in characters
  for Identity: Project Gutenberg ebook #120, its header, footer,
  licence, front matter and headings stripped, committed as
  `scripts/dataset-chapter/treasure-island.txt`. It runs past the
  brief's "about chapter 7", since chapters I to VII hold about 18k
  tokens: through chapter IX the text is 22.9k tokens, cut at paragraphs
  into an opening and 66 replies near 350. Each reply's `user_action`
  was written once by the dev model under one rule, that an action
  states only what Jim does or says next, as the following reply shows,
  and adds no facts, then read against its reply and committed as
  `actions.json`. The model broke the rule in about half its actions
  (voicing others, giving away the reply), so half were rewritten by
  hand. With the actions the dataset is 23,907 tokens over 133 entries.
- **The dataset is built by driving the desktop app (developer
  decision, 2026-11-05).** `pnpm dataset:chapter` runs an opt-in
  Playwright spec on the E2E harness: a story made through the wizard,
  piggyback off so every turn runs the per-turn classifier as its own
  call, `lore-mgmt` assigned, the real embedder. The harness mock
  narrates and serves the wizard, and a second provider at the dev
  model serves the classifier and `lore-mgmt` profiles, in place of
  `pnpm mock`'s passthrough lanes. The built database lives outside git,
  and a rebuild writes different classifier rows. Nothing here opens a
  story under `tsx`, so that question stays
  [Slice 5.5a](./05a-task-runner.md#open-questions)'s. Default story
  settings still auto-close at 24k, which nothing acts on yet: a rebuild
  after [Slice 5.6](./06-close-owed.md) lands has to turn auto-close off
  first. The one build took 1.5 h on `Gemma4-26B-A4B-QAT-MTP`, every one
  of the 66 turns landing on its first Send, and the classifier wrote 55
  entities, 37 happenings and 8 threads.
- **The built database is kept as a shared baseline (developer
  decision, 2026-11-05):** "Yeah keep the database and i guess
  incrementally enrich the seed as slices come in and add in their part.
  Just so we keep the data as a shared baseline and checked in." The
  pristine build is `~/.cache/aventuras-measure/dataset-chapter.db`
  (sha256 `44f0c1d6ad1bc3cb146f7b0d8d2140036890d08751140420009897c9760cd78d`,
  built at `af593629a` on `Gemma4-26B-A4B-QAT-MTP`); a copy after its
  first close on the same model is
  `~/.cache/aventuras-measure/dataset-chapter.closed.db` (sha256
  `34f4bdbf81eb4a8e5b414c0c6149663a3187d68549692ef7c90a8673e335a840`,
  closed at `2f27ae8c7`). Checking a seed export in is later work.
- **The dataset's close.** Branch
  `br_aa6101af-d3dd-4964-9869-81e76cc35f97` of the built database,
  closed at its last reply (entry 133, 23,907 tokens) from the dev route
  on `Gemma4-26B-A4B-QAT-MTP`, returned the title "The Captain and the
  Map" in about 31 s; a second first close, on the production bundle,
  returned "The captain and the map". The production close told its
  summary in the first person, as the narration does; the first used
  "you", against the prompt's rule, a data point for the prompt's later
  tuning.
- **The stamp burst has a bar (developer decision, 2026-11-05).**
  Measured on a release Android build on the Fold and on desktop, with a
  50-row reader: the forward burst, first stamp to last, within 3 s on
  Android and 1 s on desktop, with no JS-thread stall over 500 ms, and a
  CTRL-Z of the close, press to the `settleCount` tick, within 2 s on
  Android and 1 s on desktop. CTRL-Z is the wait a user feels; the stall
  bar matches 5.3's gap between paints. The numbers are in
  `### Close measure`.
- **Android also times the reader document's paints (developer: "Q1:
  A").** The host never waits for the WebView, so a host-side time can
  pass on a frozen reader: the measure adds the longest gap between the
  `'use dom'` reader's `requestAnimationFrame` marks over the burst, on
  the same 500 ms bar, as 5.3 measured.
- **The plan's deep link can't observe the reader on Android.**
  `react-native-screens` detaches the screens under an opaque pushed
  screen, and the dev route is one, so a close started there runs with
  the reader's WebView detached: no paints to time. Android was also
  measured from a temporary in-reader button, the reader on screen, and
  the document gap is judged on those runs only. Both were folded, on
  the cover screen, as 5.3 measured.
- **The plan's stall probe could pass a stalled thread.** It took the
  longest gap between 16 ms ticks touching the burst, and a thread that
  never yielded to the timer left no tick inside it, reading 0. The
  stop moment counts as a tick now; every Android number below was taken
  with that fix.
- **The close's create and stamps move to one group in Slice 5.5a
  (developer decision, 2026-11-05):** "So what i'm thinking is we should
  take the results as they are right now and move it to the batch writer
  no matter what just because it's the more correct way to do it in my
  opinion." The numbers below are the before-baseline;
  [5.5a](./05a-task-runner.md#scope-in) carries the move, and
  [C1](../milestone.md#c1--a-closes-delta-shape) says so.
- **The grown reader isn't measured here (developer decision,
  2026-11-05).** The reader held its trailing 50 rows. The fix for a
  grown window is planned, so measuring the known-bad case would change
  no decision; the followup "Native reader rows rerender per emission"
  ([followups](../../../../followups.md#ux)) makes a close's burst on a
  grown window an acceptance case for the sliding-window slice.
- **The metadata call takes the profile's max output only (developer
  decision, 2026-11-05).** `buildCallSettings` sends the profile's
  `maxOutput`, and no code default is added; `generateStructured` and
  `StructuredCallOptions` don't change. This answers
  [Slice 5.4](./04-tool-step.md#open-questions)'s "Max output for
  boundary and metadata" for metadata; boundary's stays
  [Slice 5.10](./10-two-starts.md)'s. The gap a story override leaves is
  filed under
  [M7.1](../../../roadmap.md#m7--app-settings--diagnostics--onboarding).
  One of fifteen dataset closes on the dev model (force-on aside) failed
  `reply-cut-off`
  with 39,689 output tokens and no max output set, and wrote nothing;
  its retry closed. The developer keeps the profile without a max
  output: "39.6k tokens sounds like a reasoning loop or something, that
  most likely hit the context limit of the model and errored out..
  Anyway, probably fine to keep, the inference is free and better an
  occasional loop than often cutouts on token limit."
- **The rollback preview counts only a close's `chapters` create
  (developer decision, 2026-11-05).** `rollbackCountsOf` drops every
  other `chapters` delta from the world-state bucket, so a close's
  `close_report` update no longer reads as a phantom world-state change;
  [`rollback-confirm.md → Counts`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#counts)
  lists only entities, lore, threads, happenings and entry assets there.
  A user's own chapter edit swept by a rollback now counts nowhere
  either: [5.7](./07-chapter-timeline.md#open-questions) and
  [5.11](./11-review-window.md#open-questions) carry the question.
- **`CHAPTER_CLOSE_KIND` lives in `lib/chapters`, and `lib/pipeline`
  re-exports it.** The brief's "as `PERIODIC_CLASSIFIER_KIND` lives" was
  inexact, since `lib/pipeline` doesn't re-export that one; the
  re-export is what C2 pins, and the replaced sites import from
  `@/lib/chapters`.
- **The manual start writes `pendingClose` from `onReserved`.** It fires
  synchronously once the run is in `txState`, so a start the
  orchestrator rejects never writes the record and needs no restore,
  and no await slips between the busy check and the write.
  [Slice 5.6](./06-close-owed.md) inherits this when it settles the
  record's lifecycle.
- **One delta group can't both create and update a chapter.**
  `updateChapter` reads committed rows, so the `close_report` update
  stays a write of its own after 5.5a's group of the create and stamps.
- **The dev route takes `branchId` as a query parameter,**
  `/dev/chapter-close?branchId=…`, since a flat route file can't serve a
  path segment. With none it uses the open story's branch, so the dev
  index's plain link works.
- **A surface mounted mid-close reads a partial range, and settles.**
  The strip, Plot's chip and the reader's breaks can see the row before
  the stamps finish and converge at the run's settle. Canon is silent
  and the banner says a close runs, so this is accepted until 5.5a's
  group makes the create and stamps land together.
- **The seed's chapters end on replies, at 29 and 57,** each with a
  stamp delta per entry anchored on its end, and their `token_count`s
  are sums of the ranges' `content_tokens`, computed while seeding.
- **The metadata schema is plain Zod.** A pattern keeps the schema
  plain JSON Schema and fails a blank field as a parse, which retries;
  the trim, the keyword dedupe and the cap of 8 run after the parse. The
  plan's force-on check couldn't reach the pattern: force-on on an
  openai-compatible provider sends no schema
  ([`testing.md → Mock LLM`](../../../../testing.md#mock-llm)), so a
  close on such a profile fails as a parse failure and writes nothing.
- **A report undone to null (criterion 11).** CTRL-Z of a close reverses
  its create along with its report, so no step of the store walk on a
  real close leaves a row whose report went back to null.
  `register.test.ts`'s report update and its reversal pin the flag
  clearing end to end, `projectChapterPatch`'s update arm with
  `closeReport: null` pins the function, and `load-open-story.test.ts`
  pins a null column reading false at hydrate. The walk in
  `close-report-store.test.ts` covers every step criterion 11 names.
- **`fullRow` and the walk.** A close's create carries no report, which
  lands by the update, so the walk can't see `fullRow` drop
  `closeReport`. `close-report-store.test.ts` adds a create carrying one,
  which that mutation turns red, as do `register.test.ts`'s create
  cases.
- **The metadata prompt reads the story's mode (developer: "Q2: A").**
  The plan's system half read every user turn as "the narration decides
  what happened" and kept `mode` out of the `chapter` group. Canon reads
  a turn by mode
  ([`ui/principles.md → Mode`](../../../../ui/principles.md#1-mode--users-relationship-to-the-story)),
  so `mode` joined `VARIABLES.chapter` and `ChapterContext`, the system
  half branches its user-turn paragraph as `macro_classifier_mode_rule`
  does, worded for a summary, and
  [`chapter-close.md → Phase 2`](../../../../memory/chapter-close.md#phase-2--chapter-metadata)
  lists the mode in the prompt context.
- **A close's range is read by its ids.** The plan's
  `readCloseRangeEntries` read the open region through the end, which
  returns nothing once the stamps land; it now reads the non-system rows
  between the range's start and end positions, as
  [C2](../milestone.md#c2--pipeline-shape) has phases read the range.
  Sound while entries are only appended at the tail: a feature that
  inserts mid-story should also require the stamp once it has landed.

### Close measure

Bar, set at planning: the forward burst within 3 s on Android and 1 s
on desktop with no JS-thread stall over 500 ms, and CTRL-Z of the close
within 2 s on Android and 1 s on desktop. A miss reopens
[C1](../milestone.md#c1--a-closes-delta-shape): a move to one group
after 5.5a's seam, which the developer has since decided on regardless.

Fixture: the dataset branch, 133 stamps over 23,907 tokens, with the
reader mounted on its trailing 50 rows. Timed inside the app's JS by a
temporary probe, not committed: the burst from the stamp deltas'
`created_at`, a stall as the longest gap between 16 ms ticks, the
document gap as the longest gap between the reader document's paints,
CTRL-Z from the press to the `settleCount` tick. Desktop started its
measured closes from DevTools with the reader on screen, since nothing
in-app leads from the reader to the dev route there.

| Platform, start                                                                     | Forward burst         | Longest stall in it   | Document gap                           | CTRL-Z       |
| ----------------------------------------------------------------------------------- | --------------------- | --------------------- | -------------------------------------- | ------------ |
| Desktop, `pnpm desktop` dev build (Linux 7.2)                                       | 1468 / 1265 ms (miss) | 61 / 41 ms            | 60 / 45 ms                             | 379 / 370 ms |
| Desktop, production bundle (Linux 7.2)                                              | 792 / 788 ms          | 21 / 29 ms            | 34 / 32 ms                             | 211 / 174 ms |
| Android 17, Galaxy Z Fold (SM-F966B), folded, release `arm64-v8a`, in-reader button | 967 / 986 ms          | 1091 / 1094 ms (miss) | 18 / 17 ms                             | 209 / 213 ms |
| Same, the dev route deep-linked over the reader                                     | 1097 / 1013 ms        | 1212 / 1121 ms (miss) | not measurable: the reader is detached | 210 / 218 ms |

On desktop the document shares the renderer's thread, so its gap is
information only. The dev-route close on desktop, with no reader
mounted, took 675 ms on the dev build and 453 ms on the production
bundle. The dev route closed a chapter on an Android dev client
against `pnpm mock`, served from the `chapter-metadata` lane.

Verdict (developer: "Q11: A"): desktop is judged on the production
bundle and holds the bar; the dev build's burst misses it under React's
development mode. On Android the burst and CTRL-Z hold and the reader
keeps painting, but the JS thread stalls about 1.1 s in the burst, a
miss that stands as the before-baseline for the move to one group.
[Slice 5.5a](./05a-task-runner.md#scope-in) carries a hard bar for it,
with no code change here.
