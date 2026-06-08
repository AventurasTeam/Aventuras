# Slice 1.5a — Pipeline core + persistence

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.2](./02-drizzle-schema.md) (the
  `pipeline_runs` marker table plus the `branches` /
  `story_entries` tables the delta path writes against; this
  slice adds the `deltas` table as an additive migration);
  [Slice 1.3](./03-observability-foundations.md)
  (`turnCaptureSink` slice declared empty, populated here;
  logger for `pipeline.*` / `action_layer.*` emissions). **Not
  1.4** — this slice exercises the framework with a synthetic
  in-test phase that yields a hand-built delta, so no provider
  call and no AI-SDK dependency.
- **Blocks:** [Slice 1.5b](./05b-stub-and-recovery.md) (the
  stub LLM, fault-scenario suite, and crash-recovery pass all
  build on the orchestrator, action layer, reverse-replay
  primitive, and `pipeline_runs` writers this slice ships);
  [Slice 1.6](./06-base-stores.md) (extends the `lib/stores/`
  module this slice creates); [Slice 1.7c](./07c-smoke.md)
  (the milestone-1 end-to-end smoke triggers a pipeline run
  through everything this slice ships).

## Goal

Land the transactional core of the pipeline framework so any
future milestone can build a concrete pipeline kind without
retrofitting framework work: the orchestrator (`lib/pipeline/`),
the cross-cutting action layer (`lib/actions/` — the Path A
delta-emitted handler), the `deltas` table + reverse-replay
primitive, the `turnCaptureSink` implementation in
`lib/diagnostics/`, the ambient `actionId` mechanism, and the
initial `lib/stores/` module shape containing the generation
store. The framework runs end-to-end against a **synthetic
phase** (no LLM): `beginRun` → phase yields a delta →
`applyDeltaAction` commits it → `commitRun`, with reverse-replay
on abort. By the end of this slice the engine reverses its own
writes and threads the ambient `actionId` through the logger and
turn-capture sinks; what remains is the realistic fault-injection
surface and boot-time recovery ([Slice 1.5b](./05b-stub-and-recovery.md)),
the rest of the domain stores ([Slice 1.6](./06-base-stores.md)),
and the UI wiring ([Slice 1.7b](./07b-ui-shells.md)).

## Background

`docs/generation-pipeline.md` is the canonical spec for the
framework. This slice implements the substrate-level primitives
only — no concrete pipeline kinds (narrative, classifier,
retrieval, translation, suggestion, lore-mgmt, wizard-assist)
land here; each lands with the milestone whose features need it.
Adding a kind later is a declaration plus a phase set, not a
re-architecture.

The action layer (`lib/actions/`) is for _cross-cutting
transactional writes_. Milestone 1's only concrete consumer is
the Path A delta-emitted handler: when a phase emits a delta, the
handler writes the SQL delta row inside one SQLite transaction,
with rollback on throw. **No domain content store exists anywhere
in milestone 1** — Slice 1.6 ships only the app-settings,
navigation, and `ui` stores; story / entity / entry content
stores arrive with feature milestones. So `applyDeltaAction` here
is **SQLite-only**: it writes the delta row plus the target-table
row (the tests exercise `story_entries`, which Slice 1.2 already
ships) in one transaction. The Zustand domain-store mirror the
spec describes is a deferred hook with zero registrations until a
content store exists; this is a deliberate narrowing of the
spec's eventual "apply the mirror via the appropriate store
mutator" behavior, faithful to the spec but scoped to what M1
can exercise. Single-store mutations (setting `currentRun` on the
generation store) are named functions inside the store file,
exposed through `lib/stores/`'s namespaced public API; the
orchestrator calls those directly for its own lifecycle
(`beginRun` / `commitRun` / `abortRun`). Only phase-emitted
deltas route through `lib/actions/`.

The generation store lives in `lib/stores/domain/generation.ts`
because the orchestrator is its primary mutator and tests benefit
from the uniform store mental model. This slice establishes the
`lib/stores/` module with that one store plus the initial
namespaced `index.ts` shape; Slice 1.6 extends both.

The ambient `actionId` mechanism is implementation-defined per
the observability spec, contract-critical per the diagnostics
cross-tab nav. **The slot lives in `lib/diagnostics/`** (not
`lib/pipeline/`): the sinks that read it already live there, so a
diagnostics-resident slot keeps the read a local module reference
and avoids a `lib/pipeline ↔ lib/diagnostics` import cycle (the
orchestrator already imports `logger`). The orchestrator _sets_
the ambient `actionId` via a diagnostics setter at `beginRun` and
clears it at `commitRun` / `abortRun`; `logger` and
`turnCaptureSink` read the slot internally; the `httpCallSink`
path consumes it through the `getActionId` callback Slice 1.4
already wired into the fetch wrapper (exercised in Slice 1.5b,
where a call actually goes out). A module-level mutable variable
is sufficient under the single-writer-per-branch invariant;
cross-branch concurrency is parked.

## Required reading

- [`docs/generation-pipeline.md` → Pipeline declaration](../../../../generation-pipeline.md#pipeline-declaration)
  — pipeline-kind shape, key shape rules, what a declaration
  carries.
- [`docs/generation-pipeline.md` → Phase function contract](../../../../generation-pipeline.md#phase-function-contract)
  — signature rules, reads via `generationContext`, writes,
  abort, error severity split.
- [`docs/generation-pipeline.md` → Orchestrator topology](../../../../generation-pipeline.md#orchestrator-topology)
  — singleton service, multi-run `txState`, gate derivation,
  config pre-flight, phase iteration.
- [`docs/generation-pipeline.md` → Action-layer integration](../../../../generation-pipeline.md#action-layer-integration)
  — narrow action functions over write-set declarations, Path
  A (`delta_emitted` to action layer), Path B (`stream_chunk`
  side-channel), atomicity-per-action.
- [`docs/generation-pipeline.md` → Event fan-out](../../../../generation-pipeline.md#event-fan-out)
  — bus shape, broadcast pub-sub semantics, synchronous
  fan-out, routing model.
- [`docs/generation-pipeline.md` → Run state transitions](../../../../generation-pipeline.md#run-state-transitions)
  — `beginRun` / `commitRun` / `abortRun` flow;
  `pipeline_runs` INSERT and UPDATE points.
- [`docs/generation-pipeline.md` → Reverse-replay](../../../../generation-pipeline.md#reverse-replay)
  — the substrate-level primitive: `ORDER BY log_position DESC`,
  single SQLite transaction, `DeltaReplayError`, the delta-count
  return value.
- [`docs/generation-pipeline.md` → Chained transition](../../../../generation-pipeline.md#chained-transition--no-user-edit-window)
  — the synchronous-`setState` "no-user-edit-window" invariant
  this slice pins in a test.
- [`docs/data-model.md` → Diagram](../../../../data-model.md#diagram)
  — the authoritative `deltas` table column set and its two
  indexes (`deltas_chain_idx`, `deltas_log_position_uniq`).
- [`docs/data-model.md` → Entry mutability & rollback](../../../../data-model.md#entry-mutability--rollback)
  — `undo_payload` shape per op, `log_position` assignment,
  `encoding_version` semantics.
- [`docs/observability.md` → `turnCaptureSink`](../../../../observability.md#turncapturesink)
  — sink contract, `TurnCapture` record shape, eviction rules.
- [`docs/observability.md` → actionId threading](../../../../observability.md#actionid-threading)
  — contract requirement, threading expectations,
  lint-guardrail note.

## Scope: in

- Create `lib/pipeline/` as the fourth `lib/*` module under
  Slice 1.1's discipline:
  - **Public API in `index.ts`**: `orchestrator` (singleton
    with `beginRun(kind, ctx)`, internal commit and abort
    paths wired through phase iteration);
    `definePipeline(...)` helper for kind declarations;
    `definePhase(...)` helper for phase functions; the
    ambient `actionId` reader re-exported for callers that
    think of it as pipeline-owned (delegates to the
    `lib/diagnostics/` slot — see ambient `actionId` below);
    the typed event-bus surfaces for UI subscribers.
  - Internal: event bus, phase iterator (including `parallel`
    group handling), `txState`, gate derivation, reverse-replay
    invocation on abort, the `pipeline_runs` writers.
  - `recoverInFlightRuns()` is **not** in this slice — it lands
    in Slice 1.5b. The reverse-replay primitive it consumes
    ships here.
- Create `lib/actions/` as the fifth `lib/*` module — the
  cross-cutting transactional layer:
  - **Public API in `index.ts`**: a `defineAction(...)` helper
    that wraps `(state, writeSet) => Promise<void>` around a
    SQLite transaction with rollback on throw; the concrete
    `applyDeltaAction` for Path A delta-emitted handling
    (writes one delta row to SQL plus the target-table row in
    the same transaction; assigns `log_position` via
    MAX+1-within-branch; **SQLite-only** — no Zustand domain
    mirror in M1, see Background).
  - No per-domain action subdirectories in this slice. Single
    store mutations live in their store file. Future
    cross-cutting actions (multi-store coordination beyond
    delta application) add subdirectories as needed.
- Create `lib/stores/` as the sixth `lib/*` module with the
  generation store and the initial namespaced index shape:
  - **Internal**: `domain/generation.ts` declaring
    `useGenerationStore` (raw Zustand handle, never exposed),
    plus named mutators `startRun(args)`,
    `recordPhaseResult(phase, result)`, `finishRun(outcome)`,
    `abortRun(reason)`, and a `getPerTurnContext()` helper per
    the architecture contract. Setters are package-private to
    this file; callers reach them through the namespace.
  - **Public API in `index.ts`**: namespaced exports —
    `export const domain = { useGeneration, startRun, recordPhaseResult, finishRun, abortRun }`.
    Selector hook plus mutation functions; never the raw store
    handle. Slice 1.6 extends this namespace.
- Add the `deltas` table to schema via an additive migration:
  - **Full canonical column set** per
    [`data-model.md → Diagram`](../../../../data-model.md#diagram):
    `id` PK, `branch_id` FK, `entry_id` (FK-less — `story_entries`
    has a composite PK `(branch_id, id)`, so a single-column FK
    is impossible; mirrors the `stories.current_branch_id`
    pattern), `action_id`, `log_position`, `source`,
    `target_table`, `target_id`, `op`
    (`'create'` / `'update'` / `'delete'`), `undo_payload`
    (JSON), `encoding_version` (writer-stamps `1` at v1),
    `created_at`. Plus the two indexes from the diagram:
    `deltas_chain_idx (branch_id, target_id, log_position)` and
    the `deltas_log_position_uniq (branch_id, log_position)`
    backstop.
  - Migration file added under `lib/db/migrations/` following
    Slice 1.2's drizzle-kit workflow.
- Implement `turnCaptureSink` in `lib/diagnostics/` (the
  declared-empty slice from 1.3):
  - `beginTurn({ actionId, kind, branchId, anchorEntryId? })`
    appends a new `TurnCapture` to the `turnCaptures` ring buffer
    (cap 100). `kind` is the pipeline kind; `anchorEntryId` is the
    turn-grouping key, left undefined here — real anchor stamping
    lands with the M2 / M3 capture producers.
  - `appendPhaseEvent(actionId, event)` looks up the row by
    actionId and pushes to `phaseEvents`.
  - `recordTargetEntry(actionId, entryId)` sets `targetEntryId`
    and `anchorEntryId` together (per-turn run; unused this slice —
    no real reply entries land yet).
  - `endTurn(actionId, outcome, reason?)` sets `endedAt`,
    `outcome`, `outcomeReason`, finalizes the row.
  - Eviction at cap 100: oldest finalized turn evicts; in-flight
    turns (no `endedAt`) protected.
- Wire `pipeline_runs` writes per spec:
  - `beginRun` issues an INSERT with `finished_at` NULL and
    `story_id` from the calling context, plus a call to
    `stores.domain.startRun({ kind, actionId, ... })` so the
    generation store reflects the in-flight run.
  - `commitRun` / `abortRun` UPDATE the row with `finished_at`
    and the appropriate `outcome` (`'completed'`, `'aborted'`,
    or `'failed'`), plus calls `stores.domain.finishRun(outcome)`
    or `stores.domain.abortRun(reason)` to clear the generation
    store's `currentRun`.
- Implement the ambient `actionId` mechanism:
  - Module-level `currentActionId: string | null` **inside
    `lib/diagnostics/` internals** (sinks read it locally; no
    `lib/pipeline ↔ lib/diagnostics` cycle).
  - Diagnostics public API exposes a setter/clearer the
    orchestrator calls (`beginRun` sets; `commitRun` /
    `abortRun` clear) plus the read accessor sinks and the
    fetch wrapper's `getActionId` consume.
  - `logger` and `turnCaptureSink` stamp the ambient `actionId`
    on their records; the explicit-bypass `WithoutTurn`
    variants leave it unset.
- Implement reverse-replay (the substrate primitive consumed by
  `abortRun` here and `recoverInFlightRuns` in Slice 1.5b):
  - Walk deltas for the run's `actionId` in **`log_position`
    DESC** order (the spec pseudo-code's `seq` is shorthand for
    `log_position`).
  - Apply each delta's `undo_payload` inside a single SQLite
    transaction; ROLLBACK and throw `DeltaReplayError` on
    failure.
  - Return the delta count so callers distinguish a
    pre-first-delta zero-delta case from a real reversal.
  - `abortRun` re-wraps a thrown `DeltaReplayError` as a
    `PipelineError` for the orchestrator's failure path and
    UPDATEs the `pipeline_runs` marker with `outcome='aborted'`
    or `'failed'` per cause.
- Vitest core suite (synthetic phases, no LLM):
  - **Happy path** — `beginRun` → a one-phase synthetic
    pipeline yields a hand-built `delta_emitted` →
    `applyDeltaAction` commits the delta + target row →
    `commitRun` → `pipeline_runs` row updated with
    `outcome='completed'`.
  - **Reverse-replay correctness** — a two-delta synthetic
    phase that returns `failed` on the second delta; assert
    both deltas applied then reversed in correct
    (`log_position` DESC) order inside one transaction.
  - **Ambient `actionId` threading** — inside a run, assert
    `logger.warn` emissions carry the run's `actionId`; after
    `commitRun`, assert the ambient accessor returns null.
  - **turnCaptureSink eviction** — fill `turnCaptures` to cap
    with a mix of finalized and in-flight turns; allocate one
    more; assert the oldest finalized turn evicts and the
    in-flight turns persist.
  - **Generation store namespace shape** — a fixture file
    outside `lib/stores/` imports `domain` from `lib/stores`,
    calls `domain.startRun(...)`, and reads
    `domain.useGeneration`; a deliberate attempt to import the
    raw `useGenerationStore` handle fails lint via the
    boundaries rule.
  - **Chained-transition synchronicity** — after
    `commitRun(predecessor)` with a defined `chainsTo`, an
    immediate synchronous read of `txState.runs` shows the
    successor present — no empty intermediate state. Pins the
    load-bearing invariant from
    [`generation-pipeline.md → Chained transition`](../../../../generation-pipeline.md#chained-transition--no-user-edit-window)
    (depends on Zustand's `setState` being synchronous); if a
    state-library swap ever breaks the invariant, this test
    catches it.
  - **Public-API surfaces** — fixture files outside
    `lib/pipeline/`, `lib/actions/`, and `lib/stores/` import
    only via each module's `index.ts`; deep-import attempts
    fail lint.

## Scope: out

- The fault-injectable stub LLM, the four fault-scenario tests,
  the `'stub'` provider type, and production rejection. Slice
  1.5b.
- Crash recovery (`recoverInFlightRuns`, `RecoveryReport`, the
  startup pass and its tests). Slice 1.5b consumes the
  reverse-replay primitive shipped here.
- All concrete pipeline kinds (narrative, classifier, retrieval,
  translation, suggestion, lore-mgmt, wizard-assist). Each lands
  with the milestone whose features need it.
- Zustand domain-store mirror inside `applyDeltaAction` — no
  content store exists in M1; the mirror hook is deferred.
- App-settings store, navigation store, the `ui` sub-namespace.
  Slice 1.6 extends `lib/stores/` with those.
- Streaming UI side-channel consumers — the routing model ships
  here per spec (Path B for `stream_chunk` events) but no UI
  consumes streaming chunks yet, and no streaming phase runs
  until the stub lands in 1.5b.
- Concrete `chainsTo` predicates and the kinds they target
  (per-turn → chapter-close ships with M5.2). No concrete kind
  declares `chainsTo` in M1, so no real chain runs. The framework's
  chained-execution capability — declaration, synchronous transition,
  and driving the successor to its own commit — is complete; the last
  of these landed in post-M1 reconciliation (see
  [Implementation notes](#implementation-notes)).
- Cross-branch concurrency. Single-writer-per-branch invariant
  holds for v1; the ambient `actionId` module-level slot is
  sufficient under that invariant.

## Acceptance criteria

- `lib/pipeline/`, `lib/actions/`, and `lib/stores/` exist under
  the public-API discipline; only `index.ts` is reachable from
  outside each module.
- `lib/stores/index.ts` exposes the namespaced `domain` group
  with the generation store's selector and mutators; the raw
  `useGenerationStore` handle is not in the public API.
- `deltas` table migration added with the full canonical column
  set + both indexes; runs idempotently on app start.
- The orchestrator executes a one-phase synthetic happy-path
  pipeline end-to-end: `beginRun` → phase emits a delta →
  `applyDeltaAction` commits the delta + target row →
  `commitRun` → `pipeline_runs` row updated with
  `outcome='completed'`.
- `abortRun` reverses deltas in `log_position` DESC order inside
  a single SQLite transaction and updates the `pipeline_runs`
  row with the appropriate outcome.
- `turnCaptureSink` is fully implemented (`beginTurn`,
  `appendPhaseEvent`, `recordTargetEntry`, `endTurn`);
  eviction at cap 100 protects in-flight turns.
- Ambient `actionId` threads through `logger` and
  `turnCaptureSink` during a run and is cleared after
  `commitRun` / `abortRun`.
- `pnpm lint` passes (boundaries, console ban, plus any
  ambient-actionId-bypass lint guardrail if landed).
- `pnpm lint:docs` passes.

## Tests

- **Orchestrator happy path.** One-phase synthetic pipeline;
  assert `pipeline_runs` lifecycle, delta in DB, generation
  store `currentRun` set during the run and cleared after,
  turnCapture finalized with `outcome='completed'`, logger
  emission with `pipeline.run_complete` kind.
- **Reverse-replay correctness.** A two-delta synthetic phase
  that fails on the second delta; assert both deltas applied and
  reversed in correct order inside one transaction.
- **Ambient actionId threading.** Inside a run, assert
  `logger.warn` emissions carry the run's actionId; after
  `commitRun`, assert the ambient accessor returns null. (The
  `httpCallSink` half of this contract lands in Slice 1.5b,
  where a call actually goes out.)
- **turnCaptureSink eviction.** Fill `turnCaptures` to cap with
  a mix of finalized and in-flight turns; allocate one more;
  assert the oldest finalized turn evicts and the in-flight
  turns persist.
- **Generation store namespace shape.** Fixture import via the
  namespace; deep-import of the raw handle expected to fail
  lint.
- **Chained execution.** A synthetic `pred` declaring
  `chainsTo: () => 'succ'` drives `succ` to completion: both markers
  finalize `completed`, `run_start` / `run_complete` fire for both in
  order, the map clears, and at the instant `pred` completes a
  hard-gate `succ` is already present (no-edit-window invariant). A
  failing successor reverse-replays only its own deltas; the
  predecessor stays committed.
- **Concurrency contract + coordination.** Unit tests over
  `checkConcurrencyContract` (idle/start, blockedBy, self-block,
  not-blocked, reversal-blocks-classifier, yieldsTo targets). Entry
  integration: a start blocked by an in-flight blocking kind returns
  `rejected`; `awaitRunTerminal` cancels (aborts + resolves) and finishes
  (awaits commit) and no-ops when absent; `start-after-yields` aborts the
  yielding run before the incoming one starts. Gate returns true under
  `reversalInProgress`.
- **Public-API surfaces.** Fixture files import only via each
  module's `index.ts`; deep-import attempts fail lint.

## Open questions

_All three resolved at implementation; the decisions are recorded
under [Implementation notes](#implementation-notes) (`deltas.source`,
ID generation, ambient lint guardrail)._

## Implementation notes

### Resolved developer decisions

- **Both delta engines built, round-trip tested.** Forward diff
  (`computeUndoPayload`) and reverse apply (`applyUndoPayload`)
  ship together with a property test asserting they are exact
  inverses across the null-sentinel matrix. The encoding is
  de-risked now rather than incrementally — no further data-model
  changes are expected to the rollback shape.
- **Atomicity via a `lib/db` ops-array primitive, not drizzle.**
  `runInTransaction(ops: SqlOp[])` (ops built via drizzle
  `.toSQL()`) commits the whole write-set in one unit, with three
  platform executors (desktop single-IPC, native
  `withTransactionSync`, vitest node:sqlite). Drizzle's own
  `db.transaction()` issues begin/commit as separate IPC
  round-trips on the sqlite-proxy driver, which is unsafe when a
  no-gate run interleaves on the shared connection; that route is
  deliberately avoided.
- **Zod is the source of truth for JSON-column shapes.** The
  null-sentinel discrimination is a runtime decision, so a runtime
  schema is required (TS types, including drizzle `.$type`, are
  erased). `entryMetadataSchema` is authored once and feeds the
  drizzle column via `z.infer` — no duplicated row type.
- **Minimal run context, explicit `RunCtx`.** `getPerTurnContext()`
  returns `{ actionId, abortSignal, intermediates }`; the
  orchestrator entry is `runPipeline(kind, ctx)` with an injected
  `RunCtx` carrying `{ storyId, branchId, db, runInTransaction }`.
  The spec's zero-arg `runPipeline(kind)` assumes a loaded story
  (1.6+); the synthetic harness injects context, and global db
  wiring lands in 1.7.
- **`deltas.source` uses an existing enum value.** `PipelineAction`
  carries `source`; synthetic tests pass `ai_classifier`. The
  data-model enum was not extended for a non-load-bearing test
  value. (Distinct from the action-method gate field
  `MutationSource`.)
- **IDs via a shared `lib/ids.ts` helper.** `generateId(prefix)`
  backed by a cross-platform UUIDv4 polyfill (Hermes lacks
  `crypto.randomUUID`). Kind-prefixed: `run_…`, `act_…`,
  `delta_…`.
- **Ambient lint guardrail deferred.** The sink-bypass lint rule
  stays the observability-spec followup; the `WithoutTurn` naming
  plus the index-only module boundary already make a bypass
  reviewable.

### Notable deviations & constraints for future slices

- **`undo_payload` is column-keyed.** op=update stores
  `{ <column>: <pre-change partial> }` (null for create);
  reverse-replay iterates the payload's top-level keys as target
  columns. The plan's op=update test originally asserted the
  unwrapped partial, which would have broken the reverse-replay
  consumer; corrected to the wrapped shape. Any future
  delta-logged table's op=update must honor this.
- **Reverse-replay threads a per-row working copy in `log_position`
  DESC.** Multiple op=update deltas to the same row, even touching
  disjoint JSON sub-keys, must compose onto an evolving copy. The
  naive per-delta whole-column SET computed from a single
  pre-transaction read silently clobbers the earlier undo (a
  restored value is lost, the run commits corrupt). Do not revert
  to that shape; the disjoint-sub-key regression test guards it.
- **`TARGET_TABLES` is a descriptor**, not a bare table map:
  `{ table, idCol, branchCol? }` per target, so composite-keyed
  tables (`story_entries` on `(branch_id, id)`) build a correct
  WHERE on reverse-replay.
- **Delta-engine load-bearing invariants.** Per the data-model
  hard schema rules: record sub-fields must be non-nullable, and a
  leaf never stacks optional over nullable. The engines assume
  this and have no runtime guard yet. Any new delta-logged schema
  must honor it; add a `classify()`-time assertion when the first
  real entity-state schema lands.
- **Cross-module tests reach the shared in-memory test db.** Tests
  deep-import `@/lib/db/__tests__/test-db`; eslint
  `boundaries/dependencies` is off for test files only. Shipped
  code stays gated, and the public-API surface is still asserted
  via `eslint.lintText` on a non-test fixture path.
- **Reverse-replay runtime exercise is partial.** The native
  `runInTransaction` executor and the op=delete reverse path ship
  unexercised (no native vitest, no M1 delete action); both delta
  engines have only `story_entries` / fixture coverage. First real
  exercise: the 1.7 on-device smoke and the first classifier
  slice.

### Carried follow-ups (Slice 1.5b / later)

- **Error-surfacing contract.** The `MutationResult.rejected`
  phantom arm, the unexpected-throw-in-phase leak (an infra throw
  escapes `runPipeline` without reverse-replay or ambient/turn
  cleanup), and `PipelineError`'s M1-subset optional fields are
  promoted to
  [Slice 1.5b → Open questions](./05b-stub-and-recovery.md#open-questions),
  so the plan-slice gate forces the decision before its fault suite
  is built. The related action-layer hardening (an `assertNever`
  over `PipelineAction['kind']` and an update-target-exists guard)
  rides along with whichever contract is chosen.
- **Desktop parallel-group `log_position` serialization is assumed,
  not verified.** vitest cannot exercise the Electron IPC
  concurrency path; the `deltas_log_position_uniq` index is the
  correctness backstop. Cover in 1.5b's fault scenarios.

### Post-M1 reconciliation

- **Chained execution completed (was scope:out).** 2026-06-03. The
  original brief shipped only the synchronous store transition
  (predecessor-remove + successor-add in one `setState`) and parked
  the successor unexecuted, deferring execution to M5.2. The
  orchestrator now drives the chained successor to its own
  commit/abort: `runPipeline` loops over commits, `commitRun` returns
  the successor, and `startChainedSuccessor` brings it live (marker
  row, active pointers, turn capture, `run_start`) before its phases
  run — marker-before-phases so a mid-chain crash recovers by the
  successor's own `actionId`. `runPipeline` awaits the whole chain and
  returns the origin run's `TxResult`; downstream outcomes are
  bus-observable. `chainsTo` narrowed to
  `(run: RunState) => string | null` (dropped the `app` arg) — the
  predicate sources its own deps at the definition site, keeping the
  orchestrator agnostic to app state. Still out: concrete predicates
  and kinds; "no concrete chain runs" holds in M1.
- **Concurrency contract + run coordination (were unbuilt).** 2026-06-03.
  `concurrencyPolicy` shipped as a declared-but-unenforced type;
  `runPipeline` started unconditionally. Added `checkConcurrencyContract`
  (`blockedBy` rejects, `yieldsTo` aborts the running targets first,
  `reversalInProgress` keeps a periodic-classifier out of a reversal's
  wait→sweep window), consulted at `runPipeline` entry. A blocked start
  returns `RejectedStart` (`{ outcome: 'rejected', blockedBy }`) — no run,
  so the union widens `runPipeline`'s result. The check + run registration
  are synchronous (`reserveRun` before any await) to close the
  check-vs-register race. `isUserEditBlocked` now also returns true while
  `reversalInProgress`. Added the generic `awaitRunTerminal(kind,
disposition)` (backed by a `terminal` deferred on `RunState`) that
  `yieldsTo` reuses. Synthetic-tested
  only — `yieldsTo`, `reversalInProgress`, and `awaitRunTerminal`'s real
  callers (classifier, prose reversals, chapter-close phase 0) land M2/M3/M5;
  no concrete kind declares a `concurrencyPolicy` in M1.
