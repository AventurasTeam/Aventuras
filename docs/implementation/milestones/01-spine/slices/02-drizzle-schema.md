# Slice 1.2 — Drizzle and minimal schema

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** [Slice 1.1](./01-code-conventions.md) — `lib/*`
  public-API rule must be active so `lib/db/` lands under it from
  the first commit.
- **Blocks:** 1.3, 1.4, 1.5, 1.6, 1.7. Observability needs
  `app_settings` for the diagnostics gate; the pipeline writes to
  `pipeline_runs`; stores hydrate from schema-shaped types; UI
  shells render against the schema.

## Goal

Land the database layer as `lib/db/`, the first `lib/*` module
under Slice 1.1's discipline. Drizzle ORM is set up with
expo-sqlite, the migration toolchain is in place, the
sqlite-vec extension loads at SQLite client init (no vector
tables created yet), and the minimal set of tables for
milestone 1 is declared and migrated. By the end of the slice
every downstream module can import a typed `db` client from
`lib/db` and query the milestone-1 tables.

## Background

The full v2 schema is large (eighteen-plus tables in
`docs/data-model.md`). Milestone 1 only renders a handful of
surfaces (story list, reader-composer, settings screens) and
exercises the pipeline against a stub LLM, so only the tables
those surfaces touch land in this slice. Other tables (entities,
lore, threads, happenings, chapters, deltas, translations,
embeddings, probe_captures, etc.) defer to the milestones that
actually consume them, landing via incremental migrations.

The skeleton-schema approach is deliberate: full upfront
translation of data-model.md into Drizzle locks in column shapes
before implementation stress-tests them, and would put us in
migration-churn during the rapid early slices. Skeleton-first
keeps the schema flexible while the dependency graph is being
exercised for the first time.

sqlite-vec is included in this slice for the extension wiring
only — the loader runs at SQLite client init on both platforms.
Vector tables (vec0 virtual tables for embeddings) defer to the
memory-pipeline milestone that needs them. Bundling the extension
loader now avoids retrofit pain across Electron and Android
packaging.

## Required reading

- [`docs/data-model.md` → Diagram](../../../../data-model.md#diagram)
  — the schema source of truth; the tables this slice declares
  mirror their shapes here.
- [`docs/data-model.md` → App settings storage](../../../../data-model.md#app-settings-storage)
  — singleton row, JSON-heavy convention; defines providers,
  profiles, assignments shapes.
- [`docs/data-model.md` → Story identity fields](../../../../data-model.md#story-identity-fields)
  — the `stories` table's column set.
- [`docs/data-model.md` → Branch model](../../../../data-model.md#branch-model)
  — the `branches` table's column set.
- [`docs/data-model.md` → Entry metadata shape](../../../../data-model.md#entry-metadata-shape)
  — the `story_entries.metadata` JSON shape.
- [`docs/observability.md` → Gating model](../../../../observability.md#gating-model)
  — the `app_settings.diagnostics.*` paths the singleton must
  store from this slice onward.
- [`docs/generation-pipeline.md` → Crash recovery via pipeline_runs marker table](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table)
  — canonical `pipeline_runs` table shape; this slice ships the
  table, slice 1.5 ships the recovery pass that uses it.

## Scope: in

- Add Drizzle dependencies to the project: `drizzle-orm`,
  `drizzle-kit`, the `drizzle-orm/expo-sqlite` integration, and
  the sqlite-vec runtime package(s) appropriate for Electron and
  Expo / Android.
- Configure `drizzle.config.ts` (or equivalent) for SQLite +
  migrations under `lib/db/migrations/`.
- Create `lib/db/` as the first `lib/*` module:
  - **Internal files** (relative-import freely within the
    module): `schema.ts` (or `schema/` if it grows), `client.ts`
    (Drizzle client + sqlite-vec extension load), `migrate.ts`
    (migration runner), `types.ts` (inferred Drizzle types).
  - **Public API in `index.ts`**: the `db` client; table
    references (`stories`, `branches`, `storyEntries`,
    `appSettings`, `pipelineRuns`); inferred row + insert types
    (`Story`, `Branch`, etc.); the `useDbMigrations()` startup
    hook. Generic drizzle hooks like `useLiveQuery` are imported
    directly from `drizzle-orm/expo-sqlite` by consumers — they
    operate on query objects built from this module's `db` and
    don't need re-export.
- Declare the milestone-1 tables in `schema.ts` matching
  `data-model.md` for the columns specced there:
  - `stories` — full per spec (id, title, description, tags
    JSON, cover_asset_id FK, accent_color, status, favorite,
    last_opened_at, definition JSON, settings JSON, created_at,
    updated_at, current_branch_id FK).
  - `branches` — full per spec (id, story_id FK, parent_branch_id
    FK, fork_entry_id, name, created_at).
  - `story_entries` — full per spec (id, branch_id FK, position,
    kind, content, chapter_id FK nullable, metadata JSON,
    created_at).
  - `app_settings` — singleton row keyed on `id = 'singleton'`,
    JSON columns for providers, profiles, assignments,
    default_provider_id, and a `diagnostics` JSON object with at
    minimum `enabled: boolean` (default false) and
    `debug_level_enabled: boolean` (default false). Other
    `app_settings.*` JSON fields can land as empty defaults.
  - `pipeline_runs` — per
    [`docs/generation-pipeline.md` → Crash recovery via pipeline_runs marker table](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table).
    Columns: `run_id` TEXT PK, `kind` TEXT NOT NULL, `action_id`
    TEXT NOT NULL, `story_id` TEXT NULL, `started_at` INTEGER
    NOT NULL, `finished_at` INTEGER NULL, `outcome` TEXT NULL
    (`'completed' | 'aborted' | 'failed' | 'recovered'`).
    In-flight rows are encoded by `finished_at IS NULL` — no
    `'in_flight'` outcome value. The crash-recovery pass that
    reads this table lands in slice 1.5 alongside the
    orchestrator; this slice ships the table schema only.
- Generate initial migration via `drizzle-kit`, commit the
  generated SQL under `lib/db/migrations/`.
- Wire `useDbMigrations()` on app startup for both targets:
  on native the hook gates first render via drizzle's
  `useMigrations`; on desktop the Electron main process applies
  migrations at its own startup so the renderer hook returns
  success. Migrations run idempotently; subsequent starts are
  no-ops.
- Load the sqlite-vec extension at SQLite client init: on native
  (`client.ts`) via `withSQLiteVecExtension` config plugin and
  `loadExtensionAsync`; on desktop the extension loads in the
  Electron main process (`node:sqlite` + sqlite-vec loadable), with
  the renderer reaching the DB via Drizzle's `sqlite-proxy` over
  IPC. Verify on both targets that `vec_version()` returns without
  error.
- _(No data-model.md update required — `pipeline_runs` is
  canonically specced in `docs/generation-pipeline.md`.)_

## Scope: out

- All other tables from `docs/data-model.md`: entities, lore,
  threads, happenings, chapters, deltas, translations,
  embeddings, probe_captures, character_relationships,
  branch_era_flips, happening_involvements, happening_awareness,
  assets, entry_assets. Each lands with the milestone that
  consumes it.
- Vector (`vec0`) virtual tables. sqlite-vec is loaded as a
  runtime extension; no embedding tables are created. That lands
  with the memory-pipeline milestone.
- Seed data beyond the `app_settings` singleton's defaults. An
  empty Stories list is the expected milestone-1 starting state.
- Drizzle Studio / dev-tools setup. Out of scope; can be added
  in a follow-up if useful.
- React Query / TanStack QueryClient setup. That belongs in
  Slice 1.6.

## Acceptance criteria

- `lib/db/` module exists under the public-API discipline; only
  `index.ts` is reachable from outside the module.
  `eslint-plugin-boundaries` from Slice 1.1 verifies this is the
  first real test of the rule, and the rule fires correctly
  against a deliberate deep-import violation in a test fixture.
- `drizzle-orm`, `drizzle-kit`, and sqlite-vec runtime
  dependencies installed and locked.
- `schema.ts` declares the five tables matching their data-model
  spec.
- Initial migration generated, committed, runs idempotently on
  app start on both Expo (Android emulator) and Electron desktop.
- sqlite-vec loads on native (expo bundled extension) and on
  desktop (Electron main `node:sqlite` `loadExtension`);
  `vec_version()` returns on both.
- The `app_settings` singleton row exists after first startup
  with `diagnostics.enabled = false` and
  `diagnostics.debug_level_enabled = false` as defaults.
- `lib/db/index.ts` exports the `db` client, all five table
  references, inferred row types, and the `useDbMigrations()`
  startup hook.
- `pnpm lint` passes (boundaries rule clean).
- `pnpm lint:docs` passes (the data-model.md addition for
  `pipeline_runs` doesn't break anchor links).
- Vitest tests pass: schema apply + tear-down, insert + query for
  each table, public-API surface check (fixture file outside
  `lib/db/` imports only via `index.ts`).

## Tests

- **Migration apply.** Vitest applies the committed migration
  folder to a fresh in-memory `node:sqlite` database (via
  `drizzle-orm/sqlite-proxy`'s migrator), asserting the five
  tables exist with the expected columns.
- **Insert + query roundtrip per table.** One test per table that
  inserts a representative row and queries it back, asserting
  Drizzle's inferred types match.
- **`app_settings` defaults.** On first init, the singleton row
  is created with diagnostics flags = false.
- **Public-API surface.** A fixture file outside `lib/db/`
  imports `db`, table references, types, and `migrate` from
  `lib/db` (the public path). A separate fixture deliberately
  tries to deep-import `lib/db/schema` and is expected to fail
  lint — this is the first real validation of Slice 1.1's
  boundaries rule.
- **sqlite-vec smoke.** Cross-platform integration check (`pnpm
desktop` + Expo Android run); `vec_version()` returns without
  error. Probably manual rather than automated for this slice.

## Open questions

- **sqlite-vec cross-platform packaging.** RESOLVED in planning:
  native uses the expo bundled extension (`withSQLiteVecExtension`
  config plugin); desktop uses Electron-main `node:sqlite` +
  sqlite-vec loadable extension over `sqlite-proxy` IPC (expo-sqlite
  web/WASM cannot host sqlite-vec). drizzle-orm 0.45.2 ships no
  node-sqlite driver, so `sqlite-proxy` is the adapter wrapping
  `node:sqlite` on desktop and in Vitest.
- **`pipeline_runs` shape evolution.** This slice introduces the
  table; slice 1.5 is its first real consumer and may surface
  fields not anticipated here (per-phase timings? error stack
  traces?). Treat the schema as v0 — additive migrations from
  slice 1.5 are expected and fine.
- **`lib/db/migrations/` formatting and commit policy.** Drizzle
  generates SQL files; agree at authoring time whether to format
  them with prettier or leave them as-emitted (prettier on
  generated SQL is debatable — risks reordering whitespace in
  ways that change semantics, though unlikely for typical SQL).
- **Migration runner placement on Expo.** Running `migrate()` in
  the root `_layout.tsx` effect blocks the first render until
  migrations finish. Acceptable for milestone 1 (no real data,
  fast); future loading-state UX is a later concern.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
