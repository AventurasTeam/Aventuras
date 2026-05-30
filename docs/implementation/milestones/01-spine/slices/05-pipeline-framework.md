# Slice 1.5 — Pipeline framework

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.2](./02-drizzle-schema.md) (the
  `pipeline_runs` marker table; this slice adds the `deltas`
  table as an additive migration); [Slice 1.3](./03-observability-foundations.md)
  (`turnCaptureSink` slice declared empty, populated here;
  logger for `pipeline.*` emissions); [Slice 1.4](./04-ai-sdk-baseline.md)
  (the provider abstraction the stub LLM piggybacks on).
- **Blocks:** Slice 1.6 (extends the `lib/stores/` module this
  slice creates); Slice 1.7 (the milestone-1 end-to-end smoke
  triggers a stub-LLM pipeline run from the UI through
  everything this slice ships).

## Goal

Land the primitives that together let any future milestone
build a concrete pipeline kind without retrofitting framework
work: the orchestrator (`lib/pipeline/`), the cross-cutting
action layer (`lib/actions/` — the Path A delta-emitted
handler), the `turnCaptureSink` implementation in
`lib/diagnostics/`, the ambient `actionId` mechanism, and the
initial `lib/stores/` module shape containing the generation
store. Plus the fault-injectable stub LLM that vitest
exercises across the specced failure modes, and the
crash-recovery pass that runs after migrations on every app
start. By the end of this slice the spine is structurally
complete on the engine side; what remains is extending
`lib/stores/` with the rest of the domain stores (Slice 1.6)
and wiring it to the UI (Slice 1.7).

## Background

`docs/generation-pipeline.md` is the canonical spec for the
framework. This slice implements the primitives only — no
concrete pipeline kinds (narrative, classifier, retrieval,
translation, suggestion, lore-mgmt, wizard-assist) land here;
each lands with the milestone whose features actually need it.
The framework is built such that adding a kind later is a
declaration plus a phase set, not a re-architecture.

The action layer (`lib/actions/`) is for _cross-cutting
transactional writes_ — milestone 1's only concrete consumer
is the Path A delta-emitted handler: when a phase emits a
delta, the handler writes the SQL delta row and applies the
mirror to the appropriate domain store inside one SQLite
transaction, with rollback on throw. Single-store mutations
(setting `currentRun` on the generation store, toggling a
diagnostics flag, navigating to a story) are named functions
inside the relevant store file, exposed through
`lib/stores/`'s namespaced public API. The pipeline
orchestrator calls those mutators directly via the namespace
for its own lifecycle (beginRun, commitRun, abortRun); only
phase-emitted deltas route through `lib/actions/`.

The generation store lives in `lib/stores/domain/generation.ts`
because the orchestrator is its primary mutator and tests
benefit from the uniform store mental model. This slice
establishes the `lib/stores/` module with that one store plus
the initial namespaced `index.ts` shape; Slice 1.6 extends
both with the app-settings store, the navigation store, and
the `ui` sub-namespace.

The fault-injectable stub LLM is a real `LanguageModelV1` (per
the AI SDK contract) parameterized by scenario. Tests pass
scenario configs; the milestone-1 smoke trigger in Slice 1.7
uses a happy-path scenario. Production builds reject the
`'stub'` provider type so it can't leak into a shipped app.

The ambient `actionId` mechanism is implementation-defined per
the observability spec, contract-critical per the diagnostics
cross-tab nav. For v1, a module-level mutable variable inside
`lib/pipeline/` works under the single-writer-per-branch
invariant. Cross-branch concurrency is parked; revisit if v2
adds it.

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
- [`docs/generation-pipeline.md` → Crash recovery via pipeline_runs marker table](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  — orphan-row reverse-replay; startup recovery pass;
  pre-first-delta delete semantics.
- [`docs/observability.md` → `turnCaptureSink`](../../../../observability.md#turncapturesink)
  — sink contract, `TurnCapture` record shape, eviction
  rules.
- [`docs/observability.md` → Ambient actionId mechanism](../../../../observability.md#ambient-actionid-mechanism)
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
    ambient `actionId` accessor (`getCurrentActionId()`);
    typed event-bus surfaces for UI subscribers; the
    `recoverInFlightRuns()` function called once at app
    startup.
  - Internal: event bus, phase iterator, txState, gate
    derivation, reverse-replay logic, the module-level
    mutable `currentActionId` slot, the `pipeline_runs`
    writers.
- Create `lib/actions/` as the fifth `lib/*` module — the
  cross-cutting transactional layer:
  - **Public API in `index.ts`**: a `defineAction(...)`
    helper that wraps `(state, writeSet) => Promise<void>`
    around a SQLite transaction plus the relevant store
    mirror update, with rollback on throw; the concrete
    `applyDeltaAction` for Path A delta-emitted handling
    (writes one delta row to SQL, applies the mirror via
    the appropriate store mutator inside the same
    transaction).
  - No per-domain action subdirectories in this slice. Single
    store mutations live in their store file (see
    `lib/stores/` deliverable below). Future cross-cutting
    actions (multi-store coordination beyond delta
    application) add subdirectories as needed.
- Create `lib/stores/` as the sixth `lib/*` module with the
  generation store and the initial namespaced index shape:
  - **Internal**: `domain/generation.ts` declaring
    `useGenerationStore` (raw Zustand handle, never exposed),
    plus named mutators `startRun(args)`, `recordPhaseResult(phase, result)`,
    `finishRun(outcome)`, `abortRun(reason)`, and a
    `getPerTurnContext()` helper per the architecture
    contract. Setters are package-private to this file;
    callers reach them through the namespace.
  - **Public API in `index.ts`**: namespaced exports —
    `export const domain = { useGeneration, startRun, recordPhaseResult, finishRun, abortRun }`.
    Selector hook plus mutation functions; never the raw
    store handle. Slice 1.6 extends this namespace with
    app-settings and navigation entries plus a `ui`
    sub-namespace.
- Add the `deltas` table to schema via an additive migration:
  - Columns per `docs/data-model.md` for the deltas
    relationship: id PK, branch_id FK, target_table,
    target_id, op (`'create'` / `'update'` / `'delete'`),
    action_id FK, encoding_version, undo_payload (JSON),
    created_at. Confirm exact column set during authoring;
    match `data-model.md`'s diagram entry.
  - Migration file added under `lib/db/migrations/`
    following Slice 1.2's drizzle-kit workflow.
- Implement `turnCaptureSink` in `lib/diagnostics/` (the
  declared-empty slice from 1.3):
  - `beginTurn({ actionId, branchId })` appends a new
    `TurnCapture` to the `turnCaptures` ring buffer (cap
    100).
  - `appendPhaseEvent(actionId, event)` looks up the row by
    actionId and pushes to `phaseEvents`.
  - `recordClassifierOutput(actionId, raw)` mutates
    `classifierOutputRaw` (will go unused this slice;
    classifier isn't running yet).
  - `endTurn(actionId, outcome, reason?)` sets `endedAt`,
    `outcome`, `outcomeReason`, finalizes the row.
  - Eviction at cap 100: oldest finalized turn evicts;
    in-flight turns (no `endedAt`) protected.
- Wire `pipeline_runs` writes per spec:
  - `beginRun` issues an INSERT with `finished_at` NULL and
    `story_id` from the calling context, plus a call to
    `stores.domain.startRun({ kind, actionId, ... })` so the
    generation store reflects the in-flight run.
  - `commitRun` / `abortRun` UPDATE the row with
    `finished_at` and the appropriate `outcome`
    (`'completed'`, `'aborted'`, or `'failed'`), plus calls
    `stores.domain.finishRun(outcome)` or
    `stores.domain.abortRun(reason)` to clear the
    generation store's `currentRun`.
- Implement the ambient `actionId` mechanism:
  - Module-level `currentActionId: string | null` inside
    `lib/pipeline/` internals.
  - `beginRun` sets it; `commitRun` and `abortRun` clear it.
  - Exposed read-only via `getCurrentActionId()` in the
    public API.
  - Sinks (`logger`, `httpCallSink`, `turnCaptureSink`) read
    via this accessor — slices 1.3 and 1.4 already left an
    optional `actionId` slot; this slice populates it.
- Implement reverse-replay for aborts:
  - Walk deltas for the run's actionId in reverse insertion
    order.
  - Apply each delta's `undo_payload` inside a single SQLite
    transaction.
  - Update the `pipeline_runs` marker with
    `outcome='aborted'` or `outcome='failed'` per cause.
- Implement the crash-recovery startup pass per spec:
  - Runs after migrations complete (per Slice 1.2's
    bootstrap order), before the first user-facing surface
    renders.
  - Reads `pipeline_runs WHERE finished_at IS NULL`.
  - For each orphan: reverse-replay deltas, update marker
    with `outcome='recovered'`. Pre-first-delta orphans
    (delta count = 0) are deleted rather than marked
    recovered.
  - Returns a `RecoveryReport` with reversed and failed
    runs; the UI consumer (the recovery modal) lands in a
    later milestone, but the report is plumbed.
- Implement the fault-injectable stub LLM:
  - Lives at `lib/ai/` internals; exposed via the `'stub'`
    provider type added to the type union from Slice 1.4.
  - Returns a `LanguageModelV1` parameterized by a scenario
    config: `'happy'`, `'malformed-json'`,
    `'mid-stream-timeout'`, `'refusal'`,
    `'cancellation-respects'`.
  - Production builds reject `'stub'` provider creation so
    the stub can't leak into a shipped app (compile-time
    guard via build-mode constant, or runtime throw at
    provider factory if the build flag isn't set).
- Add `pipeline.*` and `action_layer.*` subsystem prefixes to
  the `LogSubsystem` union if they aren't already present
  from Slice 1.3.
- Vitest fault-scenario suite:
  - **Happy path** — `beginRun` → phase executes → delta
    emitted → `applyDeltaAction` commits the delta and
    applies the mirror → `commitRun` → `pipeline_runs` row
    updated with `outcome='completed'`.
  - **Malformed JSON** — stub returns unparseable
    structured output → phase fails with structural-error
    severity → `abortRun` → reverse-replay →
    `outcome='failed'`.
  - **Mid-stream timeout** — stub starts streaming, never
    completes within timeout → phase aborts →
    reverse-replay → `outcome='failed'`.
  - **Refusal** — stub returns model-refusal pattern →
    phase aborts → reverse-replay → `outcome='aborted'` or
    `'failed'` per error-severity split.
  - **User cancellation** — `abortController.abort()`
    mid-run → drain in-flight phases → reverse-replay →
    `outcome='aborted'`.
  - **Crash recovery** — seed `pipeline_runs` with
    synthetic orphan rows (with and without associated
    deltas); `recoverInFlightRuns()` reverse-replays the
    dirty orphans, deletes the clean ones, returns a
    `RecoveryReport`.
  - **Chained-transition synchronicity** — after
    `commitRun(predecessor)` with a defined `chainsTo`, an
    immediate synchronous read of `txState.runs` shows the
    successor present — no empty intermediate state. Pins
    the load-bearing invariant from
    [`generation-pipeline.md → Chained transition`](../../../../generation-pipeline.md#chained-transition--no-user-edit-window)
    (the "no-user-edit-window" guarantee depends on Zustand's
    `setState` being synchronous). If a state-library swap
    ever breaks the invariant, this test catches it.
- Storybook stories for the stub LLM scenario picker if a
  developer-facing affordance is useful in Slice 1.7's smoke
  trigger; otherwise no UI ships here.

## Scope: out

- All concrete pipeline kinds (narrative, classifier,
  retrieval, translation, suggestion, lore-mgmt,
  wizard-assist). Each lands with the milestone whose
  features need it.
- Real LLM provider use through the framework — Slice 1.7's
  smoke triggers the stub; real providers come in later
  milestones.
- App-settings store, navigation store, the `ui` sub-namespace.
  Slice 1.6 extends `lib/stores/` with those.
- Streaming UI side-channel consumers — the routing model
  ships here per spec (Path B for `stream_chunk` events) but
  no UI consumes streaming chunks yet.
- Chained pipelines (`chainsTo`). The framework supports the
  declaration; no concrete chain runs.
- Cross-branch concurrency. Single-writer-per-branch
  invariant holds for v1; the ambient `actionId` module-level
  slot is sufficient under that invariant.
- Recovery modal UI. Spec mentions it; surface lands with
  the Diagnostics Hub or its own pass later.
- Per-turn inspector UI, Call log, Logs tab — Diagnostics
  Hub work, separate milestone.

## Acceptance criteria

- `lib/pipeline/`, `lib/actions/`, and `lib/stores/` exist
  under the public-API discipline; only `index.ts` is
  reachable from outside each module.
- `lib/stores/index.ts` exposes the namespaced `domain`
  group with the generation store's selector and mutators;
  raw `useGenerationStore` handle is not in the public API.
- `deltas` table migration added; runs idempotently on app
  start.
- The orchestrator can execute a one-phase happy-path
  pipeline end-to-end: `beginRun` → phase emits a delta →
  `applyDeltaAction` commits the delta and applies mirror →
  `commitRun` → `pipeline_runs` row updated with
  `outcome='completed'`.
- `abortRun` reverses deltas inside a single SQLite
  transaction and updates the `pipeline_runs` row with the
  appropriate outcome.
- `turnCaptureSink` is fully implemented: `beginTurn`,
  `appendPhaseEvent`, `recordClassifierOutput`, `endTurn`.
  Eviction at cap 100 protects in-flight turns.
- Ambient `actionId` threads through `logger`,
  `httpCallSink`, and `turnCaptureSink` during a run;
  cleared after `commitRun` / `abortRun`.
- Stub LLM exposes a parameterized fault-injection surface;
  production builds reject `'stub'` provider creation.
- All five vitest fault scenarios pass (happy, malformed
  JSON, mid-stream timeout, refusal, cancellation).
- Crash recovery pass identifies orphans on a synthetic
  dirty startup, reverse-replays them, deletes
  pre-first-delta orphans, returns a `RecoveryReport`.
- `pnpm lint` passes (boundaries, console ban, plus any
  ambient-actionId-bypass lint guardrail if landed).
- `pnpm lint:docs` passes.

## Tests

- **Orchestrator happy path.** One-phase pipeline; assert
  `pipeline_runs` lifecycle, delta in DB, generation store
  `currentRun` set during the run and cleared after,
  turnCapture finalized with `outcome='completed'`, logger
  emission with `pipeline.run_complete` kind.
- **Reverse-replay correctness.** A two-delta phase that
  fails on the second delta; assert both deltas applied and
  reversed in correct order inside one transaction.
- **Stub LLM fault scenarios.** Four separate tests, one
  per fault mode (malformed JSON, mid-stream timeout,
  refusal, cancellation). Each asserts the pipeline takes
  the abort path with the correct outcome and logger
  emission shape.
- **Crash recovery.** Pre-populate `pipeline_runs` and
  `deltas` to simulate a dirty shutdown; assert the
  recovery pass reverses deltas, marks rows `'recovered'`,
  deletes clean orphans, and returns the expected
  `RecoveryReport`.
- **Ambient actionId threading.** Inside a run, assert
  `logger.warn` emissions carry the run's actionId;
  assert `httpCallSink.beginCall` populates
  `HttpCall.actionId` similarly; after `commitRun`, assert
  `getCurrentActionId()` returns null.
- **turnCaptureSink eviction.** Fill `turnCaptures` to cap
  with a mix of finalized and in-flight turns; allocate
  one more; assert the oldest finalized turn evicts and
  the in-flight turns persist.
- **Generation store namespace shape.** Fixture file
  outside `lib/stores/` imports `domain` from
  `lib/stores`; calls `domain.startRun(...)` and reads
  `domain.useGeneration` selector; deliberate attempt to
  import the raw `useGenerationStore` handle from
  `lib/stores/domain/generation` is expected to fail lint
  via the boundaries rule.
- **Production stub-provider rejection.** Build with
  production-mode flag; assert attempting to construct a
  `'stub'` provider throws.
- **Public-API surfaces.** Fixture files outside
  `lib/pipeline/`, `lib/actions/`, and `lib/stores/`
  import only via each module's `index.ts`; deep-import
  attempts fail lint.

## Open questions

- **`deltas` table column set.** Slice ships the table per
  `data-model.md`'s diagram; exact column subset for
  milestone 1 (encoding_version handling, undo_payload
  shape, target_table union) confirmed at authoring time.
  Additive migrations from later slices remain available
  if columns evolve.
- **Stub LLM scenario set completeness.** Five scenarios
  cover the spec's named failure modes. If Slice 1.7's
  smoke surfaces a scenario the stub can't represent,
  extend the scenario enum here; not expected.
- **Ambient `actionId` lint guardrail.** The observability
  spec notes "A lint rule banning sink calls that bypass
  the ambient provider is a worthwhile guardrail (tracked
  as an implementation followup)." If the lint rule is
  cheap to land in this slice, do; otherwise leave as the
  spec's followup. Don't block the slice on it.
- **Slice size.** This is the largest slice in milestone
  1. If implementation surfaces it being too big to land
     as one PR, splitting into 1.5a (orchestrator, action
     layer, `lib/stores/` initial setup with generation
     store), 1.5b (`turnCaptureSink`, ambient `actionId`,
     stub LLM, fault-scenario tests), and 1.5c (crash
     recovery, `deltas` table) is a clean fallback. Reassess
     after the framework primitives land; the split point is
     natural at the sinks-and-stub boundary.
- **Recovery report consumer.** The `RecoveryReport` is
  plumbed but no UI consumes it this slice. Lands with
  the recovery modal (Diagnostics Hub adjacent) in a
  later milestone. For milestone 1, the report is just
  logged via `logger.warn` on any orphans recovered; the
  user sees nothing.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
