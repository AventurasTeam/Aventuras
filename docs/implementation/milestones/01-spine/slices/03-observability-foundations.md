# Slice 1.3 — Observability foundations

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.2](./02-drizzle-schema.md) — logger
  gates on `app_settings.diagnostics.enabled`, which requires the
  `app_settings` row to exist.
- **Blocks:** 1.4 (provider emissions through logger,
  `httpCallSink` populates the declared store slice), 1.5
  (pipeline emissions through logger, `turnCaptureSink` populates
  the declared store slice), and every later subsystem that
  emits.

## Goal

Land `lib/diagnostics/` as the second `lib/*` module. By the end
of this slice the logger is callable from any subsystem, every
emission flows into a Zustand `diagnosticsStore`, the master
toggle (and debug-level toggle) gate emissions per the
observability spec, console mirroring is wired, and direct
`console.*` calls outside `lib/diagnostics/` are eslint-banned.
The store declares all three sink slices (`logEntries`,
`httpCalls`, `turnCaptures`) so downstream slices populate them
without re-shaping.

## Background

`docs/observability.md` is the canonical spec for the entire
diagnostics layer; this slice implements only the logger half of
the substrate. The two structural sinks (`httpCallSink`,
`turnCaptureSink`) have downstream dependencies — the HTTP
wrapper for `httpCallSink` (lands in slice 1.4) and the
orchestrator's ambient `actionId` mechanism for `turnCaptureSink`
(lands in slice 1.5). Slice 1.3 ships the empty store slices for
them so each later slice plugs in without restructuring the
store.

The logger is reserved for **semantic** emissions where a
subsystem deliberately reached for "this is noteworthy." It's
not the structural-events channel — phase boundaries and action
commits flow through the per-turn capture sink later. Three
levels only: `error | warn | debug`, no `info`.

Master gate is OFF by default in production, ON during `pnpm
dev` via launch-config override. When the master flips OFF the
three in-memory ring buffers clear immediately ("off means
off"); persisted `probe_captures` are NOT touched (memory
probe's existing rule, unrelated to this slice).

## Required reading

- [`docs/observability.md` → Logger contract](../../../../observability.md#logger-contract)
  — levels, semantics, what the logger is vs is not for.
- [`docs/observability.md` → Record shape](../../../../observability.md#record-shape)
  — exact `LogEntry` shape including the optional `actionId`
  field.
- [`docs/observability.md` → Kind namespace](../../../../observability.md#kind-namespace)
  — the `LogSubsystem` closed union, `LogKind` template-literal
  type, runtime regex for event-name half.
- [`docs/observability.md` → Console mirroring](../../../../observability.md#console-mirroring)
  — dual-emission semantics when master is on.
- [`docs/observability.md` → Direct-console drift](../../../../observability.md#direct-console-drift)
  — the eslint rule banning `console.*` outside the logger
  module.
- [`docs/observability.md` → Gating model](../../../../observability.md#gating-model)
  — master and debug-level toggles, settings paths, wipe
  semantics.
- [`docs/observability.md` → Substrate](../../../../observability.md#substrate)
  — three-slice store layout, renderer-side placement, ring
  buffer caps.
- [`docs/observability.md` → Lifecycle](../../../../observability.md#lifecycle)
  — on / off / app-quit transitions; ring-buffer clear behavior.

## Scope: in

- Add `zustand` to project dependencies; `diagnosticsStore` is
  the first Zustand store in the codebase.
- Create `lib/diagnostics/` as the second `lib/*` module under
  Slice 1.1's discipline:
  - **Public API in `index.ts`**: `logger` (with
    `error` / `warn` / `debug` methods; threads the ambient
    `actionId` per
    [`observability.md → Ambient actionId mechanism`](../../../../observability.md#ambient-actionid-mechanism));
    `loggerWithoutTurn` (same methods, explicit no-turn paths
    only — boot, hydration, background workers outside any
    run); `useDiagnosticsStore` selectors for read-only access
    from UI; types (`LogEntry`, `LogLevel`, `LogSubsystem`,
    `LogKind`, plus stub types for `HttpCall`, `TurnCapture`,
    `PhaseEvent` so slices 1.4 / 1.5 have target shapes to
    fill). Raw sink primitives stay internal. Slices 1.4 and
    1.5 add `httpCallSink` / `turnCaptureSink` to the public
    API following the same split (turn-threading default plus
    a `*WithoutTurn` variant each).
  - Internal organization is the implementer's call. Likely
    shape: `store.ts` (Zustand store), `logger.ts` (emission
    plus mirroring), `gate.ts` (master + debug gates), `kinds.ts`
    (`LogSubsystem` union, `LogKind` type, snake_case regex),
    `types.ts` (record shapes).
- Declare the three store slices in `diagnosticsStore`:
  - `logEntries: LogEntry[]` — populated by `logger`; ring
    buffer capped at 500 entries with FIFO eviction.
  - `httpCalls: HttpCall[]` — empty array; populated by
    `httpCallSink` in slice 1.4.
  - `turnCaptures: TurnCapture[]` — empty array; populated by
    `turnCaptureSink` in slice 1.5.
- Declare the `LogSubsystem` union with the spec's initial
  members: pipeline, action_layer, classifier, retrieval,
  provider, embedder, translation, memory. Adding a new
  subsystem extends the union in one place; UI iterates it.
- `LogKind = ` template literal type `${LogSubsystem}.${string}`.
  Dev-build runtime check applies the snake_case regex to the
  event-name half and emits a `console.warn` on drift.
- `logger.<level>(kind, fields, opts?)` API: writes a
  `LogEntry` to the store, mirrors to `console.<level>` when
  master is ON, no-ops at function entry when master is OFF
  (debug also gated by `debug_level_enabled`).
- ULID generator. Lives in `lib/diagnostics/` internals for now;
  if a third consumer needs ULIDs (likely slice 1.5 for
  pipeline-run IDs), extract to its own `lib/ulid/` module
  then.
- Master gate hydration:
  - Cold-start default OFF. Logger init reads
    `app_settings.diagnostics.enabled` from `lib/db` once
    migrations complete; flips gate state when settings
    hydrate.
  - `pnpm dev` build-time override sets the gate to ON without
    DB read, matching the observability spec's launch-config
    note.
- Console mirroring: when master is ON, every `logger.<level>`
  call mirrors to `console.<level>` after the store write. Store
  write happens first; mirror errors swallowed silently.
- Ring buffer clear on master-OFF: all three in-memory slices
  reset to empty arrays atomically per the spec's "off means
  off" rule.
- ESLint rule: ban `console.*` outside `lib/diagnostics/`. Use
  `no-restricted-syntax` for consistency with the existing
  wildcard-import ban. A narrow allowance for `pnpm dev` /
  on-purpose dev-only paths is acceptable; document any
  allowance inline.
- Update `.claude/rules/code.md` with one operational reminder
  about the logger discipline (route through `logger`, no
  direct `console.*` outside the module), citing the new
  `docs/code-conventions.md` section if one was added in slice
  1.1 — otherwise cite `docs/observability.md` directly.

## Scope: out

- `httpCallSink` implementation. Empty slice declared this
  slice; implementation lands in 1.4 with the HTTP wrapper.
- `turnCaptureSink` implementation. Empty slice declared this
  slice; implementation lands in 1.5 with the orchestrator.
- Ambient `actionId` mechanism. The optional `actionId` field
  on `LogEntry` stays `undefined` in this slice's emissions;
  populated once slice 1.5 wires the orchestrator-side
  threading.
- Memory probe (persistent captures). Unchanged from
  `docs/memory/probe.md`; lives in its own domain and lands
  with the memory-pipeline milestone.
- Diagnostics Hub UI. Defined at
  `docs/ui/screens/diagnostics/diagnostics.md`; not part of
  milestone 1.
- Provider-header denylist completeness mechanisms (build-time
  walk, dev-build heuristic warning). They land with `httpCallSink`
  in slice 1.4 since they're scoped to provider headers.
- Diagnostics enable / debug-level toggles in the Settings UI.
  Slice 1.7 wires the toggle into the settings screen; slice
  1.3 ships only the reader.

## Acceptance criteria

- `lib/diagnostics/` exists under the public-API discipline;
  only `index.ts` is reachable from outside the module.
- `zustand` installed and locked.
- `diagnosticsStore` declares all three slices; `logEntries` is
  a bounded ring buffer at cap 500 with FIFO eviction;
  `httpCalls` and `turnCaptures` are empty arrays with the
  correct typed shapes.
- `LogSubsystem` union has the eight initial members; adding a
  new member is a one-line change. `LogKind` template-literal
  type enforces the union prefix at compile time. Dev-build
  regex check on the event-name half emits a `console.warn` on
  drift.
- `logger.error / warn / debug` API works as specced — store
  write then console mirror when master ON; no-op at function
  entry when master OFF; `debug` additionally gated on
  `debug_level_enabled`.
- Master toggle hydrates from `app_settings.diagnostics.enabled`
  after migrations. `pnpm dev` override starts the gate ON
  without a DB read.
- Master flip OFF clears all three store slices immediately.
- ESLint rule fires on `console.*` calls outside
  `lib/diagnostics/`; passes inside the module.
- `pnpm lint` passes (boundaries rule from 1.1 + the new
  console ban).
- `pnpm lint:docs` passes.
- Vitest test suite covers gate behavior, ring buffer eviction,
  console mirroring on / off, type-level `LogKind` validation,
  and the snake_case regex warning.

## Tests

- **Logger roundtrip.** Master ON, emit at each level, assert
  the `LogEntry` lands in `logEntries` with the right shape and
  that `console.<level>` was called.
- **Master gate OFF.** Emit at each level; assert no store
  mutation, no console calls.
- **Debug-level OFF, master ON.** `logger.debug` no-ops; `warn`
  and `error` still emit.
- **Master flip OFF clears store slices.** Pre-populate
  `logEntries`, `httpCalls`, `turnCaptures` with synthetic
  rows; flip master OFF; assert all three slices are empty
  arrays.
- **Ring buffer FIFO at cap.** Emit 600 entries with master ON;
  assert `logEntries.length === 500` and the first 100 emissions
  evicted.
- **`LogKind` compile-time check.** A type test (vitest with
  `expectTypeOf`) asserts that a kind with an unknown subsystem
  prefix fails compilation and that valid kinds pass.
- **snake_case drift warning.** Emit a kind with a CamelCase
  event name in a dev build; assert `console.warn` was called
  with a useful message.
- **ESLint console ban.** A fixture file outside `lib/diagnostics/`
  that calls `console.log` fails lint; a fixture file inside
  passes.
- **Public-API surface.** Fixture file outside the module imports
  `logger`, `useDiagnosticsStore`, and types from
  `lib/diagnostics`; deliberate deep-import attempt is expected
  to fail lint.

## Open questions

- **ULID generator placement.** Internal to `lib/diagnostics/`
  for now (only consumer this slice). When slice 1.5 needs
  ULIDs for `pipeline_runs.run_id`, extract to a `lib/ulid/`
  module rather than letting two modules carry duplicate
  implementations. Flag here so slice 1.5's author remembers.
- **`console.*` allowance list.** Some `pnpm dev`-only paths
  (Vite / Metro bootstrap noise, error boundaries) may
  legitimately call `console.*`. Decide at authoring time
  whether to allow per-file overrides via an eslint-disable
  comment or to declare a directory allowlist; the former is
  more visible at the call site.
- **Type stubs for `HttpCall` / `TurnCapture` / `PhaseEvent`.**
  Slice 1.3 declares the shapes from the spec so slices 1.4 /
  1.5 fill the implementations. If the shapes change during
  authoring of 1.4 / 1.5 (additive fields, etc.), the canonical
  spec wins and slice 1.3's stubs migrate forward.
- **Console-mirror failure handling.** Mirror errors are
  swallowed silently per the slice. If mirroring becomes a
  failure mode worth surfacing (e.g., `console` itself is
  broken in some embedded WebView), revisit; not expected.
