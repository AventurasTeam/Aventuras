# Slice 1.7a — App root: boot order, diagnostics ownership, recovery

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.5b](./05b-stub-and-recovery.md)
  (`recoverInFlightRuns()` + `RecoveryReport` for the boot-time
  crash-recovery pass this slice wires into the bootstrap;
  transitively [Slice 1.5a](./05a-pipeline-core.md)); [Slice 1.6](./06-base-stores.md)
  (the appSettings store, `hydrateAppSettings()` /
  `useAppSettingsHydration` reading the whole `app_settings` row,
  the `useToasts` queue the `<Toaster>` consumes, and the root
  QueryClient).
- **Blocks:** [Slice 1.7b](./07b-ui-shells.md) (the screens mount
  inside the provider tree this slice assembles, route their chrome
  through the i18n instance it installs, and the settings
  diagnostics toggle calls the master-toggle action it ships);
  [Slice 1.7c](./07c-smoke.md) (the smoke run's crash-recovery
  wiring and the `<Toaster>` it toasts through live here).

## Goal

Assemble the real app root and make boot production-shaped. Install
`i18next` + `react-i18next` and mount `<Toaster>`, reassemble the
bootstrap order (migrations → crash recovery → blocking app-settings
hydrate → providers), rework diagnostics-gate ownership so the
appSettings store owns the persisted toggles behind an **injected**
gate, and add the boot-blocking `app_settings` recovery screen. No
feature screens — those are [Slice 1.7b](./07b-ui-shells.md). By the
end of this slice the app boots through every spine layer with a
production-shaped composition root, and a corrupt `app_settings`
config halts at a recovery screen instead of silently defaulting.

## Background

Milestone 1 is a walking skeleton; this slice owns the composition
root and the bootstrap concerns the UI screens and the smoke depend
on. Three things converge here. **i18n and `<Toaster>` install
day-one** per [`tech-stack.md → i18n`](../../../../tech-stack.md),
so chrome ships translation-routed and any subsystem can toast from
this slice onward. The **diagnostics-gate ownership rework**
supersedes Slice 1.6's deferral: 1.6 left the toggles owned by
`lib/diagnostics` with a default-on-parse-failure stopgap; this
slice moves the persisted mirror onto the appSettings store behind
an injected gate, per
[`observability.md` → Store ownership and gate wiring](../../../../observability.md#store-ownership-and-gate-wiring).
The **`app_settings` recovery screen** replaces the 1.6
default-on-failure stopgap with the blocking screen
[`architecture.md`](../../../../architecture.md#settings-strict-types-defaults-at-load)
specifies. Keep the paraphrase thin; the canonical docs are
authoritative.

## Required reading

- [`docs/architecture.md` → Settings: strict types, defaults at load](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — the hydrate-time Zod parse, the `app_settings` parse-failure
  recovery contract, and the (reconciled) diagnostics-mirror
  ownership.
- [`docs/observability.md` → Store ownership and gate wiring](../../../../observability.md#store-ownership-and-gate-wiring)
  — the injected-gate design, the live-getter rule, the
  toggle-as-action + re-hydrate contract, `clearBuffers()` on off.
- [`docs/observability.md` → Gating model](../../../../observability.md#gating-model)
  — the two settings fields, defaults, and wipe semantics.
- [`docs/generation-pipeline.md` → Crash recovery via pipeline_runs marker table](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  — the fixed boot slot `recoverInFlightRuns()` occupies.
- [`docs/tech-stack.md` → i18n](../../../../tech-stack.md) — the
  day-one-install rule and the namespace convention.
- [`patterns/toast.md`](../../../../ui/patterns/toast.md) — the
  `<Toaster>` mount and `useToasts` queue contract.

## Scope: in

- **i18n install** — `i18next` + `react-i18next`:
  - `lib/i18n/` init module exposing the configured instance and
    the typed `t()` helper.
  - `locales/en/*.json` skeleton for the namespace(s) this slice
    introduces (the bootstrap / recovery strings). Per-screen
    namespaces (landing / reader / settings) land with their
    screens in [Slice 1.7b](./07b-ui-shells.md).
  - `I18nextProvider` wraps the tree below `QueryClientProvider`.
  - Every chrome string this slice introduces routes through
    `t()`; no hardcoded English outside `locales/en/*.json`.
- **`<Toaster>` mount** at app root, consuming `useToasts` from
  Slice 1.6 (per
  [`patterns/toast.md`](../../../../ui/patterns/toast.md)).
- **Bootstrap order** assembled at `app/_layout.tsx`:
  1. Migrations apply (from `lib/db/`).
  2. Crash-recovery pass runs (`recoverInFlightRuns()` from
     `lib/pipeline/`; the `RecoveryReport` is logged).
  3. `hydrateAppSettings()` (from `lib/stores/`) — a **config**
     parse failure halts and renders the recovery screen (below); a
     **diagnostics-section** parse failure defaults the toggles to
     off and continues; an absent row hydrates defaults.
  4. `configureDiagnosticsGate({ isEnabled, isDebugEnabled })` with
     live thunks (below).
  5. i18n init (loads default `en` resources).
  6. `QueryClientProvider` mounts the React tree.
  7. `I18nextProvider` wraps below it.
  8. `<Toaster>` mounts inside the provider tree.
  9. Expo Router renders.
- **Diagnostics gate ownership rework** (supersedes Slice 1.6's
  deferral), per
  [`observability.md` → Store ownership and gate wiring](../../../../observability.md#store-ownership-and-gate-wiring):
  - **Un-strip `diagnostics`** into the appSettings snapshot — the
    existing `useAppSettingsHydration` already reads the whole row,
    so one hydration carries it. Tighten the loosely-typed mirror
    against the `app_settings` Zod schema.
  - **Delete** `useDiagnosticsHydration` / `hydrateDiagnostics`.
  - `lib/diagnostics` exposes `configureDiagnosticsGate` +
    `clearBuffers` in place of `setDiagnosticsEnabled` /
    `setDiagnosticsDebugEnabled`. The gate holds thunks (default
    `() => false`) reading `domain.getAppSettings().diagnostics.*`
    **live** — never importing `lib/stores`, never capturing the
    snapshot. The `__DEV__` force-on folds into `isEnabled`.
  - **Master-toggle action** (in `lib/actions/`) — writes the
    `app_settings.diagnostics` row, re-hydrates the appSettings
    store, and on the off-write calls `clearBuffers()`.
  - **Re-point the pipeline fault suite's gate control.**
    `lib/pipeline/__tests__/harness.ts` currently drives the gate
    via `setDiagnosticsEnabled` / `setDiagnosticsDebugEnabled`;
    switch it to the new configure mechanism.
  - `app/_layout.tsx` calls `configureDiagnosticsGate` once
    (replacing the deleted `useDiagnosticsHydration` call).
- **`app_settings` recovery screen** — boot-blocking, for a
  **config** parse failure (corrupt / unparseable `app_settings`
  row), per
  [`architecture.md` → Settings: strict types, defaults at load](../../../../architecture.md#settings-strict-types-defaults-at-load).
  A bootstrap concern, distinct from crash recovery and from the
  settings screen's deferred flows. Actions: `Open file` (reveal
  the SQLite file in the OS file manager — **desktop only**) and
  `Reset settings` (write a fresh default `app_settings` row, then
  re-hydrate — self-contained, needs no provider infrastructure).
  **On Android, `Reset settings` only** — no `Open file` (no
  user-accessible path to hand-repair; resolved). No automatic
  reset — losing configured providers and API keys is destructive.
  `hydrateAppSettings`'s config-parse-throw branch signals the
  bootstrap to render this screen; the fresh-install empty-row
  branch still hydrates defaults. Renders pre-Router as a minimal
  standalone surface (not via `ScreenShell`), using the i18n
  instance for its copy.

## Scope: out

- All feature screens (landing, reader-composer, settings,
  Diagnostics Hub) and navigation wiring —
  [Slice 1.7b](./07b-ui-shells.md).
- The settings diagnostics **toggle UI** — 1.7b wires it to this
  slice's action; this slice ships and tests the action directly.
- The smoke trigger, `'smoke'` pipeline kind, and synthetic
  story / branch — [Slice 1.7c](./07c-smoke.md). (The
  crash-recovery boot wiring is here; the run that exercises it is
  1.7c.)
- Per-story parse failures (`stories.definition` /
  `stories.settings`) — land with the story-open path in a later
  milestone.
- Interactive settings flows, provider management, profile
  management — later milestones.

## Acceptance criteria

- App boots on Electron desktop and an Android emulator; the
  bootstrap runs without error: migrations → crash recovery →
  `hydrateAppSettings()` → `configureDiagnosticsGate` → provider
  tree → Router. (The Router root is still the dev gallery / a
  placeholder until 1.7b lands the real landing.)
- `i18next` installed; the `locales/en` bootstrap / recovery
  namespace is committed; the recovery screen and any chrome
  strings this slice introduces route through `t()`.
- `<Toaster>` is mounted at app root; a toast enqueued
  programmatically renders. (The full queue → mount proof from a
  real run rides with 1.7c's smoke.)
- Diagnostics gate end-to-end: the master-toggle action persists
  `app_settings.diagnostics.enabled` and re-hydrates the appSettings
  store; the injected gate reads the new value **live**; sinks honor
  it; a subsequent app start respects it; the off-write clears the
  three in-memory ring buffers.
- `lib/diagnostics` no longer exposes `setDiagnosticsEnabled` /
  `setDiagnosticsDebugEnabled` / `useDiagnosticsHydration`;
  `configureDiagnosticsGate` + `clearBuffers` are the public
  surface; `lib/diagnostics` imports nothing from `lib/stores`.
- `app_settings` recovery screen: a deliberately corrupted config
  row halts boot at the recovery screen (no normal-tree mount);
  `Reset settings` writes a fresh default row and boot proceeds; an
  absent row boots to defaults without the screen; a
  diagnostics-only parse failure defaults the toggles off and boot
  continues. Android shows `Reset settings` only.
- `pnpm lint` passes.
- `pnpm lint:docs` passes.
- Vitest tests pass.

## Tests

- **Bootstrap order.** Unit-test the app-root effect that runs
  migrations, recovery, and hydration in sequence. Assert each
  phase completes before the next starts.
- **`app_settings` recovery branch.** Seed a corrupt config row,
  run the bootstrap, assert it halts into the recovery state (no
  normal-tree mount); invoke `Reset settings`, assert a fresh
  default row is written and hydration then succeeds. Seed an
  absent row, assert it boots to defaults without recovery. Seed a
  diagnostics-only-corrupt row, assert the toggles default off and
  boot continues.
- **Diagnostics gate.** Drive the master-toggle action; assert
  `app_settings.diagnostics` persisted, the appSettings store
  re-hydrated, the gate thunk returns the new value, sinks
  no-op / activate accordingly, and the off-write calls
  `clearBuffers()` (buffers empty). Toggle twice; assert the gate
  reflects both (live read, not a captured snapshot).
- **Diagnostics public-API surface.** Fixture: importing
  `setDiagnosticsEnabled` / `useDiagnosticsHydration` fails;
  `configureDiagnosticsGate` / `clearBuffers` resolve; a
  `lib/diagnostics` → `lib/stores` import fails the boundaries
  lint.
- **Pipeline fault-suite regression.** The existing 1.5b fault
  scenarios still drive the gate via the new mechanism.
- **Toaster mount.** Render the root, enqueue a toast via
  `useToasts`, assert it renders.

## Open questions

- **Store snapshot reads expose live nested values** (carried
  from [Slice 1.6](./06-base-stores.md#implementation-notes)).
  `domain.getAppSettings()` returns a fresh top-level object each
  call but its nested values are the store's **live references**,
  not deep copies. The gate's resolution shipped (it calls
  `getAppSettings()` on every check, never captures it); the
  broader rule — every consumer treats the result as read-only —
  also binds [Slice 1.7b](./07b-ui-shells.md)'s screen reads. Deep
  freezing is deferred to the Zod-parsed-copy milestone.

## Implementation notes

### Resolved developer decisions

- **Two-parse hydrate, discriminated result.** `hydrateAppSettings`
  parses the config (`appSettingsConfigSchema`) and the diagnostics
  section (`appSettingsDiagnosticsSchema.safeParse`) independently and
  returns `BootHydrateResult` (`ok` or `config-corrupt`). A config
  failure halts at the recovery screen without mutating the mirror; a
  diagnostics-section failure defaults the toggles off and continues;
  an absent row hydrates defaults. A read throw (an unparseable JSON
  column) maps to `config-corrupt` too — at M1 a transient read error
  is not distinguished from corruption, and halting beats silently
  defaulting away configured providers and keys.
- **Both diagnostics toggle actions shipped now.** `lib/actions/settings`
  exposes `setDiagnosticsEnabled` and `setDebugLevelEnabled`; each
  persists the `app_settings.diagnostics` row then re-hydrates the
  mirror, and the master off-write also calls `clearBuffers()`. 1.7b's
  two toggles both have a mutator with no mid-UI-slice follow-up.
- **`Open file` is a dedicated `native:reveal-db-file` IPC.** Main
  resolves the path (`getDbFilePath()`) and calls
  `shell.showItemInFolder`; the renderer calls
  `window.native.revealDbFile()` and never computes the path. Android
  feature-detects the bridge method and omits the button.
- **i18n self-initializes at import; single `common` namespace.**
  `lib/i18n` creates and `init()`s the instance synchronously with
  bundled `en` resources, so the recovery screen's bound `t()` resolves
  pre-Router without `<I18nextProvider>`. No `expo-localization`
  (en-only). The recovery screen is inline minimal — no per-screen doc
  or wireframe.

### Notable deviations and constraints for future slices

- **Gate is configured before recovery, not after hydrate.** The brief
  ordered `configureDiagnosticsGate` after hydrate; `runBootstrap` wires
  it first. The gate is a live pull-getter, so its position is
  functionally free, and configuring it first lets the crash-recovery
  pass's logs be captured (and `__DEV__`-forced-on in dev).
- **Recovery never blocks boot — guarded at the boot layer.**
  `recoverInFlightRuns`'s outer orphan query is not wrapped (only its
  per-orphan bodies are), so `runBootstrap` wraps the recovery call in a
  `try`/`catch` (logs `bootstrap.recovery_failed`, continues to
  hydrate); `useBootstrap` also routes any unexpected rejection to the
  recovery screen. Without this a recovery-query failure at boot would
  hang the app at a blank loading screen with no escape.
- **The brief's "`useToasts` from 1.6" was inaccurate.** No such hook
  exists; `lib/toast` is an imperative singleton and `<Toaster>` already
  shipped as a foundation module. This slice mounts the existing
  `<Toaster>` and proves it via `toast.success(...)`. The 4th toast
  severity (`warning`) stays a separate followup, out of scope.
- **CI cold-cache flake guard.** The recovery-screen story pulls
  `i18next` / `react-i18next` into the Storybook browser Vitest project;
  `vitest.config.ts` adds them to that project's `optimizeDeps.include`
  to avoid a mid-run re-optimize and reload.
- **Recovery-screen Reset has no pending, disabled, or error state**
  (M1-acceptable: a failed reset leaves the screen up to retry, never
  hangs). The interactive settings UI in
  [Slice 1.7b](./07b-ui-shells.md) should add those states when it wires
  the live toggles to this slice's actions.
