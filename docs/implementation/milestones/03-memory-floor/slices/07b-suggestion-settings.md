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
- Manual smoke: full edit round-trip on desktop + Android, and the
  mid-story toggle matrix against a live reader.

## Open questions

- **The section contract has no validity channel.** `story-settings.md`
  requires a label collision to block save with an inline error, but
  3.11's `SectionRegistration` carries only an id, a tab, its
  `dirtyFields`, and a `getPatch` / `reset` pair — nothing that can
  say "dirty but invalid" — and `SaveBar` has no invalid state to
  render even if it could. Decide whether to extend the C7
  contract (a `valid` / `errors` field, which changes a shipped
  interface and its other consumer, 3.1b's embedding-status panel),
  or to self-heal the collision instead of blocking. Surfaced by
  M3.7a (2026-07-26).
- **The editor hard-codes its English chrome.** `SuggestionCategoriesEditor`
  ships `+ Add category` and `aria-label="Add category"` as literals,
  against the i18n discipline in
  [`code-conventions.md`](../../../../code-conventions.md#i18n-discipline).
  It takes no label props today, so wiring it as-is imports the
  violation into a shipped surface. Add label props, or migrate the
  compound to `t()` — decide which before binding. Surfaced by
  M3.7a (2026-07-26).
- **Which navigate-away intercepts the section needs.**
  [`save-sessions.md → Navigate-away guard`](../../../../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept)
  lists window-close intent and Actions-menu route jumps among its
  required categories. 3.11 shipped the window-close half
  (`useUnsavedChangesGuard`, both the Electron bridge and the
  `beforeunload` fallback), but the Actions-menu jump to Diagnostics
  still bypasses `requestLeave`. Note expo-router keeps the
  pushed-under screen mounted, so the draft survives the jump — the
  sharper risk is a window close while Diagnostics is on top, where
  the guard fires against a screen whose dialog is not visible.
  Decide whether to wire the route jump or accept it. Surfaced by
  M3.11 (2026-07-22), re-scoped after 3.11 shipped.
- **The save bar is invisible in the phone collapsed state.** The
  shell renders it inside the detail pane, and `MasterDetailLayout`
  hides that pane on phone whenever no tab is selected — so a dirty
  session collapsed back to the rail shows no bar, no dirty count,
  and no way to save or discard. Nothing is lost (every panel stays
  mounted, and leaving still routes through the guard), but the user
  cannot see or act on the unsaved changes.
  [`save-sessions.md → Save bar`](../../../../ui/patterns/save-sessions.md#save-bar--the-visible-ui)
  does not cover the collapsed case, and its positioning rule
  ("spans the editable pane only — never the rail or the surrounding
  chrome") argues against the obvious fix. This slice is the first
  that can make the session dirty, so it inherits the call: lift the
  bar to the surface footer on phone, or accept rail-state
  invisibility. Surfaced by M3.11 (2026-07-22).
- **The route-to-session wiring has no test coverage.**
  [Slice 3.11](./11-story-settings-shell.md)'s route mounts the save
  bar on the snapshot's dirty flag and the guard dialog on a pending
  leave while focused, then maps their actions onto `resolveLeave`.
  With zero
  registered sections none of that can execute, so deleting both
  blocks outright still passes the full suite — and running the app
  cannot catch it either. This slice is the first able to exercise
  the path end to end; decide whether to pin the seam with a story
  or a test that mounts the provider over a fixture section.
  Surfaced by M3.11 (2026-07-22).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
