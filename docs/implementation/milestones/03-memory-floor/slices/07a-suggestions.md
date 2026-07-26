# Slice 3.7a — Next-turn suggestions: emission folds, chip strip, refresh pipeline

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.2](./02-piggyback.md) (both on-turn
  emission folds ride its per-turn paths; `<suggestions>` parses
  through C2)
- **Blocks:** [Slice 3.7b](./07b-suggestion-settings.md) — the
  settings section edits the palette this slice seeds and gates
  emission on. No other M3 slice (the `models.suggestion` slot in
  the app settings models tab extends in M7.1)

## Goal

After each AI reply, tappable suggestion chips seed the user's next
turn: a `<suggestions>` block rides the narrative fold's tagged
emission (piggyback on) or a `suggestions` field on the classifier
fold's structured output (piggyback off), persists on the entry's
metadata, and renders as the reader's chip strip with category
overlines, a refresh re-roll through the new `suggestion-refresh`
pipeline, and an empty-state Generate. Editing the category palette
is [Slice 3.7b](./07b-suggestion-settings.md).

## Background

Suggestions are user-customizable per story: a category palette
(copied at creation from
`app_settings.default_suggestion_categories[mode]`) whose enabled
entries the model picks from per slot; chip count is decoupled from
category count. **The M1.5 gate landed the column but not the seed
data** — both mode arrays were empty and `buildStorySettings` took
no `mode`, so this slice lands the palettes and the copy-at-creation
path as well.

Emissions persist on `story_entries.metadata.nextTurnSuggestions`,
so chips are reload-, branch-, and rollback-safe through the
existing metadata delta log. The re-roll path is a dedicated
2-stage pipeline (`suggestion-refresh`, `no-gate`, self-blocking)
using the `suggestion` agent slot, with current composer text as
`refreshGuidance`. Tap fills the composer in `Free` mode; the
tap-after-typing draft loss is a documented v1 wart.

## Required reading

- [`reader-composer.md → Next-turn suggestions`](../../../../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions)
  — the full reader surface: chip anatomy, states, chrome row,
  empty-state, orphan / disabled category rules, and its
  [edge cases](../../../../ui/screens/reader-composer/reader-composer.md#edge-cases).
- [`data-model.md → Entry metadata shape`](../../../../data-model.md#entry-metadata-shape)
  — `nextTurnSuggestions` persistence shape + delta-log behavior.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — `suggestionCategories` / `suggestionCount` /
  `suggestionsEnabled` and copy-at-creation.
- [`generation-pipeline.md → V1 declarations`](../../../../generation-pipeline.md#v1-declarations)
  — the `suggestion-refresh` declaration values (no-gate,
  `blockedBy: ['per-turn', 'suggestion-refresh']`).
- [`generation-pipeline.md → Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation)
  — resolver-input declaration for the `suggestion` agent.
- [`ui/patterns/generation-status-pill.md`](../../../../ui/patterns/generation-status-pill.md)
  — the refresh pipeline's pill presence at low priority.
- [`ui/foundations/color.md → Curated accent palette`](../../../../ui/foundations/color.md#curated-accent-palette)
  — the fixed, mode-agnostic swatch set a category's `color` names.

## Scope: in

- **Creation-time seed:** the per-mode default palettes, threaded
  into `buildStorySettings` so a new story copies
  `app_settings.default_suggestion_categories[mode]`. Closes the gap
  the Background names.
- **Emission fragment:** the `<suggestions>` prompt fragment
  (enabled categories with `cat<N>` placeholders, `suggestionCount`
  slots, diversity nudge) appended to the narrative fold (3.2's
  piggyback call), and its JSON-shaped counterpart on the classifier
  fold (3.2's fallback pass is a structured call, so chips arrive as
  a schema field, not a sibling block); category-id placeholder swap
  post-parse; parse independence from `<state>` in all four outcome
  combinations (via C2).
- **Persistence:** metadata write with `source` tag
  (`piggyback` / `classifier` / `refresh`), `refreshGuidance` when
  present; delta-logged like any metadata mutation.
- **`suggestion-refresh` pipeline:** declaration + registration;
  stage 1 single-shot emission via the `suggestion` agent
  resolution; stage 2 conditional translation is a declared no-op
  skip in M3 (no translation settings UI before M7.2 — the M2
  short-circuit posture carries over); abort on branch switch;
  pill copy "Refreshing suggestions" at low priority;
  click-to-cancel before write.
- **Chip strip:** panel between entries and composer on terminal
  AI entries; chip anatomy (overline, prose body, accent strip
  resolved from the curated palette); a `phase`
  (`visible / loading / error / empty-state`) with `collapsed`
  orthogonal to it, and `hidden` owned by the route not the
  compound; chrome row (⟳ refresh with composer text as guidance,
  ⌄ collapse); tap → composer fill + `Free` mode; orphan-category
  `(removed)` fallback; disabled-category render rules;
  accessibility (chip = button with category label, `aria-busy`
  loading, refresh `aria-label`).
- **Pre-flight:** resolver-input declarations so an unassigned
  `suggestion` agent halts the refresh pipeline before phase 0
  with the M2 vocabulary; the on-turn folds ride the narrative /
  classifier agents' existing declarations.

## Scope: out

- The Story Settings Authoring aids section — the
  `suggestionsEnabled` toggle, the `suggestionCount` stepper, and
  the categories editor. [Slice 3.7b](./07b-suggestion-settings.md).
  Until it ships, a story's palette is whatever creation seeded and
  the feature is unreachable on stories created before this slice
  (`suggestionsEnabled` is a persisted boolean and those rows carry
  `false`).
- The App Settings → Story Defaults categories editor (per-mode
  tabs over `default_suggestion_categories`) — M7.1 settings depth;
  this slice seeds that column's data.
- The `models.suggestion` assignment UI — M7.1 models tab; the
  resolution chain + failure vocabulary cover M3.
- Chip-text translation (stage 2 active path) — M8.1/M8.2.
- Recency-bias category-mix hint, split capability flag, split
  translation toggle, restore-draft on tap-after-typing,
  cancel-and-restart re-roll — all parked-until-signal per canon.

## Acceptance criteria

- Narrative fold: a stub turn emitting `<state>` + `<suggestions>`
  persists chips with `source: 'piggyback'` and renders the strip;
  `<suggestions>` parse failure alone leaves state applied and the
  strip in empty-state Generate; the inverse leaves chips rendered
  (vitest over the four combinations).
- Classifier fold: with `piggybackMode='off'`, the fallback pass
  carries state and chips in one structured call; chips persist
  with `source: 'classifier'`, and a turn whose `<state>` failed
  while chips already landed does **not** re-roll and clobber them
  (vitest).
- Creation: a new story of each mode is seeded with that mode's
  palette, and a story whose app-level palette is empty falls back
  to the module constant (vitest).
- Refresh: ⟳ with composer text passes it as `refreshGuidance`
  (persisted), strip shows loading, second click no-ops
  (self-block), result overwrites chips with `source: 'refresh'`
  under a delta CTRL-Z reverses (vitest + manual).
- Empty-state: opening / user / system terminal entries show ⟳
  Generate; click produces chips ex nihilo.
- Tap: composer text replaced, mode set to `Free`; chip from a
  deleted category renders `(removed)` with neutral color and
  still taps.
- Rollback: after CTRL-Z of a turn, the prior terminal entry's
  chips become the active strip (vitest over the metadata delta).
- Emission gate: zero enabled categories stops emission but
  historical chips still render, and the strip hides entirely only
  when there is also nothing to show (vitest).
- Pre-flight: unassigned `suggestion` agent blocks the refresh
  pipeline before phase 0 with a system entry naming the failure.

## Tests

- Vitest: parse-combination matrix, persistence + rollback,
  refresh pipeline state machine incl. self-block + branch-switch
  abort, pre-flight halt for an unassigned `suggestion` agent,
  emission gating (enabled categories, master toggle),
  placeholder swap for category ids.
- Storybook: chip strip across every phase and both collapsed
  states, plus orphan-category, disabled-category, and custom-hex
  renders.
- E2E: a turn persists chips and renders them without leaking the
  trailing block into prose; tap fills the composer in `Free`; ⟳
  re-rolls with guidance; CTRL-Z reverses the re-roll; the
  classifier fold produces `source: 'classifier'`.
- Manual smoke: real-provider turns with chips on desktop +
  Android; refresh with guidance.

## Open questions

None. The two this slice resolved are recorded under Implementation
notes; the three concerning the settings surface moved to
[Slice 3.7b](./07b-suggestion-settings.md).

## Implementation notes

**The slice was split at planning**, on the C7 partial-gate line the
original brief already declared: 3.7a needs no Story Settings shell
at all, so emission, persistence, the pipeline, the strip, and the
seed ship here while the editor moves to
[3.7b](./07b-suggestion-settings.md).

**Resolved developer decisions.**

- _Classifier-fold wire shape._ 3.2's fallback pass is a
  `generateStructured` call, not a tagged-block call, so there is no
  `<suggestions>` block to sit beside `<state>` there. Chips ride a
  `suggestions` field on the classifier's schema, `.catch([])`-wrapped
  so a malformed array can't take scene state down with it. Still one
  call; different wire shape. `shouldFallbackFire` stays purely
  state-driven — the suggestion portion is added only when no chips
  were already captured this turn, which is what stops a
  `<state>`-failed / `<suggestions>`-ok turn from clobbering good
  chips. Canon updated in
  [`reader-composer.md`](../../../../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions).
- _Creation-time seed._ The Background's claim that the seed landed
  in the M1.5 gate was wrong: only the column did. Both mode arrays
  were empty, `buildStorySettings` took no `mode`, and
  `suggestionsEnabled` defaulted false — no story could ever emit a
  chip. 3.7a lands the per-mode palettes, threads `mode` through
  `buildStorySettings`, and defaults the toggle on. The palette is
  copied from `app_settings.default_suggestion_categories[mode]` per
  canon, with the module constant as the fallback for rows written
  before the seed existed.
- _Category colour._ Stored as a curated-palette slot key for a
  curated pick and a raw hex for a custom one; `resolveAccentColor`
  resolves either, with a neutral fallback. `data-model.md`'s
  "theme-resolved at render" phrasing was wrong — the palette is
  fixed and mode-agnostic per `color.md` — and has been corrected.

**Deviations worth carrying forward.**

- The strip's state is `phase` **plus an orthogonal `collapsed`**, not
  one enum. Canon's chrome row persists when collapsed, so ⟳ is
  reachable there; a single enum makes collapsed-and-loading
  unrepresentable.
- `suggestion-refresh` is the **first `no-gate` pipeline kind in the
  codebase**. That made two specified-but-unreachable framework paths
  reachable for the first time (the reversal barrier, and a
  reversal landing mid-run); both are filed in
  [`triage.md`](../../../triage.md).
- Caller input reaches a pipeline through a new `inputs?: unknown` on
  `PhaseContext` with a per-phase narrowing guard —
  `intermediates` is for state flowing _between_ phases and seeding it
  from `RunCtx` would leak a predecessor's inputs into a chained
  successor.
- The refresh's delta stamps `DeltaSource: 'ai_classifier'`. Not
  `user_edit` (a model-authored chip must not claim a human wrote it)
  and not a new member (no consumer needs the distinction; the
  classifier-specific values were split out of `ai_classifier` only
  when undo needed one).
- Fixing null-metadata undo required a matching change in
  `reverse-replay.ts`, not just `register.ts`. Existing persisted
  delta rows replay bit-identically — `computeUndoPayload` cannot
  emit a null at column level, so the new decode arm was previously
  unreachable.

**Deferrals.** Roughly a dozen cross-cutting items surfaced during
implementation and are queued in
[`triage.md`](../../../triage.md); one accepted limitation (the
single-slot status pill stranding a refresh behind a turn) is in
[`parked.md`](../../../../parked.md). Two of the triage items block
3.7b: the categories editor hard-codes its English chrome, and
3.11's section contract has no validity channel, which makes
`story-settings.md`'s "Collision blocks save with inline error"
unimplementable as shipped.
