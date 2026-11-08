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
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means), the
  event half of
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts), and
  [C1](../milestone.md#c1--a-closes-delta-shape)'s move to one group.
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
- `DeltaActionPort` gains a group method, and the row guard below, in
  all seven constructors: `lib/boot/bootstrap.ts:69`,
  `vitest.setup.ts:18`, `lib/pipeline/__tests__/harness.ts:57`,
  `lib/pipeline/__tests__/abort-reversal-hold.test.ts:44`,
  `lib/pipeline/definitions/periodic-classifier.test.ts:2382`,
  `lib/actions/turns/__tests__/stand-in-pass.ts:222` and
  `lib/actions/chapters/close-reversal.test.ts:266`. New types sit in
  `lib/actions/types.ts`, the one internal file `lib/pipeline` may
  import (`eslint.config.js:136-137`).
- That method is a new function, `applyDeltaActionGroupWithOutcomes`. It
  returns per-action outcomes, indexed by action and assigned after the
  rerun (`apply-delta-action.ts:334-346`), so a link that lands on the
  rerun doesn't keep its first noop. Each carries the handler's `reason`
  and mark. An all-noop group returns its outcomes (`:348`). A plain
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
  returns a refusal (`apply-delta-action.ts:184`), so `MutationResult`
  doesn't change and the exact refusals pinned through it pass unedited
  (`entities/register.test.ts:443`, `state-patch-actions.test.ts:117`).
  Restated values: `state-patch-actions.ts:221,403,460,482,620,673`,
  `entities/register.ts:317`, `relationships/register.ts:152,209`,
  `threads/register.ts:203`, `lore/register.ts:136`,
  `register-awareness.ts:121`, `register-involvements.ts:81`, and
  `relationships/register.ts:289`, a delete whose pair is already gone,
  which is the state the user asked for.
- Gone rows:
  `state-patch-actions.ts:338,381,401,421,458,479,617,650,653,671,690`,
  `threads/register.ts:202`, and `MISSING_REF` at
  `live-refs.ts:233-237`, a literal rather than a `noopRefusal` call,
  which takes the mark by hand.
- A spelling shared by a restated or gone case and a rule follows the
  row it reads. `not-active` is restated on a retired row, and
  `not-retired` and `not-staged` on an active one; each is a rule on
  any other. `not-a-faction` and `parent-not-a-place` are gone when the
  row they name is missing, and a rule when it's another kind. Of
  `raiseCollisionFlag`'s refusals only `already-flagged` is restated,
  and only when the row's live flag already names the same partner for
  the same reason; another live flag is a rule. The reason strings
  don't change.
- The mapping from a group's outcome to one tool result, with `rejected`
  as its default. `USER_EDITED_SINCE_PROSE` maps to `skipped`, `restated`
  to nothing written, and `gone` to `rejected`, saying where the row
  went: a row this close merged names its survivor from the ledger.
  Across a call's actions and the fields its plan left out:
  - Any action landed: `ok`, naming every lost field and its reason,
    restated ones aside.
  - None landed: `rejected` if any was refused by a rule or gone, else
    `skipped` if any was protected, else `ok` with nothing written.
  - A whole-group refusal, the hard `not-found` an update or delete
    handler returns for a missing row included: `rejected`, with
    nothing written.
  - Every `PlannedAction` names at least one delta path, a delete
    included, no path both lands and is lost in one call, and
    `verdictOf` throws on either.

**The close's create and stamps as one group (developer decision,
2026-11-05).**

- Once `delta_group_emitted` lands, the metadata phase emits
  `createChapter` and every `stampEntryChapter` as one group, in C1's
  order. Each stamp stays its own delta anchored on the end entry, so
  reversal and the survival anchor read it as they do now. The
  developer moved it here whatever the measure said: "So what i'm
  thinking is we should take the results as they are right now and move
  it to the batch writer no matter what just because it's the more
  correct way to do it in my opinion."
- The `close_report` update stays a write of its own after the group:
  one group can't create and update a chapter row, since
  `updateChapter` reads committed rows.
- A refused group, or an action in it that doesn't land, fails the
  close. The metadata phase returns `failed` with an `action-layer`
  error whose detail names the action's kind and its reason, the error
  a thrown refusal gives today, so reversal, the failed Send and the
  retry at the next Send don't change. The close keeps its invariant, a
  chapter row over a fully stamped range, in its own code, so a noop a
  handler adds later fails it closed. The close declares no
  `onPhaseException`, so a returned failure reaches the same place a
  thrown one does.
- [Slice 5.2](./02-first-chapter.md)'s mid-burst cases are re-pointed or
  dropped here, since a group lands whole: criterion 5's abort between
  stamps, criterion 22's Cancel and head reversal mid-burst, criterion
  23's boot recovery mid-burst, and its accepted mid-close display, a
  surface reading a partial range.
- The tests' stand-in close
  (`lib/actions/turns/__tests__/stand-in-close.ts`) writes its create
  and stamps as one group before it holds; its `leaveOpen` run writes
  the create alone, a group of one. None of the tests that use it
  asserts an unstamped range during the hold.
- A hard bar (developer: "Q11: A"): on a release Android build with the
  reader holding 50 rows, a close on 5.2's dataset branch (133 stamps
  over 23,907 tokens) has no JS-thread stall over 500 ms in its write
  burst, timed as the longest gap between 16 ms ticks with the stop
  moment counted as a tick. A short chapter, such as one of the seed's at
  about 30 stamps, would pass trivially. The probe that timed it was
  temporary and isn't in the repo: 5.2's
  [Close measure](./02-first-chapter.md#close-measure) gives its method,
  and its [Implementation notes](./02-first-chapter.md#implementation-notes)
  say where the built database lives, outside git. 5.2 measured about 1.1 s
  with a delta per stamp. One group is one uninterruptible chunk, and
  Android's database is synchronous, so only a macrotask yield can split
  it. A miss takes, in order: one store patch per table per group, then
  a timer yield every 25 actions as the group prepares and every 25
  store patches after it commits, measured again after each.
- The slice ships as two stacked PRs: the action layer, the seam and
  the one-group close first, the runner on top of it. The bar is
  measured on the Galaxy Z Fold while the first PR is open and gates its
  merge, not its opening, and a fallback lands on that PR before it
  merges.
- [`generation-pipeline.md → Writes`](../../../../generation-pipeline.md#writes)
  already describes the group: `delta_emitted` leaves out the close's
  create and stamps, and `delta_group_emitted` carries them.

**The later-turn reader (C12).**

- `lib/actions/delta/later-turn.ts` selects a row's later deltas by
  C12's rule. A turn's action comes from its entry's `story_entries`
  `create` delta, found by `target_id` as `resolveRollbackWindow` finds
  it, whatever that delta's own anchor. An entry past E with no
  `create` delta, which only raw inserts leave, names no action, so a
  null-anchored delta can't be its turn's, though a delta anchored on
  it still counts (C12's first clause). It reads only deltas logged
  after E's create, which the commit-order assumption of
  [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor)
  makes safe.
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
  (`CLOSE_TASK_STEP_BUDGET`). Every step passes
  `cacheSystemPrefix: true`: a marker pays from a task's second step,
  and a task's steps follow at an agent's pace, not a turn's.
- The model's own message goes back as the SDK returned it, keeping its
  reasoning and calls. Each of a step's `calls` runs in order inside the
  generator and gets an answer before the next step. `invalidCalls` are
  skipped, since the SDK answered them in `responseMessages`. A step's
  answers, the SDK's and the driver's, go back as one `tool` message in
  the order of the calls, where `convertToLanguageModelPrompt` would
  merge the two with the SDK's first.
- A reply with no tool call at all ends the task, whatever its finish
  reason, and a reply with any call continues it, an invalid one
  included.
- After each step, whatever its status, the driver yields
  `retriedAttemptEvents(result, 'lore-mgmt')`, as the pass does
  (`periodic-classifier.ts:285`), so a retried attempt reaches the log.
- `stopped`, for `cut-off` or `window`, stops the task and keeps what
  landed, as the budget does. `failed` returns `{ status: 'failed' }`
  through `toPipelineError(error, 'lore-mgmt')`, `not-configured`
  returns a `config-resolver` failure, and `aborted` returns
  `{ status: 'aborted' }`.
- The abort signal is polled before each step and between calls.
- 5.6 shipped `close_task_start`; the driver emits it for each task as
  it starts, a task with no start rows included, with `part` numbered
  as [C4](../milestone.md#c4--close_report-v1)'s: parts from 1, and 0
  for Happenings and Awareness. A pure function gives `index` and
  `total` from the task, the part and the part count, by canon's order,
  so `3 of 7 — Identity` holds while tasks are still landing. 5.6 owns
  the store field and the label.

**Tools and the write path.**

- A tool is a name, a description, a Zod schema of a plain shape, which
  arguments hold ids, and a plan that reads ahead and returns a refusal
  or actions, each tagged with the fields it writes (C11's starting
  design).
- **A tool schema parses to what the model wrote (developer decision,
  2026-11-07).** The SDK replays the parsed value as the model's own
  call on the next step, beside a signed thinking block on Anthropic, so
  a schema that changes the value puts words in the model's mouth. No
  `.transform`, `.pipe`, `z.codec` or `z.stringbool`; no `.default`,
  `.prefault` or `.catch`; no `z.preprocess` or `z.coerce`; no string
  overwrites such as `.trim()`, `.toLowerCase()` or `.toUpperCase()`.
  [Slice 5.4](./04-tool-step.md#implementation-notes)'s step refuses
  only the forms it can see (a transform, and a schema with no JSON
  Schema form), so the rest is the tool author's contract. Every tool
  schema is a `z.strictObject`, nested objects included (developer,
  2026-11-08). The SDK tells the model each object takes no other keys
  but validates with the Zod schema, where a plain `z.object` strips a
  key the model added, so its replayed call changes, and a strict one
  refuses the call: a misspelt optional field is refused instead of
  quietly landing nothing.
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
  (`apply-delta-action.ts:318-325`):
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
  with `withHandlesDeep`. A read has no refusal: a missing row is an
  answer saying so, naming a survivor if the ledger has one.

**The ledger (C4).**

- A run-long object in the run's intermediates, seeded as the agent
  phase starts, in the shape 5.2's `report` phase reads:
  `Pick<CloseReport, 'calls' | 'stopped' | 'noToolCalls'>`. The driver
  clears `noToolCalls` on any tool call, an invalid one included.
- The close's intermediates, the range, the ledger and the run's id
  map, go through typed accessors in
  `lib/pipeline/definitions/close-intermediates.ts`, which keeps their
  keys private and holds the one missing-range failure the metadata and
  report phases share. The retrieval key and the pass's pre-run status
  stay as they are, and canon's per-kind contexts stay unbuilt.
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

- One `IdBiMap` for the run, under a key `close-intermediates.ts` owns,
  so a row keeps its short id across steps, tasks and parts. A row's name
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
- `system-half-stability.test.ts:346` gets a named list of the close's
  task templates, excluded from the `it.each`. The list starts empty, so
  the criteria on it and on the shared half's bytes sit in
  [Slice 5.5b](./05b-identity-threads.md), whose templates first fill
  it.

**`pnpm probe:close` (`scripts/close-probe.ts`).** Its precedent is
`scripts/classifier-parse-probe.ts`, `pnpm probe:classifier`
(`package.json:51`), with the same `SMOKE_LLM_*`, `PROBE_RUNS`,
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
- Every step passes `cacheSystemPrefix: true`
  (`lib/pipeline/definitions/close-agent/driver.test.ts`).
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
  one, keys `values` by delta path, gives a ref's value as a name, cuts
  a value to the bound, keeps a refused create's minted id and records
  a stop; a landed call shows in the next task's writes so far
  (`lib/pipeline/definitions/close-agent/ledger.test.ts`). A restated
  field stays out of `values`, from the plan or the handler
  (`lib/pipeline/definitions/close-agent/write-path.test.ts`).
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
- Each tool's schema parses its sample inputs to deep-equal values, so
  the call the SDK replays is the one the model wrote.
- Each tool's schema is strict, nested objects included, and refuses a
  sample with an extra key
  (`lib/pipeline/definitions/close-agent/tool.test.ts`,
  `lib/pipeline/definitions/close-agent/read-tools.test.ts`).
- The instructions macro's source reads no per-call variable, and the
  prose macro's reads the turns
  (`lib/prompts/bundled/bundled-pack.test.ts`).
- The stand-in case passes all five arms with no `held-in-redo`, and the
  table takes a new case or arm in one entry
  (`lib/pipeline/__tests__/close-round-trip.test.ts`).
- The metadata phase emits `createChapter` and every `stampEntryChapter`
  as one `delta_group_emitted`, in C1's order, each stamp its own delta
  anchored on the end entry, and the `close_report` update lands after
  the group as a write of its own
  (`lib/pipeline/definitions/chapter-close.test.ts`).
- A refused group, or one with an action that doesn't land, fails the
  close with an `action-layer` error naming the action's kind and its
  reason, and the close is reversed
  (`lib/pipeline/definitions/chapter-close.test.ts`).
- On a release Android build with the reader holding 50 rows, a close on
  5.2's dataset branch (133 stamps over 23,907 tokens; the build lives
  outside git, see 5.2's [Close measure](./02-first-chapter.md#close-measure)
  and [Implementation notes](./02-first-chapter.md#implementation-notes))
  has no JS-thread stall over 500 ms in its write burst, timed as the
  longest gap between 16 ms ticks with the stop moment counted as a tick.
  A miss takes the fallback the one-group item in
  [Scope: in](#scope-in) names. The numbers go in this doc's
  Implementation notes.
- With the production slots, 5.2's dev-route close still ends with the
  chapter row, its stamps and a report with `noToolCalls: true`. 5.2's
  suite passes, with its mid-burst cases re-pointed or dropped as the
  one-group item in [Scope: in](#scope-in) says.
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
- Manual: `pnpm probe:close` against the mock, and the close's write
  burst on a release Android build against the hard bar.
- **Warning sign, kept.** A real model first meets the runner in 5.5b.
  Here it's reviewed on a stand-in tool and the mock, so a tool
  contract that reads well can still fail at size. 5.8 and 5.9 wait for
  that run.

## Open questions

- **A path both landed and lost in one call.** `verdictOf` throws on
  it today, since C4 reads `landed` as values less `skippedFields` and
  the path would hide one or the other. 5.9's `merge_happenings`
  fan-out under user precedence is what reaches it: one call's actions
  over several link rows can land a path on one row and lose it on
  another. Pending a developer decision, among: keep the throw and give
  each action distinct paths for link-row fan-out; a per-action
  link-row flag; or a split where the model's answer names every loss
  while the ledger's `skippedFields` omit a path that also landed.

## Implementation notes

- **A refused write in the close's group fails the close (developer
  decision at slice planning).** The metadata phase reads the group's
  outcome: a whole-group refusal, or any action whose outcome isn't
  `landed`, returns a failure of kind `action-layer` naming the action
  and its reason. That is the error a thrown rejection gave before, so
  reversal, the failed Send and the retry at the next Send are
  unchanged, and the orchestrator's group path stays uniform, its
  outcomes values. The close's invariant, a row over a fully stamped
  range, lives in the close's code and fails closed on any future noop.
- **A tool writing several `state` sub-fields lands one `updateEntity`
  whose `state` merges them over the current state (developer decision
  at slice planning).** Precedence runs ahead of the group through the
  row guard (`fieldVerdicts`), and `updateEntity`'s handler doesn't
  change. The close holds the gate and a step's calls run in order, so
  nothing lands between the read and the write, and the handler already
  parses the whole state. The cost: a future tool that skips
  `fieldVerdicts` gets no precedence, which the write-path tests pin.
- **Tool schemas are `z.strictObject` (developer decision at slice
  planning, re-confirmed 2026-11-08).** The SDK tells the model that no
  other keys are allowed, for every schema, but validates with the Zod
  schema itself, so a key the model adds anyway is stripped by a plain
  `z.object`, changing its replayed call, kept by `z.looseObject`, and
  refused by `z.strictObject`. Strict over loose: a misspelt optional
  field is refused instead of quietly landing nothing. The cost is a
  step per refusal for a model that ignores the schema.
  `assertReplaySafe` pins it for every tool.
- **Every close step carries the cache marker (developer decision at
  slice planning).** A marker pays from a task's second step, and steps
  follow at an agent's pace, not a turn's. It stays on the last system
  block;
  [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves)
  lists the close.
- **Only the close's intermediates have typed accessors (developer
  decision at slice planning).** `close-intermediates.ts` holds the
  close's keys privately: the range, the shared missing-range failure,
  the ledger and the run's ids. The retrieval key and the pass's
  pre-run status are untouched, and canon's per-kind contexts stay
  unbuilt. 5.5a, 5.8 and 5.9 each add a close key, and this stops the
  casts multiplying for about one task.
- **The Fold measurement gates the first PR's merge, not its opening,
  and is pending (developer decision at slice planning).** A worker's
  device checks never block it, and the Android database is
  synchronous, so the old burst ran as one block and only a macrotask
  yield can split it. The Fold wasn't attached when the PR was
  prepared; its numbers land in these notes when the measure runs.
- **One slice, two stacked PRs by layer (developer decision at slice
  planning).** The first holds the action layer, the verdict seam and
  the one-group close, the second the runner. The slice doesn't split:
  no slice waits on either half alone, since 5.5b and 5.12 need the
  runner and the runner needs the seam, and nothing can be shed, since
  the round-trip suite is C9 and the probe is 5.5b's measuring tool.
- **A filtered step takes the cut-off path, and a `length` reply's
  calls are dropped (answered in
  [canon](../../../../generation-pipeline.md#cut-off-replies),
  developer, 2026-11-06).** A `content-filter` stop, calls or not, is
  retried once and then stops the task as cut off; an `other` finish
  with no raw reason is finished; a `length` reply never reaches the
  runner and the step is sent again. 5.4's step call does all three,
  so the driver only reads its statuses.
- **Retried attempts don't count against the 24-step budget.** The
  budget counts step calls, and 5.4 retries inside one; it is a tuning
  constant either way.
- **Tool descriptions are code, beside their schema.** A description
  that misstates its schema breaks the tool the way a bad contract
  breaks a reply;
  [`architecture.md → Structured output`](../../../../architecture.md#structured-output--the-json-contract-is-not-pack-content)
  says so.
- **A close shows `entry_` and `haw_` rows under `t` and `aw` handles.**
  `registerHandle` puts them on the run's map, which now maps a handle
  both ways, so a row shown twice keeps one handle; the walker still
  never substitutes them, and
  [`data-model.md → Non-LLM-facing kinds`](../../../../data-model.md#non-llm-facing-kinds-never-substituted)
  says so.
- **No full id reaches the model.** `withHandles` drops a `br_<uuid>:`
  qualifier and turns any other generated id still in the text into "a
  row", so a refusal reason or a text field that quotes one leaks
  nothing; this keeps canon's
  [placeholder rule](../../../../data-model.md#placeholder-substitution-llm-facing-handles)
  for a close's own text.
- **Where a rule refusal and a noop share a reason, the mark follows the
  row's state.** Retiring a retired row, returning an active one and
  promoting an active one are restated, and the same calls on a staged
  or retired row are rule refusals; a missing faction or parent is
  gone, and one of the wrong kind a rule refusal. A collision flag is
  restated only when the row's live flag already names the requested
  partner for the requested reason, and any other live flag is a rule
  refusal, since a row holds one flag (C11 outranks the earlier choice
  to restate any raised flag). No reason string changed, so the refusals the tests pin pass unedited.
- **A promote's `restated` mark follows the database row only, and its
  store guard reads the store copy of its own branch only
  (provisional).** The store copy can be older than the database while
  a story opens, so it proves no write landed, and the working set
  holds one branch while deltas can target another, so another
  branch's copy of the same id proves nothing.
- **The later-turn reader reads only the deltas logged after the
  anchor row's create.** A later turn's entry is created after the
  anchor, so its deltas log after that create, which the survival
  anchor's ordering assumption already rests on; the read is cheaper.
- **`verdictOf` throws on a planned action that names no delta path
  (provisional) and on a path both landed and lost in one call
  (pending a developer decision).** A pathless action would read as
  nothing written, and C4 reads `landed` as values less
  `skippedFields`, so a path in both would hide one or the other.
- **Dispatch checks every planned action before emitting a group.** A
  plan with a pathless action, or one whose source isn't
  `chapter_close`, fails before any write (C1), so a tool-author bug
  can't land half a write or read as another writer's under
  precedence.
- **A step's answers go back as one tool message, in the order of the
  calls (provisional).** The SDK answers an invalid call in its own
  message, so its merge put those first, and a template that labels
  results by tool name alone could read a valid write as failed; the
  model's own message stays as returned.
- **The ledger drops a value the tool left `undefined`.** C4's `values`
  hold only landed or proposed fields, so a field the plan left unset
  has no value to report.
- **A tool answer's `undefined` property goes out absent.** The task
  loop checks an answer is JSON before sending it and leaves such a
  property out, as `JSON.stringify` does, so a read's optional field no
  longer fails a close.
- **A row a task created counts as read for that task.** A landed
  create shows the row under a handle, and the task knows its fields,
  so a later write naming it in the same task needs no `read_row`. The
  read set is per task and part, so the next task reads it first.
- **The agent phase validates its whole slot table before the first
  entry runs, and a code step's context carries no ledger.** A
  misplaced task fails before any write; a code step makes no tool
  calls, so it has nothing to record.
- **A field both a later turn and the user wrote reports the user's
  reason.** Either protects it, and the user's standing value is the
  more useful thing for the model to hear.
- **`close_task_start` numbers parts as the report does:** from 1, and
  0 for the chapter-wide tasks. `CloseProgress`'s comment said 0-based
  and is corrected; nothing reads the field yet.
- **A read tool records a ledger call** with an empty `why`, no `turns`
  and `ok`, which the review's rule for an `ok` call with no field
  drops. An invalid call records nothing, though it clears
  `noToolCalls`.
- **`read_row`'s fields come from the task definition**
  (`CloseTaskDef.readFields`, keyed by row kind), so a test task's
  fields never reach a production registry.
- **The test stand-in close writes its create and stamps as one group
  before its hold**, a group of one when it leaves the range open. None
  of its seven users asserts an unstamped range during the hold.
- **The encoder warm is an optional call.** `loadOpenStory` calls
  `globalThis.requestIdleCallback?.()`, so a story opens under plain
  Node, where `pnpm probe:close` opens one; `vitest.setup.ts` keeps its
  no-op, which also keeps tests from building the encoder.
- **`pnpm probe:close` refuses a branch that owes a pass**, naming its
  unprocessed entries, since the close would run a classifier pass
  first. It numbers a saved step from its request, one past the replies
  the request sends back, so an attempt the step call retried saves
  beside its step instead of over it.
