# Aventuras — architecture

How the pieces fit together. `docs/data-model.md` tells you what's stored;
`docs/tech-stack.md` tells you what it's built with; this doc tells you
how code is organized and how cross-cutting concerns thread through it.

Living doc. Add sections as decisions solidify, update as implementations
settle.

The generation-pipeline framework — phases, orchestrator, action layer,
event bus, transactions, concurrency model — lives in its own doc at
[`docs/generation-pipeline.md`](./generation-pipeline.md). This doc
covers the surrounding pieces: prompt-authoring (templates, packs,
macros, filters), the settings shape templates consume, translation
as a pipeline concern, the retrieval-phase contract the rest of the
pipeline depends on, and agent-orchestration overview (with detail
pointing into [`memory/`](./memory/README.md)).

---

## Prompt templates and authoring

The pipeline revolves around **one unified `generationContext` object**
that every prompt template within a context group receives (see
[`generation-pipeline.md → Run-scoped state`](./generation-pipeline.md#run-scoped-state--intermediates-and-per-kind-contexts)
for the shape). Templates don't take bespoke inputs — they pull what
they need from that single context, and pipeline phases write
intermediate results back to the same context so later templates can
read them.

### The single-context principle

- **One shape per group, rendered to every template in that group.** No
  per-template input wiring; if a template needs the narrative result,
  it references `intermediates.narrativeResult` from the same context
  that the narrative template used to receive `entries`.
- **Pipeline intermediates flow through the context.** `retrievalResult`,
  `narrativeResult`, `classificationResult`, `translationResult`,
  `chapterAnalysis` are written by phases into the generation store and
  become available to later templates in the same run.
- **Pack variables (user-defined custom fields) sit alongside built-ins.**
  A pack author sees the same API surface a built-in template sees.
- **No prop-drilling between phases or templates.** Phases read via
  `useGenerationStore.getState().getPerTurnContext()` (or the kind's
  matching getter); templates render against that output.
- **`entity.id` exposed to templates is the placeholder, not the
  UUID.** Per
  [`data-model.md → ID shape`](./data-model.md#id-shape--kind-prefixed-uuids-throughout)
  and
  [`generation-pipeline.md → ID placeholder substitution`](./generation-pipeline.md#id-placeholder-substitution),
  the substitution layer swaps prefix-tagged UUIDs for short
  placeholders (`c1`, `l1`, `lo1`, …) at context-construction time
  — before Liquid renders. Pack authors writing
  `{{ entity.id }}` always get the placeholder; the UUID is never
  exposed to template-rendering code.

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

- `macros/character_block` (`generationContext`) — a character formatted
  as a description block
- `macros/happening_for_memory` (`generationContext`) — a happening
  formatted as it would appear in a POV character's memory, including
  the source descriptor
- `macros/output_format_narrative` (`staticContent`) — the output
  instruction block for narrative generation
- `macros/output_format_json` (`staticContent`) — generic JSON output
  directive

### The pack model: full replacement, not override

A **pack is a complete, self-contained bundle** of prompts + macros.
It contains the full required surface — every template the app
invokes, every macro the app's templates include — not a patch layer
on top of a default.

**Creation flow:** a user creating a custom pack starts with a **full
copy of the default pack**. Every prompt and macro is already there;
they edit whichever ones they want within their pack. Unchanged
prompts stay identical to default by virtue of being copied, not by
inheriting anything at runtime.

**Runtime model:** the active pack's version of any prompt/macro IS
what runs. There's no fallback chain, no "if missing, look in default"
cascade. This keeps the runtime simple and gives pack authors
unambiguous ownership of their pack's shape.

**Consequence to flag:** when an app update introduces a new required
prompt or macro, existing custom packs won't have it and will fail
that template's render. Pack migration tooling ("import new prompts
from default into your pack") becomes necessary once packs are a
real feature. Deferred with the pack system generally.

### Author extensibility — v1 and beyond

**V1 scope:**

- Users edit `.liquid` prompt files via the CodeMirror editor (desktop/web)
- Editor autocompletes variable names, filter names, and includable
  macro IDs (filtered by the current template's context group)
- Filters are code-defined and shipped with the app
- Pack authors work inside a full copy of the default pack, editing
  any prompt or macro within their pack. New macros are group-tagged
  on creation.

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

| Group               | Consumers                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generationContext` | Pipeline + post-pipeline generation templates: classifier, narrative, suggestions, action-choices, chapter-analysis, chapter-summarization, translate-\*, style-reviewer, agentic-retrieval, image-prompt-analysis, ... |
| `wizard`            | Story-creation flow: setting expansion, character elaboration, opening generation, supporting characters                                                                                                                |
| `vault`             | Vault (reusable library) AI interactions                                                                                                                                                                                |
| `lore`              | Lore-management agent templates (at chapter close)                                                                                                                                                                      |
| `import`            | Character-card imports, vault imports, lorebook classifiers                                                                                                                                                             |
| `portrait`          | Character portrait generation                                                                                                                                                                                           |
| `translateWizard`   | Translation-wizard flow                                                                                                                                                                                                 |
| `staticContent`     | Variable-free macros (output-format directives, boilerplate blocks) — includable from any group                                                                                                                         |

For v1 ship `generationContext` + `wizard` (likely — wizard lands with
the first "create a story" flow). The others land with their
corresponding features. The group system itself is day-one
infrastructure; without it the prompt editor can't provide autocomplete
or validate references.

### Variable registry (for the prompt editor)

A registry file (`src/ai/prompts/templateContextMap.ts` in v2) exists
**specifically to give the prompt editor shape awareness** — autocomplete,
inline variable docs, display-group organization in the sidebar. It is
**not** the runtime source of truth for what gets injected into a
template; that's the actual `generationContext` object computed by code.

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

The runtime shape of `generationContext` is whatever the kind-keyed
getter on the generation store returns; TypeScript types on the
runtime side are the real safety net. The registry mirrors that
surface for authoring ergonomics.

### v2 shape of `generationContext` — what's carried over, what changes

| Old variable                                   | V2 replacement                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `characters` / `locations` / `items`           | Unified under `entities` discriminated by `kind`                                                                                              |
| `storyBeats`                                   | Renamed `threads`                                                                                                                             |
| `lorebookEntries`                              | Split: `lore` (timeless reference) + entities with `status='staged'` (pre-introduced actors)                                                  |
| `relevantWorldState`                           | Same concept; filtered slice of entities/happenings/lore driven by POV character's `happening_awareness`                                      |
| `timeTracker`                                  | Derived from latest entry's `metadata.worldTime` + `definition.worldTimeOrigin` (see data-model.md → "In-world time tracking")                |
| `genre` / `tone` (single-string fields)        | `definition.genre.{label,promptBody}` and `definition.tone.{label,promptBody}` — substantial preset+prose blocks (label + body)               |
| `setting` (no v1 equivalent in old context)    | New: `definition.setting` — freeform prose injected into generation context                                                                   |
| `translated_*` columns via `translationResult` | Reads through the `translations` table (polymorphic target) instead of per-column fields                                                      |
| Pipeline intermediates (narrativeResult, etc.) | Same — written to generation store, available to later templates within the run                                                               |
| `packVariables.runtimeVariables`               | Same pattern; deferred until pack system lands (see [`parked.md → Pack runtimeVariables surface`](./parked.md#pack-runtimevariables-surface)) |

Definitional fields (mode, lead, narration, genre, tone, setting,
calendar) are sourced from `story.definition`; operational fields
(memory knobs, translation, models, pack) from `story.settings`. The
two zod-parsed shapes feed `generationContext` through different
sub-getters but compose into one rendered context object per the
single-context principle.

---

## Settings: strict types, defaults at load

The `userSettings` slice on the generation context exposes the
LLM-relevant subset of settings that prompt templates consume.
Several shapes feed into it:

1. **App-level settings** (`useAppSettingsStore`) — global, persist
   across stories. Holds two distinct roles:
   - **"Default story settings"** — values that act as defaults for
     new stories (memory knobs, translation config, composer UX
     prefs, suggestions toggle, etc.). On story creation, these are
     copied into the new `stories.settings`; the story owns them
     thereafter. Changing the global does NOT propagate to existing
     stories. This is the **copy-at-creation scope pattern**.
   - **Global model defaults** (`defaultModels.narrative`,
     `defaultModels.classifier`, ...) — resolved live at render time
     via the models resolver (see below). This is the
     **override-at-render scope pattern**.
   - **App-only settings** — global concerns that never appear
     per-story (API keys, classifier truncation caps, diagnostics
     toggles).
2. **Story-level definition** (`stories.definition` JSON on the
   loaded story) — definitional content (`mode`, `leadEntityId`,
   `narration`, `genre`, `tone`, `setting`, calendar fields). Zod-
   parsed at story open via the `StoryDefinition` schema with
   defaults applied. Full shape in data-model.md → "Story settings
   shape."
3. **Story-level settings** (`stories.settings` JSON on the loaded
   story) — operational config (memory knobs, translation, models,
   pack). Zod-parsed at story open via the `StorySettings` schema.
4. **Story identity fields** (`stories` columns — title, tags,
   cover, accent, etc.) — not LLM-consumed directly; these are
   library-shaped metadata.

**Scope policy — two patterns:** See data-model.md → "Story settings
shape" for the authoritative version. Summary: copy-at-creation for
operational + UX defaults (`stories.settings`); override-at-render
for models only; wizard-authored with no global default for
everything in `stories.definition`; columns-on-stories for identity.

**Pattern to avoid (the old app's):** inline `??` fallbacks and hardcoded
defaults at every read site, scattered across the context getter
— `settings.foo ?? 100`, `story.settings.bar ?? 'baz'`, etc. No single
place held "the real shape of user settings." Result: silent drift,
duplicated defaults, weakly-typed access at the consumer.

**V2 pattern:** settings are **zod-parsed on load** — app settings when
the settings store hydrates, story settings when the story opens — with
defaults applied at parse time. By the time any code reads them, every
field is guaranteed to be its declared type, every optional field has
its default filled in, and no `??` fallback should appear in the
context getter or anywhere else. If a value is missing from the
persisted JSON, that's the parse's job to fix, not the reader's.

**The models resolver is the one deliberate exception** to "no `??` at
read sites" — because models use override-at-render, the context
getter calls a named `resolveModel(feature)` function that does
`story.settings.models[feature] ?? appSettings.defaultModels[feature]`.
Single, typed, named — not ambient `??` scattered everywhere. Every
other setting read is a direct property access off the parsed story
settings.

The generation store doesn't own settings storage — it reads via
`getState()` on the app-settings store and the loaded story's settings
slice, and surfaces them through `userSettings` as a clean, flat,
typed shape for templates to consume.

---

## Agent orchestration

Memory-state writes split across three time scales per the cadence
stratification in [`memory/cadence.md`](./memory/cadence.md):

| Layer                      | Trigger                                                                 | Scope                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Piggyback**              | Every AI reply, inline on the narrative call (capability-gated)         | Scene-local fast-mutating state — `sceneEntities`, `currentLocationId`, `worldTime`, visual mutations, item transfers    |
| **Periodic classifier**    | Background, configurable cadence (`stories.settings.classifierCadence`) | Multi-turn batch extractions — happenings, involvements, awareness, entity status flips, first-introduction descriptions |
| **Chapter-close pipeline** | Token threshold crossed OR user-triggered                               | 5-phase pipeline: catch-up classifier, boundary, metadata, lore-mgmt (5 sub-jobs), lifecycle review                      |

The periodic classifier is itself a Pipeline (per
[`generation-pipeline.md`](./generation-pipeline.md)) — same
declaration shape as per-turn and chapter-close, with
`gateBehavior: 'no-gate'` and a `concurrencyPolicy` that lets it run
alongside per-turn while blocking it from starting during
chapter-close. Detailed contracts for each layer in
[`memory/piggyback.md`](./memory/piggyback.md),
[`memory/classifier.md`](./memory/classifier.md), and
[`memory/chapter-close.md`](./memory/chapter-close.md).

Two agents from the prior design were collapsed:

- **Memory-compaction agent** subsumed by chapter-close lore-mgmt
  (phase 3d awareness pin tuning + phase 3e happenings consolidation).
  Eager "summarize low-salience rows into summaries" was replaced by
  upsert-at-write (UNIQUE constraint on awareness rows) plus
  semantic-cluster consolidation at chapter close. See
  [`memory/chapter-close.md → Phase 3`](./memory/chapter-close.md#phase-3--lore-management).
- **Per-reply classifier** split into piggyback (when
  `piggybackMode='on'` and the narrative model has structured-output
  capability) + periodic classifier (background; handles the larger
  multi-turn batch). Either path covers the same write set; mode
  toggle is at `stories.settings.piggybackMode`.

### Classifier contract — metadata fields

Alongside entity / happening / awareness deltas, the classifier
populates the new entry's metadata:

- `sceneEntities: string[]` — entity IDs (characters + items) present
  in the scene this entry depicts.
- `currentLocationId: string | null` — the singleton location entity
  that IS the current scene.
- `worldTime: number` — seconds delta (universal across calendars)
  added to the previous entry's `worldTime`. The delta is
  **non-negative — `delta ≥ 0` is a hard pipeline-layer invariant**.
  Validation rejects classifier outputs with negative deltas; on
  rejection, re-roll once, then clamp to `0` and emit
  `logger.warn('classifier.delta_clamped', { originalDelta, finalDelta: 0, entryId })`
  if re-roll also fails (see
  [`observability.md → Logger contract`](./observability.md#logger-contract)). **For detected flashback / memory framing
  ("she remembered...", "25 years earlier..."), the classifier emits
  0** — main-timeline clock doesn't advance during recalled scenes.
  Cumulative monotonicity holds when written by the classifier
  alone; user manual `worldTime` edits (see
  [`data-model.md → In-world time tracking`](./data-model.md#in-world-time-tracking))
  may produce non-monotonic sequences, which the UI flags and
  downstream consumers tolerate. v1 doesn't model structural
  non-linear narrative — see
  [`data-model.md → In-world time tracking`](./data-model.md#in-world-time-tracking)
  for the limitation.

**User-action entries inherit at the action layer.** The classifier
doesn't run on `user_action` entries; the action layer initializes
each new user_action's `metadata.worldTime` from the immediately
preceding entry's value at write time (see
[`data-model.md → In-world time tracking`](./data-model.md#in-world-time-tracking)).
The classifier's "delta added to prev `worldTime`" rule on the
following AI reply picks up the inherited — or user-edited — base
naturally; no walk-back logic in the delta-base lookup.

### Opening-entry classifier exception

The classifier does NOT run on the opening entry (`kind='opening'`).
Two paths populate opening metadata, both at wizard-commit time
rather than via a classifier pass:

- **AI-generated openings** emit minimal scene metadata inline as
  part of the wizard's structured-output generation call (prose +
  `sceneEntities` + `currentLocationId` + `worldTime: 0` in one
  call). The model is constrained to reference only wizard-curated
  cast entity ids in the metadata refs.
- **User-written openings** start with empty metadata
  (`worldTime: 0`, `sceneEntities: []`,
  `currentLocationId: null`). The first AI reply's prompt context
  includes the opening prose verbatim (recent buffer covers it),
  so turn-2 classifier picks up scene presence going forward.

A separate tagging pass for user-written openings is parked in
[`parked.md → Classifier-on-opening retrofit`](./parked.md#classifier-on-opening-retrofit)
— retrofit if entry-1 metadata becomes load-bearing for any
downstream feature. See
[`data-model.md → Opening entry`](./data-model.md#opening-entry) for
the full opening contract.

### Chapter-close pipeline

Chapter-close is its own pipeline kind. Five phases under one
`actionId` (catch-up classifier, boundary selection, metadata,
lore-mgmt with five sub-jobs, lifecycle review). A single CTRL-Z
from the user reverses the entire chapter-close. Full design in
[`memory/chapter-close.md`](./memory/chapter-close.md). Chapter-close
holds the user-edit gate via `gateBehavior: 'hard-gate'`; the periodic
classifier is blocked from starting a new pass while chapter-close
is in flight (one-direction lock via the classifier's
`concurrencyPolicy.blockedBy`). The framework-level transaction +
gate mechanism lives in
[`generation-pipeline.md → Transaction lifecycle`](./generation-pipeline.md#transaction-lifecycle).

---

## Translation as a pipeline concern

Translation of LLM-generated user-facing content is a pipeline phase,
not a one-off feature. It runs after the narrative phase finishes
(in parallel with classifier-piggyback parsing where applicable). The
`translations` table (see `docs/data-model.md`) stores each translation
as one row keyed by
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
- Next-turn suggestion chip text — rides the `narrative` granular
  toggle; cached by content-hash of chip text so re-rolls and CTRL-Z
  reuse existing rows naturally (see
  [`explorations/2026-05-19-next-turn-suggestions.md`](./explorations/2026-05-19-next-turn-suggestions.md))

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

**Display-only invariant — translations never feed back into prompts.**
Translations are strictly one-way: `source → translated_text` for UI
rendering. The pipeline, classifier, retrieval, and narrative layers
always operate on the source-language content; the LLM-facing log is
monolingual regardless of UI language. Narrative is generated in the
source language; the classifier reads source-language entities;
retrieval filters source-language text.

Consequences:

- Switching `settings.translation.targetLanguage` does not invalidate
  narrative coherence — nothing the LLM ever saw changes.
- Translation of **user action content** (composed in the user's
  target language) is the exception that proves the rule: that
  translation runs in the OPPOSITE direction — target → source — so
  the LLM-facing log stays source-language. Same `translations`
  table, same phase, different translation direction.
- Re-translating an already-translated field looks up the existing
  row before calling the translation model, so translation memory
  is per-field-per-language and naturally consistent across a story.

**What translation CANNOT do:** change the language the AI writes in.
If a user wants the narrative generated in Spanish, that's a distinct
concept — a narrative-language / source-language setting — not
translation. Not currently modeled; flagged for later if demand
emerges. Translation is strictly a display-time surface.

---

## Retrieval / injection phase

Fills the prompt's entity / lore / happening / thread / chapter-
summary slices given token budget, injection modes, scene presence,
and POV-awareness. The full design — embedding infrastructure, query
construction, candidate pools, hybrid retrieval per type, the ranker
(scoring + MMR + budget-fill + bypass + chapter-match boost), and
pinning (`decay_resistance`) — lives in
[`memory/retrieval.md`](./memory/retrieval.md). This section
captures the architecture-level invariants the rest of the pipeline
depends on.

### Structural floor — always inject

These structural injects bypass the ranker; they consume budget
unconditionally before per-type retrieval allocates the remainder:

- **Recent buffer.** Last `stories.settings.recentBuffer` entries
  verbatim, regardless of chapter boundaries. With
  `fullChapterInBuffer=true`, the current chapter is also verbatim
  in addition. See
  [`memory/cadence.md → User-tunable knobs`](./memory/cadence.md#user-tunable-knobs).
- **Active + in-scene entities.** `entities.status='active' AND id ∈
metadata.sceneEntities` are ALWAYS injected, regardless of
  `injection_mode`. `currentLocationId` gets the same treatment.
- **Active threads.** `threads.status='active'` must-inject as
  structural framing.
- **`injection_mode='always'` rows** across entities / lore /
  threads — user-intent override.

Rationale for the active+in-scene invariant: the entity IS what the
current narrative revolves around. Excluding one on a user-set
`disabled` flag would produce broken prompts ("who is this person
the narrator keeps addressing?"). The mode setting is respected
everywhere the entity isn't structurally necessary.

### Injection mode — non-structural cases

After the structural floor seats, remaining candidate rows (lore,
non-scene entities, threads, chapter summaries, happenings via
awareness) are filtered by `injection_mode`:

- `always` — unconditional include in candidate pool.
- `auto` — let the retrieval pipeline decide via keyword + embedding
  - LLM-fallback. Default for new rows. Renamed from `keyword_llm`;
    see [`data-model.md → Injection modes`](./data-model.md#injection-modes--unified-enum--structural-invariant).
- `disabled` — skip entirely unless structurally required (which
  `disabled` cannot suppress).

Happenings don't carry `injection_mode` at all — the awareness graph
(`happening_awareness`) IS the injection rule. Common-knowledge
happenings (`happenings.common_knowledge=1`) bypass awareness
entirely and rank in their own pool by `sim_blend + kw_boost` only;
see
[`memory/retrieval.md → Common-knowledge happenings`](./memory/retrieval.md#common-knowledge-happenings--special-case).

### POV-awareness — union, both modes

Retrieval queries the awareness graph as the **union of all in-scene
characters' awareness rows** in both adventure and creative modes,
not lead-only. Detached-POV moments (a non-lead character acquiring
knowledge in a side scene) need the wider scope; the `narration`
setting is the lever for POV-constraint via prompt, not retrieval.
See
[`memory/retrieval.md → POV-awareness scope`](./memory/retrieval.md#pov-awareness-scope).

---

## Delta history diff resolution

History surfaces (entity and lore History tabs in
[`world.md`](./ui/screens/world/world.md#history-tab), thread and
happening History tabs in [`plot.md`](./ui/screens/plot/plot.md),
and the
[Diagnostics Hub Delta log tab](./ui/screens/diagnostics/diagnostics.md#tab-5--delta-log))
render rows via the
[`DeltaLogRow`](./ui/patterns/delta-log-row.md) pattern, whose
`summary: string` slot takes pre-formatted diff prose
(`Added "former soldier"; was ["brave", "loyal"]`). Forming that
prose for `op=update` deltas requires both the OLD value and the
NEW value: OLD lives in
[`deltas.undo_payload`](./data-model.md#diagram) directly, but
NEW is not stored anywhere — the live target row holds "state
right now," which equals "state right after this delta" only for
the most recent delta on that target.

The diff cache is the read-side substrate that resolves NEW
on demand. It is **in-memory only, lazy, per-delta-keyed, and
display-only.** No schema change, no persistence, no involvement
with search. Search continues to use raw SQL over `deltas` per
the scopes declared in each per-screen doc.

### Walk algorithm

For a target `op=update` delta D, fetch the chain of deltas on
the same `(branch_id, target_table, target_id)` with
`log_position >= D.log_position`, plus the current state of the
target row, **both inside a single SQLite read transaction**
(WAL gives a consistent snapshot, so a fresh delta committing
mid-walk cannot produce an off-by-one between the two reads).

Walk newest-to-oldest from the live row. The seed state comes
from the live row, unless the head of the chain is an `op=delete`
— in which case the delete's `undo_payload` (full pre-delete
row JSON per the
[delta storage economy decision](./data-model.md#entry-mutability--rollback))
seeds the walk. For each `op=update` delta on the path:

1. `new_partial = pick(state, keys(delta.undo_payload))`.
2. `old_partial = delta.undo_payload`.
3. Cache `{ new: new_partial, old: old_partial }` keyed by
   `delta.id`.
4. `state = applyUndoPayload(state, delta.undo_payload)` to step
   backward one delta.

`pick` is column-key-only at the top level: `keys(delta.undo_payload)`
returns column names (`['state', 'description']`), not nested paths,
so `new.<column>` ends up being the whole live column value while
`old.<column>` is the partial pre-change column. The asymmetry is
load-bearing for the renderer (see below). The `applyUndoPayload`
function is the same primitive rollback and CTRL-Z use to apply an
`undo_payload` to a row — the encoding contract and apply semantics
are pinned in
[`data-model.md → Entry mutability & rollback`](./data-model.md#entry-mutability--rollback).

**Renderer iteration rule.** Consumers rendering rich diff prose
from a cache entry must iterate `keys(old.<column>)` and look up
corresponding paths in `new.<column>` — not the reverse. Walking
`keys(new.<column>)` would emit spurious "changed" markers for
every sub-field present in current state but absent in the partial
pre-state. For a delta whose `undo_payload` is
`{state: {traits: ["brave"]}}` against a current row where
`state = {traits: ["brave", "former soldier"], drives: [...], voice: "low"}`,
the renderer reads `keys(old.state)` → `["traits"]` and emits
`Added "former soldier"` without touching `drives` or `voice`.

`op=create` and `op=delete` never go through the cache —
[`DeltaLogRow`](./ui/patterns/delta-log-row.md#summary) renders
them as one-liners directly.

### Cache shape and lifecycle

A process-wide singleton (proposed home `lib/deltas/diff-cache.ts`,
exact path is implementation-time):

```ts
type DiffCacheEntry = {
  old: Record<string, unknown>
  new: Record<string, unknown>
}

peek(deltaId: string): DiffCacheEntry | undefined  // sync, render-safe
populate(delta: Delta): Promise<DiffCacheEntry>    // async; runs the walk
populateBatch(deltas: Delta[]): Promise<void>      // groups by target
```

LRU eviction, hard cap **2000 entries**. Conservative estimate
~500 bytes per entry, ~1 MB at cap. Process lifetime; no
persistence. Cleared on app restart only; cold every launch by
design. `delta.id` is a globally-unique kind-prefixed UUID
([`data-model.md → ID shape`](./data-model.md#id-shape--kind-prefixed-uuids-throughout)),
so cross-story and cross-branch sharing in the same cache is
safe.

The walk's chain query relies on the
[`deltas_chain_idx` composite index](./data-model.md#diagram)
`(branch_id, target_id, log_position)` for acceptable performance
on active stories. Without it, every populate degrades to a
`deltas`-wide scan. `target_table` stays in the query as a
defensive post-filter, not as an index column — the kind-prefixed
UUID invariant ([`data-model.md → ID shape`](./data-model.md#id-shape--kind-prefixed-uuids-throughout))
makes `target_id` globally unique, so the three-column form is
strictly sufficient.

### Consumer flow

Each row's host (per-screen page) renders via:

1. `delta.op !== 'update'` → format one-liner directly. Cache
   not involved.
2. `delta.op === 'update'`:
   - `peek(delta.id)` first.
   - **Hit:** format rich `(old, new)` prose, pass as `summary`.
   - **Miss:** kick off `populate(delta)`, fall back to a
     summary derived from `undo_payload` keys alone (e.g.,
     `Modified traits, drives`). On populate resolution, the
     host's normal re-render path picks up the new entry and
     the row upgrades to the rich form.

The fallback keeps `DeltaLogRow`'s `summary: string` contract
unchanged. Pre-walk and post-walk are both real strings; the
post-walk version is richer.

Re-render trigger mechanism is host-determined and not
load-bearing for the cache contract (TanStack Query keyed on
`['diff', delta.id]` is the natural fit given the existing
stack).

`populate` coalesces concurrent calls for the same `delta.id`
via an internal in-flight promise map; `populateBatch` groups
by target so a visible window of N deltas across M targets runs
M walks, not N. Cross-delta-within-target coalescing is
deliberately not implemented — its worst case is one redundant
SQL query.

### Concurrency, rollback, error path

Reads happen concurrently with writes under WAL; the single-txn
read snapshot is the entire concurrency contract. New deltas
committing after a walk completes don't affect cached entries
(historical `(old, new)` is immutable for a given delta).

Rollback and CTRL-Z reverse-and-delete deltas
([`data-model.md → Entry mutability & rollback`](./data-model.md#entry-mutability--rollback));
cache entries for deleted delta IDs become stranded. Nothing
reads them — the deltas don't render on any surface anymore —
and LRU evicts naturally. **No invalidation API.**

Single renderer process at v1; cross-window coordination would
require IPC and is out of scope until multi-window support
ships.

On walk failure (DB error, corrupt state with target row missing
and no `op=delete` in the chain), `populate` rejects; the host
falls back permanently to the `undo_payload`-keys summary for
that row and emits a `debug`-level log per
[`observability.md → Logger contract`](./observability.md#logger-contract).
The row stays usable.

### Search is orthogonal

Search uses SQL over persistent deltas; the cache is not
queryable from search. Per-surface scope is preserved as
written: World History tab does `LIKE` plus `json_extract` over
`undo_payload`
([`world.md → History tab`](./ui/screens/world/world.md#history-tab));
Diagnostics Hub Delta log narrows further to target names and
field paths only
([`diagnostics.md → Tab 5 — Delta log`](./ui/screens/diagnostics/diagnostics.md#tab-5--delta-log)).
Neither scope reaches NEW-side-only value strings (a value just
added and not yet replaced lives only on the current row, not
in any `undo_payload`); accepted as a v1 limitation.

Full design rationale, trade-off discussion, and adversarial
review live in
[`explorations/2026-05-17-delta-diff-cache.md`](./explorations/2026-05-17-delta-diff-cache.md).

---

## What this doc does not yet cover

Flag for future sessions:

- **Concrete data flow trace** — the exact end-to-end path of one user
  turn through `Pre → Retrieval → Narrative → Piggyback-parse → Translation → Post`,
  including Zustand dispatch points and SQLite writes. Next up.
- **Module / folder layout** — concrete repo organization (`src/db/`,
  `src/store/`, `src/ai/pipeline/`, etc.)
- **Platform boundaries** — Electron main vs renderer, filesystem access
  patterns, IPC, what's RN-native-only, asset directory resolution per
  platform
- **Retrieval — empirical tuning** — substantially designed in
  [`memory/retrieval.md`](./memory/retrieval.md). What remains is
  decay rates, similarity thresholds, MMR diversity, budget defaults
  (calibrated against the
  [scale-assumed pool sizes](./memory/retrieval.md#scale-assumptions)
  once test stories exist).
- **Startup + migration flow** — first-boot initialization, schema
  migration on version bump, loading current story on app launch.
  Crash recovery is now pinned end-to-end in
  [`generation-pipeline.md → Crash recovery`](./generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  (marker table, boot-ordering slot, `recoverInFlightRuns` contract,
  modal UX, failure policy); only the recovery hook's specific
  module path is unspecified, landing alongside the rest of the
  startup-flow design.
- **Secrets storage** — API keys in SQLite (per data strategy), whether
  encrypted at rest, how they flow from settings UI into AI SDK calls
- **Observability + debugging** — substrate designed in
  [`observability.md`](./observability.md); hub UI in
  [`ui/screens/diagnostics/diagnostics.md`](./ui/screens/diagnostics/diagnostics.md).
  Logger contract, structural sinks, gating, and the per-turn
  inspector / call log / logs / delta-log tab inventory all live
  there. This doc cross-refs the logger via the classifier
  contract above; deeper subsystem-side emission inventories
  follow as each subsystem ships.
