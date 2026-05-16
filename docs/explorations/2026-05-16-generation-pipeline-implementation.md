# Generation pipeline implementation design

The framework that runs LLM-driven work in the app: phases under a
transaction, the orchestrator that drives them, the action layer
that persists their writes, the event bus that surfaces their
progress, the concurrency model that lets background pipelines
coexist with foreground ones.

In-scope for this session: the framework — declaration shape,
phase contract, orchestrator topology, event fan-out, action-layer
integration, transaction lifecycle, error/cancel/retry, concurrency.

Out of scope: individual pipeline-step design (retrieval mechanics,
classifier prompt shape, lore-mgmt sub-jobs); provider abstraction
below the framework; pack authoring (templates, macros, filters);
crash-recovery startup flow (the framework provides the marker
table; the recovery code itself lives with the broader startup
design, per
[`followups.md → Crash recovery for in-flight transactions`](../followups.md#crash-recovery-for-in-flight-transactions)).

The canonical version lands in a new `docs/generation-pipeline.md`;
much of architecture.md's current pipeline content moves out. See
[Integration plan](#integration-plan) below.

---

## Pipelines, unified

The framework drives two pipeline kinds in v1 — `per-turn` and
`chapter-close` — and is structured so that future background work
(periodic classifier first; later style-review, suggestion regen,
etc.) uses the same shape. Architecture.md's earlier split between
"pipelines" and "background-agent declaration interface" collapses
into one declaration.

The wizard is **not** pipeline-adjacent. It's a screen flow that
issues one-shot LLM calls per user click and commits its results
in a single atomic SQLite transaction with no `actionId`, no
deltas, no phase orchestration. Architecture.md's "Wizard creation
transaction" framing needs reworking to drop the
"parallel-in-shape-to-pipelines" claim.

---

## Pipeline declaration shape

```ts
type PhaseFn = () => AsyncGenerator<PhaseEmittedEvent, PhaseResult>

type PhaseNode =
  | { name: string; run: PhaseFn }
  | { name: string; parallel: readonly { name: string; run: PhaseFn }[] }

type ConcurrencyPolicy = {
  blockedBy?: readonly string[] // running kinds that prevent me from starting
  yieldsTo?: readonly string[] // kinds whose START causes me to abort myself
}

interface Pipeline {
  kind: string // 'per-turn' | 'chapter-close' in v1
  phases: readonly PhaseNode[]
  affordance: 'invisible' | 'pill-only' | 'pill-and-banner'
  gateBehavior: 'hard-gate' | 'no-gate' // 'scoped-gate' deferred
  concurrencyPolicy: ConcurrencyPolicy
  chainsTo?: (run: RunState, app: AppState) => string | null
}

export const pipelines: ReadonlyMap<string, Pipeline>
```

### Key shape calls

- **Names live in the declaration, not in phase functions.** The
  orchestrator stamps `phase_start` / `phase_complete` events with
  the declared name; phase code stays name-agnostic. A `phase('retrieval', retrievalImpl)`
  helper makes this terse if the verbosity grates.
- **`parallel` groups carry their own `name`** so `currentPhase`
  (section 3) stays a single stable string while the group runs.
  Per-branch identity is available via stamped events.
- **`parallel` is the only declarative composition primitive.**
  No nesting (`parallel: [parallel: [...]]`), no mixed types in a
  group, no declarative conditionals. Phases that need
  conditional inclusion (piggyback iff capability flag) check
  state internally and return early.
- **No `transactionKind` field.** Every pipeline has the same
  transaction semantics — `actionId`, deltas, reverse-replay on
  abort. The wizard isn't a pipeline; nothing else needs a
  different shape in v1.
- **Registry is a `ReadonlyMap`** so iteration order matches
  registration; lookup is O(1); validation runs at module load
  (every `kind` unique, every `phases` non-empty, every name
  unique within a pipeline).

### Rejected alternatives

- **Full declarative spec.** Encoding parallel groups, conditional
  gates, retry policy in data; orchestrator interprets the graph.
  Rejected — parallelism + conditionals in data form get awkward
  fast; the simple cases don't need it.
- **Imperative pipeline generators all the way down.** A pipeline
  IS an async generator function; orchestrator wraps it with
  transaction lifecycle + event fan-out. Rejected — phase ordering
  becomes opaque; pill / banner / currentPhase want a stable
  ordered identity.

---

## Phase function contract

```ts
type PhaseResult =
  | { status: 'completed' }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

type PhaseEmittedEvent = Exclude<
  PipelineEvent,
  { type: 'run_start' | 'run_complete' | 'phase_start' | 'phase_complete' }
>

type PipelineEvent =
  // orchestrator-emitted; phases CANNOT yield (TS-enforced via Exclude)
  | { type: 'run_start'; runId: string; kind: string; actionId: string }
  | {
      type: 'run_complete'
      runId: string
      kind: string
      actionId: string
      outcome: 'completed' | 'aborted' | 'failed'
      error?: PipelineError
    }
  | { type: 'phase_start'; runId: string; name: string }
  | { type: 'phase_complete'; runId: string; name: string; result: PhaseResult }
  // phase-emitted core
  | { type: 'stream_chunk'; targetEntryId: string; text: string }
  | { type: 'delta_emitted'; action: PipelineAction }
  | { type: 'recoverable_error'; error: PipelineError }
  // phase-emitted specific — grows additively
  | { type: 'lore_mgmt_subjob_complete'; jobName: string; done: number; total: number }
  | { type: 'retrieval_stage'; stage: 'embedding' | 'ranking' | 'budget-fill' }
```

### Signature rules

- **Zero parameters.** Phases read from Zustand. Test overrides
  are the documented rare exception.
- **Returns a status, not a result.** The phase's real output
  lives in the generation-store scratchpad (intermediates); the
  return tells the orchestrator only what happened.

### Reads — via a per-kind `generationContext` getter

```ts
async function* retrievalPhase() {
  const ctx = useGenerationStore.getState().getPerTurnContext()
  const result = await generateRetrieval(ctx)
  yield { type: 'delta_emitted', action: { ... } }
  return { status: 'completed' }
}
```

One getter per pipeline kind. The phase reads ONCE at the start
and threads `ctx` (or a slice) into `generate*` functions. Generate
fns are the actual LLM-call wrappers — testable in isolation, no
Zustand dependency.

`generationContext` is a snapshot at call time, not a subscription.
`abortSignal` is by-reference (a live signal object), so polling
through the snapshot still sees abort transitions.

### Run-scoped state — intermediates and per-kind contexts

Intermediates are data produced by one phase that later phases (or
templates rendered during a later phase) need to read. Distinct
from events:

- **Events** = announcements / hooks for orchestrator + UI consumers.
- **Intermediates** = state flowing forward to the next phase's input.

Properties:

- Written by phases directly to the generation store via setter
  actions, **not** through `delta_emitted` events. The action layer
  - delta log is for persisted writes; intermediates are scratchpad.
- Not persisted to SQLite. Cleared at run boundary.
- Shape is kind-specific.

Per-kind contexts:

```ts
type BaseContext = {
  actionId: string
  abortSignal: AbortSignal
  story: StorySlice
  settings: SettingsSlice
}

type PerTurnContext = BaseContext & {
  inputs: PerTurnInputs
  intermediates: {
    retrievalResult?: ...
    narrativeResult?: ...
    classificationResult?: ...
    translationResult?: ...
  }
}

type ClassifierContext = BaseContext & {
  inputs: ClassifierInputs
  intermediates: {
    candidateEntries?: ...
    classifierResponse?: ...
    parsedDeltas?: ...
  }
}
```

Per-kind getters on the store: `getPerTurnContext()`,
`getClassifierContext()`. Wrong getter for the wrong context is a
type error. Chained transactions (per-turn → chapter-close) do
**not** inherit intermediates — each chained pipeline has its own
context.

A given piece of phase output may be both an intermediate AND
dispatched as deltas — they're orthogonal write paths.
`classificationResult` is the canonical example: translation
reads the structured change list to know which entity fields
need translating (intermediate), AND each change dispatches
through the action layer (deltas).

### Writes

**Directly to:** generation-store intermediates (scratchpad).

**Via events the orchestrator dispatches:**

- `delta_emitted` — every persisted write. Orchestrator routes
  through the action layer with `source: 'pipeline'` + the current
  `actionId`. Phase doesn't touch delta log / SQLite / undo_payload.
- `stream_chunk` — narrative-token-only path. Orchestrator
  dispatches a side-channel append action; **no delta** until
  stream completion (commit fires a regular `delta_emitted` for
  the entry's `op=create`).

**Never:** SQLite calls, delta-log appends, persisted-store
mutations, another phase's intermediates.

### Abort

Phase polls `signal.aborted` at suspension points. On true, return
`{ status: 'aborted' }`. LLM calls take the signal as a parameter;
on signal, the SDK rejects mid-stream and the phase catches →
returns aborted. **Phases never throw on abort.** Aborts are
values, not exceptions.

Cleanup of partial writes is NOT the phase's job — orchestrator's
transaction-abort reverse-replays everything dispatched under the
active `actionId`.

### Error severity split

- **Recoverable** → yielded as `recoverable_error` event. Phase
  keeps running. Orchestrator logs / UI may toast / no transaction
  effect.
- **Fatal** → phase returns `{ status: 'failed', error }`. **Not**
  signaled via event. Orchestrator interprets the return, aborts
  the transaction, surfaces the error via UI subscription.

Clean separation: events are informational, transaction-level
decisions ride on returns.

### Parallel-group event coordination

All branches run concurrently. Orchestrator wraps each, stamps
events with the branch name, FIFO-interleaves into the outer
stream. Group completes when all branches return.

On any branch returning `{ status: 'failed' }`:

1. Orchestrator signals abort on the remaining branches (via the
   shared abort controller).
2. Drains their event streams; in-flight deltas absorb normally
   (they're already in the actionId set; reverse-replay handles).
3. Waits for all branches to return (aborted or failed).
4. Returns failed up to the outer phase loop, which triggers the
   transaction-level abort.

### Phase vs sub-work

One `phase_start` and one `phase_complete` per declared phase (or
per branch inside a `parallel` group). Sub-work inside a phase body
is **opaque** — no framework identity, no pill update. If
sub-progress wants to surface, the phase yields phase-specific
events (e.g., `lore_mgmt_subjob_complete`); consumers filter and
interpret. Sub-work doesn't get promoted to phase status.

---

## Orchestrator topology

### Singleton service, state in the store

One orchestrator module. No instance state of its own; all run
state lives in `useGenerationStore.txState`. The orchestrator is a
stateless dispatcher that operates on the store. JS event loop
naturally interleaves concurrent async runs; one orchestrator
managing a map of `RunState`s is enough.

```ts
// src/ai/pipeline/orchestrator.ts
export async function runPipeline(kind: string): Promise<TxResult>
export const pipelineEventBus: PipelineEventBus
```

### Multi-run txState

```ts
type TxState = {
  runs: ReadonlyMap<string /* runId */, RunState>
}

type RunState = {
  runId: string // generated per run start (UUID/nanoid)
  kind: string
  actionId: string // globally unique; never reused
  abortController: AbortController
  currentPhase: string // name of declared phase or parallel group
}
```

Architecture.md's current `TransactionState.phase` field renames
to `status` to avoid the overload with per-pipeline phase names.

### Gate derivation as a selector

```ts
const isUserEditBlocked = (s: TxState): boolean =>
  [...s.runs.values()].some((r) => pipelines.get(r.kind)!.gateBehavior === 'hard-gate')
```

Per-turn / chapter-close declare `hard-gate`; periodic classifier
declares `no-gate`. Classifier alone → gate open. Per-turn running
→ gate closed.

### Phase iteration

```ts
async function runNode(node: PhaseNode, run: RunState): Promise<PhaseResult> {
  updateRunState(run.runId, { currentPhase: node.name })
  emit({ type: 'phase_start', runId: run.runId, name: node.name })

  const result =
    'parallel' in node
      ? await runParallelGroup(node.parallel, run)
      : await consumePhase(node.run(), run)

  emit({ type: 'phase_complete', runId: run.runId, name: node.name, result })
  return result
}

async function consumePhase(gen: AsyncGenerator<PhaseEmittedEvent, PhaseResult>, run: RunState) {
  while (true) {
    const next = await gen.next()
    if (next.done) return next.value
    handleEvent(next.value, run)
  }
}
```

`handleEvent` routes:

- `delta_emitted` → action-layer dispatch with `source: 'pipeline'` +
  `run.actionId` (see [Action-layer integration](#action-layer-integration))
- `stream_chunk` → side-channel append action
- everything else → no internal handling

Then forwards every event to the bus (see [Event fan-out](#event-fan-out)).

### Pill `currentPhase` — foreground-first

Pill is a single UI element; multiple runs can't all own it. Rule:
prefer the foreground (hard-gate) run's `currentPhase`; if no
foreground run, fall back to the highest-priority background run
whose affordance includes pill display. Pill renders read via a
Zustand selector over txState.

---

## Event fan-out

### Two channels to UI

- **Zustand re-renders** — persistent state. Action-layer writes
  update store rows; React subscribers re-render. Covers narrative
  content, entity/happening/awareness changes, txState for gate +
  currentPhase.
- **Event bus** — transient signals. Phase boundaries, recoverable
  errors, phase-specific progress, run lifecycle. None of these
  have natural Zustand representation.

Rule of thumb at the consumer: state with persistent representation
→ Zustand selector. Transient / no state mapping → bus subscription.

### Bus shape

```ts
type EventListener<T extends PipelineEvent['type'] = PipelineEvent['type']> = (
  event: Extract<PipelineEvent, { type: T }>,
) => void

interface PipelineEventBus {
  subscribe<T extends PipelineEvent['type']>(type: T, listener: EventListener<T>): () => void

  subscribeAll(listener: (e: PipelineEvent) => void): () => void

  emit(event: PipelineEvent): void // orchestrator-internal
}
```

Singleton exported from the orchestrator module.

### Broadcast pub/sub, not consume-once

Every subscriber that matches an event's filter gets called with
that event. Events are NOT consumed away — there's no queue, no
"this event belongs to one consumer." After emit() returns, the
event reference is dropped; subscribers that joined LATER don't
see it (no replay).

This is why persistent state belongs in Zustand: late-mounting
consumers (a pill rendered after `phase_start` fired) see current
state through Zustand selectors without missing past events.

### Synchronous fan-out

```ts
emit(event: PipelineEvent): void {
  const typed = subscribers.get(event.type) ?? []
  const wildcard = subscribers.get('*') ?? []
  for (const listener of typed) {
    try { listener(event) } catch (e) { logSubscriberError(e) }
  }
  for (const listener of wildcard) {
    try { listener(event) } catch (e) { logSubscriberError(e) }
  }
}
```

Properties:

- Sequential listener calls in registration order, same call stack.
- emit() blocks until every listener returns.
- Try/catch isolation: a throwing listener doesn't break sibling
  listeners; failed listener gets logged.
- No queue, no buffering, no drops.

Stream-chunk events fire at token rate. React 19's automatic
batching covers state updates in handlers; raw subscribers should
be careful with per-chunk work.

### Routing model

ALL events flow to the bus (including `delta_emitted` for dev /
debug surfaces). Orchestrator's structural routing (action-layer
dispatch, stream-chunk side-channel) happens BEFORE bus emission;
both fire for the same event.

---

## Action-layer integration

### What it is

The mutation methods on the persistent Zustand stores. Each method
handles **one atomic persisted write**:

```ts
const createEntity = (args: {
  data: EntityCreate
  source: MutationSource
  actionId?: string // required when source === 'pipeline'
}): MutationResult => {
  if (args.source === 'user' && hasInFlightHardGateRun()) {
    return { status: 'rejected', reason: 'pipeline-in-flight' }
  }
  // compute undo_payload from current state
  // SQLite txn: append delta row + write entity row (atomic)
  // update Zustand store
}
```

Properties:

- Lives on the stores, not a separate module.
- One method per atomic persisted change.
- Required-source field — TS-enforced.
- Generic over the pipeline — doesn't know about phases, runs, or
  events.

### Narrow action functions over write-set declarations

Action methods are kept **narrow by name** —
`updateEntityVisualState(id, visual)` separate from
`updateEntityStatusAndDescription(id, status, description)`.
Disjointness claims between concurrent pipelines grep at the
call sites; no separate `writeSet` field on Pipeline declarations.

Trade-off: there's no meta-surface to ask "what pipelines write
entity status?" — answer is `grep updateEntityStatusAndDescription`
across pipeline modules. Accepted. If a future need for
structural enforcement arises (scoped-gate), `writeSet` can
land then.

### Two write paths from the orchestrator

#### Path A — `delta_emitted` → action layer

```ts
function dispatchAction(action: PipelineAction, actionId: string) {
  switch (action.kind) {
    case 'createEntity':
      return useStoryStore.getState().createEntity({
        data: action.payload, source: 'pipeline', actionId
      })
    case 'updateEntityVisualState':
      return useStoryStore.getState().updateEntityVisualState({
        ...action.payload, source: 'pipeline', actionId
      })
    // ... grows
    default:
      assertNever(action)
  }
}

type PipelineAction =
  | { kind: 'createEntity';                 payload: EntityCreate }
  | { kind: 'updateEntityVisualState';      payload: { id: string; visual: VisualUpdate } }
  | { kind: 'updateEntityStatusAndDescription'; payload: { id: string; status?: ...; description?: ... } }
  | { kind: 'createHappening';              payload: HappeningCreate }
  | { kind: 'createAwarenessLink';          payload: AwarenessLinkCreate }
  | { kind: 'commitStreamingEntry';         payload: { entryId: string; content: string; metadata: EntryMetadata } }
  // ... grows
```

TypeScript narrowing on `kind` gives type-safe dispatch.
Exhaustive `switch` catches missing cases on new kinds.

#### Path B — `stream_chunk` → side-channel

```ts
function handleStreamChunk(event: StreamChunkEvent) {
  useStoryStore.getState().appendChunkToEntry({
    entryId: event.targetEntryId,
    text: event.text,
    // no source, no actionId — pipeline-internal only
  })
}
```

Side-channel actions:

- Update the entry row's `content` field (SQLite + store update)
- Do NOT append a delta
- Do NOT take a `source` field — only the orchestrator calls them

The entry's `op=create` delta is deferred until stream completion,
when the narrative phase yields `delta_emitted { kind: 'commitStreamingEntry' }`
— Path A then writes the create delta with full content.

### Streaming lifecycle in the narrative phase

```ts
async function* narrativePhase() {
  const ctx = getPerTurnContext()
  const entryId = generateId()

  // 1. Side-channel placeholder
  useStoryStore.getState().beginStreamingEntry({ entryId, kind: 'ai' })

  // 2. Stream chunks
  let content = ''
  for await (const chunk of streamLLM(ctx)) {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    content += chunk
    yield { type: 'stream_chunk', targetEntryId: entryId, text: chunk }
  }

  // 3. Commit (Path A — delta logged)
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'commitStreamingEntry',
      payload: { entryId, content, metadata: { ... } }
    }
  }

  // 4. Intermediate for downstream phases
  useGenerationStore.getState().setNarrativeResult({ entryId, content })

  return { status: 'completed' }
}
```

On abort mid-stream: no `op=create` delta exists yet. Reverse-replay
has nothing to undo for the entry itself. The orphan placeholder
row is dropped by `abortStreamingEntry(entryId)` (side-channel
removal, no delta) in the abort handler.

### Atomicity per action

Each action's persisted write is one SQLite transaction:

```
BEGIN;
INSERT INTO deltas (...) VALUES (...);
INSERT INTO entities (...) VALUES (...);  -- or UPDATE / DELETE
COMMIT;
```

Either both rows write or neither. SQLite commit before Zustand
store update — if SQLite fails, store stays consistent with disk.

### Performance — no batching needed

Measured ~600μs per SQLite write on phone for 384-dim vector
inserts (heavier than typical entity updates). A classifier pass
landing 15-20 actions runs comfortably under one frame. No batching
optimization needed for v1.

### Action rejection — defense in depth

UI's interactive controls render disabled when `isUserEditBlocked`
is true. The action-layer's gate-check is defense-in-depth — never
expected to fire in working UI flow, catches programmatic edits
(IPC, future MCP, internal bugs). Returns a result, never throws.

---

## Transaction lifecycle

### State transitions per run

```
beginRun(kind)
   │  INSERT pipeline_runs row (finished_at NULL)
   │  emit run_start
   ▼
in-progress (currentPhase iterates)
   │
   ├── last phase returns completed ────────────► commitRun
   │                                                  │  consult pipeline.chainsTo
   │                                                  │
   │                                                  ├── returns next kind ───► beginRun(next) (atomic transition, no idle)
   │                                                  │
   │                                                  └── returns null
   │                                                          │
   │                                                          │  UPDATE pipeline_runs SET finished_at, outcome='completed'
   │                                                          │  remove run from txState
   │                                                          │  emit run_complete (outcome: 'completed')
   │
   ├── phase returns failed ────────────────────► abortRun (reason: phase-failure)
   └── user-initiated cancel ───────────────────► abortRun (reason: user-cancel)
                                                      │  abortController.abort()
                                                      │  drain in-flight phases (return aborted)
                                                      │  reverse-replay deltas (single SQLite txn)
                                                      │  UPDATE pipeline_runs SET finished_at, outcome
                                                      │  remove run from txState
                                                      │  emit run_complete (outcome: 'aborted' | 'failed')
```

### Crash recovery via `pipeline_runs` marker table

```sql
CREATE TABLE pipeline_runs (
  run_id      TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  action_id   TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NULL,
  outcome     TEXT    NULL    -- 'completed' | 'aborted' | 'failed' | 'recovered'
)
```

- `beginRun` writes the row with `finished_at = NULL`.
- `commitRun` / `abortRun` set `finished_at` + `outcome`.
- **Startup recovery:** `SELECT * FROM pipeline_runs WHERE finished_at IS NULL`
  → for each, reverse-replay deltas under its `actionId`, mark
  `outcome = 'recovered'`.

Atomicity windows:

- Between start marker and first delta — nothing to reverse, just
  delete row. Clean.
- Between consecutive deltas — standard reverse-replay path. Clean.
- Between the final delta and the `commitRun` marker update — **small
  data-loss window**. The run effectively succeeded, but the marker
  still says in-flight, so recovery reverses just-finished work.
  Tens of milliseconds wide. Accepted for v1; tighten in v2 if it
  bites real users by coupling final-action's SQLite txn with the
  marker UPDATE.

Rows are kept after `finished_at` is set — diagnostic surface
(run history, recovery audit). Pruning policy is a future concern.

### `chainsTo` on predecessor

```ts
const perTurnPipeline: Pipeline = {
  kind: 'per-turn',
  phases: [...],
  gateBehavior: 'hard-gate',
  affordance: 'pill-and-banner',
  concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
  chainsTo: (run, app) => {
    const tokens = computeTokensSinceLastChapter(app.story)
    return tokens >= app.story.settings.chapterCloseThreshold
      ? 'chapter-close'
      : null
  },
}
```

Reading per-turn's declaration tells you what it chains to.
Alternative was `triggeredAfter` on successor — scatters chain
logic; rejected.

The chained chapter-close generates its **own fresh `actionId`**
— per-turn's deltas and chapter-close's deltas are independently
undoable; first user CTRL-Z reverses chapter-close, second
reverses per-turn. No intermediates inherit.

### Chained transition — "no user-edit window"

```ts
function commitRun(run: RunState): void {
  const pipeline = pipelines.get(run.kind)!
  const nextKind = pipeline.chainsTo?.(run, getAppState())

  useGenerationStore.setState((s) => {
    const runs = new Map(s.txState.runs)
    runs.delete(run.runId)
    if (nextKind) {
      const next = createRunRecord(nextKind)
      runs.set(next.runId, next)
    }
    return { txState: { runs } }
  })

  // ... persistence updates, event emissions ...
}
```

The setState is synchronous. Between predecessor removal and
successor addition there's no async boundary, no microtask, no
React render. Gate-blocking selector evaluates against the new
txState (still has a hard-gate run present) on the next render.
User edit window: zero.

(Invariant depends on Zustand's setState being synchronous; if a
state library swap ever changes this, the property breaks.)

### Reverse-replay

```ts
async function reverseReplayDeltas(actionId: string): Promise<void> {
  const deltas = await db.query('SELECT * FROM deltas WHERE action_id = ? ORDER BY seq DESC', [
    actionId,
  ])

  await db.exec('BEGIN')
  try {
    for (const delta of deltas) {
      applyUndo(delta.target_table, delta.target_id, delta.undo_payload)
    }
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw new PipelineError('Reverse-replay failed', e)
  }

  // Re-fetch affected rows into Zustand store from reversed SQLite state
}
```

Architecture.md says abort is "conceptually identical to user
CTRL-Z" — same `undo_payload` primitive, same reverse-replay path.
Whether the delta rows themselves are deleted or marked-reversed
after replay is a data-model.md decision (CTRL-Z uses the same
logic); the framework just consumes the primitive.

### Streaming partial-entry on abort

Pre-completion abort: no `op=create` delta exists for the entry
yet. Orphan placeholder dropped via `abortStreamingEntry(entryId)`
(side-channel, no delta). Any classifier-piggyback deltas that
already fired during the stream reverse-replay normally.

### Wizard exemption

Wizard creation isn't a pipeline run; its commit is a single
SQLite txn outside the orchestrator. The lifecycle in this section
doesn't apply.

---

## Error / cancel / retry

### Two retry tiers, both at phase level

A wrapping helper around an LLM call handles both:

1. **Provider-side retry** — network, 5xx, timeout. SDK call
   rejected before a response landed.
2. **Parse / data-shape retry** — call returned, but the response
   isn't usable. Strict parse failed, jsonrepair failed.

Both re-call the LLM with the same prompt up to a budget. Each
failed attempt yields a `recoverable_error` event. From the
orchestrator's and UI's perspective, retries are transparent —
the phase eventually returns success or fatal; no user surfacing
between.

```ts
async function callWithRetry<T>(
  callFn: (signal: AbortSignal) => Promise<string>,
  parseFn: (raw: string) => T,
  opts: {
    maxProviderAttempts: number
    maxParseAttempts: number
    signal: AbortSignal
  },
): Promise<{ result: T; recoverable: PipelineError[] }>
```

Non-retryable errors short-circuit: auth failures (401/403) skip
retry. Same for 4xx client errors. Provider-error classification
lives in the provider abstraction layer.

### Phase-level recovery is the v1 transparency goal

The framework's job is to handle parse failures **transparently**
— phase retries, eventually succeeds via LLM sampling variation,
pipeline continues. User never sees the hiccup. Pipeline doesn't
restart from scratch.

V1 retry strategy is "same call, retry N times." Enough for most
parse failures.

Future direction (followup): smarter mid-pipeline data-error
recovery — re-prompt with the failed response embedded, adjust call
parameters per retry, per-call-type tuning. The `callWithRetry`
helper becomes pluggable.

### Whole-pipeline retry — user-initiated only

Phase-level retry handles transient and parse hiccups
transparently. By the time a phase returns fatal, something more
fundamental is wrong; re-running the full pipeline burns
resources to likely fail again. UI offers a retry affordance
after `run_complete` with `outcome: 'failed'`; the framework
doesn't auto-retry.

### Streaming resilience — thin v1

Phase-level retry doesn't help mid-stream failures: partial content
has already been side-channelled into the store; can't re-call
cleanly. V1: mid-stream provider error → fatal phase return →
reverse-replay → orphan placeholder cleanup → user re-prompts.

Followup: streaming-aware retry (resume from chunk N, retry the
stream). Materially harder; defer.

### Chapter-close partial failure

Phase-level retry means most mid-chapter-close hiccups never
escalate to fatal. Only when retries exhaust does chapter-close
abort whole. CTRL-Z atomicity contract preserved (one actionId →
one undoable unit).

If a future pipeline ever needed partial-commit semantics, it
would need a different design (multiple actionIds per pipeline,
orchestrator commits each phase's actionId as it completes). Not
v1.

### User cancel = abort (no error path)

User cancel is not an error. Orchestrator triggers
`run.abortController.abort()`; phases see `signal.aborted`,
return aborted; reverse-replay runs; `run_complete` emits with
`outcome: 'aborted'`. UI distinguishes cancel from failure by
reading outcome.

### Fatal error categories

```ts
type PipelineError =
  | { kind: 'provider'; reason: 'auth' | 'network' | 'timeout' | 'unknown'; detail?: string }
  | { kind: 'phase-logic'; detail: string } // malformed output, contract violation
  | { kind: 'action-layer'; detail: string } // schema/constraint failure on persisted write
  | { kind: 'orchestrator'; detail: string } // reverse-replay failed, etc.
```

Categories drive how UI surfaces them — toast for transient,
banner / dialog for persistent.

---

## Concurrency model

### Pipeline fields

`gateBehavior` controls user-edit gating:

- `'hard-gate'` — all user-source writes blocked while I'm running.
- `'no-gate'` — user-source writes proceed; my deltas land alongside.
- `'scoped-gate'` — deferred (would gate only user writes
  overlapping my writeSet; ships when writeSet does).

`concurrencyPolicy`:

- `blockedBy` — incoming run's perspective: "these running kinds
  block me from starting." Orchestrator consults on
  `runPipeline(kind)` entry.
- `yieldsTo` — running run's perspective: "if any of these kinds
  tries to start, I abort." V1 doesn't use it; kept for future
  cases.

### V1 declarations

```ts
const perTurnPipeline: Pipeline = {
  kind: 'per-turn',
  gateBehavior: 'hard-gate',
  concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
  // ...
}

const chapterClosePipeline: Pipeline = {
  kind: 'chapter-close',
  gateBehavior: 'hard-gate',
  concurrencyPolicy: { blockedBy: ['per-turn', 'chapter-close'] },
  // chained start bypasses (orchestrator-internal)
}

const periodicClassifierPipeline: Pipeline = {
  kind: 'periodic-classifier',
  gateBehavior: 'no-gate',
  concurrencyPolicy: { blockedBy: ['periodic-classifier', 'chapter-close'] },
}
```

### Resolution table

| Running               | Wants to start          | Resolution                                                     |
| --------------------- | ----------------------- | -------------------------------------------------------------- |
| (idle)                | per-turn                | starts                                                         |
| per-turn              | periodic-classifier     | classifier's blockedBy lacks per-turn → starts                 |
| periodic-classifier   | per-turn                | per-turn's blockedBy lacks classifier → starts; both run       |
| per-turn              | chapter-close (manual)  | chapter-close's blockedBy includes per-turn → blocked          |
| per-turn (committing) | chapter-close (chained) | chained path bypasses concurrencyPolicy → starts               |
| chapter-close         | periodic-classifier     | classifier's blockedBy includes chapter-close → blocked        |
| chapter-close         | per-turn                | gate blocks user trigger; defense in depth blocks regardless   |
| periodic-classifier   | periodic-classifier     | blockedBy includes self → blocked                              |
| classifier (running)  | chapter-close (chains)  | chapter-close starts; classifier keeps running (concurrent OK) |

### `runPipeline` entry algorithm

```ts
function checkConcurrencyContract(
  kind: string,
  currentRuns: ReadonlyMap<string, RunState>,
): StartDecision {
  const pipeline = pipelines.get(kind)!
  const blockedBy = pipeline.concurrencyPolicy.blockedBy ?? []

  for (const run of currentRuns.values()) {
    if (blockedBy.includes(run.kind)) {
      return { kind: 'blocked', by: run.kind }
    }
  }

  const yieldTargets: string[] = []
  for (const run of currentRuns.values()) {
    const yieldsTo = pipelines.get(run.kind)!.concurrencyPolicy.yieldsTo ?? []
    if (yieldsTo.includes(kind)) yieldTargets.push(run.runId)
  }

  return yieldTargets.length > 0
    ? { kind: 'start-after-yields', targets: yieldTargets }
    : { kind: 'start' }
}
```

### Chained start bypasses concurrencyPolicy

Per-turn's `chainsTo` returning `'chapter-close'` triggers a
chained transition (in `commitRun`) that directly creates the next
`RunState` without going through `runPipeline`'s entry check. The
blockedBy list reflects external start requests (UI, scheduler);
chains aren't external.

### Background scheduler — out of framework scope

Pipelines like the periodic classifier aren't user-triggered.
The framework doesn't ship the scheduler itself; a small layer on
top reads each pipeline's trigger declaration (out of scope here;
tracked with the periodic-classifier design in
[`memory/classifier.md`](../memory/classifier.md)).

What the scheduler does:

- On interval (per `stories.settings.classifierCadence`): call
  `runPipeline('periodic-classifier')`.
- If `runPipeline` returns `outcome: 'rejected'`, wait for the
  next interval — no retry queue. Classifier is best-effort.

---

## Invariants

Load-bearing properties the framework relies on. Document changes
to any of these alongside whatever causes the relaxation.

- **Single run per kind.** At most one run of any given pipeline
  kind at any time. `blockedBy` declarations enforce this for v1.
  Relax only if a future kind genuinely needs concurrent same-kind
  runs (would require explicit `runId` threading through phases,
  breaking the zero-param signature).
- **`actionId` is globally unique.** Generated per `beginRun`;
  never reused. Deltas, `pipeline_runs` rows, reverse-replay, and
  user CTRL-Z grouping all key off it.
- **Chained transitions are synchronous.** Relies on Zustand's
  setState being synchronous. If the state library swap, the
  no-user-edit-window property breaks; add coverage.
- **Phase functions are zero-parameter.** Forced by the
  single-run-per-kind invariant — phases identify "their" run via
  the kind-keyed `generationContext` getter.
- **Disjoint write sets between concurrent pipelines.** The
  per-turn pipeline (and its piggyback / fallback-classifier
  variants) writes a different field set from the periodic
  classifier. Prose-enforced via narrow action functions named for
  their field-set scope (`updateEntityVisualState` vs
  `updateEntityStatusAndDescription`). Any new action function
  should be reviewed for write-set overlap with concurrent
  pipelines.
- **One `actionId` per pipeline run.** Including chapter-close's
  five phases. Atomic CTRL-Z is the contract.
- **Side-channel actions are pipeline-internal.** No `source`
  field; not exported as part of the public store action surface.
  Only the orchestrator calls them.

---

## Adversarial findings — what was tested

Things deliberately probed before landing the design:

- **Concurrent abort across runs** — each `RunState` has its own
  `abortController`; aborting per-turn doesn't kill a concurrent
  classifier. ✓
- **Classifier mid-run when chapter-close chains in** —
  classifier keeps running through chapter-close (blockedBy
  prevents NEW starts, not running ones). Worth monitoring for
  provider load + user confusion; accept for v1. ✓
- **Reverse-replay failure mid-abort** — SQLite txn either fully
  reverses or rolls back. Crash recovery on next startup is the
  safety net (depends on
  [`followups.md → Crash recovery`](../followups.md#crash-recovery-for-in-flight-transactions)
  landing). ✓ with dependency.
- **Phase yields delta_emitted with FK dependency on
  not-yet-created row** — action layer rejects on FK violation;
  fatal phase error → abort. Phase has to order emits correctly.
  Action-layer atomicity surfaces it immediately, not silently. ✓
- **Empty `phases: []`** — runPipeline iterates nothing, commits
  immediately. Add load-time validation that phases is non-empty.
  ✓ tracked.
- **Translation phase fatal failure** — currently aborts entire
  per-turn, loses AI response over a translation hiccup. Harsh
  for users; should degrade (narrative commits without
  translation, lazy translation on next view). Followup.

Things assumed without verification:

- Drizzle's transaction wrapper plays well with `expo-sqlite`'s
  sync/async query modes. Worth a spike at implementation start.
- Zustand's setState stays synchronous in the version used. True
  historically; verify current version.
- React 19's automatic batching covers per-chunk emit paths. True
  for state updates in handlers; might not cover all paths.
- AsyncGenerator + AbortSignal flow as described works cleanly
  with the chosen LLM SDK. Standard JS, but not tested in this
  codebase.

---

## Followups created

To be added to `followups.md`:

- **Translation graceful degradation** — translation phase failure
  shouldn't kill per-turn; design the soft-fail path
  (narrative commits, translation re-attempted on next view).
- **Smarter mid-pipeline data error recovery** — re-prompt with
  error context, parameter tuning per retry, per-call-type
  strategies. Followup direction for `callWithRetry`.
- **Streaming-aware retry / partial-content persistence** —
  resume from chunk N, retry the stream; or let the user accept
  partial content. Materially harder.
- **Final-delta-to-commit window tightening** — couple the final
  action's SQLite txn with the `pipeline_runs` finish marker
  UPDATE; closes the small v1 data-loss window in crash recovery.
- **Pack-defined pipeline kinds** (post-v1) — pack model assumes
  templates / macros only; if packs ever ship code, pipeline
  kinds could come from packs. PipelineAction kind set is
  currently closed (TS union).
- **Crash-recovery startup flow** — already tracked in
  `followups.md`; this design contributes the `pipeline_runs`
  marker table and the recovery contract (scan + reverse-replay).
  The startup wiring itself is the followup's scope.

---

## Integration plan

The canonical material lands as a **new doc** at
`docs/generation-pipeline.md`, with `docs/architecture.md` pruned
of framework content and pointing at the new doc.

### New doc — `docs/generation-pipeline.md`

Sections, mirroring this exploration:

1. Overview + scope (framework vs. pipeline instances)
2. Pipeline declaration
3. Phase function contract — includes Run-scoped state subsection
4. Orchestrator topology
5. Event fan-out
6. Action-layer integration
7. Transaction lifecycle — includes crash recovery
8. Error / cancel / retry
9. Concurrency model
10. Invariants
11. Open / deferred

### Pruned from `docs/architecture.md`

These sections move to the new doc:

- **Pipeline principles** (entire section).
- **Generation context and prompt templates** — the
  `generationContext` shape and store mechanics move. The Liquid
  / templates / packs / filters / macros content stays in
  architecture.md (separate concern: prompt authoring).
- **Agent orchestration** — mostly moves; cadence-table summary
  may stay as high-level overview.

These stay in `docs/architecture.md`:

- **Translation as a pipeline concern** (pipeline consumer, not
  framework).
- **Retrieval / injection phase** (high-level; details in
  `memory/retrieval.md`).
- Prompt-authoring (Liquid / templates / packs / filters / macros)
  surfaces that aren't framework material.

`architecture.md`'s "Wizard creation transaction" subsection
gets reworked: the wizard is screen-driven, not pipeline-adjacent;
drop the "parallel-in-shape-to-pipelines" framing.

### Inbound reference sweep

- `memory/README.md` cross-refs section — update pipeline-related
  pointers to the new doc.
- `memory/cadence.md`, `memory/classifier.md`, `memory/piggyback.md`
  — likely cite pipeline / transaction sections.
- `ui/principles.md → Edit restrictions during in-flight generation`
  — verify references to txState shape (`phase` → `status`).
- `followups.md → GenerationStatusPill wiring` — align naming
  with `currentPhase`.
- `data-model.md → Entry mutability & rollback` — if it
  cross-references the gate / transaction shape, update pointers.
- Any `docs/explorations/*` citing pipeline sections — record
  files freeze in time; don't rewrite, but flag if the citation
  is now broken for grep purposes (drift pass).

### Followups.md update

- Add the new followups listed above.
- Update `GenerationStatusPill orchestrator wiring` entry to
  point at the new doc.

### Architecture.md "What this doc does not yet cover" cleanup

Items now answered by the new doc:

- **Streaming resilience** — partial answer (v1 thin model); flag
  remaining followup work.
- **Error handling** — answered (two-tier retry, recoverable vs
  fatal split).

Items still open in architecture.md:

- Module / folder layout
- Platform boundaries (Electron main vs renderer, IPC)
- Empirical retrieval tuning
- Startup + migration flow (crash recovery is part of this; the
  framework contributes the marker table)
- Secrets storage

---

## Exploration record metadata

- **Session date:** 2026-05-16
- **Session length:** one long pass
- **Status:** approved through adversarial review; ready for
  integration into canonical docs
