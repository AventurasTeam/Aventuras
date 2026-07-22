# Slice 3.11 — Story Settings shell (minimal host + section registration)

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; the M1.5 settings substrate and
  the M2 in-story routing are merged prerequisites)
- **Blocks:** the settings-section portions of
  [Slice 3.1b](./01b-embedder-lifecycle.md) (embedding-status
  panel) and [Slice 3.7](./07-suggestions.md) (Authoring aids
  section) — partial gates; both slices' core work is independent
  of this shell.

## Goal

A minimal Story Settings host so M3's two settings surfaces have
somewhere to live: the route, the screen scaffold with tab /
section structure per the canonical layout, and the C7 seam — the
route's tab map plus the shell's save session — that 3.1b and 3.7
hang their sections off. Added at milestone promotion — the audit
found 3.1b and 3.7 authoring sections into a screen the roadmap
doesn't build until M4.4.

## Background

The canonical Story Settings screen is large — about, generation,
models, memory, translation, pack, calendar, and advanced tabs —
and its real basic surface is M4.4's job, with deep tabs in M7.2.
M3 needs only a host: the staleness resolution panel canon places
in Story Settings · Memory, and the suggestions controls canon
places on the Generation tab under _Authoring aids_. This slice
ships the smallest honest version of the screen — navigable route,
canonical tab skeleton with empty-state placeholders, and the
save-session seam sections join — explicitly _not_ the M4.4
surface. M4.4 extends this shell rather than replacing it.

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
- **Tab map + save-session seam (C7):** the route's tab map is the
  extension point — `renderPanel` switches on the tab id and a
  consumer slice introduces its own branch there, mirroring how
  M3.1a extended App Settings. Sections join
  the surface's save session at runtime via
  `useStorySettingsSection`; names fixed in this slice's first
  commit.
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
- A fixture section joining the save session through
  `useStorySettingsSection` surfaces its dirty fields in the shell's
  single save bar, and Save / Discard reach its `getPatch` /
  `reset` (vitest on the aggregation module).
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

- **Skeleton breadth** — **Resolved at planning:** all eight
  canonical tabs render, with unfilled tabs showing the
  later-milestone placeholder. Matches App Settings, which already
  ships its full rail with placeholders, and keeps M4.4 / M7.2 to
  adding content rather than restructuring the rail.

## Implementation notes

Resolved developer decisions and deviations worth carrying forward.
Cross-cutting findings this slice surfaced went to
[triage](../../../triage.md) instead, and the ones that go live with
the first real section consumer went to
[Slice 3.7's Open questions](./07-suggestions.md#open-questions).

- **The C7 seam is a route tab map plus a save-session context, not
  a component registry.** The contract cites the M1.5 delta-registry
  precedent, but App Settings — canonically the same layout
  pattern — extends by editing its own route file, and
  [Slice 3.1a](./01a-embedder-core.md) did exactly that to add its
  Embedding models tab, for nine lines. A registry would have saved a
  consumer slice roughly four lines at the price of giving the two
  settings screens divergent extension patterns. The seam is
  `components/story-settings/tabs.ts`: adding an id to a group
  registers the tab, and the id union, the deep-link accept-list, and
  each section's save-bar `order` all derive from that one structure.
- **Story Settings saves are direct writes, with no delta and no
  CTRL-Z**, because `stories` is absent from the tables
  [`deltas.target_table`](../../../../data-model.md#diagram)
  enumerates. Sections contribute patches that the shell merges into
  exactly one `updateStorySettings` call; per-section commits would
  strand earlier sections persisted and unrecoverable if a later one
  failed.
- **The shell renders every tab panel and hides the inactive ones on
  purpose.** A section joins the save session from inside its own
  body, so lazily mounting panels would drop a dirty section on a tab
  switch and silently discard the draft, against the
  one-session-per-surface rule. A later slice must not optimize this
  into lazy mounting.
- **`getPatch()` is gated on the section being dirty**, which is
  load-bearing precisely because every panel is mounted: an unvisited
  section returning its slice of settings unconditionally would write
  mount-time values back on any save.
- **Accepted scope gap.** `AppActionsMenu`'s Diagnostics-Hub jump is
  a bare `router.push`, so the navigate-away guard — which wraps only
  the surface's own back path — does not intercept it. A general
  router-event interceptor was out of scope; it waits on
  [Slice 3.7](./07-suggestions.md#open-questions), the first slice
  that can make the session dirty.
- **Window-close intent is wired.** `useUnsavedChangesGuard` raises
  the surface's own dialog for an Electron window-close (held in the
  main process until the user answers) and the browser's native
  prompt for a web reload or tab close. Electron's own reload path
  still bypasses it — queued in
  [triage](../../../triage.md#inbox).
