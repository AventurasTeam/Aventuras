# Aventuras — architecture

How the pieces fit together. `docs/data-model.md` tells you what's stored;
`docs/tech-stack.md` tells you what it's built with; this doc tells you
how code is organized and how data flows through it.

Living doc. Add sections as decisions solidify, update as implementations
settle.

---

## Pipeline principles

The core of the app is the **generation pipeline** — the sequence that
turns a user action (new message, regenerate) into an AI-generated
narrative reply + classified world-state changes + persisted deltas. The
old app's `src/lib/services/generation/GenerationPipeline.ts` is the
reference architecture; v2 adopts the shape and strips the ceremony.

### Phases are plain async-generator functions

Old app: each phase is a class instantiated with a `PipelineDependencies`
bundle threaded through constructors. V2: each phase is a standalone
async generator function that takes narrow, turn-specific inputs (narrative
content, `action_id`, abort signal, etc.).

```ts
// Old (verbose)
class ClassificationPhase {
  constructor(private deps: ClassificationDependencies) {}
  async *execute(input: ClassificationInput) { ... }
}

// V2 (lean)
async function* classifyReply(input: {
  narrativeContent: string
  actionId: string
  abortSignal?: AbortSignal
}) {
  const { story, currentBranch, entities, happenings } = useStoryStore.getState()
  ...
}
```

No constructor, no `deps` bundle, no prop-drilling. Phases import the
store at module top and read via `getState()` as needed.

### Zustand is the state access layer, not a prop

The major pain point in the old pipeline was wiring: every phase needed
world state, every phase needed the story, every phase needed a dozen
services — all of it had to pass through constructors and configs. V2
eliminates that: **any pipeline code that needs state reads directly from
Zustand.** No injection, no prop drilling.

Testability: Zustand stores are seedable per-test via `useStoryStore.setState(...)`.
Testing a phase = seed the store, run the generator, assert on emitted
events/deltas.

### Pipeline is functionally pure; orchestrator applies effects

Phases **emit events**; they don't mutate SQLite or the store directly.
An orchestrator layer consumes the event stream and calls Zustand actions
that do the persistence:

```
┌──────────────────────────────┐
│  GenerationPipeline (pure)   │ ── yields events + delta payloads
└──────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│  PipelineOrchestrator        │ ── consumes events
└──────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Zustand actions             │ ── write SQLite + append delta + update store
└──────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│  UI re-renders               │ ── subscribes to store
└──────────────────────────────┘
```

UI also subscribes to the pipeline event stream in parallel, for
progress indicators and streaming content render. State updates arrive
through Zustand; structural events (phase start/complete, errors) arrive
direct.

### AsyncGenerator event streams

Carry this pattern over from the old app — it works well. Each phase
yields structured events:

- `phase_start` / `phase_complete`
- `stream_chunk` (narrative tokens as they arrive)
- `delta_emitted` (a delta payload ready for orchestrator to apply)
- `error` (recoverable or fatal)

`AsyncGenerator<Event, PhaseResult>` gives us one construct that handles
streaming + progress + final result.

### AbortSignal threaded through everything

Every phase takes an optional `abortSignal`. User-initiated cancel
propagates to the LLM call, the retrieval query, the image request, etc.
Aborted runs produce a well-defined result with `aborted: true` — not
thrown exceptions.

---

## Agent orchestration

Three background-ish agents run in this app. Each has a clear cadence
trigger and clear scope.

| Agent                       | Trigger                              | Scope                                                                       |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| **Classifier**              | Every AI reply (in-pipeline)         | Extract world-state changes from narrative → emit deltas                    |
| **Lore-management agent**   | Chapter close only (out-of-pipeline) | Promote staged entities, update/create lore from chapter events             |
| **Memory-compaction agent** | Chapter close only (out-of-pipeline) | Consolidate low-salience `happening_awareness` rows into summary happenings |

**Classifier** is the only per-reply agent. Old app's "post-generation
phase with lore-management" ran after every reply but actually gated
lore-mgr on chapter-create events — we make that explicit in v2 by
moving lore-mgr out of the main pipeline entirely.

**Chapter-close** is its own sub-pipeline, triggered when the token
threshold is crossed (per-story setting) or the user explicitly closes.
Phases:

1. **Boundary selection** — LLM picks a natural ending entry within the
   open region
2. **Chapter metadata** — LLM generates title, summary, theme, keywords
3. **Lore management** — promotes/updates/creates lore based on closed
   range
4. **Memory compaction** — consolidates awareness rows

All four emit deltas under one `action_id`. A single CTRL-Z from the
user reverses the entire chapter-close if they change their mind.

---

## Translation as a pipeline concern

Translation of LLM-generated user-facing content is a pipeline phase,
not a one-off feature. It runs in parallel with classification after
the narrative phase finishes. The `translations` table (see
`docs/data-model.md`) stores each translation as one row keyed by
`(branch_id, target_kind, target_id, field, language)`.

**What gets translated:**

- Narrative content (the AI reply itself)
- User action content (so the LLM-facing log is monolingual even when
  the UI shows the user's native tongue)
- Entity name + description + state-specific fields as they're created
  or modified
- Lore title + body when created or edited
- Thread title + description
- Happening title + description
- (Chapter title/summary on chapter close)

**Why centralize:**

- Old-app pattern of `translated_name` / `translated_description` columns
  per table led to column proliferation AND hard-coded "one target
  language" — lost prior translations on reconfig
- Single table scales to multiple target languages without schema changes
- Participates in the delta log uniformly (`deltas.target_table =
'translations'`) — rollback reverses translations alongside their
  source writes

**Runtime:** Zustand loads translations into a flat index for O(1)
render-time lookup. Components that render user-facing text call a
helper like `t(source, field)` that looks up the current language's
translation and falls back to source.

---

## What this doc does not yet cover

Flag for future sessions:

- **Concrete data flow trace** — the exact end-to-end path of one user
  turn through Pre → Retrieval → Narrative → [Classification ‖
  Translation] → Post, including Zustand dispatch points and SQLite
  writes. Next up.
- **Module / folder layout** — concrete repo organization (`src/db/`,
  `src/store/`, `src/ai/pipeline/`, etc.)
- **Platform boundaries** — Electron main vs renderer, filesystem access
  patterns, IPC, what's RN-native-only, asset directory resolution per
  platform
- **Retrieval** — how the prompt-context builder selects entities, lore,
  happenings, threads to include; token budgeting; POV-awareness via
  `happening_awareness`
- **Streaming resilience** — mid-stream failure handling, partial-content
  persistence, retry strategy
- **Error handling** — recoverable vs fatal at each layer; user-facing
  error surfaces
- **Startup + migration flow** — first-boot initialization, schema
  migration on version bump, crash recovery, loading current story on
  app launch
- **Secrets storage** — API keys in SQLite (per data strategy), whether
  encrypted at rest, how they flow from settings UI into AI SDK calls
