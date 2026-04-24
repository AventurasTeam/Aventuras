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

## Generation context and prompt templates

The pipeline revolves around **one unified context object** that every
prompt template within a context group receives. Templates don't take
bespoke inputs — they pull what they need from that single shape, and
pipeline phases write intermediate results back to the same object so
later templates can read them. Reference architecture:
`src/lib/stores/story/generationContext.svelte.ts` +
`src/lib/services/templates/templateContextMap.ts` in the old app's
rewrite branch.

### The single-context principle

- **One shape per group, rendered to every template in that group.** No
  per-template input wiring; if a template needs the narrative result,
  it references `narrativeResult.content` from the same context that
  the narrative template used to receive `storyEntries`.
- **Pipeline intermediates flow through the context.** `retrievalResult`,
  `narrativeResult`, `classificationResult`, `translationResult`,
  `chapterAnalysis` are written by phases into the generation store and
  become available to later templates in the same run.
- **Pack variables (user-defined custom fields) sit alongside built-ins.**
  A pack author sees the same API surface a built-in template sees.
- **No prop-drilling between phases or templates.** Phases read via
  `useGenerationStore.getState().promptContext()`; templates render
  against that output.

### Context groups

Different surfaces need different variable sets. The template registry
maps every `templateId` to exactly one group:

| Group             | Consumers                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promptContext`   | Pipeline + post-pipeline generation templates: classifier, narrative, suggestions, action-choices, chapter-analysis, chapter-summarization, translate-\*, style-reviewer, agentic-retrieval, image-prompt-analysis, ... |
| `wizard`          | Story-creation flow: setting expansion, character elaboration, opening generation, supporting characters                                                                                                                |
| `vault`           | Vault (reusable library) AI interactions                                                                                                                                                                                |
| `lore`            | Lore-management agent templates (at chapter close)                                                                                                                                                                      |
| `import`          | Character-card imports, vault imports, lorebook classifiers                                                                                                                                                             |
| `portrait`        | Character portrait generation                                                                                                                                                                                           |
| `translateWizard` | Translation-wizard flow                                                                                                                                                                                                 |
| `staticContent`   | Partials with no variables (included by other templates)                                                                                                                                                                |

For v1 ship `promptContext` + `wizard` (likely — wizard lands with the
first "create a story" flow). The others land with their corresponding
features. The group system itself is day-one infrastructure; without it
the prompt editor can't provide autocomplete or validate references.

### Variable registry

A single file (`src/ai/prompts/templateContextMap.ts` in v2) is the
source of truth:

- **Variable definitions per group**: `name`, type (`text | number |
array | object | enum`), `category` (system / user / runtime),
  `description`, optional `infoFields` documenting nested structure,
  optional `enumValues`, `required` flag
- **Template → group map**: every `.liquid` template ID mapped;
  unmapped IDs log a warning at load time
- **Display groups**: UI-level semantic grouping (Story Config, Entities,
  World State, Generation Results, Time, ...) — powers sidebar/autocomplete
  organization in the prompt editor
- **Integrity validator**: test-accessible function that reports
  unmapped template IDs and display-group variables that don't match
  any definition. Catches drift as templates and shapes evolve.

CodeMirror 6 + Liquid mode sources autocomplete from this registry.

### The generation store

Pipeline inputs + intermediates live in `useGenerationStore`, a sibling
to `useStoryStore` (which holds the loaded story bundle). Rough shape:

```
GenerationState {
  // Inputs (set at turn start)
  userAction: { entryId, content, rawInput } | null
  abortSignal, actionType, rawInput, wasRawActionChoice
  narrationEntryId, styleReview

  // Loaded context (computed on story open, persists across turns)
  packVariables?, stylePrompt

  // Pipeline intermediates (written by phases during a turn, wiped between turns)
  retrievalResult, narrativeResult, classificationResult,
  translationResult, postGenerationResult, ...

  // Translation payloads (written by post-narrative phases)
  suggestionsToTranslate?, actionChoicesToTranslate?, uiElementsToTranslate?

  // Derived getters (read across both stores)
  promptContext(): PromptContext
  tokensSinceLastChapter(): number
  tokensOutsideBuffer(): number
  wordCount(): number

  // Lifecycle
  clearIntermediates()    // at start of each turn (new message / regenerate)
  clear()                 // on story switch
}
```

The `promptContext()` getter is where the merge happens — it reads
static story state from `useStoryStore.getState()` and combines it with
the generation store's inputs + intermediates into a single object
matching the registry's `promptContext` group definition.

### How phases consume and produce context

```ts
async function* classifyReply(input: {
  narrativeContent: string
  actionId: string
}) {
  const ctx = useGenerationStore.getState().promptContext()
  const story = useStoryStore.getState()

  const classifier = getClassifier(story.story.settings.classifierModel)
  const rendered = renderTemplate('classifier', ctx)

  // ... call LLM, parse with zod, jsonrepair fallback ...

  const result = { classificationResult: { ... } }
  useGenerationStore.getState().setClassificationResult(result)
  yield { type: 'phase_complete', phase: 'classification', result }
}
```

Three things happen: phase reads unified context (no deps bundle), phase
writes its result back to the store (so later phases can read it), phase
yields an event (orchestrator applies derived deltas to SQLite +
`useStoryStore`).

### v2 shape of `promptContext` — what's carried over, what changes

| Old variable                                   | V2 replacement                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `characters` / `locations` / `items`           | Unified under `entities` discriminated by `kind`                                                         |
| `storyBeats`                                   | Renamed `threads`                                                                                        |
| `lorebookEntries`                              | Split: `lore` (timeless reference) + entities with `status='staged'` (pre-introduced actors)             |
| `relevantWorldState`                           | Same concept; filtered slice of entities/happenings/lore driven by POV character's `happening_awareness` |
| `timeTracker`                                  | Derived from latest entry's `metadata.elapsedTime`                                                       |
| `translated_*` columns via `translationResult` | Reads through the `translations` table (polymorphic target) instead of per-column fields                 |
| Pipeline intermediates (narrativeResult, etc.) | Same — written to generation store, available to later templates                                         |
| `packVariables.runtimeVariables`               | Same pattern; deferred until pack system lands                                                           |

### Why intermediates aren't persisted

The generation store is a **scratchpad**, not history of record. What
gets persisted to SQLite is:

- The user's action as a `story_entries` row (via a delta created in the
  Pre phase)
- The narrative content accrues on the AI entry row as the stream
  progresses (text edit side-channel, per Entry Mutability decision);
  on stream completion, the entry's `op=create` delta commits
- Classification output becomes N deltas on the log (entity creates /
  updates, happening creates, awareness links, etc.), all under the same
  `action_id` as the narrative
- Translation writes become `translations` rows + their deltas, same
  `action_id`

The store's copies of these results exist only so later templates in
the same turn can reference them. Between turns, `clearIntermediates()`
wipes everything. The delta log carries the history.

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
