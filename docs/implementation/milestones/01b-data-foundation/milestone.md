# Milestone 1.5: Data foundation

> Inserted between [Milestone 1 — Spine](../01-spine/milestone.md) and
> the (provisional) M2 — First user loop. Numbered **1.5** rather than
> renumbering M2–M9, which are still pre-author roadmap entries; see
> [`roadmap.md`](../../roadmap.md). Its slices are referenced by name
> (gate, entities, …) rather than the awkward `1.5.N` triple.

## Goal

Land the backing data structure the rest of the app builds on: the
**full relational schema** (every story-domain table, plus completing
the three partial ones M1 shipped as skeletons), the **typed
working-set stores**, and the **Tier-1 CRUD action arms** (per-domain
create / update / delete, delta-logged). After this milestone every
feature milestone builds pure feature logic against a complete, stable
substrate, and multiple feature milestones' slices can be developed in
parallel without colliding on schema migrations or the shared
delta-dispatch surface.

## Why now

M1 shipped the spine with a deliberately skeletal schema — 6 of ~20
tables, and 3 of those 6 partial against their own spec
([`data-model.md → Diagram`](../../../data-model.md#diagram)):
`app_settings` is missing ~9 columns, `branches` lacks
`classifier_status`, `deltas.source` lacks `periodic_classifier`.
The original plan deferred the rest to the milestones that consume each
table (entry layer in M2, entities / lore / happenings / awareness in
M3, chapters in M5, branch schema in M6, …). That skeleton-first call
was correct **while the model was still being stress-tested**; its
stated rationale (Slice 1.2 Background) was "don't lock column shapes
before implementation exercises them."

That rationale has now lapsed: the v1 data model is **frozen** (changes
only if implementation discovers a genuine defect), and
`data-model.md` pins the schema to high physical fidelity — column
types, enums, composite PKs, FK directions, and the CHECK / UNIQUE /
INDEX constraints are all specified. Two further facts make pulling the
schema forward cheap and high-value:

- **We are pre-v1 with no production data.** Migrations are additive
  and effectively free; the "migration churn" the skeleton approach
  hedged against is velocity friction, not data risk, and a frozen
  model produces little churn.
- **The schema and the delta-dispatch layer are the real
  collision points** for parallel feature work. A frozen, fully-typed
  schema removes migration-ordering collisions and gives every
  downstream slice the inferred row types instead of the
  `Record<string, unknown>` placeholders M1 left on
  `stories.definition` / `settings`. And the three shared
  delta-dispatch files (`applyDeltaAction`'s switch, `registries.ts`,
  the `PipelineAction` union) become per-milestone merge hotspots
  unless their per-table content is centralized behind a registration
  API up front — which is this milestone's load-bearing architectural
  job, not the table count.

## Narrative / overview

The milestone is **gate-then-fan-out**, the same shape as M1. One gate
slice lands everything shared; the domain slices then run fully in
parallel because the gate fixed every surface they would otherwise
contend on.

The **gate slice** does three things. First, the full schema: all ~14
missing relational tables and the completion of the three partials, as
one migration, with the inline CHECK / UNIQUE / INDEX constraints the
data-model pins, plus the TS types for every JSON column (so the DDL's
`$type<…>()` annotations compile) and the runtime Zod for the
**config** tables it completes (`app_settings`, `stories.definition` /
`settings`). Second — and this is the part that converts "parallel
feature dev" from aspiration to mechanism — it **generalizes
delta-dispatch from hardcoded switch / registry / union into a
per-domain registration API**, so a domain slice registers its table
descriptor, its column Zod, and its op handlers in its own file and
touches no shared file. Third, it establishes the **store-mirror
contract** (how a delta-logged write reaches the in-memory working set)
plus a base store factory each domain slice instantiates.

The **domain slices** (entities; lore + threads; happenings +
knowledge; chapters + era flips; content) each deliver one thing: their
working-set store, their Tier-1 CRUD arms registered through the gate's
API, the domain's column Zod, and tests — with no edits to shared
files. They differ only in size and constraint weight (entities carries
the four per-kind `state` shapes; happenings carries the UPSERT-merge
and the CHECK / UNIQUE constraints).

What is **deliberately out**: the vec0 `embeddings` virtual tables
(physically per-type, intertwined with retrieval; deferred to the
retrieval milestone as already planned — the sqlite-vec _extension_
already loads); all **Tier-2 orchestration** (classifier reconcile,
chapter-close, branch-copy, deep rollback — these compose the Tier-1
arms but encode their feature's rules and need that feature's
pipeline / prompt context); and **domain mutators on the completed
config tables** (provider / profile / settings writes land with their
settings + wizard UI). What changes from "before" to "after": the app
goes from "spine + 6 skeleton tables" to "complete typed data layer
with working-set stores and reversible CRUD for every story-domain
table," and M2+ stop carrying schema slices.

## Slices

Land as authored; one file per slice under `./slices/`. The gate gates
everything; the five domain slices are mutually independent after it.

1. **Gate — [schema, types, dispatch, store contract](./slices/01-gate.md).**
   Full schema migration (all relational tables + complete the three
   partials + CHECK / UNIQUE / INDEX constraints); TS types for every
   JSON column; config-table Zod (`app_settings`, `stories`); the
   delta-dispatch registration API replacing the switch / registry /
   union; the store-mirror contract + base store factory;
   `deltas.source += 'periodic_classifier'` and the `DeltaSource` /
   `target_table` widening. Carries the non-delta-logged tables that
   are pure schema (`assets`, `probe_captures`, `vault_calendars`,
   plus `branches` / `stories` / `app_settings` completion) — types
   only, no arms, no mutators.

2. **Entities (World).** `entities` store + CRUD arms; the four per-kind
   `state` Zod shapes (Character / Location / Item / Faction) registered
   for delta encoding. _Out:_ `LocationState.parent_location_id`
   cycle-guard (M4 orchestration).

3. **Lore & threads.** `lore`, `threads` stores + CRUD arms (injection
   modes, `keywords`, `priority`, status enums).

4. **Happenings & knowledge.** `happenings`, `happening_involvements`,
   `happening_awareness`, `character_relationships` stores + CRUD arms,
   including the UPSERT-merge + canonical `a_id < b_id` ordering +
   the CHECK / UNIQUE constraints. The constraint-heavy slice.

5. **Chapters & era flips.** `chapters`, `branch_era_flips` stores +
   CRUD arms.

6. **Content.** `entry_assets`, `translations` stores + CRUD arms
   (`assets` table is gate schema-only; its trash-can / refcount /
   GC lifecycle is Tier-2, deferred to its consumers). Lowest
   near-term parallelism value — its consumers (assets M4 / M9,
   translations M8) are far out; deferrable if the milestone needs
   trimming.

## Dependency graph

```
gate ─┬→ entities
      ├→ lore-threads
      ├→ happenings
      ├→ chapters
      └→ content
```

- **gate** gates all five domain slices: each consumes the schema, the
  registration API, the store factory, and the store-mirror contract.
- The five domain slices have **no inter-dependencies** — they edit
  disjoint files (their own store + their own registration module) by
  construction. This is the whole point of centralizing the shared
  surface in the gate.

## Slice contracts

Domain slices author in parallel against fixed boundaries, so the
cross-slice contracts are pinned here (doc-as-contract, not
sequencing). The gate slice's planning pass finalizes the exact
signatures; this section fixes the shape.

### C1 — Delta-dispatch registration API

Today three shared files carry per-table delta logic:
`applyDeltaAction`'s `switch (action.kind)`, `registries.ts`
(`TARGET_TABLES` / `COLUMN_SCHEMAS`), and the `PipelineAction` union.
The gate replaces them with a **per-domain registration** surface:
each domain registers, in its own module, (a) a target-table
descriptor (table ref + key columns — see C5 for the composite-key and
link-table cases), (b) the column Zod schemas for its JSON columns
(consumed by the generic `computeUndoPayload` / `applyUndoPayload`
encoder, which is already table-agnostic), and (c) its create / update /
delete op handlers. `applyDeltaAction` dispatches through the registry;
reverse-replay resolves the descriptor from the registry. No domain
slice edits a file another domain slice edits. The generic encoder
(`delta-encoding.ts`), `log_position` assignment, `action_id` /
`entry_id` threading, and the transaction wrapper are unchanged — they
are already generic.

### C2 — Store-mirror contract (delta-driven)

A delta-logged write reaches the in-memory working set **through the
committed delta, not the action arm**. After the SQLite transaction,
the delta description (`target_table` + `target_id` + `op` +
row / payload) drives an in-memory patch via a per-table store-patcher
registered alongside the table descriptor (C1).
**Reverse-replay reuses the same patcher with the op inverted**, so
forward apply and undo keep the store consistent through one mechanism
(this is why the mirror is delta-driven rather than written inline in
each arm: reverse-replay already operates generically on SQLite via the
table descriptors, and must stay generic for the store too). Patching
is **branch-scoped**: a write targeting a branch the store is not
currently holding (e.g. a background classifier write to a non-active
branch) no-ops against the in-memory set. Reads come from the store;
the working set is the current branch's rows, hydrated on branch-open.
The alternative (re-read-from-SQLite after each commit) was rejected:
it re-queries on every undo and opens staleness windows, and it would
fork the forward / reverse paths.

### C3 — JSON-shape ownership split

The gate provides the **TS types** for every JSON column (so the DDL's
`$type<…>()` compiles) and the **runtime Zod** for the config tables it
completes (`app_settings` config, `stories.definition` / `settings`).
Each **domain slice** provides the **runtime Zod** for its own table's
JSON columns and registers them for delta encoding (C1). Example: the
gate types `entities.state` as the `EntityState` discriminated union;
the entities slice ships the Character / Location / Item / Faction Zod
and registers it. The encoder's
[hard schema invariants](../../../data-model.md#entry-mutability--rollback)
(record value-types non-nullable; no `z.optional()` stacked over
`z.nullable()`) bind every column Zod a domain slice lands.

### C4 — Domain-slice template

Every domain slice delivers exactly: (1) a working-set store built via
the gate's base store factory, exposing read selectors and the
internal write surface the patcher (C2) calls — **no speculative public
mutators**; (2) Tier-1 create / update / delete arms registered through
C1; (3) the domain's column Zod (C3); (4) vitest covering insert /
query roundtrip, op=update undo-payload encode + reverse-replay
restore, and the store patch for each op. A domain slice edits only its
own files.

### C5 — Key-shape and constraint encoding

Branch-scoped tables use composite `(branch_id, id)` PKs per
[`data-model.md → Branch model`](../../../data-model.md#branch-model);
the descriptor (C1) carries `branchCol` for these. Two cases the gate's
descriptor shape must accommodate, both **open questions** resolved at
gate-slice authoring:

- **Every delta-logged table has a single surrogate `id`** —
  resolved in the canonical doc. The delta `target_id` is one TEXT
  column and reverse-replay resolves a row by it, so every
  delta-logged link table needs a single id, not just a composite
  natural key. `character_relationships` (`rel_`) and `entry_assets`
  (`ast_`) already had one; `happening_involvements` (`hinv_`) and
  `happening_awareness` (`haw_`) were missing it (the ID-shape section
  had wrongly listed them as id-less composite tuples while
  `deltas.target_table` logs them) — corrected in
  [`data-model.md → ID shape`](../../../data-model.md#id-shape--kind-prefixed-uuids-throughout).
  So the gate just lands what the diagram now shows: each branch-scoped
  link table is composite `(branch_id, id)` with its natural key kept
  as a `UNIQUE` backstop (below). No composite-`target_id` handling
  needed in the descriptor.
- **CHECK / UNIQUE constraints** the gate must encode in DDL:
  `happenings` mutual-exclusivity
  (`CHECK (occurred_at_entry_id IS NULL OR temporal IS NULL)`);
  `character_relationships` (`CHECK (a_id < b_id)`,
  `CHECK (kind IS NOT NULL OR inverse_kind IS NOT NULL)`,
  `UNIQUE (branch_id, a_id, b_id)`);
  `happening_awareness` `UNIQUE (branch_id, character_id, happening_id)`;
  `translations` `UNIQUE (branch_id, target_kind, target_id, field, language)`.
  These are DB backstops; the application write path is the primary
  enforcement (e.g. the relationship `normalizeForWrite` canonical
  ordering).

## Definition of done

- One migration applies idempotently on Expo (Android) and Electron
  desktop, creating every relational table in
  [`data-model.md → Diagram`](../../../data-model.md#diagram) **except**
  the vec0 `embeddings` virtual tables, and completing `app_settings`,
  `branches`, and `deltas` to their full specced columns / enums.
- `lib/db` exports inferred row + insert types for every new table, and
  `stories.definition` / `settings` are typed (not
  `Record<string, unknown>`).
- The delta-dispatch registration API (C1) is in place; a fixture
  domain registers and dispatches through it without editing a shared
  file. The legacy `createStoryEntry` / `updateStoryEntryMetadata`
  paths are migrated onto it with no behavior change (existing 1.5a
  tests stay green).
- The store-mirror contract (C2) is implemented: a CRUD arm patches its
  store on commit, reverse-replay reverses the patch, and a write to a
  non-held branch no-ops against the store — each covered by a test.
- Every delta-logged domain table (entities, lore, threads, happenings,
  happening_involvements, happening_awareness, character_relationships,
  chapters, branch_era_flips, entry_assets, translations) has create /
  update / delete arms with insert/query + undo-payload + reverse-replay
  - store-patch tests.
- `character_relationships` UPSERT-merge across two POV writes produces
  one canonically-ordered row (the data-model worked example);
  `happening_awareness` re-write UPSERTs rather than duplicating.
- All CHECK / UNIQUE constraints in C5 are present and a violation is
  rejected (one negative test each).
- `pnpm lint` (boundaries + console ban), `pnpm typecheck`,
  `pnpm lint:docs`, and the full vitest suite pass on every slice's PR.
- The roadmap's downstream schema-landing clauses are removed and
  point here (done at milestone-authoring time — the M2 / M3 / M5 / M6 /
  M7 entries and the "gate-and-schema slice" framing were repointed).

## Open questions

- **`entry_assets` key shape** — surrogate `id` vs composite link key
  in the dispatch descriptor (C5). Resolve in the gate slice.
- **`deltas.target_table` typing** — keep as free `text()` validated by
  the C1 registry (only registered tables are valid targets), or
  tighten to a Drizzle enum. The registry already constrains valid
  targets at runtime; the enum adds a DB backstop at migration cost.
  Decide in the gate.
- **Store working-set hydration trigger** — C2 fixes "hydrate on
  branch-open"; the exact boot / navigation hook that fires it, and
  whether large branches hydrate eagerly or lazily per type, is a
  domain-slice-time refinement (the first real reader of a domain store
  lands in M2+, so the trigger may be stubbed here and wired by the
  consumer). Not a milestone blocker.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
