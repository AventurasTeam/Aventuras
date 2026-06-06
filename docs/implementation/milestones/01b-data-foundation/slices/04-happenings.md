# Slice 1.5.4 — Happenings & knowledge

## Metadata

- **Milestone:** [Milestone 1.5 — Data foundation](../milestone.md)
- **Depends on:** [Gate](./01-gate.md) — the four tables' DDL (incl.
  the link-table surrogate ids) + constraints, dispatch API, store
  factory, store-mirror contract.
- **Blocks:** nothing in M1.5 (parallel). Consumed by the classifier /
  awareness graph (M3) and the Plot panel (M4).

## Goal

Make the happenings cluster live and reversible: `happenings`,
`happening_involvements`, `happening_awareness`, and
`character_relationships` — stores, Tier-1 CRUD arms, column Zod, and
the **UPSERT-merge + canonical-ordering** write paths plus the
**CHECK / UNIQUE** constraints. The constraint-heavy domain slice.

## Background

This cluster is the awareness graph per
[`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge):
`happenings` (atomic "what occurred / exists as a knowable fact"),
`happening_involvements` (which entities are subject matter),
`happening_awareness` (which characters know it — this **is** character
memory), and `character_relationships` (per-pair char↔char, two POVs).
Three traits make it the constraint-heavy slice:

- **`happenings` mutual-exclusivity** — `occurred_at_entry_id` (narrative
  entry ref) and `temporal` (free-form out-of-narrative anchor) are
  exclusive per row; in-world time for a narrative happening derives
  from the entry's `metadata.worldTime`, never duplicated here.
- **`happening_awareness` UPSERT** — `UNIQUE(branch_id, character_id,
happening_id)`; classifier and user-edit paths upsert, so duplicates
  can't accumulate. `common_knowledge=1` happenings skip awareness
  rows entirely.
- **`character_relationships` canonical ordering + POV merge** —
  one row per pair, `a_id < b_id`, `kind` / `inverse_kind` accumulate
  the two perspectives independently; the write path normalizes via
  `normalizeForWrite` so the classifier never needs to know ordering.

This slice ships the **write mechanics** (normalize, upsert, constraint
enforcement) and CRUD — not the classifier that decides _what_ to write
(M3) or the Plot panel that renders it (M4). The link tables carry
surrogate kind-prefixed ids — `hinv_` / `haw_` per
[`data-model.md → ID shape`](../../../../data-model.md#id-shape--kind-prefixed-uuids-throughout)
(corrected during this milestone's prep so a single delta `target_id`
can address them) — so they are composite `(branch_id, id)` like every
other branch-scoped table.

## Required reading

- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  — the two-layer model, awareness-as-memory, the mutual-exclusivity
  rationale.
- [`data-model.md → Character-to-character relationships`](../../../../data-model.md#character-to-character-relationships)
  — the one-row-per-pair shape, `normalizeForWrite`, the UPSERT-merge
  worked example, `getRelationships` read-normalization, translation
  targets, retirement lifecycle.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — encoding for these tables; every write (incl. upsert) is one delta
  under the action's `action_id`.

## Scope: in

- **`happenings`** Zod + store + CRUD arms. Columns: `title`,
  `description`, `category`, `icon`, `temporal`, `occurred_at_entry_id`,
  `common_knowledge` (0/1), `embedding_stale`, timestamps. Enforce
  `CHECK (occurred_at_entry_id IS NULL OR temporal IS NULL)` in DDL (gate)
  **and** at the Zod boundary (the friendlier surface). `occurred_at_entry_id`
  is nullable text — Zod normalizes empty to `null` so `''` can't slip past
  the CHECK (it is non-null) per
  [`data-model.md → On the two time fields`](../../../../data-model.md#happenings--character-knowledge).
- **`happening_involvements`** (surrogate id + `happening_id`,
  `entity_id`, `role`) — Zod + CRUD arms; store as a sub-collection of
  the happenings store (Open questions).
- **`happening_awareness`** (surrogate id + `happening_id`,
  `character_id`, `learned_at_entry_id`, `decay_resistance` real 0..1,
  `retrieval_count`, `source`) — Zod + **UPSERT-merge arm** keyed on
  `(branch_id, character_id, happening_id)`; one delta per write.
  `retrieval_count` is a delta-logged operational counter (the ranker
  increments it later — M3 — but the column + its delta participation
  land here).
- **`character_relationships`** Zod + store + CRUD arms with the
  **`normalizeForWrite` canonical-ordering** write path and the
  **POV-merge UPSERT** on `(branch_id, a_id, b_id)`; delete = both POVs
  nulled → row removed. DDL CHECKs (gate): `a_id < b_id`,
  `kind IS NOT NULL OR inverse_kind IS NOT NULL`.
- A **`getRelationships(characterId, branchId)` read helper** that
  normalizes POV to the caller's character (per the data-model).
- **Tests** per [milestone C4](../milestone.md#c4--domain-slice-template)
  plus the constraint + upsert cases below.

## Scope: out

- **Classifier reconcile** — the per-turn / chapter-close logic that
  decides which happenings, involvements, awareness rows, and
  relationship POVs to emit (M3). This slice ships the write primitives
  it will call.
- **`retrieval_count` increment-on-injection** and the chapter-close
  phase-3d pin tuning (M3 ranker / M5 chapter-close); the column +
  delta participation land here, the writer does not.
- **`decay_resistance` tuning** by user toggle / lore-mgmt (M3+).
- **Embedding / `embedding_stale` lifecycle** (M3).
- **Plot panel reads**, happening awareness tab, entry-ref pickers
  (M4).
- **Inter-faction relationships / graph traversal** — out of v1 per the
  data-model.

## Acceptance criteria

- `happenings` rejects a row with both `occurred_at_entry_id` and
  `temporal` (DDL CHECK + Zod), accepts either alone or neither.
- `happening_awareness` re-write for an existing
  `(branch, character, happening)` UPSERTs (one row, fields merged),
  not a duplicate; the DB UNIQUE backstops it.
- `character_relationships`: writing `(Kael, Aria, "sister")` then
  `(Aria, Kael, "brother")` yields one canonically-ordered row
  `(a=Aria, b=Kael, kind="brother", inverse_kind="sister")` (the
  data-model worked example); `a_id ≥ b_id` and both-null are rejected;
  nulling both POVs removes the row.
- `getRelationships` returns each row from the queried character's POV
  (`selfToOther` / `otherToSelf`).
- Every write (create / update / delete / upsert) produces a delta;
  store patches on commit; reverse-replay reverses row + patch.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, vitest pass.

## Tests

- **Constraint negatives.** happenings both-time-fields;
  `character_relationships` `a_id ≥ b_id`, both-null; duplicate
  `happening_awareness` key — each rejected at the layer that owns it.
- **Relationship merge.** The two-write worked example → one row;
  contradicting-prose update overwrites the right POV; delete-both →
  row gone.
- **Awareness UPSERT.** Re-emit same key with new `source` /
  `decay_resistance` → merged, single row, one delta.
- **CRUD + undo + store patch** for each table (incl. surrogate-id
  link tables), reverse-replay restores.

## Open questions

- **Store shape for the cluster** — one happenings store holding
  involvements + awareness as sub-collections, vs separate stores;
  and whether `character_relationships` is its own store or folded
  with entities. Lean: happenings store owns its two link collections;
  relationships its own store. Confirm at authoring.
- **`learned_at_entry_id` / `occurred_at_entry_id`** — resolved: store a
  branch-scoped `story_entries.id` (text), FK-less, resolved via
  `(branch_id, id)` — same convention as threads' `*_at_entry_id` refs and
  `deltas.entry_id`. The earlier position-integer plan was dropped (reused
  positions silently re-point after rollback); see
  [data-model.md → On the two time fields](../../../../data-model.md#happenings--character-knowledge).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
