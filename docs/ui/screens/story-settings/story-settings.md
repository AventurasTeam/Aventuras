# Story Settings

**Wireframe:** [`story-settings.html`](./story-settings.html) — interactive

Per-story configuration surface. Reached from the ⚙ icon in the
reader's top bar. Two domains under one roof: **Story** (what the
story is — wizard-editable definitional fields) and **Settings** (how
it generates — post-creation tuning knobs).

App Settings reuses the same layout pattern with different
sections/tabs.

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  (every editable field on this surface disables when a generation
  pipeline is in flight; save buttons too)
- [Mode, lead, and narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)
- [Composer mode — send-time transform](../../principles.md#composer-mode--send-time-transform-narration-aware)
- [Models are override-only (per-story)](../../principles.md#models-are-override-only-per-story)
- [Form controls — Select primitive](../../patterns/forms.md#select-primitive)
  (segment / dropdown / radio render-mode rule applies to every
  picker on this surface)
- [Save-session pattern](../../patterns/save-sessions.md)
  (the same pattern applies here)
- [Naming convention — World / Plot](../../principles.md#naming-convention--world--plot-and-their-panel-descriptor)
- [Actions menu (contextual zone)](../../patterns/actions-menu.md#contextual-zone)
  (Story Settings contributes tab-jump + reset commands to the
  universal `⚲` directory)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ [logo] Aria's Descent / Story Settings  [status]   [⚲] [←] │ ← top bar
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← chapter token-progress strip
├───────────────┬────────────────────────────────────────────┤
│ STORY         │ About                                       │ ← pane header
│ • About       │ What the story is — identity and metadata.  │
│ · Generation  │ ─────                                       │
│               │ title: Aria's Descent                       │
│ SETTINGS      │ description: [textarea]                     │
│ · Models      │ tags: [chips] +                             │
│ · Memory      │ ─ Appearance                                │
│ · Translation │ cover, accent color                         │
│ · Pack        │ ─ Library                                   │
│ · Calendar    │ status: [Active|Archived]                   │
│ · Advanced    │ ★ favorite                                  │
│               │                                             │
│               ├────────────────────────────────────────────┤
│               │ save bar (when dirty)                       │
└───────────────┴────────────────────────────────────────────┘
```

Left rail is the canonical **settings pattern**: sections (uppercase
labels) containing tabs (left-rail items). Active tab highlighted
with a left-edge accent. Reused by App Settings in a later wireframe.

## Two sections under one roof — wizard-editable vs post-creation tuning

The left rail splits into two sections reflecting two conceptually
distinct domains:

- **Story** section — wizard-editable fields. What the story IS.
  Tabs: About (library/identity), Generation (mode / lead / narration
  - story-shaping content + authoring aids).
- **Settings** section — post-creation tuning knobs. How it
  generates. Tabs: Models, Memory, Translation, Pack, Advanced.

Rationale for the seam: "wizard-editable" is a cleaner line than
"identity vs settings" because mode/lead/narration land
unambiguously on the wizard side — they're definitional, not tuning.
Collapsing both domains into one screen with a visual sectional
split avoids inflating the top-bar with a second entry point while
keeping the cognitive separation clear.

**Storage shape mirrors the section split.** The Story section maps
to `stories.definition` JSON; the Settings section maps to
`stories.settings` JSON. See
[`data-model.md → Story settings shape`](../../../data-model.md#story-settings-shape)
for the authoritative schemas and the cross-field constraints they
enforce.

**No standalone "Edit Story" surface.** Editing story identity
happens on the `About` tab. Title is additionally click-to-edit
inline in the reader top bar for the fast case. The story list's
card `⋯ → Edit info` routes to `About` directly.

**Section split — what's in each tab:**

**Story section** (definitional — set during wizard, editable after):

- **About** — title, description (freeform user-text — blurb /
  notes / log line, shown on library cards; not injected into any
  LLM prompt),
  [tags](../../patterns/chips.md#tag--pill-labeled-content), cover,
  [accent color](../../patterns/color-picker.md) (fallback: the
  story's mode-derived strip color), library status
  (`active` / `archived` — segment per
  [Select primitive rule](../../patterns/forms.md#select-primitive)),
  favorite (orthogonal SwitchRow with a leading star icon — own row,
  not nested in the status row; matches the inline-favorite pattern on
  story-list cards). Library-shaped metadata only — story-shaping
  content (genre / tone / setting) lives on the Generation tab.
- **Generation** — mode (adventure/creative), lead character,
  narration (first/second/third-person), and the **Story content**
  sub-section (genre / tone / setting — substantial preset+prose
  fields per the
  [Story-shaping content principle](../../principles.md#story-shaping-content--genre-tone-setting)),
  plus **Authoring aids** sub-section: composer modes toggle + wrap
  POV (first/third) + suggestions toggle. Behavior that shapes what
  the AI writes and how the user composes.

**Settings section** (operational — post-creation knobs):

- **Models** — per-feature override picks (see below)
- **Memory** — chapter threshold (with presets), full-chapter
  toggle + partial chapter buffer, protected buffer
- **Translation** — master enable, target language, granular
  per-content-type toggles
- **Pack** — active pack + pack-declared variables (see below)
- **Calendar** — active calendar system + read-only summary; full
  spec in
  [`patterns/calendar-picker.md`](../../patterns/calendar-picker.md)
- **Advanced** — story ID, timestamps, branch info, diagnostics
  (export JSON, view raw settings)

## Models tab — overrides only

Story-level overrides are direct **model id** overrides. App-level
profile architecture (App Settings · Profiles) provides the resolution
chain; this tab lets the story bypass the chain for specific features.

### Narrative (always visible)

Top of the tab — narrative is the storyteller, central enough that
its slot is always rendered:

- **App default sentinel** resolves the chain and shows what's
  currently in effect:
  `App default: claude-sonnet-4-7 (Narrative profile)`.
- Picking a model pins that model id for this story regardless of
  changes to App Settings · Profiles · Narrative.
- `×` on the row removes the override; reverts to the App default
  sentinel.

### Agent overrides (empty by default)

`+ Add override` button. Click opens a picker showing all agents with
their currently-resolved chain:

- `classifier` — Fast tasks → gpt-4o-mini
- `translation` — Fast tasks → gpt-4o-mini
- `suggestion` — Fast tasks → gpt-4o-mini
- `lore-mgmt` — Heavy reasoning → claude-opus-4-7
- `retrieval` — Fast tasks → gpt-4o-mini (when designed)
- `wizard-assist` — Fast tasks → gpt-4o-mini (powers the AI-assist
  calls inside the [story-creation wizard](../wizard/wizard.md))

(Image generation is deferred — see
[followups.md](../../../parked.md#image-generation).)

User picks an agent; the override row materializes with a model
picker. `×` on the row removes the override; agent reverts to App
default.

Most stories override 0-1 agents — empty default keeps noise
proportional to actual overrides.

### Insulation from profile changes

Story-level overrides are model ids, not profile ids — they bypass
the profile chain entirely:

- Profile renamed / model changed / temperature changed → stories
  with override unaffected.
- Profile deleted → per the
  [deletion-semantics design](../../../data-model.md#app-settings-storage),
  the delete is permitted (not blocked) and assignments using that
  profile are unset; the affected agents surface broken-reference
  errors at next pipeline use. Story-level overrides survive
  unchanged — they don't reference the profile id.
- Model removed from provider catalog → triggers the global
  broken-config banner (rendered at the top of every screen — see
  [App Settings](../app-settings/app-settings.md) for the surface
  that lets the user fix it). Story override stays valid only as
  long as the model id resolves.

### What story override **doesn't** include in v1

- Per-story full-profile override (creating a story-specific
  profile, etc.).
- Per-story custom JSON payload override.
- Per-story image-gen advanced parameters (size, style, quality —
  only the model id can be overridden).

Tracked as granular per-story controls in
[followups.md](../../../followups.md) — extension when demand
emerges.

### Data model

```ts
stories.settings.models: {
  narrative?: string;
  classifier?: string;
  translation?: string;
  suggestion?: string;
  'lore-mgmt'?: string;
  retrieval?: string;
  'wizard-assist'?: string;
}
```

(Image generation deferred — `imageGen` field added when the
feature lands.)

All fields optional; absent = resolve through the App Settings
profile chain at render time. See
[principles.md → Models are override-only](../../principles.md#models-are-override-only-per-story)
for the cross-cutting pattern.

## Generation tab — definitional fields + authoring aids

Houses three groupings, each with its own sub-section:

1. **Orthogonal axes** — mode / lead / narration (per
   [principles → Mode, lead, narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)).
2. **Story content** — genre, tone, setting (per
   [principles → Story-shaping content](../../principles.md#story-shaping-content--genre-tone-setting)) —
   the substantial preset+prose fields the AI consumes during
   generation.
3. **Authoring aids** — composer modes toggle + wrap POV
   (first/third) + suggestions toggle + `suggestionCount` stepper +
   [Suggestion categories](#suggestion-categories) editor.

### Orthogonal axes

- **mode** — `Adventure | Creative` segment.
- **lead** — character picker. Required when `mode='adventure'` OR
  `narration ∈ {first, second}` (per the
  [cross-field constraint](../../../data-model.md#story-settings-shape)).
  Save is rejected if the constraint is unmet, with copy explaining
  why.
- **narration** — `1st | 2nd | 3rd` segment. Picking 1st or 2nd
  while lead is null surfaces an inline lead-required prompt before
  save can succeed.

### Story content

Each field renders a preset picker (Select-primitive variant) at the
top with the prose-body editor below. Selecting a preset copies its
`displayName` into `label` and its `promptBody` into the editor —
selection is fire-and-forget (no preset id stored on the story);
post-selection edits are user-owned. Skipping the preset picker is
allowed — user can author label + prose from scratch.

- **genre** — `{ label, promptBody }`. Library-card overline reads
  `definition.genre.label`.
- **tone** — `{ label, promptBody }`. Same shape as genre.
- **setting** — freeform prose only (no preset). The world / time /
  place. Future Vault setting templates are deferred per
  [parked.md → Vault content types for genre / tone / setting templates](../../../parked.md#vault-content-types-for-genre--tone--setting-templates).

**Soft warn-box at the top of the Generation tab** when narrative
exists, copy along the lines of "Edits to genre / tone / setting
propagate from the next turn forward." Story content prose changes
do **not** trigger the
[Definitional-change confirmation modal](#definitional-change-confirmations) —
they shift AI output gradually without coherence breaks.

### Modal-flagged fields (existing scope, unchanged)

Mode and narration trigger the
[Definitional-change confirmation modal](#definitional-change-confirmations)
at save when changed mid-story. The tab additionally surfaces a
warn-box at the top once any entry has been written; the actual
confirmation lives at the save-session commit step. Lead is **not**
flagged — lead-switching is a first-class action per
[principles → Mode, lead, narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).

### Suggestion categories

The user-customizable palette feeding the
[reader chip strip](../reader-composer/reader-composer.md#next-turn-suggestions).
Section is gated by the `suggestionsEnabled` master toggle (above)
and the `suggestionCount` stepper (above, 1-6 range, default 3).
When the master toggle is off, the editor below dims (visible-but-
disabled — user can see what they'd be enabling).

**Bound data.** `stories.settings.suggestionCategories` — flat
ordered array. Seeded from
`app_settings.default_suggestion_categories[story.mode]` at story
creation per the copy-at-creation rule; story owns its values
thereafter.

**Editor row anatomy** (canonical — App Settings → Story Defaults
reuses the same compound):

- **Drag handle** updates `order` on save.
- **Enable toggle** flips `enabled`. Disabled-but-defined entries
  stay editable; they just don't emit.
- **Label input** — short text. Validates non-empty + case-
  insensitive unique within the list. Collision blocks save with
  inline error on the conflicting row.
- **[`ColorPicker`](../../patterns/color-picker.md)** — curated
  swatches + `+ custom`. Stores palette slot key (theme-resolved at
  render).
- **Prompt hint** — multi-line textarea. The prose the suggestion
  agent receives for this slot. Empty allowed (falls back to label
  as sole hint, soft warning that emissions may be lower quality).
- **Delete** — confirmation-gated. Orphan chips (entries that
  already emitted with the deleted `categoryId`) render with
  `(removed)` label per the reader-composer surface.

**Mobile expression.** Row collapses into a vertical stack inside
an [`Accordion`](../../patterns/accordion.md) item; the
[`ColorPicker`](../../patterns/color-picker.md) becomes a
[`Sheet`](../../patterns/overlays.md) per its narrow-tier routing.

**Add affordance.** `+ Add category` at the bottom of the list
spawns a row with empty label, palette default color, empty prompt
hint, `enabled: true`, `order: items.length`.

**Reset affordance.** `Reset to mode defaults` menu action in the
section's overflow. Confirmation-gated; overwrites the current list
with a fresh copy of
`app_settings.default_suggestion_categories[story.mode]`. Discards
user edits.

**Save semantics.** Lives inside the existing
[`save-sessions`](../../patterns/save-sessions.md) pattern of the
Story Settings screen; no new save infrastructure. The
`suggestionsEnabled` toggle, `suggestionCount` stepper, and category
list share dirty state with the rest of the tab.

Reader-surface emission, refresh pipeline, and edge cases (parse
failure, branch switch, rollback, translation interaction, zero-
enabled categories, mid-story toggle) live in
[`reader-composer.md → Next-turn suggestions`](../reader-composer/reader-composer.md#next-turn-suggestions).

## Memory tab

The Memory tab gathers chapter-close knobs, prompt-context buffer,
classifier cadence + status, embedder selection, retrieval budgets,
and any active embedding-staleness state for this story. Sub-
sections within the tab match the schema groupings in
[`stories.settings`](../../../data-model.md#story-settings-shape).

### Chapter close

**Chapter threshold.** Quick-pick preset buttons alongside the
numeric input: `Short (8k)`, `Balanced (24k)`, `Long (48k)`,
`Custom…`. Gentle guidance on typical choices without hiding the
raw number.

**Auto-close chapters.** Per-story field
`stories.settings.chapterAutoClose: boolean`. Default `true`. When
off, the threshold becomes pure guidance — the user wraps chapters
manually and the reader's chapter progress strip color (yellow at
80%, red at 90%) is the primary signal. The toggle mirrors into
App Settings · Memory as the same control bound to
`app_settings.default_story_settings.chapterAutoClose`, since
Memory is the form component reused across both surfaces.

### Prompt context

Three knobs control how the current and previous chapter feed
into prompt context. Canonical contract in
[`memory/cadence.md → User-tunable knobs`](../../../memory/cadence.md#user-tunable-knobs);
this section captures what the screen renders.

**Chapter buffer mode.** Per-story toggle
`stories.settings.fullChapterInBuffer: boolean`. Default `false`.
The two-mode axis:

- **Off (partial mode)** — the LLM gets the last
  `partialChapterBuffer` entries of the current chapter (see
  below). Token cost bounded by the partial buffer size; cadence
  warnings apply.
- **On (full mode)** — the LLM gets the entire current chapter
  verbatim. UI shows projected token cost at the chapter threshold
  inline with the toggle. Cadence warnings suppressed (chapter-
  close phase 0 catches up unclassified entries).

**Partial chapter buffer.** Per-story setting
`stories.settings.partialChapterBuffer: number` (entries). Default 10. Size of the current-chapter slice in partial mode. Greyed when
`fullChapterInBuffer = true`; the value is preserved for when the
mode flips back.

**Protected buffer.** Per-story setting
`stories.settings.protectedBuffer: number` (entries). Default 10.
Chapter-boundary spillover floor that applies in **both** modes:
if the current chapter has fewer entries than this floor, fill
from the previous chapter to satisfy it. Prevents a fresh chapter
from starting the LLM with no recent history — without this
spillover, chapter 3 with 2 entries would give the LLM only those
2, risking writing-style and continuity drift.

Concretely: with both buffers at default 10 and the mode irrelevant:

- Chapter 3 has 2 entries → 2 current + 8 previous = 10 total
- Chapter 3 has 10 entries → 10 current (floor satisfied by current)
- Chapter 3 has 50 entries, partial mode → last 10 current (no
  spillover; partial window > floor)
- Chapter 3 has 50 entries, full mode → all 50 current (floor
  trivially exceeded)

The structural floor — active+in-scene entities, current-location
lore, awareness-driven happenings, always-injection rows — is not
governed by these buffer settings. Those reach the prompt
unconditionally when their structural conditions hold. See
[`memory/retrieval.md → Structural floor`](../../../memory/retrieval.md#structural-floor--always-inject)
for the full set.

### Classifier

Surfaces classifier controls and live state for the active branch.
Full design in
[`memory/classifier.md → Settings · Memory · Classifier panel`](../../../memory/classifier.md#settings--memory--classifier-panel);
this section captures what the screen renders.

- **Cadence config** — in-place edit of
  `stories.settings.classifierCadence` (turns; v1 entry-counted
  only) and the `piggybackMode` toggle. Buffer-aware cadence
  indicator from
  [`memory/cadence.md → User-tunable knobs`](../../../memory/cadence.md#user-tunable-knobs)
  renders inline.
- **`piggybackMode` capability gate.** The toggle is disabled when
  the currently-resolved `models.narrative` lacks structured-output
  capability (per
  [`memory/cadence.md → Piggyback contract`](../../../memory/cadence.md)).
  In that state the toggle reads as off, a one-line hint explains
  the gate (`Requires a narrative model with structured-output
capability`), and the periodic-classifier pass picks up the work
  regardless. Swapping the narrative model to a capable profile
  re-enables the toggle automatically.
- **Status block** — current state for the active branch, one of
  _idle / running / retrying / failed-persistent_. Each state
  carries its own copy and inline actions; failed-persistent
  additionally surfaces as a top-bar error pill in the reader,
  parallel to the cluster-1 staleness pill.
- **`Run classifier now`** button. Disabled while a run is
  actively in flight; enabled in idle and retrying states (lets
  the user preempt the auto-retry backoff).

### Embedder

Embedder selection is locked once the story has any embedded
content (any vec0 row exists for any of its branches). The panel
renders compact and offers a single `Switch embedder` action that
fires the [Model swap UX](../../../memory/retrieval.md#model-swap-ux)
dialog. Full design context in
[`memory/model-management.md → Embedder config — where it lives in Settings`](../../../memory/model-management.md#embedder-config--where-it-lives-in-settings).

Displayed:

- Backend (`local` or `provider`).
- Model id + display name.
- For local backends, the resolved execution provider (per-model
  override if any, otherwise the catalog's `default_ep[platform]`
  for curated entries or the user-picked EP for custom imports).
- **Effective dim** — conditional row, only when
  `stories.settings.effectiveDim` is non-null. Reads
  `<N> dim (truncated from <native> dim, Matryoshka)` and is
  read-only — the dim was locked at story creation alongside
  `embedding_model_id`. Hidden when null (no truncation, model
  native dim).
- `[Switch embedder]` button.

When `embeddingBackend = 'provider'`, both the provider and the
model id are displayed together — see
[`data-model.md → app_settings storage`](../../../data-model.md#app-settings-storage)
for the `embedding_provider_id` schema.

Changing the effective dim post-creation requires the same
[Model swap UX](../../../memory/retrieval.md#model-swap-ux) ramp
as a model change — a different dim invalidates every stored
vector under the old dim. The `[Switch embedder]` button covers
both axes (model id and effective dim) in the same dialog; full
contract in
[`retrieval.md → Matryoshka effective dim`](../../../memory/retrieval.md#matryoshka-effective-dim).

### Retrieval budgets

Per-type token budgets for retrieval
(`stories.settings.retrievalBudgets`). Five number inputs / sliders:

- entities
- lore
- happenings
- threads
- chapter summaries

Defaults seed from `app_settings.default_story_settings` at story
creation. Hard partitions in v1 — no cross-type spillover. See
[`memory/retrieval.md → Per-type retrieval budgets`](../../../memory/retrieval.md#per-type-retrieval-budgets)
for the design and
[`parked.md → Spillover policy`](../../../parked.md#spillover-policy-on-per-type-budgets)
for the post-v1 spillover question.

### Embedding status

Conditional. Only renders when the active branch has stale
embedding rows (`embedding_stale > 0` count across embedded-field
tables). Surfaces the per-story resolution panel from cluster 1:

> 12 rows pending re-embed under MiniLM-L6.
> Reason: model removed / embedder offline / init failure / ...
> `[Switch embedder]`

Single-story view — Story Settings is for THIS story. The
cross-story aggregate (a list of every story with stale rows
across the database) lives in App Settings · Memory. Tapping
`Switch embedder` runs the same path as the Embedder section's
button. See
[`memory/model-management.md → Staleness UI`](../../../memory/model-management.md#staleness-ui)
for the full surfacing design.

### Probe

Per-story activation of the [memory probe](../memory-probe/memory-probe.md).
Bound to
[`stories.settings.probe_mode_active`](../../../data-model.md#diagram).
No-op while
[`app_settings.diagnostics.enabled`](../../../data-model.md#diagram)
is off — when the master flag is off, the toggle here is disabled
with a hint linking to App Settings · Diagnostics.

**Section content:**

- **Probe mode toggle** for this story. Help text under the toggle:
  _"Probe captures retrieval state per turn (gzipped JSON). Useful
  for debugging memory behavior; costs storage proportional to
  turns captured. Clear from Diagnostics Hub."_
- **Capture stats** — count, total compressed size, oldest /
  newest pointer (chapter + turn). Updates live as turns capture
  or evict.
- **`Open probe →` button** — routes to the
  [memory-probe screen](../memory-probe/memory-probe.md) scoped
  to this story.
- **`Clear all captures`** destructive button with confirm dialog
  ("Delete all N captures for this story? Cannot be undone.").

Disabled-state hint when the master flag is off:

> Probe mode is disabled at the app level. Enable in
> `App Settings · Diagnostics → Memory probe mode` to start
> capturing per-turn retrieval state.

## Translation tab — display-only, opt-in, single target

**Architectural invariant: translations are display-only.** They
render alongside the source in the UI; they never feed back into
prompts or LLM context. The source content is canonical. This
isolates cost (translation runs only when enabled) from prompt
integrity (generation uses source always). See
[`architecture.md → Translation as a pipeline concern`](../../../architecture.md)
for the full invariant.

### Master enable + target

- Master `enable translation` toggle, off by default. Feature is
  niche enough not to justify being on for everyone.
- When enabled, one target language at a time per story. Multi-target
  was considered and rejected — cost + ambiguity outweigh benefit.
  Multiple-language conversion of an existing story is handled by
  the Translation Wizard (a separate flow that batches conversions —
  see [followups.md](../../../followups.md)).
- When disabled, target + granular toggles grey out; no translation
  writes happen.

### Granular per-content-type toggles

Not everything needs to render in the target language. Authors can
pick (matches schema `granularToggles` in
[`data-model.md`](../../../data-model.md#story-settings-shape)):

- `narrative` — the AI's reply text
- `entityNames` — entity name fields
- `entityDescriptions` — entity description fields
- `lore` — lore bodies
- `threads` — thread titles + descriptions
- `happenings` — happening titles + descriptions
- `chapterMeta` — chapter summaries / titles

Each is an independent toggle. Default set (enabled on first
turn-on): `narrative` + `entityNames` + `entityDescriptions` +
`lore`. Others off. User can flip.

**User-action translation is unconditional** when
`targetLanguage !== sourceLanguage`. It is **not** a granular
toggle — the load-bearing invariant is that the AI always sees
source-language input. When the user types in the target language,
the `user-action-translation` pre-narrative pipeline phase converts
the input to source before the narrative agent ever sees it; the
translated source becomes the entry's canonical content, and the
user's typed target text is stored as the `translations` row.
Failure of this phase is fatal to the turn (per
[`architecture.md → Translation as a pipeline concern`](../../../architecture.md)).

**Modified entries — translation refresh.** Per the data-model
side-channel exemption (see
[`data-model.md → Story settings shape`](../../../data-model.md#story-settings-shape)),
`story_entries.content` edits mutate the row directly without
emitting per-column deltas, so there is no per-range edit history to
interrogate. On user edit of an already-translated entry, the
existing `translations` row is invalidated; the entry lazy-translates
on next render (or eagerly if the entry is currently visible).
Steady-state translations stay; edits trigger a single full-entry
refresh. (Concrete shape lands with the retrieval + memory agents.)

### Data model note

The `translations` table already supports multi-language via its
`language` column (see
[`data-model.md → Translation`](../../../data-model.md)). The UI's
single-target limitation is a v1 scope decision, not a schema
limitation. Data-model is forward-compatible.

## Pack tab — active pack + variables

Two sections:

1. **Active pack selector** — dropdown; changing warns about
   prompt-shape rewrite on next turn.
2. **Pack variables** — form controls rendered **dynamically** from
   the active pack's variable schema.

### Pack variables

Packs declare a **variable schema** (names, types, defaults,
descriptions). The Pack tab renders form controls dynamically based
on the active pack's schema. Values are stored per-story.

Variable types the schema supports:

- Enum (rendered as dropdown or radio group)
- Number (rendered as input; range constraints optional)
- Boolean (rendered as toggle)
- String (rendered as input or textarea)

**Data model:**

```ts
stories.settings.packVariables: Record<string, unknown>
```

Keyed by variable name. Values typed per the active pack's schema
(zod-validated on load against the pack's declared shape).

**Pack-switch behavior** (deferred UX): changing the active pack
invalidates the current variable values. Options: reset to new pack's
defaults / map by name where types match / keep unmapped values
orphaned but accessible. Decide before pack switching ships.

Pack authoring (editing the templates + declaring variables) lives on
the dedicated Prompt / Pack Editor screen (inventory #12).

## Calendar tab — picker + summary

The active calendar for this story. The tab content is the
calendar picker plus a read-only summary panel; full spec —
option-row content, summary sections, swap warnings, edit-
restrictions interaction — lives in
[`patterns/calendar-picker.md`](../../patterns/calendar-picker.md).

Story Settings is one of three host surfaces for the picker
primitive (App Settings, Story Settings, Wizard); this tab is the
swap-aware host. Swapping the calendar may surface a combined
confirmation modal (origin re-pick, hidden era flips, display
reformatting); details in the pattern doc.

### Era flips on this branch

Below the calendar picker + summary, the tab surfaces the era flip
log for the **current branch** — `branch_era_flips` is branch-
scoped, so switching branches via the reader's branch navigator and
returning here reloads the list against the new branch's flips.
Authoring lives in the reader (see
[`reader-composer.md → Era flip`](../reader-composer/reader-composer.md#era-flip));
this surface is read-only-plus-delete. The semantic seam is
slightly fuzzy — flips aren't strictly "settings" — but the
calendar tab is where everything calendar-related already lives.

**Per-row anatomy:**

- **Era name** — the canonical commit form (normalized to preset
  casing where applicable per the
  [Autocomplete-with-create primitive](../../patterns/forms.md#autocomplete-with-create-primitive)).
- **Anchor display** — `at_worldtime` rendered via the active
  calendar's formatter (e.g., `Reiwa 1 · May 1, 2019`). Shows
  `Start of story` when `at_worldtime = 0`.
- **Inline `×` delete icon** — follows the
  [icon-actions pattern](../../patterns/icon-actions.md), with the
  surface-specific deviation that the icon disables (rather than
  hides) during in-flight pipelines per the
  [hidden-vs-disabled rule](../../patterns/icon-actions.md#disabled-vs-hidden).

No inline rename in v1 — see
[followups](../../../parked.md#inline-rename-for-era-flips-in-story-settings--calendar)
for the deferral.

**Sort.** `at_worldtime` ascending — chronological within the
branch's lifetime.

**Empty state.** When the active calendar has `eras !== null` but
the branch has no flips:

> No era flips on this branch yet. Use **Flip era…** in the reader
> to mark a new era.

**Sub-section visibility.** When the active calendar has
`eras: null` AND the branch has no orphan flips (see below),
the entire `Era flips on this branch` sub-section hides — there's
nothing meaningful to surface.

### Orphan flips (after calendar swap)

When the user swaps the active calendar to one whose era set
doesn't contain the flip's `era_name`, the flip becomes an
**orphan** — its name no longer maps to a renderable era in the
current calendar. The flip-list still renders so users have a
cleanup path:

> **Reiwa** · `(orphaned)` · raw worldTime tooltip · `×`

**Per-row rendering for orphans.** Two pieces of information
survive orphaning unconditionally — both are stored on the flip
itself (`era_name`, `at_worldtime`):

- The **`era_name`** prints normally as the row's primary label.
  Identity-preserving even when no calendar can render the
  `at_worldtime` against it.
- The **anchor slot** prints `(orphaned)` instead of a formatted
  date — the active calendar's renderer would produce nonsense if
  forced. The raw `at_worldtime` integer is available in the row's
  tooltip for power users / debugging.

We deliberately do not render the orphan via the previously-active
calendar's formatter, even when that calendar is still in Vault.
A user who just swapped calendars wants the new calendar's
framing; surfacing the old one fights the swap. The schema also
doesn't track which calendar a flip was created under
(`branch_era_flips` has no `calendar_id_at_creation` column), so
"render with previous" would also fail any time the flip's source
calendar has been removed from Vault. Cleaner to walk back the
promise.

**Lifecycle.** Orphan flips become non-orphan automatically on the
next calendar swap if the new calendar's eras include the flip's
`era_name` (matching is exact-string against the calendar's
`presetNames` + any user-added flips). The user can also delete
orphans outright; CTRL-Z restores. No "convert to a different era
name" affordance — if that need surfaces, delete + re-flip in the
reader is the path.

### Inline delete confirm

Click `×` → inline confirm in place (matching the
[branch-navigator inline delete pattern](../reader-composer/branch-navigator/branch-navigator.md#inline-delete-confirm)):

```
   Reiwa · Reiwa 1 · May 1, 2019
   Delete this flip?       [ Cancel ]  [ Delete ]
```

`Cancel` reverts to the read-only row. `Delete` writes the
delete-row delta and removes the row from the list. CTRL-Z
restores.

## Definitional-change confirmations

A small set of fields trigger a confirmation modal at **save** when
the dirty session changes them and the story has at least one entry.
The modal sits between the user clicking `Save` and the session
committing — `Cancel` returns to the dirty editor, `Save anyway`
commits per the normal
[save-session pattern](../../patterns/save-sessions.md).

Modal pattern follows the
[branch creation modal](../reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal):
modal head + body + foot with `[Cancel]` + `[Save anyway]`. Body
lists each flagged field that's dirty plus a single-sentence
consequence for that field. No "type the story name to confirm"
friction — local-first, single-user, low stakes; the modal exists
to inform, not to gatekeep.

### Flagged fields

| Tab        | Field             | Why flagged                                                                                             |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Generation | `mode`            | Switching adventure ↔ creative reframes the user's relationship to the story going forward.             |
| Generation | `narration`       | Changing first/second/third-person mid-story reads as a voice break unless intentional.                 |
| Generation | `composerWrapPov` | Changes how new user input in `Do` / `Say` / `Think` modes is rendered. Existing entries stay as-saved. |
| Pack       | `activePackId`    | Rewrites the prompt shape on the next turn. Story content unaffected; generation patterns shift.        |

Not flagged, deliberately:

- `leadEntityId` — first-class action; see
  [principles → Mode, lead, narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).
- `genre` / `tone` / `setting` — story-shaping content shifts AI
  output from the next turn forward without coherence breaks per
  [principles → Story-shaping content](../../principles.md#story-shaping-content--genre-tone-setting).
  The Generation tab carries a soft warn-box at the top instead.
- `worldTimeOrigin` — display-only shift. Stored worldTimes are
  unchanged; only the calendar formatter renders them differently.
- All operational tuning (memory, translation, models, pack
  variables) — the save bar itself is the commit affordance; no
  extra modal needed.

### Confirmation copy

Each flagged field has a single-sentence consequence string used in
the modal body. Wording stays informational (not "are you sure?") —
the user is committing on purpose; the modal exists to surface what
changes downstream:

- **`mode`** — "Reframes the user's relationship to the story going
  forward. Existing entries stay; new generation will treat you as
  a `[character|director]`."
- **`narration`** — "Changes the AI's prose voice from the next
  turn forward. Existing entries are unchanged."
- **`composerWrapPov`** — "Affects how new user input in `Do` /
  `Say` / `Think` modes is rendered. Existing entries stay
  as-saved."
- **`activePackId`** — "Switches the active pack — the prompt shape
  rewrites on the next turn. Story content stays; generation
  patterns change."

When multiple flagged fields are dirty in one session, the modal
stacks one bullet per field.

### Tab-level warn-box vs save-time modal

Two layers, different audiences:

- The **tab-level warn-box** (already in the
  [Generation tab](#generation-tab--definitional-fields--authoring-aids)
  and the [Pack tab](#pack-tab--active-pack--variables)) catches a
  user about to start editing a flagged field.
- The **save-time modal** catches a user who has edited and is
  about to commit. The warn-box is informational; the modal is
  consent.

### When the story is empty

No entries yet (story just created from the wizard) → no modal. The
flagged fields can be freely retuned; first turn locks them in
operationally.

## Save session

Standard [save-session pattern](../../patterns/save-sessions.md).
Session boundary: this entire surface — any tab, any field. Save
commits all dirty fields under one `action_id`; Definitional-change
confirmation (above) intercepts the commit when applicable.

## Top-bar

Standard in-story chrome per
[principles → Top-bar design rule](../../principles.md#top-bar-design-rule).
Breadcrumb: `<story-title> / Story Settings`. Self-reference: the
Story Settings icon is absent on this surface (see
[Settings icon scope](../../principles.md#settings-icon-scope));
App Settings is reachable via the Actions menu.

**Contextual Return.** When Story Settings is reached via the
story-list card overflow (`⋯ → Edit info`), the
[stack-aware Return](../../principles.md#stack-aware-return)
goes back to the story list on the first ←. If the user navigates
beyond Story Settings (e.g., forward into the reader), the one-shot
is consumed and subsequent Returns follow the default stack pop.

## Mobile expression

Story Settings is a two-pane navigation surface (left rail + content
pane on desktop / tablet); on phone it collapses list-first per
[`mobile/collapse.md → Two-pane navigation surfaces`](../../foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
Tablet keeps the desktop 2-pane layout (~200 px rail fits cleanly
at iPad portrait detail-pane widths).

- **Master-detail collapse on phone.** List state shows the
  section/tab list (STORY: About, Generation; SETTINGS: Models,
  Memory, Translation, Pack, Calendar, Advanced) as a vertical
  scroll list. Tap a tab row → tab content as inner full-screen
  route within the Story Settings surface; back returns to list
  state. Same shape as World/Plot's master-detail collapse, just
  with a left-rail desktop primitive instead of separated panes.
- **List-state nav rows on phone** ride the 44 px tap-target
  floor (per
  [`mobile/touch.md → Touch-target floor on phone`](../../foundations/mobile/touch.md#touch-target-floor-on-phone)).
  Label is sentence-case sans 16 px / `text-base` `font-medium`
  in `--fg-primary` ink (not muted). A chevron-right glyph at
  the row's right edge signals drill-down. Optional secondary
  line surfaces a current-value hint where one obviously exists
  — `Calendar → Earth (Gregorian)`; multi-setting tabs (Models,
  Memory, Translation, Pack, Advanced, About, Generation) omit.
  No left-bar accent on phone — active state lives only on
  tablet+desktop where the rail persists. Group separators
  (`Story`, `Settings`) render as sentence-case caption text,
  `text-xs` `--fg-secondary`, with ~24 px gap above each header
  and ~8 px below.
- **Top-bar shape on phone** per
  [`mobile/navigation.md → Phone`](../../foundations/mobile/navigation.md#phone--640-px):
  slim single-row `[←] [<title> / Story Settings] [pill] [⚲]`.
  List state breadcrumb is `<title> / Story Settings`; detail-route
  extends to `<title> / Story Settings / <tab>` (parent segments
  tappable per the breadcrumb-tappability amendment, current
  segment inert with tap-to-tooltip on truncation per
  [`mobile/touch.md`](../../foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text)).
  No `⛭` icon — Story Settings IS the in-story chrome target per
  [`principles.md → Settings icon scope`](../../principles.md#settings-icon-scope).
- **Form-field rows** follow the
  [stacked-on-narrow-container rule](../../patterns/forms.md#form-rows--stacked-on-narrow-container)
  — 2-col grid (180 px label-left / 1fr input-right, uppercase
  monospace label) when the form container is `≥ 640 px`,
  stacked single-column block (sentence-case sans label above,
  full-width input below) when the form container is `< 640 px`.
  On phone the form container is full-bleed (~360-430 px) so
  rows stack; tablet portrait detail panes (~544-620 px after
  the rail) also fall below the threshold and stack; tablet
  landscape (~820 px detail pane) and desktop (~920 px form
  max-width) stay 2-col. Type-hint applies `overflow-wrap:
anywhere` to break long monospace strings cleanly when 2-col
  is active. Substrate consumed by all five form-row surfaces
  (story-settings, app-settings, world, plot, vault calendars).
- **Selects on phone** route per the
  [`patterns/forms.md → Select primitive`](../../patterns/forms.md#select-primitive)
  cascade: dropdown render mode opens via Sheet (short) for flat
  options (most enum selects on this surface), Sheet (medium) for
  the model picker dropdown per
  [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Segment mode unchanged (e.g., `[active|archived]` library status
  segment on the About tab).
- **Definitional-change confirmations** stay Modal at every tier
  per the layout binding table.
- **Genre / tone preset+prose hybrid rows wrap on narrow tiers.**
  The preset dropdown and label input sit side-by-side in the
  input column when room allows; below ~440 px combined they wrap
  to stack (preset on top, label below). The prose textarea
  underneath always takes full input-column width.
- **Accent color picker** wraps on narrow tiers as part of the
  [ColorPicker primitive](../../patterns/color-picker.md)'s own
  responsive contract — `(none)` swatch plus seven curated
  swatches plus the `+ custom` chip flow horizontally via
  `flex-wrap`, with the `+ custom` overlay routing to Sheet at
  narrow tiers per the picker's overlay rules.
- **Chapter token threshold uses a chip-row preset+custom
  hybrid** (Short / Balanced / Long / Custom…) — `.chip-row`
  with `.add-chip` cells, wrapping naturally at narrow tiers.
  Selecting `Custom…` reveals the numeric input below. Pattern
  is shared with App Settings's matching threshold control. Sits
  outside Select's three render modes (segment / dropdown /
  radio) because preset-plus-numeric isn't pure cardinality —
  per
  [`forms.md → Select primitive`](../../patterns/forms.md#select-primitive)'s
  preset+custom note.
- **Diagnostics row** in the Advanced tab uses the same
  chip-row pattern for `Export story as JSON` and
  `View raw settings JSON` — chips wrap left-aligned on narrow
  tiers.
- **Save bar on phone** stays at the bottom edge of the
  detail-route's scroll region per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md);
  hides while keyboard is open per
  [`mobile/touch.md → Save bar on phone`](../../foundations/mobile/touch.md#save-bar-on-phone),
  reappears on field blur. Navigate-away guard stays active
  throughout including during keyboard-open.
- **Stack-aware Return.** The chrome `←`, Android `BackHandler`,
  and iOS swipe-back all bind to stack-aware Return per
  [`mobile/navigation.md → Stack-aware Return`](../../foundations/mobile/navigation.md#stack-aware-return-on-mobile).
  List ↔ detail navigation is a sub-stack within the Story
  Settings surface; back from detail routes to list, not to the
  prior in-story surface (reader / world / plot). Dirty-state
  navigate-away guard fires before the back action.
- **Phone landscape** (~700–900 px) lands in tablet tier per the
  [responsive contract](../../foundations/mobile/responsive.md);
  rail + content remains side-by-side, cramped vertically. Form
  container width is ~500-700 px after the rail; the
  stacked-on-narrow-container rule keys on that container width
  rather than the tier classification, so most landscape phone
  detail panes still stack form rows naturally.

## Screen-specific open questions

- **Cover upload**: drag-drop + pick-from-assets. Detailed UX (crop,
  aspect enforcement) deferred.
- **Advanced tab depth**: currently shows identifiers + an export
  action + raw-settings view. Likely grows over time (debug flags,
  retry counts, cache stats).
