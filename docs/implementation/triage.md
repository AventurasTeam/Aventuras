# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **`generation-pipeline.md → New-entity emission` "(or piggyback)"
  parenthetical contradicts the memory write-set canon.** The section
  opens "The classifier (or piggyback) creating a brand-new entity…", but
  [`cadence.md → Concurrency`](../memory/cadence.md#concurrency) and
  [`piggyback.md`](../memory/piggyback.md) give piggyback zero creation
  rights — creation is classifier-only (disambiguation lives there by
  design). Surfaced by the M3 promotion audit (2026-07-20). The
  id-allocation mechanic the section describes is correct either way; the
  fix is dropping or rewording the parenthetical. Canonical edit — route
  through a design / cleanup pass, not a planning commit.

- **`vec0`'s primary key is enforced globally, not scoped by its
  partition key, which conflicts with the documented branch-fork
  behavior for `*_vec` tables.** Verified empirically against
  `sqlite-vec` 0.1.9 (`node:sqlite` + `getLoadablePath()`): inserting
  the same `id` into two different `branch_id` partitions of a single
  `vec0` table raises a unique-constraint error on the primary key,
  even though `branch_id` is declared a partition key. But
  [`data-model.md → Branch model`](../data-model.md#branch-model)'s
  branch-copy manifest says `*_vec` fork behavior is "copy current
  rows" with the same `id`, matching how every other branch-scoped
  table forks (composite `(branch_id, id)` PK, `id` reused across
  branches by design, per the same section). As written, that
  fork-copy step cannot execute against the `0005_embedder_vec0.sql`
  DDL (Slice 3.1, Task 1) once a branch has any embedded rows.
  Surfaced while building `lib/db/embeddings/ops.ts` (Slice 3.1a,
  Task 3) — out of that task's scope (DDL is contract-pinned, and
  `*_vec` fork-copy isn't implemented yet). Needs resolution before
  whichever slice implements branch-fork's `*_vec` copy step —
  options include dropping `id` as the `vec0` primary key in favor of
  a synthetic per-row key with `id` / `branch_id` as plain metadata
  columns, or re-embedding per branch at fork instead of copying
  vectors.
