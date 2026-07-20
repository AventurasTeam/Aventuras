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
- **Native embedder session cache needs eviction on model removal.**
  `lib/embedder/local/runtime.native.ts` holds a lazy `bundles`
  `Map<modelId, SessionBundle>`; a removed then re-downloaded model reuses
  its dir, so without eviction the cache keeps serving inferences from the
  deleted model. Desktop already wires `evictPipeline` into
  `delete-partial` (Task 6); the native map needs a symmetric evict hook
  when the M7.1 model-remove flow lands. Surfaced by M3.1a Task 7
  (2026-07-20).
- **Ranker must convert vec0's L2 distance to cosine similarity.** The
  `0005_embedder_vec0.sql` `vec0` tables declare no `distance_metric`, so
  KNN ranks by raw L2; that's only equivalent to cosine ranking because
  every stored and query vector is unit-norm — an invariant the C1 facade
  (Task 9, landing next) enforces at write and query time, not the vec0
  layer itself. Slice 3.4's ranker must convert each `distance` column back
  to a similarity via `cos = 1 − d²/2` before building its trace, not treat
  distance as already-cosine. Surfaced by M3.1a Task 8 (2026-07-20).
