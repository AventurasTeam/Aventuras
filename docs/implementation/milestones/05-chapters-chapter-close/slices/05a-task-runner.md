# Slice 5.5a — Task runner

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.2](./02-first-chapter.md) (the `chapter`
  group, the report type, the range intermediate and a real close
  around the runner), [Slice 5.4](./04-tool-step.md) (the step call and
  scripted tool steps in both mocks)
- **Blocks:** [Slice 5.5b](./05b-identity-threads.md),
  [Slice 5.12](./12-chapter-delete-rollback.md) (its delete modes join
  the round-trip suite)

## Goal

A close task runs as a native tool-calling conversation over any list
of tools, and each write's result goes back to the model through the
verdict seam every later tool uses. This slice ships that seam, the
driver and its three slots, the run-long ledger, ids across a close,
the two read tools, the later-turn reader, the round-trip suite and
`pnpm probe:close`. It ships no real task: the agent slot is filled
but holds none, and a stand-in tool proves the runner.

## Background

In canon, code holds the plan and the model does one task at a time, in
its own conversation; writes land as they run, and a refused write goes
back to the model. The orchestrator can't do that yet: `delta_emitted`
is the only write event, `consumePhase` passes nothing back, a rejection
throws, and `applyDeltaActionGroup` drops a noop with its reason. Writes
travel by `yield`, so dispatch has to sit in the phase generator, which
is why 5.4's step call takes tools with no `execute`. `lib/pipeline`
can't import action values (`action-port.ts:29-32`), so anything this
slice needs from the action layer crosses the port.

## Required reading

- [`chapter-close.md → The agent`](../../../../memory/chapter-close.md#the-agent)
  through
  [`When a task stops`](../../../../memory/chapter-close.md#when-a-task-stops):
  run order, conversations, tools and writes, the three results, the
  later-turn rule, the budget and the early stops.
- [`chapter-close.md → Failure modes`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback)
  and [`Review`](../../../../memory/chapter-close.md#review): what fails
  a close, and what the report holds.
- [`generation-pipeline.md → Writes`](../../../../generation-pipeline.md#writes),
  [`Phase iteration`](../../../../generation-pipeline.md#phase-iteration)
  and
  [`Two write paths from the orchestrator`](../../../../generation-pipeline.md#two-write-paths-from-the-orchestrator):
  the group event and the outcome back through the `yield`.
- [`generation-pipeline.md → Phase vs sub-work`](../../../../generation-pipeline.md#phase-vs-sub-work),
  [`Abort`](../../../../generation-pipeline.md#abort),
  [`Two retry tiers`](../../../../generation-pipeline.md#two-retry-tiers-both-at-phase-level)
  and
  [`Cut-off replies`](../../../../generation-pipeline.md#cut-off-replies).
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay):
  what redo and a hold mean, which the round-trip suite and its
  `held-in-redo` assertion test.
- [`generation-pipeline.md → ID placeholder substitution`](../../../../generation-pipeline.md#id-placeholder-substitution)
  and
  [`classifier.md → ID handling in classifier output`](../../../../memory/classifier.md#id-handling-in-classifier-output).
- [`cadence.md → User edits and classifier writes`](../../../../memory/cadence.md#user-edits-and-classifier-writes)
  and
  [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor):
  precedence and which deltas carry which anchor.
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves)
  and [`Context groups`](../../../../architecture.md#context-groups).
- [`code-conventions.md → Module structure`](../../../../code-conventions.md#module-structure)
  and [`Action layer`](../../../../code-conventions.md#action-layer).
- [`testing.md → Real-provider checks`](../../../../testing.md#real-provider-checks)
  and [`Mock LLM`](../../../../testing.md#mock-llm): the probe's
  precedent and the mock it runs against.
- Contracts provided:
  [C9](../milestone.md#c9--the-round-trip-rule),
  [C11](../milestone.md#c11--tool-results),
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means), and the
  event half of
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts).
- Contracts consumed:
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C3](../milestone.md#c3--the-chapter-context-group),
  [C4](../milestone.md#c4--close_report-v1).

## Scope: in

File names below are a starting layout. The agent phase stays in
`lib/pipeline/definitions/chapter-close-agent.ts` (C2), and its parts
and tools sit under `lib/pipeline/definitions/close-agent/`.

**The verdict seam (C11).**

- `delta_group_emitted` joins `PhaseEmittedEvent`
  (`lib/pipeline/types.ts:65-68`) as canon types it. `handleEvent`
  dispatches it through the port, forwards it to the bus and returns the
  outcome, and `consumePhase` passes that to `gen.next`
  (`orchestrator.ts:224-234`). `runParallelGroup` shares `consumePhase`,
  so it needs no change. `PhaseFn` narrows its next type
  (`types.ts:122`).
- A throw from the action layer stays an `ActionLayerError`, as on the
  single path (`orchestrator.ts:182-186`). A group's plain refusal comes
  back as a value and never fails the run. `delta_emitted` keeps its
  behaviour, and its `yield` evaluates to undefined.
- `DeltaActionPort` gains a group method, in all five constructors:
  `lib/boot/bootstrap.ts:68`, `lib/pipeline/__tests__/harness.ts:47`,
  `lib/pipeline/__tests__/abort-reversal-hold.test.ts:44`,
  `lib/pipeline/definitions/periodic-classifier.test.ts:2263` and
  `lib/actions/turns/__tests__/stand-in-pass.ts:183`. New types sit in
  `lib/actions/types.ts`, the one internal file `lib/pipeline` may
  import (`eslint.config.js:119-120`).
- That method is a new function, `applyDeltaActionGroupWithOutcomes`. It
  returns per-action outcomes, indexed by action and assigned after the
  rerun (`apply-delta-action.ts:333-345`), so a link that lands on the
  rerun doesn't keep its first noop. Each carries the handler's `reason`
  and mark. An all-noop group returns its outcomes (`:347`). A plain
  refusal stays whole-group, with nothing written.
- `applyDeltaActionGroup` becomes a wrapper over the same runner and
  keeps `DeltaGroupResult` as it is, rather than growing its `ok` arm.
  Its four callers read nothing from that arm, and about 25 assertions
  pin it as `{ status: 'ok' }` (`collision-flags.test.ts:570`,
  `group-conflicts.test.ts:325`, `lock-keys.test.ts:253`), so this
  leaves them alone with no sweep.
  [`Phase iteration`](../../../../generation-pipeline.md#phase-iteration)
  and
  [`Two write paths`](../../../../generation-pipeline.md#two-write-paths-from-the-orchestrator)
  name the new function for `delta_group_emitted`.
- `noopRefusal(reason, 'restated' | 'gone')` (`registry.ts:74`). Rule
  refusals stay unmarked. The single path drops the mark where it
  returns a refusal (`apply-delta-action.ts:183`), so `MutationResult`
  doesn't change and the exact refusals pinned through it pass unedited
  (`entities/register.test.ts:443`, `state-patch-actions.test.ts:117`).
  Restated values, thirteen sites across twelve
  spellings: `state-patch-actions.ts:221,403,460,482,620,673`,
  `entities/register.ts:315`, `relationships/register.ts:152,209`,
  `threads/register.ts:201`, `lore/register.ts:134`,
  `register-awareness.ts:121`, `register-involvements.ts:81`.
- Gone rows, fourteen sites:
  `state-patch-actions.ts:338,381,401,421,458,479,617,650,653,671,690`,
  `relationships/register.ts:289`, `threads/register.ts:200`, and
  `MISSING_REF` at `live-refs.ts:233-237`, a literal rather than a
  `noopRefusal` call, which takes the mark by hand.
- The mapping from a group's outcome to one tool result, with `rejected`
  as its default. `USER_EDITED_SINCE_PROSE` maps to `skipped`, `restated`
  to nothing written, and `gone` to `rejected`, saying where the row
  went: a row this close merged names its survivor from the ledger.
  Across a call's actions and the fields its plan left out:
  - Any action landed: `ok`, naming every other field and its reason,
    restated ones aside.
  - None landed: `rejected` if any was refused by a rule or gone, else
    `skipped` if any was protected, else `ok` with nothing written.
  - A whole-group refusal, the hard `not-found` of `updateEntity`,
    `updateLore`, `updateThread` and `updateHappening` included:
    `rejected`, with nothing written.

**The later-turn reader (C12).**

- `lib/actions/delta/later-turn.ts` selects a row's later deltas by
  C12's rule. A turn's action comes from its entry's `story_entries`
  `create` delta, found by `target_id` as `resolveRollbackWindow` finds
  it, whatever that delta's own anchor. Entries past E with no `create`
  delta, which only raw inserts leave, read as not later.
- The retrieval-only test is private at `link-owners.ts:71-77`. It's
  exported from `lib/row-signals`, and 5.12 uses the same export for
  C13.
- `userEditsSince`, `userEditsSinceProse` and `rowDeltasSince` take a
  `LockedTable`, which has no `lore` (`row-locks.ts:15-23`), so their
  parameter widens to cover it, with no new lock.
- The read reaches the phase as a second port method, a row guard: for
  a list of rows, the end entry and the latest cited turn it answers
  `laterTurnWrote(column, path)` and `userWrote(column, path)` by
  `wroteField`'s groups, and `laterTurnTouched` and `userTouched` for a
  whole row. `user-precedence.ts` isn't exported from `lib/actions`, and
  this one method saves the tool slices a port change each.

**The driver (C2).**

- `closeAgentPhase(ctx)` runs three slots in order: `before`, then
  `perPart` for each part, then `after`. A slot entry is a task or a
  code step, so 5.9's stackables and reset fit it. One function supplies
  the parts, returning the whole chapter as part 1 until 5.8 replaces
  it. The production slots ship empty. An override in the style of
  `__resetDeltaActionPort` lets vitest and the probe run the real
  pipeline with a stand-in task.
- A task is its name, its tools, a start read and a render. The start
  read returns the rows the prompt shows and, apart from them, the rows
  it seeds as read, so a task can list titles and seed nothing. Nothing
  to show makes no call. Each task is its own conversation:
  the rendered pair, then `generateToolStep` with that task's tools and
  `firstCall` set on the first, 24 times at most
  (`CLOSE_TASK_STEP_BUDGET`). No step carries the cache marker yet (see
  Open questions).
- Response messages stay as the SDK returns them. Each of a step's
  `calls` runs in order inside the generator and gets an answer before
  the next step. `invalidCalls` are skipped, since the SDK answered them
  in `responseMessages`; `convertToLanguageModelPrompt` merges the two
  `tool` messages into one.
- A reply with no tool call at all ends the task, whatever its finish
  reason, and a reply with any call continues it, an invalid one
  included.
- After each step, whatever its status, the driver yields
  `retriedAttemptEvents(result, 'lore-mgmt')`, as the pass does
  (`periodic-classifier.ts:347`), so a retried attempt reaches the log.
- `stopped`, for `cut-off` or `window`, stops the task and keeps what
  landed, as the budget does. `failed` returns `{ status: 'failed' }`
  through `toPipelineError(error, 'lore-mgmt')`, `not-configured`
  returns a `config-resolver` failure, and `aborted` returns
  `{ status: 'aborted' }`.
- The abort signal is polled before each step and between calls.
- `close_task_start` joins `PhaseEmittedEvent` if 5.6 hasn't landed it,
  and fires for each task as it starts, a task with no start rows
  included. A pure function gives `index` and `total` from the task, the
  part and the part count, by canon's order, so `3 of 7 — Identity`
  holds while tasks are still landing. 5.6 owns the store field and the
  label.

**Tools and the write path.**

- A tool is a name, a description, a Zod schema with no `.transform()`,
  which arguments hold ids, and a plan that reads ahead and returns a
  refusal or actions, each tagged with the fields it writes (C11's
  starting design).
- Every write passes the common checks first: `turns` cites a turn and
  each handle resolves to an entry in the chapter's range, `why` is
  present, and each row was read. A failed check returns `rejected`
  with what to do. The latest cited turn by position becomes the plan's
  `proseEntryId`. The group's `entryId` is always E, and `source` is
  `chapter_close` (C1).
- The read gate is a set per task and part. A row joins it when the
  start seeds it, which it does only if it showed the fields the tool
  writes (C11), or when `read_row` returns it. A row the start only
  listed by title stays unread.
- Two functions serve a tool writing an entity row, since two `state`
  actions on one row can't share a group
  (`apply-delta-action.ts:317-324`):
  - `fieldVerdicts` takes the row guard and the fields a call names,
    `state` sub-fields and top-level columns alike, and returns each
    field's verdict: free, or protected with its reason. It changes
    nothing, so a tool can run its own checks on the free fields.
  - `entityWriteAction` takes the row and the fields the tool still
    wants, merges the `state` sub-fields over the current state, and
    returns the one `updateEntity`, top-level columns in the same patch.
- The `skipped` rule sits in the tool plan. A plan with nothing left to
  land emits no group: its result is `skipped` if every field it lost
  was protected, and `rejected` if it refused one itself.
- `search_world` reads entities by name and keywords and happenings by
  title, from SQL, and returns short ids with a line each, capped.
  `matchTerms` finds a term inside a text (`name-index.ts:68-85`), so it
  catches an alias the query holds whole; a partial query needs the
  reverse direction too. A match doesn't count as a read.
- `read_row` returns the fields a per-task registry names, keyed by task
  and row kind, which the tool slices extend. It reads SQL and swaps ids
  with `substituteIds`. A read has no refusal: a missing row is an
  answer saying so, naming a survivor if the ledger has one.

**The ledger (C4).**

- A run-long object under `CLOSE_LEDGER_INTERMEDIATE_KEY`, seeded as the
  agent phase starts, in the shape 5.2's `report` phase reads:
  `Pick<CloseReport, 'calls' | 'stopped' | 'noToolCalls'>`. The driver
  clears `noToolCalls` on any tool call, an invalid one included.
- `calls` holds every call the driver dispatched, in run order. A read
  records `why: ''`, `turns: []` and `ok`, so 5.11's rule for an `ok`
  call with no field drops it. An invalid call has no parsed row and
  records nothing.
- `rows` and `turns` hold real ids, and a refused create keeps the id
  its plan minted, with its name. `values` holds landed or proposed
  fields and never a restated one. Its keys and a `skippedFields` entry's
  `field` name the delta path a field lands at, as `changedPaths` reads
  it (`description`, `state.voice`), and each skipped field carries its
  own `reason`. A list joins with `, `, and a ref's value is the row's
  name. `reason` and `survivor` fill as C4 says.
- `CLOSE_REPORT_VALUE_BOUND` lives with the ledger, which applies it. It
  starts at a provisional 2,000 characters, and 5.5b's run sizes it.
- `reason` is `USER_EDITED_SINCE_PROSE`, `later-turn` or `row-gone` for
  those classes, and the handler's own string for a rule refusal.
- The writes-so-far list is built from the landed calls: tool, row name,
  short id and fields, one line each. Each task's render gets it for
  its user half.

**Ids across a close.**

- One `IdBiMap` for the run, under a new key in `intermediates.ts`, so a
  row keeps its short id across steps, tasks and parts. A row's name
  joins the map when its id is allocated. That gives a close-wide
  `nameOf`, covering lore, which `idNames` doesn't
  (`substitute.ts:101-118`).
- Turns take `t1…tN` by position across the whole chapter, through
  `registerHandle`, before the first render. A `haw_` row takes `aw1…`
  the same way, for 5.9's `set_pin`, and a turn outside the chapter can
  take a handle later, for 5.9's `read_turns`.
- `registerHandle` also writes `uuidToPlaceholder` (`bimap.ts:32-38`),
  so a `haw_` row shown twice keeps one handle and the writes-so-far
  list can print it. That flips `bimap.test.ts:54-55`, which pins the
  map as one-way by design. Nothing in production calls `registerHandle`
  yet.
- An unknown handle is `rejected`, so the close doesn't use
  `resolveHandle`, which falls back to the head (`window.ts:85-92`).
- Ids in arguments go back by what the tool declares, single or array,
  and a miss is `rejected`. `substituteClassifierIds` keys on field names
  and skips arrays (`substitute.ts:24-46`), so it isn't used.
- Text arguments pass through `nameIdsInProse`, with `why` and `body`
  added to `PROSE_FIELDS` (`substitute.ts:50-72`).
- A handler's `reason` can interpolate a full id, so the text the model
  gets passes through the map first. The ledger keeps the original.
- [`data-model.md → Placeholder substitution`](../../../../data-model.md#placeholder-substitution-llm-facing-handles)
  and
  [`generation-pipeline.md → IdBiMap`](../../../../generation-pipeline.md#idbimap)
  scope a map to one call: both gain a close's case.

**The system half (C3).**

- Two macros in the `chapter` group. One holds the instructions every
  task shares, including that this is an automated system no one
  answers, and reads no per-call variable, so Happenings and Awareness
  pass the stability test with no exemption. The other follows it for
  the prose tasks and holds each turn of the chapter or part under its
  handle, through `promptProse`. Its variables join `VARIABLES`'
  `chapter` group.
- `system-half-stability.test.ts:312` gets a named list of the close's
  task templates, excluded from the `it.each`. The list starts empty, so
  the criteria on it and on the shared half's bytes sit in
  [Slice 5.5b](./05b-identity-threads.md), whose templates first fill
  it.

**`pnpm probe:close` (`scripts/close-probe.ts`).** Its precedent is
`scripts/classifier-parse-probe.ts`, `pnpm probe:classifier`
(`package.json:49`), with the same `SMOKE_LLM_*`, `PROBE_RUNS`,
`PROBE_BRANCH_ID`, `PROBE_OUT` and `AVENTURAS_DB_PATH`.

- Each run takes a fresh copy of the source database with `VACUUM INTO`,
  so the source is never written and runs repeat. The copy loads
  sqlite-vec and a `runInTransaction`, as `createTestDb` does.
- It opens the story as the app does, then calls `startManualClose` at
  `PROBE_END_ENTRY`, by default the latest `ai_reply` in
  `openRegionSeries`.
- A fetch wrapper saves every step's request and response bodies under
  `PROBE_OUT`, one file a step, named by task, part and step from
  `close_task_start`. The run also saves the report and prints each
  task's steps, calls, results and stops.
- `PROBE_STAND_IN=1` swaps in the stand-in task, for a mock run with no
  real task.
- [`testing.md → Real-provider checks`](../../../../testing.md#real-provider-checks)
  gains a paragraph on it, and the "Tune the close's agent" entry in
  [`followups.md`](../../../../followups.md#tuning-and-play-testing)
  drops "extends the probe to a close".

**The round-trip suite (C9).**
`lib/pipeline/__tests__/close-round-trip.test.ts`, one table of cases,
each a tool and its scripted call, run through five arms: CTRL-Z, redo,
abort, a rollback past E and a rollback into the chapter. A `merge` flag
adds the `held-in-redo` assertion, counting link rows and creates. Arms
are data, so 5.12 adds its two delete modes in one place. The first case
is the stand-in tool, a call landing one create and one update.

The stand-in sits in `lib/pipeline/__tests__/close-stand-in.ts`, which
vitest and the probe share. It never reaches a production slot.

## Scope: out

- Every real write tool and task: Identity and Threads
  ([Slice 5.5b](./05b-identity-threads.md)), Lore, Upkeep and Lifecycle
  ([Slice 5.8](./08-prose-tasks.md)), Happenings and Awareness
  ([Slice 5.9](./09-chapter-wide-tasks.md)), with their templates and
  exemption entries.
- Precedence on `updateThread` and `updateHappening`, and their
  emptied-`set` noops (5.5b). Soft caps (5.5b), the lore cap (5.8).
- Parts: the cut, the part intermediate, metadata per part (5.8).
- `read_turns` (5.9).
- The step call, its retry, the window count and the mocks' tool steps
  ([Slice 5.4](./04-tool-step.md)).
- `close_report`'s column, schema, writer and `report` phase (5.2).
  Not applied and the review ([Slice 5.11](./11-review-window.md)).
- The banner's store field, mutator and labels
  ([Slice 5.6](./06-close-owed.md)).
- Chapter delete's arms in the suite
  ([Slice 5.12](./12-chapter-delete-rollback.md)).
- `toolCalling` and the full seven-task run
  ([Slice 5.10](./10-two-starts.md)).
- `single`, `shared` and their profile fields (M7.1).
- A real model's run, per-step counting cost and the number behind
  `CLOSE_REPORT_VALUE_BOUND` (5.5b). Tuning stays in
  [`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing).

## Acceptance criteria

- A phase yielding `delta_group_emitted` reads each action's outcome as
  the `yield`'s value, in a plain phase and in a parallel branch; a
  group's refusal leaves the run going; a `delta_emitted` rejection
  still fails it; the bus sees the event
  (`lib/pipeline/__tests__/group-verdict.test.ts`).
- Group outcomes sit at each action's index with reason and mark; a
  link landing on the rerun reads landed; an all-noop group returns its
  outcomes; a plain refusal writes nothing
  (`lib/actions/delta/group-outcomes.test.ts`). `DeltaGroupResult` and
  `MutationResult` keep their shapes, so the existing tests pinning them
  pass unedited.
- A scan of `lib/actions` fails on an unmarked restated or gone
  `noopRefusal`, and sample handlers report their mark
  (`lib/actions/delta/noop-marks.test.ts`).
- Each row of C11's table gives its result, an unknown noop gives
  `rejected`, a hard `not-found` gives `rejected` with nothing written,
  and a gone row this close merged names its survivor
  (`lib/pipeline/definitions/close-agent/verdict.test.ts`).
- A delta anchored past E counts as later, and so does a null-anchored
  delta in a later turn's action. A `retrieval_count`-only update, a
  `chapter_close` delta and a phase-0 pass anchored inside the chapter
  don't. A row a later turn created reads as written whole, and lore
  rows work (`lib/actions/delta/later-turn.test.ts`).
- Calls in a step run in order, and a second call sees the first's
  write. An invalid call is skipped with the rest answered. A `stop`
  reply with calls goes on, and a reply with none ends the task. The
  budget stops it at 24. A later step's window and a repeated cut-off
  stop it and keep what landed. A first call that doesn't fit and a
  failed call fail the close. An abort between calls returns `aborted`,
  and a task with nothing to show makes no call. Each retried attempt
  yields a `recoverable_error`, on a step that lands and on one that
  fails (`lib/pipeline/definitions/close-agent/driver.test.ts`).
- Over a fixture of two parts, `before` and `after` entries run once and
  `perPart` entries twice, in that order, and `close_task_start` gives
  `3 of 7` for Identity at one part and `of 17` at three
  (`lib/pipeline/definitions/close-agent/driver.test.ts`).
- A write citing nothing, a turn outside the chapter or an unread row is
  `rejected` with nothing emitted; a seeded start row counts as read,
  and a row the start only showed is `rejected` until a `read_row`; the
  latest cited turn reaches the action as `proseEntryId`, and every
  delta has C1's source, action and anchor
  (`lib/pipeline/definitions/close-agent/write-path.test.ts`).
- A call writing two `state` sub-fields lands one action and one delta,
  and with one protected it lands the other and returns `ok` naming the
  skipped field. A `description` beside an all-protected `state` lands
  alone in one `updateEntity` and returns `ok` naming the sub-fields. A
  free field the tool refuses between the two functions never reaches
  the action. With nothing left to land no group is emitted, and the
  result is `skipped` if every field was protected and `rejected` if the
  tool refused one (`write-path.test.ts`).
- The ledger holds every dispatched call in run order and no invalid
  one, leaves a restated field out of `values`, keys `values` by delta
  path, gives a ref's value as a name, cuts a value to the bound, keeps
  a refused create's minted id and records a stop; a landed call shows
  in the next task's writes so far
  (`lib/pipeline/definitions/close-agent/ledger.test.ts`).
- A row keeps its short id across two tasks and two parts; a `haw_` row
  shown in two tasks keeps one handle, which the writes-so-far line
  prints; an array of ids goes back; an unknown id or turn is
  `rejected`; a token in `why`
  is named; a full id in a handler's reason never reaches the tool
  result (`lib/pipeline/definitions/close-agent/ids.test.ts`).
- `search_world` finds a row by a whole alias in the query and by part
  of a keyword, and adds nothing to the read set. `read_row` returns
  only the task's fields and answers a missing row without a refusal
  (`lib/pipeline/definitions/close-agent/read-tools.test.ts`).
- The instructions macro's source reads no per-call variable, and the
  prose macro's reads the turns
  (`lib/prompts/bundled/bundled-pack.test.ts`).
- The stand-in case passes all five arms with no `held-in-redo`, and the
  table takes a new case or arm in one entry
  (`lib/pipeline/__tests__/close-round-trip.test.ts`).
- With the production slots, 5.2's dev-route close still ends with the
  chapter row, its stamps and a report with `noToolCalls: true` (5.2's
  suite passes unchanged).
- `pnpm probe:close` with `PROBE_STAND_IN=1` and `PROBE_OUT` set, with
  `SMOKE_LLM_URL` at `pnpm mock` scripted for one tool step, finishes
  with a file for every step holding its messages and a saved report,
  and a hash of the source database is unchanged.
- `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `tsc -p electron/tsconfig.json`, `pnpm lint:docs`
  and `pnpm test:run` pass.

## Tests

- Vitest, in the files the criteria name, on a real in-memory database
  through `createTestDb`, with the step call scripted. Each new
  assertion gets a mutation check, since a green suite here proves
  little alone: drop a mark and the scan fails, set the mapping's
  default to `ok` and the verdict test fails, stop assigning outcomes
  after the rerun and the rerun test fails.
- The round-trip suite is the slice's main reversal coverage and the
  one later tools join.
- No Storybook: nothing here renders. No E2E: Slice 5.10 owns the full
  close through the UI.
- Manual: `pnpm probe:close` against the mock.
- **Warning sign, kept.** A real model first meets the runner in 5.5b.
  Here it's reviewed on a stand-in tool and the mock, so a tool
  contract that reads well can still fail at size. 5.8 and 5.9 wait for
  that run.

## Open questions

- **What does a step with `content-filter`, or `other` with no tool
  call, mean for a task?** Canon ends a task on a reply that finishes
  normally. A structured call retries a filter, and `other` with no raw
  reason reads as finished there. Starting answer: retry a filter once
  and stop as `cut-off` if it repeats; treat `other` as finished. The
  retry is one branch in 5.4's `parseFn`, and `stopped` may need a
  reason of its own, which C4 lets it grow.
- **Does a `length` reply holding whole tool calls get discarded?**
  Canon's "never a finished task, whatever it holds" and "retried once"
  read that way, and 5.4 drops them on that reading. Confirm, since it
  throws away calls that parsed.
- **Do retried attempts count against the 24?** Starting answer: no. 5.4
  retries inside one step call and the budget counts steps. It's a
  tuning constant either way.
- **Are tool descriptions pack content or code?** Canon keeps a reply's
  JSON contract out of the pack and is silent on tools. Starting answer:
  code, beside the schema, since a description that misstates a schema
  breaks the tool the way a bad contract breaks a reply.
- **Are `t` and `aw` handles the right way to show `entry_` and `haw_`
  rows?** `allocate` throws on both (`bimap.ts:8-11`), and
  `registerHandle` takes any id, so this doc uses it and 5.9's `set_pin`
  follows. Canon's
  [never-substituted table](../../../../data-model.md#non-llm-facing-kinds-never-substituted)
  still holds for the walker, but a close now shows these rows under a
  handle: does it want a line saying so?
- **Is `updateEntity` with a merged `state` the right action for a tool
  writing several sub-fields?** It's the only action that takes several
  today, and it parses the state, which the narrow path doesn't. The
  cost is that precedence for `state` runs ahead of the group, through
  the guard, instead of in a handler. The alternative is a narrow action
  taking a sub-field map. This slice owns the answer and settles it at
  planning, since the two functions ship here and 5.5b's tool table
  rests on them.
- **Should a close's steps carry the cache marker?**
  [Slice 5.4](./04-tool-step.md) leaves this here. Anthropic renders
  `tools`, then `system`, then `messages` (read 2026-11-01 in the Claude
  API reference, not tested by a request), so under `separate` the
  chapter's cache holds across a task's own steps and not across tasks,
  wherever the marker sits. A cache write costs about 1.25 times input
  and a read about 0.1, so a marker pays from a task's second step and
  loses a quarter on a task of one. Recommendation: pass it, and add the
  close to the marker's list in
  [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves).
  Until planning says so the driver passes none, as that list has it.
  Nothing changes shape either way.
- **How does `pnpm probe:close` open a story under `tsx`?**
  `loadAndPublish` calls `requestIdleCallback` for the encoder warm with
  no fallback
  ([Slice 5.1 → Implementation notes](./01-token-measure.md#implementation-notes)),
  and plain Node has no such global, so `loadOpenStory` throws there,
  after `publish`. Only `vitest.setup.ts` supplies it outside the app.
  Starting answer: the script sets the same no-op before its first open.
  The alternative is an optional call at the site, which would also let
  the setup's no-op go.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
