# Slice 3.7b — Suggestion settings: the Generation tab's Authoring aids section

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.7a](./07a-suggestions.md) (owns the
  palette shape, the emission gate this section drives, and the
  seeded defaults the reset affordance restores);
  [Slice 3.11](./11-story-settings-shell.md) (hosts the section
  per C7 — the tab map and the save session)
- **Blocks:** none

## Goal

Story Settings gains the Generation tab's Authoring aids section:
the `suggestionsEnabled` master toggle, the `suggestionCount`
stepper, and the categories editor wiring the shipped
`SuggestionCategoriesEditor` over
`stories.settings.suggestionCategories`. This is what makes 3.7a's
palette user-editable — and what makes the feature reachable at all
on stories created before 3.7a, whose `suggestionsEnabled` is
persisted `false` with no other route to flipping it.

## Background

3.7a seeds every new story with a per-mode palette and defaults the
master toggle on, but ships no UI to change either. The editor
compound itself already exists (`SuggestionCategoriesEditor`, built
and Storybook-covered ahead of this slice, currently reachable only
from `/dev`); this slice binds it to real story settings inside
3.11's save session.

Two things about the host are load-bearing. The section joins the
surface's single save bar by calling `useStorySettingsSection` from
inside its own body and reporting `{ dirtyFields, getPatch, reset }`
(C7). And Story Settings saves write `stories.settings` directly —
`stories` is absent from `deltas.target_table`, so a settings save
carries no delta and is **not** CTRL-Z reversible.

This is also the first slice able to make 3.11's save session dirty,
so it inherits the three questions 3.11 left open about a session
that until now could never have unsaved work.

## Required reading

- [`story-settings.md → Suggestion categories`](../../../../ui/screens/story-settings/story-settings.md#suggestion-categories)
  — the editor's placement, bound data, row anatomy, add / reset
  affordances, and save semantics.
- [`story-settings.md → Generation tab`](../../../../ui/screens/story-settings/story-settings.md#generation-tab--definitional-fields--authoring-aids)
  — the Authoring aids grouping this section lands in.
- [`ui/patterns/save-sessions.md`](../../../../ui/patterns/save-sessions.md)
  — the save bar, the dirty-field contract, and the navigate-away
  guard the open questions below turn on.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — `suggestionCategories` / `suggestionCount` /
  `suggestionsEnabled`.
- [`ui/patterns/color-picker.md`](../../../../ui/patterns/color-picker.md)
  — the per-row swatch picker and its narrow-tier routing.
- [Slice 3.11](./11-story-settings-shell.md) — the C7 seams: the
  route's tab map and `useStorySettingsSection`.

## Scope: in

- **The section:** hosted in the Generation tab's Authoring aids
  grouping, registering with the save session per C7, with
  `suggestionsEnabled` master toggle and `suggestionCount` stepper
  (1-6). The editor below dims when the master toggle is off.
- **Categories editor wiring:** bind the shipped
  `SuggestionCategoriesEditor` to
  `stories.settings.suggestionCategories` — drag order serialized
  as `order`, enable toggle, label input, `ColorPicker`, prompt
  hint, add row, delete.
- **Label validation:** non-empty and case-insensitively unique
  within the list; a collision blocks save with an inline error on
  the conflicting row. See the open question on the validity
  channel below — the shipped section contract has nowhere to
  report this.
- **Delete confirmation** and the **Reset to mode defaults**
  overflow action, both confirmation-gated; reset restores
  `app_settings.default_suggestion_categories[story.mode]`.
- **Colour round-trip:** a curated swatch persists as its palette
  slot key, a custom pick as raw hex, matching what 3.7a's
  `resolveAccentColor` reads.

## Scope: out

- Anything in [Slice 3.7a](./07a-suggestions.md) — emission,
  persistence, the refresh pipeline, the chip strip, the seed.
- The App Settings → Story Defaults categories editor (per-mode
  tabs over `default_suggestion_categories`) — M7.1.
- The `models.suggestion` assignment UI — M7.1 models tab.

## Acceptance criteria

- Category edits round-trip: reorder, rename, recolour, retoggle,
  add, and delete all persist through the surface's save and
  re-read correctly on reopen.
- A duplicate or empty label blocks the save with an inline error
  on the offending row, and the save bar reflects that the section
  is not saveable.
- `Reset to mode defaults` restores the seeded palette for the
  story's mode after confirmation.
- The master toggle drives the reader: flipping it off hides the
  strip while leaving persisted `nextTurnSuggestions` intact, and
  flipping it back on restores them (manual, against 3.7a's strip).
- Zero enabled categories stops emission but leaves historical
  chips rendering with orphan-label handling.
- A story created before 3.7a can be brought into the feature by
  toggling `suggestionsEnabled` on, without resetting its other
  settings.
- Save semantics: a settings save carries no delta and CTRL-Z does
  not reverse it.

## Tests

- Vitest: the section's `getPatch` / `reset` contract, label
  validation, and the order serialization.
- Storybook: the section bound over a fixture, including the
  master-toggle-off dimmed state and a label-collision error.
- E2E: `e2e/tests/story-settings-suggestions.spec.ts` — the save
  round-trip (edit → save → DB → reopen → toggle back on) and the
  dirty navigate-away guard.
- Manual smoke: full edit round-trip on desktop + Android, and the
  mid-story toggle matrix against a live reader.

## Open questions

None. Resolved at planning; see Implementation notes.

## Implementation notes

**Resolved developer decisions.**

- _Validity channel._ Extended the C7 contract with `invalidReason`
  (see [milestone.md → C7](../milestone.md#c7--story-settings-section-registration))
  rather than self-healing the label collision. The slice doc's
  stated cost of extending the contract — churning 3.1b's
  embedding-status panel, its other consumer — was wrong: that panel
  never registered with `useStorySettingsSection`, so this slice is
  the contract's first consumer, and the extension had no second
  caller to update.
- _Editor compound API._ `SuggestionCategoriesEditor` migrated its
  chrome to `t()` under `common.suggestionCategories`, not
  `storySettings` — M7.1's App Settings → Story Defaults tab reuses
  the same compound over a different data source, so its chrome
  can't live in a Story Settings-scoped namespace. The compound also
  gained an `onRequestDelete` prop so the host owns the confirmation
  [`story-settings.md → Suggestion categories`](../../../../ui/screens/story-settings/story-settings.md#suggestion-categories)
  requires, rather than the compound owning its own dialog.
- _Actions-menu intercept wired, not accepted._ `AppActionsMenu`
  gained an optional `beforeNavigate` prop; the Story Settings route
  wires it to `session.requestLeave`.
- _Phone collapsed save bar accepted, not lifted._ Canon places the
  bar inside the detail route
  ([`save-sessions.md → Save bar`](../../../../ui/patterns/save-sessions.md#save-bar--the-visible-ui)),
  so a dirty session collapsed back to the phone rail shows no bar.
  Changing where the bar lives is M4.4's call, the surface's real
  owner — queued in [triage](../../../triage.md#inbox).
- _Authoring aids ships the suggestions trio only._ Composer modes
  and wrap POV — the section's other two canonical fields — wait for
  M4.4; this slice binds `suggestionsEnabled`, `suggestionCount`, and
  the categories editor.
- _`suggestionCount` got a new `Stepper` primitive_
  (`components/ui/stepper.tsx`). The
  [Select primitive](../../../../ui/patterns/forms.md#select-primitive)
  cascade would have sent its 1-6 range to a dropdown; a stepper
  reads better for a small-integer count.
- _Reset mutates the draft, never writing directly_, and is gated on
  the master toggle so `Reset to mode defaults` can't mutate a
  dimmed, otherwise-inert editor.
- _`invalidReason` is gated on the categories being dirty_, so a
  collision already sitting in stored data can't refuse an unrelated
  toggle flip.
- _Dirty-route protection lives at navigator removal._ Story Settings
  uses React Navigation's removal guard and replays the exact blocked
  action through the save session; route-local back handlers alone do
  not see iOS edge swipes or reset/pop actions.
- _Generation gating follows `gateBehavior`, not a run-kind list._ The
  surface disables draft, Save, and direct Memory mutations while the
  canonical hard gate is active, and the action layer rejects those
  writes before reading or writing story state. Custom-picker copy is
  resolved above its portal and passed down, since native portal
  content cannot rely on inherited localization context.

**Deviations worth carrying forward.**

- This repo's `Popover` is uncontrolled — `@rn-primitives/popover`'s
  `Root` has no `open` prop; the imperative handle lives on the
  trigger ref instead. Follow `importer-menu.tsx`'s pattern.
- Component behavior belongs in Storybook, not the `unit` vitest
  project, which cannot render RN-Web chrome at all. See
  [Lessons learned → The `unit` Vitest project cannot render RN-Web component chrome](../../../lessons-learned/unit-project-no-rn-web-chrome.md).
