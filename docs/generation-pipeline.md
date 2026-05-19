# Generation pipeline

How code is organized for LLM-driven work in the app: phases under
a transaction, the orchestrator that drives them, the action layer
that persists their writes, the event bus that surfaces their
progress, the concurrency model that lets background work coexist
with foreground generation.

Companion to [`data-model.md`](./data-model.md) (what's stored),
[`architecture.md`](./architecture.md) (cross-cutting code shape,
prompt-authoring surfaces, translation, retrieval), and the
[`memory/`](./memory/README.md) folder (individual pipeline-instance
detail for the periodic classifier, chapter-close, piggyback, and
retrieval mechanics).

This doc owns the **framework** — generic pipeline shape that every
concrete pipeline kind plugs into. Individual phase work lives with
its domain (memory pipeline phases in `memory/`, translation as a
pipeline concern in `architecture.md`).

---

## Pipelines, unified

The framework drives three foreground pipeline kinds in v1 —
`per-turn`, `chapter-close`, and `suggestion-refresh` (user-triggered
chip re-roll from the reader; see
[`explorations/2026-05-19-next-turn-suggestions.md`](./explorations/2026-05-19-next-turn-suggestions.md))
— and is structured so that background work (the periodic
classifier first; later style-review, etc.) uses the same shape.
Background pipelines and foreground pipelines share the framework;
what distinguishes them is the concurrency contract.

The wizard is **not** pipeline-adjacent. It's a screen flow that
issues one-shot LLM calls per user click and commits its results
in a single atomic SQLite transaction. No `actionId`, no deltas,
no phase orchestration. Wizard reuses provider abstraction and
template rendering but nothing of the pipeline framework. See
[`data-model.md → Opening entry`](./data-model.md#opening-entry)
for the wizard commit shape.

---

## Pipeline declaration

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
  kind: string // 'per-turn' | 'chapter-close' | 'suggestion-refresh' in v1
  phases: readonly PhaseNode[]
  affordance: 'invisible' | 'pill-only' | 'pill-and-banner'
  gateBehavior: 'hard-gate' | 'no-gate' // 'scoped-gate' deferred
  concurrencyPolicy: ConcurrencyPolicy
  chainsTo?: (run: RunState, app: AppState) => string | null
}

export const pipelines: ReadonlyMap<string, Pipeline>
```

### Key shape rules

- **Names live in the declaration, not in phase functions.** The
  orchestrator stamps `phase_start` / `phase_complete` events with
  the declared name; phase code stays name-agnostic. A
  `phase('retrieval', retrievalImpl)` helper makes this terse if
  the verbosity grates.
- **`parallel` groups carry their own `name`** so `currentPhase`
  stays a single stable string while the group runs. Per-branch
  identity is available via per-branch stamped events.
- **`parallel` is the only declarative composition primitive.**
  No nesting (`parallel: [{ parallel: [...] }]`), no mixed types
  inside a group, no declarative conditionals. Phases that need
  conditional inclusion (piggyback iff capability flag; fallback
  classifier iff piggyback didn't fire) check state internally
  and return early.
- **No `transactionKind` field.** Every pipeline has the same
  transaction semantics — `actionId`, deltas, reverse-replay on
  abort. The wizard isn't a pipeline; nothing else needs a
  different shape in v1.
- **Registry is a `ReadonlyMap`** so iteration order matches
  registration; lookup is O(1); validation runs at module load
  (every `kind` unique, every `phases` non-empty, every name
  unique within a pipeline).

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

- **Zero parameters.** Phases read from Zustand. No deps bundle, no
  inputs threaded through composition. Test overrides are the
  documented rare exception.
- **Returns a status, not a result.** The phase's real output lives
  in the generation-store scratchpad (intermediates); the return
  tells the orchestrator only what happened.

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
fns are the actual LLM-call wrappers — testable in isolation (no
Zustand dependency), reusable across phases.

`generationContext` is a snapshot at call time, not a subscription.
`abortSignal` is by-reference (a live signal object), so polling
through the snapshot still sees abort transitions; other state
changes between read and use are not seen.

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
  inputs: PerTurnInputs            // user action, action type, raw input
  intermediates: {
    retrievalResult?: ...
    narrativeResult?: ...
    classificationResult?: ...
    translationResult?: ...
  }
}

type ClassifierContext = BaseContext & {
  inputs: ClassifierInputs         // window of entries to consider
  intermediates: {
    candidateEntries?: ...
    classifierResponse?: ...
    parsedDeltas?: ...
  }
}
```

Per-kind getters on the store: `getPerTurnContext()`,
`getClassifierContext()`. Reaching for the wrong getter is a type
error. **Chained transactions (per-turn → chapter-close) do not
inherit intermediates** — each chained pipeline has its own context
and writes a fresh set.

A given piece of phase output may be both an intermediate AND
dispatched as deltas — they're orthogonal write paths.
`classificationResult` is the canonical example: translation reads
the structured change list to know which entity fields need
translating (intermediate), AND each change dispatches through the
action layer (deltas). Persistent state ends up in SQLite via the
action layer; the scratchpad copy lets later phases avoid diffing.

### ID placeholder substitution

Entity IDs are stored as prefix-tagged UUIDs (`char_<uuid>`,
`loc_<uuid>`, etc. — see
[`data-model.md → ID shape`](./data-model.md#id-shape--kind-prefixed-uuids-throughout)).
The LLM never sees these directly. Before any LLM call that emits
structured references to entities (per-turn narrative + piggyback,
periodic classifier, wizard opening-generation, chapter-close
phases), the substitution layer swaps UUIDs for short placeholders.

**Contract:** prose never carries IDs — only character names.
Structured emission (piggyback tagged block, classifier JSON output)
carries placeholders.

#### idMap on the context

```ts
type PerTurnContext = BaseContext & {
  inputs: PerTurnInputs
  intermediates: {
    retrievalResult?: ...
    narrativeResult?: ...
    classificationResult?: ...
    translationResult?: ...
    idMap?: IdBiMap          // populated before LLM call, consumed on parse
  }
}
```

Every context type whose consumer LLM call emits entity-ID
references carries an `idMap` field on its intermediates.
Translation context doesn't — translation is prose-in/prose-out.

#### Walker — generic, pattern-driven

```ts
const SUBSTITUTABLE_PREFIXES = [
  'char',
  'loc',
  'item',
  'fact',
  'lore',
  'thr',
  'hap',
  'chap',
] as const
const ID_PATTERN = new RegExp(
  `^(${SUBSTITUTABLE_PREFIXES.join('|')})_` +
    `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

function substituteIds<T>(value: T, idMap: IdBiMap): T {
  if (typeof value === 'string' && ID_PATTERN.test(value)) {
    return (idMap.getPlaceholderFor(value) ?? idMap.allocate(value)) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteIds(v, idMap)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteIds(v, idMap)]),
    ) as T
  }
  return value
}
```

The walker is type-agnostic — recursive descent, pattern-matches
any string against the LLM-facing-prefix UUID pattern, swaps where
it matches. Non-LLM-facing IDs (`entry_*`, `act_*`, `run_*`) don't
match and pass through unchanged.

#### IdBiMap

```ts
class IdBiMap {
  private uuidToPlaceholder = new Map<string, string>()
  private placeholderToUuid = new Map<string, string>()
  private counters: Record<string, number> = {}

  allocate(uuid: string): string {
    const existing = this.uuidToPlaceholder.get(uuid)
    if (existing) return existing
    const kindPrefix = uuid.split('_')[0]
    const placeholderPrefix = PLACEHOLDER_PREFIX_BY_KIND[kindPrefix]
    const n = (this.counters[placeholderPrefix] ?? 0) + 1
    this.counters[placeholderPrefix] = n
    const placeholder = `${placeholderPrefix}${n}`
    this.uuidToPlaceholder.set(uuid, placeholder)
    this.placeholderToUuid.set(placeholder, uuid)
    return placeholder
  }

  getPlaceholderFor(uuid: string): string | undefined { ... }
  getUuidFor(placeholder: string): string | undefined { ... }
}

const PLACEHOLDER_PREFIX_BY_KIND = {
  char: 'c',  loc: 'l',   item: 'i',  fact: 'f',
  lore: 'lo', thr: 'th',  hap: 'hp', chap: 'ck',
}
```

Placeholders look like `c1`, `c2`, `l1`, `lo1`, `ck1`, etc. — one
character (for entities) or two characters (for the rest) plus a
per-kind counter. Counter is scoped to the idMap, which is scoped
to a single LLM call.

#### Lifecycle

```
1. Retrieval / context assembly produces context with UUIDs
2. substituteIds(context, idMap) walks recursively, swaps UUIDs → placeholders
3. Liquid templates render against placeholder-bearing context
   — pack authors read `entity.id` and get the placeholder
4. LLM call streams; emits placeholders in structured output (names in prose)
5. parseAndSubstitute(rawOutput, idMap) — reverse swap
6. Action layer receives UUIDs as it always does
```

Substitution is **structured (data-side, pre-render)** — not regex
post-processing on the rendered prompt string. Template-author API
exposes `entity.id = placeholder` cleanly; UUID is never visible to
template-rendering code.

#### New-entity emission

The classifier (or piggyback) creating a brand-new entity emits a
full object — name, description, etc. — with **no `id` field**.
Parse allocates the UUID. If the same response references the new
entity again (e.g., new char appears in `<scene_entities>` AND in
`<visual_changes>`), the LLM emits a temporary handle of its own
choosing for the second reference; parse-time map mutates to
register the temporary handle → UUID mapping.

#### Failure modes

Any unrecognized or malformed placeholder in LLM output → single
recoverable error class. Phase yields `recoverable_error`; the
retry tier handles it. Bare UUID emission from the LLM is a prompt
bug, not a runtime case to handle.

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
4. Returns failed up to the outer phase loop, which triggers
   transaction-level abort.

### Phase vs sub-work

One `phase_start` and one `phase_complete` per declared phase (or
per branch inside a `parallel` group). Sub-work inside a phase body
is **opaque** — no framework identity, no pill update.

If sub-progress wants to surface, the phase yields phase-specific
events (e.g., `lore_mgmt_subjob_complete`); consumers filter and
interpret. Sub-work doesn't get promoted to phase status — pill
still shows the declared phase.

Rule: **if it needs identity in the pill, declare it as its own
phase.** If it's bookkeeping, keep it in the body.

---

## Orchestrator topology

### Singleton service, state in the store

One orchestrator module. No instance state of its own; all run
state lives in `useGenerationStore.txState`. The orchestrator is a
stateless dispatcher operating on the store. JS event loop
naturally interleaves concurrent async runs; one module managing a
map of `RunState`s is enough.

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
  runId: string // generated per run start (UUID / nanoid)
  kind: string
  actionId: string // globally unique; never reused
  abortController: AbortController
  currentPhase: string // name of declared phase or parallel group
}
```

### Gate derivation as a selector

```ts
const isUserEditBlocked = (s: TxState): boolean =>
  [...s.runs.values()].some((r) => pipelines.get(r.kind)!.gateBehavior === 'hard-gate')
```

Per-turn / chapter-close declare `hard-gate`; periodic classifier
declares `no-gate`. Classifier alone → gate open. Per-turn running
→ gate closed.

The user-facing contract for what specifically the gate blocks
lives in
[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation);
this file is the implementation surface.

### Config pre-flight validation

Before phase 0 of any pipeline kind fires, the orchestrator walks
the kind's declared `phases` and validates each phase's resolver
inputs against `app_settings`. Validation is in-memory only (no
network, no DB beyond the already-cached Zustand snapshot) and
checks:

- For each agent the pipeline would invoke: `assignments[agentId]`
  resolves to an existing profile (or, for narrative, the
  `kind: 'narrative'` profile exists).
- For each resolved profile: `modelRef.providerId` resolves to an
  existing `providers[]` entry. (Story-level overrides at
  `stories.settings.models[agentId]` are pure model id strings, no
  provider component, so they don't enter provider validation —
  broken-model-catalog cases surface via the existing global
  broken-config banner.)

Per-story embedder pointers (`stories.settings.embedding_provider_id`)
are **not validated** here — they're an invariant maintained by
[`data-model.md → Provider / profile deletion semantics`](./data-model.md#app-settings-storage)'s
per-story embedder block, which prevents the backing provider from
disappearing while any story uses it.

What gets validated is **selective per pipeline kind** — the
pre-flight walks only the resolver inputs of phases this pipeline
actually fires. The new-turn pipeline validates retrieval +
narrative + classifier (if a separate classifier call is in the
phase list, e.g. piggyback mode is off) + suggestions (if
`stories.settings.suggestionsEnabled`); the chapter-close pipeline
validates the chapter-close agent's resolved config; the periodic
classifier validates classifier's config at its scheduled fire
time; the memory probe validates retrieval's config.

**On failure**, the run halts before phase 0 fires — no LLM call
goes out, no tokens spent, no deltas written. The orchestrator
emits a `run_complete` event with `result.status === 'failed'` and
an error payload identifying the first failing resolver in phase
order (retrieval before narrative before classifier — avoids
piling up multiple system entries when the user has multiple
broken references).

**Surfacing.** Pre-flight failure on **turn-blocking pipelines**
(new-turn, chapter-close, memory probe) emits a system-kind entry
into the affected story per
[`reader-composer.md → Error surface`](./ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill).
Pre-flight failure on **background pipelines** (periodic
classifier) emits a sticky pill error variant per
[`generation-status-pill.md`](./ui/patterns/generation-status-pill.md).

**Runtime resolver failure is the safety net.** A race between
pre-flight pass and the actual LLM call (config changed mid-turn)
falls through to the same system-entry vocabulary at resolver
time. Same copy, same actions; the user can't distinguish which
layer caught it.

The underlying deletion-semantics design — what makes resolver
inputs go missing in the first place — lives in
[`data-model.md → Provider / profile deletion semantics`](./data-model.md#app-settings-storage).

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
  `run.actionId` (see [Action-layer integration](#action-layer-integration)).
- `stream_chunk` → side-channel append action.
- everything else → no internal handling.

Then forwards every event to the bus (see [Event fan-out](#event-fan-out)).

### Pill `currentPhase` — foreground-first

Pill is a single UI element; multiple runs can't all own it. Rule:
prefer the foreground (hard-gate) run's `currentPhase`; if no
foreground run, fall back to the highest-priority background run
whose affordance includes pill display. Pill renders read via a
Zustand selector over `txState`.

---

## Event fan-out

### Two channels to UI

- **Zustand re-renders** — persistent state. Action-layer writes
  update store rows; React subscribers re-render. Covers narrative
  content, entity / happening / awareness changes, `txState` for
  gate + currentPhase.
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

Every subscriber matching an event's filter gets called with that
event. Events are NOT consumed away — no queue, no "this event
belongs to one consumer." After emit() returns, the event reference
is dropped; subscribers that joined later don't see it (no replay).

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

- Sequential listener calls in registration order, same call stack.
- emit() blocks until every listener returns.
- Try / catch isolation: a throwing listener doesn't break sibling
  listeners; failed listener gets logged.
- No queue, no buffering, no drops.

Stream-chunk events fire at token rate. React 19's automatic
batching covers state updates in handlers; raw subscribers should
be careful with per-chunk work.

### Routing model

ALL events flow to the bus, including `delta_emitted` (for dev /
debug surfaces). The orchestrator's structural routing (action-layer
dispatch, stream-chunk side-channel) happens BEFORE bus emission;
both fire for the same event.

---

## Action-layer integration

### What it is

The mutation methods on the persistent Zustand stores
(`useStoryStore`, `useTranslationsStore`, etc.). Each method handles
**one atomic persisted write**:

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
Disjointness claims between concurrent pipelines grep at the call
sites; no separate `writeSet` field on Pipeline declarations.

Trade-off: there's no meta-surface to ask "what pipelines write
entity status?" — answer is grep on the narrow action name across
pipeline modules. If a future need for structural enforcement
arises (scoped-gate), `writeSet` can land then.

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
  | { kind: 'createEntity';                     payload: EntityCreate }
  | { kind: 'updateEntityVisualState';          payload: { id: string; visual: VisualUpdate } }
  | { kind: 'updateEntityStatusAndDescription'; payload: { id: string; status?: ...; description?: ... } }
  | { kind: 'createHappening';                  payload: HappeningCreate }
  | { kind: 'createAwarenessLink';              payload: AwarenessLinkCreate }
  | { kind: 'commitStreamingEntry';             payload: { entryId: string; content: string; metadata: EntryMetadata } }
  // ... grows
```

TypeScript narrowing on `kind` gives type-safe dispatch.
Exhaustive `switch` catches missing cases when a new kind lands.

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

- Update the entry row's `content` field (SQLite + store update).
- Do NOT append a delta.
- Do NOT take a `source` field — only the orchestrator calls them.

The entry's `op=create` delta is deferred until stream completion,
when the narrative phase yields
`delta_emitted { kind: 'commitStreamingEntry' }` — Path A then
writes the create delta with full content.

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
      payload: { entryId, content, metadata: { ... } },
    },
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

### Run state transitions

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
  story_id    TEXT NULL,       -- populated at beginRun from calling context;
                               -- NULL for hypothetical non-story-scoped runs
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NULL,
  outcome     TEXT    NULL    -- 'completed' | 'aborted' | 'failed' | 'recovered'
)
```

- `beginRun` writes the row with `finished_at = NULL` and populates
  `story_id` from the run's calling context.
- `commitRun` / `abortRun` set `finished_at` + `outcome`.

Atomicity windows worth being honest about:

- Between start marker and first delta — nothing to reverse, just
  delete the row.
- Between consecutive deltas — standard reverse-replay path.
- Between the final delta and the `commitRun` marker UPDATE —
  small data-loss window (tens of milliseconds). The run
  effectively succeeded but the marker still says in-flight, so
  recovery reverses just-finished work. **Accepted for v1**;
  tighten in v2 if it bites real users (couple final action's
  SQLite txn with the marker UPDATE).

Rows are kept after `finished_at` is set — diagnostic surface (run
history, recovery audit). Pruning policy is a future concern.

#### Startup recovery pass

Recovery runs in a fixed boot slot:

1. Native shell ready.
2. SQLite handle opened, **migrations applied** — `deltas` and
   `pipeline_runs` guaranteed at current schema.
3. Zustand stores constructed at empty default state.
4. **Crash recovery pass runs here.**
5. Theme / settings hydration, provider and embedder readiness
   checks, first user-facing surface renders.
6. Story-load and background-task startup gated until recovery
   resolves.

Migrations-first is load-bearing: a migration that mutated a column
an orphan's `undo_payload` references will surface the failure
through the same `DeltaReplayError` path. The
[`encoding_version`](./data-model.md#diagram) stamp lands at v1
(every writer stamps `1`, every reader assumes v1 semantics); the
multi-version apply-dispatcher that would route a stamp-`1` orphan
through legacy-compatible apply rules after a schema change is
deferred (see [`parked.md`](./parked.md)). Ordering recovery after
migrations means stale-encoding orphans fail-into that future
dispatcher rather than ahead of it.

Invocation contract:

```ts
async function recoverInFlightRuns(): Promise<RecoveryReport> {
  const orphans = await db.query(
    'SELECT * FROM pipeline_runs WHERE finished_at IS NULL ORDER BY started_at ASC',
  )
  const reversed: RecoveredRun[] = []
  const failures: RecoveryFailure[] = []

  for (const orphan of orphans) {
    try {
      const deltaCount = await reverseReplayDeltas(orphan.action_id)
      if (deltaCount === 0) {
        // Pre-first-delta orphan: no diagnostic value in retaining the row.
        await db.exec('DELETE FROM pipeline_runs WHERE run_id = ?', [orphan.run_id])
      } else {
        await db.exec(
          "UPDATE pipeline_runs SET finished_at = ?, outcome = 'recovered' WHERE run_id = ?",
          [Date.now(), orphan.run_id],
        )
        reversed.push({
          runId: orphan.run_id,
          kind: orphan.kind,
          actionId: orphan.action_id,
          storyId: orphan.story_id,
          deltas: deltaCount,
        })
        logger.info('pipeline.recovered', {
          runId: orphan.run_id,
          kind: orphan.kind,
          deltas: deltaCount,
        })
      }
    } catch (e) {
      failures.push({ runId: orphan.run_id, kind: orphan.kind, error: e })
      logger.error('pipeline.recovery_failed', {
        runId: orphan.run_id,
        kind: orphan.kind,
        actionId: orphan.action_id,
        error: e,
      })
      // Orphan row stays with finished_at = NULL; next boot retries.
    }
  }
  return { reversed, failures }
}
```

The post-Zustand-construct ordering is safe because of a
load-bearing invariant: **data-model Zustand slices (entries,
entities, lore, happenings, threads, deltas, etc.) do not
rehydrate from SQLite at construct time; they query lazily on
first surface read.** Only UI-pref slices (theme id,
last-opened-story id, etc.) may rehydrate at construct. Without
this invariant, a data-model slice with construct-time
rehydration would pick up pre-recovery state and stay stale until
invalidated. With it, the first surface to render after recovery
hydrates fresh from the post-recovery rows.

The recovery hook's specific module path (where `recoverInFlightRuns`
lives in the codebase) lands with the broader startup-flow design
that
[`architecture.md → What this doc does not yet cover`](./architecture.md#what-this-doc-does-not-yet-cover)
also tracks.

#### Recovery modal

When `recoverInFlightRuns` returns with `reversed.length > 0`,
the recovery report goes into a `pendingRecoveryReport` slot in a
UI-state Zustand slice. The first user-facing surface that renders
after boot drains the slot via `useEffect` and mounts an
[`AlertDialog`](./ui/patterns/alert-dialog.md) with a single `OK`
action and kind-aware copy naming the affected story:

- `per-turn` → _"An interrupted shutdown was detected in
  `{storyName}`. Your last AI response was reverted to keep the
  story consistent."_
- `chapter-close` → _"An interrupted shutdown was detected in
  `{storyName}`. The chapter-close pass was reverted; your story
  content is intact."_
- `periodic-classifier` → _"An interrupted shutdown was detected
  in `{storyName}`. A background memory update was reverted; your
  story content is intact."_

`{storyName}` resolves from the orphan's `story_id`; if NULL,
copy substitutes a non-named variant. Multi-orphan modals
concatenate orphans into one paragraph rather than chaining N
modals — the case is vanishingly rare (concurrent same-kind runs
can't happen; chained runs don't run simultaneously), so pretty UI
for it isn't worth designing.

Zero-reverse orphans (the pre-first-delta case) and recovery
failures don't mount the modal; they surface via observability
only.

#### Recovery-failure policy

When `reverseReplayDeltas` throws `DeltaReplayError` during startup
recovery, the loop catches per-orphan and continues; boot is not
blocked. The orphan row stays with `finished_at = NULL` so the next
boot retries, and the failure emits `pipeline.recovery_failed` at
`error` severity via observability — visible in the Diagnostics Hub
Logs tab. The modal layer stays silent: the user's state is
consistent (SQLite ROLLBACK undid any partial replay), the failure
is almost always cross-version-related (an orphan's `undo_payload`
references a column shape that no longer exists post-migration —
the deferred multi-version apply-dispatcher case), and the orphan
retries transparently on next boot.

No max-retry counter and no admin "drop orphan" affordance for v1;
stuck orphans remain visible in Logs across boots. The real fix
lives with the multi-version apply-dispatcher work.

The design exploration for this consumer-side wiring is
[`explorations/2026-05-17-crash-recovery-startup.md`](./explorations/2026-05-17-crash-recovery-startup.md).

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

The chained chapter-close generates its **own fresh `actionId`** —
per-turn's deltas and chapter-close's deltas are independently
undoable; first user CTRL-Z reverses chapter-close, second reverses
per-turn. No intermediates inherit.

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
React render. The gate-blocking selector evaluates against the
new `txState` (still has a hard-gate run present) on the next
render. User edit window: zero.

(Invariant depends on Zustand's setState being synchronous; pin
in tests if a state-library swap ever happens.)

### Reverse-replay

```ts
async function reverseReplayDeltas(actionId: string): Promise<number> {
  const deltas = await db.query('SELECT * FROM deltas WHERE action_id = ? ORDER BY seq DESC', [
    actionId,
  ])
  if (deltas.length === 0) return 0

  await db.exec('BEGIN')
  try {
    for (const delta of deltas) {
      applyUndo(delta.target_table, delta.target_id, delta.undo_payload)
    }
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw new DeltaReplayError('Reverse-replay failed', { cause: e, actionId })
  }
  return deltas.length

  // Runtime callers re-fetch affected rows into Zustand from the reversed
  // SQLite state. Startup recovery has no store state to refresh — the
  // first story-open after boot hydrates fresh.
}
```

The primitive is substrate-level and consumed by two callers:
runtime `abortRun` (re-wraps the thrown `DeltaReplayError` as a
`PipelineError` so the orchestrator's pipeline-failure path handles
it) and startup `recoverInFlightRuns` (catches `DeltaReplayError`
directly and routes to the recovery-failure policy above). The
return value is the delta count so callers can distinguish a
pre-first-delta zero-delta case from a real recovery.

Abort is conceptually identical to user CTRL-Z — same
`undo_payload` primitive, same reverse-replay path. Whether the
delta rows themselves are deleted or marked-reversed after replay
is a [data-model decision](./data-model.md#entry-mutability--rollback);
the framework just consumes the primitive.

### Streaming partial-entry on abort

Pre-completion abort: no `op=create` delta exists for the entry
yet. Orphan placeholder dropped via `abortStreamingEntry(entryId)`
(side-channel, no delta). Any classifier-piggyback deltas that
already fired during the stream reverse-replay normally.

### Wizard exemption

Wizard creation isn't a pipeline run; its commit is a single
SQLite txn outside the orchestrator. This lifecycle doesn't apply.

---

## Error, cancel, and retry

### Two retry tiers, both at phase level

A wrapping helper around an LLM call handles both:

1. **Provider-side retry** — network, 5xx, timeout. SDK call
   rejected before a response landed.
2. **Parse / data-shape retry** — call returned, but the response
   isn't usable. Strict parse failed, jsonrepair failed.

Both re-call the LLM with the same prompt up to a budget. Each
failed attempt yields a `recoverable_error` event. Retries are
transparent — the phase eventually returns success or fatal; no
user surfacing in between.

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

Non-retryable errors short-circuit: auth failures (401 / 403) skip
retry. Same for 4xx client errors. Provider-error classification
lives in the provider abstraction layer (one floor below the
pipeline framework).

### Phase-level recovery is the v1 transparency goal

The framework's job is to handle parse failures **transparently** —
phase retries, eventually succeeds via LLM sampling variation,
pipeline continues. User never sees the hiccup. Pipeline doesn't
restart from scratch.

V1 retry strategy is "same call, retry N times." Enough for most
parse failures.

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

### Chapter-close partial failure

Phase-level retry means most mid-chapter-close hiccups never
escalate to fatal. Only when retries exhaust does chapter-close
abort whole. One `actionId` per pipeline run = atomic CTRL-Z; the
contract holds. If a future pipeline ever needs partial-commit
semantics, it requires a different design (multiple actionIds per
pipeline, orchestrator commits each phase's actionId as it
completes).

### User cancel = abort (no error path)

User cancel is not an error. Orchestrator triggers
`run.abortController.abort()`; phases see `signal.aborted`, return
aborted; reverse-replay runs; `run_complete` emits with
`outcome: 'aborted'`. UI distinguishes cancel from failure by
reading outcome.

### Fatal error categories

```ts
type PipelineError =
  | { kind: 'provider'; reason: 'auth' | 'network' | 'timeout' | 'unknown'; detail?: string }
  | { kind: 'phase-logic'; detail: string } // malformed output, contract violation
  | { kind: 'action-layer'; detail: string } // schema/constraint failure on persisted write
  | { kind: 'orchestrator'; detail: string } // abort-path wrap (catches DeltaReplayError, etc.)
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
  overlapping my `writeSet`; ships when `writeSet` does).

`concurrencyPolicy`:

- `blockedBy` — incoming run's perspective: "these running kinds
  block me from starting." Orchestrator consults on
  `runPipeline(kind)` entry.
- `yieldsTo` — running run's perspective: "if any of these kinds
  tries to start, I abort." V1 doesn't use it; kept on the
  interface for future cases.

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

`blockedBy` prevents NEW starts; it does NOT kill running pipelines.
The architectural premise (`memory/cadence.md → Concurrency`) is that
the periodic classifier and the per-turn pipeline write disjoint
field sets at SQLite row granularity, so concurrent runs don't
clobber each other.

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
`RunState` without going through `runPipeline`'s entry check.
`blockedBy` reflects external start requests (UI, scheduler);
chains aren't external.

### Background scheduler — out of framework scope

Pipelines like the periodic classifier aren't user-triggered. The
framework doesn't ship the scheduler itself; a small layer on top
reads each pipeline's trigger declaration (out of scope here;
tracked with the periodic-classifier design in
[`memory/classifier.md`](./memory/classifier.md)).

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
  setState being synchronous; if the state library swaps and the
  property breaks, the no-user-edit-window guarantee breaks too.
- **Phase functions are zero-parameter.** Forced by the
  single-run-per-kind invariant — phases identify "their" run via
  the kind-keyed `generationContext` getter.
- **Disjoint write sets between concurrent pipelines.** Per-turn
  (and its piggyback / fallback-classifier variants) writes a
  different field set from the periodic classifier. Prose-enforced
  via narrow action functions named for their field-set scope. Any
  new action function should be reviewed for write-set overlap
  with concurrent pipelines.
- **One `actionId` per pipeline run.** Including chapter-close's
  five phases. Atomic CTRL-Z is the contract.
- **Side-channel actions are pipeline-internal.** No `source`
  field; not exported as part of the public store action surface.
  Only the orchestrator calls them.

---

## Open / deferred

- **`scoped-gate` + structural `writeSet`.** V1 ships `hard-gate`
  and `no-gate` only; the third value lands when the first
  pipeline benefits from per-field gating rather than global. The
  `writeSet` declaration ships with it.
- **Smarter mid-pipeline data error recovery.** V1 retry strategy
  is "same call, retry N times." Future direction: re-prompt with
  the failed response embedded, adjust call parameters per retry,
  per-call-type strategies. `callWithRetry` becomes pluggable.
- **Streaming-aware retry / partial-content persistence.**
  Mid-stream provider failures lose partial content in v1. Future:
  resume from chunk N, or let the user accept partial content.
- **Final-delta-to-commit window tightening.** The v1 crash-recovery
  marker scheme has a small data-loss window between the final
  action's SQLite commit and the `pipeline_runs` finish marker
  UPDATE. Tighten by coupling them in one txn when measurement
  shows it bites.
- **Translation graceful degradation.** Today, a translation phase
  fatal failure aborts entire per-turn. Should degrade
  (narrative commits without translation; translation retried on
  next view) rather than burn the AI response.
- **Pack-defined pipeline kinds (post-v1).** Pack model assumes
  templates / macros only. `PipelineAction` kind set is closed
  (TypeScript union); pack-defined deltas would need a different
  shape.

See [`followups.md`](./followups.md) for v1-active items and
[`parked.md`](./parked.md) for post-v1.
