# 2026-05-19 — Next-turn suggestions

Resolves the [`Next-turn suggestions — design pass`](../followups.md)
followup by formalizing what was previously a partial canonical
sketch ([`reader-composer.md → Next-turn suggestions`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions))
into a full contract covering category customization, emission
pipeline integration, persistence, and the new manual-refresh
affordance.

## Outcome

Suggestions become **user-customizable per story**, **emission-
constrained to a user-defined category palette**, and **persisted on
the AI entry's metadata**. Three emission paths land: narrative-fold
under `piggybackMode='on'`, classifier-fold under `'off'`, and a
dedicated `models.suggestion` agent for the new refresh-button
re-roll path. Translation rides the existing pipeline phase, cached
by content-hash of chip text.

The four user-need motivations the design serves simultaneously:
surfacing options the writer wouldn't think of, reducing paralysis
when staring at an empty composer input, speeding routine
continuations via tap-and-go, and lowering the floor for non-writer
users who consume rather than author. No single motivation
dominates; categories are the structural device that lets one
emission contract serve all four.

## Locked answers (clarifying)

| Question                          | Answer                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| What shape is a suggestion?       | Short imperative one-liner per chip.                                       |
| What's the primary purpose?       | All four motivations simultaneously (no single north star).                |
| What does tap do?                 | Fills composer; user edits and submits. Tap replaces any existing text.    |
| What role do categories play?     | User-customizable palette; model picks per-slot from enabled set.          |
| How does partial input steer?     | Manual refresh button; composer text passed as `refreshGuidance`.          |
| Where does refresh emission live? | Dedicated `models.suggestion` agent (2-stage pipeline with translation).   |
| Where does on-turn emission live? | Narrative fold when piggyback ON; classifier fold when OFF. Same fragment. |

## Schema delta

Three new fields on existing shapes; one new sub-block on
`app_settings`.

### `stories.settings.suggestionCategories`

```ts
suggestionCategories: {
  id: string // stable per-story uuid
  label: string // visible chip overline label
  promptHint: string // prose snippet fed to the suggestion agent
  color: string // slot key from the curated accent palette
  //   (theme-resolved at render; not raw hex)
  enabled: boolean // emission gate
  order: number // user-draggable; explicit ordering
}
;[]
```

Seeded at story creation from
`app_settings.default_suggestion_categories[mode]`
per the existing copy-at-creation rule
([`data-model.md → Story settings shape`](../data-model.md#story-settings-shape)).
Editable in App Settings → Story Defaults (changes defaults for
new stories only) and Story Settings → Composer → Suggestions
(changes the current story). No backfill on default-set changes;
existing stories own their values.

Hard cap on **total category entries**: none. Visible chip count
per turn is bounded by `suggestionCount` (below), not by enabled
count.

### `stories.settings.suggestionCount`

```ts
suggestionCount: number // default 3, range 1-6
```

Mirrors into
`app_settings.default_story_settings.suggestionCount` for the same
copy-at-creation rule. Single default across modes (no per-mode
differentiation at v1 unless real signal). Drives literal chip
count, decoupled from category count — model selects which
categories to use per slot.

### `story_entries.metadata.nextTurnSuggestions`

```ts
nextTurnSuggestions?: {
  items: { categoryId: string; text: string }[]
  source: 'piggyback' | 'classifier' | 'refresh'
  refreshGuidance?: string   // present when source === 'refresh' and composer-partial was passed
}
```

Optional — pre-feature entries, opening entries, `user_action`
entries, and `system` entries don't carry it. Reader treats absence
as "empty-state strip with ⟳ Generate affordance." `categoryId`
references `stories.settings.suggestionCategories[].id`; orphan
references (category deleted post-emission) render with neutral
fallback per [Edge cases — orphan category](#edge-cases).

`source` is diagnostic-only — surfaced in dev mode for debugging
"why are these chips weird." `refreshGuidance` persisted so reload
faithfully shows refresh-influenced chips.

### `app_settings.default_suggestion_categories` (sibling field)

```ts
app_settings.default_suggestion_categories: {
  adventure: SuggestionCategory[]
  creative: SuggestionCategory[]
}
```

Sits as a sibling field on `app_settings`, NOT nested inside
`default_story_settings`, because the per-mode dict shape doesn't
conform to `Partial<StorySettings>` (`stories.settings.suggestionCategories`
is a flat array — the story's mode is fixed and only the mode-matched
default applies). Same placement rationale as `default_calendar_id`
([`data-model.md → App settings storage`](../data-model.md#app-settings-storage)).

`suggestionCount` stays inside `default_story_settings` — it's a
single value, `Partial<StorySettings>`-conformant.

Bundled curated initial values shipped as JSON in code (same
authoring pattern as the genre / tone preset catalog). The existing
canonical color table at
[`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions)
becomes the per-mode bundled defaults: Adventure ships
Action / Dialogue / Examine / Move with curated palette colors;
Creative ships Action / Dialogue / Revelation / Twist.

At story creation, the copy-at-creation logic for
`stories.settings.suggestionCategories` reads
`app_settings.default_suggestion_categories[story.mode]` (where
mode is the wizard-selected `adventure` | `creative`); for
`stories.settings.suggestionCount`, it reads
`app_settings.default_story_settings.suggestionCount`.

## Category role — model-driven selection from the enabled palette

The original canonical's "classifier-driven mix, not strict
one-of-each" stays in spirit, restated for the new contract: the
model selects per-slot which category to use from the enabled
palette. No 1:1 chip-per-category guarantee; categories can repeat
across an emission set; not all enabled categories must appear in
any given turn.

The user's recovery loop for diversity:

1. Manual refresh button (re-roll, optionally with composer-partial
   as guidance).
2. Reorder / disable categories to bias the palette.

v1 ships a **prompt-level diversity nudge** appended to all three
emission prompt fragments:

> "Where possible, vary which categories you draw from across the
> set of suggestions."

If field evidence shows the nudge insufficient, the recency-bias
mitigation (pass previous entry's `nextTurnSuggestions.items[].categoryId`
mix into the prompt) is parked-until-signal — schema already
supports it.

## Emission pipeline

Three paths emit chips into
`story_entries.metadata.nextTurnSuggestions`. All three share the
same `<suggestions>` tagged-block format and the same
prompt-fragment shape; what differs is which agent runs and which
call carries the emission.

### Path 1 — Narrative fold (`piggybackMode='on'`)

The narrative model emits a sibling `<suggestions>` block alongside
its existing `<state>` trailing block (per
[`memory/piggyback.md → Trailing block format`](../memory/piggyback.md#trailing-block-format)).
Sibling, not nested — different lifecycle (state goes through
delta-logged extraction; suggestions go through metadata-write).

Reference shape:

```xml
<state>
  …existing…
</state>
<suggestions>
  <s category="cat1">Aria confronts the captain about the missing ledger.</s>
  <s category="cat2">Aria asks the captain why his hand is bandaged.</s>
  …suggestionCount slots total…
</suggestions>
```

`category` attribute uses the same placeholder-substitution
mechanic as scene-entity IDs — `cat1` is a stable per-prompt
placeholder mapped to a `suggestionCategories[].id`; swap fires
post-parse, pre-action.

Parse independence: `<suggestions>` parse-failure does not block
`<state>` apply, and vice versa. Four parse-outcome combinations
covered cleanly; jsonrepair-equivalent attempts before giving up,
matching piggyback's existing contract.

Source-tag written: `source: 'piggyback'`.

### Path 2 — Classifier fold (`piggybackMode='off'`)

The per-turn classifier pass (the existing fallback path piggyback
documents at
[piggyback's capability gate section](../memory/piggyback.md#capability-gate))
gains the same `<suggestions>` fragment. One classifier call emits
both `<state>` and `<suggestions>`; parse independence carries
over.

Source-tag written: `source: 'classifier'`.

Capability gate: same flag as piggyback. The classifier model
emitting `<state>` reliably is presumed to emit `<suggestions>`
reliably too (same tagged-block mechanic). Split-flag mitigation
parked-until-signal.

### Path 3 — Dedicated suggestion agent (re-roll)

User-triggered via the manual refresh button on the chip strip.
2-stage pipeline (`kind: 'suggestion-refresh'`):

- **Stage 1 — Emission.** `models.suggestion` single-shot call.
  Inputs: scene context (location, scene entities, recent narrative
  window), enabled categories, `suggestionCount`, optional
  `refreshGuidance`. Action: writes
  `story_entries.metadata.nextTurnSuggestions` with
  `source: 'refresh'`.
- **Stage 2 — Translation (conditional).** Fires only when
  `stories.settings.translation.enabled && granularToggles.narrative`.
  Inputs: stage 1's chip texts. Action: writes translation rows
  keyed by `(target_language, hash(chip.text))`.

If translation is disabled, stage 2 is a no-op skip — standard
pipeline behavior.

Concurrency policy:

```ts
concurrencyPolicy: {
  blockedBy: ['per-turn', 'suggestion-refresh']
}
```

Blocked by `per-turn` to prevent overlapping writes to the same
entry's `nextTurnSuggestions`. Self-blocking enforces the
"second-click while loading is no-op" UX — second click queues
nothing because the pipeline kind blocks itself.

The pipeline surfaces in the
[generation-status pill](../ui/patterns/generation-status-pill.md)
with copy "Refreshing suggestions." Lower priority than narrative;
narrative wins when both in flight. Click-to-cancel discards
stage 1 output before any write.

## Reader chip strip — visual + interaction

Chip strip continues to live between entries and composer, after an
AI reply completes. Anatomy per chip: category overline (label
text, color-tinted background), suggestion prose body, color
accent strip at the leading edge from the category's stored palette
slot.

Color is theme-resolved at render — palette slot key, not raw hex.
Theme swap re-resolves all chip colors consistently.

### Chrome row

A thin row beneath the chip stack carries two affordances,
right-aligned:

- **⟳ refresh** — primary action. Fires the
  `suggestion-refresh` pipeline with current composer text as
  `refreshGuidance` (empty string if composer empty). Strip enters
  `loading` state; refresh icon pulses; chips dim; taps no-op.
- **⌄ collapse** — existing canonical affordance; flips between
  `visible` and `collapsed`. Chrome row persists when collapsed.

Disabling the feature happens in **Story Settings → Composer →
Suggestions** via `suggestionsEnabled` master toggle, not inline.

### Strip states

The five-state vocabulary from the existing canonical doc
(`visible`, `loading`, `error`, `collapsed`, `hidden`) carries
forward unchanged. `loading` now has two triggers — on-turn
emission arriving with AI reply, and re-roll — visual treatment
identical.

New state for legacy / opening / `user_action` / `system` terminal
entries (no `nextTurnSuggestions` present): **empty-state strip
with ⟳ Generate affordance.** Single button on the strip body where
chips would render; click fires `suggestion-refresh` to produce
chips ex nihilo. Same pipeline kind as the refresh button.

### Tap behavior

Tap chip → composer text replaces with chip text → composer mode
sets to `Free` (per existing canonical line — chip text is finished
prose, no further wrapping needed) → user edits and submits via the
existing Send action.

**Known UX wart: tap-after-typing loses typed content.** Composer
input is not delta-logged (it's not entry state until submit), so
no Cmd/Ctrl-Z path recovers a draft replaced by a chip tap.
Documented as a v1 limitation; field signal will tell us whether a
restore-draft toast or confirm gate is worth adding later.

## Categories editor UX

Editor surfaces in two places, same `<SuggestionCategoriesEditor>`
compound, different bound data:

- **App Settings → Story Defaults → Suggestion categories**
  (per-mode tabs: Adventure / Creative). Edits
  `app_settings.default_suggestion_categories[mode]`.
  Source-of-copy at next story creation.
- **Story Settings → Composer → Suggestion categories** (single
  list — current story's mode determines the editable set). Edits
  `stories.settings.suggestionCategories`. Master toggle
  (`suggestionsEnabled`) at the top of the section as the gate;
  `suggestionCount` stepper next to it.

Per-category row, desktop:

```
[≡ drag] [✓ enable]  Label_______  [color]  Prompt hint (textarea, 2-3 lines)  [⋯ delete]
```

- **Drag handle** updates `order`.
- **Enable toggle** flips `enabled`.
- **Label input** validates non-empty + case-insensitive unique.
- **Color** uses the [`ColorPicker`](../ui/patterns/color-picker.md)
  primitive (curated swatches + `+ custom` per the standard
  pattern).
- **Prompt hint** is multi-line; empty allowed (falls back to label
  as sole hint, soft warning).
- **Delete** confirmation-gated; orphan handling on existing chips
  per [Edge cases](#edge-cases).

Mobile expression: row collapses into a vertical stack inside an
[`Accordion`](../ui/patterns/accordion.md) item; the color picker
becomes a Sheet per the existing narrow-tier ColorPicker routing.

Add affordance: `+ Add category` at the list's bottom; spawns a
row with empty label, palette default color, empty prompt hint,
`enabled: true`, `order: items.length`.

Reset affordance: `Reset to mode defaults` menu action in the
section's overflow. Confirmation-gated; overwrites current list
with a fresh copy of
`app_settings.default_suggestion_categories[story.mode]`.
Story Settings only; the App Settings → Story Defaults editor has a
parallel "Reset to bundled defaults" action restoring shipped
values.

Save semantics: both editors live inside the existing
[save-sessions](../ui/patterns/save-sessions.md) pattern of their
parent screen. No new save infrastructure.

## Edge cases

### Terminal entry without chips

Opening entries (AI-generated via wizard or user-written),
`user_action` entries pre-AI-reply, `system` entries, and any
pre-feature legacy entry render the empty-state ⟳ Generate strip
described above. Single unified affordance; no special-casing.

### Parse failure on emission paths

Parse independence between `<state>` and `<suggestions>` covers
the common cases. Double-failure: state falls to per-turn
classifier (narrative-fold) or next periodic classifier
(classifier-fold); suggestions field stays undefined; reader shows
empty-state ⟳ Generate.

### Re-roll while re-roll in flight

Self-blocking concurrency policy + UI no-op on second click.
Second click does nothing while strip is `loading`. Cancel-and-
restart-with-new-guidance is parked-until-signal.

### Orphan `categoryId`

Render the chip with category label `(removed)`, neutral fallback
color from the palette, and text intact. Tap still works. No
auto-cleanup; lazy at render.

### Disabled-but-defined category

Chip renders normally — `label`, `color`, `promptHint` all
resolve. Disable is an emission gate, not a deletion.

### Branch switch with chips in flight

In-flight per-turn pipelines commit before branch switch fires per
existing reader transaction behavior. In-flight `suggestion-refresh`
aborts on branch switch — non-transactional, cancellable.

### Rollback semantics

`story_entries.metadata.nextTurnSuggestions` rolls back via the
existing metadata delta-log. After rollback, the new terminal
entry's chips become the active strip. No special-casing; aligns
with `worldTime` rollback. The user's rut-escape via rollback
sees prior-turn chips again; no recency-bias hint computed across
rollbacks.

### Translation interaction

Suggestion text becomes a first-class translatable content type.
The existing translation pipeline phase extends to walk
`nextTurnSuggestions.items[].text` alongside narrative, entity
names, and lore. Cache keyed by
`(target_language, hash(chip.text))` — content-addressable;
self-invalidating on re-roll text changes; survives CTRL-Z naturally
because revert produces the same hash as the prior cached row.

v1 rides `stories.settings.translation.granularToggles.narrative`
(suggestions translate when narrative does). Split toggle
(`granularToggles.suggestions`) parked-until-signal.

Translation soft-fail behavior inherits the existing
[`Translation graceful degradation`](../followups.md) followup's
policy.

Translation rows for chips travel with per-story export — adds one
more content type to the existing
[`Translation rows in per-story export / import`](../followups.md)
followup's scope.

### `suggestionsEnabled` toggled mid-story

- `false → true`: new turns emit chips. Existing turns' empty
  fields don't backfill. User sees chips from this point forward.
- `true → false`: emission stops; strip hides. Already-persisted
  `nextTurnSuggestions` data stays on entries (no display; no
  deletion). Re-enabling later surfaces historical chips again.

### Zero enabled categories

Emission produces empty `<suggestions>` block (or omits the
fragment entirely from the prompt). Strip rendering still respects
existing `nextTurnSuggestions` data on the terminal entry —
historical chips render with orphan-label handling for now-disabled
categories. Functionally equivalent to `suggestionsEnabled: false`
ONLY when no chips have ever been emitted on the terminal entry;
otherwise prior chips remain visible.

### Re-roll cancel during stage 2

Translation stage cancellation discards translation rows-in-progress
but stage 1 emission already committed. Chips display in source
language until next translation pass picks them up. Acceptable
graceful degradation; no special-case.

## Follow-ups generated

**Drained (resolved by this design):**

- `Next-turn suggestions — design pass` ([`followups.md`](../followups.md))
  — entire entry removed; all three sub-questions answered.

**Scope-clarified (existing entries gain a content type, no new
entry):**

- `Translation graceful degradation` — suggestions inherit
  soft-fail policy.
- `Translation rows in per-story export / import` — suggestion
  translation rows added to scope of next translation/export pass.

**New entries to add — `parked.md → Parked until signal → UX`:**

1. **Recency-bias diversity mitigation for suggestion category
   mix.** Pass previous entry's category-mix into the emission
   prompt if v1's prompt-level nudge proves insufficient. Schema
   already supports it.
2. **Split granular translation toggle for suggestions.** Add
   `granularToggles.suggestions: boolean` if real signal surfaces
   for split control (translated narrative + source-language
   chips or vice versa).
3. **Split capability flag for `<suggestions>` parse reliability.**
   Dedicated flag if a model proves reliable on `<state>` but
   unreliable on `<suggestions>` — i.e., creative prose in tagged
   block is a separate reliability axis from structured extraction.
4. **Re-roll cancel-and-restart on rapid double-click.** Switch
   the no-op-on-second-click behavior to cancel-previous-and-
   restart if users find the no-op unintuitive.
5. **Narrative quality empirical risk under suggestion fold.**
   Monitor whether emission of `<state>` AND `<suggestions>` in the
   narrative call degrades narrative prose. Fallback is
   suggestion-agent-always (the option not picked in the
   mid-design clarifying question). Add field-monitoring
   recommendation; act if signal surfaces.
6. **Restore-draft mechanism for tap-after-typing.** v1 documents
   the wart; if field signal surfaces, add a Toast-with-undo or
   confirm gate to preserve user typing on tap.

## Not followups — implementation notes

- Legacy entries pre-feature-landing show empty-state ⟳ Generate;
  no migration / backfill.
- `chipRevision` was considered and dropped during design; the
  content-hash translation cache keying self-invalidates without
  needing an explicit revision counter.
- Memory probe captures the `suggestion-refresh` pipeline same as
  other pipelines (per
  [`memory/probe.md`](../memory/probe.md)); no special-casing.
- Accessibility: chip = button with category label as accessible
  text; refresh button needs `aria-label="Refresh suggestions"`;
  strip in `loading` needs `aria-busy="true"`.

## Adjacent doc cleanup bundled

The `narrative?: string  // absent = use current global app-settings default at render time`
inline comment at
[`data-model.md`](../data-model.md#story-settings-shape) line 1120
is a straggler from before
[`2026-05-19-default-models-authority.md`](./2026-05-19-default-models-authority.md)
removed `app_settings.default_models`. Cleanup: drop the comment;
the resolution chain is documented elsewhere via
`assignments[agentId] → profile.modelRef`, with
`stories.settings.models[agentId]` as the optional override layer.
Unset agents pre-flight-error per
[`2026-05-19-default-models-authority.md`](./2026-05-19-default-models-authority.md).
