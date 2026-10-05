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

- **Before the next reversal-planner rule — `buildUndoOps` carries
  every reversal rule in one loop.** `buildUndoOps` in
  `lib/actions/delta/reverse-replay.ts` is ~260 lines, its per-delta
  loop ~215, holding the live and held arms, re-own and tombstones,
  with four hand-synced per-row presence structures (`working`,
  `absent`, `tombstones`, `endsAbsent`) beside the held copies'
  `removed` flags, and five closures re-created per delta; the
  stranded-writes pass and the two refusals follow the loop. Extract
  the create, delete and update arms (and their held variants) into
  named helpers, and consider one per-row state, before the next rule
  lands. The likely next rules are the redo refusal parked as
  [a kept create in a redo group](./parked.md#a-kept-create-in-a-redo-group-fails-redo-with-a-raw-sqlite-error)
  and the translation residual in
  [roadmap M8.1](./implementation/roadmap.md#m8--translation--vault-parent-shell).
  Behaviour-neutral; the reverse-replay and reversal suites are the
  safety net. Raised in the reversal-integrity PR's review
  (2026-10-05).
