# Slice 1.7b — UI shells + navigation

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.7a](./07a-app-root-boot.md) (the
  provider tree the screens mount inside, the i18n instance their
  chrome routes through, the `<Toaster>`, and the diagnostics
  master-toggle action plus injected gate the settings toggle and
  Diagnostics-Hub gating consume); [Slice 1.6](./06-base-stores.md)
  (the navigation store selectors / mutators and the appSettings
  selector the Diagnostics-Hub visibility reads). Transitively
  [Slice 1.5b](./05b-stub-and-recovery.md) via 1.7a.
- **Blocks:** [Slice 1.7c](./07c-smoke.md) (the smoke trigger
  injects into this slice's reader-composer route).

## Goal

Bring up the user-visible spine: the landing screen (empty story
list), the reader-composer with existing pieces wired through to the
namespaced stores, and the settings screen layouts. Replace the
`/dev` redirect with the real app navigation. Every chrome string
routes through the `t()` instance installed in
[Slice 1.7a](./07a-app-root-boot.md). The only interactive controls
are the two settings diagnostics toggles (master enable + debug
level, the latter disabled when master is off), wired to 1.7a's
actions; all other interactive flows defer to later milestones.

## Background

Milestone 1's purpose is the walking skeleton, not feature delivery.
The UI shells render layout and the components that already exist in
`components/<domain>/`, `components/shells/`,
`components/compounds/`, etc. — placeholders fill in where real
components don't exist yet. Interactive flows (story-creation wizard,
provider management, autocomplete, suggestion popovers, side-rail
expansion, autosave, etc.) all defer to later milestones whose
features need them.

Cross-component ephemeral state turns out to not be needed for
milestone 1's surfaces: story list is empty, settings is
layout-only, reader-composer uses `useState` for any local needs
(input draft, scroll position, etc.). `lib/stores/ui/` stays empty
per Slice 1.6's placeholder — real population happens when real
interactive features land.

## Required reading

- [`docs/ui/principles.md`](../../../../ui/principles.md)
  — cross-cutting UI principles every screen follows.
- [`docs/ui/screens/story-list/story-list.md`](../../../../ui/screens/story-list/story-list.md)
  — landing screen spec; this slice ships the empty-state
  layout only.
- [`docs/ui/screens/reader-composer/reader-composer.md`](../../../../ui/screens/reader-composer/reader-composer.md)
  — reader-composer spec; this slice wires existing pieces
  (top bar, story-entry components, textarea / button, inert
  side rail) into a working shell.
- [`docs/ui/screens/app-settings/app-settings.md`](../../../../ui/screens/app-settings/app-settings.md)
  — settings spec; this slice ships layout only, no
  interactive flows beyond the diagnostics toggle.

## Scope: in

- Expo Router routes for the milestone-1 screens:
  - Landing route (`app/index.tsx` or equivalent) renders the
    empty story list per `story-list.md` via `ScreenShell`
    (`app-root`) plus the empty-state primitive. **Replaces the
    `/dev` redirect.** No create-story affordance ships this slice;
    the empty state references "Stories will appear here once
    created."
  - Reader-composer route (`app/reader-composer/[branchId].tsx`
    or similar) renders the existing pieces:
    - Top bar (`ScreenShell`, `in-story` variant)
    - Inert side rail (placeholder box, no expand, no content)
    - Scrolling story-entry list (uses the existing `entry-card`
      component for each entry; empty state when no entries)
    - Textarea and button at bottom (existing components)
    - **No smoke trigger** — that injects in
      [Slice 1.7c](./07c-smoke.md).
  - Settings route (a single `app/settings/index.tsx` with in-pane
    tab state — see [Implementation notes](#implementation-notes) for
    why not `_layout.tsx` + sub-routes). Renders section headings and
    the navigation chrome only; the two diagnostics toggles are the
    interactive controls, invoking the master-toggle and debug-level
    **actions** shipped in [Slice 1.7a](./07a-app-root-boot.md). The
    debug-level toggle is interactive (1.7a shipped its mutator) and
    grayed when master is off.
- Navigation wiring: any cross-route transition uses
  `stores.domain.setCurrentStory(id)` and
  `stores.domain.setCurrentBranch(id)`. Selectors via
  `useNavigation` drive the reader-composer's branch context.
- **Per-screen i18n namespaces** (landing / reader / settings)
  added to `locales/en/*.json`; every chrome string introduced by
  these screens routes through `t()`. No hardcoded English outside
  `locales/en/*.json`.
- Diagnostics Hub entry point in the Actions menu (top-bar chrome):
  a placeholder link that, when clicked, opens an empty
  "Diagnostics Hub" route under `app/diagnostics/`. The route
  renders a stub `Diagnostics Hub — coming soon` message; the
  actual tabs (Logs, Calls, Per-turn inspector) ship with later
  milestones. Visible only when
  `useAppSettings(s => s.diagnostics.enabled)` is true (per the
  observability spec's "Hidden when master toggle is OFF" rule).
- Storybook stories for any compound newly introduced this slice.
  Existing components don't need new stories beyond what already
  covers them.

## Scope: out

- i18n install, `<Toaster>` mount, bootstrap order, diagnostics
  gate ownership rework, and the `app_settings` recovery screen —
  [Slice 1.7a](./07a-app-root-boot.md).
- The smoke trigger, `'smoke'` pipeline kind, and synthetic
  story / branch — [Slice 1.7c](./07c-smoke.md).
- Story-creation UI (real wizard, title input, cover image, etc.).
  Real story-creation lands in its own slice in a later milestone.
- Interactive settings flows beyond the diagnostics toggle
  (provider add / edit, profile management, assignment
  configuration, narrative profile UI). Settings screen ships
  layout only.
- Reader-composer interactive features (autocomplete, suggestions,
  side-rail expansion, autosave, entry editing, branch fork, etc.).
  All defer to later milestones.
- Diagnostics Hub UI tabs (Logs, Calls, Per-turn inspector, Memory
  probe). Entry point ships; the actual tabs ship in a later
  milestone.
- Cross-component ephemeral stores in `lib/stores/ui/`. Stays empty
  until real interactive features need them.
- Persistent scroll positions, history, complex selection state.
  Treated as ephemeral or out-of-scope.
- Onboarding flow, wizard, story-settings, chapter-timeline, vault,
  plot, world, memory-probe — all separate milestones.

## Acceptance criteria

- All milestone-1 routes navigable from the landing screen:
  landing → reader-composer → settings (and back). Direct URL load
  of each route works.
- Empty story list renders the empty-state message.
- Reader-composer renders the top bar, inert side rail, scrolling
  entry list, and textarea with button.
- Settings screen renders section layouts; the diagnostics toggle
  works end-to-end (UI click → 1.7a's toggle action persists
  `app_settings.diagnostics.enabled` and re-hydrates the appSettings
  store → the injected gate reads the new value, and sinks honor
  it).
- Diagnostics Hub link visible in the Actions menu when the master
  toggle is on; clicking opens the stub route; hidden when off.
- Storybook stories exist for every UI compound newly introduced
  this slice.
- `pnpm lint` passes.
- `pnpm lint:docs` passes.
- Vitest tests pass.
- Manual on-device smoke per Slice 1.1's device-test trigger
  checklist: all routes navigable on Android; reader-composer
  scroll, keyboard, focus behave correctly on Android; settings
  toggle interactive on Android.

## Tests

- **Empty story list renders.** Storybook test that the landing
  screen renders its empty state when no stories exist.
- **Reader-composer renders existing pieces.** Storybook test that
  the layout assembles top bar, side rail, scroll list, and
  textarea / button without error when given an empty entries
  array.
- **Settings diagnostics toggle.** Split across the two test
  environments, because a browser-rendered RN switch and a
  node-SQLite write cannot share one runtime: a Storybook play
  test renders the toggle, clicks it, and asserts the handler
  fires with the new value
  (`DiagnosticsSettingsPanel` stories); a vitest asserts 1.7a's
  master-toggle action writes the `app_settings.diagnostics.enabled`
  row and re-hydrates the store
  (`lib/actions/settings/diagnostics.test.ts`). The rendered-switch
  to real-action binding in the route is covered by the route
  navigability smoke check below.
- **Route navigability.** Manual / smoke check that each route
  mounts and back-navigation works.

## Open questions

Both questions this slice carried are resolved; the decisions live in
[Implementation notes](#implementation-notes):

- **Store snapshot reads expose live nested values** — the
  Diagnostics-Hub visibility (and every other read this slice wires)
  goes through the `useAppSettings` selector hook, never a captured
  `getAppSettings()` snapshot. The broader deep-freeze deferral stays
  1.7a's; see
  [Slice 1.7a Open questions](./07a-app-root-boot.md#open-questions).
- **Settings sub-route shape** — shipped as a single
  `app/settings/index.tsx` with in-pane tab state, the Diagnostics tab
  the only interactive one and the rest "Coming soon" placeholders.

## Implementation notes

### Resolved developer decisions

- **Both diagnostics toggles are interactive.** The master enable and
  the debug-level toggle both wire to 1.7a's actions
  (`setDiagnosticsEnabled` / `setDebugLevelEnabled`); debug-level is
  disabled when master is off. Supersedes the original brief's "only
  the master toggle is interactive" wording (Goal + Scope amended).
- **Settings ships as one route**, not `app/settings/_layout.tsx` +
  per-tab sub-routes, using `MasterDetailLayout` for the tier-aware
  two-pane: desktop/tablet side-by-side, phone list-first collapse
  (the top-bar Return is stack-aware — it pops the open tab back to
  the rail before exiting the surface). The left rail lists all
  sections/tabs; only the Diagnostics tab renders live content (the
  two toggles), every other tab shows a "Coming soon" placeholder.
  Later milestones add real tab bodies by replacing the
  `activeTab === 'diagnostics'` branch (e.g. a `tabId → node` map).
  Desktop defaults to the Diagnostics tab (the only live one) — flip
  to Providers once it has content.
- **Screens are assembled route-local — no extracted per-screen
  shells**, per
  [`component-inventory.md`](../../../../ui/component-inventory.md)'s
  reader-composer all-locality decision. The two new reusable
  compounds are `AppActionsMenu` (gated Diagnostics-Hub entry) and
  `DiagnosticsSettingsPanel` (the toggle pair); both carry Storybook
  play tests and inventory rows.
- **`ScreenShell` gained an optional `actions` slot** that replaces
  its default Actions icon; the chrome screens mount `<AppActionsMenu>`
  into it. The Diagnostics-Hub entry reads
  `useAppSettings(s => s.diagnostics.enabled)` via the selector (never
  a snapshot), so it is hidden when diagnostics is off.

### Notable deviations and constraints for future slices

- **Temporary `__DEV__`-gated "Open reader (debug)" affordance.** With
  no story and no create-flow in M1, this landing button is the only
  path into the reader (it seeds placeholder story/branch ids and
  routes to `/reader-composer/__debug__`). It is `__DEV__`-only (absent
  in production builds) and **must be removed before M2**, once real
  story-open / [Slice 1.7c](./07c-smoke.md)'s synthetic story lands.
- **Reader chrome is intentionally bare for M1.** The `in-story` top
  bar renders title-only (no chapter/time/branch chips — later
  milestones), the side rail is an inert placeholder, the composer
  textarea is editable but the Send button is disabled (the live
  trigger is 1.7c), and the Story Settings ⛭ icon is present-but-inert
  (its target screen is a later milestone). The reader route ignores
  the `branchId` URL param and renders an empty entry list regardless;
  1.7c wires entries.
