# Slice 3.7 — Next-turn suggestions: emission folds, chip strip, refresh pipeline

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.2](./02-piggyback.md) (both on-turn
  emission folds ride its per-turn paths; `<suggestions>` parses
  through C2); [Slice 3.11](./11-story-settings-shell.md) —
  partial: only the settings section's host waits on the shell
  (C7); emission, persistence, and the chip strip proceed
  regardless
- **Blocks:** none in M3 (the `models.suggestion` slot in the app
  settings models tab extends in M7.1)

## Goal

After each AI reply, tappable suggestion chips seed the user's next
turn: a sibling `<suggestions>` block emits in the narrative fold
(piggyback on) or the classifier fold (piggyback off), persists on
the entry's metadata, and renders as the reader's chip strip with
category overlines, a refresh re-roll through the new
`suggestion-refresh` pipeline, and an empty-state Generate. Story
Settings gains the Composer categories editor (wiring the shipped
`SuggestionCategoriesEditor`) plus the `suggestionsEnabled` toggle
and `suggestionCount` stepper.

## Background

Suggestions are user-customizable per story: a category palette
(seeded at creation from
`app_settings.default_suggestion_categories[mode]` — the column and
seed landed in the M1.5 gate) whose enabled entries the model picks
from per slot; chip count is decoupled from category count.
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
- [`story-settings.md → Suggestion categories`](../../../../ui/screens/story-settings/story-settings.md#suggestion-categories)
  — the editor's placement and bound data.
- [`ui/patterns/generation-status-pill.md`](../../../../ui/patterns/generation-status-pill.md)
  — the refresh pipeline's pill presence at low priority.

## Scope: in

- **Emission fragment:** the shared `<suggestions>` prompt fragment
  (enabled categories with `cat<N>` placeholders, `suggestionCount`
  slots, diversity nudge) appended to the narrative fold (3.2's
  piggyback call) and the classifier fold (3.2's fallback pass);
  category-id placeholder swap post-parse; parse independence from
  `<state>` in all four outcome combinations (via C2).
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
  AI entries; chip anatomy (overline, prose body, accent strip,
  theme-resolved palette slot); states
  (`visible / loading / error / collapsed / hidden / empty-state`);
  chrome row (⟳ refresh with composer text as guidance, ⌄
  collapse); tap → composer fill + `Free` mode; orphan-category
  `(removed)` fallback; disabled-category render rules;
  accessibility (chip = button with category label, `aria-busy`
  loading, refresh `aria-label`).
- **Settings surface:** the Composer section registered into the
  Story Settings shell per C7
  ([Slice 3.11](./11-story-settings-shell.md) hosts), with
  `suggestionsEnabled` master toggle, `suggestionCount` stepper,
  and the categories editor wiring the shipped
  `SuggestionCategoriesEditor` over
  `stories.settings.suggestionCategories` (drag order, enable,
  label validation, ColorPicker, prompt hint, delete confirm,
  reset-to-mode-defaults).
- **Pre-flight:** resolver-input declarations so an unassigned
  `suggestion` agent halts the refresh pipeline before phase 0
  with the M2 vocabulary; the on-turn folds ride the narrative /
  classifier agents' existing declarations.

## Scope: out

- The App Settings → Story Defaults categories editor (per-mode
  tabs over `default_suggestion_categories`) — M7.1 settings depth;
  the seed data flows from M1.5 regardless.
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
  emits both blocks in one call; chips persist with
  `source: 'classifier'` (vitest).
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
- Settings: category edits round-trip; zero enabled categories
  stops emission but historical chips still render;
  `suggestionsEnabled` toggles per the mid-story matrix (vitest on
  the emission gate; manual on the editor).
- Pre-flight: unassigned `suggestion` agent blocks the refresh
  pipeline before phase 0 with a system entry naming the failure.

## Tests

- Vitest: parse-combination matrix, persistence + rollback,
  refresh pipeline state machine incl. self-block + branch-switch
  abort, pre-flight halt for an unassigned `suggestion` agent,
  emission gating (enabled categories, master toggle),
  placeholder swap for category ids.
- Storybook: chip strip in all six states; categories-editor
  binding story if the wiring extracts a new compound.
- Manual smoke: real-provider turns with chips on desktop +
  Android; refresh with guidance.

## Open questions

- **Fragment placement in the classifier-fold call** — one call
  emitting `<state>` + `<suggestions>` is canon; confirm ordering
  and token budget interaction with 3.2's fallback prompt at
  planning.
- **Strip virtualization interaction** — the strip sits between the
  virtualized entry list and the composer; confirm it lives outside
  the scroll container (reader-document pattern) rather than as a
  list row.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
