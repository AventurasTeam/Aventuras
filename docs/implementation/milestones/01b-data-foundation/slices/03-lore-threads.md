# Slice 1.5.3 — Lore & threads

## Metadata

- **Milestone:** [Milestone 1.5 — Data foundation](../milestone.md)
- **Depends on:** [Gate](./01-gate.md) — `lore` / `threads` DDL + JSON
  types, dispatch API, store factory, store-mirror contract.
- **Blocks:** nothing in M1.5 (parallel). Consumed downstream by
  retrieval / injection (M3) and the World / Plot panels (M4).

## Goal

Make `lore` and `threads` live, reversible domains: working-set stores,
Tier-1 CRUD arms through the dispatch API, and their column Zod.

## Background

`lore` is per-branch static reference material (magic systems,
religions, cosmology) — retrieval fodder, no lifecycle, no structured
state, per
[`data-model.md → World-state storage`](../../../../data-model.md#world-state-storage).
`threads` is the broader plot view (quests, arcs, ambient pressures)
with a `pending | active | resolved | failed` lifecycle per
[`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge).
Both carry `injection_mode` (always / auto / disabled) and flat-array
JSON columns (`tags`; `lore.keywords`) that the delta encoder takes
**whole** (arrays go whole per the encoding rule). This slice ships the
data layer only — the retrieval pathways that consume `keywords` /
`priority` / `injection_mode`, and the panels that render these, are
later milestones.

## Required reading

- [`data-model.md → World-state storage`](../../../../data-model.md#world-state-storage)
  — `lore` rationale (the per-branch reference table).
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  — `threads` rationale, statuses, the events-vs-threads split.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — flat-array-whole encoding for `tags` / `keywords`.

## Scope: in

- **`lore` runtime Zod + store + CRUD arms.** Columns: `title`, `body`,
  `category`, `tags` (json `string[]`), `keywords` (json `string[]`),
  `injection_mode`, `priority` (0..100), `embedding_stale`,
  timestamps. Narrative fields delta-log; `embedding_stale` is
  operational (off-log).
- **`threads` runtime Zod + store + CRUD arms.** Columns: `title`,
  `description`, `category`, `icon`, `status`, `injection_mode`,
  `triggered_at_entry_id`, `resolved_at_entry_id`, `embedding_stale`,
  timestamps.
- Stores via the base factory (keyed by id, branch-scoped, internal
  patch surface, read selectors); no speculative public mutators.
- **Tests** per [milestone C4](../milestone.md#c4--domain-slice-template).

## Scope: out

- **Retrieval / injection consumption** of `keywords`, `priority`,
  `injection_mode` (M3); the keyword-retrieval pathway.
- **Embedding / `embedding_stale` lifecycle** (M3).
- **Lore-mgmt chapter-close writes** (cross-arc callback detection,
  consolidation) — M5+.
- **Thread auto-population from chapter-close** — threads may be sparse
  until M5 writes them; this slice ships the table + arms, not the
  writer.
- **World / Plot panel reads** (M4).

## Acceptance criteria

- `lore` / `threads` Zod parse their specced shapes with defaults.
- CRUD arms write row + delta and patch the store; reverse-replay
  reverses both.
- `op=update` on a flat-array column (`tags`, `keywords`) carries the
  full pre-change array in `undo_payload` and reverse-replay restores
  it.
- Non-held-branch write no-ops against the store.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, vitest pass.

## Tests

- **Zod.** Parse representative `lore` / `threads` rows; status enum
  rejection for threads.
- **CRUD roundtrip** per table.
- **Undo encoding.** `op=update` on `tags` / `keywords` (whole-array)
  and on scalar fields (`status`, `priority`) — encode + reverse-replay
  restore.
- **Store patch.** Create / update / delete patch held branch; non-held
  no-op; reverse-replay reverses.

## Open questions

- **`triggered_at_entry_id` / `resolved_at_entry_id`** — resolved: these
  store a branch-scoped `story_entries.id` (text), not an entry position.
  They are FK-less (entries are branch-scoped composite-keyed) and resolve
  via `(branch_id, id)`, the same convention as `deltas.entry_id` and
  `chapters.start_entry_id`; the earlier position-integer plan was dropped
  because reused positions silently re-point after rollback. See
  [data-model.md → On the two time fields](../../../../data-model.md#happenings--character-knowledge).
  The entry-ref picker primitive that authors them lands in M4.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
