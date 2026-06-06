# Slice 1.5.1 — Gate: schema, types, dispatch, store contract

## Metadata

- **Milestone:** [Milestone 1.5 — Data foundation](../milestone.md)
- **Depends on:** Milestone 1 (shipped) — `lib/db`, `lib/stores`,
  `lib/actions` exist; the generic delta encoder, `applyDeltaAction`,
  `reverse-replay`, and the boundaries / console-ban lint rules are in
  place. No M1.5 slice precedes this one.
- **Blocks:** every M1.5 domain slice (entities, lore-threads,
  happenings, chapters, content). Each consumes the schema, the
  dispatch registration API, the base store factory, and the
  store-mirror contract this slice lands.

## Goal

Land the shared data foundation: the **full relational schema** (all
remaining tables + completion of the three partial ones), the **TS
types for every JSON column** and the **config-table Zod**, the
**delta-dispatch registration API** that lets domain slices add CRUD
without touching shared files, and the **store-mirror contract** plus a
base store factory. After this slice the five domain slices add only
their own store + arms + Zod, in parallel, editing disjoint files.

## Background

M1 shipped 6 tables, 3 of them partial against
[`data-model.md`](../../../../data-model.md#diagram). The v1 model is
now frozen and physically specified, so the rest lands up front (see
[the milestone's Why now](../milestone.md#why-now)). The genuinely new
work here is **not** the table count — `data-model.md` pins columns,
enums, keys, and constraints — it is converting the per-table delta
logic from three hardcoded shared files into a registration API, and
fixing the store-mirror contract, so domain work parallelizes.

Today: `applyDeltaAction` is one `switch (action.kind)`; `registries.ts`
holds one `TARGET_TABLES` + one `COLUMN_SCHEMAS` object; `PipelineAction`
is one union; and `applyDeltaAction` writes **SQLite only** — nothing
mirrors a committed delta into a Zustand working-set store (the
generation store is orchestrator-driven ephemeral run-state, not a
delta-logged domain, so it is not a template). The generic encoder
(`delta-encoding.ts`), the `log_position` MAX+1 assignment, the
`action_id` / `entry_id` threading, and the transaction wrapper are
already table-agnostic and stay as-is.

## Required reading

- [`data-model.md → Diagram`](../../../../data-model.md#diagram) — the
  authoritative table / column / key / constraint source.
- [`data-model.md → Branch model`](../../../../data-model.md#branch-model)
  — composite `(branch_id, id)` PK invariant on branch-scoped tables;
  the branch-copy manifest (this slice does not implement fork, but the
  key shape it lands must satisfy it).
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — `op=update` encoding rule, the `null`-as-sentinel rule, the
  `encoding_version` stamp, and the **hard schema invariants** every
  column Zod must preserve.
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor)
  — why `deltas.entry_id` exists and why `source` must include
  `periodic_classifier`.
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  — the full `app_settings` shape (providers, profiles, assignments,
  `default_story_settings`, `default_calendar_id`,
  `default_suggestion_categories`, embedding pointers, appearance,
  `ui_language`, onboarding, diagnostics, timestamps) this slice
  completes.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — `stories.definition` / `settings` shapes + the cross-field
  constraint, to replace the `Record<string, unknown>` placeholders.
- [`data-model.md → Vault content storage`](../../../../data-model.md#vault-content-storage)
  and [`Assets`](../../../../data-model.md#assets-images--future-media)
  — `vault_calendars` and `assets` (schema-only here).
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  the existing `lib/db/app-settings/` Zod is the pattern to extend.

## Scope: in

**Schema — all remaining relational tables**, declared in
`lib/db/schema.ts` (or a `schema/` split if it grows) matching the
diagram, as one new migration generated via `drizzle-kit`:

- Branch-scoped (composite `(branch_id, id)` PK): `entities`, `lore`,
  `threads`, `happenings`, `character_relationships`, `chapters`,
  `branch_era_flips`, `translations`, `probe_captures`. Link tables,
  each composite `(branch_id, id)` with a surrogate id per the ID-shape
  registry (`hinv_` / `haw_` / `ast_`): `happening_involvements`,
  `happening_awareness` (UNIQUE on its natural key per the diagram),
  `entry_assets`. A natural-key UNIQUE for `happening_involvements` /
  `entry_assets` is **not** mandated — the spec specifies one only for
  awareness; an entry may reference the same asset in two roles, an
  entity may have two involvement roles. Add only if a domain slice
  finds dedup is needed.
- Global (single-column PK): `assets`, `vault_calendars`.
- **CHECK / UNIQUE / INDEX constraints** per
  [milestone C5](../milestone.md#c5--key-shape-and-constraint-encoding):
  happenings mutual-exclusivity; `character_relationships`
  `a_id < b_id` + not-both-null + `UNIQUE(branch_id, a_id, b_id)` +
  the two branch/a, branch/b indexes; `happening_awareness`
  `UNIQUE(branch_id, character_id, happening_id)`; `translations`
  `UNIQUE(branch_id, target_kind, target_id, field, language)`.

**Schema — complete the three partials:**

- `app_settings`: add `embedding_model_id`, `embedding_provider_id`,
  `default_story_settings`, `default_calendar_id`,
  `default_suggestion_categories`, `appearance`, `ui_language`,
  `onboarding_completed_at`, `created_at`, `updated_at` (JSON columns
  default to their empty/seed defaults; the first-init seed extends).
- `branches`: add `classifier_status` JSON column.
- `deltas`: widen `source` enum to include `periodic_classifier`;
  decide `target_table` typing (Open questions).

**Types + config Zod:**

- TS types for every JSON column so DDL `$type<…>()` compiles:
  `EntityState` discriminated union (Character / Location / Item /
  Faction — _types only_; runtime Zod ships in the entities slice per
  [C3](../milestone.md#c3--json-shape-ownership-split)), happenings /
  threads / lore / chapter / relationship / translation / era-flip
  JSON shapes, `probe_captures` payload, `assets` / `entry_assets`
  fields.
- Runtime Zod for the **config** tables completed here: extend
  `lib/db/app-settings/` to the full `app_settings` shape (providers,
  profiles, assignments, `default_story_settings`, suggestion
  categories, embedding pointers, appearance); add
  `stories.definition` / `settings` Zod with the
  `narration ∈ {first,second} → leadEntityId != null` cross-field
  constraint, parsed at load with defaults (matching the existing
  app-settings parse pattern).
- Export all new inferred row + insert types from `lib/db/index.ts`.

**Delta-dispatch registration API**
([C1](../milestone.md#c1--delta-dispatch-registration-api)):

- Replace the `TARGET_TABLES` / `COLUMN_SCHEMAS` literals and the
  `applyDeltaAction` switch with a registry each domain populates from
  its own module: descriptor (table + key columns + optional
  `branchCol`), column Zod map, and create / update / delete op
  handlers. `applyDeltaAction` and `reverse-replay` resolve from the
  registry.
- Add the per-table **store-patcher** slot to the descriptor (C2).
- Migrate the existing `createStoryEntry` / `updateStoryEntryMetadata`
  arms onto the new API as the reference registration; **no behavior
  change** — the 1.5a delta + reverse-replay tests stay green.
- Resolve `PipelineAction` from a per-domain-extensible shape (module
  augmentation or a generic `{ table, op, payload }` envelope) so a
  domain slice adds its action kinds without editing a central union.

**Store-mirror contract + base store factory**
([C2](../milestone.md#c2--store-mirror-contract-delta-driven)):

- A base working-set store factory (in `lib/stores/`) producing the
  domain-store shape: holds the current branch's rows keyed by id,
  exposes read selectors and the internal patch surface, tracks the
  loaded branch, and no-ops a patch for a non-held branch.
- Wire the delta-driven mirror: after the SQLite transaction in the
  action path, the committed delta drives the registered patcher;
  reverse-replay invokes the same patcher with the op inverted.
- A `hydrate(branchId)` entry point on the factory (the trigger that
  fires it is a consumer concern — Open questions).

**Non-delta-logged tables landing as schema only** (types, no arms, no
mutators — mutators land with their consuming UI): `assets`,
`vault_calendars`, `probe_captures`, plus the `branches` / `stories` /
`app_settings` completions above. `vault_calendars.definition` is typed
against the `CalendarSystem` type but its full runtime Zod rides with
`lib/calendar` (its owner), not this slice.

## Scope: out

- **vec0 `embeddings` virtual tables** — physically per-type
  (`entities_vec`, …), retrieval-coupled; deferred to the retrieval
  milestone. The sqlite-vec extension already loads (M1.2); no vector
  tables are created here.
- **Domain stores and CRUD arms** — each domain slice ships its own
  (this slice ships only the factory + API + the migrated `story_entries`
  reference arms).
- **Tier-2 orchestration** — classifier reconcile, chapter-close,
  branch-copy, deep rollback, the `entry_assets` refcount → asset
  trash-can lifecycle and the boot-time trash / orphan GC sweeps. They
  compose Tier-1 arms but encode feature rules; they land with their
  features.
- **Mutators on config tables** — provider / profile / assignment /
  story-settings writes land with settings + wizard UI.
- **Per-kind entity `state` runtime Zod** — types here, Zod in the
  entities slice (C3).
- **Fork / branch-copy** — the composite-PK key shape this slice lands
  must satisfy the manifest, but copy logic is M6.

## Acceptance criteria

- One generated migration applies idempotently on Expo (Android) and
  Electron desktop, creating every relational table in the diagram
  except vec0, with the C5 constraints present.
- `app_settings`, `branches`, `deltas` match their full specced
  columns / enums; the first-init seed populates new `app_settings`
  JSON defaults.
- `lib/db/index.ts` exports inferred row + insert types for all new
  tables; `stories.definition` / `settings` are typed (no
  `Record<string, unknown>`), parsed with defaults at load, and the
  `narration → leadEntityId` cross-field constraint rejects an invalid
  shape.
- The dispatch registration API is in place; the migrated
  `story_entries` arms register through it and all existing 1.5a delta /
  reverse-replay tests pass unchanged.
- A fixture domain registers a table + column Zod + op handlers + a
  store-patcher **without editing `applyDeltaAction`, `registries.ts`,
  or a central union**, and a create / update / delete roundtrips
  through dispatch, reverse-replay, and the store patch.
- Store-mirror: a committed delta patches the held-branch store; a
  delta for a non-held branch no-ops; reverse-replay reverses the
  patch — each tested.
- `deltas.source` accepts `periodic_classifier`; `DeltaSource` /
  `MutationSource` in `lib/actions/types.ts` updated accordingly.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, full vitest pass.

## Tests

- **Migration apply.** Apply the committed migration to a fresh
  in-memory DB; assert every expected table + the C5 constraints exist.
- **Constraint negatives** (one each): happenings with both
  `occurred_at_entry_id` and `temporal` set; `character_relationships`
  with `a_id ≥ b_id` and with both `kind` / `inverse_kind` null;
  duplicate `happening_awareness` `(branch, character, happening)`;
  duplicate `translations` `(branch, target_kind, target_id, field,
language)` — each rejected.
- **Config Zod.** `stories.definition` parse with defaults; the
  cross-field constraint rejects `narration:'first'` + null
  `leadEntityId`; `app_settings` full-shape parse + defaults.
- **Dispatch parity.** The migrated `story_entries` arms produce
  byte-identical deltas + reverse-replay results to pre-refactor
  (regression-lock against the existing tests).
- **Registration fixture.** A throwaway fixture domain exercises the
  API end-to-end (register → create/update/delete → reverse-replay →
  store patch) touching no shared file.
- **Store factory.** Patch on commit; no-op patch for non-held branch;
  reverse patch on reverse-replay; selector reads.
- **Public-API surface.** New types reachable only via `lib/db/index.ts`
  / `lib/stores` index; raw handles stay internal (extends the existing
  boundary fixtures).

## Open questions

_All resolved during planning / implementation — see Implementation
notes._

## Implementation notes

- **`deltas.target_table` stays free `text()`** validated by the runtime
  registry — no Drizzle enum. An enum would re-couple every new
  delta-logged table to the schema, defeating the gate's decoupling.
- **`PipelineAction` extensibility uses a module-augmented
  `PipelineActionMap`.** Each domain adds its kinds via
  `declare module '@/lib/actions/action-map'` in its own file;
  `PipelineAction` is the derived union; the old dispatch `switch` is
  replaced by a registry lookup (`resolveByActionKind`). Emission-site
  discriminated-union narrowing is preserved.
- **Store-mirror is action-layer-owned.** `applyDeltaAction` and
  `reverseReplayDeltas` invoke the registered table's patcher _after_
  `runInTransaction` (post-commit, both directions); the store
  branch-guards, so a patch for a non-held branch no-ops. Orchestrator,
  recovery, and `abortRun` call sites are unchanged.
- **Registration bootstrap is an append-only
  `lib/actions/delta/registrations.ts`** (`registerAllDomains`,
  idempotent `done` guard), called at the top of `runBootstrap` (before
  recovery drives reverse-replay) and via a vitest `setupFiles` entry on
  the `unit` project (so the 1.5a parity-lock tests register without
  being edited). A domain slice's only shared touch is one append line
  here; `register` / `resolveBy*` / `__resetRegistry` stay intra-module,
  only `registerAllDomains` and the `StorePatch` type are public.
- **`MutationSource` was removed** (dead, zero consumers) — there is one
  delta `source` concept, `DeltaSource`, widened with
  `periodic_classifier`. The AC line reading "`MutationSource` updated"
  is satisfied by the removal.
- **`app_settings.default_story_settings` is `Partial<StorySettings>`**
  (a copy-at-creation source, `data-model.md` Story-defaults), parsed
  with `storySettingsSchema.partial()`, column typed
  `$type<Partial<StorySettings>>`, default `{}`. `storySettingsSchema`
  defaults _only_ the data-model-pinned fields; the rest stay required —
  no fabricated frozen-spec values. `app_settings.created_at` /
  `updated_at` are `notNull` with a SQL `(unixepoch() * 1000)` default.
- **C4 template: a domain's `delete` handler must capture the FULL row
  in `undoPayload`** — reverse-replay rebuilds both the SQLite re-insert
  and the store create-patch from it. The fixture and store-mirror
  delete handlers are the reference; `story_entries` ships create /
  update only.
- **Deferred (resolved):** the migration is committed as `drizzle-kit`
  emits it (no hand-edits; `$type` narrowings change no SQL, so the
  snapshot stays in sync); `hydrate(branchId, rows)` ships unwired — the
  boot / navigation trigger is a first-consumer (M2+) concern.
- **Cross-cutting follow-ups this slice surfaced** are queued in
  [`triage.md`](../../../triage.md): two config-default vs data-model
  reconciliations, the stale `delta-log-row.tsx` `DeltaSource` union,
  the boot registration-ordering test gap, and a pre-existing storybook
  flake.
