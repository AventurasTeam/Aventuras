# Milestones

Per-milestone implementation work. Each milestone lives in its own
directory (`NN-name/`) with a `milestone.md` definition and a
`slices/` subdirectory holding per-slice docs. See
[../conventions.md](../conventions.md) for authoring conventions.

## Defined milestones

- [Milestone 1 — Spine](./01-spine/milestone.md). Walking
  skeleton across all architectural layers; ends with one
  stub-LLM pipeline run completing end-to-end.
- [Milestone 1.5 — Data foundation](./01b-data-foundation/milestone.md).
  Full relational schema + typed working-set stores + Tier-1 CRUD
  action arms, landed up front so feature milestones build against a
  complete substrate and parallelize. Inserted between M1 and M2; not
  a renumber (M2–M9 stay provisional roadmap entries).
- [Milestone 2 — First user loop](./02-first-user-loop/milestone.md).
  Smallest end-to-end story loop with a real provider: OAI-compat
  provider + resolution chain, minimum-viable wizard, story list,
  reader-composer minimum, Liquid engine + bundled pack, end-to-end
  wiring; ten slices, eight day-one startable.
- [Milestone 3 — Memory floor](./03-memory-floor/milestone.md).
  Memory pipeline online: embedder substrate + vec0 tables +
  creation hard gate, piggyback layer, periodic classifier,
  retrieval + ranker, dev probe, full wizard World / Cast steps,
  suggestions, worldTime editing, batched undo, regenerate;
  twelve slices, five day-one startable.
