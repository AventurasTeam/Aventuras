# Slice 1.6 — Base Zustand stores

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.2](./02-drizzle-schema.md)
  (`app_settings` row to hydrate from; schema-shaped types);
  [Slice 1.5a](./05a-pipeline-core.md) (the `lib/stores/`
  module's initial setup with the generation store and
  namespaced `index.ts` shape; the cross-cutting action layer
  for any future multi-store work).
- **Blocks:** Slice 1.7 — UI shells render against the
  namespaced store selectors and call the per-store mutators
  they expose.

## Goal

Extend `lib/stores/` (created in Slice 1.5a) with the
app-settings and navigation domain stores, plus the
`ui` subnamespace ready for cross-component ephemeral state.
The `ui` subnamespace includes the `useToasts` queue per
[`patterns/toast.md`](../../../../ui/patterns/toast.md) — the
backing store for the `<Toaster>` mount that Slice 1.7 wires
into app root.
Each domain store exposes its own selectors and named
mutation functions through the existing namespaced
`index.ts`; raw Zustand handles never leave the module. Stand
up the root TanStack QueryClient with the project's agreed
compute-cache defaults so the diff-cache slice (later
milestone) plugs in without further setup.

## Background

Per the state-placement convention finalized in Slice 1.1's
`docs/code-conventions.md`, single-store mutations (with or
without SQLite persistence) live inside the store file as
named functions exposed through the namespaced
`lib/stores/index.ts`. There is no `lib/actions/<domain>/`
scaffolding for single-store writes — the action layer
narrows to cross-cutting transactional work (multi-store
coordination, multi-table SQLite, pipeline Path A delta
application), all of which is already covered by Slice 1.5a
for the milestone-1 surface. Slice 1.6's writes are all
single-store and live with their stores.

Mechanical enforcement of "no `setState` from outside the
stores module" comes from the namespace shape itself: the
public API exposes selector hooks and named mutator functions
but never the raw Zustand store handles. Components can't
reach for `setState` because the handle isn't in the public
API. Slice 1.1's existing one-`index.ts` boundaries rule
suffices; no rule extension is needed.

The QueryClient sits at the app root and is used off-label
for compute-derived caching rather than network state.
Defaults are tuned to that: no auto-refetch, infinite stale
time, explicit invalidation only. No consumer in this slice —
the diff cache that proves the abstraction useful lands in a
later milestone — but the substrate is in place so future
caches don't have to introduce React Query as part of their
own slice.

## Required reading

- [`docs/architecture.md` → Settings: strict types, defaults at load](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — `useAppSettingsStore` shape, hydration timing, the
  `getState()` cross-store read pattern.
- [`docs/data-model.md` → App settings storage](../../../../data-model.md#app-settings-storage)
  — singleton row, JSON-heavy convention; the store mirrors
  these JSON paths in memory.

Slice 1.1's `docs/code-conventions.md` is also required
reading for the state-placement tiers and the namespaced
public-API rule but isn't hot-linked here since it lands in
the same milestone (the link would fail remark until 1.1
commits).

## Scope: in

- Extend `lib/stores/` (the existing module from Slice 1.5a):
  - Add `domain/app-settings.ts` declaring the raw
    `useAppSettingsStore` (never exposed) and named
    selectors / mutators (see below).
  - Add `domain/navigation.ts` declaring the raw
    `useNavigationStore` (never exposed) and its named
    selectors / mutators.
  - Add the `ui/` subdirectory with the `useToasts` queue per
    [`patterns/toast.md`](../../../../ui/patterns/toast.md) — the
    backing store for the `<Toaster>` mount that Slice 1.7 wires
    into app root. Other `ui/*` stores ship in later slices as
    cross-component ephemeral state emerges.
  - Update `lib/stores/index.ts` to extend the existing
    `domain` namespace with the app-settings and navigation
    entries, and to declare the empty `ui` namespace so
    consumers can reference `stores.ui.*` without errors.
- Implement `lib/stores/domain/app-settings.ts`:
  - Internal `useAppSettingsStore` (Zustand) holding mirrored
    JSON paths from the `app_settings` singleton row:
    `providers`, `profiles`, `assignments`,
    `default_provider_id`, `diagnostics`. Empty defaults
    populated by Slice 1.2's first-init seed.
  - **Named selectors exposed via the namespace**:
    `useAppSettings` (a selector hook with optional
    field-selector overloads).
  - **Named mutators exposed via the namespace** — single
    store, SQLite-persisted writes that live with the store
    rather than in `lib/actions/`: `setDiagnosticsEnabled(value)`,
    `setDebugLevelEnabled(value)`. Each writes
    `app_settings` in a SQLite transaction and applies the
    Zustand mirror on success; rolls back the in-memory
    state if the SQL write throws.
  - **Hydration**: a `hydrateAppSettings()` function called
    from app bootstrap after migrations and crash recovery
    complete; reads the singleton row and populates the
    store.
  - Other settings mutators (provider add / edit, profile
    add / edit, assignment set, narrative profile update)
    land with the settings UI in later milestones — Slice
    1.7 renders settings layout only, not interactive
    flows, so only diagnostics toggles need mutators in
    this slice.
- Implement `lib/stores/domain/navigation.ts`:
  - Internal `useNavigationStore` (Zustand) holding
    `currentStoryId: string | null` and
    `currentBranchId: string | null`.
  - **Named selectors**: `useNavigation`.
  - **Named mutators**: `setCurrentStory(id)`,
    `setCurrentBranch(id)`. Pure-Zustand; navigation IDs
    are ephemeral, the URL or route history is the
    persistence surface (Expo Router handles that
    separately).
  - Additional fields beyond IDs (scroll positions,
    selection state, history) deferred to whenever Slice
    1.7 surfaces a real cross-component need.
- Update `lib/stores/index.ts` to expose the extended
  namespace shape:

  ```ts
  // illustrative; final shape per implementer
  export const domain = {
    // from Slice 1.5a:
    useGeneration,
    startRun,
    recordPhaseResult,
    finishRun,
    abortRun,
    // added in Slice 1.6:
    useAppSettings,
    setDiagnosticsEnabled,
    setDebugLevelEnabled,
    hydrateAppSettings,
    useNavigation,
    setCurrentStory,
    setCurrentBranch,
  }

  export const ui = {
    // empty in milestone 1; populated by Slice 1.7 onward
  }
  ```

  Raw store handles (`useAppSettingsStore`,
  `useNavigationStore`, `useGenerationStore`) stay internal
  to the module. The namespace shape itself enforces
  "no `setState` from outside."

- Stand up the root TanStack QueryClient:
  - Create the `QueryClient` instance at the app root with
    defaults: `refetchOnWindowFocus: false`,
    `refetchOnReconnect: false`,
    `defaultOptions: { queries: { staleTime: Infinity } }`.
  - Wrap the Expo Router root layout (`app/_layout.tsx`)
    and the Electron renderer entry with
    `QueryClientProvider`.
  - File placement: small `app/_queryClient.ts` (or similar
    name) at the app root. Lift into `lib/cache/` later
    when the diff-cache slice creates a second consumer.
- Wire `hydrateAppSettings()` into the app bootstrap
  sequence, after migrations and crash recovery, before the
  first user-facing surface renders. Order: migrations →
  crash recovery → `hydrateAppSettings()` → React tree
  mounts.

## Scope: out

- Interactive settings flows (provider add / edit, profile
  management, assignment configuration, narrative profile
  UI). Slice 1.7 renders settings shells as layout only;
  full interactive flows land in later milestones.
- Cross-component ephemeral Zustand stores in
  `lib/stores/ui/`. Subfolder lands empty; Slice 1.7
  populates as it discovers cross-component state needs.
- Translations flat index. Architecture mentions Zustand
  loads translations for O(1) chip resolution; that's a
  later milestone with the translation pipeline.
- Diff cache. QueryClient is set up here; the cache itself
  lands later.
- Per-screen scroll positions, focus state, transient
  selection. Either `useState` per surface or
  `lib/stores/ui/` emerges in Slice 1.7; this slice doesn't
  pre-decide.
- Migrations to add a `scroll_position` field on `stories`
  or similar persistence. Scroll is treated as ephemeral for
  v1.
- New `lib/actions/<domain>/` subdirectories for single-store
  mutations — those live in their store files. The action
  layer is for cross-cutting work, which milestone 1 already
  covered in Slice 1.5a.

## Acceptance criteria

- `lib/stores/index.ts` exposes the extended `domain`
  namespace including app-settings selectors and mutators,
  navigation selectors and mutators, and the empty `ui`
  namespace. Generation entries from Slice 1.5a still work.
- `useAppSettings` hydrates from the `app_settings` row via
  `hydrateAppSettings()` during bootstrap;
  `diagnostics.enabled` and `debug_level_enabled` are
  readable through the selector.
- `hydrateAppSettings()` falls back to `APP_SETTINGS_DEFAULTS`
  and logs `bootstrap.app_settings_hydrate_failed` when the
  row read throws. (The persisting diagnostics toggle is
  deferred — see Implementation notes.)
- `setCurrentStory(id)` and `setCurrentBranch(id)` mutate
  the navigation store; no SQLite write.
- Raw store handles (`useAppSettingsStore`,
  `useNavigationStore`, `useGenerationStore`) are not in the
  public API of `lib/stores/`. A fixture importing them
  from `lib/stores` fails type-check; importing them from
  `lib/stores/domain/*` directly fails lint (boundaries
  rule).
- `QueryClient` is constructed in `lib/cache` with the
  project's defaults; a single `QueryClientProvider` wraps
  the app tree at `app/_layout.tsx` (Electron loads the same
  web build — one wrap point).
- Bootstrap order is migrations → `hydrateAppSettings()`
  (non-blocking) → React tree mounts. Crash-recovery
  insertion is Slice 1.7's (per Slice 1.5b).
- `pnpm lint` passes (slice 1.1's existing boundaries rule
  plus the console ban from Slice 1.3).
- `pnpm lint:docs` passes.
- Vitest suite covers hydration, mutator roundtrips for both
  persistent and pure-Zustand cases, and rollback behavior.

## Tests

- **Hydration.** Drive `hydrateAppSettings(read)` with a
  seeded row (`providers` / `profiles` / `assignments` /
  `defaultProviderId`); assert `getAppSettings()` mirrors
  the seeded values, and that a missing row falls back to
  defaults. (No persistent mutator ships this slice — the
  app-settings store is read-only; see Implementation
  notes.)
- **Hydration fallback.** Make the injected read throw;
  call `hydrateAppSettings(read)`; assert the store falls
  back to defaults and `logger.error` fired
  `bootstrap.app_settings_hydrate_failed`.
- **Mutator roundtrip — pure-Zustand.** Call
  `domain.setCurrentStory('story-id')`; assert the
  `getNavigation()` snapshot reflects the new ID.
- **getState-style read.** After `hydrateAppSettings`,
  assert `domain.getAppSettings()` returns the hydrated
  values (the snapshot-read path the generation context
  will use; no real cross-store consumer exists in M1).
- **Public-API surface.** Fixture outside `lib/stores/`
  imports only via `lib/stores/index.ts`; deep-import
  attempts fail lint. Fixture importing
  `useAppSettingsStore` from the index fails type-check
  (raw handle not exposed).
- **QueryClient defaults.** Inspect the constructed
  `QueryClient`; assert defaults match the project values.

## Open questions

- **Navigation store fields beyond IDs.** Scroll positions,
  selection state, history — TBD until Slice 1.7
  discovers what cross-component state actually needs
  persistence across the milestone-1 routes. Probably
  emerges as `useState` first, promotes to
  `lib/stores/ui/` if real cross-component need surfaces.
- **QueryClient placement.** _Resolved:_ landed in a
  `lib/cache/` module, not inline at app root — the
  `app/`-inline placement pulled a `.test.ts` into the
  expo-router web bundle and broke desktop boot. See
  Implementation notes.
- **Hydration error handling.** If
  `hydrateAppSettings()` throws (corrupt JSON in
  `app_settings`, schema mismatch), what does the app do?
  Default reset to seed values plus a `logger.error`
  emission is the likely answer, but the exact policy
  isn't pinned by this slice. Confirm at authoring.
- **Namespace shape evolution.** As more domain stores
  land in later milestones (entities, lore, threads,
  happenings, deltas), the `domain` namespace grows. If
  it becomes unwieldy, consider sub-grouping
  (`domain.world.useEntities`, `domain.session.useAppSettings`).
  Not a milestone-1 concern.

## Implementation notes

The slice was authored before Slice 1.3's `lib/diagnostics` store and
the pre-existing `lib/toast` foundation module were accounted for;
planning reconciled both, so several brief items were superseded.

**Deviations from the brief:**

- **Diagnostics toggle dropped.** `setDiagnosticsEnabled` /
  `setDebugLevelEnabled` and the `diagnostics` mirror are NOT in the
  app-settings store. `lib/diagnostics` already owns the live gate, the
  in-memory setters, and boot hydration
  ([`observability.md`](../../../../observability.md#ingress) places
  `diagnosticsStore` in-module). The app-settings store ships as a
  read-only hydrated mirror of `providers` / `profiles` /
  `assignments` / `defaultProviderId`, with **no mutators**. The
  persisting toggle is deferred — it is a cross-store action (writes
  `app_settings` and flips the `lib/diagnostics` gate), to land in
  `lib/actions/` when the interactive settings UI gives it a consumer.
  Navigation carries the slice's only mutators.
- **Toast dropped.** `lib/toast/` and `components/ui/toast.tsx` already
  implement the queue and `<Toaster>`; the `ui` namespace ships empty.
  The `toast.md`-vs-`lib/toast` gap (warning severity, action button)
  is logged in [`followups.md`](../../../../followups.md).
- **QueryClient lives in `lib/cache`, not inline at the app root.** The
  original `app/_queryClient.ts` placement broke desktop boot:
  expo-router scans `app/**/*.test.ts` into the web bundle, which
  imported `vitest` and crashed the renderer. Caught by the desktop
  smoke; moved to a `lib/cache` module (its test lives under `lib/`,
  never bundled as a route). One `QueryClientProvider` wrap at
  `app/_layout.tsx` — Electron loads the same web build, so there is no
  separate renderer entry to wrap.
- **Boot order is migrations → `hydrateAppSettings` (non-blocking) →
  mount.** The brief's intervening "crash recovery" step is dropped
  here; crash-recovery boot wiring is Slice 1.7's per Slice 1.5b.
- **Hydration validates and falls back, not a blocking recovery
  screen.** `app_settings` config is parsed at hydrate through
  `appSettingsConfigSchema` (Zod); on a parse failure boot logs
  `bootstrap.app_settings_hydrate_failed` (a new `LogSubsystem` member
  added this slice) and applies `APP_SETTINGS_DEFAULTS`.
  `architecture.md`'s blocking recovery screen stays deferred to the
  slice that introduces real `app_settings` writes. (The Zod wiring
  landed as a follow-up; 1.6 itself shipped the mirror loosely-typed
  as `unknown[]`, an asymmetry with `entry-metadata.ts`.)

**Resolved developer decisions:** store placement is
domain-vs-infrastructure, not "all stores in `lib/stores`" — domain
working-set stores live in `lib/stores`; infrastructure modules
(`diagnostics`, `toast`, …) own their state in-module. Raw store
handles are exported from their domain files (matching the
`generation.ts` template) but never from the `lib/stores` index; the
index-only public API is the contract, guarded by a boundaries-lint
surface test plus a typecheck fixture.

**Carry-forward for Slice 1.7:** `getAppSettings()` / `getNavigation()`
return live store references (matching the generation store's
`getTxState`); the hydrate-time Zod parse does not freeze them, so
consumers must treat results as read-only until the parsed snapshot is
frozen (deferred) — flagged in
[Slice 1.7 Open questions](./07-ui-shells.md#open-questions).

**Doc-hygiene followups queued** in
[`triage.md`](../../../triage.md): clarify `code-conventions.md`
State-placement re: infrastructure stores; reconcile `architecture.md`
"diagnostics toggles" wording with the gate-vs-mirror split.
