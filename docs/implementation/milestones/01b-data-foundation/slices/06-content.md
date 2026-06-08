# Slice 1.5.6 — Content (entry assets & translations)

## Metadata

- **Milestone:** [Milestone 1.5 — Data foundation](../milestone.md)
- **Depends on:** [Gate](./01-gate.md) — `entry_assets` /
  `translations` DDL (+ `assets` schema), dispatch API, store factory,
  store-mirror contract.
- **Blocks:** nothing in M1.5 (parallel). Consumed by asset surfaces
  (M4 / M9) and the translation pipeline (M8).

## Goal

Make `entry_assets` and `translations` live, reversible domains:
stores, Tier-1 CRUD arms through the dispatch API, and their column
Zod. (`assets` is gate schema-only.)

## Background

This is the **lowest near-term parallelism value** domain — its
consumers are far out (assets M4 / M9, translations M8) — but the
tables and arms complete the "schema in full" goal and exercise two
patterns worth landing early: the **polymorphic translation target**
and the **delta-logged link table**. Per
[`data-model.md → Translation`](../../../../data-model.md#translation),
`translations` stores LLM-authored-content translations against a
polymorphic `(target_kind, target_id, field)` with a per-language
runtime index `Map<(kind, id, field, lang), string>` for O(1) render
lookup — a **different store shape** from the generic keyed-by-id
working set, so it likely extends rather than uses the base factory.
Per [`data-model.md → Assets`](../../../../data-model.md#assets-images--future-media),
binary lives on disk; `assets` holds only metadata and `entry_assets`
binds entries to assets (shared across branches by reference). This
slice ships the link/translation CRUD only — the asset file lifecycle
and the translation pipeline are out.

## Required reading

- [`data-model.md → Translation`](../../../../data-model.md#translation)
  — polymorphic target, the UNIQUE, delta participation + the survival
  anchor (content-defining-delta anchor), the runtime index.
- [`data-model.md → Assets`](../../../../data-model.md#assets-images--future-media)
  — disk-external storage, share-by-reference, the trash-can pattern
  (out of scope here, but explains why `assets` is schema-only).
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — `entry_assets` is delta-logged; `translations` deltas reverse
  atomically-when-present with their source.

## Scope: in

- **`entry_assets`** Zod + store + CRUD arms (composite
  `(branch_id, id)`, `id` = the `ast_` surrogate already in the
  ID-shape registry, + `entry_id`, `asset_id`, `role`, `position`).
  Create / update / delete write row + delta; store patch.
- **`translations`** Zod + CRUD arms (`target_kind`, `target_id`,
  `field`, `language`, `translated_text`; `UNIQUE(branch_id,
target_kind, target_id, field, language)`). Store as the per-language
  index `Map<(kind, id, field, lang), string>` (extends / wraps the
  base factory for composite-key lookup) with read selectors for
  render-time fallback-to-source.
- **Tests** per [milestone C4](../milestone.md#c4--domain-slice-template).

## Scope: out

- **`assets` table is schema-only** (landed in gate). Its trash-can /
  `pending_delete_at` lifecycle, refcount-driven trashing on
  `entry_assets` removal, file rename to `.trash`, boot-time trash
  sweep, and orphan GC are **Tier-2 orchestration coupled to file
  I/O** — M4 / M9. The `entry_assets` delete arm here writes the link
  delta only; it does **not** drive asset trashing.
- **Translation pipeline** — `user-action-translation`,
  `display-translation`, the `translation-retry` pipeline, the
  graceful-degradation contract, the survival-anchor content-delta
  stamping logic (M8). This slice ships the row CRUD + index, not the
  writer or the anchor-selection.
- **Asset / translation UI** (M4 / M8).

## Acceptance criteria

- `entry_assets` / `translations` Zod parse their specced shapes;
  `translations` UNIQUE rejects a duplicate `(branch, kind, id, field,
lang)`.
- `entry_assets` CRUD writes row + delta and patches the store;
  reverse-replay reverses both.
- `translations` CRUD maintains the per-language index; a lookup miss
  falls back to source (selector returns null/undefined for an absent
  `(kind, id, field, lang)`).
- Non-held-branch write no-ops against the store.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, vitest pass.

## Tests

- **Zod + UNIQUE.** Parse rows; duplicate-translation rejection.
- **`entry_assets` CRUD + undo + store patch**, reverse-replay restore.
- **Translation index.** Insert / update / delete maintain the
  `(kind, id, field, lang)` map; selector hit + miss-fallback.

## Open questions

- **Translation store vs base factory** — the composite-key index
  doesn't fit the keyed-by-id factory; either extend the factory with a
  pluggable key, or ship a bespoke translation index store. Decide at
  authoring.
- **Deferral (decided: build it).** This slice ships its CRUD in M1.5.
  Noted only as a contingency: it carries the least near-term value
  (consumers are M4 / M8), so if later scope pressure hits, it's the
  natural trim point — the `assets` / `entry_assets` / `translations`
  **tables** still land in the gate regardless; only the stores + arms
  here would slip.

## Implementation notes

- **Translation store is a bespoke wrapper; the gate factory is untouched.**
  `lib/stores/translations/` wraps a private id-keyed
  `createWorkingSetStore<Translation>()` and maintains a derived
  `Map<(kind, id, field, lang) → text>` render index, rebuilt from the
  base rows after each `patch` / `hydrate`. An id-keyed primary is
  mandatory, not optional: reverse-replay of a `create` emits a store
  patch carrying only the `tr_` id, so a composite-keyed-only store
  cannot service delete-by-id. Generalizing the factory with a pluggable
  key was rejected (YAGNI — translations is the only composite-index
  consumer). Rebuild-from-base-rows (vs. incremental index updates)
  auto-inherits the base store's branch guard; incremental updates are a
  deferred optimization.
- **Render reactivity is deferred to M8.** The store ships a synchronous
  `getTranslation(kind, id, field, lang)` selector (O(1) via the index;
  `undefined` on miss → caller falls back to source). A reactive
  `useTranslation` subscription is out of scope here (it lands with the
  `display-translation` reader in M8).
- **`translatedText` is required non-empty at the write boundary**
  (`z.string().min(1)`) though the DDL column is nullable — failed
  translations write no row, so a row that exists always has text.
- **`entry_assets` ships no asset lifecycle.** Its delete arm writes the
  link delta only; asset trashing / refcount / GC stays in M4 / M9.
