# Observability

Diagnostics layer for inspecting what the AI pipeline did. Defines
the capture-and-storage substrate, the structured logger contract,
the two structural sinks (`httpCallSink`, `turnCaptureSink`), the
gating model, and the privacy / performance / cross-platform stance.

Companion surface doc is
[`ui/screens/diagnostics/diagnostics.md`](./ui/screens/diagnostics/diagnostics.md)
— the Diagnostics Hub that consumes these contracts. The memory
probe ([`memory/probe.md`](./memory/probe.md)) is the one
persistent surface in this family and pre-dates this doc; its
contract is referenced rather than restated here.

Design record:
[`explorations/2026-05-17-observability-substrate.md`](./explorations/2026-05-17-observability-substrate.md).

## Scope

**In:** observability contracts for inspecting AI-pipeline behavior
(prompts, retrieval state, classifier outputs, mutations, errors,
anomalies, performance), plus the structural surfaces that consume
those contracts.

**Out:** end-user analytics, external crash
reporting (none, by data strategy — see
[`tech-stack.md`](./tech-stack.md)), business-state surfaces (Plot,
World — domain surfaces that incidentally show classifier output),
parameter tuning beyond the memory probe (its capture+simulator
pattern doesn't generalize), production-support export bundles
(parked-until-signal), file-based persistent logging
(parked-until-signal).

## Audience

Dev / power-user, gated by an explicit toggle. Capture content is
technical (raw prompts, raw classifier JSON, raw event traces) —
no UX softening for non-developers. Off by default in production
builds.

## Substrate

Three storage modes coexist:

- **Persisted, story-anchored** — `probe_captures` table.
  Unchanged from the existing
  [memory probe design](./memory/probe.md). Genuine persistence is
  justified by the simulator workflow (capture today, return
  tomorrow with edited params).
- **In-memory, story-anchored** — per-turn diagnostic data keyed
  by `actionId`. Classifier raw output, event-bus trace,
  cross-references to HTTP call IDs and log entry IDs from the
  same actionId. Cap ~100 turns most-recent, FIFO.
- **In-memory, app-anchored** — HTTP call log (~200 cap) and
  structured log entries (~500 cap). No story dimension; ring
  buffers ordered by time-of-emission.

All three in-memory slices live in **one renderer-side Zustand
`diagnosticsStore`** with three slices: `turnCaptures`,
`httpCalls`, `logEntries`. Renderer-side because all HTTP and
classifier work happens renderer-side in both Electron and React
Native. Cross-platform with no IPC dance.

**Persistence is the exception, not the default.** The heuristic:
persistence is justified when the use case is "return to it
later" (across sessions, across days). It's not justified for
"see it now or recently" which an in-memory ring buffer covers.
Memory probe is the only case where return-to-it-later semantics
are load-bearing.

### Why not event-bus-driven

The existing event bus (per
[`generation-pipeline.md → Routing model`](./generation-pipeline.md#routing-model))
emits production events for state-flow consumers. This design
deliberately does NOT route diagnostics through it. Subsystems
already know they're doing something diagnostic-worthy; a direct
`httpCallSink.record(...)` or `logger.warn(...)` call is no
heavier than emitting a bus event and clearer about intent. The
event bus stays focused on production state-flow; diagnostics is
a parallel concern with no coupling.

### Ingress

Subsystems emit directly into sinks. The sinks are small
singletons living in the renderer's `diagnosticsStore` module:

- `logger` — for free-form structured emissions.
- `httpCallSink` — for HTTP request/response capture.
- `turnCaptureSink` — for per-turn phase events + classifier output.

Each sink no-ops at function entry when the master gate is off.
No middleware. No bus subscription.

### Lifecycle

- **Master toggle on** — sinks active. Ring buffers fill as
  subsystems emit. UI subscribes and renders live.
- **Master toggle off** — all sinks no-op. The three in-memory
  ring buffers **clear immediately**. "Off means off." Persisted
  `probe_captures` are NOT wiped (memory probe's existing rule —
  explicit "Clear all captures" is the only path).
- **App quit** — in-memory buffers vaporize. Probe_captures
  persist (existing behavior).

## Logger contract

Three levels — `error | warn | debug`. No `info`. Structural
events (phase boundaries, action commits) flow through the
turn-capture sink, not the logger. The logger is reserved for
**semantic** emissions where a subsystem deliberately reached for
"this is noteworthy."

- **`error`** — failure that did not recover (pipeline aborted,
  provider error after retries exhausted).
- **`warn`** — degraded path taken or anomaly handled (classifier
  clamped, retry succeeded, soft-fail, schema repair).
- **`debug`** — verbose detail, off by default even when master is
  on. Gated by a secondary `debug_level_enabled` toggle.

### Record shape

```ts
type LogEntry = {
  id: string // ulid
  emittedAt: number // ms epoch
  level: 'debug' | 'warn' | 'error'
  kind: LogKind // template-literal-typed
  fields: Record<string, unknown>
  actionId?: string // present when emission is turn-bound
}
```

### Kind namespace

`<subsystem>.<event_name>`, snake_case. The subsystem half is a
**closed union** that lives in one source-of-truth file
(`types/diagnostics.ts` or equivalent):

```ts
type LogSubsystem =
  | 'pipeline'
  | 'action_layer'
  | 'classifier'
  | 'retrieval'
  | 'provider'
  | 'embedder'
  | 'translation'
  | 'memory'

type LogKind = `${LogSubsystem}.${string}`
```

The template-literal type rejects any `kind` whose prefix isn't a
known subsystem at compile time. A runtime regex check
(`/^[a-z][a-z0-9_]*$/` against the event-name half) catches
snake_case drift in dev builds with a `console.warn`. Adding a
new subsystem extends the union; the Logs tab UI iterates the
same union directly to render subsystem filter chips, so
additions propagate to the UI without manual wiring.

Typed `fields` per kind (full per-kind schema enforcement) is
heavier than v1 needs. Fields stays `Record<string, unknown>`.

### Subsystem emission inventory

Illustrative, not exhaustive. The contract is the **shape**
(level, kind, fields, optional actionId), the namespacing
convention, and the expectation that subsystems route through
`logger` from their first commit:

- `pipeline.*` — `phase_failed`, `run_aborted`, `recovered`
- `action_layer.*` — `user_write_rejected`, `constraint_violation`
- `classifier.*` — `delta_clamped`, `schema_repair`, `empty_output`
- `retrieval.*` — `row_skipped_stale`, `empty_pool`, `knn_error`
- `provider.*` — `retry_succeeded`, `rate_limited`,
  `stream_interrupted`, `request_failed`
- `embedder.*` — `offline`, `compute_failed`, `staleness_detected`
- `translation.*` — `soft_failed` (when that followup lands)
- `memory.*` — periodic-classifier + chapter-close phase
  emissions

Kinds grow organically as subsystems land.

### Console mirroring

When the master gate is ON, `logger.<level>` writes the store
entry AND mirrors to `console.<level>`. Both gated by the same
master toggle. When OFF, both no-op.

Build-time launch config may override the stored default to ON in
`pnpm dev` so engineers don't need to flip the toggle every
session; this is launch-config-detail, not contract. Production
builds always default OFF at the stored level.

### Direct-console drift

A `console.<level>` call outside the logger module bypasses the
master gate (always fires, regardless of
`app_settings.diagnostics.enabled`) and never lands in the
in-memory `logEntries` slice. An ESLint rule banning direct
`console.*` calls outside the logger module — with a narrow
allowance for on-purpose dev-only paths — keeps the discipline
enforced. Lands when the logger module is built.

## Structural sinks

### `httpCallSink`

Every outbound HTTP request, app-global. Browser-dev-tools-Network
mental model.

```ts
type HttpCall = {
  id: string                       // ulid, assigned at beginCall
  startedAt: number
  method: string
  url: string
  requestHeaders: Record<string, string>   // redacted at sink boundary
  requestBody?: unknown
  source?: string                  // 'provider:<id>' | 'embedder:download' | ...
  actionId?: string                // present when call was made inside a turn

  state: 'in_flight' | 'completed' | 'failed'

  endedAt?: number
  durationMs?: number
  status?: number | null
  responseHeaders?: Record<string, string>  // redacted at sink boundary
  responseBody?: unknown
  streamed?: boolean
  error?: string
}

httpCallSink.beginCall(args: {
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody?: unknown
  source?: string
  actionId?: string
}): string                         // returns the assigned id

httpCallSink.completeCall(id: string, args: {
  status: number
  responseHeaders: Record<string, string>
  responseBody?: unknown
  streamed?: boolean
}): void

httpCallSink.failCall(id: string, error: string): void
```

#### Pairing

The `id` returned by `beginCall` is the handle. The HTTP wrapper
holds it locally between begin and complete/fail. No correlation
logic; the wrapper threads its own id through:

```ts
const fetchWithCapture = async (url, opts) => {
  const id = httpCallSink.beginCall({
    method: opts.method ?? 'GET',
    url,
    requestHeaders: opts.headers,
    requestBody: opts.body,
    source: opts.source,
    actionId: getCurrentActionId(),
  })
  try {
    const res = await fetch(url, opts)
    const body = await res.text()
    httpCallSink.completeCall(id, { status: res.status /* ... */ })
    return res
  } catch (err) {
    httpCallSink.failCall(id, String(err))
    throw err
  }
}
```

#### Streaming

Body accumulation during streaming happens **inside the wrapper**
— no incremental sink updates during the stream. At stream end,
`completeCall` fires once with the final concatenated body and
`streamed: true`. UI shows the in-flight indicator throughout,
then resolves to completed in one transition.

#### Ring buffer behavior

- `beginCall` allocates a slot. If buffer is at cap, oldest
  **non-in-flight, non-turn-resident** entry evicts. In-flight
  entries are protected; so are completed entries whose
  `actionId` is still in the `turnCaptures` buffer (preserves
  cross-tab nav from per-turn inspector for buffer-resident
  turns).
- `completeCall` / `failCall` mutate the existing slot in place;
  state flips to `'completed'` or `'failed'`. Row identity (ULID)
  stable across the transition, so React keys don't churn.
- Pathological "all 200 concurrent in-flight" → silent skip + a
  debug log entry. Essentially impossible in practice.

#### Header redaction

Auth-style headers are redacted at the **sink boundary**, not the
call-site. `beginCall` and `completeCall` both sanitize headers
through a denylist before store-write:

```ts
const REDACTED_REQUEST_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  // Provider-specific auth headers extend here
])

const REDACTED_RESPONSE_HEADER_NAMES = new Set(['set-cookie'])
```

Case-insensitive match. Redacted values render as `'***'` so the
header's presence is visible but the value is hidden. **Net
effect:** API keys exist in unredacted form only at the actual
`fetch()` boundary; they never reach the Zustand store, never
appear in the diagnostics hub, never can leak via
screenshot/share.

**Denylist completeness.** As new providers ship with custom
auth header names, the denylist must extend. Two mitigations
keep it from drifting:

- **Build-time test.** Walk all configured providers' header
  schemas and assert each header name maps to "known-safe" or
  "denylisted." Catches drift at PR time.
- **Dev-build runtime warning.** When a header name matches a
  heuristic regex (`/auth|key|token|secret|credential|cookie/i`)
  but isn't on the denylist, emit a `logger.warn`. Catches
  first-encounter drift at runtime.

Both land when the HTTP wrapper + sink are built.

### `turnCaptureSink`

One `TurnCapture` per turn, anchored to `actionId`, accumulated
across the turn's lifecycle.

```ts
type TurnCapture = {
  actionId: string
  branchId: string
  targetEntryId?: string           // set when AI entry lands; undefined for aborted-before-write
  startedAt: number
  endedAt?: number                 // undefined while in-flight
  outcome?: 'completed' | 'aborted' | 'failed'
  outcomeReason?: string
  phaseEvents: PhaseEvent[]
  classifierOutputRaw?: unknown    // pre-action-layer-validation structured output
}

type PhaseEvent = {
  phase: string                    // 'pre' | 'retrieval' | 'narrative' | ...
  kind: 'enter' | 'exit'
  at: number
  durationMs?: number              // present on 'exit'
}

turnCaptureSink.beginTurn(args: { actionId; branchId }): void
turnCaptureSink.appendPhaseEvent(actionId: string, event: PhaseEvent): void
turnCaptureSink.recordClassifierOutput(actionId: string, raw: unknown): void
turnCaptureSink.endTurn(actionId: string, outcome: TurnOutcome, reason?: string): void
```

#### No explicit cross-slice linking

`TurnCapture` does NOT store `httpCallIds[]` or `logEntryIds[]`.
The `actionId` on each `HttpCall` and `LogEntry` is the join key;
the per-turn inspector filters those slices by actionId at render
time. Single source of truth, zero linking drift, zero
append-coordination across sinks.

#### Eviction

Cap ~100 turns. When `beginTurn` pushes over cap, oldest
**finalized** turn evicts. In-flight turns (`endedAt` undefined)
are protected. Pathological "100 concurrent in-flight" → silent
skip + debug log entry (essentially impossible given pipeline
single-writer-per-branch).

### Ambient `actionId` mechanism

The cross-tab nav model depends on every HTTP call and log entry
made during a turn carrying the turn's `actionId`. This is
**contract-critical** but **implementation-defined**: the
mechanism by which sinks read the "current actionId" is the
implementation's choice (AsyncLocalStorage isn't usable in
renderers; React's async render context isn't AsyncLocalStorage-
friendly; a module-level mutable variable works under
single-writer-per-branch but breaks under cross-branch
concurrency).

**Contract requirement:** the orchestrator MUST set an ambient
actionId at `beginRun` and clear at `commitRun` / `abortRun`.
Sinks read from that ambient source. Implementations MUST
guarantee threading through every async hop during a turn — if a
subsystem fails to thread, correlations break silently (entries
appear in the global log without a turn pointer; no error, no
warning, just missing data).

Enforcement is via module public-API discipline per
[Slice 1.1](./implementation/milestones/01-spine/slices/01-code-conventions.md)'s
`eslint-plugin-boundaries` rule. The `lib/diagnostics/` module's
`index.ts` exposes only turn-threading wrappers (`logger`,
`httpCallSink`, `turnCaptureSink`) and explicit-bypass variants
(`loggerWithoutTurn`, etc., for paths that legitimately have no
ambient turn — boot, hydration, background workers outside any
run). The raw sink primitives stay internal and unreachable from
outside the module. External code physically cannot bypass the
ambient provider; the `WithoutTurn` naming distinction makes
intentional bypass reviewable.

## Gating model

### Settings fields

Under `app_settings.diagnostics.*` (inside the existing JSON, not
promoted to columns — matches placement pattern for every other
debug toggle):

- **`enabled: boolean`** — master toggle. Default `false`. When
  off: every sink and memory probe captures no-op. Console
  mirroring also off.
- **`debug_level_enabled: boolean`** — secondary. Default
  `false`. Only meaningful when master is on. When off,
  `logger.debug(...)` no-ops; warn and error still flow.

Per-story on `stories.settings.probe_mode_active: boolean`
(existing, unchanged) — gates memory probe persistent captures
for that story.

### Memory probe gate consolidation

The previously-defined `app_settings.diagnostics.probe_mode_enabled`
field is **renamed** to `app_settings.diagnostics.enabled` and
gains broader scope — now the master gate for the entire
diagnostics layer. Memory probe writes happen when master is ON
AND per-story `probe_mode_active` is ON. Net effect for memory
probe: same two-level gate, app-level field renamed and scope
widened. See
[`memory/probe.md → Schema delta`](./memory/probe.md#schema-delta).

### Wipe semantics

Master flips OFF → the three in-memory ring buffers
(`turnCaptures`, `httpCalls`, `logEntries`) clear immediately.
Persisted `probe_captures` are NOT wiped (memory probe's existing
rule). The asymmetry tracks the persistence asymmetry: ephemeral
data vaporizes on explicit off; persisted data only clears via
explicit "Clear all captures" action.

### UI placement

All toggles live under **App Settings · Diagnostics**. The
previously-placeholdered "view-logs button" is **subsumed** by
the Diagnostics Hub's Logs tab.

**Actions (⚲) menu gains: `Open Diagnostics Hub`.** Reachable
from every screen's top-bar (Actions menu is universal chrome per
the
[top-bar rule](./ui/principles.md#top-bar-design-rule)).
**Hidden when master toggle is OFF** — the toggle itself is the
discovery point.

Hub design lives at
[`ui/screens/diagnostics/diagnostics.md`](./ui/screens/diagnostics/diagnostics.md).

## Privacy

The in-memory-only stance changes the privacy profile materially.

- HTTP request headers (including provider API keys in
  `Authorization: Bearer ...`) are **redacted at the sink
  boundary** before any store-write. Auth-style headers replaced
  with `'***'`. Unredacted secrets never reach the Zustand store;
  they exist only inside the HTTP wrapper's local scope during a
  single request lifecycle.
- Prompt bodies (assembled story context, entity descriptions,
  retrieval results) live in RAM only. Vaporize on app quit.
- `probe_captures` remains the only diagnostic data that touches
  disk; payloads are gzipped retrieval-state JSON, not prompts or
  LLM responses. Sensitivity profile unchanged from memory
  probe's existing design.

**Outstanding concern** — the future "manual export to JSON file"
affordance (parked) WILL persist whatever the user chooses to
export, with the sensitivity that implies. The export feature's
own design pass owns the redaction policy (API keys auto-stripped
from headers; prompt bodies opt-in or auto-truncated).

## Telemetry boundary

**No external reporting.** Purely local. The diagnostics layer
does not phone home, does not submit crash reports to third
parties, does not ship telemetry. The user's diagnostic data
stays on their device. This matches the local data strategy
(see [`tech-stack.md`](./tech-stack.md)).

## Performance budget

"Should be undetectable" rather than "fastest possible."

- `logger.<level>(...)` — ~10–50 µs per call.
- `httpCallSink.beginCall` / `completeCall` — ~50–200 µs each,
  dominated by structured clone of request/response bodies.
- `turnCaptureSink.appendPhaseEvent` — ~10–50 µs.
- Memory probe — unchanged from existing budget (<5 ms light,
  <20 ms deep).

Ring buffers are bounded arrays with O(1) amortized eviction
(head-pointer rotation, no shifting). Zustand selector-based
subscribers re-render only when their slice changes — UI cost
scales with what's visible, not buffer churn.

**Master gate OFF → all sinks no-op at function entry.** O(1)
regardless of how chatty subsystems become.

## Memory ceiling

Worst-case estimates at default caps:

| Slice          | Cap | Per-entry typical             | Worst-case row | Total typical |
| -------------- | --- | ----------------------------- | -------------- | ------------- |
| `httpCalls`    | 200 | ~50 KB (prompt + streamed)    | ~250 KB        | ~10 MB        |
| `turnCaptures` | 100 | ~10 KB (classifier + events)  | ~50 KB         | ~1 MB         |
| `logEntries`   | 500 | ~1 KB (level + kind + fields) | ~10 KB         | ~0.5 MB       |
| **Total**      |     |                               |                | **~12 MB**    |

Under long-context workloads (e.g. Claude 200K context windows),
an individual call's request body can reach 200+ KB; the total
can approach 40 MB before hitting the upper bound (~50 MB).
Acceptable on Electron; reasonable on RN. Cap-tuning is an
in-code follow-up if pathological workflows push against the
ceiling consistently.

## Cross-platform

- **Electron renderer:** Zustand store lives in the renderer.
  All v1 outbound HTTP originates renderer-side (AI SDK,
  embedder calls), so no IPC needed. Main-process emit can layer
  on later via the existing IPC bus without changing the
  contract.
- **React Native:** single JS context; Zustand store works
  identically. No platform-specific paths.
- **Multi-window on Electron:** each window is its own renderer
  with its own diagnostics store. State is window-local; window
  A doesn't see window B's calls. Acceptable — multi-window is
  uncommon; a cross-window aggregator would be over-engineering
  for v1.

## Test harness

Sinks are pure singletons in the renderer's diagnostics store
module. Unit-testable in isolation by importing the module,
calling sink methods, asserting on store state. No mocking
infrastructure required. Integration tests of "subsystem X emits
the right log kinds" sit naturally alongside that subsystem's
tests, not in a centralized observability test suite.

## What this doc does not cover

- The Diagnostics Hub UI itself —
  [`ui/screens/diagnostics/diagnostics.md`](./ui/screens/diagnostics/diagnostics.md).
- Memory probe's persistent capture model + simulator —
  [`memory/probe.md`](./memory/probe.md).
- Per-tab body specs (Per-turn inspector, Call log, Logs, Delta
  log) — designed in their own per-surface detail passes when
  each tab is built.
