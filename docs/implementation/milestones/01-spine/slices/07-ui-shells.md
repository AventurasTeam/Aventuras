# Slice 1.7 — UI shells

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.5](./05-pipeline-framework.md) (the
  pipeline orchestrator, stub LLM, ambient `actionId`, and the
  generation store with its namespaced mutators); [Slice 1.6](./06-base-stores.md)
  (app-settings and navigation stores plus their namespaced
  mutators; QueryClient setup; bootstrap order including
  `hydrateAppSettings()`).
- **Blocks:** Nothing in milestone 1; this slice closes the
  milestone.

## Goal

Bring up the user-visible spine of the app: the landing
screen (empty story list), the reader-composer with existing
pieces wired through to the namespaced stores, the settings
screen layouts. **Install `i18next` + `react-i18next`** with a
`locales/en/*` namespace skeleton — every chrome string in
this slice routes through `t()` from day one (per
[`tech-stack.md → i18n`](../../../../tech-stack.md), the
day-one-install rule that avoids the hardcoded-strings retrofit
tax). **Mount `<Toaster>` at app root** consuming the
`useToasts` store from Slice 1.6, so any subsystem can fire
toasts from this slice onward.
The reader-composer hosts the milestone's end-to-end smoke
trigger — a debug-only affordance that fires a stub-LLM
pipeline run through the orchestrator and verifies that
everything below this slice composes: action layer, Path A
delta handler, logger, `httpCallSink`, `turnCaptureSink`,
`pipeline_runs`, generation store. By the end of this slice
the milestone-1 Definition of Done is met.

## Background

Milestone 1's purpose is the walking skeleton, not feature
delivery. The UI shells render layout and the components that
already exist in `components/<domain>/`, `components/shells/`,
`components/compounds/`, etc. — placeholders fill in where
real components don't exist yet. Interactive flows
(story-creation wizard, provider management, autocomplete,
suggestion popovers, side-rail expansion, autosave, etc.)
all defer to later milestones whose features need them.

The smoke trigger is debug scaffolding. It needs a story, a
branch, and a current branch reference to call
`orchestrator.beginRun`. Rather than building a real
story-creation flow this slice, the trigger creates a
synthetic story and branch via direct `lib/db/` writes when
no current story exists, then calls the orchestrator with a
`'smoke'` pipeline kind that uses the stub LLM (happy
scenario). This bypasses the action-layer-only-mutator
discipline for the database writes — accepted because the
code is scaffolding that will be removed when real
story-creation UI lands. Flag the file with a `TODO(spine)`
comment to make the lifecycle explicit.

Cross-component ephemeral state turns out to not be needed
for milestone 1's surfaces: story list is empty, settings is
layout-only, reader-composer uses `useState` for any local
needs (input draft, scroll position, etc.). `lib/stores/ui/`
stays empty per Slice 1.6's placeholder — real population
happens when real interactive features land.

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
    empty story list per `story-list.md`. No create-story
    affordance ships this slice; the empty state references
    "Stories will appear here once created."
  - Reader-composer route (`app/reader-composer/[branchId].tsx`
    or similar) renders the existing pieces:
    - Top bar (existing component)
    - Inert side rail (placeholder box, no expand, no
      content)
    - Scrolling story-entry list (uses existing story-entry
      component for each entry; empty state when no entries)
    - Textarea and button at bottom (existing component)
  - Settings route (`app/settings/_layout.tsx` plus
    sub-routes per the settings spec). Renders section
    headings and the navigation chrome only; the only
    interactive control is the diagnostics master toggle,
    which calls `stores.domain.setDiagnosticsEnabled(value)`
    from Slice 1.6.
- Navigation wiring: any cross-route transition uses
  `stores.domain.setCurrentStory(id)` and
  `stores.domain.setCurrentBranch(id)`. Selectors via
  `useNavigation` drive the reader-composer's branch context.
- **i18n install** — `i18next` + `react-i18next` per
  [`tech-stack.md → i18n`](../../../../tech-stack.md):
  - `i18n` init module under `lib/i18n/` exposing the
    configured instance and the typed `t()` helper.
  - `locales/en/*.json` namespace skeleton (per the project's
    namespace convention — landing / reader / settings as the
    first namespaces; others added by later slices).
  - Every chrome string introduced by this slice's screens
    routes through `t()` from day one. No hardcoded English
    strings outside `locales/en/*.json`.
  - i18n provider wraps the React tree below `QueryClientProvider`
    in the bootstrap order.
- **Toaster mount** at app root, consuming `useToasts` from
  Slice 1.6 (per
  [`patterns/toast.md`](../../../../ui/patterns/toast.md)).
  Smoke-test toast fires from the end-to-end smoke trigger's
  success or failure case, proving the queue → mount path
  works.
- Bootstrap order assembled at the app root, per Slice 1.5
  and 1.6:
  1. Migrations apply (from `lib/db/`).
  2. Crash recovery pass runs (from `lib/pipeline/`).
  3. `hydrateAppSettings()` (from `lib/stores/`).
  4. i18n init (loads default `en` resources).
  5. QueryClientProvider mounts the React tree.
  6. I18nextProvider wraps below QueryClientProvider.
  7. `<Toaster>` mounts inside the provider tree.
  8. Expo Router renders.
- Smoke trigger in the reader-composer:
  - Debug-only affordance — visible in `pnpm dev` builds and
    gated by a build-time constant for production builds.
    Production builds either omit the button entirely or
    render it as a no-op (implementer's call).
  - On click: if `useNavigation.getState().currentBranchId`
    is null, create a synthetic story and branch via direct
    `lib/db/` writes and call `setCurrentStory` then
    `setCurrentBranch`. Bypass of the action layer is
    accepted for this scaffold; flag the file with a
    `TODO(spine)` comment.
  - Then call `orchestrator.beginRun({ kind: 'smoke', branchId, ... })`
    where `'smoke'` is a pipeline kind defined in this slice
    (one phase that calls the stub LLM with the `'happy'`
    scenario, emits one delta, completes).
  - Visual feedback: a non-blocking indicator showing
    in-flight / completed / failed state, sourced from
    `useGeneration` selector.
- Storybook stories for any compound newly introduced this
  slice. Existing components don't need new stories beyond
  what already covers them.
- Diagnostics Hub entry point in the Actions menu (top-bar
  chrome): a placeholder link that, when clicked, opens an
  empty "Diagnostics Hub" route under `app/diagnostics/`.
  The route renders a stub `Diagnostics Hub — coming soon`
  message; the actual tabs (Logs, Calls, Per-turn inspector)
  ship with later milestones. Visible only when
  `useAppSettings(s => s.diagnostics.enabled)` is true
  (per the observability spec's "Hidden when master toggle
  is OFF" rule).

## Scope: out

- Story-creation UI (real wizard, title input, cover image,
  etc.). The smoke trigger's synthetic story is debug
  scaffolding; real story-creation lands in its own slice
  in a later milestone.
- Interactive settings flows beyond the diagnostics toggle
  (provider add / edit, profile management, assignment
  configuration, narrative profile UI). Settings screen
  ships layout only.
- Reader-composer interactive features (autocomplete,
  suggestions, side-rail expansion, autosave, entry editing,
  branch fork, etc.). All defer to later milestones.
- Diagnostics Hub UI tabs (Logs, Calls, Per-turn inspector,
  Memory probe). Entry point ships; the actual tabs ship in
  a later milestone.
- Real LLM provider integration through the smoke trigger.
  Stub LLM is what runs; real providers come when the
  provider settings UI ships.
- Cross-component ephemeral stores in `lib/stores/ui/`.
  Stays empty until real interactive features need them.
- Persistent scroll positions, history, complex selection
  state. Treated as ephemeral or out-of-scope.
- Onboarding flow, wizard, story-settings, chapter-timeline,
  vault, plot, world, memory-probe — all separate
  milestones.

## Acceptance criteria

- App boots on Electron desktop and an Android emulator. The
  bootstrap order runs without error: migrations → crash
  recovery → `hydrateAppSettings()` → React tree.
- All milestone-1 routes navigable from the landing screen:
  landing → reader-composer → settings (and back). Direct
  URL load of each route works.
- Empty story list renders the empty-state message.
- Reader-composer renders the top bar, inert side rail,
  scrolling entry list, and textarea with button.
- Settings screen renders section layouts; the diagnostics
  toggle works end-to-end (UI click →
  `stores.domain.setDiagnosticsEnabled` →
  `app_settings.diagnostics.enabled` row updated, store
  reflects the change, subsequent app start respects it).
- Smoke trigger in reader-composer fires a stub-LLM pipeline
  run that completes end-to-end:
  - Synthetic story and branch created on first click if no
    current branch.
  - `orchestrator.beginRun({ kind: 'smoke', ... })` called.
  - `pipeline_runs` row inserted with `finished_at` NULL,
    then updated to `outcome='completed'`.
  - At least one `logger.warn` or `logger.error` emission
    (depending on the smoke pipeline's emit pattern) shows
    up in `diagnosticsStore.logEntries`.
  - At least one `httpCallSink` entry shows up (the stub
    LLM's outbound call mock, even if synthetic).
  - One `TurnCapture` populated and finalized with
    `outcome='completed'`.
  - Generation store reflects the run lifecycle:
    `currentRun` non-null during, null after.
- Diagnostics Hub link visible in the Actions menu when
  master toggle is on; clicking opens the stub route.
- Storybook stories exist for every UI compound newly
  introduced this slice.
- `pnpm lint` passes.
- `pnpm lint:docs` passes.
- Vitest tests pass.
- Manual on-device smoke per Slice 1.1's device-test trigger
  checklist: all routes navigable on Android; reader-composer
  scroll, keyboard, focus behave correctly on Android; settings
  toggle interactive on Android.

## Tests

- **Bootstrap order.** Unit test for the app-root effect
  that runs migrations, recovery, hydration in sequence.
  Assert each phase's completion before the next starts.
- **Empty story list renders.** Storybook test that the
  landing screen renders its empty state when no stories
  exist.
- **Reader-composer renders existing pieces.** Storybook
  test that the layout assembles top bar, side rail, scroll
  list, and textarea / button without error when given an
  empty entries array.
- **Settings diagnostics toggle.** Vitest with RN Testing
  Library: render the toggle, simulate click, assert the
  store mutator was called with the new value and the
  underlying `app_settings.diagnostics.enabled` row
  updated.
- **Smoke trigger end-to-end.** Vitest integration test:
  click the trigger; assert synthetic story and branch
  created, `orchestrator.beginRun` called, the full
  lifecycle completes, all sinks populate.
- **Production-build debug-trigger gating.** Build with
  the production-mode constant; assert the trigger is
  either absent from the DOM or no-ops on click.
- **Manual cross-platform smoke.** Documented checklist for
  the implementer to walk on Electron desktop and an
  Android emulator: all routes navigate, smoke trigger
  fires, diagnostics toggle persists across restart.

## Open questions

- **Synthetic story and branch shape.** What title, what
  branch name? Likely "Smoke test story" / "main"
  defaults; confirm at authoring. The synthetic data
  exists only to satisfy the orchestrator's branch-context
  requirement.
- **Smoke pipeline kind definition.** Defined inline in
  this slice as `'smoke'`: one phase that calls the stub
  LLM with `'happy'` scenario and emits one delta. If a
  later milestone defines a real pipeline kind that
  overlaps this name, the smoke kind renames or moves to
  a `pipelines/smoke.ts` file scoped to debug builds.
- **Diagnostics Hub stub.** The Hub route exists but is
  empty — the spec ([`docs/observability.md`](../../../../observability.md))
  and per-screen doc define what each tab does. Stubbing
  with a "coming soon" message is sufficient for milestone
  1; real tabs ship per the Diagnostics Hub milestone.
- **Trigger UI placement.** The user previously flagged
  this in the milestone's open questions. Author's call
  at implementation time — at the bottom of the composer
  as a small affordance, or hidden behind a developer-menu
  open. Pick the lower-noise option.
- **Removal commit.** The smoke trigger and its synthetic
  story bootstrap should be removed when real
  story-creation UI ships. Track the removal as a followup
  in `docs/followups.md` at the time this slice merges.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
