# Slice 1.5b — Stub LLM, fault scenarios, crash recovery

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.5a](./05a-pipeline-core.md) (the
  orchestrator, action layer, `deltas` table, reverse-replay
  primitive, `pipeline_runs` writers, ambient `actionId` slot,
  and `turnCaptureSink` this slice drives); [Slice 1.4](./04-ai-sdk-baseline.md)
  (the provider abstraction, `httpCallSink`, and the
  `createFetchWithCapture` wrapper the stub routes its calls
  through).
- **Blocks:** [Slice 1.7a](./07a-app-root-boot.md) (its boot
  sequence wires the `recoverInFlightRuns()` crash-recovery pass
  this slice ships) and [Slice 1.7c](./07c-smoke.md) (the
  milestone-1 end-to-end smoke triggers the stub through the
  orchestrator and expects an `httpCallSink` entry).

## Goal

Complete the spine's engine side with the two pieces that need a
realistic call path: the fault-injectable **stub LLM** and the
boot-time **crash-recovery** pass. The stub is a real AI-SDK
provider model driven by a scenario-parameterized fault-injecting
`fetch` routed through `createFetchWithCapture`, so it exercises
the real SDK request / parse / stream machinery and emits a
captured `httpCallSink` entry threaded with the run's ambient
`actionId`. The recovery pass reverse-replays orphaned
`pipeline_runs` at startup and returns a `RecoveryReport`. By the
end of this slice the pipeline machinery has been exercised
against the spec's named failure modes in vitest, and an
interrupted shutdown leaves the database consistent on next boot.

## Background

`docs/generation-pipeline.md` is the canonical spec. Slice 1.5a
shipped the framework primitives and proved them with a synthetic
phase; this slice adds the realistic provider surface and the
recovery edge.

**The stub LLM is a real `LanguageModelV3`** per the AI SDK
contract — the installed `ai@6` / `@ai-sdk/provider@3` use the V3
model spec (any "V1" framing in older spec prose predates the
v6 install). Rather than a transport-bypassing mock
(`MockLanguageModelV3` from `ai/test` never calls `fetch`), the
stub drives a real provider model whose `fetch` is a
scenario-driven fault injector wired through
`createFetchWithCapture`. That choice is load-bearing: it routes
the stub through `httpCallSink` (so the milestone DoD's "one
`httpCallSink` entry" holds and the ambient `actionId` threads
through the fetch wrapper's `getActionId`), and it runs the real
SDK parse path so a `malformed-json` scenario genuinely fails the
parser instead of a hand-faked error. The stream-shaping uses
`ai/test`'s `simulateReadableStream` / `convertArrayToReadableStream`.
The stub is exposed via a `'stub'` provider type added to the
`ProviderType` union from Slice 1.4; production builds reject
`'stub'` creation so it can't leak into a shipped app.

The crash-recovery pass runs in the fixed boot slot per the spec
(after migrations, before the first user-facing surface renders).
It reads `pipeline_runs WHERE finished_at IS NULL`, reverse-replays
each dirty orphan (marking `outcome='recovered'`), deletes
pre-first-delta clean orphans (delta count = 0), and returns a
`RecoveryReport`. Per-orphan `DeltaReplayError` is caught and
logged (`pipeline.recovery_failed`); boot is never blocked and
the orphan retries next boot. For milestone 1 the report is
merely logged via `logger` on any orphans recovered; the recovery
modal that consumes it lands with the Diagnostics Hub later.

## Required reading

- [`docs/generation-pipeline.md` → Phase function contract](../../../../generation-pipeline.md#phase-function-contract)
  — abort-as-value, the recoverable vs fatal error severity
  split that maps each fault scenario to an outcome.
- [`docs/generation-pipeline.md` → Fatal error categories](../../../../generation-pipeline.md#fatal-error-categories)
  — which provider failures are fatal and how they surface.
- [`docs/generation-pipeline.md` → User cancel = abort (no error path)](../../../../generation-pipeline.md#user-cancel--abort-no-error-path)
  — cancellation drains in-flight phases and reverse-replays;
  `outcome='aborted'`, not an error.
- [`docs/generation-pipeline.md` → Crash recovery via pipeline_runs marker table](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  — orphan-row reverse-replay; startup recovery pass;
  pre-first-delta delete semantics; recovery-failure policy.
- [`docs/generation-pipeline.md` → Reverse-replay](../../../../generation-pipeline.md#reverse-replay)
  — the substrate primitive (shipped in 1.5a) that
  `recoverInFlightRuns` consumes.
- [`docs/observability.md` → `httpCallSink`](../../../../observability.md#httpcallsink)
  — the sink the stub's call routes through; the `actionId`
  join key threaded from the fetch wrapper.
- [`docs/observability.md` → actionId threading](../../../../observability.md#actionid-threading)
  — the contract the `httpCallSink` threading verifies for a
  real call path.

## Scope: in

- Implement the fault-injectable stub LLM at `lib/ai/` internals:
  - A real AI-SDK provider model whose `fetch` is a
    scenario-driven fault injector routed through
    `createFetchWithCapture` (so `httpCallSink` captures it and
    the ambient `actionId` threads through the wrapper's
    `getActionId`). Stream bodies shaped with `ai/test`'s
    `simulateReadableStream` / `convertArrayToReadableStream`.
  - Scenario configs: `'happy'`, `'malformed-json'`,
    `'mid-stream-timeout'`, `'refusal'`, `'cancellation-respects'`.
  - Exposed via the `'stub'` provider type added to the
    `ProviderType` union (`lib/ai/types.ts`); the `'stub'` case
    wired into `createProviderModel` (`lib/ai/providers.ts`).
  - Production builds reject `'stub'` provider creation
    (compile-time build-mode constant, or runtime throw at the
    provider factory if the build flag isn't set).
- Implement `recoverInFlightRuns()` + `RecoveryReport` in
  `lib/pipeline/` (added to the public API; the app-startup
  bootstrap wiring lands in Slice 1.7):
  - Runs after migrations complete (per Slice 1.2's bootstrap
    order), before the first user-facing surface renders.
  - Reads the orphan rows (`pipeline_runs` where `finished_at`
    is null), oldest-first.
  - For each orphan: reverse-replay deltas (via 1.5a's
    primitive); on a non-zero delta count, update the marker
    with `outcome='recovered'`; on a zero count (pre-first-delta
    orphan) delete the row instead.
  - Per-orphan `DeltaReplayError` caught, logged
    `pipeline.recovery_failed` at `error` severity, orphan left
    `finished_at = NULL` for next boot; loop continues.
  - Returns a `RecoveryReport` with `reversed` and `failures`;
    M1 logs recovered orphans via `logger` — no UI consumer.
- `httpCallSink` `actionId` threading verification — the half
  deferred from Slice 1.5a (no call went out there): a stub run
  populates `HttpCall.actionId` with the run's `actionId`.
- Vitest suite:
  - **Malformed JSON** — stub returns unparseable structured
    output → phase fails with structural-error severity →
    `abortRun` → reverse-replay → `outcome='failed'`.
  - **Mid-stream timeout** — stub starts streaming, never
    completes within timeout → phase aborts → reverse-replay →
    `outcome='failed'`.
  - **Refusal** — stub returns a model-refusal pattern → phase
    aborts → reverse-replay → `outcome='aborted'` or `'failed'`
    per the error-severity split.
  - **User cancellation** — `abortController.abort()` mid-run →
    drain in-flight phases → reverse-replay → `outcome='aborted'`.
  - **Crash recovery** — seed `pipeline_runs` + `deltas` with
    synthetic orphans (with and without associated deltas);
    `recoverInFlightRuns()` reverse-replays the dirty orphans,
    deletes the clean ones, returns the expected `RecoveryReport`.
  - **Production stub-provider rejection** — with the
    production-mode flag set, attempting to construct a `'stub'`
    provider throws.
  - **httpCallSink actionId threading** — inside a stub run,
    assert `httpCallSink.beginCall` populates `HttpCall.actionId`
    with the run's `actionId`.
- Storybook stories for the stub LLM scenario picker if a
  developer-facing affordance is useful in Slice 1.7's smoke
  trigger; otherwise no UI ships here.

## Scope: out

- The pipeline core — orchestrator, action layer, `deltas` table,
  reverse-replay primitive, `pipeline_runs` writers, generation
  store, `turnCaptureSink`, ambient `actionId` slot. Slice 1.5a.
- Real LLM provider use through the framework — this slice uses
  the stub; real providers come in later milestones.
- Recovery modal UI. The spec describes it; `RecoveryReport` is
  plumbed and logged only. The surface lands with the
  Diagnostics Hub or its own pass later.
- Per-turn inspector UI, Call log, Logs tab — Diagnostics Hub
  work, separate milestone.
- Streaming-aware retry / partial-content persistence. V1 loses
  mid-stream partial content on failure (per the spec's
  deferred list).

## Acceptance criteria

- The stub LLM exposes a parameterized fault-injection surface; a
  stub run routes through `createFetchWithCapture` and produces
  an `httpCallSink` entry carrying the run's `actionId`.
- Production builds reject `'stub'` provider creation.
- All four vitest fault scenarios pass (malformed JSON,
  mid-stream timeout, refusal, cancellation), each taking the
  abort path with the correct outcome and logger emission shape.
- Crash recovery identifies orphans on a synthetic dirty startup,
  reverse-replays them (`outcome='recovered'`), deletes
  pre-first-delta orphans, and returns a `RecoveryReport`.
- `pnpm lint` passes.
- `pnpm lint:docs` passes.

## Tests

- **Stub LLM fault scenarios.** Four separate tests, one per
  fault mode (malformed JSON, mid-stream timeout, refusal,
  cancellation). Each asserts the pipeline takes the abort path
  with the correct outcome and logger emission shape.
- **httpCallSink actionId threading.** Inside a stub run, assert
  `httpCallSink.beginCall` populates `HttpCall.actionId`; pairs
  with Slice 1.5a's logger-side assertion to close the ambient
  `actionId` contract across both sinks.
- **Crash recovery.** Pre-populate `pipeline_runs` and `deltas`
  to simulate a dirty shutdown; assert the recovery pass reverses
  deltas, marks rows `'recovered'`, deletes clean orphans, and
  returns the expected `RecoveryReport`.
- **Production stub-provider rejection.** Build with the
  production-mode flag; assert attempting to construct a `'stub'`
  provider throws.

## Open questions

_All resolved at implementation; the decisions are recorded under
[Implementation notes](#implementation-notes) (stub wire format,
production guard, error-surfacing contract, `callWithRetry` scope).
Cross-cutting deferrals surfaced during the build were routed to the
[triage inbox](../../../triage.md)._

## Implementation notes

### Resolved developer decisions

- **Error-surfacing contract: catch-and-return, plus orchestrator
  hardening.** Stub phases catch provider and parse faults and return a
  `PhaseResult` — aborts and fatals are values, never thrown, per the
  spec. The orchestrator additionally wraps its phase loop and
  `handleEvent` in a `try`/`catch` so an unexpected throw routes to
  `abortRun` (reverse-replay, ambient-`actionId` clear, turn finalize)
  instead of escaping `runPipeline`. `handleEvent` consumes
  `applyDeltaAction`'s `MutationResult` and throws on `rejected`.
  Error-kind routing: an action-layer throw or a rejected mutation maps
  to `kind: 'action-layer'`; a generic phase-body throw maps to
  `kind: 'orchestrator'`. Action-layer hardening rode along: an
  `assertNever` over `PipelineAction['kind']` and an update-target-exists
  guard that returns `rejected` rather than updating zero rows.
- **Zero-arg `getPerTurnContext()`.** The orchestrator tracks the active
  run through a `domain.setActiveRun` / `clearActiveRun` pointer set at
  `beginRun` and cleared at commit and abort; the store getter resolves
  that run. Phases stay zero-arg per the spec. This completes the API
  1.5a intended — 1.5a shipped a `runId`-keyed stopgap with no production
  caller.
- **Stub reuses the Anthropic path.** The `'stub'` provider type drives
  `createAnthropic` with a scenario-parameterized fault-injecting `fetch`
  routed through `createFetchWithCapture`; canned bodies are
  Anthropic-shaped JSON. The scenario rides in the `modelId` argument, so
  `ProviderInstance` needed no new field, and no dependency was added.
- **Production guard via `__DEV__`.** `createProviderModel` throws on
  `'stub'` creation in production builds, guarded on `__DEV__` and
  mirroring the `lib/diagnostics/logger.ts` idiom; vitest leaves
  `__DEV__` undefined, so the stub stays available in tests.
- **`callWithRetry` shipped now.** The two-tier (provider, parse) retry
  helper and a provider-error classifier live in `lib/ai`, emitting a
  `lib/ai`-local `CallRetryError` union so `lib/ai` carries no upward
  dependency on `lib/pipeline`'s `PipelineError`. The helper returns a
  discriminated `ok` / `failed` / `aborted` union so the accumulated
  recoverable list survives the fatal and abort paths, matching the
  discriminated union that `generation-pipeline.md` now documents.
- **Ambient `actionId` threaded through the captured fetch.**
  `getActionId` is wired into `createFetchWithCapture` for both the
  `anthropic` and `stub` cases, closing the `httpCallSink`-`actionId`
  half deferred from 1.5a.

### Notable deviations and constraints for future slices

- **Recovery catches every per-orphan error, not only
  `DeltaReplayError`.** `recoverInFlightRuns` must never block boot, so
  its per-orphan `catch` is generic (matching the canonical spec's
  pseudocode). An earlier draft re-threw non-`DeltaReplayError`s, which
  would have blocked boot when an orphan's marker write itself failed.
  Keep the catch generic.
- **`mid-stream-timeout` is exercised without a real timer.** The
  scenario's stub `fetch` rejects immediately with a `TimeoutError`
  `DOMException` (which the AI SDK treats as an abort, so no internal
  backoff); the phase converts it to a `ProviderTimeoutError`. The
  asserted provider-timeout → retry → fatal path is identical to a
  genuinely stalled stream, but the test is load-deterministic — a
  real-timer version flaked under full-suite load. True mid-stream
  partial-content streaming stays Scope: out. As a result the
  hang-until-abort `fetch` survives only in the `cancellation-respects`
  scenario, whose abort lands before phase entry, so that branch is
  covered by the unit test rather than end-to-end.
- **`CallRetryError` → `PipelineError` mapping is test-only.** No
  production pipeline kind ships here, so the mapper lives in the fault
  suite; the first real pipeline kind will need a shipped equivalent.
- **Finalization-write hardening (added post-review).** `commitRun` and
  `abortRun` wrap the terminal `pipeline_runs` marker write in a
  `try`/`catch`: a failed write is logged (`pipeline.marker_write_failed`)
  and the run still finishes cleanly, so the ambient `actionId` and the
  active-run slot always clear. Surfaced by the final review — an
  un-wrapped write could leak both singletons into the next run; the
  orphaned marker is reconciled by boot recovery.

### Carried follow-ups

The chained-execution context-threading gap is recorded on the
[M5.2 roadmap entry](../../../roadmap.md) — the first real `chainsTo`
consumer (per-turn → chapter-close) will own it. The structured
`action-layer` `PipelineError` fields and their `CallRetryError`
→ `PipelineError` mapper are owned by [roadmap M7.3](../../../roadmap.md)
(the Diagnostics UI that renders them). The `callWithRetry` signature
reconciliation is resolved — `generation-pipeline.md` now documents
the discriminated `ok` / `failed` / `aborted` union.
