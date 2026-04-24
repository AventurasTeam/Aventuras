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

// V2 (lean) — zero parameters; everything read from Zustand
async function* classifyReply() {
  const { narrativeResult, abortSignal, actionId } = useGenerationStore.getState()
  const { entities, happenings } = useStoryStore.getState()
  if (!narrativeResult || abortSignal?.aborted) return { aborted: true }
  ...
}
```

No constructor, no `deps` bundle, no prop-drilling, **no function
parameters**. Phases read from the generation store (inputs,
intermediates, abort signal, action_id) and from the story store
(loaded narrative state) directly. If a phase genuinely needs a
per-call knob that doesn't belong in global state (e.g. a test
override), that's the rare exception — the norm is zero params.

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

### Formatting lives in Liquid, not in the context builder

A direct consequence of the single-context policy: **the unified
context carries relatively raw data, and prompt-specific formatting
happens inside the Liquid template.** The alternative — pre-formatted
variants for each consuming template — would bloat the context and
force every prompt to share identical text shape. Neither is
acceptable. And more importantly, this community tinkers — pack
authors and power users want real control over the prompts they're
shipping to the LLM. Liquid is the lever they pull.

In practice:

- The context carries structured data (entity arrays, happening sets,
  chapter lists, etc.) in close-to-native form
- Templates iterate, filter, conditionally render, and format using
  Liquid's built-in tags + filters
- **Custom Liquid filters** are the escape hatch for transforms that
  would be ugly in raw Liquid or get reused across templates; they're
  implemented in code once and exposed to every template

### Custom filters: the author's toolbox

Built-in filters are for **data shaping and utility**, not text
formatting. Text formatting happens in the template directly (via
variable rendering) or inside a macro (see below). A code-side
formatter would lock the text shape in code where authors can't
override it — that violates the north star. Two categories:

**Selectors** (filter or reshape arrays; return arrays):

- `by_kind: 'character'` — filter entity array by kind discriminator
- `active` / `staged` / `retired` — filter entities by status
- `known_to: pov_character` — filter happenings by the POV character's
  awareness links, so only facts the character knows appear
- `involving: entity_id` — filter happenings by involvement
- `recent: n` — last N entries
- `sorted_by: 'field'` — sort with a named key

**Utilities** (stateless transforms; return primitives):

- `tokens` — count tokens of a string or array (backed by
  `js-tiktoken`)
- `truncate_tokens: n` — truncate to N tokens, smart at sentence
  boundaries
- `prose_join` — `["A","B","C"]` → `"A, B, and C"`
- `json` — stringify for cases where the prompt embeds JSON literally
- `has_keyword: source_text` — truthy when any of the filter's
  keywords appear in source_text

Real list grows as templates demand. Implementation: each filter
registers with LiquidJS at app init via `engine.registerFilter(name,
fn)`. Filter function is TypeScript, typed end-to-end.

### Macros — reusable Liquid snippets, not code-side formatters

Text formatting — a character block, a happening rendered for memory
recall, an output-format directive — belongs in **macros**, not
filters. A macro is a `.liquid` snippet included from other templates
via `{% include 'macro-id' %}`. The old app had a `staticContent`
group for this but never really used it; v2 names the concept `macros`
and leans on it heavily.

Every macro is created with a **context group tag**. The group drives:

1. **Editor awareness** — the Liquid editor's autocomplete shows the
   group's variables when editing the macro (same registry that powers
   template autocomplete)
2. **Include compatibility** — a template in group G can only include
   macros tagged with G or `staticContent` (the zero-variable fallback
   for truly group-free macros like output-format directives). The
   editor flags mismatches at author time; a runtime validator catches
   them on pack load

Example built-in macros:

- `macros/character_block` (`promptContext`) — a character formatted as
  a description block
- `macros/happening_for_memory` (`promptContext`) — a happening
  formatted as it would appear in a POV character's memory, including
  the source descriptor
- `macros/output_format_narrative` (`staticContent`) — the output
  instruction block for narrative generation
- `macros/output_format_json` (`staticContent`) — generic JSON output
  directive

Pack authors can **override any shipped macro** by defining one with
the same ID in their pack; the pack's version takes precedence. They
can also define entirely new macros in their own pack. This is how a
pack rebuilds the prompt shape without touching app code — macros are
the override surface.

### Author extensibility — v1 and beyond

**V1 scope:**

- Users edit `.liquid` prompt files via the CodeMirror editor (desktop/web)
- Editor autocompletes variable names, filter names, and includable
  macro IDs (filtered by the current template's context group)
- Filters are code-defined and shipped with the app
- Pack authors can define new `.liquid` templates and macros
  (group-tagged on creation), and override shipped macros by reusing
  their IDs

**Future directions** (not v1, but the architecture shouldn't foreclose
them):

- **Pack-defined custom filters** — sandboxed JS expressions or a
  safe DSL, registered per-pack. Lets pack authors add transforms
  without recompiling the app. Real risk is sandboxing; deferred.
- **Additional context variables exposed per pack** — pack-scoped
  variables (runtime variables mentioned in tech stack). Deferred
  with the pack system generally.
- **Filter composition** — allowing users to chain filters into named
  aliases for convenience.

The north star: **a pack author should be able to rebuild the entire
prompt shape if they want.** Nothing about "how prompts look" is
buried in code that isn't reachable from a template.

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
| `staticContent`   | Variable-free macros (output-format directives, boilerplate blocks) — includable from any group                                                                                                                         |

For v1 ship `promptContext` + `wizard` (likely — wizard lands with the
first "create a story" flow). The others land with their corresponding
features. The group system itself is day-one infrastructure; without it
the prompt editor can't provide autocomplete or validate references.

### Variable registry (for the prompt editor)

A registry file (`src/ai/prompts/templateContextMap.ts` in v2) exists
**specifically to give the prompt editor shape awareness** — autocomplete,
inline variable docs, display-group organization in the sidebar. It is
**not** the runtime source of truth for what gets injected into a
template; that's the actual `promptContext` object computed by code.

What the registry contains:

- **Variable definitions per group**: `name`, type, `category`,
  `description`, optional `infoFields` documenting nested structure,
  optional `enumValues`, `required` flag — consumed by CodeMirror's
  Liquid mode for autocomplete and hover docs
- **Template → group map**: every `.liquid` template ID mapped to
  exactly one group so the editor knows which variable set to show
- **Display groups**: UI-level semantic grouping (Story Config, Entities,
  World State, Generation Results, Time, ...) — powers sidebar/autocomplete
  organization in the prompt editor
- **Integrity validator**: test-accessible function that reports
  unmapped template IDs and display-group variables that don't match
  any defined variable. Catches obvious drift but does not enforce that
  the registry and the runtime shape agree — that discipline sits with
  the authors of both sides.

The runtime shape of `promptContext` is whatever the computed getter
returns; TypeScript types on the runtime side are the real safety net.
The registry mirrors that surface for authoring ergonomics.

### The generation store

Pipeline inputs + intermediates live in a Zustand store —
`useGenerationStore` — sibling to `useStoryStore`. Exact field shape
is for v2 to design clean; what matters is the conceptual separation
of what it holds:

- **Inputs** — the parameters of the current turn (user action,
  action type, abort signal, raw input). Set at turn start.
- **Loaded context** — data computed on story open and reused across
  turns (pack variables, style prompt). Persists until story switch.
- **Pipeline intermediates** — results written back by each phase as
  it completes (retrieval result, narrative result, classification
  result, translation result, ...). Readable by later phases and
  templates in the same turn.
- **Derived getters** — read across this store + `useStoryStore` +
  the settings stores to produce the unified `promptContext` object,
  plus token counts and other cached computations.
- **Lifecycle**
  - `clearIntermediates()` at turn start (new message, regenerate) —
    wipes inputs + intermediates but keeps loaded context
  - `clear()` on story switch — resets everything

The `promptContext` getter is where the merge happens: it reads static
story state from `useStoryStore.getState()`, LLM-relevant user settings
from their settings stores (see below), and combines those with the
generation store's inputs + intermediates into one object that every
template in the `promptContext` group renders against.

### Settings: strict types, defaults at load

The `promptContext.userSettings` slice exposes the LLM-relevant subset
of settings: retrieval caps, classifier config, memory config, image-
generation config, translation settings, visual-prose mode, etc. These
come from two sources — **app-level settings** (global, persist across
stories; e.g. classifier truncation, image-gen caps) and **story-level
settings** (in `stories.settings` JSON; e.g. memory config, POV, tone,
mode).

**Pattern to avoid (the old app's):** inline `??` fallbacks and hardcoded
defaults at every read site, scattered across the `promptContext` getter
— `settings.foo ?? 100`, `story.settings.bar ?? 'baz'`, etc. No single
place held "the real shape of user settings." Result: silent drift,
duplicated defaults, weakly-typed access at the consumer.

**V2 pattern:** settings are **zod-parsed on load** — app settings when
the settings store hydrates, story settings when the story opens — with
defaults applied at parse time. By the time any code reads them, every
field is guaranteed to be its declared type, every optional field has
its default filled in, and no `??` fallback should appear in the
`promptContext` getter or anywhere else. If a value is missing from the
persisted JSON, that's the parse's job to fix, not the reader's.

The generation store doesn't own settings storage — it just reads via
`getState()` on the app-settings store and the loaded story's settings
slice, and surfaces them through `promptContext.userSettings` as a
clean, flat, typed shape for templates to consume.

### How phases consume and produce context

```ts
async function* classifyReply() {
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
