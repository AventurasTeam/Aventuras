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
`lib/db/devtools/seed-dataset.ts:1258-1272` of how hero deltas slot into
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
  `lib/actions/stories/operational.ts:164`, and the store's row type, all
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
  (`seed-dataset.ts:1763`). C2 declares `resolves` on that target, so
  without it every seeded close fails at pre-flight.
- `seed-dataset.test.ts:325-343` flips to canon, and the comment at
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

**Stale comments.** `lib/db/story-entries/story-entries.table.ts:38-40`
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

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
