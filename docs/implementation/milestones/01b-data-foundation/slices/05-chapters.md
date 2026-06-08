# Slice 1.5.5 — Chapters & era flips

## Metadata

- **Milestone:** [Milestone 1.5 — Data foundation](../milestone.md)
- **Depends on:** [Gate](./01-gate.md) — `chapters` / `branch_era_flips`
  DDL + JSON types, dispatch API, store factory, store-mirror contract.
- **Blocks:** nothing in M1.5 (parallel). Consumed by chapter-close
  (M5) and the chapter-timeline / era-flip surfaces (M5 / M7).

## Goal

Make `chapters` and `branch_era_flips` live, reversible domains:
working-set stores, Tier-1 CRUD arms through the dispatch API, and
their column Zod.

## Background

Chapters are first-class, per-branch, user-visible ranges that segment
the narrative and trigger chapter-close, per
[`data-model.md → Chapters / memory system`](../../../../data-model.md#chapters--memory-system).
Only **closed** chapters exist as rows (open-region entries have
`chapter_id IS NULL`); the chapter-close pipeline (M5) is what actually
creates them. `branch_era_flips` records per-branch in-world era
changes (`at_worldtime`, `era_name`) per
[`data-model.md → Era flips`](../../../../data-model.md#era-flips). This
slice ships the data layer — the writer (chapter-close) and the
era-flip UX (M7.2) are out of scope; we land the tables, the CRUD, and
the stores so those features build against them.

## Required reading

- [`data-model.md → Chapters / memory system`](../../../../data-model.md#chapters--memory-system)
  — closed-only rows, the per-branch fork-clean property, the
  retrieval-pool role.
- [`data-model.md → Era flips`](../../../../data-model.md#era-flips)
  — `branch_era_flips` shape and `at_worldtime` semantics.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — `chapters` rows are delta-logged (chapter-close shares one
  `action_id`); encoding for `keywords` (whole-array).

## Scope: in

- **`chapters`** Zod + store + CRUD arms. Columns: `sequence_number`,
  `title`, `summary`, `theme`, `keywords` (json `string[]`),
  `start_entry_id`, `end_entry_id`, `token_count`, `closed_at`,
  `embedding_stale`, timestamps. Narrative fields delta-log;
  `embedding_stale` operational.
- **`branch_era_flips`** Zod + store + CRUD arms. Columns:
  `at_worldtime` (≥ 0), `era_name`, `created_at`.
- Stores via the base factory (branch-scoped, keyed by id, read
  selectors incl. chapters by `sequence_number`); no speculative
  public mutators.
- **Tests** per [milestone C4](../milestone.md#c4--domain-slice-template).

## Scope: out

- **Chapter-close pipeline** — boundary selection, metadata generation,
  lore-mgmt sub-jobs, the shared-`action_id` batch (M5.2). This slice
  ships the CRUD primitives it writes through.
- **Chapter boundary detection** (token threshold crossing,
  auto-close) and chapter-membership assignment on entries
  (`story_entries.chapter_id` updates) — M5.
- **Chapter-summaries retrieval pool / embedding** (M3).
- **Era-flip UX** — time-chip popover, flip-era modal, calendar-tab
  era list (M7.2); the renderer that consumes `at_worldtime` (M2.5 /
  calendar subsystem).
- **Chapter-timeline screen** (M5.3).

## Acceptance criteria

- `chapters` / `branch_era_flips` Zod parse their specced shapes with
  defaults; `at_worldtime ≥ 0` enforced.
- CRUD arms write row + delta and patch the store; reverse-replay
  reverses both.
- `op=update` on `chapters.keywords` (whole-array) and scalar fields
  (`title`, `summary`, `token_count`) encode + reverse-replay restore.
- Non-held-branch write no-ops against the store.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, vitest pass.

## Tests

- **Zod.** Parse representative `chapters` / `branch_era_flips` rows;
  `at_worldtime` negative rejection.
- **CRUD roundtrip** per table.
- **Undo encoding.** `chapters.keywords` whole-array + scalar updates,
  reverse-replay restore.
- **Store patch.** Create / update / delete patch held branch; non-held
  no-op; reverse-replay reverses.

## Open questions

- **`start_entry_id` / `end_entry_id`** — resolved: they store a single
  branch-scoped `story_entries.id` (FK-less, `notNull`; branch implied by
  the chapter's own `branch_id`), not a `(branch_id, id)` pair. Confirmed
  by the gate-landed table shape and the same convention the lore-threads
  slice fixed for `threads.triggered_at_entry_id` /
  [`chapters.start_entry_id`](./03-lore-threads.md#open-questions).

## Implementation notes

- **Chapters `UPDATABLE` is the full delta-logged set** —
  `sequenceNumber`, `title`, `summary`, `theme`, `keywords`,
  `startEntryId`, `endEntryId`, `tokenCount` (excludes the operational
  `embedding_stale`, the `closed_at` / `created_at` / `updated_at`
  timestamps, and the composite PK). Mirrors the threads "every
  delta-logged column is updatable" precedent, giving chapter-close /
  re-close / boundary-adjust (M5) the full primitive surface without
  re-editing this domain. `closed_at` stays in `chapterWriteSchema`
  (validated on create) but out of `UPDATABLE`, so a patch touching only
  non-updatable fields yields an empty `set`; both update arms guard that
  case and return `rejected` (without the guard Drizzle's `.set({})`
  throws "No values to set" — caught in Codex review).
- **`branch_era_flips` ships its DB constraints here** (migration
  `0003`): one composite `uniqueIndex(branch_id, at_worldtime)`, serving
  both the no-duplicate-moment invariant and the resolver's "largest
  `at_worldtime ≤ N`" range scan (no separate index), plus
  `CHECK (at_worldtime >= 0)`. The gate's
  [C5](../milestone.md#c5--key-shape-and-constraint-encoding) list had
  omitted era-flips; this honors the data-model's pinned constraints.
  `at_worldtime ≥ 0` is enforced at both the DB CHECK and the write-Zod
  (`.min(0)`).
- **Deliberate gate-file touch.** Adding the era-flip constraints edited
  the gate-owned `stories.table.ts` and the migrations folder — an
  exception to the "domain slice edits only its own files" property,
  accepted because the parallel domain slices are already merged.
- **Store-mirror hardening (shared factory, from Codex review).** The
  working-set store's update patch now no-ops when the target id is absent
  from the held set instead of synthesizing a partial row from the column
  delta — closes a corruption path where a stale operational write (e.g.
  `embedding_stale` for a since-deleted chapter on the loaded branch)
  would leave a malformed row. Touches the gate-owned `lib/stores/factory`;
  benefits every domain store.
- **Followup queued** in [`triage.md`](../../../triage.md): if a future
  M5 / M7 orchestrator batches multiple era-flip `at_worldtime` updates
  into one action, reverse-replay can transiently collide against the
  non-deferrable unique index. No callers today (this slice ships
  primitives only).
