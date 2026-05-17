# Deltas substrate — `undo_payload` encoding, chain index, version stamp

Resolves two `followups.md` entries previously tracked there,
removed by the commit that lands this exploration:

- `undo_payload encoding for nested fields`
- `composite index — deltas (branch_id, target_id, log_position)`

Both items live in the `deltas` substrate and share contracts: the
encoding fixes what `undo_payload` looks like; the index makes the
chain query that consumes those payloads (rollback + the
[delta diff cache walk](../architecture.md#delta-history-diff-resolution))
fast at v1 scale; the version stamp (added pre-emptively from this
session) reserves an apply-time dispatch slot for future schema
evolution.

## Decision

- **Encoding**: nested-partial mirror of the row's column structure.
  Top-level keys are column names; for JSON columns, the value is
  itself a nested partial populated only for changed paths. `null`
  at the leaf has a schema-driven meaning (see the absence rule
  below).
- **Composite index**: `deltas_chain_idx (branch_id, target_id, log_position)`,
  declared as a Mermaid annotation on the `deltas` block in
  `data-model.md`. Three columns, not four —
  [the kind-prefixed UUID invariant](../data-model.md#id-shape--kind-prefixed-uuids-throughout)
  makes `target_id` globally unique, so `target_table` becomes a
  defensive post-filter rather than an index discriminator.
- **Schema version stamp**: a new `encoding_version: integer DEFAULT 1`
  column on `deltas`. Stamped by every writer at write time, ignored
  by every reader at v1 (always applies v1 semantics). Reserved so a
  future schema migration that changes encoding rules can dispatch
  per-delta without retrofitting.

The rejected alternatives, briefly:

- **Whole-column snapshots** (every JSON-column touch carries the
  whole pre-state column): trivial apply, but each classifier turn
  fires several state-sub-field deltas and the storage budget collapses
  fast — ~5 MB delta-log [ceiling](../data-model.md#entry-mutability--rollback)
  isn't sized for whole-state per write.
- **Hybrid: partial at column-level, whole at within-column-level**:
  same storage problem as whole-column for JSON columns; only
  marginally simpler than nested-partial on apply.
- **Dotted column-path encoding** (`{"state.traits": [...]}`): roughly
  tied with nested-partial on storage, slightly smaller for
  single-sub-field touches and slightly bigger for multi-sub-field
  touches (the realistic classifier distribution favours
  nested-partial). Loses on per-table Zod expressivity (the natural
  shape is `z.record(z.string(), z.unknown())` — loose) and on
  raw-JSON discoverability for tooling readers.

Storage economy drove the high-level choice; Zod expressivity and
discoverability drove the tie-break between A and B.

## Encoding contract

The `undo_payload` column shape is fixed by `op`:

- `op=create` → `null`. Reverse is `DELETE`. Already pinned by
  `data-model.md`; not touched by this design.
- `op=delete` → full row JSON at delete-time. Reverse is `INSERT`
  with that row. Already pinned; not touched.
- `op=update` → **nested partial** mirroring the row's column structure,
  populated only for changed paths. The rest of this section pins
  that shape.

### Op=update shape rule

For every column touched by an update, `undo_payload[column]` carries:

| Column type                                                     | Value                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalar (`TEXT`, `INTEGER`, `REAL`)                              | The pre-change value, of that column's type.                                                                                                                        |
| Flat-array JSON (`tags`, `keywords`)                            | The full pre-change array. Arrays go whole; partial encoding inside arrays would re-introduce the absence-sentinel problem at index granularity for no storage win. |
| Nested-object JSON (`entities.state`, `story_entries.metadata`) | A nested partial of the column, populated only for changed sub-paths. Recursive: nested objects within nested objects follow the same rule.                         |

### The `null`-as-sentinel rule

`null` in `undo_payload` is overloaded across three Zod node types,
schema-discriminated at apply time:

- **At a nullable scalar or nullable-object leaf** (e.g.
  `metadata.currentLocationId: string | null`, `state.lastSeenAt: {...} | null`)
  — `null` is a value to restore. The pre-change value was null; the
  apply step writes null.
- **At a record-typed (dynamic-keyed) leaf** (e.g. `state.stackables: Record<string, number>`)
  — `null` means "this sub-key was absent pre-change; delete it on
  apply." The only record-typed sub-field in the v1 delta-logged
  schema is `stackables`, whose values are integers and cannot
  legitimately be null.
- **At an optional fixed-shape leaf** (e.g. `state.voice?: string`,
  `state.visual.distinguishing?: string[]`) — `null` means "this key
  was absent pre-change; delete it on apply."

### Nullable-object transitions

When a nullable-object position transitions between null and non-null,
the writer's `undo_payload` value follows three cases:

- `null → non-null`: `undo_payload[key] = null` (restore the null
  pre-state; ignore the new structure).
- `non-null → null`: `undo_payload[key] = <full pre-non-null object>`
  (whole-object — there's no current shape to merge against on
  rollback, so the diff is the entire pre-state).
- `non-null → non-null`: `undo_payload[key] = <partial diff>` (the
  standard sub-field-touch case).

A `null → partial` payload cannot legitimately occur (the writer's
diff function never produces "row was null, payload is partial"
— the pre-state had no shape to be partial against). The apply
function treats it as a writer bug (`warn`-log and replace).

### Hard schema invariants

Two invariants the encoding's correctness depends on. The current
schema satisfies both; any future Zod schema landing for a
delta-logged column must check them:

- **Record-typed sub-fields must have non-nullable value types.**
  Preserves the `null = delete-sub-key` semantics for records. A
  `Record<string, string | null>` would collide — value `null`
  becomes ambiguous between "restore null value" and "delete key."
  Currently met: `stackables: Record<string, number>`.
- **Sub-fields must not stack `z.optional()` over `z.nullable()`.**
  The stacked case (`z.optional(z.nullable(z.string()))`) makes a
  `null` payload value ambiguous between "key was absent" and "value
  was null." Currently met across all delta-logged tables.

### Worked examples

```jsonc
// Top-level scalar touch
{ "description": "An archer from the northern reaches." }

// Two scalars in one delta
{ "description": "...", "name": "Aria" }

// JSON sub-field touch
{ "state": { "traits": ["brave", "loyal"] } }

// Multiple sub-fields in one column
{ "state": { "traits": ["brave"], "drives": ["protect Aria"] } }

// Mixed top-level scalar + JSON sub-field
{ "name": "Aria", "state": { "traits": ["brave", "loyal"] } }

// Nullable schema-fixed scalar: was null, now "loc_castle"
{ "metadata": { "currentLocationId": null } }

// Record-typed dict: added "dagger" (absent pre-change)
{ "state": { "stackables": { "dagger": null } } }

// Record-typed dict: removed "gold" (had value 10)
{ "state": { "stackables": { "gold": 10 } } }

// Record-typed dict: updated "gold" 5 → 10
{ "state": { "stackables": { "gold": 5 } } }

// Optional fixed-shape: added "voice" string (absent pre-change)
{ "state": { "voice": null } }

// Nullable object: null → non-null
{ "state": { "lastSeenAt": null } }

// Nullable object: non-null → null (whole pre-state)
{ "state": { "lastSeenAt": { "entryId": "e1", "locationId": "loc1", "worldTime": 100 } } }

// Nullable object: non-null → non-null (partial diff)
{ "state": { "lastSeenAt": { "entryId": "e1", "worldTime": 100 } } }

// Array sub-field replaces wholly
{ "tags": ["soldier", "veteran"] }
```

## Apply semantics

Both rollback (mutates a SQLite row) and the diff cache walk (mutates
an in-memory state object) reduce to the same primitive: apply an
`undo_payload` to a row-shaped object, return the pre-change
row-shaped object. The DB-trip wrapping is the only thing rollback
adds — both callers share one function, collapsing the architecture
doc's "same observable behavior, not necessarily the same function"
hedge.

Proposed home: `lib/deltas/apply.ts`, exposing one pure function:

```ts
function applyUndoPayload(
  targetTable: TargetTable,
  row: TableRow<TargetTable>,
  payload: UndoPayload<TargetTable>,
): TableRow<TargetTable>
```

### Schema-driven recursion

The merge walks three things in parallel — the row's value, the
payload's value, and the row's Zod schema at the corresponding
position — dispatching per Zod node type:

| Zod node at position                          | Payload value at this position   | Apply rule                                                                                                                                                            |
| --------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalar (`z.string()`, `z.number()`, etc.)     | (any)                            | Replace the row's value with the payload's value.                                                                                                                     |
| `z.array(...)`                                | (any)                            | Replace the row's array with the payload's array, whole.                                                                                                              |
| `z.object({ ... })` (fixed-shape, required)   | object                           | Iterate the payload's keys; for each, recurse with `(row[k], payload[k], schemaNode.shape[k])`. Keys absent from payload remain untouched in row.                     |
| `z.record(keyZ, valueZ)` (dynamic-keyed dict) | object                           | Iterate the payload's keys. If `payload[k] === null` → delete `k` from the row. Otherwise recurse with `(row[k], payload[k], valueZ)`.                                |
| `z.optional(X)` (fixed-shape leaf)            | `null` (or key absent at parent) | Delete this key from the row (the parent is necessarily a `z.object`).                                                                                                |
| `z.optional(X)` (fixed-shape leaf)            | non-null                         | Unwrap to inner `X`, recurse with payload value.                                                                                                                      |
| `z.nullable(X)`                               | `null`                           | Replace the row's value with `null`.                                                                                                                                  |
| `z.nullable(X)` where `X` is `z.object`       | non-null partial                 | If row's value is non-null, unwrap to inner and recurse. If row's value is null, log `warn` and replace wholesale (writer-side invariant: this case shouldn't occur). |
| `z.nullable(X)` where `X` is scalar/array     | non-null                         | Replace the row's value with the payload's value.                                                                                                                     |

JSON parse/stringify happens once at the row boundary (DB roundtrip
in rollback; not needed at all in the in-memory cache walk) —
schemas describe JSON columns structurally, so recursion is uniform
across SQLite columns and within-JSON sub-paths.

### Diff cache walk integration

The walk algorithm in
[`architecture.md → Walk algorithm`](../architecture.md#walk-algorithm)
reads:

```
1. new_partial = pick(state, keys(delta.undo_payload))
2. old_partial = delta.undo_payload
3. Cache { new: new_partial, old: old_partial } keyed by delta.id
4. state = merge(state, delta.undo_payload)
```

Two clarifications fall out from the encoding contract:

- **`pick` is column-key-only at the top level.** `keys(delta.undo_payload)`
  returns column names (`['state', 'description']`, not
  `['state.traits']`). The cache entry's `new.<column>` is the whole
  live column value; `old.<column>` is the partial pre-change column.
- **`merge` IS `applyUndoPayload`.** The two-function fiction
  collapses.

The renderer-walks-`old` rule:
[`DeltaLogRow`](../ui/patterns/delta-log-row.md#summary) renders the
rich diff prose. Given the cache entry shape, the renderer **must
iterate `keys(old.<column>)` and look up the corresponding paths in
`new.<column>`** — not the reverse. Walking `keys(new.<column>)` would
emit spurious "changed" markers for every sub-field present in
current state but absent in the partial pre-state, because `new.<column>`
contains the whole live state while `old.<column>` contains only
touched paths.

Worked example. A delta whose `undo_payload` is
`{state: {traits: ["brave"]}}` and whose target row currently has
`state = {traits: ["brave", "former soldier"], drives: ["protect Aria"], voice: "low"}`:

- `new.state = {traits: ["brave", "former soldier"], drives: ["protect Aria"], voice: "low"}` (whole live)
- `old.state = {traits: ["brave"]}` (partial pre)
- Renderer walks `keys(old.state)` → `["traits"]`. Reads `new.state.traits` and `old.state.traits`. Renders `Added "former soldier"`. Does NOT mention `drives` or `voice` because those keys aren't in `old.state`.

### Defensive branches at apply

Three writer-bug cases the apply function handles by logging at
`warn` per the
[logger contract](../observability.md#logger-contract) and
skipping the offending key, rather than failing the merge:

- **Unknown column in payload** (schema migrated away from a
  column) — skip the key, continue. Rollback partial-completes; not
  perfect but better than refusing to run.
- **Type mismatch at a leaf** (payload value's runtime type doesn't
  match schema) — skip the key, continue.
- **Empty `undo_payload` for `op=update`** (`{}`) — no-op merge,
  warn-log.

These are safety nets, not the primary defense. The primary defense
is writer-side Zod validation (see Implementation surface below).

### Performance

The merge is O(keys in payload) per delta, with constant-factor
recursion depth bounded by Zod schema depth (`entities.state.visual`
is the deepest nest at 3 levels). The diff cache walk's chain length
is typically 1–10 deltas per target; total cost is dominated by
SQLite I/O, not merge CPU. No optimization needed.

## Composite index

In the `deltas` block of `data-model.md`'s Mermaid diagram:

```
%% INDEX deltas_chain_idx (branch_id, target_id, log_position) — chain-walk index for the diff cache walk and future rollback / CTRL-Z chain reads. See architecture.md → Delta history diff resolution.
```

### Why 3 columns

The cache walk's query reads
`WHERE branch_id = ? AND target_table = ? AND target_id = ? AND log_position >= ?`
— suggesting a 4-column index. But the
[kind-prefixed UUID invariant](../data-model.md#id-shape--kind-prefixed-uuids-throughout)
makes `target_id` globally unique across tables. Once `target_id`
narrows, `target_table` is redundant: SQLite's optimizer treats it as
a post-filter on a tiny result set, not as an index discriminator.
The 4-column variant would be strictly broader with no measurable
query-time win.

The `target_table = ?` predicate stays in the query as defensive
narrowing (a malformed `target_id` carrying the wrong kind-prefix
would still be caught), not as a perf concern.

### Column order

`(branch_id, target_id, log_position)`:

- **`branch_id` first** — matches the WHERE clause's narrowing order.
  Even though `target_id` is the strongest discriminator standalone,
  leading with branch keeps the index structure intuitive when read
  against the query.
- **`target_id` middle** — strong narrowing within the branch's slice.
- **`log_position` last** — covers both the `>= ?` range predicate
  and the `ORDER BY log_position DESC` sort. SQLite serves results in
  index order without a separate sort step.

### Performance characterization

Without the index, `populate(delta)` degrades to a `deltas`-wide
scan: O(N) per walk where N is the branch's total delta count. The
[storage ceiling estimate](../data-model.md#entry-mutability--rollback)
puts large stories at ~5 MB of deltas, on the order of 30k–50k rows.
A sub-100 ms target on the cache walk collapses to several hundred ms
per populate, which the user perceives as the History tab loading
the rich diff slowly even after the initial render.

With the 3-column index, the chain query becomes O(chain length ×
log N) — sub-millisecond for typical chains regardless of total log
size.

### Out-of-scope adjacent patterns

Two query patterns are tempting to bundle but explicitly not covered
by `deltas_chain_idx`:

- **CTRL-Z chain read** (`WHERE branch_id = ? AND action_id = ?`) —
  different access pattern; needs `(branch_id, action_id)` separately.
  Lands when the CTRL-Z implementation surfaces the need.
- **Diagnostics Hub Delta log search** (`LIKE` + `json_extract` over
  `undo_payload`) — full-scan by intent, user-driven, not perf-critical
  at v1 scale per the existing scope.

### Migration-file question (deferred to v1 build)

The project hasn't yet pinned where SQLite indexes get declared in
code — schema setup script, migration file, or inline `CREATE INDEX
IF NOT EXISTS` at boot. This design doesn't pick that convention.
The Mermaid `%% INDEX` line IS the spec until the first
index-declaration convention lands and picks `deltas_chain_idx` up
by name.

Naming convention: prefix by table (`deltas_chain_idx`) so the
declaration is greppable from architecture.md's cache-walk section.

## Schema version stamping

New column on `deltas`:

```
integer encoding_version "writer-stamped encoding-contract version. Defaults to 1 at v1. Reserved for future apply-time dispatch when delta-logged column shapes or encoding rules change. See explorations/2026-05-17-deltas-substrate.md."
```

Stamped by every writer at write time (always `1` in v1). Ignored by
every reader at v1 (always applies v1 apply semantics). The column
exists from day one so that a future migration that needs to change
encoding rules — column rename, sub-field type change, encoding rule
revision — can dispatch per-delta without retrofitting a version
into existing rows.

Cost: 4 bytes per delta. At the 50k-delta estimate, ~200 KB per large
story. Negligible.

Two adjacent paths the version stamp covers:

- **Encoding rule change** (e.g. switching from nested-partial to
  dotted-flat at some future v2). The apply function gains
  `applyV1 | applyV2 | ...`, selected per `delta.encoding_version`.
- **Per-table Zod schema change** (e.g. renaming `state.traits` to
  `state.traitList`). Two patterns are possible at version bump time:
  inline migration that rewrites old deltas to the new shape (one-time
  cost, simpler reads); per-version Zod schemas with the apply
  dispatcher knowing which to use per delta (no rewrite, more memory).
  The choice is deferred to the actual migration design pass; this
  column makes either workable.

## Implementation surface

The encoding contract and apply function land at specific touchpoints
across the codebase.

### Helper utility surface

The reader-side primitive is fixed (`lib/deltas/apply.ts` above).

The writer side is not constrained to a single helper shape. Writers
produce conformant `undo_payload` values however natural for their
input; the only requirement is the **round-trip invariant**:

> For any writer path, given a `prevRow` and the `nextRow` actually
> written: `applyUndoPayload(table, nextRow, undoPayload) === prevRow`.

Tested per-writer-path with fuzz inputs. The design pins what's in
the column, not how callers arrived at it.

A convenience helper for the natural "I have full pre and post rows"
case can live alongside apply at `lib/deltas/diff.ts`:

```ts
function diffForUndoPayload(
  targetTable: TargetTable,
  prevRow: TableRow<TargetTable>,
  nextRow: TableRow<TargetTable>,
): UndoPayload<TargetTable>
```

Useful for user-edit paths where the UI hands a save handler both
rows. Optional — writers that already have field-level intent
shouldn't manufacture a `nextRow` just to call it.

### Writer touchpoints

- **Classifier output processor** — periodic + piggyback classifiers
  per the
  [classifier contract](../architecture.md#classifier-contract--metadata-fields).
  The classifier emits **targeted changes** (e.g. "add `former soldier`
  to `aria.state.traits`"), not whole-state proposals. The processor
  reads pre-values for the affected paths, constructs `undo_payload`
  directly from the targeted changes, applies the changes to produce
  the new row, and writes both in one delta-emitting transaction.
  The exact shape of the classifier-output structured response is
  pinned by the classifier-output Zod schema — landing alongside the
  [classifier delta validation](../followups.md#classifier-delta-validation)
  followup. This design depends on that work for the targeted-change
  vocabulary but doesn't constrain it.
- **Lore-management agent** — chapter-close sub-jobs per
  [memory/chapter-close.md](../memory/chapter-close.md). Same
  targeted-change pattern as the classifier; the agent emits per-row
  instructions that get reduced to conformant `undo_payload`.
- **User direct edit** — World panel save, Plot panel save, entry-text
  edit. The natural input is `(prevRow, nextRow)`; `diffForUndoPayload`
  fits. Could also be field-level intent if the UI tracks "which
  sub-field did the user touch" — implementation choice, both
  satisfy the contract.
- **Chapter close** — orchestrates `chapters` insert +
  `story_entries.chapter_id` updates + lore-mgmt sub-jobs under one
  `action_id`. Each sub-write follows the writer shape natural to
  its layer.

### Reader touchpoints

- **Rollback** — `applyUndoPayload` per delta walking backward from
  `log_position = N`.
- **CTRL-Z** — same primitive, scoped to one `action_id` per
  [data-model.md → Entry mutability & rollback](../data-model.md#entry-mutability--rollback).
- **Diff cache walk** — per
  [architecture.md → Walk algorithm](../architecture.md#walk-algorithm),
  `merge(state, undo_payload)` IS `applyUndoPayload`.
- **Crash recovery** — per the
  [crash recovery followup](../followups.md#crash-recovery-for-in-flight-transactions),
  startup-time reverse-replay of orphaned `pipeline_runs` markers
  uses the same primitive.

### Zod schema derivation

Per-table `undoPayloadZ` schemas derive mechanically from the
existing row schemas:

- At every `z.object({ ... })` node: convert to `.partial()`.
- At every `z.record(keyZ, valueZ)` node: leave as-is.
- At every scalar / array leaf: leave as-is.

A `deriveUndoPayloadSchema(rowSchema)` utility produces the per-table
schema once. The writer boundary validates each `undo_payload`
before write — malformed payloads get rejected at the writer, not at
the reader. The apply function's defensive `warn`-and-skip branches
are the safety net, not the primary defense.

**Lands together with
[classifier delta validation](../followups.md#classifier-delta-validation)**
— both followups need the same Zod-layer infrastructure; one PR
resolves both.

### Transitive concurrency premise

The encoding's correctness inherits a premise from
[generation-pipeline.md → Concurrency model](../generation-pipeline.md#concurrency-model):
concurrent pipelines write **disjoint field sets at SQLite row
granularity** (periodic classifier vs per-turn vs user edit). If a
future feature breaks the disjoint-set premise — two writers
concurrently touching `state.traits` on the same entity — undo chains
would still be locally consistent per-delta but the "state at
log_position X" interpretation would surprise users (two
"pre-change" values would overlap, each correct from its own writer's
perspective).

Not this design's job to enforce; flagged so a future reviewer
extending concurrent-write paths knows the encoding has a transitive
dependency.

## Doc-integration impact

- `data-model.md → Diagram` — `deltas` block gains the
  `%% INDEX deltas_chain_idx` annotation and the `encoding_version`
  column.
- `data-model.md → Entry mutability & rollback` — extends "Delta
  storage economy" paragraph with the nested-partial rule + the
  three-way `null`-as-sentinel rule + the two hard schema
  invariants.
- `architecture.md → Delta history diff resolution` — replaces the
  "pre-existing data-model gap" hedge with an anchor link to the
  canonical rule. Collapses the "not necessarily the same function"
  wording. Adds the renderer-walks-`old` rule near the walk-algorithm
  section.
- `followups.md` — removes both `undo_payload encoding for nested
fields` and `composite index — deltas (...)` entries. The latent
  schema-evolution risk surfaced during design is resolved by the
  `encoding_version` column landing pre-emptively; not parked
  separately.
- No wireframe changes. No UX surface changes. No memory-pipeline
  doc changes.
