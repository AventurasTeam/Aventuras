# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## Data-model

- **Implement the reversal-integrity contract before 4.2c's merge.**
  The no-gate write lock, the reference closure on every reversal
  path with its redo labels, the reversal of rows a delete holds, the
  two integrity refusals, and a rollback preview that counts the closed
  set, per
  [`generation-pipeline.md → Reverse-replay`](./generation-pipeline.md#reverse-replay)
  and [`→ No-gate write phase`](./generation-pipeline.md#no-gate-write-phase).
  A standalone PR; the merge in
  [`02c-collision-review.md`](./implementation/milestones/04-world-plot-read-surfaces/slices/02c-collision-review.md#open-questions)
  depends on it.
