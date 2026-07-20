# Slice 3.11 — Story Settings shell (minimal host + section registration)

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; the M1.5 settings substrate and
  the M2 in-story routing are merged prerequisites)
- **Blocks:** the settings-section portions of
  [Slice 3.1b](./01b-embedder-lifecycle.md) (embedding-status
  panel) and [Slice 3.7](./07-suggestions.md) (Composer section) —
  partial gates; both slices' core work is independent of this
  shell.

## Goal

A minimal Story Settings host so M3's two settings surfaces have
somewhere to live: the route, the screen scaffold with tab /
section structure per the canonical layout, and a
section-registration seam (C7) that lets 3.1b and 3.7 add their
sections without touching shared files. Added at milestone
promotion — the audit found 3.1b and 3.7 authoring sections into a
screen the roadmap doesn't build until M4.4.

## Background

The canonical Story Settings screen is large — models, generation,
memory, translation, pack, and calendar tabs — and its real basic
surface is M4.4's job, with deep tabs in M7.2. M3 needs only a
host: the staleness resolution panel canon places in Story
Settings · Memory, and the suggestions controls canon places in
Story Settings → Composer. This slice ships the smallest honest
version of the screen — navigable route, canonical tab skeleton
with empty-state placeholders, and a registration mechanism —
explicitly _not_ the M4.4 surface. M4.4 extends this shell rather
than replacing it.

## Required reading

- [`story-settings.md → Layout`](../../../../ui/screens/story-settings/story-settings.md#layout)
  and
  [`Two sections under one roof`](../../../../ui/screens/story-settings/story-settings.md#two-sections-under-one-roof--wizard-editable-vs-post-creation-tuning)
  — the canonical screen structure the skeleton must not
  contradict.
- [`story-settings.md → Memory tab`](../../../../ui/screens/story-settings/story-settings.md#memory-tab)
  and
  [`Suggestion categories`](../../../../ui/screens/story-settings/story-settings.md#suggestion-categories)
  — the two sections M3 consumers register into.
- [`docs/ui/patterns/save-sessions.md`](../../../../ui/patterns/save-sessions.md)
  — the save-semantics pattern settings sections bind into (3.7's
  editor cites it).

## Scope: in

- **Route + entry point:** the Story Settings route reachable from
  the in-story chrome per the existing navigation model; back
  routing.
- **Screen scaffold:** the canonical tab / section skeleton with
  empty-state placeholders for tabs M3 doesn't fill ("lands in a
  later milestone" copy), themed per foundations, mobile
  expression per the standard narrow-tier rules.
- **Section-registration seam (C7):** each section is a
  self-registered module (same spirit as the M1.5 delta-dispatch
  registration — consumers touch no shared file); registration
  names fixed in this slice's first commit.
- **Save plumbing floor:** whatever minimal save-session wiring the
  two M3 sections need to persist through the existing
  story-settings mutators (3.7's editor and 3.1b's panel bring
  their own bodies; this slice hosts them).

## Scope: out

- The real basic surface (model overrides, per-story config) —
  M4.4.
- Deep tabs (pack, definition, calendar, translation, Advanced,
  the classifier panel) — M7.2.
- Any section body — 3.1b and 3.7 own theirs.

## Acceptance criteria

- The Story Settings route opens from an open story and renders
  the tab skeleton with empty-state placeholders on desktop and
  Android; navigation back to the reader preserves reader state.
- A fixture section registered through C7 renders in its declared
  tab without edits to any shared file (vitest / component test on
  the registration, mirroring the M1.5 registration-API test
  shape).
- Unfilled tabs show the placeholder, not blank panes; no dead
  controls.
- Every chrome string routes through `t()`; new compounds have
  stories.

## Tests

- Component test: registration seam (fixture section), tab
  rendering, empty states.
- Storybook: shell + placeholder states.
- Manual smoke: route round-trip on both platforms.

## Open questions

- **Skeleton breadth** — render all six canonical tabs with
  placeholders vs only the tabs M3 fills (Memory, Generation /
  Composer). Lean minimal (two tabs) to avoid advertising dead
  surface; confirm at planning.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
